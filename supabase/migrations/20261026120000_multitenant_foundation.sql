-- Multiclient foundation: every shop is a tenant. A staff account belongs to exactly one shop;
-- every RPC derives the shop from the caller's active membership, never from client input.
-- Public pages name the shop by slug. Existing data becomes the Saint Cakes tenant.

create table private.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name text not null check (length(btrim(name)) between 2 and 100),
  status text not null default 'trial' check (status in ('trial', 'active', 'paused')),
  -- Per-shop order numbers: each shop starts at #001.
  order_counter bigint not null default 0 check (order_counter >= 0),
  created_at timestamptz not null default clock_timestamp()
);
alter table private.tenants enable row level security;
revoke all on private.tenants from public, anon, authenticated;

insert into private.tenants(id, slug, name, status, order_counter)
values ('a0000000-0000-4000-8000-000000000001', 'saint-cakes', 'Saint Cakes', 'active',
  coalesce((select max(number) from private.order_records), 0));

do $$
declare t text;
begin
  foreach t in array array['staff_members', 'order_records', 'order_requests', 'customers', 'coupons', 'showcase_items', 'shop_settings'] loop
    execute format('alter table private.%I add column tenant_id uuid references private.tenants(id) on delete restrict', t);
    execute format('update private.%I set tenant_id = %L where tenant_id is null', t, 'a0000000-0000-4000-8000-000000000001');
    execute format('alter table private.%I alter column tenant_id set not null', t);
  end loop;
end;
$$;

-- Keys that were unique for the single shop become unique per shop.
alter table private.order_records alter column number drop identity;
alter table private.order_records drop constraint order_records_number_key;
alter table private.order_records add constraint order_records_tenant_number_key unique (tenant_id, number);
alter table private.shop_settings drop column id;
alter table private.shop_settings add primary key (tenant_id);
alter table private.customers drop constraint customers_pkey;
alter table private.customers add primary key (tenant_id, phone_key);
alter table private.coupons drop constraint coupons_code_key;
alter table private.coupons add constraint coupons_tenant_code_key unique (tenant_id, code);

drop index private.order_requests_status_time_idx;
drop index private.order_requests_phone_time_idx;
create index order_requests_tenant_status_time_idx on private.order_requests(tenant_id, status, created_at);
create index order_requests_tenant_phone_time_idx on private.order_requests(tenant_id, phone_digits, created_at);
create index staff_members_tenant_idx on private.staff_members(tenant_id);
create index showcase_items_tenant_idx on private.showcase_items(tenant_id, sort);

-- ---------- helpers ----------
/** The shop behind a public slug; paused or unknown shops do not take orders. */
create function private.public_tenant(p_shop text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare shop_id uuid;
begin
  select id into shop_id from private.tenants
    where slug = lower(btrim(coalesce(p_shop, ''))) and status in ('trial', 'active');
  if shop_id is null then raise exception using errcode = 'P0001', message = 'SHOP_NOT_FOUND'; end if;
  return shop_id;
end;
$$;

/** Serializes one shop's public submissions and conversions (abuse limits, stock, coupons). */
create function private.lock_tenant_requests(p_tenant uuid) returns void
language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('requests:' || p_tenant::text, 0));
$$;

