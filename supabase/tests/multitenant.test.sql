-- Local, synthetic fixtures only. Every change is rolled back.
-- Two shops (Saint Cakes and shop-b) must never read or change each other's rows.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();
-- Start from empty tables so counts ignore earlier local data (rolled back).
delete from private.coupon_uses; delete from private.order_requests; delete from private.customers;
delete from private.showcase_items; delete from private.coupons;

insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000a2', 'attendant-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000a3', 'production-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b1', 'owner-b@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b2', 'attendant-b@example.invalid'),
  ('00000000-0000-4000-8000-0000000000c1', 'owner-paused@example.invalid');
insert into private.staff_members(tenant_id, user_id, display_name, role, active, can_view_financial) values
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000a1','Dona A fictícia','owner',true,true),
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000a2','Atendente A fictícia','attendant',true,true),
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000a3','Produção A fictícia','production',true,false);

-- Provision shops as the privileged test role, before any API role is assumed.
select private.create_tenant('shop-b', 'Loja B fictícia', '00000000-0000-4000-8000-0000000000b1', 'Dona B fictícia');
insert into private.staff_members(tenant_id, user_id, display_name, role, active, can_view_financial)
  select id, '00000000-0000-4000-8000-0000000000b2', 'Atendente B fictícia', 'attendant', true, true
  from private.tenants where slug = 'shop-b';
select private.create_tenant('shop-paused', 'Loja pausada fictícia', '00000000-0000-4000-8000-0000000000c1', 'Dona pausada');
update private.tenants set status = 'paused' where slug = 'shop-paused';
select set_config('test.b_id', (select id::text from private.tenants where slug = 'shop-b'), true);
select set_config('test.a_counter', (select order_counter::text from private.tenants where slug = 'saint-cakes'), true);

insert into private.showcase_items(id, tenant_id, name, unit, price_cents, stock, photo_path) values
  ('40000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001', 'Bolo A fictício', 'un', 5000, 5, 'a0000000-0000-4000-8000-000000000001/showcase/a.jpg'),
  ('40000000-0000-4000-8000-0000000000b1', (select id from private.tenants where slug = 'shop-b'), 'Bolo B fictício', 'un', 6000, 5, null);
select set_config('test.a_updated', (select updated_at::text from private.showcase_items where id = '40000000-0000-4000-8000-0000000000a1'), true);
insert into private.coupons(id, tenant_id, code, kind, value) values
  ('50000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001', 'PROMO10', 'percent', 10),
  ('50000000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-000000000001', 'SOA', 'percent', 15),
  ('50000000-0000-4000-8000-0000000000b1', (select id from private.tenants where slug = 'shop-b'), 'PROMO10', 'percent', 20);
insert into private.customers(tenant_id, phone_key, name, phone, source) values
  ('a0000000-0000-4000-8000-000000000001', '47980000201', 'Cliente A fictícia', '47980000201', 'equipe'),
  ('a0000000-0000-4000-8000-000000000001', '47980000202', 'Só da loja A', '47980000202', 'equipe'),
  ((select id from private.tenants where slug = 'shop-b'), '47980000201', 'Cliente B fictícia', '47980000201', 'equipe');

