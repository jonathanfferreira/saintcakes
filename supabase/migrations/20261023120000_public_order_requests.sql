-- Public order requests: customers submit, the team reviews and converts them into orders.
-- Requests never enter private.order_records directly.
create table private.order_requests (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  phone_digits text not null,
  status text not null default 'new' check (status in ('new', 'converted', 'dismissed')),
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid -- Deliberately no auth FK, as in order_audit.
);
create index order_requests_status_time_idx on private.order_requests(status, created_at);
create index order_requests_phone_time_idx on private.order_requests(phone_digits, created_at);
alter table private.order_requests enable row level security;
revoke all on private.order_requests from public, anon, authenticated;

create function private.submit_order_request(p_request jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  -- ECMAScript String.trim whitespace, as in validate_order.
  blank constant text := E' \t\n\r\f' || chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  value jsonb := p_request; item jsonb; field text; quantity numeric; price numeric;
  civil_date date; today date := (now() at time zone 'America/Sao_Paulo')::date;
  digits text; lines jsonb := '[]'::jsonb;
begin
  begin
    if value is null or jsonb_typeof(value) <> 'object'
      or (select count(*) from jsonb_object_keys(value)) <> 8 or not value ?&
      array['customer','phone','date','time','fulfillment','address','notes','lines'] then raise exception 'invalid'; end if;
    foreach field in array array['customer','phone','date','time','fulfillment','address','notes'] loop
      if jsonb_typeof(value -> field) <> 'string' then raise exception 'invalid'; end if;
    end loop;
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
      -- Prices are the customer's estimate only; the team confirms values on conversion.
      lines := lines || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(),
        'description', btrim(item ->> 'description', blank), 'quantity', item -> 'quantity',
        'unit', item ->> 'unit', 'unitPriceCents', item -> 'unitPriceCents'));
    end loop;
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

create function private.require_order_editor() returns private.staff_members
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff();
begin
  if member.role not in ('owner','attendant') or not (member.role = 'owner' or member.can_view_financial) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  return member;
end;
$$;

create function private.read_order_requests() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_order_editor(); result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'request', payload,
    'createdAt', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by created_at, id), '[]'::jsonb)
    into result from private.order_requests where status = 'new';
  return result;
end;
$$;

create function private.resolve_order_request(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_order_editor();
begin
  if p_status is null or p_status not in ('converted','dismissed') then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;
  update private.order_requests set status = p_status, resolved_at = clock_timestamp(), resolved_by = member.user_id
    where id = p_id and status = 'new';
  if not found then raise exception using errcode = 'P0001', message = 'ORDER_CONFLICT'; end if;
  return jsonb_build_object('id', p_id, 'status', p_status);
end;
$$;

create function public.submit_order_request(p_request jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.submit_order_request(p_request); $$;
create function public.read_order_requests() returns jsonb
language sql security invoker set search_path = '' as $$ select private.read_order_requests(); $$;
create function public.resolve_order_request(p_id uuid, p_status text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.resolve_order_request(p_id, p_status); $$;

revoke execute on all functions in schema private from public, anon, authenticated;
-- Anonymous visitors reach only the submit endpoint; every table stays revoked with deny-all RLS.
grant usage on schema private to anon;
do $$
declare signature text;
begin
  foreach signature in array array['current_staff()', 'read_orders()', 'read_production_orders()',
    'save_order(jsonb,integer)', 'set_order_status(uuid,text,integer)', 'list_staff()',
    'set_staff_access(uuid,text,boolean,boolean)', 'read_audit(uuid)',
    'read_order_requests()', 'resolve_order_request(uuid,text)'] loop
    execute 'revoke all on function public.' || signature || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || signature || ' to authenticated';
    execute 'grant execute on function private.' || signature || ' to authenticated';
  end loop;
  revoke all on function public.submit_order_request(jsonb) from public, anon, authenticated;
  grant execute on function public.submit_order_request(jsonb) to anon, authenticated;
  grant execute on function private.submit_order_request(jsonb) to anon, authenticated;
end;
$$;