create function private.touch_customer(p_tenant uuid, p_name text, p_phone text, p_source text, p_opt_in boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare k text := private.phone_key(p_phone);
begin
  if k !~ '^[0-9]{10,11}$' or length(btrim(coalesce(p_name, ''))) < 1 then return; end if;
  insert into private.customers(tenant_id, phone_key, name, phone, source, marketing_opt_in, opt_in_at, opt_in_source)
    values (p_tenant, k, left(btrim(p_name), 100), left(btrim(p_phone), 30), p_source, coalesce(p_opt_in, false),
      case when p_opt_in then clock_timestamp() end, case when p_opt_in then p_source end)
  on conflict (tenant_id, phone_key) do update set name = excluded.name, phone = excluded.phone, last_seen = clock_timestamp(),
    -- A yes is recorded; a missing answer never withdraws an earlier consent.
    marketing_opt_in = private.customers.marketing_opt_in or coalesce(p_opt_in, false),
    opt_in_at = case when not private.customers.marketing_opt_in and p_opt_in then clock_timestamp() else private.customers.opt_in_at end,
    opt_in_source = case when not private.customers.marketing_opt_in and p_opt_in then p_source else private.customers.opt_in_source end;
end;
$$;

create function private.is_first_order(p_tenant uuid, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from private.order_records where tenant_id = p_tenant and private.phone_key(payload ->> 'phone') = p_key)
     and not exists (select 1 from private.order_requests where tenant_id = p_tenant and private.phone_key(phone_digits) = p_key and status <> 'dismissed');
$$;

/** Discount for a code in one shop, or a COUPON_* error the page can explain. Locks the coupon row. */
create function private.coupon_quote(p_tenant uuid, p_code text, p_key text, p_subtotal integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c private.coupons; today date := (now() at time zone 'America/Sao_Paulo')::date; discount integer;
begin
  select * into c from private.coupons where tenant_id = p_tenant and code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or not c.active then raise exception using errcode = 'P0001', message = 'COUPON_NOT_FOUND'; end if;
  if (c.starts_on is not null and today < c.starts_on) or (c.ends_on is not null and today > c.ends_on) then
    raise exception using errcode = 'P0001', message = 'COUPON_EXPIRED'; end if;
  if c.max_uses is not null and c.uses >= c.max_uses then raise exception using errcode = 'P0001', message = 'COUPON_EXHAUSTED'; end if;
  if c.first_order_only and not private.is_first_order(p_tenant, p_key) then raise exception using errcode = 'P0001', message = 'COUPON_FIRST_ORDER'; end if;
  if p_subtotal < greatest(c.min_order_cents, 1) then raise exception using errcode = 'P0001', message = 'COUPON_MIN_ORDER'; end if;
  discount := case when c.kind = 'percent' then floor(p_subtotal::numeric * c.value / 100)::integer else c.value end;
  -- A coupon never makes an order free.
  if discount <= 0 or discount >= p_subtotal then
    raise exception using errcode = 'P0001', message = 'COUPON_MIN_ORDER';
  end if;
  return jsonb_build_object('id', c.id, 'code', c.code, 'description', c.description, 'discountCents', discount);
end;
$$;

-- ---------- staff and orders ----------
create or replace function private.current_staff() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff(); shop private.tenants;
begin
  select * into shop from private.tenants where id = member.tenant_id;
  return (private.staff_json(member) - 'active')
    || jsonb_build_object('shop', jsonb_build_object('id', shop.id, 'slug', shop.slug, 'name', shop.name, 'status', shop.status));
end;
$$;

create or replace function private.read_orders() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff(); result jsonb;
begin
  if not (member.role = 'owner' or member.can_view_financial) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('order', payload, 'revision', revision) order by number), '[]'::jsonb)
    into result from private.order_records where tenant_id = member.tenant_id;
  return result;
end;
$$;

create or replace function private.read_production_orders() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff(); result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('order', private.production_order(payload), 'revision', revision)
    order by number), '[]'::jsonb) into result from private.order_records where tenant_id = member.tenant_id;
  return result;
end;
$$;

