-- Shop settings edited by the owner: Pix details for messages, delivery fee by neighbourhood
-- and minimum notice for custom items. Public visitors only see the non-sensitive part.
create table private.shop_settings (
  id boolean primary key default true check (id),
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid -- Deliberately no auth FK, as in order_audit.
);
alter table private.shop_settings enable row level security;
revoke all on private.shop_settings from public, anon, authenticated;
insert into private.shop_settings(settings) values ('{"pixKey":"","pixHolder":"","minLeadDays":2,"deliveryZones":[]}');

create function private.validate_settings(value jsonb) returns void
language plpgsql set search_path = '' as $$
declare zone jsonb; names text[] := '{}'; fee numeric; lead numeric;
begin
  if value is null or jsonb_typeof(value) <> 'object' or (select count(*) from jsonb_object_keys(value)) <> 4
    or not value ?& array['pixKey','pixHolder','minLeadDays','deliveryZones']
    or jsonb_typeof(value -> 'pixKey') <> 'string' or jsonb_typeof(value -> 'pixHolder') <> 'string'
    or jsonb_typeof(value -> 'minLeadDays') <> 'number' or jsonb_typeof(value -> 'deliveryZones') <> 'array'
    or private.utf16_length(value ->> 'pixKey') > 140 or private.utf16_length(value ->> 'pixHolder') > 100
    or jsonb_array_length(value -> 'deliveryZones') > 60 then raise exception 'invalid'; end if;
  lead := (value ->> 'minLeadDays')::numeric;
  if lead < 0 or lead > 30 or trunc(lead) <> lead then raise exception 'invalid'; end if;
  for zone in select * from jsonb_array_elements(value -> 'deliveryZones') loop
    if jsonb_typeof(zone) <> 'object' or (select count(*) from jsonb_object_keys(zone)) <> 2
      or not zone ?& array['name','feeCents'] or jsonb_typeof(zone -> 'name') <> 'string'
      or jsonb_typeof(zone -> 'feeCents') <> 'number'
      or private.utf16_length(zone ->> 'name') not between 1 and 60 or btrim(zone ->> 'name') <> zone ->> 'name'
      or lower(zone ->> 'name') = any(names) then raise exception 'invalid'; end if;
    fee := (zone ->> 'feeCents')::numeric;
    if fee < 0 or fee > 100000 or trunc(fee) <> fee then raise exception 'invalid'; end if;
    names := array_append(names, lower(zone ->> 'name'));
  end loop;
exception when others then
  raise exception using errcode = 'P0001', message = 'INVALID_SETTINGS';
end;
$$;

create function private.read_settings() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff(); result jsonb;
begin
  -- Pix details appear in messages to customers, so staff with financial access may read them.
  if not (member.role = 'owner' or member.can_view_financial) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  select settings into result from private.shop_settings;
  return result;
end;
$$;

