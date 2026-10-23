-- Per-shop storefront and catalog. No direct API table access; every staff RPC
-- derives tenant ownership from the active membership. Public reads expose only
-- the selected active/trial shop. Legacy Saint submissions survive the rollout.
create table private.storefronts (
  tenant_id uuid primary key references private.tenants(id) on delete restrict,
  profile jsonb not null,
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid
);
alter table private.storefronts enable row level security;
revoke all on private.storefronts from public, anon, authenticated;

-- Only the first shop owns the bundled Saint assets. HTTPS images are public
-- resources supplied by each owner; credentials, controls and backslashes are disallowed.
create function private.valid_storefront_image(p_tenant uuid, p_url text) returns boolean
language sql immutable set search_path = '' as $$
  select p_url is not null and private.utf16_length(p_url) <= 1000 and (
    p_url = '' or (
      p_url ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#][^[:space:]<>"\\]*)?$'
      and p_url !~ '[[:cntrl:]]'
    ) or (p_tenant = 'a0000000-0000-4000-8000-000000000001'::uuid and p_url = any(array[
      '/brand/saint-cakes.png', '/products/hero-bolo.webp', '/products/bolo-prestigio.webp',
      '/products/bolo-sonho-de-valsa.webp', '/products/mini-folhado.webp',
      '/products/mini-hamburguer.webp', '/products/mini-pizza.webp', '/products/mini-sanduiche-pate.webp'
    ]))
  );
$$;

create function private.validate_storefront(p_tenant uuid, value jsonb) returns void
language plpgsql set search_path = '' as $$
declare item jsonb; field text; ids text[] := array[]::text[]; n numeric;
begin
  if value is null or jsonb_typeof(value) <> 'object' then raise exception 'invalid'; end if;
  if (select count(*) from jsonb_object_keys(value)) <> 8
    or not value ?& array['name','tagline','whatsapp','logoUrl','heroUrl','theme','catalog','revision'] then raise exception 'invalid'; end if;
  foreach field in array array['name','tagline','whatsapp','logoUrl','heroUrl','theme'] loop
    if jsonb_typeof(value -> field) <> 'string' then raise exception 'invalid'; end if;
  end loop;
  if private.utf16_length(btrim(value ->> 'name')) not between 1 and 100
    or private.utf16_length(value ->> 'name') > 100
    or private.utf16_length(value ->> 'tagline') > 180
    or (value ->> 'whatsapp' <> '' and value ->> 'whatsapp' !~ '^[0-9]{10,13}$')
    or value ->> 'theme' not in ('chocolate','forest','plum')
    or not private.valid_storefront_image(p_tenant, value ->> 'logoUrl')
    or not private.valid_storefront_image(p_tenant, value ->> 'heroUrl')
    or jsonb_typeof(value -> 'revision') <> 'number' then raise exception 'invalid'; end if;
  n := (value ->> 'revision')::numeric;
  if n <> trunc(n) or n not between 1 and 9007199254740991 then raise exception 'invalid'; end if;
  if jsonb_typeof(value -> 'catalog') <> 'array' or jsonb_array_length(value -> 'catalog') > 100 then raise exception 'invalid'; end if;
  for item in select * from jsonb_array_elements(value -> 'catalog') loop
    if jsonb_typeof(item) <> 'object' or not item ?& array['id','category','description','unit','unitPriceCents','page']
      or exists (select 1 from jsonb_object_keys(item) k where k not in ('id','category','description','unit','unitPriceCents','page','details','photo')) then raise exception 'invalid'; end if;
    foreach field in array array['id','category','description','unit'] loop
      if jsonb_typeof(item -> field) <> 'string' then raise exception 'invalid'; end if;
    end loop;
    if item ->> 'id' !~ '^[A-Za-z0-9_-]{1,80}$' or item ->> 'id' = any(ids)
      or private.utf16_length(btrim(item ->> 'category')) not between 1 and 80
      or private.utf16_length(item ->> 'category') > 80
      or private.utf16_length(btrim(item ->> 'description')) not between 1 and 180
      or private.utf16_length(item ->> 'description') > 180
      or item ->> 'unit' not in ('un','kg','cento') then raise exception 'invalid'; end if;
    ids := array_append(ids, item ->> 'id');
    if item ? 'details' and (jsonb_typeof(item -> 'details') <> 'string' or private.utf16_length(item ->> 'details') > 500) then raise exception 'invalid'; end if;
    if item ? 'photo' and (jsonb_typeof(item -> 'photo') <> 'string' or not private.valid_storefront_image(p_tenant, item ->> 'photo')) then raise exception 'invalid'; end if;
    if jsonb_typeof(item -> 'page') <> 'number' or jsonb_typeof(item -> 'unitPriceCents') <> 'number' then raise exception 'invalid'; end if;
    n := (item ->> 'page')::numeric;
    if n <> trunc(n) or n not between 0 and 1000 then raise exception 'invalid'; end if;
    n := (item ->> 'unitPriceCents')::numeric;
    if n <> trunc(n) or n not between 1 and 100000000 then raise exception 'invalid'; end if;
  end loop;
