-- Local synthetic fixtures, all rolled back. Never run against production.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();
delete from private.coupon_uses;
delete from private.order_requests;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-00000000f101','storefront-a@example.invalid'),
 ('00000000-0000-4000-8000-00000000f102','storefront-production@example.invalid'),
 ('00000000-0000-4000-8000-00000000f103','storefront-attendant@example.invalid'),
 ('00000000-0000-4000-8000-00000000f104','storefront-inactive@example.invalid'),
 ('00000000-0000-4000-8000-00000000f201','storefront-b@example.invalid'),
 ('00000000-0000-4000-8000-00000000f301','storefront-paused@example.invalid');
insert into private.staff_members(tenant_id,user_id,display_name,role,active,can_view_financial) values
 ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-00000000f101','Dona A fictícia','owner',true,true),
 ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-00000000f102','Produção fictícia','production',true,false),
 ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-00000000f103','Atendimento fictício','attendant',true,true),
 ('a0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-00000000f104','Inativa fictícia','owner',false,true);
select private.create_tenant('storefront-fixture-b','Padaria B fictícia','00000000-0000-4000-8000-00000000f201','Dona B fictícia');
select private.create_tenant('storefront-paused','Loja pausada fictícia','00000000-0000-4000-8000-00000000f301','Dona pausada');
update private.tenants set status = 'paused' where slug = 'storefront-paused';
select set_config('test.storefront_b',(select id::text from private.tenants where slug='storefront-fixture-b'),true);
create function pg_temp.as_user(id text) returns void language sql as $$ select set_config('request.jwt.claim.sub',id,true); $$;
create function pg_temp.save(changes jsonb) returns jsonb language sql as $$
 select public.save_storefront(public.read_storefront() || changes,(public.read_storefront()->>'revision')::bigint);