create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, true); $$;
create function pg_temp.request(changes jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('customer','Cliente fictícia','phone','(47) 98000-0301',
    'date', to_char((now() at time zone 'America/Sao_Paulo')::date + 3, 'YYYY-MM-DD'), 'time','15:00',
    'fulfillment','pickup','address','','notes','',
    'lines', jsonb_build_array(jsonb_build_object('description','Bolo fictício','quantity',2,'unit','kg','unitPriceCents',10000))) || changes;
$$;
create function pg_temp.ord(id text, customer text, phone text) returns jsonb language sql as $$
  select jsonb_build_object('id',id,'number',99999,'customer',customer,'phone',phone,'date','2026-11-01','time','14:30',
    'fulfillment','pickup','address','','notes','Exemplo multi-loja','status','confirmed','createdAt','2001-01-01T00:00:00.000Z',
    'lines','[{"id":"line-a","description":"Item fictício","quantity":1,"unit":"un","unitPriceCents":1000}]'::jsonb,'receivedCents',0);
$$;
grant execute on function pg_temp.as_user(text), pg_temp.request(jsonb), pg_temp.ord(text, text, text) to anon, authenticated;

-- ---------- provisioning is administrative only ----------
select ok(not has_function_privilege('anon','private.create_tenant(text,text,uuid,text)','EXECUTE'), 'anon cannot provision shops');
select ok(not has_function_privilege('authenticated','private.create_tenant(text,text,uuid,text)','EXECUTE'), 'authenticated cannot provision shops');
select ok(not has_table_privilege('anon','private.tenants','SELECT'), 'anon cannot read tenants');
select ok(not has_table_privilege('authenticated','private.tenants','SELECT'), 'authenticated cannot read tenants');
select ok((select relrowsecurity from pg_class where oid = 'private.tenants'::regclass), 'tenants has RLS enabled');
select is((select status from private.tenants where slug = 'shop-b'), 'trial', 'new shop starts in trial');
select throws_ok($$select private.create_tenant('shop-b', 'Duplicada', '00000000-0000-4000-8000-0000000000a2', 'X Y')$$, '23505', null, 'shop slugs are unique');
select throws_ok($$select private.create_tenant('shop-d', 'Outra loja', '00000000-0000-4000-8000-0000000000a2', 'X Y')$$, '23505', null, 'one account cannot own a second shop');

-- ---------- public RPCs ----------
set local role anon;
select throws_ok('select private.create_tenant(''x-shop'',''Loja X'',gen_random_uuid(),''Dona'')', '42501', null, 'anon create_tenant denied');
select throws_ok('select * from private.tenants', '42501', 'permission denied for table tenants', 'anon cannot read tenants');
select throws_ok($$select public.public_settings('nope')$$, 'P0001', 'SHOP_NOT_FOUND', 'unknown shop settings');
select throws_ok($$select public.public_showcase('nope')$$, 'P0001', 'SHOP_NOT_FOUND', 'unknown shop showcase');
select throws_ok($$select public.check_coupon('nope','PROMO10','47 98000-0001',20000)$$, 'P0001', 'SHOP_NOT_FOUND', 'unknown shop coupon');
select throws_ok($$select public.submit_order_request('nope', pg_temp.request())$$, 'P0001', 'SHOP_NOT_FOUND', 'unknown shop request');
select throws_ok($$select public.public_settings('shop-paused')$$, 'P0001', 'SHOP_NOT_FOUND', 'paused shop settings');
select throws_ok($$select public.public_showcase('shop-paused')$$, 'P0001', 'SHOP_NOT_FOUND', 'paused shop showcase');
select throws_ok($$select public.check_coupon('shop-paused','PROMO10','47 98000-0001',20000)$$, 'P0001', 'SHOP_NOT_FOUND', 'paused shop coupon');
select throws_ok($$select public.submit_order_request('shop-paused', pg_temp.request())$$, 'P0001', 'SHOP_NOT_FOUND', 'paused shop takes no requests');
select throws_ok($$select public.public_settings(null)$$, 'P0001', 'SHOP_NOT_FOUND', 'null shop rejected');

select is(public.public_settings('shop-b'), '{"minLeadDays": 2, "deliveryZones": []}'::jsonb, 'new shop gets default public settings');
select is((select array_agg(e ->> 'name') from jsonb_array_elements(public.public_showcase('shop-b')) e), array['Bolo B fictício'], 'shop-b showcase has only its own items');
select is((select array_agg(e ->> 'name') from jsonb_array_elements(public.public_showcase('saint-cakes')) e), array['Bolo A fictício'], 'Saint Cakes showcase has only its own items');
select is((select array_agg(e ->> 'name') from jsonb_array_elements(public.public_showcase()) e), array['Bolo A fictício'], 'legacy showcase routes to Saint Cakes');
select is(public.public_settings(' SHOP-B ') , public.public_settings('shop-b'), 'slug is trimmed and case-insensitive');
select is(public.check_coupon('shop-b','promo10','47 98000-0001',20000) ->> 'discountCents', '4000', 'shop-b coupon uses the shop-b rule');
select is(public.check_coupon('saint-cakes','promo10','47 98000-0001',20000) ->> 'discountCents', '2000', 'Saint Cakes coupon uses its own rule');
select is(public.check_coupon('promo10','47 98000-0001',20000) ->> 'discountCents', '2000', 'legacy coupon check routes to Saint Cakes');
select throws_ok($$select public.check_coupon('shop-b','SOA','47 98000-0001',20000)$$, 'P0001', 'COUPON_NOT_FOUND', 'another shop''s coupon is unknown');

select is(public.submit_order_request('shop-b', pg_temp.request(jsonb_build_object('couponCode','PROMO10','marketingOptIn',true))) ->> 'discountCents', '4000', 'shop-b request applies the shop-b coupon');
select throws_ok($$select public.submit_order_request('shop-b', pg_temp.request(jsonb_build_object('phone','(47) 98000-0304','lines',
  '[{"showcaseId":"40000000-0000-4000-8000-0000000000a1","quantity":1}]'::jsonb)))$$, 'P0001', 'SHOWCASE_STOCK', 'shop-b cannot reserve another shop''s stock');
select is(public.submit_order_request('shop-b', pg_temp.request(jsonb_build_object('phone','(47) 98000-0304','lines',
  '[{"showcaseId":"40000000-0000-4000-8000-0000000000b1","quantity":1}]'::jsonb))) ->> 'received', 'true', 'shop-b reserves its own stock');
select is(public.submit_order_request('saint-cakes', pg_temp.request(jsonb_build_object('phone','(47) 98000-0303','couponCode','PROMO10'))) ->> 'discountCents', '2000', 'Saint Cakes request applies its own coupon');
select is(public.submit_order_request(pg_temp.request(jsonb_build_object('phone','(47) 98000-0302'))) ->> 'received', 'true', 'legacy submit_order_request is accepted');
reset role;

select is((select count(*)::int from private.order_requests where tenant_id = 'a0000000-0000-4000-8000-000000000001'), 2, 'Saint Cakes holds its two requests (legacy included)');
select is((select count(*)::int from private.order_requests where tenant_id = current_setting('test.b_id')::uuid), 2, 'shop-b holds only its two requests');
select is((select count(*)::int from private.order_requests where tenant_id not in ('a0000000-0000-4000-8000-000000000001', current_setting('test.b_id')::uuid)), 0, 'no request leaked to another shop');
select is((select stock from private.showcase_items where id = '40000000-0000-4000-8000-0000000000b1'), 4.000::numeric(9,3), 'shop-b stock reserved');
select is((select stock from private.showcase_items where id = '40000000-0000-4000-8000-0000000000a1'), 5.000::numeric(9,3), 'Saint Cakes stock untouched');
select is((select uses from private.coupons where id = '50000000-0000-4000-8000-0000000000b1'), 1, 'shop-b coupon use counted');
select is((select uses from private.coupons where id = '50000000-0000-4000-8000-0000000000a1'), 1, 'Saint Cakes coupon use counted separately');
select set_config('test.a_req', (select id::text from private.order_requests where tenant_id = 'a0000000-0000-4000-8000-000000000001' order by created_at limit 1), true);

-- ---------- staff of shop A: settings and orders ----------
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select is(public.current_staff() #>> '{shop,slug}', 'saint-cakes', 'owner A belongs to Saint Cakes');
select lives_ok($$select public.save_settings('{"pixKey":"pix-a-ficticia","pixHolder":"Loja A fictícia","minLeadDays":2,"deliveryZones":[{"name":"Bairro A","feeCents":500}]}')$$, 'owner A saves settings');
select is(public.save_order(pg_temp.ord('30000000-0000-4000-8000-0000000000a1','Cliente A fictícia','(47) 98000-0101'), null) #>> '{order,number}',
  (current_setting('test.a_counter')::bigint + 1)::text, 'Saint Cakes numbering continues from its counter');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1');
select is(public.current_staff() #>> '{shop,slug}', 'shop-b', 'owner B belongs to shop-b');
select is(public.save_order(pg_temp.ord('30000000-0000-4000-8000-0000000000b1','Cliente B fictícia','(47) 98000-0101'), null) #>> '{order,number}', '1', 'shop-b starts at number 1');
select is(public.save_order(pg_temp.ord('30000000-0000-4000-8000-0000000000b2','Cliente B2 fictícia','(47) 98000-0102'), null) #>> '{order,number}', '2', 'shop-b continues at number 2');
select lives_ok($$select public.save_settings('{"pixKey":"pix-b-ficticia","pixHolder":"Loja B fictícia","minLeadDays":3,"deliveryZones":[{"name":"Bairro B","feeCents":700}]}')$$, 'owner B saves settings');

-- ---------- reads return only the caller's shop ----------
select is((select array_agg(e #>> '{order,number}' order by e #>> '{order,number}') from jsonb_array_elements(public.read_orders()) e), array['1','2'], 'B read_orders returns only B orders');
select is((select array_agg(e #>> '{order,customer}' order by e #>> '{order,number}') from jsonb_array_elements(public.read_production_orders()) e), array['Cliente B fictícia','Cliente B2 fictícia'], 'B read_production_orders returns only B orders');
select is(jsonb_array_length(public.read_order_requests()), 2, 'B read_order_requests returns only B requests');
select is((select array_agg(e #>> '{request,phone}' order by e #>> '{request,phone}') from jsonb_array_elements(public.read_order_requests()) e), array['(47) 98000-0301','(47) 98000-0304'], 'B inbox holds B phones only');
select is(public.read_settings() ->> 'pixKey', 'pix-b-ficticia', 'B read_settings returns B settings');
select is((select array_agg(e ->> 'key' order by e ->> 'key') from jsonb_array_elements(public.read_customers()) e), array['47980000101','47980000102','47980000201','47980000301','47980000304'], 'B read_customers returns only B customers');
select is((select e ->> 'name' from jsonb_array_elements(public.read_customers()) e where e ->> 'key' = '47980000101'), 'Cliente B fictícia', 'same phone is a separate customer in shop-b');
select is((select array_agg(e ->> 'code' || ':' || (e ->> 'value')) from jsonb_array_elements(public.read_coupons()) e), array['PROMO10:20'], 'B read_coupons returns only B coupons');
select is((select array_agg(e ->> 'name') from jsonb_array_elements(public.read_showcase()) e), array['Bolo B fictício'], 'B read_showcase returns only B items');
select is((select array_agg(e ->> 'userId' order by e ->> 'userId') from jsonb_array_elements(public.list_staff()) e),
  array['00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2'], 'B list_staff returns only B staff');
select is(jsonb_array_length(public.read_audit('30000000-0000-4000-8000-0000000000b1')), 1, 'B reads its own audit');
select is(public.read_audit('30000000-0000-4000-8000-0000000000a1'), '[]'::jsonb, 'B read_audit of an A order is empty');
select lives_ok($$select public.save_coupon('{"id":"","code":"soa","description":"","kind":"percent","value":5,"firstOrderOnly":false,"minOrderCents":0,"startsOn":"","endsOn":"","maxUses":"","active":true}')$$, 'same coupon code is allowed in the other shop');
select throws_ok($$select public.save_coupon('{"id":"","code":"promo10","description":"","kind":"percent","value":5,"firstOrderOnly":false,"minOrderCents":0,"startsOn":"","endsOn":"","maxUses":"","active":true}')$$, 'P0001', 'COUPON_CODE_TAKEN', 'code stays unique inside one shop');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select ok(not exists(select 1 from jsonb_array_elements(public.read_orders()) e where e #>> '{order,id}' like '30000000-0000-4000-8000-0000000000b_'), 'A read_orders never shows B orders');
select ok(not exists(select 1 from jsonb_array_elements(public.read_production_orders()) e where e #>> '{order,id}' like '30000000-0000-4000-8000-0000000000b_'), 'A read_production_orders never shows B orders');
select is((select array_agg(e #>> '{request,phone}' order by e #>> '{request,phone}') from jsonb_array_elements(public.read_order_requests()) e), array['(47) 98000-0302','(47) 98000-0303'], 'A inbox holds A phones only');
select is(public.read_settings() ->> 'pixKey', 'pix-a-ficticia', 'A read_settings returns A settings');
select is((select array_agg(e ->> 'key' order by e ->> 'key') from jsonb_array_elements(public.read_customers()) e), array['47980000101','47980000201','47980000202','47980000302','47980000303'], 'A read_customers returns only A customers');
select is((select e ->> 'name' from jsonb_array_elements(public.read_customers()) e where e ->> 'key' = '47980000101'), 'Cliente A fictícia', 'same phone is a separate customer in Saint Cakes');
select is((select array_agg(e ->> 'code' order by e ->> 'code') from jsonb_array_elements(public.read_coupons()) e), array['PROMO10','SOA'], 'A read_coupons returns only A coupons');
select is((select e ->> 'value' from jsonb_array_elements(public.read_coupons()) e where e ->> 'code' = 'SOA'), '15', 'A coupon SOA keeps its own value');
select is((select array_agg(e ->> 'name') from jsonb_array_elements(public.read_showcase()) e), array['Bolo A fictício'], 'A read_showcase returns only A items');
select ok(not exists(select 1 from jsonb_array_elements(public.list_staff()) e where e ->> 'userId' like '00000000-0000-4000-8000-0000000000b_'), 'A list_staff never shows B staff');
select is(public.read_audit('30000000-0000-4000-8000-0000000000b1'), '[]'::jsonb, 'A read_audit of a B order is empty');

-- ---------- B cannot touch A's rows ----------
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1');
select throws_ok($$select public.save_order(pg_temp.ord('30000000-0000-4000-8000-0000000000a1','Invasor B','(47) 98000-0101'), 1)$$, 'P0001', 'ORDER_CONFLICT', 'B cannot update an A order');
select throws_ok($$select public.save_order(pg_temp.ord('30000000-0000-4000-8000-0000000000a1','Invasor B','(47) 98000-0101'), null)$$, 'P0001', 'ORDER_CONFLICT', 'creating with an A order id conflicts instead of overwriting');
select throws_ok($$select public.set_order_status('30000000-0000-4000-8000-0000000000a1','cancelled',1)$$, 'P0001', 'ORDER_CONFLICT', 'B cannot change A order status');
select throws_ok($$select public.convert_order_request(current_setting('test.a_req')::uuid, pg_temp.ord('30000000-0000-4000-8000-0000000000b9','Invasor B','(47) 98000-0399'))$$, 'P0001', 'ORDER_CONFLICT', 'B cannot convert an A request');
select throws_ok($$select public.resolve_order_request(current_setting('test.a_req')::uuid, 'dismissed')$$, 'P0001', 'ORDER_CONFLICT', 'B cannot resolve an A request');
select throws_ok($$select public.patch_customer('47980000202','invadido',true,1)$$, 'P0001', 'ORDER_CONFLICT', 'B cannot patch an A customer');
select throws_ok($$select public.save_customer('47980000202','invadido',true)$$, 'P0001', 'ORDER_CONFLICT', 'B cannot save an A customer');
select throws_ok($$select public.delete_customer('47980000202')$$, 'P0001', 'ORDER_CONFLICT', 'B cannot delete an A customer');
select throws_ok($$select public.save_coupon('{"id":"50000000-0000-4000-8000-0000000000a1","code":"PROMO10","description":"","kind":"percent","value":90,"firstOrderOnly":false,"minOrderCents":0,"startsOn":"","endsOn":"","maxUses":"","active":false}')$$, 'P0001', 'INVALID_COUPON', 'B cannot edit an A coupon');
select throws_ok($$select public.save_showcase_item(jsonb_build_object('id','40000000-0000-4000-8000-0000000000a1','name','Invadido','description','','unit','un','priceCents',1,'stock',99,'photoPath','','active',false,'sort',0,
  'updatedAt',(select to_jsonb(current_setting('test.a_updated')))))$$, 'P0001', 'ORDER_CONFLICT', 'B cannot edit an A showcase item');
select throws_ok($$select public.set_staff_access('00000000-0000-4000-8000-0000000000a2','production',false,false)$$, 'P0001', 'ACCESS_DENIED', 'B owner cannot change A staff');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b2');
select throws_ok($$select public.set_order_status('30000000-0000-4000-8000-0000000000a1','delivered',1)$$, 'P0001', 'ORDER_CONFLICT', 'B attendant cannot change A order status');
select throws_ok($$select public.resolve_order_request(current_setting('test.a_req')::uuid, 'converted')$$, 'P0001', 'ORDER_CONFLICT', 'B attendant cannot resolve an A request');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select lives_ok($$select public.set_staff_access('00000000-0000-4000-8000-0000000000a3','production',true,false)$$, 'A owner manages A staff');
select throws_ok($$select public.set_staff_access('00000000-0000-4000-8000-0000000000b2','owner',true,true)$$, 'P0001', 'ACCESS_DENIED', 'A owner cannot promote a B user');
select throws_ok($$select public.set_staff_access('00000000-0000-4000-8000-0000000000b1','attendant',false,false)$$, 'P0001', 'ACCESS_DENIED', 'A owner cannot deactivate the last B owner');
select throws_ok($$select public.save_order(pg_temp.ord('30000000-0000-4000-8000-0000000000b1','Invasor A','(47) 98000-0101'), 1)$$, 'P0001', 'ORDER_CONFLICT', 'A cannot update a B order');
reset role;

-- ---------- nothing of A changed, B counter intact ----------
select is((select revision from private.order_records where id = '30000000-0000-4000-8000-0000000000a1'), 1, 'A order revision unchanged');
select is((select payload ->> 'customer' || '/' || (payload ->> 'status') from private.order_records where id = '30000000-0000-4000-8000-0000000000a1'), 'Cliente A fictícia/confirmed', 'A order payload unchanged');
select is((select tenant_id from private.order_records where id = '30000000-0000-4000-8000-0000000000a1'), 'a0000000-0000-4000-8000-000000000001'::uuid, 'A order still belongs to Saint Cakes');
select is((select order_counter from private.tenants where slug = 'shop-b'), 2::bigint, 'failed cross-shop create did not burn a B number');
select is((select count(*)::int from private.order_audit where order_id = '30000000-0000-4000-8000-0000000000a1'), 1, 'A order audit unchanged');
select is((select count(*)::int from private.order_requests where tenant_id = 'a0000000-0000-4000-8000-000000000001' and status = 'new'), 2, 'A requests still new');
select is((select notes || '/' || marketing_opt_in::text from private.customers where tenant_id = 'a0000000-0000-4000-8000-000000000001' and phone_key = '47980000202'), '/false', 'A-only customer unchanged');
select is((select value || '/' || active::text from private.coupons where id = '50000000-0000-4000-8000-0000000000a1'), '10/true', 'A coupon unchanged');
select is((select name || '/' || stock::text || '/' || active::text from private.showcase_items where id = '40000000-0000-4000-8000-0000000000a1'), 'Bolo A fictício/5.000/true', 'A showcase item unchanged');
select is((select role || '/' || active::text from private.staff_members where user_id = '00000000-0000-4000-8000-0000000000a2'), 'attendant/true', 'A staff unchanged');
select is((select role || '/' || active::text from private.staff_members where user_id = '00000000-0000-4000-8000-0000000000b2'), 'attendant/true', 'B staff unchanged');
select is((select order_counter - current_setting('test.a_counter')::bigint from private.tenants where slug = 'saint-cakes'), 1::bigint, 'Saint Cakes counter advanced once');

-- ---------- storage policy helper ----------
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1');
select ok(private.can_edit_showcase_object(current_setting('test.b_id') || '/showcase/x.jpg'), 'B editor writes under its tenant folder');
select ok(not private.can_edit_showcase_object('a0000000-0000-4000-8000-000000000001/showcase/x.jpg'), 'B editor cannot write under the A tenant folder');
select ok(not private.can_edit_showcase_object('showcase/x.jpg'), 'legacy showcase path is not for shop-b');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b2');
select ok(private.can_edit_showcase_object(current_setting('test.b_id') || '/showcase/x.jpg'), 'B attendant with finance writes under its folder');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select ok(private.can_edit_showcase_object('a0000000-0000-4000-8000-000000000001/showcase/x.jpg'), 'A editor writes under its tenant folder');
select ok(private.can_edit_showcase_object('showcase/x.jpg'), 'legacy showcase path stays with Saint Cakes');
select ok(not private.can_edit_showcase_object(current_setting('test.b_id') || '/showcase/x.jpg'), 'A editor cannot write under the B folder');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a3');
select ok(not private.can_edit_showcase_object('a0000000-0000-4000-8000-000000000001/showcase/x.jpg'), 'production without finance cannot write photos');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select ok(not private.can_edit_showcase_object('showcase/x.jpg'), 'paused-shop owner has no legacy path');
select throws_ok('select * from private.tenants', '42501', 'permission denied for table tenants', 'authenticated cannot read tenants');
select throws_ok($$select private.create_tenant('x-shop','Loja X',gen_random_uuid(),'Dona')$$, '42501', null, 'authenticated create_tenant denied');
reset role;

-- ---------- submission rate limit is per shop ----------
insert into private.order_requests(tenant_id, payload, phone_digits)
  select current_setting('test.b_id')::uuid, '{}'::jsonb, '4798100' || lpad(g::text, 4, '0') from generate_series(1, 20) g;
set local role anon;
select throws_ok($$select public.submit_order_request('shop-b', pg_temp.request(jsonb_build_object('phone','(47) 98000-0399')))$$, 'P0001', 'REQUEST_LIMIT', 'shop-b submission limit reached');
select is(public.submit_order_request('saint-cakes', pg_temp.request(jsonb_build_object('phone','(47) 98000-0398'))) ->> 'received', 'true', 'Saint Cakes still accepts requests');
reset role;

select * from finish();
rollback;
