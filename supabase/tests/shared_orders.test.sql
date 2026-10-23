-- Local, synthetic fixtures only. Every change is rolled back, including temporary grants.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-000000000001', 'owner@example.invalid'),
  ('00000000-0000-4000-8000-000000000002', 'attendant@example.invalid'),
  ('00000000-0000-4000-8000-000000000003', 'production@example.invalid'),
  ('00000000-0000-4000-8000-000000000004', 'outsider@example.invalid'),
  ('00000000-0000-4000-8000-000000000005', 'revoked@example.invalid'),
  ('00000000-0000-4000-8000-000000000006', 'limited@example.invalid');
insert into private.staff_members(tenant_id, user_id, display_name, role, active, can_view_financial) values
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Dona fictícia','owner',true,true),
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','Atendente fictícia','attendant',true,true),
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','Produção fictícia','production',true,false),
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','Revogada fictícia','owner',false,true),
  ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000006','Atendente limitada','attendant',true,false);

create function pg_temp.order_fixture() returns jsonb language sql as $$
 select '{"id":"10000000-0000-4000-8000-000000000001","number":99999,
 "customer":"Cliente fictícia","phone":"","date":"2026-10-23","time":"14:30",
 "fulfillment":"pickup","address":"","notes":"Exemplo de teste",
 "lines":[{"id":"line-a","description":"Item fictício","quantity":1,"unit":"un","unitPriceCents":101}],
 "receivedCents":50,"status":"confirmed","createdAt":"2001-01-01T00:00:00.000Z"}'::jsonb;
$$;

select ok((select bool_and(relrowsecurity) from pg_class
  where oid in ('private.staff_members'::regclass,'private.order_records'::regclass,'private.order_audit'::regclass)),
  'all private tables have RLS enabled');
select ok(not has_table_privilege('authenticated','private.order_records','SELECT'), 'authenticated has no raw order read grant');
select ok(not has_table_privilege('authenticated','private.staff_members','UPDATE'), 'authenticated cannot edit membership tables');
select ok(not has_table_privilege('anon','private.order_records','SELECT'), 'anon has no raw read grant');
select ok(not has_function_privilege('anon','public.read_orders()','EXECUTE'), 'anon has no RPC execute grant');
select ok(not has_function_privilege('authenticated','private.validate_order(jsonb)','EXECUTE'), 'internal helper cannot be invoked by clients');
select ok((select bool_and(not prosecdef) from pg_proc where oid in
  ('public.current_staff()'::regprocedure,'public.read_orders()'::regprocedure,
   'public.save_order(jsonb,integer)'::regprocedure)), 'public endpoints are security invokers');

