-- Local, synthetic fixtures only. Every change is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();
-- Start from an empty request table so limits and counts ignore earlier local data (rolled back).
delete from private.order_requests;

insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-000000000021', 'owner@example.invalid'),
  ('00000000-0000-4000-8000-000000000022', 'attendant@example.invalid'),
  ('00000000-0000-4000-8000-000000000023', 'production@example.invalid');
insert into private.staff_members(tenant_id, user_id, display_name, role, active, can_view_financial) values
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000021','Dona fictícia','owner',true,true),
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000022','Atendente fictícia','attendant',true,true),
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000023','Produção fictícia','production',true,false);

create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub', id, true); $$;
create function pg_temp.request(changes jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('customer','Cliente fictícia','phone','(47) 90000-2001',
    'date', to_char((now() at time zone 'America/Sao_Paulo')::date + 3, 'YYYY-MM-DD'), 'time','15:00',
    'fulfillment','pickup','address','','notes','',
    'lines', jsonb_build_array(jsonb_build_object('description','Bolo fictício','quantity',1,'unit','kg','unitPriceCents',8900))) || changes;
$$;
create function pg_temp.day(offset_days integer) returns text language sql as $$
  select to_char((now() at time zone 'America/Sao_Paulo')::date + offset_days, 'YYYY-MM-DD');
$$;
grant execute on function pg_temp.as_user(text), pg_temp.request(jsonb), pg_temp.day(integer) to anon, authenticated;

select ok((select relrowsecurity from pg_class where oid = 'private.shop_settings'::regclass), 'shop_settings has RLS enabled');
select ok(not has_table_privilege('anon','private.shop_settings','SELECT'), 'anon cannot read raw settings');
select ok(has_function_privilege('anon','public.public_settings()','EXECUTE'), 'anon may read public settings');
select ok(not has_function_privilege('anon','public.read_settings()','EXECUTE'), 'anon cannot read Pix settings');
select ok(not has_function_privilege('anon','public.save_settings(jsonb)','EXECUTE'), 'anon cannot save settings');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000022');
select throws_ok($$select public.save_settings('{"pixKey":"x","pixHolder":"","minLeadDays":2,"deliveryZones":[]}')$$, 'P0001', 'ACCESS_DENIED', 'attendant cannot save settings');
select is(public.read_settings() ->> 'minLeadDays', '2', 'attendant with financial access reads settings');
select pg_temp.as_user('00000000-0000-4000-8000-000000000023');
select throws_ok('select public.read_settings()', 'P0001', 'ACCESS_DENIED', 'production without financial access cannot read Pix');
select pg_temp.as_user('00000000-0000-4000-8000-000000000021');
select throws_ok($$select public.save_settings('{"pixKey":"","pixHolder":"","minLeadDays":31,"deliveryZones":[]}')$$, 'P0001', 'INVALID_SETTINGS', 'lead time above 30 rejected');
select throws_ok($$select public.save_settings('{"pixKey":"","pixHolder":"","minLeadDays":2,"deliveryZones":[{"name":"Centro","feeCents":1000},{"name":"centro","feeCents":500}]}')$$, 'P0001', 'INVALID_SETTINGS', 'duplicate zone names rejected');
select throws_ok($$select public.save_settings('{"pixKey":"","pixHolder":"","minLeadDays":2,"deliveryZones":[{"name":" Centro","feeCents":1000}]}')$$, 'P0001', 'INVALID_SETTINGS', 'untrimmed zone name rejected');
select throws_ok($$select public.save_settings('{"pixKey":"","pixHolder":"","minLeadDays":2,"deliveryZones":[{"name":"Centro","feeCents":-1}]}')$$, 'P0001', 'INVALID_SETTINGS', 'negative fee rejected');
select throws_ok($$select public.save_settings('{"pixKey":"","pixHolder":"","minLeadDays":2,"deliveryZones":[],"extra":1}')$$, 'P0001', 'INVALID_SETTINGS', 'unknown keys rejected');
select lives_ok($$select public.save_settings('{"pixKey":"chave-ficticia@example.invalid","pixHolder":"Loja fictícia","minLeadDays":2,"deliveryZones":[{"name":"Centro","feeCents":1000},{"name":"Retirada grátis","feeCents":0}]}')$$, 'owner saves settings');
reset role;
select is((select updated_by from private.shop_settings where tenant_id = 'a0000000-0000-4000-8000-000000000001'), '00000000-0000-4000-8000-000000000021'::uuid, 'editor recorded');

set local role anon;
select is(public.public_settings(), '{"minLeadDays": 2, "deliveryZones": [{"name": "Centro", "feeCents": 1000}, {"name": "Retirada grátis", "feeCents": 0}]}'::jsonb, 'public settings omit Pix details');
select lives_ok($$select public.submit_order_request(pg_temp.request())$$, 'request without deliveryZone still accepted');
select lives_ok($$select public.submit_order_request(pg_temp.request(jsonb_build_object('phone','(47) 90000-2002','fulfillment','delivery','address','Rua fictícia, 1','deliveryZone','Centro')))$$, 'delivery to a known zone accepted');
select throws_ok($$select public.submit_order_request(pg_temp.request('{"fulfillment":"delivery","address":"Rua fictícia, 1","deliveryZone":"Lua"}'))$$, 'P0001', 'INVALID_REQUEST', 'unknown zone rejected');
select throws_ok($$select public.submit_order_request(pg_temp.request('{"fulfillment":"delivery","address":"Rua fictícia, 1"}'))$$, 'P0001', 'INVALID_REQUEST', 'delivery without zone rejected once zones exist');
select throws_ok($$select public.submit_order_request(pg_temp.request('{"deliveryZone":"Centro"}'))$$, 'P0001', 'INVALID_REQUEST', 'zone on pickup rejected');
select throws_ok($$select public.submit_order_request(pg_temp.request(jsonb_build_object('date', pg_temp.day(1),
  'lines', '[{"description":"Personalizado","quantity":1,"unit":"un","unitPriceCents":0}]'::jsonb)))$$, 'P0001', 'INVALID_REQUEST', 'quoted item before minimum notice rejected');
select lives_ok($$select public.submit_order_request(pg_temp.request(jsonb_build_object('phone','(47) 90000-2003','date', pg_temp.day(2),
  'lines', '[{"description":"Personalizado","quantity":1,"unit":"un","unitPriceCents":0}]'::jsonb)))$$, 'quoted item at minimum notice accepted');
select lives_ok($$select public.submit_order_request(pg_temp.request(jsonb_build_object('phone','(47) 90000-2004','date', pg_temp.day(0))))$$, 'priced items same day accepted');
reset role;

select is((select (payload -> 'lines' -> 1) - 'id' from private.order_requests where phone_digits = '47900002002'),
  '{"description": "Frete · Centro", "quantity": 1, "unit": "un", "unitPriceCents": 1000}'::jsonb, 'server adds the fee line from the owner table');

select * from finish();
rollback;