exception when others then
  raise exception using errcode = 'P0001', message = 'INVALID_STOREFRONT';
end;
$$;

create function private.initialize_storefront() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.storefronts(tenant_id, profile) values (new.id, jsonb_build_object(
    'name',new.name,'tagline','','whatsapp','','logoUrl','','heroUrl','','theme','chocolate','catalog','[]'::jsonb));
  return new;
end;
$$;
create trigger initialize_storefront after insert on private.tenants
for each row execute function private.initialize_storefront();
insert into private.storefronts(tenant_id, profile)
select id, jsonb_build_object('name',name,'tagline','','whatsapp','','logoUrl','','heroUrl','','theme','chocolate','catalog','[]'::jsonb)
from private.tenants;
update private.storefronts set profile = jsonb_build_object(
  'name','Saint Cakes',
  'tagline','Escolha bolos e salgados, diga quando e como quer receber. A equipe confirma tudo com você pelo WhatsApp.',
  'whatsapp','47991409940','logoUrl','/brand/saint-cakes.png','heroUrl','/products/hero-bolo.webp','theme','chocolate',
  'catalog',$catalog$[
  {
    "id": "party-0",
    "category": "Bolos · linha party",
    "description": "Bolo Sensação · linha party",
    "unit": "kg",
    "unitPriceCents": 8900,
    "page": 3,
    "details": "Brigadeiro meio amargo 50% cacau com morangos frescos e creme mineiro"
  },
  {
    "id": "party-1",
    "category": "Bolos · linha party",
    "description": "Bolo Sedução · linha party",
    "unit": "kg",
    "unitPriceCents": 8900,
    "page": 3,
    "details": "Creme de chocolate com morangos frescos"
  },
  {
    "id": "party-2",
    "category": "Bolos · linha party",
    "description": "Bolo Brigadeiro · linha party",
    "unit": "kg",
    "unitPriceCents": 8000,
    "page": 3,
    "details": "Brigadeiro meio amargo 50% cacau"
  },
  {
    "id": "party-3",
    "category": "Bolos · linha party",
    "description": "Bolo Mineira · linha party",
    "unit": "kg",
    "unitPriceCents": 8500,
    "page": 3,
    "details": "Brigadeiro branco com abacaxi, nata, coco queimado e decorado com coco fresco"
  },
  {
    "id": "party-4",
    "category": "Bolos · linha party",
    "description": "Bolo Sonho de valsa · linha party",
    "unit": "kg",
    "unitPriceCents": 8000,
    "page": 3,
    "details": "Recheio de chocolate meio amargo, creme de nata e sonho de valsa",
    "photo": "/products/bolo-sonho-de-valsa.webp"
  },
  {
    "id": "party-5",
    "category": "Bolos · linha party",
    "description": "Bolo Dois amores · linha party",
    "unit": "kg",
    "unitPriceCents": 8000,
    "page": 3,
    "details": "Duas camadas: brigadeiro meio amargo e brigadeiro branco"
  },
  {
    "id": "party-6",
    "category": "Bolos · linha party",
    "description": "Bolo Morango Branco · linha party",
    "unit": "kg",
    "unitPriceCents": 8900,
    "page": 3,
    "details": "Brigadeiro branco, nata, suspiro e morangos frescos"
  },
  {
    "id": "party-7",
    "category": "Bolos · linha party",
    "description": "Bolo Prestígio · linha party",
    "unit": "kg",
    "unitPriceCents": 8600,
    "page": 3,
    "details": "Recheio cremoso de coco e creme de chocolate 50% cacau",
    "photo": "/products/bolo-prestigio.webp"
  },
  {
    "id": "party-8",
    "category": "Bolos · linha party",
    "description": "Bolo Maracujá com chocolate · linha party",
    "unit": "kg",
    "unitPriceCents": 8800,
    "page": 3
  },
  {
    "id": "party-9",
    "category": "Bolos · linha party",
    "description": "Bolo Amor perfeito · linha party",
    "unit": "kg",
    "unitPriceCents": 8900,
    "page": 3,
    "details": "Brigadeiro meio amargo e morango com brigadeiro branco e sonho de valsa"
  },
  {
    "id": "party-10",
    "category": "Bolos · linha party",
    "description": "Bolo Marta rocha · linha party",
    "unit": "kg",
    "unitPriceCents": 9000,
    "page": 3,
    "details": "Geleia artesanal de damasco e ameixa com crocante de castanha e creme de nata"
  },
  {
    "id": "mini-0",
    "category": "Mini salgados diversos",
    "description": "Mini pão de queijo",
    "unit": "un",
    "unitPriceCents": 110,
    "page": 17
  },
  {
    "id": "mini-1",
    "category": "Mini salgados diversos",
    "description": "Mini hambúrguer",
    "unit": "un",
    "unitPriceCents": 350,
    "page": 17,
    "photo": "/products/mini-hamburguer.webp"
  },
  {
    "id": "mini-2",
    "category": "Mini salgados diversos",
    "description": "Mini cachorro-quente",
    "unit": "un",
    "unitPriceCents": 350,
    "page": 17
  },
  {
    "id": "mini-3",
    "category": "Mini salgados diversos",
    "description": "Mini sanduíche patê",
    "unit": "un",
    "unitPriceCents": 345,
    "page": 17,
    "photo": "/products/mini-sanduiche-pate.webp"
  },
  {
    "id": "mini-4",
    "category": "Mini salgados diversos",
    "description": "Mini pizza",
    "unit": "un",
    "unitPriceCents": 295,
    "page": 17,
    "photo": "/products/mini-pizza.webp"
  },
  {
    "id": "mini-5",
    "category": "Mini salgados diversos",
    "description": "Mini empada palmito",
    "unit": "un",
    "unitPriceCents": 380,
    "page": 17
  },
  {
    "id": "mini-6",
    "category": "Mini salgados diversos",
    "description": "Mini empada frango",
    "unit": "un",
    "unitPriceCents": 380,
    "page": 17
  },
  {
    "id": "mini-7",
    "category": "Mini salgados diversos",
    "description": "Mini folhado",
    "unit": "un",
    "unitPriceCents": 375,
    "page": 17,
    "photo": "/products/mini-folhado.webp"
  },
  {
    "id": "mini-8",
    "category": "Mini salgados diversos",
    "description": "Mini esfirra de carne",
    "unit": "un",
    "unitPriceCents": 280,
    "page": 17
  },
  {
    "id": "mini-9",
    "category": "Mini salgados diversos",
    "description": "Mini folhado chocolate",
    "unit": "un",
    "unitPriceCents": 360,
    "page": 17
  },
  {
    "id": "mini-10",
    "category": "Mini salgados diversos",
    "description": "Mini folhado ricota e bacon",
    "unit": "un",
    "unitPriceCents": 295,
    "page": 17
  },
  {
    "id": "mini-11",
    "category": "Mini salgados diversos",
    "description": "Mini folhado Romeu e Julieta",
    "unit": "un",
    "unitPriceCents": 295,
    "page": 17
  },
  {
    "id": "mini-12",
    "category": "Mini salgados diversos",
    "description": "Mini croissant",
    "unit": "un",
    "unitPriceCents": 495,
    "page": 17
  },
  {
    "id": "mini-13",
    "category": "Mini salgados diversos",
    "description": "Mini quiche alho-poró e bacon",
    "unit": "un",
    "unitPriceCents": 375,
    "page": 17
  },
  {
    "id": "mini-14",
    "category": "Mini salgados diversos",
    "description": "Mini quiche vegetais",
    "unit": "un",
    "unitPriceCents": 375,
    "page": 17
  }
]$catalog$::jsonb)
where tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid;

