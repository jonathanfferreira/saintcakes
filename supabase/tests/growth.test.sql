-- Local, synthetic fixtures only. Every change is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();
-- Start from empty tables so limits and counts ignore earlier local data (rolled back).
delete from private.coupon_uses; delete from private.order_requests; delete from private.customers;
delete from private.showcase_items; delete from private.coupons;

insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-000000000031', 'owner@example.invalid'),
  ('00000000-0000-4000-8000-000000000032', 'attendant@example.invalid'),
  ('00000000-0000-4000-8000-000000000033', 'production@example.invalid');
insert into private.staff_members(tenant_id, user_id, display_name, role, active, can_view_financial) values
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000031','Dona fictícia','owner',true,true),
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000032','Atendente fictícia','attendant',true,true),
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000033','Produção fictícia','production',true,true);

create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, true); $$;
create function pg_temp.request(changes jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('customer','Cliente fictícia','phone','(47) 98000-0001',
    'date', to_char((now() at time zone 'America/Sao_Paulo')::date + 3, 'YYYY-MM-DD'), 'time','15:00',
    'fulfillment','pickup','address','','notes','',
    'lines', jsonb_build_array(jsonb_build_object('description','Bolo fictício','quantity',2,'unit','kg','unitPriceCents',10000))) || changes;
$$;
create function pg_temp.coupon(changes jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id','','code','bemvindo10','description','Boas-vindas','kind','percent','value',10,'firstOrderOnly',true,
    'minOrderCents',0,'startsOn','','endsOn','','maxUses','','active',true) || changes;
$$;
grant execute on function pg_temp.as_user(text), pg_temp.request(jsonb), pg_temp.coupon(jsonb) to anon, authenticated;

select is(private.phone_key('+55 (47) 98000-0001'), '47980000001', 'country code and punctuation are dropped');
select is(private.phone_key('47 98000-0001'), '47980000001', 'local format gives the same key');
select ok(not has_table_privilege('anon','private.coupons','SELECT'), 'anon cannot read coupons');
select ok(not has_table_privilege('anon','private.customers','SELECT'), 'anon cannot read customers');
select ok(has_function_privilege('anon','public.check_coupon(text,text,integer)','EXECUTE'), 'anon may check a coupon');
select ok(has_function_privilege('anon','public.public_showcase()','EXECUTE'), 'anon may read the showcase');
select ok(not has_function_privilege('anon','public.read_customers()','EXECUTE'), 'anon cannot list customers');
select ok(not has_function_privilege('anon','public.save_showcase_item(jsonb)','EXECUTE'), 'anon cannot edit the showcase');

-- Coupons are owner-only to manage.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000032');
select throws_ok($$select public.save_coupon(pg_temp.coupon())$$, 'P0001', 'ACCESS_DENIED', 'attendant cannot create coupons');
select pg_temp.as_user('00000000-0000-4000-8000-000000000031');
select throws_ok($$select public.save_coupon(pg_temp.coupon('{"value":95}'))$$, 'P0001', 'INVALID_COUPON', 'percent above 90 rejected');
select throws_ok($$select public.save_coupon(pg_temp.coupon('{"code":"no spaces"}'))$$, 'P0001', 'INVALID_COUPON', 'invalid code rejected');
select is(public.save_coupon(pg_temp.coupon()) ->> 'code', 'BEMVINDO10', 'owner creates a first-order coupon, code upper-cased');
select throws_ok($$select public.save_coupon(pg_temp.coupon())$$, 'P0001', 'COUPON_CODE_TAKEN', 'duplicate code rejected');
select lives_ok($$select public.save_coupon(pg_temp.coupon('{"code":"FIXO15","kind":"fixed","value":1500,"firstOrderOnly":false,"minOrderCents":5000,"maxUses":1}'))$$, 'fixed coupon with one use');
select lives_ok($$select public.save_coupon(pg_temp.coupon('{"code":"VELHO","firstOrderOnly":false,"endsOn":"2020-01-01"}'))$$, 'expired coupon saved');
-- Showcase managed by order editors.
select lives_ok($$select public.save_showcase_item('{"id":"","name":"Fatia de bolo fictícia","description":"","unit":"un","priceCents":1500,"stock":3,"photoPath":"","active":true,"sort":0}')$$, 'owner adds a showcase item');
select pg_temp.as_user('00000000-0000-4000-8000-000000000033');
select throws_ok('select public.read_showcase()', 'P0001', 'ACCESS_DENIED', 'production cannot manage the showcase');
select throws_ok('select public.read_customers()', 'P0001', 'ACCESS_DENIED', 'production cannot read the customer central');
reset role;
create temp table shelf as select id from private.showcase_items limit 1;
grant select on shelf to anon, authenticated;

set local role anon;
select is(jsonb_array_length(public.public_showcase()), 1, 'active stocked item is public');
select is(public.check_coupon('bemvindo10', '47 98000-0001', 20000) ->> 'discountCents', '2000', '10% of R$ 200 for a first order');
select throws_ok($$select public.check_coupon('NADA', '47 98000-0001', 20000)$$, 'P0001', 'COUPON_NOT_FOUND', 'unknown code');
select throws_ok($$select public.check_coupon('VELHO', '47 98000-0001', 20000)$$, 'P0001', 'COUPON_EXPIRED', 'expired code');
select throws_ok($$select public.check_coupon('FIXO15', '47 98000-0001', 4000)$$, 'P0001', 'COUPON_MIN_ORDER', 'below minimum order');
-- First request with the welcome coupon, a showcase item and marketing consent.
select is((public.submit_order_request(pg_temp.request(jsonb_build_object('couponCode','bemvindo10','marketingOptIn',true,
  'lines', jsonb_build_array(jsonb_build_object('description','Bolo fictício','quantity',2,'unit','kg','unitPriceCents',10000),
    jsonb_build_object('showcaseId', (select id from shelf), 'quantity', 2)))))) ->> 'discountCents', '2300', 'discount counts the showcase item (10% of R$ 230)');
select throws_ok($$select public.check_coupon('bemvindo10', '+55 47 98000-0001', 20000)$$, 'P0001', 'COUPON_FIRST_ORDER', 'same WhatsApp is no longer a first order');
select throws_ok($$select public.submit_order_request(pg_temp.request(jsonb_build_object('phone','(47) 98000-0002',
  'lines', jsonb_build_array(jsonb_build_object('showcaseId', (select id from shelf), 'quantity', 2)))))$$, 'P0001', 'SHOWCASE_STOCK', 'cannot reserve more than the stock left');
select throws_ok($$select public.submit_order_request(pg_temp.request(jsonb_build_object('phone','(47) 98000-0003',
  'lines', jsonb_build_array(jsonb_build_object('showcaseId', (select id from shelf), 'quantity', 1, 'unitPriceCents', 1)))))$$, 'P0001', 'INVALID_REQUEST', 'showcase lines cannot carry their own price');
select lives_ok($$select public.submit_order_request(pg_temp.request(jsonb_build_object('phone','(47) 98000-0004','couponCode','FIXO15')))$$, 'fixed coupon used once');
select throws_ok($$select public.check_coupon('FIXO15', '47 98000-0005', 20000)$$, 'P0001', 'COUPON_EXHAUSTED', 'single-use coupon exhausted');
reset role;

select is((select stock from private.showcase_items where id = (select id from shelf)), 1.000::numeric(9,3), 'stock reserved on request');
select is((select uses from private.coupons where code = 'BEMVINDO10'), 1, 'coupon use counted');
select ok((select marketing_opt_in and opt_in_source = 'site' from private.customers where phone_key = '47980000001'), 'opt-in recorded with source');
select is((select payload ->> 'discountCents' from private.order_requests where phone_digits = '47980000001'), '2300', 'request keeps the server discount');
select ok((select (payload -> 'lines' -> 1) ? 'showcaseId' and payload -> 'lines' -> 1 ->> 'unitPriceCents' = '1500' from private.order_requests where phone_digits = '47980000001'), 'showcase line priced from the shelf');
create temp table first_request as select id from private.order_requests where phone_digits = '47980000001';
grant select on first_request to authenticated;

-- A later order without consent never withdraws it; dismissing gives stock and coupon back.
select private.touch_customer('a0000000-0000-4000-8000-000000000001', 'Cliente fictícia', '47980000001', 'equipe', null);
select ok((select marketing_opt_in from private.customers where phone_key = '47980000001'), 'missing answer keeps consent');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000032');
select lives_ok($$select public.resolve_order_request((select id from first_request), 'dismissed')$$, 'attendant dismisses the request');
select is(jsonb_array_length(public.read_customers()), 2, 'attendant reads the customer central');
select is(public.save_customer('47980000001', 'Prefere retirar à tarde', false) ->> 'marketingOptIn', 'false', 'consent can be withdrawn by the team');
select throws_ok($$select public.delete_customer('47980000001')$$, 'P0001', 'ACCESS_DENIED', 'only the owner erases a customer');
select pg_temp.as_user('00000000-0000-4000-8000-000000000031');
select lives_ok($$select public.delete_customer('47980000001')$$, 'owner erases a customer record');
reset role;
select is((select stock from private.showcase_items where id = (select id from shelf)), 3.000::numeric(9,3), 'dismiss returns showcase stock');
select is((select uses from private.coupons where code = 'BEMVINDO10'), 0, 'dismiss releases the coupon use');

-- Orders accept a discount but never a free or negative total.
create function pg_temp.order_with(discount integer, received integer) returns jsonb language sql as $$
  select jsonb_build_object('id','10000000-0000-4000-8000-0000000000aa','number',1,'customer','Cliente fictícia','phone','(47) 98000-0009',
    'date','2026-11-01','time','10:00','fulfillment','pickup','address','','notes','','status','confirmed','createdAt','2026-10-23T12:00:00.000Z',
    'lines', '[{"id":"a","description":"Bolo","quantity":1,"unit":"un","unitPriceCents":10000}]'::jsonb,
    'receivedCents', received, 'discountCents', discount, 'couponCode', 'BEMVINDO10');
$$;
select lives_ok($$select private.validate_order(pg_temp.order_with(1000, 9000))$$, 'discount with full payment of the reduced total');
select throws_ok($$select private.validate_order(pg_temp.order_with(1000, 9001))$$, 'P0001', 'INVALID_ORDER', 'received above the discounted total');
select throws_ok($$select private.validate_order(pg_temp.order_with(10000, 0))$$, 'P0001', 'INVALID_ORDER', 'discount cannot make the order free');
select throws_ok($$select private.validate_order(pg_temp.order_with(-1, 0))$$, 'P0001', 'INVALID_ORDER', 'negative discount rejected');
select lives_ok($$select private.validate_order(pg_temp.order_with(0, 0) - 'discountCents' - 'couponCode')$$, 'orders without coupon keys still valid');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000032');
select lives_ok($$select public.save_order(pg_temp.order_with(1000, 0))$$, 'attendant saves a discounted order');
reset role;
select ok(exists(select 1 from private.customers where phone_key = '47980000009' and source = 'equipe' and not marketing_opt_in), 'team orders feed the central without consent');

select * from finish();
rollback;