set local role anon;
select throws_ok('select public.read_orders()', '42501', 'permission denied for function read_orders', 'anonymous RPC denied');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","user_metadata":{"role":"owner","can_view_financial":true}}',true);
select throws_ok('select public.current_staff()', 'P0001','ACCESS_DENIED','outsider metadata cannot grant membership');
select throws_ok('select public.read_orders()', 'P0001','ACCESS_DENIED','outsider cannot read orders');
select throws_ok('select public.read_production_orders()', 'P0001','ACCESS_DENIED','outsider cannot read production');
select throws_ok('select public.save_order(pg_temp.order_fixture(),null)', 'P0001','ACCESS_DENIED','outsider cannot create orders');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',true);
select throws_ok('select public.current_staff()', 'P0001','ACCESS_DENIED','inactive membership overrides stale owner token');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select is(public.current_staff()->>'role','owner','owner membership read from database');
select is(public.current_staff()->>'canViewFinancial','true','owner can view finances');
select is((select count(*)::integer from jsonb_array_elements(public.list_staff()) as staff
  where staff->>'userId' in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006')),
  5,'owner sees provisioned fixture staff');
select throws_ok('select * from private.order_records', '42501','permission denied for table order_records','owner app identity has no raw table read');
select throws_ok('delete from private.order_records', '42501','permission denied for table order_records','no client deletion path');
select set_config('test.saved', public.save_order(pg_temp.order_fixture(),null)::text,true);
select is((current_setting('test.saved')::jsonb->>'revision')::integer,1,'create starts revision one');
select isnt(current_setting('test.saved')::jsonb#>>'{order,number}','99999','server replaces forged order number');
select isnt(current_setting('test.saved')::jsonb#>>'{order,createdAt}','2001-01-01T00:00:00.000Z','server replaces forged creation time');
select is((select count(*)::integer from jsonb_array_elements(public.read_orders()) as entry
  where entry#>>'{order,id}'='10000000-0000-4000-8000-000000000001'),1,'owner sees created fixture order');
select is(jsonb_array_length(public.read_audit('10000000-0000-4000-8000-000000000001')),1,'create appends audit in same transaction');
select throws_ok('select public.save_order(pg_temp.order_fixture(),null)', 'P0001','ORDER_CONFLICT','repeated create never silently overwrites');
select throws_ok($q$select public.save_order(jsonb_set(current_setting('test.saved')::jsonb->'order','{number}','99999'),1)$q$,
  'P0001','INVALID_ORDER','existing order number immutable');
select throws_ok($q$select public.save_order(jsonb_set(current_setting('test.saved')::jsonb->'order','{createdAt}','"2000-01-01T00:00:00.000Z"'),1)$q$,
  'P0001','INVALID_ORDER','existing creation time immutable');
select throws_ok($q$select public.save_order(jsonb_set(pg_temp.order_fixture(),'{receivedCents}','102'),null)$q$,
  'P0001','INVALID_ORDER','received amount cannot exceed calculated total');
select throws_ok($q$select public.save_order(jsonb_set(pg_temp.order_fixture(),'{lines,0,unitPriceCents}','-1'),null)$q$,
  'P0001','INVALID_ORDER','negative cents rejected');
select throws_ok($q$select public.save_order(jsonb_set(pg_temp.order_fixture(),'{lines,0,unitPriceCents}','1.5'),null)$q$,
  'P0001','INVALID_ORDER','fractional cents rejected');
select throws_ok($q$select public.save_order(jsonb_set(pg_temp.order_fixture(),'{lines,0,quantity}','1.5'),null)$q$,
  'P0001','INVALID_ORDER','fractional unit quantity rejected');
select throws_ok($q$select public.save_order(jsonb_set(pg_temp.order_fixture(),'{lines,0,id}','""'),null)$q$,
  'P0001','INVALID_ORDER','empty line identifier rejected');
select throws_ok($q$select public.save_order(jsonb_set(pg_temp.order_fixture(),'{lines,0,description}','""'),null)$q$,
  'P0001','INVALID_ORDER','empty line description rejected');
select throws_ok($q$select public.save_order(jsonb_set(pg_temp.order_fixture(),'{lines}',(pg_temp.order_fixture()->'lines')||(pg_temp.order_fixture()->'lines')),null)$q$,
  'P0001','INVALID_ORDER','duplicate line identifiers rejected');
select throws_ok($q$select public.save_order(jsonb_set(pg_temp.order_fixture(),'{date}','"2026-02-30"'),null)$q$,
  'P0001','INVALID_ORDER','invalid civil date rejected');
select throws_ok($q$select public.save_order(jsonb_set(pg_temp.order_fixture(),'{date}','"0000-01-01"'),null)$q$,
  'P0001','INVALID_ORDER','year zero explicitly unsupported');
select throws_ok($q$select public.save_order(pg_temp.order_fixture() ||
  jsonb_build_object('fulfillment','delivery','address',E' \t\n\r\f'||chr(11)),null)$q$,
  'P0001','INVALID_ORDER','delivery address containing only ASCII whitespace rejected');
select throws_ok($q$select public.save_order(pg_temp.order_fixture() ||
  jsonb_build_object('fulfillment','delivery','address',U&'\00A0\2003\FEFF'),null)$q$,
  'P0001','INVALID_ORDER','delivery address containing only Unicode whitespace rejected');
select throws_ok($q$select public.save_order(pg_temp.order_fixture()||'{"totalCents":1}'::jsonb,null)$q$,
  'P0001','INVALID_ORDER','forged calculated total field rejected');
select throws_ok($q$select public.set_staff_access('00000000-0000-4000-8000-000000000001','production',false,false)$q$,
  'P0001','ACCESS_DENIED','owner cannot revoke own account or demote last owner');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select is((select count(*)::integer from jsonb_array_elements(public.read_orders()) as entry
  where entry#>>'{order,id}'='10000000-0000-4000-8000-000000000001'),1,'financial attendant sees fixture order');
select throws_ok('select public.list_staff()', 'P0001','ACCESS_DENIED','attendant cannot list access management');
select throws_ok($q$select public.set_staff_access('00000000-0000-4000-8000-000000000003','owner',true,true)$q$,
  'P0001','ACCESS_DENIED','attendant cannot promote a user');
select set_config('test.saved',public.save_order(jsonb_set(current_setting('test.saved')::jsonb->'order','{receivedCents}','101'),1)::text,true);
select is((current_setting('test.saved')::jsonb->>'revision')::integer,2,'financial attendant can annotate received money');
select throws_ok($q$select public.save_order(current_setting('test.saved')::jsonb->'order',1)$q$,
  'P0001','ORDER_CONFLICT','competing editor using stale revision cannot overwrite money');
select is((select entry#>>'{order,receivedCents}' from jsonb_array_elements(public.read_orders()) as entry
  where entry#>>'{order,id}'='10000000-0000-4000-8000-000000000001'),'101','stale write preserves newer fixture data');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select throws_ok('select public.read_orders()', 'P0001','ACCESS_DENIED','nonfinancial production cannot fetch full orders');
select throws_ok($q$select public.read_audit('10000000-0000-4000-8000-000000000001')$q$,
  'P0001','ACCESS_DENIED','nonfinancial production cannot fetch audit');
select is((select count(*)::integer from jsonb_array_elements(public.read_production_orders()) as entry
  where entry#>>'{order,id}'='10000000-0000-4000-8000-000000000001'),1,'production sees shared operational fixture order');
select ok(not jsonb_path_exists(public.read_production_orders(),'$[*].order.lines[*].unitPriceCents'), 'lean lines omit prices');
select ok(exists(select 1 from jsonb_array_elements(public.read_production_orders()) as entry
  where entry#>>'{order,id}'='10000000-0000-4000-8000-000000000001'
    and not (entry->'order') ?| array['receivedCents','phone','address','createdAt']),
  'lean orders omit financial and unnecessary contact fields');
select throws_ok($q$select public.save_order(current_setting('test.saved')::jsonb->'order',2)$q$,
  'P0001','ACCESS_DENIED','production cannot forge payment via save');
select throws_ok($q$select public.set_order_status('10000000-0000-4000-8000-000000000001','cancelled',2)$q$,
  'P0001','ACCESS_DENIED','production cannot cancel');
select throws_ok($q$select public.set_order_status('10000000-0000-4000-8000-000000000001','ready',2)$q$,
  'P0001','ACCESS_DENIED','production cannot skip preparation');
select set_config('test.production',public.set_order_status('10000000-0000-4000-8000-000000000001','preparing',2)::text,true);
select is(current_setting('test.production')::jsonb#>>'{order,status}','preparing','production advances confirmed to preparing');
select ok(not (current_setting('test.production')::jsonb->'order') ? 'receivedCents','status mutation response also omits finance');
select set_config('test.production',public.set_order_status('10000000-0000-4000-8000-000000000001','ready',3)::text,true);
select is(current_setting('test.production')::jsonb#>>'{order,status}','ready','production advances preparing to ready');
select throws_ok($q$select public.set_order_status('10000000-0000-4000-8000-000000000001','delivered',4)$q$,
  'P0001','ACCESS_DENIED','production cannot mark delivery');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000006',true);
select throws_ok('select public.read_orders()', 'P0001','ACCESS_DENIED','nonfinancial attendant cannot read full orders');
select throws_ok($q$select public.save_order(current_setting('test.saved')::jsonb->'order',4)$q$,
  'P0001','ACCESS_DENIED','nonfinancial attendant cannot save money');
select throws_ok($q$select public.set_order_status('10000000-0000-4000-8000-000000000001','delivered',4)$q$,
  'P0001','ACCESS_DENIED','nonfinancial attendant has production transition limits');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select is(public.set_staff_access('00000000-0000-4000-8000-000000000003','production',true,true)->>'canViewFinancial',
  'true','owner can grant individual financial visibility');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select is((select count(*)::integer from jsonb_array_elements(public.read_orders()) as entry
  where entry#>>'{order,id}'='10000000-0000-4000-8000-000000000001'),1,'production granted financial visibility can read full fixture order');
select throws_ok($q$select public.save_order(current_setting('test.saved')::jsonb->'order',4)$q$,
  'P0001','ACCESS_DENIED','financial visibility does not give production edit permission');
select throws_ok($q$select public.set_order_status('10000000-0000-4000-8000-000000000001','delivered',4)$q$,
  'P0001','ACCESS_DENIED','financial visibility does not relax production status limits');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.set_staff_access('00000000-0000-4000-8000-000000000003','production',false,false);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select throws_ok('select public.read_production_orders()','P0001','ACCESS_DENIED','membership revocation effective on next RPC without token refresh');

reset role;
-- Verify RLS itself, separately from the revoked privileges, using temporary grants.
grant select on private.order_records,private.staff_members,private.order_audit to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from private.order_records),0,'RLS denies raw orders even after accidental SELECT grant');
select is((select count(*)::integer from private.staff_members),0,'RLS denies raw memberships even after accidental SELECT grant');
select is((select count(*)::integer from private.order_audit),0,'RLS denies raw audit even after accidental SELECT grant');
select is(jsonb_array_length(public.read_audit('10000000-0000-4000-8000-000000000001')),4,
  'only accepted revisions create append-only audit records');
select lives_ok($q$select public.save_order(pg_temp.order_fixture() ||
  '{"id":"10000000-0000-4000-8000-000000000002","receivedCents":1,
  "lines":[{"id":"kg-half","description":"Meio centavo","quantity":0.001,"unit":"kg","unitPriceCents":500}]}'::jsonb,null)$q$,
  'half-cent kilogram line rounds upward to one cent');
select throws_ok($q$select public.save_order(pg_temp.order_fixture() ||
  '{"id":"10000000-0000-4000-8000-000000000003","receivedCents":0,
  "lines":[{"id":"kg-zero","description":"Arredonda zero","quantity":0.001,"unit":"kg","unitPriceCents":499}]}'::jsonb,null)$q$,
  'P0001','INVALID_ORDER','rounded zero total rejected');
select lives_ok($q$select public.save_order(pg_temp.order_fixture() ||
  '{"id":"10000000-0000-4000-8000-000000000004","receivedCents":100000000,
  "lines":[{"id":"max","description":"Limite exato","quantity":10000,"unit":"un","unitPriceCents":10000}]}'::jsonb,null)$q$,
  'exact order and quantity limits accepted');
select throws_ok($q$select public.save_order(jsonb_set(pg_temp.order_fixture(),'{lines,0,unitPriceCents}','100000001'),null)$q$,
  'P0001','INVALID_ORDER','one cent over price limit rejected');
select throws_ok($q$select public.save_order(jsonb_set(pg_temp.order_fixture(),'{lines,0,quantity}','10001'),null)$q$,
  'P0001','INVALID_ORDER','one unit over quantity limit rejected');
select throws_ok($q$select public.save_order(pg_temp.order_fixture() ||
  '{"lines":[{"id":"kg-precision","description":"Casas extras","quantity":1.0001,"unit":"kg","unitPriceCents":100}]}'::jsonb,null)$q$,
  'P0001','INVALID_ORDER','kilograms beyond three decimal places rejected');
select throws_ok($q$select public.save_order(jsonb_set(pg_temp.order_fixture(),'{date}','"2027-02-29"'),null)$q$,
  'P0001','INVALID_ORDER','nonleap February date rejected');
select lives_ok($q$select public.save_order(pg_temp.order_fixture() ||
  '{"id":"10000000-0000-4000-8000-000000000005","date":"2028-02-29"}'::jsonb,null)$q$,
  'actual leap February date accepted');
reset role;
select throws_ok($q$update private.order_audit set action='updated'$q$,'55000','AUDIT_APPEND_ONLY','audit cannot be rewritten');
select throws_ok($q$delete from private.order_audit$q$,'55000','AUDIT_APPEND_ONLY','audit cannot be deleted');
select * from finish();
rollback;
