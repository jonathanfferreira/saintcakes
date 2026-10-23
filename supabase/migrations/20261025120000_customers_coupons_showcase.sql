-- Customer central, coupons and the ready-to-go showcase, all configured by the team in the app.
-- Customers are keyed by a normalised WhatsApp number; marketing needs an explicit opt-in.

create function private.phone_key(value text) returns text
language sql immutable set search_path = '' as $$
  -- Digits only, Brazil country code dropped, so "(47) 9…" and "+55 47 9…" are one customer.
  select case when length(d) in (12, 13) and left(d, 2) = '55' then substr(d, 3) else d end
  from (select regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g') as d) digits;
$$;

create table private.customers (
  phone_key text primary key check (phone_key ~ '^[0-9]{10,11}$'),
  name text not null check (length(btrim(name)) between 1 and 100),
  phone text not null check (length(phone) <= 30),
  source text not null check (source in ('site', 'equipe')),
  marketing_opt_in boolean not null default false,
  opt_in_at timestamptz,
  opt_in_source text check (opt_in_source in ('site', 'equipe')),
  notes text not null default '' check (length(notes) <= 1000),
  first_seen timestamptz not null default clock_timestamp(),
  last_seen timestamptz not null default clock_timestamp()
);

create table private.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,24}$'),
  description text not null default '' check (length(description) <= 140),
  kind text not null check (kind in ('percent', 'fixed')),
  value integer not null check (value > 0 and value <= 10000000),
  first_order_only boolean not null default false,
  min_order_cents integer not null default 0 check (min_order_cents between 0 and 100000000),
  starts_on date,
  ends_on date,
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0 check (uses >= 0),
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (kind <> 'percent' or value <= 90),
  check (starts_on is null or ends_on is null or starts_on <= ends_on)
);

create table private.coupon_uses (
  id bigint generated always as identity primary key,
  coupon_id uuid not null references private.coupons(id) on delete restrict,
  phone_key text not null,
  request_id uuid references private.order_requests(id) on delete restrict,
  discount_cents integer not null check (discount_cents > 0),
  released boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create index coupon_uses_coupon_idx on private.coupon_uses(coupon_id);

create table private.showcase_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80),
  description text not null default '' check (length(description) <= 300),
  unit text not null check (unit in ('un', 'kg', 'cento')),
  price_cents integer not null check (price_cents between 1 and 10000000),
  stock numeric(9, 3) not null default 0 check (stock >= 0 and stock <= 10000),
  photo_path text check (photo_path is null or photo_path ~ '^[A-Za-z0-9/_.-]{1,200}$'),
  active boolean not null default true,
  sort integer not null default 0,
  updated_at timestamptz not null default clock_timestamp()
);

alter table private.customers enable row level security;
alter table private.coupons enable row level security;
alter table private.coupon_uses enable row level security;
alter table private.showcase_items enable row level security;
revoke all on private.customers, private.coupons, private.coupon_uses, private.showcase_items from public, anon, authenticated;