create or replace function private.save_order(p_order jsonb, p_expected_revision integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  member private.staff_members := private.require_staff();
  record private.order_records; order_id uuid; action text; timestamp_text text; next_number bigint;
begin
  if member.role not in ('owner','attendant') or not (member.role = 'owner' or member.can_view_financial) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  perform private.validate_order(p_order);
  order_id := (p_order ->> 'id')::uuid;
  select * into record from private.order_records where id = order_id and tenant_id = member.tenant_id for update;
  if found then
    if p_expected_revision is distinct from record.revision then
      raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT';
    end if;
    if p_order -> 'number' <> record.payload -> 'number'
      or p_order -> 'createdAt' <> record.payload -> 'createdAt' then
      raise exception using errcode = 'P0001', message = 'INVALID_ORDER';
    end if;
    update private.order_records set payload = p_order, revision = revision + 1,
      updated_at = clock_timestamp() where id = order_id and tenant_id = member.tenant_id returning * into record;
    action := 'updated';
  else
    if p_expected_revision is not null then raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT'; end if;
    -- The counter row lock also serializes numbering within the shop; a failed insert rolls it back.
    update private.tenants set order_counter = order_counter + 1 where id = member.tenant_id returning order_counter into next_number;
    -- An id already used by any shop is a conflict, never an overwrite.
    insert into private.order_records(id, tenant_id, number, payload) values (order_id, member.tenant_id, next_number, p_order)
      on conflict (id) do nothing returning * into record;
    if not found then raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT'; end if;
    timestamp_text := to_char(record.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    update private.order_records set payload = p_order || jsonb_build_object('number', record.number,
      'createdAt', timestamp_text) where id = order_id and tenant_id = member.tenant_id returning * into record;
    action := 'created';
  end if;
  insert into private.order_audit(order_id, revision, actor_id, actor_name, action)
    values (record.id, record.revision, member.user_id, member.display_name, action);
  perform private.touch_customer(member.tenant_id, record.payload ->> 'customer', record.payload ->> 'phone', 'equipe', null);
  return jsonb_build_object('order', record.payload, 'revision', record.revision);
end;
$$;

create or replace function private.set_order_status(p_id uuid, p_status text, p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff(); record private.order_records; result jsonb;
begin
  select * into record from private.order_records where id = p_id and tenant_id = member.tenant_id for update;
  if not found or p_expected_revision is distinct from record.revision then
    raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT';
  end if;
  if p_status is null or p_status not in ('pending','confirmed','preparing','ready','delivered','cancelled') then
    raise exception using errcode = 'P0001', message = 'INVALID_ORDER';
  end if;
  if member.role = 'production' or not (member.role = 'owner' or member.can_view_financial) then
    if not ((record.payload ->> 'status' = 'confirmed' and p_status = 'preparing')
      or (record.payload ->> 'status' = 'preparing' and p_status = 'ready')) then
      raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
    end if;
  end if;
  update private.order_records set payload = jsonb_set(payload, '{status}', to_jsonb(p_status)),
    revision = revision + 1, updated_at = clock_timestamp() where id = p_id and tenant_id = member.tenant_id returning * into record;
  insert into private.order_audit(order_id, revision, actor_id, actor_name, action)
    values (record.id, record.revision, member.user_id, member.display_name, 'status_changed');
  result := case when member.role = 'owner' or member.can_view_financial then record.payload
    else private.production_order(record.payload) end;
  return jsonb_build_object('order', result, 'revision', record.revision);
end;
$$;

create or replace function private.list_staff() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff(); result jsonb;
begin
  if member.role <> 'owner' then raise exception using errcode = 'P0001', message = 'ACCESS_DENIED'; end if;
  select coalesce(jsonb_agg(private.staff_json(staff) order by display_name, user_id), '[]'::jsonb)
    into result from private.staff_members staff where staff.tenant_id = member.tenant_id;
  return result;
end;
$$;

create or replace function private.set_staff_access(p_user_id uuid, p_role text, p_active boolean,
  p_can_view_financial boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members; target private.staff_members;
begin
  -- Serialize owner changes, including last-owner checks, without trusting JWT metadata.
  perform pg_advisory_xact_lock(1935765876, 1);
  member := private.require_staff();
  if member.role <> 'owner' or p_user_id = member.user_id then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  if p_role is null or p_role not in ('owner','attendant','production') or p_active is null
    or p_can_view_financial is null or (p_role = 'owner' and not p_can_view_financial) then
    raise exception using errcode = 'P0001', message = 'INVALID_ORDER';
  end if;
  select * into target from private.staff_members where user_id = p_user_id and tenant_id = member.tenant_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'ACCESS_DENIED'; end if;
  if target.role = 'owner' and target.active and (p_role <> 'owner' or not p_active)
    and (select count(*) from private.staff_members where tenant_id = member.tenant_id and role = 'owner' and active) <= 1 then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  update private.staff_members set role = p_role, active = p_active,
    can_view_financial = p_can_view_financial where user_id = p_user_id and tenant_id = member.tenant_id returning * into target;
  return private.staff_json(target);
end;
$$;

create or replace function private.read_audit(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff(); result jsonb;
begin
  if not (member.role = 'owner' or member.can_view_financial) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('actorName', a.actor_name, 'action', a.action,
    'createdAt', to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'revision', a.revision) order by a.revision), '[]'::jsonb)
    into result from private.order_audit a
    join private.order_records r on r.id = a.order_id and r.tenant_id = member.tenant_id
    where a.order_id = p_order_id;
  return result;
end;
$$;

-- ---------- requests ----------
create or replace function private.read_order_requests() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_order_editor(); result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'request', payload,
    'createdAt', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by created_at, id), '[]'::jsonb)
    into result from private.order_requests where tenant_id = member.tenant_id and status = 'new';
  return result;
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
    where id = p_id and tenant_id = member.tenant_id and status = 'new' returning * into request;
  if not found then raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT'; end if;
  if p_status = 'dismissed' then
    for line in select * from jsonb_array_elements(request.payload -> 'lines') loop
      if line ? 'showcaseId' then
        update private.showcase_items set stock = least(10000, stock + (line ->> 'quantity')::numeric), updated_at = clock_timestamp()
          where id = (line ->> 'showcaseId')::uuid and tenant_id = request.tenant_id;
      end if;
    end loop;
    for use_row in update private.coupon_uses set released = true where request_id = p_id and not released returning * loop
      update private.coupons set uses = greatest(0, uses - 1) where id = use_row.coupon_id and tenant_id = request.tenant_id;
    end loop;
  end if;
  return jsonb_build_object('id', p_id, 'status', p_status);
end;
$$;

create or replace function private.convert_order_request(p_id uuid, p_order jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  member private.staff_members := private.require_order_editor();
  request private.order_requests; saved jsonb;
begin
  -- Same order as submit: shop submission lock, then request/inventory locks.
  perform private.lock_tenant_requests(member.tenant_id);
  select * into request from private.order_requests where id = p_id and tenant_id = member.tenant_id for update;
  if not found or request.status <> 'new' then
    raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT';
  end if;
  perform private.validate_reserved_showcase_lines(request.payload, p_order);
  saved := private.save_order(p_order, null);
  perform private.resolve_order_request(p_id, 'converted');
  update private.order_requests set converted_order_id = (saved -> 'order' ->> 'id')::uuid
    where id = p_id and tenant_id = member.tenant_id;
  return saved;
end;
$$;

/** Public form submission for the shop named by p_shop. */
create function private.submit_order_request(p_shop text, p_request jsonb) returns jsonb
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
  subtotal integer := 0; quote jsonb; created private.order_requests; extra_keys integer;
begin
  select settings into shop from private.shop_settings where tenant_id = tenant;
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
    subtotal := subtotal + floor((round(quantity * 1000) * product.price_cents + 500) / 1000)::integer;
    lines := lines || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'description', 'Pronta entrega · ' || product.name,
      'quantity', quantity, 'unit', product.unit, 'unitPriceCents', product.price_cents, 'showcaseId', product.id));
  end loop;
  if jsonb_array_length(lines) > 30 then raise exception using errcode = 'P0001', message = 'INVALID_REQUEST'; end if;
  if coupon_code <> '' then quote := private.coupon_quote(tenant, coupon_code, private.phone_key(digits), subtotal); end if;
  if value ->> 'fulfillment' = 'delivery' and zone is not null and (zone ->> 'feeCents')::integer > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(),
      'description', 'Frete · ' || (zone ->> 'name'), 'quantity', 1, 'unit', 'un', 'unitPriceCents', zone -> 'feeCents'));
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

