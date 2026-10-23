-- Local synthetic fixtures; no committed data or remote environment required.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

-- Ignore local request limits and preserve the initial database with rollback.
delete from private.coupon_uses;
delete from private.order_requests;
delete from private.customers;
delete from private.showcase_items;
delete from private.coupons;

insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-000000000071','safety-owner@example.invalid'),
  ('00000000-0000-4000-8000-000000000072','safety-attendant@example.invalid'),
  ('00000000-0000-4000-8000-000000000073','safety-no-finance@example.invalid'),
  ('00000000-0000-4000-8000-000000000074','safety-production@example.invalid');
insert into private.staff_members(tenant_id, user_id, display_name, role, active, can_view_financial) values
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000071','Owner fictícia','owner',true,true),
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000072','Atendente fictícia','attendant',true,true),
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000073','Sem financeiro fictícia','attendant',true,false),
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000074','Produção fictícia','production',true,true);

create function pg_temp.as_user(id text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', id, true);
$$;
create function pg_temp.site_request(p_lines jsonb, changes jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('customer','Cliente fictícia','phone','(47) 98000-0071',
    'date',to_char((now() at time zone 'America/Sao_Paulo')::date + 3,'YYYY-MM-DD'),
    'time','15:00','fulfillment','pickup','address','','notes','','lines',p_lines) || changes;
$$;
create temp table state(label text primary key, value jsonb);
grant all on table state to anon, authenticated;
grant execute on function pg_temp.as_user(text), pg_temp.site_request(jsonb,jsonb) to anon, authenticated;

select ok(not has_function_privilege('anon','public.convert_order_request(uuid,jsonb)','EXECUTE'), 'anon cannot convert');
select ok(not has_function_privilege('anon','public.patch_customer(text,text,boolean,integer)','EXECUTE'), 'anon cannot patch customers');
select ok(not has_function_privilege('authenticated','private.customer_json(private.customers)','EXECUTE'), 'customer helper is not exposed');
select ok(not has_function_privilege('authenticated','private.validate_reserved_showcase_lines(jsonb,jsonb)','EXECUTE'), 'reservation helper is not exposed');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000071');
insert into state values ('item', public.save_showcase_item(
  '{"id":"","name":"Fatia fictícia","description":"","unit":"un","priceCents":1500,"stock":3,"photoPath":"","active":true,"sort":0}'::jsonb));
select ok((select jsonb_typeof(value -> 'updatedAt') = 'string' from state where label = 'item'), 'showcase response supplies timestamp token');
select lives_ok($$select public.save_showcase_item('{"id":"","name":"Outro item fictício","description":"","unit":"un","priceCents":2000,"stock":1,"photoPath":"","active":false,"sort":1,"updatedAt":""}')$$, 'create also accepts an empty timestamp');
select throws_ok($$select public.save_showcase_item((select value - 'updatedAt' from state where label = 'item'))$$,
  'P0001','INVALID_SHOWCASE','update needs its original timestamp');
insert into state values ('updated-item', public.save_showcase_item(
  (select value || '{"description":"Atualizada"}'::jsonb from state where label = 'item')));
select throws_ok($$select public.save_showcase_item((select value from state where label = 'item'))$$,
  'P0001','ORDER_CONFLICT','stale editor cannot overwrite a newer edit');
select lives_ok($$select public.save_coupon('{"id":"","code":"SAFETY10","description":"Teste","kind":"percent","value":10,"firstOrderOnly":false,"minOrderCents":0,"startsOn":"","endsOn":"","maxUses":"","active":true}')$$, 'owner creates test coupon');

set local role anon;
select throws_ok($$select public.check_coupon('SAFETY10','47980000071',1)$$,
  'P0001','COUPON_MIN_ORDER','rounded zero discount is rejected while quoting');
select throws_ok($$select public.submit_order_request(pg_temp.site_request(
  '[{"description":"Centavo fictício","quantity":1,"unit":"un","unitPriceCents":1}]', '{"couponCode":"SAFETY10"}'))$$,
  'P0001','COUPON_MIN_ORDER','rounded zero discount has a domain error on submission');
select lives_ok($$select public.submit_order_request(pg_temp.site_request(
  jsonb_build_array(jsonb_build_object('showcaseId',(select value ->> 'id' from state where label = 'item'),'quantity',2)),
  '{"couponCode":"SAFETY10","marketingOptIn":true}'))$$, 'site reserves inventory and coupon together');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000072');
select throws_ok($$select public.save_showcase_item((select value || '{"active":false}'::jsonb from state where label = 'updated-item'))$$,
  'P0001','ORDER_CONFLICT','a reservation invalidates an older editor timestamp');
reset role;
select is((select stock from private.showcase_items where id = (select (value ->> 'id')::uuid from state where label = 'item')),
  1.000::numeric, 'stale writes preserve reserved inventory');
select is((select count(*)::integer from private.coupon_uses), 1, 'zero-discount failure left no use row');

insert into state select 'request', jsonb_build_object('id',id) from private.order_requests where phone_digits = '47980000071';
insert into state select 'draft', payload || jsonb_build_object(
  'id','10000000-0000-4000-8000-000000000071','number',1,'receivedCents',0,'status','pending','createdAt','2026-10-23T12:00:00.000Z',
  'lines',(select jsonb_agg(line - 'showcaseId') from jsonb_array_elements(payload -> 'lines') line))
  from private.order_requests where id = (select (value ->> 'id')::uuid from state where label = 'request');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000073');
select throws_ok($$select public.convert_order_request((select (value ->> 'id')::uuid from state where label = 'request'),(select value from state where label = 'draft'))$$,
  'P0001','ACCESS_DENIED','attendant without finance cannot convert');
select throws_ok($$select public.patch_customer('47980000071','',false,1)$$,
  'P0001','ACCESS_DENIED','attendant without finance cannot patch');
select pg_temp.as_user('00000000-0000-4000-8000-000000000074');
select throws_ok($$select public.convert_order_request((select (value ->> 'id')::uuid from state where label = 'request'),(select value from state where label = 'draft'))$$,
  'P0001','ACCESS_DENIED','production cannot convert even with financial visibility');
select throws_ok($$select public.patch_customer('47980000071','',false,1)$$,
  'P0001','ACCESS_DENIED','production cannot patch');
select pg_temp.as_user('00000000-0000-4000-8000-000000000072');
select throws_ok($$select public.convert_order_request((select (value ->> 'id')::uuid from state where label = 'request'),
  (select jsonb_set(value,'{lines,0,quantity}','1') from state where label = 'draft'))$$,
  'P0001','SHOWCASE_RESERVED','conversion cannot change the reserved quantity');
select throws_ok($$select public.convert_order_request((select (value ->> 'id')::uuid from state where label = 'request'),
  (select value || '{"receivedCents":999999}'::jsonb from state where label = 'draft'))$$,
  'P0001','INVALID_ORDER','invalid order rolls conversion back');
reset role;
select is((select status from private.order_requests where id = (select (value ->> 'id')::uuid from state where label = 'request')),
  'new', 'failed conversion leaves request new');
select ok(not exists(select 1 from private.order_records where id = '10000000-0000-4000-8000-000000000071'), 'failed conversion creates no order');
select ok(not exists(select 1 from private.order_audit where order_id = '10000000-0000-4000-8000-000000000071'), 'failed conversion creates no audit');

-- Force a failure after save_order wrote its order/audit, before request resolution.
create function pg_temp.fail_conversion() returns trigger language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = 'TEST_CONVERT_FAIL';
end;
$$;
create trigger growth_safety_fail_conversion before update on private.order_requests
for each row when (new.status = 'converted') execute function pg_temp.fail_conversion();
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000072');
select throws_ok($$select public.convert_order_request((select (value ->> 'id')::uuid from state where label = 'request'),
  (select value from state where label = 'draft'))$$,
  'P0001','TEST_CONVERT_FAIL','resolution failure rolls back the preceding order write');
reset role;
drop trigger growth_safety_fail_conversion on private.order_requests;
select ok(not exists(select 1 from private.order_records where id = '10000000-0000-4000-8000-000000000071'), 'resolution failure leaves no order');
select ok(not exists(select 1 from private.order_audit where order_id = '10000000-0000-4000-8000-000000000071'), 'resolution failure leaves no audit');
select is((select status from private.order_requests where id = (select (value ->> 'id')::uuid from state where label = 'request')),
  'new','resolution failure keeps the original request actionable');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000072');
insert into state values ('converted', public.convert_order_request(
  (select (value ->> 'id')::uuid from state where label = 'request'),(select value from state where label = 'draft')));
select ok((select value ?& array['order','revision'] from state where label = 'converted'), 'conversion returns an OrderRecord');
select throws_ok($$select public.convert_order_request((select (value ->> 'id')::uuid from state where label = 'request'),
  (select jsonb_set(value,'{id}','"10000000-0000-4000-8000-000000000072"') from state where label = 'draft'))$$,
  'P0001','ORDER_CONFLICT','duplicate conversion cannot create another order');
select throws_ok($$select public.resolve_order_request((select (value ->> 'id')::uuid from state where label = 'request'),'dismissed')$$,
  'P0001','ORDER_CONFLICT','converted request cannot return stock or release coupon');
select throws_ok($$select public.save_order((select jsonb_set(value -> 'order','{lines,0,quantity}','3') from state where label = 'converted'),1)$$,
  'P0001','SHOWCASE_RESERVED','later edits cannot increase the reserved quantity');
select throws_ok($$select public.save_order((select jsonb_set(value -> 'order','{lines,0,unit}','"kg"') from state where label = 'converted'),1)$$,
  'P0001','SHOWCASE_RESERVED','later edits cannot change the reserved unit');
select throws_ok($$select public.save_order((select jsonb_set(value -> 'order','{lines,0,id}','"replacement"') from state where label = 'converted'),1)$$,
  'P0001','SHOWCASE_RESERVED','later edits cannot replace a reserved line');
select lives_ok($$select public.save_order((select (value -> 'order') || '{"notes":"Contato confirmado"}'::jsonb from state where label = 'converted'),1)$$,
  'contact/notes remain editable on converted orders');
reset role;
select is((select converted_order_id::text from private.order_requests where id = (select (value ->> 'id')::uuid from state where label = 'request')),
  '10000000-0000-4000-8000-000000000071','request retains its converted order association');
select is((select stock from private.showcase_items where id = (select (value ->> 'id')::uuid from state where label = 'item')),
  1.000::numeric,'conversion and refused dismiss leave reservation consumed');
select is((select uses from private.coupons where code = 'SAFETY10'),1,'conversion and refused dismiss preserve coupon usage');

-- A stale notes editor must not restore consent withdrawn by another operator.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000072');
insert into state select 'customer', customer from jsonb_array_elements(public.read_customers()) customer where customer ->> 'key' = '47980000071';
insert into state values ('withdrawn', public.patch_customer('47980000071','Sem campanhas',false,
  (select (value ->> 'revision')::integer from state where label = 'customer')));
select ok((select (value ->> 'revision')::integer > (select (value ->> 'revision')::integer from state where label = 'customer')
  from state where label = 'withdrawn'), 'customer patch advances revision');
select throws_ok($$select public.patch_customer('47980000071','Notas antigas',true,
  (select (value ->> 'revision')::integer from state where label = 'customer'))$$,
  'P0001','ORDER_CONFLICT','stale notes cannot restore withdrawn consent');
select ok((select value ?& array['key','name','phone','source','marketingOptIn','optInAt','optInSource','notes','firstSeen','lastSeen','revision']
  from state where label = 'withdrawn'), 'patch returns the complete customer record');
reset role;
select ok((select not marketing_opt_in and opt_in_at is null and opt_in_source is null from private.customers where phone_key = '47980000071'),
  'withdrawn consent remains withdrawn after conflict');
select is((select notes from private.customers where phone_key = '47980000071'),'Sem campanhas','conflict preserves newer notes');

select * from finish();
rollback;