-- ---------- helpers ----------
create function private.touch_customer(p_name text, p_phone text, p_source text, p_opt_in boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare k text := private.phone_key(p_phone);
begin
  if k !~ '^[0-9]{10,11}$' or length(btrim(coalesce(p_name, ''))) < 1 then return; end if;
  insert into private.customers(phone_key, name, phone, source, marketing_opt_in, opt_in_at, opt_in_source)
    values (k, left(btrim(p_name), 100), left(btrim(p_phone), 30), p_source, coalesce(p_opt_in, false),
      case when p_opt_in then clock_timestamp() end, case when p_opt_in then p_source end)
  on conflict (phone_key) do update set name = excluded.name, phone = excluded.phone, last_seen = clock_timestamp(),
    -- A yes is recorded; a missing answer never withdraws an earlier consent.
    marketing_opt_in = private.customers.marketing_opt_in or coalesce(p_opt_in, false),
    opt_in_at = case when not private.customers.marketing_opt_in and p_opt_in then clock_timestamp() else private.customers.opt_in_at end,
    opt_in_source = case when not private.customers.marketing_opt_in and p_opt_in then p_source else private.customers.opt_in_source end;
end;
$$;

create function private.is_first_order(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from private.order_records where private.phone_key(payload ->> 'phone') = p_key)
     and not exists (select 1 from private.order_requests where private.phone_key(phone_digits) = p_key and status <> 'dismissed');
$$;

/** Discount for a code, or a COUPON_* error the page can explain. Locks the coupon row. */
create function private.coupon_quote(p_code text, p_key text, p_subtotal integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c private.coupons; today date := (now() at time zone 'America/Sao_Paulo')::date; discount integer;
begin
  select * into c from private.coupons where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or not c.active then raise exception using errcode = 'P0001', message = 'COUPON_NOT_FOUND'; end if;
  if (c.starts_on is not null and today < c.starts_on) or (c.ends_on is not null and today > c.ends_on) then
    raise exception using errcode = 'P0001', message = 'COUPON_EXPIRED'; end if;
  if c.max_uses is not null and c.uses >= c.max_uses then raise exception using errcode = 'P0001', message = 'COUPON_EXHAUSTED'; end if;
  if c.first_order_only and not private.is_first_order(p_key) then raise exception using errcode = 'P0001', message = 'COUPON_FIRST_ORDER'; end if;
  if p_subtotal < greatest(c.min_order_cents, 1) then raise exception using errcode = 'P0001', message = 'COUPON_MIN_ORDER'; end if;
  discount := case when c.kind = 'percent' then floor(p_subtotal::numeric * c.value / 100)::integer else c.value end;
  -- A coupon never makes an order free.
  if discount >= p_subtotal then raise exception using errcode = 'P0001', message = 'COUPON_MIN_ORDER'; end if;
  return jsonb_build_object('id', c.id, 'code', c.code, 'description', c.description, 'discountCents', discount);
end;
$$;

create function private.require_owner() returns private.staff_members
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff();
begin
  if member.role <> 'owner' then raise exception using errcode = 'P0001', message = 'ACCESS_DENIED'; end if;
  return member;
end;
$$;

-- ---------- orders accept a discount ----------
create or replace function private.validate_order(value jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  item jsonb; field text; quantity numeric; price numeric; total numeric := 0;
  received numeric; ids text[] := '{}'; item_id text; civil_date date; key_count integer; discount numeric := 0;
begin
  if value is null or jsonb_typeof(value) <> 'object' then raise exception 'invalid'; end if;
  key_count := (select count(*) from jsonb_object_keys(value));
  -- Orders saved before coupons have 13 keys; newer ones add discountCents and couponCode together.
  if not (key_count = 13 or (key_count = 15 and value ?& array['discountCents','couponCode'])) or not value ?&
    array['id','number','customer','phone','date','time','fulfillment','address','notes','lines',
          'receivedCents','status','createdAt'] then raise exception 'invalid'; end if;
  foreach field in array array['id','customer','phone','date','time','fulfillment','address','notes','status','createdAt'] loop
    if jsonb_typeof(value -> field) <> 'string' then raise exception 'invalid'; end if;
  end loop;
  if key_count = 15 then
    if jsonb_typeof(value -> 'discountCents') <> 'number' or jsonb_typeof(value -> 'couponCode') <> 'string'
      or private.utf16_length(value ->> 'couponCode') > 24 then raise exception 'invalid'; end if;
    discount := (value ->> 'discountCents')::numeric;
    if discount < 0 or trunc(discount) <> discount then raise exception 'invalid'; end if;
  end if;
  perform (value ->> 'id')::uuid;
  if jsonb_typeof(value -> 'number') <> 'number' or (value ->> 'number')::numeric < 1
    or (value ->> 'number')::numeric > 9007199254740991
    or trunc((value ->> 'number')::numeric) <> (value ->> 'number')::numeric
    or private.utf16_length(value ->> 'customer') not between 2 and 100
    or private.utf16_length(value ->> 'phone') > 30
    or private.utf16_length(value ->> 'address') > 300
    or private.utf16_length(value ->> 'notes') > 2000
    or value ->> 'fulfillment' not in ('pickup','delivery')
    or (value ->> 'fulfillment' = 'delivery' and btrim(value ->> 'address', E' \t\n\r\f' || chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '')
    or value ->> 'status' not in ('pending','confirmed','preparing','ready','delivered','cancelled')
    or value ->> 'time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or value ->> 'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or left(value ->> 'date', 4) = '0000'
    or value ->> 'createdAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$'
  then raise exception 'invalid'; end if;
  civil_date := (value ->> 'date')::date;
  if to_char(civil_date, 'YYYY-MM-DD') <> value ->> 'date' then raise exception 'invalid'; end if;
  perform (value ->> 'createdAt')::timestamptz;
  if jsonb_typeof(value -> 'receivedCents') <> 'number' then raise exception 'invalid'; end if;
  received := (value ->> 'receivedCents')::numeric;
  if received < 0 or received > 100000000 or trunc(received) <> received
    or jsonb_typeof(value -> 'lines') <> 'array'
    or jsonb_array_length(value -> 'lines') not between 1 and 100 then raise exception 'invalid'; end if;
  for item in select * from jsonb_array_elements(value -> 'lines') loop
    if jsonb_typeof(item) <> 'object' or (select count(*) from jsonb_object_keys(item)) <> 5
      or not item ?& array['id','description','quantity','unit','unitPriceCents'] then raise exception 'invalid'; end if;
    foreach field in array array['id','description','unit'] loop
      if jsonb_typeof(item -> field) <> 'string' then raise exception 'invalid'; end if;
    end loop;
    item_id := item ->> 'id';
    if private.utf16_length(item_id) not between 1 and 100 or item_id = any(ids)
      or private.utf16_length(item ->> 'description') not between 1 and 180
      or item ->> 'unit' not in ('un','kg','cento')
      or jsonb_typeof(item -> 'quantity') <> 'number'
      or jsonb_typeof(item -> 'unitPriceCents') <> 'number' then raise exception 'invalid'; end if;
    ids := array_append(ids, item_id);
    quantity := (item ->> 'quantity')::numeric;
    price := (item ->> 'unitPriceCents')::numeric;
    if quantity <= 0 or quantity > 10000 or price < 0 or price > 100000000 or trunc(price) <> price
      or (item ->> 'unit' <> 'kg' and trunc(quantity) <> quantity)
      or (item ->> 'unit' = 'kg' and abs(quantity * 1000 - round(quantity * 1000)) > 0.0000001)
      then raise exception 'invalid'; end if;
    total := total + floor((round(quantity * 1000) * price + 500) / 1000);
    if total > 100000000 then raise exception 'invalid'; end if;
  end loop;
  if total - discount <= 0 or received > total - discount then raise exception 'invalid'; end if;
exception when others then
  raise exception using errcode = 'P0001', message = 'INVALID_ORDER';
end;
$$;

-- Same as before, plus: every saved order with a WhatsApp number lands in the customer central.
create or replace function private.save_order(p_order jsonb, p_expected_revision integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  member private.staff_members := private.require_staff();
  record private.order_records; order_id uuid; action text; timestamp_text text;
begin
  if member.role not in ('owner','attendant') or not (member.role = 'owner' or member.can_view_financial) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  perform private.validate_order(p_order);
  order_id := (p_order ->> 'id')::uuid;
  select * into record from private.order_records where id = order_id for update;
  if found then
    if p_expected_revision is distinct from record.revision then
      raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT';
    end if;
    if p_order -> 'number' <> record.payload -> 'number'
      or p_order -> 'createdAt' <> record.payload -> 'createdAt' then
      raise exception using errcode = 'P0001', message = 'INVALID_ORDER';
    end if;
    update private.order_records set payload = p_order, revision = revision + 1,
      updated_at = clock_timestamp() where id = order_id returning * into record;
    action := 'updated';
  else
    if p_expected_revision is not null then raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT'; end if;
    insert into private.order_records(id, payload) values (order_id, p_order)
      on conflict (id) do nothing returning * into record;
    if not found then raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT'; end if;
    timestamp_text := to_char(record.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    update private.order_records set payload = p_order || jsonb_build_object('number', record.number,
      'createdAt', timestamp_text) where id = order_id returning * into record;
    action := 'created';
  end if;
  insert into private.order_audit(order_id, revision, actor_id, actor_name, action)
    values (record.id, record.revision, member.user_id, member.display_name, action);
  perform private.touch_customer(record.payload ->> 'customer', record.payload ->> 'phone', 'equipe', null);
  return jsonb_build_object('order', record.payload, 'revision', record.revision);
end;
$$;

-- ---------- site requests: coupon, opt-in and showcase items ----------
create or replace function private.submit_order_request(p_request jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  -- ECMAScript String.trim whitespace, as in validate_order.
  blank constant text := E' \t\n\r\f' || chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  value jsonb := p_request; item jsonb; field text; quantity numeric; price numeric;
  civil_date date; today date := (now() at time zone 'America/Sao_Paulo')::date;
  digits text; lines jsonb := '[]'::jsonb; key_count integer; quoted boolean := false;
  shop jsonb; zones jsonb; zone_name text := ''; zone jsonb; coupon_code text := ''; opt_in boolean := false;
  showcase_wanted jsonb := '[]'::jsonb; wanted jsonb; product private.showcase_items;
  subtotal integer := 0; quote jsonb; created private.order_requests; extra_keys integer;
begin
  select settings into shop from private.shop_settings;
  zones := coalesce(shop -> 'deliveryZones', '[]'::jsonb);
  begin
    if value is null or jsonb_typeof(value) <> 'object' then raise exception 'invalid'; end if;
    key_count := (select count(*) from jsonb_object_keys(value));
    extra_keys := (select count(*) from jsonb_object_keys(value) k where k in ('deliveryZone','couponCode','marketingOptIn'));
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
      if (select count(*) from jsonb_object_keys(item)) <> 4
        or not item ?& array['description','quantity','unit','unitPriceCents']
        or jsonb_typeof(item -> 'description') <> 'string' or jsonb_typeof(item -> 'unit') <> 'string'
        or jsonb_typeof(item -> 'quantity') <> 'number' or jsonb_typeof(item -> 'unitPriceCents') <> 'number'
        or private.utf16_length(btrim(item ->> 'description', blank)) not between 1 and 180
        or item ->> 'unit' not in ('un','kg','cento') then raise exception 'invalid'; end if;
      quantity := (item ->> 'quantity')::numeric;
      price := (item ->> 'unitPriceCents')::numeric;
      if quantity <= 0 or quantity > 1000 or price < 0 or price > 10000000 or trunc(price) <> price
        or (item ->> 'unit' <> 'kg' and trunc(quantity) <> quantity)
        or (item ->> 'unit' = 'kg' and abs(quantity * 1000 - round(quantity * 1000)) > 0.0000001)
        then raise exception 'invalid'; end if;
      quoted := quoted or price = 0;
      subtotal := subtotal + floor((round(quantity * 1000) * price + 500) / 1000)::integer;
      -- Prices are the customer's estimate only; the team confirms values on conversion.
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
  -- Serialize submissions so the abuse limits, stock and coupon counters cannot be raced.
  perform pg_advisory_xact_lock(1935765876, 2);
  if (select count(*) from private.order_requests where created_at > clock_timestamp() - interval '10 minutes') >= 20
    or (select count(*) from private.order_requests where phone_digits = digits and created_at > clock_timestamp() - interval '1 day') >= 5
    or (select count(*) from private.order_requests where status = 'new') >= 300 then
    raise exception using errcode = 'P0001', message = 'REQUEST_LIMIT';
  end if;
  -- Reserve showcase stock now; dismissing the request gives it back.
  for wanted in select * from jsonb_array_elements(showcase_wanted) loop
    select * into product from private.showcase_items where id = (wanted ->> 'showcaseId')::uuid and active for update;
    quantity := (wanted ->> 'quantity')::numeric;
    if not found or quantity <= 0 or quantity > product.stock
      or (product.unit <> 'kg' and trunc(quantity) <> quantity)
      or (product.unit = 'kg' and abs(quantity * 1000 - round(quantity * 1000)) > 0.0000001) then
      raise exception using errcode = 'P0001', message = 'SHOWCASE_STOCK';
    end if;
    update private.showcase_items set stock = stock - quantity, updated_at = clock_timestamp() where id = product.id;
    subtotal := subtotal + floor((round(quantity * 1000) * product.price_cents + 500) / 1000)::integer;
    lines := lines || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'description', 'Pronta entrega · ' || product.name,
      'quantity', quantity, 'unit', product.unit, 'unitPriceCents', product.price_cents, 'showcaseId', product.id));
  end loop;
  if jsonb_array_length(lines) > 30 then raise exception using errcode = 'P0001', message = 'INVALID_REQUEST'; end if;
  if coupon_code <> '' then quote := private.coupon_quote(coupon_code, private.phone_key(digits), subtotal); end if;
  if value ->> 'fulfillment' = 'delivery' and zone is not null and (zone ->> 'feeCents')::integer > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(),
      'description', 'Frete · ' || (zone ->> 'name'), 'quantity', 1, 'unit', 'un', 'unitPriceCents', zone -> 'feeCents'));
  end if;
  insert into private.order_requests(payload, phone_digits) values (jsonb_build_object(
    'customer', btrim(value ->> 'customer', blank), 'phone', btrim(value ->> 'phone', blank),
    'date', value ->> 'date', 'time', value ->> 'time', 'fulfillment', value ->> 'fulfillment',
    'address', btrim(value ->> 'address', blank), 'notes', btrim(value ->> 'notes', blank), 'lines', lines,
    'couponCode', coalesce(quote ->> 'code', ''), 'discountCents', coalesce((quote ->> 'discountCents')::integer, 0)), digits)
    returning * into created;
  if quote is not null then
    insert into private.coupon_uses(coupon_id, phone_key, request_id, discount_cents)
      values ((quote ->> 'id')::uuid, private.phone_key(digits), created.id, (quote ->> 'discountCents')::integer);
    update private.coupons set uses = uses + 1 where id = (quote ->> 'id')::uuid;
  end if;
  perform private.touch_customer(value ->> 'customer', value ->> 'phone', 'site', opt_in);
  -- Return nothing identifying: anonymous callers cannot read requests back.
  return jsonb_build_object('received', true, 'discountCents', coalesce((quote ->> 'discountCents')::integer, 0));
end;
$$;

-- Dismissing a request returns its showcase stock and its coupon use.
create or replace function private.resolve_order_request(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_order_editor(); request private.order_requests; line jsonb; use_row private.coupon_uses;
begin
  if p_status is null or p_status not in ('converted','dismissed') then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;
  update private.order_requests set status = p_status, resolved_at = clock_timestamp(), resolved_by = member.user_id
    where id = p_id and status = 'new' returning * into request;
  if not found then raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT'; end if;
  if p_status = 'dismissed' then
    for line in select * from jsonb_array_elements(request.payload -> 'lines') loop
      if line ? 'showcaseId' then
        update private.showcase_items set stock = least(10000, stock + (line ->> 'quantity')::numeric), updated_at = clock_timestamp()
          where id = (line ->> 'showcaseId')::uuid;
      end if;
    end loop;
    for use_row in update private.coupon_uses set released = true where request_id = p_id and not released returning * loop
      update private.coupons set uses = greatest(0, uses - 1) where id = use_row.coupon_id;
    end loop;
  end if;
  return jsonb_build_object('id', p_id, 'status', p_status);
end;
$$;

-- ---------- public reads ----------
create function private.public_showcase() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description, 'unit', unit,
    'priceCents', price_cents, 'stock', stock, 'photoPath', photo_path) order by sort, name), '[]'::jsonb)
  from private.showcase_items where active and stock > 0;
$$;

create function private.check_coupon(p_code text, p_phone text, p_subtotal_cents integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare quote jsonb;
begin
  if p_subtotal_cents is null or p_subtotal_cents < 0 or p_subtotal_cents > 100000000 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST'; end if;
  quote := private.coupon_quote(p_code, private.phone_key(p_phone), p_subtotal_cents);
  return quote - 'id';
end;
$$;

-- ---------- team: customers ----------
create function private.read_customers() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_order_editor(); result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('key', phone_key, 'name', name, 'phone', phone, 'source', source,
    'marketingOptIn', marketing_opt_in, 'optInAt', opt_in_at, 'optInSource', opt_in_source, 'notes', notes,
    'firstSeen', first_seen, 'lastSeen', last_seen) order by last_seen desc), '[]'::jsonb) into result from private.customers;
  return result;