$$;
create function pg_temp.save_item(changes jsonb) returns jsonb language sql as $$
 select pg_temp.save(jsonb_build_object('catalog',jsonb_build_array((public.read_storefront() #> '{catalog,0}') || changes)));
$$;
create function pg_temp.request(shop text, changes jsonb default '{}') returns jsonb language sql as $$
 select jsonb_build_object('customer','Pessoa fictícia','phone','47981000101',
  'date',to_char((now() at time zone 'America/Sao_Paulo')::date+3,'YYYY-MM-DD'),'time','14:30',
  'fulfillment','pickup','address','','notes','', 'storefrontRevision',public.public_storefront(shop)->'revision',
  'lines','[{"catalogItemId":"bread-b","quantity":2}]'::jsonb) || changes;
$$;
grant execute on function pg_temp.as_user(text),pg_temp.save(jsonb),pg_temp.save_item(jsonb),pg_temp.request(text,jsonb) to anon,authenticated;

select ok((select relrowsecurity from pg_class where oid='private.storefronts'::regclass),'storefront RLS enabled');
select is((select count(*)::integer from pg_policy where polrelid='private.storefronts'::regclass),0,'RLS has no permissive policies');
select ok(not has_table_privilege('anon','private.storefronts','SELECT'),'anon table privilege denied');
select ok(not has_table_privilege('authenticated','private.storefronts','UPDATE'),'authenticated table updates denied');
select ok(not has_function_privilege('anon','public.read_storefront()','EXECUTE'),'anon cannot read member endpoint');
select ok(not has_function_privilege('anon','private.save_storefront(jsonb,bigint)','EXECUTE'),'anon cannot call private save endpoint');
select ok(not has_function_privilege('authenticated','private.validate_storefront(uuid,jsonb)','EXECUTE'),'validator helper not executable');
select ok(not has_function_privilege('authenticated','private.valid_storefront_image(uuid,text)','EXECUTE'),'image helper not executable');
select ok(not has_function_privilege('anon','private.initialize_storefront()','EXECUTE'),'trigger helper not executable');
select ok(not (select prosecdef from pg_proc where oid='public.save_storefront(jsonb,bigint)'::regprocedure),'public save is invoker');
select ok(not (select prosecdef from pg_proc where oid='public.public_storefront(text)'::regprocedure),'public read is invoker');
-- Prove deny-all RLS even if a future grant accidentally exposes the table.
grant select on private.storefronts to anon,authenticated;
set local role anon;
select is((select count(*)::integer from private.storefronts),0,'RLS hides every storefront from anon');
reset role;
set local role authenticated;
select is((select count(*)::integer from private.storefronts),0,'RLS hides every storefront from authenticated');
reset role;
revoke select on private.storefronts from anon,authenticated;

set local role anon;
select is(public.public_storefront('saint-cakes')->>'name','Saint Cakes','Saint branding preserved');
select is(public.public_storefront('saint-cakes')->>'whatsapp','47991409940','Saint WhatsApp preserved');
select is(public.public_storefront('saint-cakes')->>'logoUrl','/brand/saint-cakes.png','Saint logo preserved');
select is(public.public_storefront('saint-cakes')->>'heroUrl','/products/hero-bolo.webp','Saint hero preserved');
select is(jsonb_array_length(public.public_storefront('saint-cakes')->'catalog'),26,'all 26 original products seeded');
select is(public.public_storefront('saint-cakes') #>> '{catalog,0,description}','Bolo Sensação · linha party','first catalog description preserved');
select is(public.public_storefront('saint-cakes') #>> '{catalog,4,photo}','/products/bolo-sonho-de-valsa.webp','original catalog photo preserved');
select is(public.public_storefront('saint-cakes') #>> '{catalog,25,unitPriceCents}','375','last price preserved');
select is(public.public_storefront('storefront-fixture-b'),' {"name":"Padaria B fictícia","tagline":"","whatsapp":"","logoUrl":"","heroUrl":"","theme":"chocolate","catalog":[],"revision":1}'::jsonb,'future tenant trigger creates empty independent storefront');
select throws_ok($$select public.public_storefront('missing-shop')$$,'P0001','SHOP_NOT_FOUND','unknown shop denied');
select throws_ok($$select public.public_storefront('storefront-paused')$$,'P0001','SHOP_NOT_FOUND','paused shop denied');
select throws_ok($$select public.read_storefront()$$,'42501',null,'anonymous member read denied');
reset role;

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000f102');
select is(public.read_storefront()->>'name','Saint Cakes','production reads its shop profile');
select throws_ok($$select pg_temp.save('{"name":"Forbidden"}')$$,'P0001','ACCESS_DENIED','production cannot edit profile');
select pg_temp.as_user('00000000-0000-4000-8000-00000000f103');
select throws_ok($$select pg_temp.save('{"name":"Forbidden"}')$$,'P0001','ACCESS_DENIED','attendant with finance cannot edit profile');
select pg_temp.as_user('00000000-0000-4000-8000-00000000f104');
select throws_ok($$select public.read_storefront()$$,'P0001','ACCESS_DENIED','inactive member cannot read');
select pg_temp.as_user('00000000-0000-4000-8000-00000000f201');
select is(public.read_storefront()->>'name','Padaria B fictícia','B owner reads only B profile');
select is(pg_temp.save('{"name":"Padaria B personalizada","theme":"forest","whatsapp":"47980000999","logoUrl":"https://example.invalid/logo.png","catalog":[{"id":"bread-b","category":"Pães","description":"Pão B","unit":"un","unitPriceCents":1600,"page":0,"details":"Fictício"}]}')->>'revision','2','owner saves its catalog and receives incremented revision');
select throws_ok($$select public.save_storefront(public.read_storefront(),1)$$,'P0001','STOREFRONT_CONFLICT','stale expected revision rejected');
select throws_ok($$select public.save_storefront(public.read_storefront(),null)$$,'P0001','STOREFRONT_CONFLICT','missing expected revision rejected');
select throws_ok($$select public.save_storefront(public.read_storefront() || '{"revision":1}',2)$$,'P0001','STOREFRONT_CONFLICT','payload revision cannot contradict expected revision');
select is(public.read_storefront()->>'revision','2','conflicts preserve saved revision');
select is(public.public_storefront('saint-cakes')->>'name','Saint Cakes','B edits never alter Saint');
select throws_ok($$select pg_temp.save('{"name": ""}')$$,'P0001','INVALID_STOREFRONT','empty name rejected');
select throws_ok($$select pg_temp.save('{"name": "   "}')$$,'P0001','INVALID_STOREFRONT','blank name rejected');
select throws_ok($$select pg_temp.save('{"name": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}')$$,'P0001','INVALID_STOREFRONT','long name rejected');
select throws_ok($$select pg_temp.save('{"name": null}')$$,'P0001','INVALID_STOREFRONT','null name rejected');
select throws_ok($$select pg_temp.save('{"tagline": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}')$$,'P0001','INVALID_STOREFRONT','long tagline rejected');
select throws_ok($$select pg_temp.save('{"whatsapp": "(47)991409940"}')$$,'P0001','INVALID_STOREFRONT','formatted contact rejected');
select throws_ok($$select pg_temp.save('{"whatsapp": "123"}')$$,'P0001','INVALID_STOREFRONT','short contact rejected');
select throws_ok($$select pg_temp.save('{"whatsapp": "11111111111111"}')$$,'P0001','INVALID_STOREFRONT','long contact rejected');
select throws_ok($$select pg_temp.save('{"theme": "pink"}')$$,'P0001','INVALID_STOREFRONT','unknown theme rejected');
select throws_ok($$select pg_temp.save('{"revision": 1.5}')$$,'P0001','INVALID_STOREFRONT','fractional revision rejected');
select throws_ok($$select pg_temp.save('{"revision": 0}')$$,'P0001','INVALID_STOREFRONT','zero revision rejected');
select throws_ok($$select pg_temp.save('{"revision": 9007199254740992}')$$,'P0001','INVALID_STOREFRONT','unsafe revision rejected');
select throws_ok($$select pg_temp.save('{"extra": 1}')$$,'P0001','INVALID_STOREFRONT','unknown profile field rejected');
select throws_ok($$select pg_temp.save('{"catalog": null}')$$,'P0001','INVALID_STOREFRONT','null catalog rejected');
select throws_ok($$select pg_temp.save('{"catalog": [{}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}]}')$$,'P0001','INVALID_STOREFRONT','catalog size limit rejected');
select throws_ok($$select pg_temp.save('{"logoUrl": "javascript:alert(1)"}')$$,'P0001','INVALID_STOREFRONT','unsafe or foreign logo ''javascript:alert(1)'' rejected');
select throws_ok($$select pg_temp.save('{"logoUrl": "data:image/png,a"}')$$,'P0001','INVALID_STOREFRONT','unsafe or foreign logo ''data:image/png,a'' rejected');
select throws_ok($$select pg_temp.save('{"logoUrl": "http://example.invalid/x"}')$$,'P0001','INVALID_STOREFRONT','unsafe or foreign logo ''http://example.invalid/x'' rejected');
select throws_ok($$select pg_temp.save('{"logoUrl": "//example.invalid/x"}')$$,'P0001','INVALID_STOREFRONT','unsafe or foreign logo ''//example.invalid/x'' rejected');
select throws_ok($$select pg_temp.save('{"logoUrl": "https://u:p@example.invalid/x"}')$$,'P0001','INVALID_STOREFRONT','unsafe or foreign logo ''https://u:p@example.invalid/x'' rejected');
select throws_ok($$select pg_temp.save('{"logoUrl": "https://example.invalid/a b"}')$$,'P0001','INVALID_STOREFRONT','unsafe or foreign logo ''https://example.invalid/a b'' rejected');
select throws_ok($$select pg_temp.save('{"logoUrl": "https://example.invalid/evil\\path"}')$$,'P0001','INVALID_STOREFRONT','unsafe or foreign logo ''https://example.invalid/evil\\path'' rejected');
select throws_ok($$select pg_temp.save('{"logoUrl": "https://example.invalid/\n"}')$$,'P0001','INVALID_STOREFRONT','unsafe or foreign logo ''https://example.invalid/\n'' rejected');
select throws_ok($$select pg_temp.save('{"logoUrl": "/brand/saint-cakes.png"}')$$,'P0001','INVALID_STOREFRONT','unsafe or foreign logo ''/brand/saint-cakes.png'' rejected');
select throws_ok($$select pg_temp.save('{"logoUrl": "/products/hero-bolo.webp"}')$$,'P0001','INVALID_STOREFRONT','unsafe or foreign logo ''/products/hero-bolo.webp'' rejected');
select throws_ok($$select pg_temp.save('{"heroUrl": "/products/hero-bolo.webp"}')$$,'P0001','INVALID_STOREFRONT','foreign hero rejected');
select throws_ok($$select pg_temp.save_item('{"id": "bad id"}')$$,'P0001','INVALID_STOREFRONT','invalid ID rejected');
select throws_ok($$select pg_temp.save_item('{"id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}')$$,'P0001','INVALID_STOREFRONT','long ID rejected');
select throws_ok($$select pg_temp.save_item('{"category": ""}')$$,'P0001','INVALID_STOREFRONT','empty category rejected');
select throws_ok($$select pg_temp.save_item('{"category": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}')$$,'P0001','INVALID_STOREFRONT','long category rejected');
select throws_ok($$select pg_temp.save_item('{"description": ""}')$$,'P0001','INVALID_STOREFRONT','empty description rejected');
select throws_ok($$select pg_temp.save_item('{"description": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}')$$,'P0001','INVALID_STOREFRONT','long description rejected');
select throws_ok($$select pg_temp.save_item('{"unit": "litre"}')$$,'P0001','INVALID_STOREFRONT','unknown unit rejected');
select throws_ok($$select pg_temp.save_item('{"unitPriceCents": 0}')$$,'P0001','INVALID_STOREFRONT','zero catalog price rejected');
select throws_ok($$select pg_temp.save_item('{"unitPriceCents": -1}')$$,'P0001','INVALID_STOREFRONT','negative catalog price rejected');
select throws_ok($$select pg_temp.save_item('{"unitPriceCents": 1.5}')$$,'P0001','INVALID_STOREFRONT','fractional cents rejected');
select throws_ok($$select pg_temp.save_item('{"unitPriceCents": 100000001}')$$,'P0001','INVALID_STOREFRONT','price above limit rejected');
select throws_ok($$select pg_temp.save_item('{"unitPriceCents": "1600"}')$$,'P0001','INVALID_STOREFRONT','string cents rejected');
select throws_ok($$select pg_temp.save_item('{"page": -1}')$$,'P0001','INVALID_STOREFRONT','negative source page rejected');
select throws_ok($$select pg_temp.save_item('{"page": 1001}')$$,'P0001','INVALID_STOREFRONT','page above limit rejected');
select throws_ok($$select pg_temp.save_item('{"page": 1.2}')$$,'P0001','INVALID_STOREFRONT','fractional page rejected');
select throws_ok($$select pg_temp.save_item('{"details": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}')$$,'P0001','INVALID_STOREFRONT','long details rejected');
select throws_ok($$select pg_temp.save_item('{"details": null}')$$,'P0001','INVALID_STOREFRONT','null details rejected');
select throws_ok($$select pg_temp.save_item('{"photo": "/products/mini-pizza.webp"}')$$,'P0001','INVALID_STOREFRONT','foreign Saint catalog photo rejected');
select throws_ok($$select pg_temp.save_item('{"photo": "javascript:bad"}')$$,'P0001','INVALID_STOREFRONT','unsafe catalog photo rejected');
select throws_ok($$select pg_temp.save_item('{"extra": 1}')$$,'P0001','INVALID_STOREFRONT','unknown catalog field rejected');
select throws_ok($$select pg_temp.save(jsonb_build_object('catalog',jsonb_build_array(public.read_storefront() #> '{catalog,0}',public.read_storefront() #> '{catalog,0}')))$$,'P0001','INVALID_STOREFRONT','duplicate stable catalog IDs rejected');
-- Missing keys require a complete payload, not the patch helper.
select throws_ok($$select public.save_storefront(public.read_storefront() - 'theme',2)$$,'P0001','INVALID_STOREFRONT','missing profile field rejected');
select throws_ok($$select pg_temp.save(jsonb_build_object('catalog',jsonb_build_array((public.read_storefront() #> '{catalog,0}') - 'page')))$$,'P0001','INVALID_STOREFRONT','missing catalog page rejected');
select is(public.read_storefront()->>'revision','2','validation failures never change revision');
reset role;

-- Exact numeric boundaries validate without changing a saved revision.
select lives_ok($$select private.validate_storefront(current_setting('test.storefront_b')::uuid,
 public.public_storefront('storefront-fixture-b') || jsonb_build_object('catalog',jsonb_build_array(
 (public.public_storefront('storefront-fixture-b') #> '{catalog,0}') || '{"unitPriceCents":100000000,"page":1000}'::jsonb)))$$,'maximum cents and source page accepted');
select lives_ok($$select private.validate_storefront(current_setting('test.storefront_b')::uuid,
 public.public_storefront('storefront-fixture-b') || jsonb_build_object('catalog',jsonb_build_array(
 (public.public_storefront('storefront-fixture-b') #> '{catalog,0}') || '{"unitPriceCents":1,"page":0,"unit":"cento"}'::jsonb)))$$,'minimum cents and source page plus cento unit accepted');

-- The request RPC trusts only canonical values, regardless of the caller role.
set local role anon;
select is(public.submit_order_request('storefront-fixture-b',pg_temp.request('storefront-fixture-b',
 '{"lines":[{"catalogItemId":"bread-b","quantity":2,"description":"FAKE CHEAP ITEM","unit":"kg","unitPriceCents":1}]}'))->>'received','true','client price/name/unit copies are replaced by catalog data');
select throws_ok($$select public.submit_order_request('storefront-fixture-b',pg_temp.request('storefront-fixture-b','{"storefrontRevision":1}'))$$,'P0001','STOREFRONT_CONFLICT','stale public storefront revision rejected');
select throws_ok($$select public.submit_order_request('storefront-fixture-b',pg_temp.request('storefront-fixture-b','{"storefrontRevision":0}'))$$,'P0001','INVALID_REQUEST','zero request revision rejected');
select throws_ok($$select public.submit_order_request('storefront-fixture-b',pg_temp.request('storefront-fixture-b','{"storefrontRevision":"oops"}'))$$,'P0001','INVALID_REQUEST','string request revision rejected');
select throws_ok($$select public.submit_order_request('storefront-fixture-b',pg_temp.request('storefront-fixture-b','{"storefrontRevision":2.5}'))$$,'P0001','INVALID_REQUEST','fractional request revision rejected');
select throws_ok($$select public.submit_order_request('storefront-fixture-b',pg_temp.request('storefront-fixture-b','{"lines":[{"catalogItemId":"bread-b","quantity":0}]}'))$$,'P0001','INVALID_REQUEST','zero catalog quantity rejected');
select throws_ok($$select public.submit_order_request('storefront-fixture-b',pg_temp.request('storefront-fixture-b','{"lines":[{"catalogItemId":"bread-b","quantity":1.5}]}'))$$,'P0001','INVALID_REQUEST','catalog quantity uses canonical unit validation');

select throws_ok($$select public.submit_order_request('storefront-fixture-b',pg_temp.request('storefront-fixture-b','{"lines":[{"catalogItemId":"party-0","quantity":1}]}'))$$,'P0001','INVALID_REQUEST','foreign catalog ID rejected');
select throws_ok($$select public.submit_order_request('storefront-fixture-b',pg_temp.request('storefront-fixture-b','{"lines":[{"catalogItemId":"deleted-id","quantity":1}]}'))$$,'P0001','INVALID_REQUEST','deleted or unknown catalog ID rejected');
select throws_ok($$select public.submit_order_request('storefront-fixture-b',pg_temp.request('storefront-fixture-b','{"lines":[{"description":"Fabricated","unit":"un","quantity":1,"unitPriceCents":1}]}') - 'storefrontRevision')$$,'P0001','INVALID_REQUEST','legacy contract cannot bypass B canonical prices');
select throws_ok($$select public.submit_order_request('storefront-fixture-b',pg_temp.request('storefront-fixture-b','{"lines":[{"description":"Fabricated","unit":"un","quantity":1,"unitPriceCents":1}]}'))$$,'P0001','INVALID_REQUEST','new contract cannot bypass B canonical prices');
select throws_ok($$select public.submit_order_request('saint-cakes',pg_temp.request('saint-cakes','{"lines":[{"description":"Fabricated","unit":"un","quantity":1,"unitPriceCents":1}]}'))$$,'P0001','INVALID_REQUEST','new Saint contract also requires catalog IDs');
select is(public.submit_order_request('storefront-fixture-b',pg_temp.request('storefront-fixture-b','{"phone":"47981000102","lines":[{"description":"Sob orçamento","unit":"un","quantity":1,"unitPriceCents":0}]}'))->>'received','true','custom quoted item remains zero');
select is(public.submit_order_request(pg_temp.request('saint-cakes','{"phone":"47981000103","lines":[{"description":"Saint legacy estimate","unit":"kg","quantity":1,"unitPriceCents":8900}]}') - 'storefrontRevision')->>'received','true','legacy no-shop Saint app remains compatible');
select is(public.submit_order_request('storefront-fixture-b',pg_temp.request('storefront-fixture-b','{"phone":"47981000104"}') - 'storefrontRevision')->>'received','true','catalog line without optional revision still derives canonical price');
reset role;
select is((select payload #>> '{lines,0,description}' from private.order_requests where phone_digits='47981000101'),'Pão B','persisted name is canonical B name');
select is((select payload #>> '{lines,0,unit}' from private.order_requests where phone_digits='47981000101'),'un','persisted unit is canonical');
select is((select payload #>> '{lines,0,unitPriceCents}' from private.order_requests where phone_digits='47981000101'),'1600','persisted cents are canonical');
select is((select tenant_id from private.order_requests where phone_digits='47981000101'),current_setting('test.storefront_b')::uuid,'request ownership is B');
select is((select payload #>> '{lines,0,unitPriceCents}' from private.order_requests where phone_digits='47981000102'),'0','custom quote has no payable fake price');

-- The same ID may exist in two catalogs; lookup still uses only the chosen tenant.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000f101');
select is(pg_temp.save(jsonb_build_object('catalog',(public.read_storefront()->'catalog') || '[{"id":"bread-b","category":"Teste","description":"Item A","unit":"kg","unitPriceCents":9900,"page":0}]'::jsonb))->>'revision','2','A owner may use same stable ID in its own catalog');
select is(public.submit_order_request('saint-cakes',pg_temp.request('saint-cakes','{"phone":"47981000105"}'))->>'received','true','authenticated caller submission still prices by public slug');
select pg_temp.as_user('00000000-0000-4000-8000-00000000f201');
select is(public.read_storefront() #>> '{catalog,0,unitPriceCents}','1600','A edit leaves B price untouched');
select is(pg_temp.save('{"catalog":[]}')->>'revision','3','owner can remove a product');
select throws_ok($$select public.submit_order_request('storefront-fixture-b',pg_temp.request('storefront-fixture-b'))$$,'P0001','INVALID_REQUEST','removed product ID is no longer purchasable');
select throws_ok($$select public.submit_order_request('storefront-fixture-b',pg_temp.request('storefront-fixture-b','{"storefrontRevision":2}'))$$,'P0001','STOREFRONT_CONFLICT','removal invalidates old storefront revision');
reset role;
select is((select payload #>> '{lines,0,unitPriceCents}' from private.order_requests where phone_digits='47981000105'),'9900','same ID on Saint receives A price');
select is((select payload #>> '{lines,0,unit}' from private.order_requests where phone_digits='47981000105'),'kg','same ID on Saint receives A unit');
select * from finish();
rollback;