-- ---------- settings ----------
create or replace function private.read_settings() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff(); result jsonb;
begin
  -- Pix details appear in messages to customers, so staff with financial access may read them.
  if not (member.role = 'owner' or member.can_view_financial) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  select settings into result from private.shop_settings where tenant_id = member.tenant_id;
  return result;
end;
$$;

create or replace function private.save_settings(p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff(); result jsonb;
begin
  if member.role <> 'owner' then raise exception using errcode = 'P0001', message = 'ACCESS_DENIED'; end if;
  perform private.validate_settings(p_settings);
  update private.shop_settings set settings = p_settings, updated_at = clock_timestamp(), updated_by = member.user_id
    where tenant_id = member.tenant_id returning settings into result;
  return result;
end;
$$;

create function private.public_settings(p_shop text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('minLeadDays', settings -> 'minLeadDays', 'deliveryZones', settings -> 'deliveryZones')
  from private.shop_settings where tenant_id = private.public_tenant(p_shop);
$$;

-- ---------- showcase and coupons on the public page ----------
create function private.public_showcase(p_shop text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description, 'unit', unit,
    'priceCents', price_cents, 'stock', stock, 'photoPath', photo_path) order by sort, name), '[]'::jsonb)
  from private.showcase_items where tenant_id = private.public_tenant(p_shop) and active and stock > 0;
