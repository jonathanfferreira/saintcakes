-- Keep inventory/customer edits optimistic and request conversion atomic.

create or replace function private.showcase_json(s private.showcase_items) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description, 'unit', s.unit,
    'priceCents', s.price_cents, 'stock', s.stock, 'photoPath', s.photo_path, 'active', s.active,
    'sort', s.sort, 'updatedAt', s.updated_at);
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
    select * into s from private.showcase_items where id = target for update;
    if not found or s.updated_at is distinct from expected_updated_at then
      raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT';
    end if;
  end if;

  begin
    if target is null then
      insert into private.showcase_items(name, description, unit, price_cents, stock, photo_path, active, sort)
      values (btrim(p_item ->> 'name'), btrim(p_item ->> 'description'), p_item ->> 'unit',
        (p_item ->> 'priceCents')::integer, qty, nullif(p_item ->> 'photoPath', ''),
        (p_item ->> 'active')::boolean, (p_item ->> 'sort')::integer) returning * into s;
    else
      update private.showcase_items set name = btrim(p_item ->> 'name'), description = btrim(p_item ->> 'description'),
        unit = p_item ->> 'unit', price_cents = (p_item ->> 'priceCents')::integer, stock = qty,
        photo_path = nullif(p_item ->> 'photoPath', ''), active = (p_item ->> 'active')::boolean,
        sort = (p_item ->> 'sort')::integer, updated_at = clock_timestamp()
        where id = target returning * into s;
    end if;
  exception when others then
    raise exception using errcode = 'P0001', message = 'INVALID_SHOWCASE';
  end;
  return private.showcase_json(s);
end;
$$;

alter table private.order_requests add column converted_order_id uuid unique
  references private.order_records(id) on delete restrict;

create function private.validate_reserved_showcase_lines(p_request_payload jsonb, p_order jsonb) returns void
language plpgsql set search_path = '' as $$
declare reserved jsonb;
begin
  if jsonb_typeof(p_order -> 'lines') is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'SHOWCASE_RESERVED';
  end if;
  for reserved in select * from jsonb_array_elements(p_request_payload -> 'lines') loop
    if reserved ? 'showcaseId' and not exists (
      select 1 from jsonb_array_elements(p_order -> 'lines') candidate
      where candidate -> 'id' = reserved -> 'id' and candidate -> 'quantity' = reserved -> 'quantity'
        and candidate -> 'unit' = reserved -> 'unit'
    ) then
      raise exception using errcode = 'P0001', message = 'SHOWCASE_RESERVED';
    end if;
  end loop;
end;
$$;

create function private.preserve_reserved_showcase_lines() returns trigger
language plpgsql security definer set search_path = '' as $$
declare request_payload jsonb;
begin
  select payload into request_payload from private.order_requests where converted_order_id = new.id;
  if found then perform private.validate_reserved_showcase_lines(request_payload, new.payload); end if;
  return new;
end;
$$;
create trigger preserve_reserved_showcase_lines before update on private.order_records
for each row execute function private.preserve_reserved_showcase_lines();

