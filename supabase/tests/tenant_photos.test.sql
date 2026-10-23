-- Synthetic fixtures only. No Storage objects are created; every row is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

insert into private.tenants(id, slug, name)
values ('b0000000-0000-4000-8000-0000000000f1', 'tenant-photos-fixture-b', 'Loja B fictícia de fotos');

create function pg_temp.add_photo(p_tenant uuid, p_path text) returns uuid
language plpgsql as $$
declare item_id uuid;
begin
  insert into private.showcase_items(tenant_id, name, unit, price_cents, photo_path)
    values (p_tenant, 'Foto fictícia', 'un', 1000, p_path) returning id into item_id;
  return item_id;
end;
$$;

select ok(not has_function_privilege('anon', 'private.guard_showcase_photo_path()', 'EXECUTE'), 'anon cannot execute the photo trigger helper');
select ok(not has_function_privilege('authenticated', 'private.guard_showcase_photo_path()', 'EXECUTE'), 'authenticated cannot execute the photo trigger helper');
select ok(not (select prosecdef from pg_proc where oid = 'private.guard_showcase_photo_path()'::regprocedure), 'photo trigger does not require security definer');

select lives_ok($$select pg_temp.add_photo('a0000000-0000-4000-8000-000000000001', null)$$, 'Saint Cakes item may have no photo');
select lives_ok($$select pg_temp.add_photo('b0000000-0000-4000-8000-0000000000f1', null)$$, 'B item may have no photo');
select lives_ok($$select pg_temp.add_photo('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001/showcase/bolo-A_1.jpg')$$, 'Saint Cakes may reference its own JPG');
select lives_ok($$select pg_temp.add_photo('b0000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-0000000000f1/showcase/bolo-B_1.png')$$, 'B may reference its own PNG');
select lives_ok($$select pg_temp.add_photo('b0000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-0000000000f1/showcase/bolo-B_2.webp')$$, 'B may reference its own WebP');
select lives_ok($$select pg_temp.add_photo('a0000000-0000-4000-8000-000000000001', 'showcase/bolo-legado.jpg')$$, 'Saint Cakes keeps its legacy photo path');

select throws_ok($$select pg_temp.add_photo('b0000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-000000000001/showcase/bolo.jpg')$$,
  'P0001', 'INVALID_SHOWCASE', 'B cannot reference a Saint Cakes photo');
select throws_ok($$select pg_temp.add_photo('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-0000000000f1/showcase/bolo.jpg')$$,
  'P0001', 'INVALID_SHOWCASE', 'Saint Cakes cannot reference a B photo');
select throws_ok($$select pg_temp.add_photo('b0000000-0000-4000-8000-0000000000f1', 'showcase/bolo-legado.jpg')$$,
  'P0001', 'INVALID_SHOWCASE', 'B cannot use a legacy photo path');
select throws_ok($$select pg_temp.add_photo('b0000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-0000000000f1/showcase/../bolo.jpg')$$,
  'P0001', 'INVALID_SHOWCASE', 'parent-directory traversal is rejected');
select throws_ok($$select pg_temp.add_photo('b0000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-0000000000f1/showcase/./bolo.jpg')$$,
  'P0001', 'INVALID_SHOWCASE', 'current-directory segments are rejected');
select throws_ok($$select pg_temp.add_photo('b0000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-0000000000f1/showcase/sub/bolo.jpg')$$,
  'P0001', 'INVALID_SHOWCASE', 'nested photo folders are rejected');
select throws_ok($$select pg_temp.add_photo('a0000000-0000-4000-8000-000000000001', 'showcase/../bolo.jpg')$$,
  'P0001', 'INVALID_SHOWCASE', 'legacy paths also reject traversal');
select throws_ok($$select pg_temp.add_photo('b0000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-0000000000f1/showcase/.')$$,
  'P0001', 'INVALID_SHOWCASE', 'a dot is not a filename');
select throws_ok($$select pg_temp.add_photo('b0000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-0000000000f1/showcase/..')$$,
  'P0001', 'INVALID_SHOWCASE', 'two dots are not a filename');
select throws_ok($$select pg_temp.add_photo('b0000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-0000000000f1/showcase/bolo.svg')$$,
  'P0001', 'INVALID_SHOWCASE', 'only JPG PNG and WebP filenames are accepted');

insert into private.showcase_items(id, tenant_id, name, unit, price_cents, photo_path)
values ('40000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-0000000000f1',
  'Foto B para edição', 'un', 1000, 'b0000000-0000-4000-8000-0000000000f1/showcase/original.jpg');

select throws_ok($$update private.showcase_items set photo_path = 'a0000000-0000-4000-8000-000000000001/showcase/bolo.jpg'
  where id = '40000000-0000-4000-8000-0000000000f1'$$,
  'P0001', 'INVALID_SHOWCASE', 'updates cannot replace a B photo with an A photo');
select is((select photo_path from private.showcase_items where id = '40000000-0000-4000-8000-0000000000f1'),
  'b0000000-0000-4000-8000-0000000000f1/showcase/original.jpg', 'a rejected update preserves the original photo');
select throws_ok($$update private.showcase_items set tenant_id = 'a0000000-0000-4000-8000-000000000001'
  where id = '40000000-0000-4000-8000-0000000000f1'$$,
  'P0001', 'INVALID_SHOWCASE', 'changing tenant alone cannot retain a foreign photo');
select lives_ok($$update private.showcase_items set photo_path = 'b0000000-0000-4000-8000-0000000000f1/showcase/replacement.webp'
  where id = '40000000-0000-4000-8000-0000000000f1'$$, 'updates may replace a photo within the same shop');
select lives_ok($$update private.showcase_items set photo_path = null
  where id = '40000000-0000-4000-8000-0000000000f1'$$, 'updates may remove a photo');

select * from finish();
rollback;