$$;

create function private.check_coupon(p_shop text, p_code text, p_phone text, p_subtotal_cents integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tenant uuid := private.public_tenant(p_shop); quote jsonb;
begin
  if p_subtotal_cents is null or p_subtotal_cents < 0 or p_subtotal_cents > 100000000 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST'; end if;
  quote := private.coupon_quote(tenant, p_code, private.phone_key(p_phone), p_subtotal_cents);
  return quote - 'id';
end;
$$;

-- ---------- team: customers ----------
create or replace function private.read_customers() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_order_editor(); result jsonb;
begin
  select coalesce(jsonb_agg(private.customer_json(c) order by c.last_seen desc), '[]'::jsonb)
    into result from private.customers c where c.tenant_id = member.tenant_id;
  return result;
end;
$$;

create or replace function private.save_customer(p_key text, p_notes text, p_marketing_opt_in boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_order_editor(); row private.customers;
begin
  if p_notes is null or length(p_notes) > 1000 or p_marketing_opt_in is null then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST'; end if;
  update private.customers set notes = p_notes,
    opt_in_at = case when p_marketing_opt_in and not marketing_opt_in then clock_timestamp() when not p_marketing_opt_in then null else opt_in_at end,
    opt_in_source = case when p_marketing_opt_in and not marketing_opt_in then 'equipe' when not p_marketing_opt_in then null else opt_in_source end,
    marketing_opt_in = p_marketing_opt_in
    where tenant_id = member.tenant_id and phone_key = p_key returning * into row;
  if not found then raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT'; end if;
  return jsonb_build_object('key', row.phone_key, 'marketingOptIn', row.marketing_opt_in, 'notes', row.notes);
end;
$$;

-- LGPD: the owner can erase a customer's marketing record; orders keep their own history.
create or replace function private.delete_customer(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_owner();
begin
  delete from private.customers where tenant_id = member.tenant_id and phone_key = p_key;
  if not found then raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT'; end if;
  return jsonb_build_object('key', p_key, 'deleted', true);
end;
$$;

create or replace function private.patch_customer(p_key text, p_notes text, p_marketing_opt_in boolean, p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_order_editor(); customer private.customers;
begin
  select * into customer from private.customers where tenant_id = member.tenant_id and phone_key = p_key for update;
  if not found or p_expected_revision is distinct from customer.revision then
    raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT';
  end if;
  perform private.save_customer(p_key, p_notes, p_marketing_opt_in);
  select * into customer from private.customers where tenant_id = member.tenant_id and phone_key = p_key;
  return private.customer_json(customer);
end;
$$;

-- ---------- team: coupons (owner) ----------
create or replace function private.read_coupons() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_owner(); result jsonb;
begin
  select coalesce(jsonb_agg(private.coupon_json(c) order by c.active desc, c.created_at desc), '[]'::jsonb)
    into result from private.coupons c where c.tenant_id = member.tenant_id;
  return result;
end;
$$;

create or replace function private.save_coupon(p_coupon jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_owner(); c private.coupons; target uuid;
begin
  begin
    if jsonb_typeof(p_coupon) <> 'object' or (select count(*) from jsonb_object_keys(p_coupon)) <> 11 or not p_coupon ?&
      array['id','code','description','kind','value','firstOrderOnly','minOrderCents','startsOn','endsOn','maxUses','active'] then raise exception 'invalid'; end if;
    target := nullif(p_coupon ->> 'id', '')::uuid;
    if target is null then
      insert into private.coupons(tenant_id, code, description, kind, value, first_order_only, min_order_cents, starts_on, ends_on, max_uses, active)
      values (member.tenant_id, upper(btrim(p_coupon ->> 'code')), btrim(p_coupon ->> 'description'), p_coupon ->> 'kind', (p_coupon ->> 'value')::integer,
        (p_coupon ->> 'firstOrderOnly')::boolean, (p_coupon ->> 'minOrderCents')::integer, nullif(p_coupon ->> 'startsOn', '')::date,
        nullif(p_coupon ->> 'endsOn', '')::date, nullif(p_coupon ->> 'maxUses', '')::integer, (p_coupon ->> 'active')::boolean) returning * into c;
    else
      update private.coupons set code = upper(btrim(p_coupon ->> 'code')), description = btrim(p_coupon ->> 'description'),
        kind = p_coupon ->> 'kind', value = (p_coupon ->> 'value')::integer, first_order_only = (p_coupon ->> 'firstOrderOnly')::boolean,
        min_order_cents = (p_coupon ->> 'minOrderCents')::integer, starts_on = nullif(p_coupon ->> 'startsOn', '')::date,
        ends_on = nullif(p_coupon ->> 'endsOn', '')::date, max_uses = nullif(p_coupon ->> 'maxUses', '')::integer,
        active = (p_coupon ->> 'active')::boolean, updated_at = clock_timestamp()
        where id = target and tenant_id = member.tenant_id returning * into c;
      if not found then raise exception 'missing'; end if;
    end if;
  exception
    when unique_violation then raise exception using errcode = 'P0001', message = 'COUPON_CODE_TAKEN';
    when others then raise exception using errcode = 'P0001', message = 'INVALID_COUPON';
  end;
  return private.coupon_json(c);
end;
$$;

-- ---------- team: showcase ----------
create or replace function private.read_showcase() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_order_editor(); result jsonb;
begin
  select coalesce(jsonb_agg(private.showcase_json(s) order by s.sort, s.name), '[]'::jsonb)
    into result from private.showcase_items s where s.tenant_id = member.tenant_id;
  return result;
end;
$$;

create or replace function private.save_showcase_item(p_item jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  member private.staff_members := private.require_order_editor();
  s private.showcase_items; target uuid; qty numeric; expected_updated_at timestamptz;
begin
  begin
    if p_item is null or jsonb_typeof(p_item) <> 'object'
      or not p_item ?& array['id','name','description','unit','priceCents','stock','photoPath','active','sort']
      or not ((select count(*) from jsonb_object_keys(p_item)) = 9
        or ((select count(*) from jsonb_object_keys(p_item)) = 10 and p_item ? 'updatedAt')) then
      raise exception 'invalid';
    end if;
    target := nullif(p_item ->> 'id', '')::uuid;
    qty := (p_item ->> 'stock')::numeric;
    if (p_item ->> 'unit') <> 'kg' and trunc(qty) <> qty then raise exception 'invalid'; end if;
    if qty * 1000 <> trunc(qty * 1000) then raise exception 'invalid'; end if;
    if target is not null then
      if jsonb_typeof(p_item -> 'updatedAt') is distinct from 'string'
        or btrim(p_item ->> 'updatedAt') = '' then raise exception 'invalid'; end if;
      expected_updated_at := (p_item ->> 'updatedAt')::timestamptz;
    elsif p_item ? 'updatedAt' and p_item -> 'updatedAt' <> '""'::jsonb then
      raise exception 'invalid';
    end if;
  exception when others then
    raise exception using errcode = 'P0001', message = 'INVALID_SHOWCASE';
  end;

  if target is not null then
    select * into s from private.showcase_items where id = target and tenant_id = member.tenant_id for update;
    if not found or s.updated_at is distinct from expected_updated_at then
      raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT';
    end if;
  end if;

  begin
    if target is null then
      insert into private.showcase_items(tenant_id, name, description, unit, price_cents, stock, photo_path, active, sort)
      values (member.tenant_id, btrim(p_item ->> 'name'), btrim(p_item ->> 'description'), p_item ->> 'unit',
        (p_item ->> 'priceCents')::integer, qty, nullif(p_item ->> 'photoPath', ''),
        (p_item ->> 'active')::boolean, (p_item ->> 'sort')::integer) returning * into s;
    else
      update private.showcase_items set name = btrim(p_item ->> 'name'), description = btrim(p_item ->> 'description'),
        unit = p_item ->> 'unit', price_cents = (p_item ->> 'priceCents')::integer, stock = qty,
        photo_path = nullif(p_item ->> 'photoPath', ''), active = (p_item ->> 'active')::boolean,
        sort = (p_item ->> 'sort')::integer, updated_at = clock_timestamp()
        where id = target and tenant_id = member.tenant_id returning * into s;
    end if;
  exception when others then
    raise exception using errcode = 'P0001', message = 'INVALID_SHOWCASE';
  end;
  return private.showcase_json(s);
end;
$$;

-- Showcase photos live under "<shop id>/"; files uploaded before multiclient ("showcase/…")
-- belong to Saint Cakes, the only shop that existed then.
create function private.can_edit_showcase_object(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.staff_members m
    where m.user_id = auth.uid() and m.active and m.role in ('owner','attendant') and (m.role = 'owner' or m.can_view_financial)
      and ((storage.foldername(p_name))[1] = m.tenant_id::text
        or ((storage.foldername(p_name))[1] = 'showcase' and m.tenant_id = 'a0000000-0000-4000-8000-000000000001')));
$$;
drop policy "vitrine uploads by editors" on storage.objects;
drop policy "vitrine updates by editors" on storage.objects;
drop policy "vitrine deletes by editors" on storage.objects;
create policy "vitrine uploads by shop editors" on storage.objects for insert to authenticated
  with check (bucket_id = 'vitrine' and private.can_edit_showcase_object(name));
create policy "vitrine updates by shop editors" on storage.objects for update to authenticated
  using (bucket_id = 'vitrine' and private.can_edit_showcase_object(name))
  with check (bucket_id = 'vitrine' and private.can_edit_showcase_object(name));
create policy "vitrine deletes by shop editors" on storage.objects for delete to authenticated
  using (bucket_id = 'vitrine' and private.can_edit_showcase_object(name));

-- ---------- provisioning (administrative; no API role may call it) ----------
/** Creates a shop in trial with default settings and its first owner, an existing Auth identity. */
create function private.create_tenant(p_slug text, p_name text, p_owner_user_id uuid, p_owner_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare shop_id uuid;
begin
  insert into private.tenants(slug, name) values (lower(btrim(p_slug)), btrim(p_name)) returning id into shop_id;
  insert into private.shop_settings(tenant_id, settings)
    values (shop_id, '{"pixKey":"","pixHolder":"","minLeadDays":2,"deliveryZones":[]}');
  -- One shop per account: the primary key on user_id rejects an identity that already belongs to a shop.
  insert into private.staff_members(tenant_id, user_id, display_name, role, active, can_view_financial)
    values (shop_id, p_owner_user_id, btrim(p_owner_name), 'owner', true, true);
  return shop_id;
end;
$$;

-- ---------- public wrappers ----------
create function public.public_settings(p_shop text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.public_settings(p_shop); $$;
create function public.public_showcase(p_shop text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.public_showcase(p_shop); $$;
create function public.check_coupon(p_shop text, p_code text, p_phone text, p_subtotal_cents integer) returns jsonb
language sql security invoker set search_path = '' as $$ select private.check_coupon(p_shop, p_code, p_phone, p_subtotal_cents); $$;
create function public.submit_order_request(p_shop text, p_request jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.submit_order_request(p_shop, p_request); $$;

-- Transitional: the order page published before multiclient calls these without a shop.
-- They keep serving Saint Cakes during the deploy and should be dropped once the new page is live.
create or replace function public.public_settings() returns jsonb
language sql security invoker set search_path = '' as $$ select private.public_settings('saint-cakes'); $$;
create or replace function public.public_showcase() returns jsonb
language sql security invoker set search_path = '' as $$ select private.public_showcase('saint-cakes'); $$;
create or replace function public.check_coupon(p_code text, p_phone text, p_subtotal_cents integer) returns jsonb
language sql security invoker set search_path = '' as $$ select private.check_coupon('saint-cakes', p_code, p_phone, p_subtotal_cents); $$;
create or replace function public.submit_order_request(p_request jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.submit_order_request('saint-cakes', p_request); $$;

-- Single-shop implementations replaced above.
drop function private.submit_order_request(jsonb);
drop function private.public_settings();
drop function private.public_showcase();
drop function private.check_coupon(text, text, integer);
drop function private.touch_customer(text, text, text, boolean);
drop function private.is_first_order(text);
drop function private.coupon_quote(text, text, integer);
drop function private.can_edit_showcase();

-- ---------- grants ----------
revoke execute on all functions in schema private from public, anon, authenticated;
do $$
declare signature text;
begin
  foreach signature in array array['current_staff()', 'read_orders()', 'read_production_orders()',
    'save_order(jsonb,integer)', 'set_order_status(uuid,text,integer)', 'list_staff()',
    'set_staff_access(uuid,text,boolean,boolean)', 'read_audit(uuid)',
    'read_order_requests()', 'resolve_order_request(uuid,text)', 'read_settings()', 'save_settings(jsonb)',
    'read_customers()', 'save_customer(text,text,boolean)', 'delete_customer(text)',
    'read_coupons()', 'save_coupon(jsonb)', 'read_showcase()', 'save_showcase_item(jsonb)',
    'convert_order_request(uuid,jsonb)', 'patch_customer(text,text,boolean,integer)'] loop
    execute 'revoke all on function public.' || signature || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || signature || ' to authenticated';
    execute 'grant execute on function private.' || signature || ' to authenticated';
  end loop;
  foreach signature in array array['submit_order_request(text,jsonb)', 'public_settings(text)', 'public_showcase(text)',
    'check_coupon(text,text,text,integer)'] loop
    execute 'revoke all on function public.' || signature || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || signature || ' to anon, authenticated';
    execute 'grant execute on function private.' || signature || ' to anon, authenticated';
  end loop;
  foreach signature in array array['submit_order_request(jsonb)', 'public_settings()', 'public_showcase()',
    'check_coupon(text,text,integer)'] loop
    execute 'revoke all on function public.' || signature || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || signature || ' to anon, authenticated';
  end loop;
  -- Storage evaluates its policies as the signed-in user.
  grant execute on function private.can_edit_showcase_object(text) to authenticated;
end;
$$;
