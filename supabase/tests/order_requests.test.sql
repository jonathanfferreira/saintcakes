-- Local, synthetic fixtures only. Every change is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-000000000011', 'owner@example.invalid'),
  ('00000000-0000-4000-8000-000000000012', 'attendant@example.invalid'),
  ('00000000-0000-4000-8000-000000000013', 'production@example.invalid'),
  ('00000000-0000-4000-8000-000000000014', 'limited@example.invalid'),
  ('00000000-0000-4000-8000-000000000015', 'outsider@example.invalid');
insert into private.staff_members(user_id, display_name, role, active, can_view_financial) values
  ('00000000-0000-4000-8000-000000000011','Dona fictícia','owner',true,true),
  ('00000000-0000-4000-8000-000000000012','Atendente fictícia','attendant',true,true),
  ('00000000-0000-4000-8000-000000000013','Produção fictícia','production',true,true),
  ('00000000-0000-4000-8000-000000000014','Atendente limitada','attendant',true,false);

create function pg_temp.request(changes jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('customer','Cliente fictícia','phone','(47) 90000-0001',
    'date', to_char((now() at time zone 'America/Sao_Paulo')::date + 2, 'YYYY-MM-DD'), 'time','15:00',
    'fulfillment','pickup','address','','notes','Sem lactose',
    'lines', jsonb_build_array(jsonb_build_object('description','Bolo fictício','quantity',1.5,'unit','kg','unitPriceCents',8900))) || changes;
$$;
create function pg_temp.as_user(id text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', id, true);
$$;
grant execute on function pg_temp.request(jsonb), pg_temp.as_user(text) to anon, authenticated;

select ok((select relrowsecurity from pg_class where oid = 'private.order_requests'::regclass), 'order_requests has RLS enabled');
select ok(not has_table_privilege('anon','private.order_requests','SELECT'), 'anon cannot read requests');
select ok(not has_table_privilege('anon','private.order_requests','INSERT'), 'anon cannot insert raw requests');
select ok(not has_table_privilege('anon','private.order_records','SELECT'), 'schema usage does not expose orders to anon');
select ok(has_function_privilege('anon','public.submit_order_request(jsonb)','EXECUTE'), 'anon may submit');
select ok(not has_function_privilege('anon','public.read_order_requests()','EXECUTE'), 'anon cannot list requests');
select ok(not has_function_privilege('anon','public.resolve_order_request(uuid,text)','EXECUTE'), 'anon cannot resolve requests');
select ok(not has_function_privilege('anon','public.save_order(jsonb,integer)','EXECUTE'), 'anon still cannot save orders');
select ok(not has_function_privilege('authenticated','private.require_order_editor()','EXECUTE'), 'internal helper stays private');
select ok((select bool_and(not prosecdef) from pg_proc where oid in ('public.submit_order_request(jsonb)'::regprocedure,
  'public.read_order_requests()'::regprocedure, 'public.resolve_order_request(uuid,text)'::regprocedure)), 'public endpoints are invokers');

set local role anon;
select is(public.submit_order_request(pg_temp.request()), '{"received": true}'::jsonb, 'anonymous visitor submits a valid request');
select is(public.submit_order_request(pg_temp.request(jsonb_build_object('phone','(47) 90000-0002',
  'date', to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD')))), '{"received": true}'::jsonb, 'same-day request accepted');
select throws_ok($$select public.submit_order_request(pg_temp.request(jsonb_build_object('date',
  to_char((now() at time zone 'America/Sao_Paulo')::date - 1, 'YYYY-MM-DD'))))$$, 'P0001', 'INVALID_REQUEST', 'past date rejected');
select throws_ok($$select public.submit_order_request(pg_temp.request(jsonb_build_object('date',
  to_char((now() at time zone 'America/Sao_Paulo')::date + 181, 'YYYY-MM-DD'))))$$, 'P0001', 'INVALID_REQUEST', 'date beyond horizon rejected');
select throws_ok($$select public.submit_order_request(pg_temp.request('{"phone":"9999-9999"}'))$$, 'P0001', 'INVALID_REQUEST', 'phone without area code rejected');
select throws_ok($$select public.submit_order_request(pg_temp.request('{"fulfillment":"delivery","address":"   "}'))$$, 'P0001', 'INVALID_REQUEST', 'blank delivery address rejected');
select throws_ok($$select public.submit_order_request(pg_temp.request('{"status":"confirmed"}'))$$, 'P0001', 'INVALID_REQUEST', 'unknown fields rejected');
select throws_ok($$select public.submit_order_request(pg_temp.request('{"customer":" A "}'))$$, 'P0001', 'INVALID_REQUEST', 'short name rejected');
select throws_ok($$select public.submit_order_request(pg_temp.request('{"lines":[]}'))$$, 'P0001', 'INVALID_REQUEST', 'empty lines rejected');
select throws_ok($$select public.submit_order_request(pg_temp.request(jsonb_build_object('lines',
  (select jsonb_agg(jsonb_build_object('description','x','quantity',1,'unit','un','unitPriceCents',1)) from generate_series(1,31)))))$$,
  'P0001', 'INVALID_REQUEST', 'more than 30 lines rejected');
select throws_ok($$select public.submit_order_request(pg_temp.request('{"lines":[{"id":"x","description":"x","quantity":1,"unit":"un","unitPriceCents":1}]}'))$$,
  'P0001', 'INVALID_REQUEST', 'client line ids rejected');
select throws_ok($$select public.submit_order_request(pg_temp.request('{"lines":[{"description":"x","quantity":1.5,"unit":"un","unitPriceCents":1}]}'))$$,
  'P0001', 'INVALID_REQUEST', 'fractional unit quantity rejected');
select throws_ok($$select public.submit_order_request(pg_temp.request('{"lines":[{"description":"x","quantity":1,"unit":"un","unitPriceCents":-1}]}'))$$,
  'P0001', 'INVALID_REQUEST', 'negative price rejected');
select throws_ok($$select public.submit_order_request('[]'::jsonb)$$, 'P0001', 'INVALID_REQUEST', 'non-object payload rejected');
select public.submit_order_request(pg_temp.request()) from generate_series(1,4);
select throws_ok($$select public.submit_order_request(pg_temp.request())$$, 'P0001', 'REQUEST_LIMIT', 'sixth request from one phone in a day is limited');
select throws_ok('select public.read_order_requests()', '42501', 'permission denied for function read_order_requests', 'anon cannot read the inbox');
reset role;

select is((select count(*)::int from private.order_requests), 6, 'only valid requests were stored');
select ok((select bool_and(jsonb_typeof(payload #> '{lines,0,id}') = 'string') from private.order_requests), 'server assigns line ids');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000015');
select throws_ok('select public.read_order_requests()', 'P0001', 'ACCESS_DENIED', 'non-member denied');
select pg_temp.as_user('00000000-0000-4000-8000-000000000013');
select throws_ok('select public.read_order_requests()', 'P0001', 'ACCESS_DENIED', 'production denied even with financial access');
select pg_temp.as_user('00000000-0000-4000-8000-000000000014');
select throws_ok('select public.read_order_requests()', 'P0001', 'ACCESS_DENIED', 'attendant without financial access denied');
select pg_temp.as_user('00000000-0000-4000-8000-000000000011');
select is(jsonb_array_length(public.read_order_requests()), 6, 'owner reads the inbox');
select pg_temp.as_user('00000000-0000-4000-8000-000000000012');
select is(jsonb_array_length(public.read_order_requests()), 6, 'attendant with financial access reads the inbox');
reset role;
create temp table target as select id from private.order_requests order by created_at limit 1;
grant select on target to authenticated;
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000013');
select throws_ok($$select public.resolve_order_request((select id from target), 'dismissed')$$, 'P0001', 'ACCESS_DENIED', 'production cannot resolve');
select pg_temp.as_user('00000000-0000-4000-8000-000000000012');
select throws_ok($$select public.resolve_order_request((select id from target), 'new')$$, 'P0001', 'INVALID_REQUEST', 'only converted or dismissed');
select lives_ok($$select public.resolve_order_request((select id from target), 'converted')$$, 'attendant converts a request');
select throws_ok($$select public.resolve_order_request((select id from target), 'dismissed')$$, 'P0001', 'ORDER_CONFLICT', 'a resolved request cannot be resolved again');
select is(jsonb_array_length(public.read_order_requests()), 5, 'resolved request leaves the inbox');
reset role;
select is((select resolved_by from private.order_requests where id = (select id from target)),
  '00000000-0000-4000-8000-000000000012'::uuid, 'resolver is recorded');

select * from finish();
rollback;