create function private.read_storefront() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff(); result jsonb;
begin
  select profile || jsonb_build_object('revision',revision) into result from private.storefronts where tenant_id = member.tenant_id;
  return result;
end;
$$;
create function private.save_storefront(p_storefront jsonb, p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_owner(); result jsonb;
begin
  perform private.validate_storefront(member.tenant_id, p_storefront);
  if p_expected_revision is null or p_expected_revision < 1
    or (p_storefront ->> 'revision')::numeric::bigint <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'STOREFRONT_CONFLICT';
  end if;
  update private.storefronts set profile = p_storefront - 'revision', revision = revision + 1,
    updated_at = clock_timestamp(), updated_by = member.user_id
    where tenant_id = member.tenant_id and revision = p_expected_revision and revision < 9007199254740991
    returning profile || jsonb_build_object('revision',revision) into result;
  if not found then raise exception using errcode = 'P0001', message = 'STOREFRONT_CONFLICT'; end if;
  return result;
end;
$$;
create function private.public_storefront(p_shop text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare tenant uuid := private.public_tenant(p_shop); result jsonb;
begin
  select profile || jsonb_build_object('revision',revision) into result from private.storefronts where tenant_id = tenant;
  return result;
end;
$$;

create function public.read_storefront() returns jsonb
language sql security invoker set search_path = '' as $$ select private.read_storefront(); $$;
create function public.save_storefront(p_storefront jsonb, p_expected_revision bigint) returns jsonb
language sql security invoker set search_path = '' as $$ select private.save_storefront(p_storefront,p_expected_revision); $$;
create function public.public_storefront(p_shop text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.public_storefront(p_shop); $$;

create or replace function private.submit_order_request(p_shop text, p_request jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  -- ECMAScript String.trim whitespace, as in validate_order.
  blank constant text := E' \t\n\r\f' || chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  tenant uuid := private.public_tenant(p_shop);
  value jsonb := p_request; item jsonb; field text; quantity numeric; price numeric;
  civil_date date; today date := (now() at time zone 'America/Sao_Paulo')::date;
  digits text; lines jsonb := '[]'::jsonb; key_count integer; quoted boolean := false;
  shop jsonb; zones jsonb; zone_name text := ''; zone jsonb; coupon_code text := ''; opt_in boolean := false;
  showcase_wanted jsonb := '[]'::jsonb; wanted jsonb; product private.showcase_items;
  storefront private.storefronts; catalog_item jsonb;
  subtotal numeric := 0; quote jsonb; created private.order_requests; extra_keys integer;
begin
  -- Shared row lock keeps pricing and the revision consistent until submission commits.
  -- Saves use UPDATE/CAS on this same row and wait for in-flight submissions.
  select * into storefront from private.storefronts where tenant_id = tenant for share;
  if p_request ? 'storefrontRevision' then
    begin
    if jsonb_typeof(p_request -> 'storefrontRevision') <> 'number'
      or (p_request ->> 'storefrontRevision')::numeric <> trunc((p_request ->> 'storefrontRevision')::numeric)
      or (p_request ->> 'storefrontRevision')::numeric not between 1 and 9007199254740991 then
      raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
    end if;
    exception when others then
      raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
    end;
    if (p_request ->> 'storefrontRevision')::numeric::bigint <> storefront.revision then
      raise exception using errcode = 'P0001', message = 'STOREFRONT_CONFLICT';
    end if;
  end if;
  select settings into shop from private.shop_settings where tenant_id = tenant;
  zones := coalesce(shop -> 'deliveryZones', '[]'::jsonb);
  begin
    if value is null or jsonb_typeof(value) <> 'object' then raise exception 'invalid'; end if;
    key_count := (select count(*) from jsonb_object_keys(value));
    extra_keys := (select count(*) from jsonb_object_keys(value) k where k in ('deliveryZone','couponCode','marketingOptIn','storefrontRevision'));
    if key_count <> 8 + extra_keys or not value ?&
      array['customer','phone','date','time','fulfillment','address','notes','lines'] then raise exception 'invalid'; end if;
    foreach field in array array['customer','phone','date','time','fulfillment','address','notes'] loop
      if jsonb_typeof(value -> field) <> 'string' then raise exception 'invalid'; end if;
    end loop;
    if value ? 'deliveryZone' then
      if jsonb_typeof(value -> 'deliveryZone') <> 'string' then raise exception 'invalid'; end if;
      zone_name := value ->> 'deliveryZone';
    end if;
    if value ? 'couponCode' then
      if jsonb_typeof(value -> 'couponCode') <> 'string' or private.utf16_length(value ->> 'couponCode') > 24 then raise exception 'invalid'; end if;
      coupon_code := upper(btrim(value ->> 'couponCode', blank));
    end if;
    if value ? 'marketingOptIn' then
      if jsonb_typeof(value -> 'marketingOptIn') <> 'boolean' then raise exception 'invalid'; end if;
      opt_in := (value ->> 'marketingOptIn')::boolean;
    end if;
    digits := regexp_replace(value ->> 'phone', '[^0-9]', '', 'g');
    if private.utf16_length(btrim(value ->> 'customer', blank)) not between 2 and 100
      or private.utf16_length(btrim(value ->> 'phone', blank)) > 30 or length(digits) not between 10 and 13
      or private.utf16_length(btrim(value ->> 'address', blank)) > 300
      or private.utf16_length(btrim(value ->> 'notes', blank)) > 1000
      or value ->> 'fulfillment' not in ('pickup','delivery')
      or (value ->> 'fulfillment' = 'delivery' and btrim(value ->> 'address', blank) = '')
      or value ->> 'time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or value ->> 'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid'; end if;
    civil_date := (value ->> 'date')::date;
    if to_char(civil_date, 'YYYY-MM-DD') <> value ->> 'date'
      or civil_date < today or civil_date > today + 180 then raise exception 'invalid'; end if;
    if jsonb_typeof(value -> 'lines') <> 'array' or jsonb_array_length(value -> 'lines') not between 1 and 30 then
      raise exception 'invalid';
    end if;
    for item in select * from jsonb_array_elements(value -> 'lines') loop
      if jsonb_typeof(item) <> 'object' then raise exception 'invalid'; end if;
      if item ? 'showcaseId' then
        -- Showcase lines carry only the item and the quantity; name, unit and price come from the shelf.
        if (select count(*) from jsonb_object_keys(item)) <> 2 or not item ? 'quantity'
          or jsonb_typeof(item -> 'showcaseId') <> 'string' or jsonb_typeof(item -> 'quantity') <> 'number' then raise exception 'invalid'; end if;
        perform (item ->> 'showcaseId')::uuid;
        showcase_wanted := showcase_wanted || jsonb_build_array(item);
        continue;
      end if;
      if item ? 'catalogItemId' then
        -- Canonical name, unit and cents come only from this shop's catalog.
        -- Optional copies sent by the UI are ignored, never trusted.
        if not item ? 'quantity' or jsonb_typeof(item -> 'catalogItemId') <> 'string'
          or exists (select 1 from jsonb_object_keys(item) k where k not in ('catalogItemId','quantity','description','unit','unitPriceCents')) then raise exception 'invalid'; end if;
        select c into catalog_item from jsonb_array_elements(storefront.profile -> 'catalog') c where c ->> 'id' = item ->> 'catalogItemId';
        if catalog_item is null then raise exception 'invalid'; end if;
        item := jsonb_build_object('description',catalog_item -> 'description','quantity',item -> 'quantity',
          'unit',catalog_item -> 'unit','unitPriceCents',catalog_item -> 'unitPriceCents');
      elsif tenant <> 'a0000000-0000-4000-8000-000000000001'::uuid or value ? 'storefrontRevision' then
        -- No paid legacy/custom line can bypass the catalog on another shop.
        -- The old published Saint app alone retains its temporary estimated-price contract.
        if jsonb_typeof(item -> 'unitPriceCents') <> 'number' or (item ->> 'unitPriceCents')::numeric <> 0 then raise exception 'invalid'; end if;
      end if;
      if (select count(*) from jsonb_object_keys(item)) <> 4
        or not item ?& array['description','quantity','unit','unitPriceCents']
        or jsonb_typeof(item -> 'description') <> 'string' or jsonb_typeof(item -> 'unit') <> 'string'
        or jsonb_typeof(item -> 'quantity') <> 'number' or jsonb_typeof(item -> 'unitPriceCents') <> 'number'
        or private.utf16_length(btrim(item ->> 'description', blank)) not between 1 and 180
        or item ->> 'unit' not in ('un','kg','cento') then raise exception 'invalid'; end if;
      quantity := (item ->> 'quantity')::numeric;
      price := (item ->> 'unitPriceCents')::numeric;
      if quantity <= 0 or quantity > 1000 or price < 0 or price > 100000000 or trunc(price) <> price
        or (item ->> 'unit' <> 'kg' and trunc(quantity) <> quantity)
        or (item ->> 'unit' = 'kg' and abs(quantity * 1000 - round(quantity * 1000)) > 0.0000001)
        then raise exception 'invalid'; end if;
      quoted := quoted or price = 0;
      subtotal := subtotal + floor((round(quantity * 1000) * price + 500) / 1000);
      if subtotal > 100000000 then raise exception 'invalid'; end if;
      lines := lines || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(),
        'description', btrim(item ->> 'description', blank), 'quantity', item -> 'quantity',
        'unit', item ->> 'unit', 'unitPriceCents', item -> 'unitPriceCents'));
    end loop;
    if quoted and civil_date < today + coalesce((shop ->> 'minLeadDays')::integer, 0) then raise exception 'invalid'; end if;
    if value ->> 'fulfillment' = 'delivery' and jsonb_array_length(zones) > 0 then
      select z into zone from jsonb_array_elements(zones) z where z ->> 'name' = zone_name;
      if zone is null then raise exception 'invalid'; end if;
    elsif zone_name <> '' then raise exception 'invalid';
    end if;
  exception when others then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end;
  -- Serialize this shop's submissions so its abuse limits, stock and coupon counters cannot be raced.
  perform private.lock_tenant_requests(tenant);
  if (select count(*) from private.order_requests where tenant_id = tenant and created_at > clock_timestamp() - interval '10 minutes') >= 20
    or (select count(*) from private.order_requests where tenant_id = tenant and phone_digits = digits and created_at > clock_timestamp() - interval '1 day') >= 5
    or (select count(*) from private.order_requests where tenant_id = tenant and status = 'new') >= 300 then
    raise exception using errcode = 'P0001', message = 'REQUEST_LIMIT';
  end if;
  -- Reserve showcase stock now; dismissing the request gives it back.
  for wanted in select * from jsonb_array_elements(showcase_wanted) loop
    select * into product from private.showcase_items
      where id = (wanted ->> 'showcaseId')::uuid and tenant_id = tenant and active for update;
    quantity := (wanted ->> 'quantity')::numeric;
    if not found or quantity <= 0 or quantity > product.stock
      or (product.unit <> 'kg' and trunc(quantity) <> quantity)
      or (product.unit = 'kg' and abs(quantity * 1000 - round(quantity * 1000)) > 0.0000001) then
      raise exception using errcode = 'P0001', message = 'SHOWCASE_STOCK';
    end if;
    update private.showcase_items set stock = stock - quantity, updated_at = clock_timestamp() where id = product.id and tenant_id = tenant;
    subtotal := subtotal + floor((round(quantity * 1000) * product.price_cents + 500) / 1000);
    lines := lines || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'description', 'Pronta entrega · ' || product.name,
      'quantity', quantity, 'unit', product.unit, 'unitPriceCents', product.price_cents, 'showcaseId', product.id));
  end loop;
  if subtotal > 100000000 then raise exception using errcode = 'P0001', message = 'INVALID_REQUEST'; end if;
  if jsonb_array_length(lines) > 30 then raise exception using errcode = 'P0001', message = 'INVALID_REQUEST'; end if;
  if coupon_code <> '' then quote := private.coupon_quote(tenant, coupon_code, private.phone_key(digits), subtotal::integer); end if;
  if value ->> 'fulfillment' = 'delivery' and zone is not null and (zone ->> 'feeCents')::integer > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(),
      'description', 'Frete · ' || (zone ->> 'name'), 'quantity', 1, 'unit', 'un', 'unitPriceCents', zone -> 'feeCents'));
  end if;
  if subtotal + coalesce((zone ->> 'feeCents')::integer, 0) > 100000000 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;
  insert into private.order_requests(tenant_id, payload, phone_digits) values (tenant, jsonb_build_object(
    'customer', btrim(value ->> 'customer', blank), 'phone', btrim(value ->> 'phone', blank),
    'date', value ->> 'date', 'time', value ->> 'time', 'fulfillment', value ->> 'fulfillment',
    'address', btrim(value ->> 'address', blank), 'notes', btrim(value ->> 'notes', blank), 'lines', lines,
    'couponCode', coalesce(quote ->> 'code', ''), 'discountCents', coalesce((quote ->> 'discountCents')::integer, 0)), digits)
    returning * into created;
  if quote is not null then
    insert into private.coupon_uses(coupon_id, phone_key, request_id, discount_cents)
      values ((quote ->> 'id')::uuid, private.phone_key(digits), created.id, (quote ->> 'discountCents')::integer);
    update private.coupons set uses = uses + 1 where id = (quote ->> 'id')::uuid and tenant_id = tenant;
  end if;
  perform private.touch_customer(tenant, value ->> 'customer', value ->> 'phone', 'site', opt_in);
  -- Return nothing identifying: anonymous callers cannot read requests back.
  return jsonb_build_object('received', true, 'discountCents', coalesce((quote ->> 'discountCents')::integer, 0));
end;
$$;

-- Explicit allowlists. Never grant helper execution or table access to API roles.
revoke execute on function private.valid_storefront_image(uuid,text), private.validate_storefront(uuid,jsonb),
  private.initialize_storefront() from public, anon, authenticated;
revoke execute on function private.read_storefront(), private.save_storefront(jsonb,bigint),
  public.read_storefront(), public.save_storefront(jsonb,bigint) from public, anon, authenticated;
grant execute on function private.read_storefront(), private.save_storefront(jsonb,bigint),
  public.read_storefront(), public.save_storefront(jsonb,bigint) to authenticated;
revoke execute on function private.public_storefront(text), public.public_storefront(text) from public, anon, authenticated;
grant execute on function private.public_storefront(text), public.public_storefront(text) to anon, authenticated;