create function private.convert_order_request(p_id uuid, p_order jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  member private.staff_members := private.require_order_editor();
  request private.order_requests; saved jsonb;
begin
  -- Same order as submit: global submission lock, then request/inventory locks.
  perform pg_advisory_xact_lock(1935765876, 2);
  select * into request from private.order_requests where id = p_id for update;
  if not found or request.status <> 'new' then
    raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT';
  end if;
  perform private.validate_reserved_showcase_lines(request.payload, p_order);
  saved := private.save_order(p_order, null);
  perform private.resolve_order_request(p_id, 'converted');
  update private.order_requests set converted_order_id = (saved -> 'order' ->> 'id')::uuid where id = p_id;
  return saved;
end;
$$;

create function public.convert_order_request(p_id uuid, p_order jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.convert_order_request(p_id, p_order); $$;

create or replace function private.coupon_quote(p_code text, p_key text, p_subtotal integer) returns jsonb
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
  if discount <= 0 or discount >= p_subtotal then
    raise exception using errcode = 'P0001', message = 'COUPON_MIN_ORDER';
  end if;
  return jsonb_build_object('id', c.id, 'code', c.code, 'description', c.description, 'discountCents', discount);
end;
$$;

-- Seed the central from history without changing any existing customer or consent.
-- The newest historical contact supplies the name; both date bounds remain historical.
with history as (
  select private.phone_key(payload ->> 'phone') as phone_key, payload ->> 'customer' as name,
    payload ->> 'phone' as phone, 'equipe'::text as source, created_at
    from private.order_records
  union all
  select private.phone_key(payload ->> 'phone'), payload ->> 'customer', payload ->> 'phone', 'site', created_at
    from private.order_requests
), eligible as (
  select * from history where phone_key ~ '^[0-9]{10,11}$' and length(btrim(coalesce(name, ''))) > 0
), dates as (
  select phone_key, min(created_at) as first_seen, max(created_at) as last_seen from eligible group by phone_key
), latest as (
  select distinct on (phone_key) phone_key, name, phone, source
    from eligible order by phone_key, created_at desc, source, name, phone
)
insert into private.customers(phone_key, name, phone, source, marketing_opt_in, first_seen, last_seen)
select l.phone_key, left(btrim(l.name), 100), left(btrim(l.phone), 30), l.source, false, d.first_seen, d.last_seen
  from latest l join dates d using (phone_key)
on conflict (phone_key) do nothing;

alter table private.customers add column revision integer not null default 1 check (revision > 0);
create function private.bump_customer_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;
create trigger customer_revision before update on private.customers
for each row execute function private.bump_customer_revision();

create function private.customer_json(c private.customers) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('key', c.phone_key, 'name', c.name, 'phone', c.phone, 'source', c.source,
    'marketingOptIn', c.marketing_opt_in, 'optInAt', c.opt_in_at, 'optInSource', c.opt_in_source,
    'notes', c.notes, 'firstSeen', c.first_seen, 'lastSeen', c.last_seen, 'revision', c.revision);
$$;

create or replace function private.read_customers() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_order_editor(); result jsonb;
begin
  select coalesce(jsonb_agg(private.customer_json(c) order by c.last_seen desc), '[]'::jsonb)
    into result from private.customers c;
  return result;
end;
$$;

create function private.patch_customer(p_key text, p_notes text, p_marketing_opt_in boolean, p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_order_editor(); customer private.customers;
begin
  select * into customer from private.customers where phone_key = p_key for update;
  if not found or p_expected_revision is distinct from customer.revision then
    raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT';
  end if;
  perform private.save_customer(p_key, p_notes, p_marketing_opt_in);
  select * into customer from private.customers where phone_key = p_key;
  return private.customer_json(customer);
end;
$$;

create function public.patch_customer(p_key text, p_notes text, p_marketing_opt_in boolean, p_expected_revision integer) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.patch_customer(p_key, p_notes, p_marketing_opt_in, p_expected_revision);
$$;

revoke all on function private.showcase_json(private.showcase_items), private.coupon_quote(text,text,integer),
  private.bump_customer_revision(), private.customer_json(private.customers),
  private.validate_reserved_showcase_lines(jsonb,jsonb), private.preserve_reserved_showcase_lines()
  from public, anon, authenticated;
revoke all on function private.convert_order_request(uuid,jsonb), public.convert_order_request(uuid,jsonb),
  private.patch_customer(text,text,boolean,integer), public.patch_customer(text,text,boolean,integer)
  from public, anon, authenticated;
grant execute on function private.convert_order_request(uuid,jsonb), public.convert_order_request(uuid,jsonb),
  private.patch_customer(text,text,boolean,integer), public.patch_customer(text,text,boolean,integer) to authenticated;