end;
$$;

create function private.save_customer(p_key text, p_notes text, p_marketing_opt_in boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_order_editor(); row private.customers;
begin
  if p_notes is null or length(p_notes) > 1000 or p_marketing_opt_in is null then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST'; end if;
  update private.customers set notes = p_notes,
    opt_in_at = case when p_marketing_opt_in and not marketing_opt_in then clock_timestamp() when not p_marketing_opt_in then null else opt_in_at end,
    opt_in_source = case when p_marketing_opt_in and not marketing_opt_in then 'equipe' when not p_marketing_opt_in then null else opt_in_source end,
    marketing_opt_in = p_marketing_opt_in
    where phone_key = p_key returning * into row;
  if not found then raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT'; end if;
  return jsonb_build_object('key', row.phone_key, 'marketingOptIn', row.marketing_opt_in, 'notes', row.notes);
end;
$$;

-- LGPD: the owner can erase a customer's marketing record; orders keep their own history.
create function private.delete_customer(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_owner();
begin
  delete from private.customers where phone_key = p_key;
  if not found then raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT'; end if;
  return jsonb_build_object('key', p_key, 'deleted', true);
end;
$$;

-- ---------- team: coupons (owner) ----------
create function private.coupon_json(c private.coupons) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'code', c.code, 'description', c.description, 'kind', c.kind, 'value', c.value,
    'firstOrderOnly', c.first_order_only, 'minOrderCents', c.min_order_cents, 'startsOn', c.starts_on, 'endsOn', c.ends_on,
    'maxUses', c.max_uses, 'uses', c.uses, 'active', c.active);
$$;

create function private.read_coupons() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_owner(); result jsonb;
begin
  select coalesce(jsonb_agg(private.coupon_json(c) order by c.active desc, c.created_at desc), '[]'::jsonb) into result from private.coupons c;
  return result;
end;
$$;

create function private.save_coupon(p_coupon jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_owner(); c private.coupons; target uuid;
begin
  begin
    if jsonb_typeof(p_coupon) <> 'object' or (select count(*) from jsonb_object_keys(p_coupon)) <> 11 or not p_coupon ?&
      array['id','code','description','kind','value','firstOrderOnly','minOrderCents','startsOn','endsOn','maxUses','active'] then raise exception 'invalid'; end if;
    target := nullif(p_coupon ->> 'id', '')::uuid;
    if target is null then
      insert into private.coupons(code, description, kind, value, first_order_only, min_order_cents, starts_on, ends_on, max_uses, active)
      values (upper(btrim(p_coupon ->> 'code')), btrim(p_coupon ->> 'description'), p_coupon ->> 'kind', (p_coupon ->> 'value')::integer,
        (p_coupon ->> 'firstOrderOnly')::boolean, (p_coupon ->> 'minOrderCents')::integer, nullif(p_coupon ->> 'startsOn', '')::date,
        nullif(p_coupon ->> 'endsOn', '')::date, nullif(p_coupon ->> 'maxUses', '')::integer, (p_coupon ->> 'active')::boolean) returning * into c;
    else
      update private.coupons set code = upper(btrim(p_coupon ->> 'code')), description = btrim(p_coupon ->> 'description'),
        kind = p_coupon ->> 'kind', value = (p_coupon ->> 'value')::integer, first_order_only = (p_coupon ->> 'firstOrderOnly')::boolean,
        min_order_cents = (p_coupon ->> 'minOrderCents')::integer, starts_on = nullif(p_coupon ->> 'startsOn', '')::date,
        ends_on = nullif(p_coupon ->> 'endsOn', '')::date, max_uses = nullif(p_coupon ->> 'maxUses', '')::integer,
        active = (p_coupon ->> 'active')::boolean, updated_at = clock_timestamp()
        where id = target returning * into c;
      if not found then raise exception 'missing'; end if;
    end if;
  exception
    when unique_violation then raise exception using errcode = 'P0001', message = 'COUPON_CODE_TAKEN';
    when others then raise exception using errcode = 'P0001', message = 'INVALID_COUPON';
  end;
  return private.coupon_json(c);
end;
$$;

-- ---------- team: showcase (owner and attendants who manage orders) ----------
create function private.showcase_json(s private.showcase_items) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description, 'unit', s.unit, 'priceCents', s.price_cents,
    'stock', s.stock, 'photoPath', s.photo_path, 'active', s.active, 'sort', s.sort);
$$;

create function private.read_showcase() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_order_editor(); result jsonb;
begin
  select coalesce(jsonb_agg(private.showcase_json(s) order by s.sort, s.name), '[]'::jsonb) into result from private.showcase_items s;
  return result;
end;
$$;

create function private.save_showcase_item(p_item jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_order_editor(); s private.showcase_items; target uuid; qty numeric;
begin
  begin
    if jsonb_typeof(p_item) <> 'object' or (select count(*) from jsonb_object_keys(p_item)) <> 9 or not p_item ?&
      array['id','name','description','unit','priceCents','stock','photoPath','active','sort'] then raise exception 'invalid'; end if;
    qty := (p_item ->> 'stock')::numeric;
    if (p_item ->> 'unit') <> 'kg' and trunc(qty) <> qty then raise exception 'invalid'; end if;
    target := nullif(p_item ->> 'id', '')::uuid;
    if target is null then
      insert into private.showcase_items(name, description, unit, price_cents, stock, photo_path, active, sort)
      values (btrim(p_item ->> 'name'), btrim(p_item ->> 'description'), p_item ->> 'unit', (p_item ->> 'priceCents')::integer, qty,
        nullif(p_item ->> 'photoPath', ''), (p_item ->> 'active')::boolean, (p_item ->> 'sort')::integer) returning * into s;
    else
      update private.showcase_items set name = btrim(p_item ->> 'name'), description = btrim(p_item ->> 'description'), unit = p_item ->> 'unit',
        price_cents = (p_item ->> 'priceCents')::integer, stock = qty, photo_path = nullif(p_item ->> 'photoPath', ''),
        active = (p_item ->> 'active')::boolean, sort = (p_item ->> 'sort')::integer, updated_at = clock_timestamp()
        where id = target returning * into s;
      if not found then raise exception 'missing'; end if;
    end if;
  exception when others then
    raise exception using errcode = 'P0001', message = 'INVALID_SHOWCASE';
  end;
  return private.showcase_json(s);
end;
$$;

-- Storage policies call this to let only the team's editors upload showcase photos.
create function private.can_edit_showcase() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.staff_members where user_id = auth.uid() and active
    and role in ('owner','attendant') and (role = 'owner' or can_view_financial));
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vitrine', 'vitrine', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "vitrine uploads by editors" on storage.objects for insert to authenticated
  with check (bucket_id = 'vitrine' and private.can_edit_showcase());
create policy "vitrine updates by editors" on storage.objects for update to authenticated
  using (bucket_id = 'vitrine' and private.can_edit_showcase()) with check (bucket_id = 'vitrine' and private.can_edit_showcase());
create policy "vitrine deletes by editors" on storage.objects for delete to authenticated
  using (bucket_id = 'vitrine' and private.can_edit_showcase());

-- ---------- public wrappers and grants ----------
create function public.public_showcase() returns jsonb language sql security invoker set search_path = '' as $$ select private.public_showcase(); $$;
create function public.check_coupon(p_code text, p_phone text, p_subtotal_cents integer) returns jsonb
language sql security invoker set search_path = '' as $$ select private.check_coupon(p_code, p_phone, p_subtotal_cents); $$;
create function public.read_customers() returns jsonb language sql security invoker set search_path = '' as $$ select private.read_customers(); $$;
create function public.save_customer(p_key text, p_notes text, p_marketing_opt_in boolean) returns jsonb
language sql security invoker set search_path = '' as $$ select private.save_customer(p_key, p_notes, p_marketing_opt_in); $$;
create function public.delete_customer(p_key text) returns jsonb language sql security invoker set search_path = '' as $$ select private.delete_customer(p_key); $$;
create function public.read_coupons() returns jsonb language sql security invoker set search_path = '' as $$ select private.read_coupons(); $$;
create function public.save_coupon(p_coupon jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.save_coupon(p_coupon); $$;
create function public.read_showcase() returns jsonb language sql security invoker set search_path = '' as $$ select private.read_showcase(); $$;
create function public.save_showcase_item(p_item jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.save_showcase_item(p_item); $$;

revoke execute on all functions in schema private from public, anon, authenticated;
do $$
declare signature text;
begin
  foreach signature in array array['current_staff()', 'read_orders()', 'read_production_orders()',
    'save_order(jsonb,integer)', 'set_order_status(uuid,text,integer)', 'list_staff()',
    'set_staff_access(uuid,text,boolean,boolean)', 'read_audit(uuid)',
    'read_order_requests()', 'resolve_order_request(uuid,text)', 'read_settings()', 'save_settings(jsonb)',
    'read_customers()', 'save_customer(text,text,boolean)', 'delete_customer(text)',
    'read_coupons()', 'save_coupon(jsonb)', 'read_showcase()', 'save_showcase_item(jsonb)'] loop
    execute 'revoke all on function public.' || signature || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || signature || ' to authenticated';
    execute 'grant execute on function private.' || signature || ' to authenticated';
  end loop;
  foreach signature in array array['submit_order_request(jsonb)', 'public_settings()', 'public_showcase()', 'check_coupon(text,text,integer)'] loop
    execute 'revoke all on function public.' || signature || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || signature || ' to anon, authenticated';
    execute 'grant execute on function private.' || signature || ' to anon, authenticated';
  end loop;
  -- Storage evaluates its policies as the signed-in user.
  grant execute on function private.can_edit_showcase() to authenticated;
end;
$$;