create function private.save_settings(p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff(); result jsonb;
begin
  if member.role <> 'owner' then raise exception using errcode = 'P0001', message = 'ACCESS_DENIED'; end if;
  perform private.validate_settings(p_settings);
  -- The API session enables pg_safeupdate, which rejects an UPDATE without WHERE.
  update private.shop_settings set settings = p_settings, updated_at = clock_timestamp(), updated_by = member.user_id
    where id returning settings into result;
  return result;
end;
$$;

create function private.public_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('minLeadDays', settings -> 'minLeadDays', 'deliveryZones', settings -> 'deliveryZones')
  from private.shop_settings;
$$;

-- Same contract as before plus an optional deliveryZone. The fee line is added by the server
-- from the owner's table, and quoted (unpriced) items respect the minimum notice.
create or replace function private.submit_order_request(p_request jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  -- ECMAScript String.trim whitespace, as in validate_order.
  blank constant text := E' \t\n\r\f' || chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  value jsonb := p_request; item jsonb; field text; quantity numeric; price numeric;
  civil_date date; today date := (now() at time zone 'America/Sao_Paulo')::date;
  digits text; lines jsonb := '[]'::jsonb; key_count integer; quoted boolean := false;
  shop jsonb; zones jsonb; zone_name text := ''; zone jsonb;
begin
  select settings into shop from private.shop_settings;
  zones := coalesce(shop -> 'deliveryZones', '[]'::jsonb);
  begin
    key_count := (select count(*) from jsonb_object_keys(value));
    if value is null or jsonb_typeof(value) <> 'object'
      or not (key_count = 8 or (key_count = 9 and value ? 'deliveryZone')) or not value ?&
      array['customer','phone','date','time','fulfillment','address','notes','lines'] then raise exception 'invalid'; end if;
    foreach field in array array['customer','phone','date','time','fulfillment','address','notes'] loop
      if jsonb_typeof(value -> field) <> 'string' then raise exception 'invalid'; end if;
    end loop;
    if value ? 'deliveryZone' then
      if jsonb_typeof(value -> 'deliveryZone') <> 'string' then raise exception 'invalid'; end if;
      zone_name := value ->> 'deliveryZone';
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
      if jsonb_typeof(item) <> 'object' or (select count(*) from jsonb_object_keys(item)) <> 4
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
      -- Prices are the customer's estimate only; the team confirms values on conversion.
      lines := lines || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(),
        'description', btrim(item ->> 'description', blank), 'quantity', item -> 'quantity',
        'unit', item ->> 'unit', 'unitPriceCents', item -> 'unitPriceCents'));
    end loop;
    if quoted and civil_date < today + coalesce((shop ->> 'minLeadDays')::integer, 0) then raise exception 'invalid'; end if;
    if value ->> 'fulfillment' = 'delivery' and jsonb_array_length(zones) > 0 then
      select z into zone from jsonb_array_elements(zones) z where z ->> 'name' = zone_name;
      if zone is null then raise exception 'invalid'; end if;
      if (zone ->> 'feeCents')::integer > 0 then
        lines := lines || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(),
          'description', 'Frete · ' || (zone ->> 'name'), 'quantity', 1, 'unit', 'un', 'unitPriceCents', zone -> 'feeCents'));
      end if;
    elsif zone_name <> '' then raise exception 'invalid';
    end if;
  exception when others then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end;
  -- Serialize submissions so the abuse limits cannot be raced.
  perform pg_advisory_xact_lock(1935765876, 2);
  if (select count(*) from private.order_requests where created_at > clock_timestamp() - interval '10 minutes') >= 20
    or (select count(*) from private.order_requests where phone_digits = digits and created_at > clock_timestamp() - interval '1 day') >= 5
    or (select count(*) from private.order_requests where status = 'new') >= 300 then
    raise exception using errcode = 'P0001', message = 'REQUEST_LIMIT';
  end if;
  insert into private.order_requests(payload, phone_digits) values (jsonb_build_object(
    'customer', btrim(value ->> 'customer', blank), 'phone', btrim(value ->> 'phone', blank),
    'date', value ->> 'date', 'time', value ->> 'time', 'fulfillment', value ->> 'fulfillment',
    'address', btrim(value ->> 'address', blank), 'notes', btrim(value ->> 'notes', blank), 'lines', lines), digits);
  -- Return nothing identifying: anonymous callers cannot read requests back.
  return jsonb_build_object('received', true);
end;
$$;

create function public.read_settings() returns jsonb
language sql security invoker set search_path = '' as $$ select private.read_settings(); $$;
create function public.save_settings(p_settings jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.save_settings(p_settings); $$;
create function public.public_settings() returns jsonb
language sql security invoker set search_path = '' as $$ select private.public_settings(); $$;

revoke execute on all functions in schema private from public, anon, authenticated;
do $$
declare signature text;
begin
  foreach signature in array array['current_staff()', 'read_orders()', 'read_production_orders()',
    'save_order(jsonb,integer)', 'set_order_status(uuid,text,integer)', 'list_staff()',
    'set_staff_access(uuid,text,boolean,boolean)', 'read_audit(uuid)',
    'read_order_requests()', 'resolve_order_request(uuid,text)', 'read_settings()', 'save_settings(jsonb)'] loop
    execute 'revoke all on function public.' || signature || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || signature || ' to authenticated';
    execute 'grant execute on function private.' || signature || ' to authenticated';
  end loop;
  foreach signature in array array['submit_order_request(jsonb)', 'public_settings()'] loop
    execute 'revoke all on function public.' || signature || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || signature || ' to anon, authenticated';
    execute 'grant execute on function private.' || signature || ' to anon, authenticated';
  end loop;
end;
$$;
