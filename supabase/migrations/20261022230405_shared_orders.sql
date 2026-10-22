-- Single Saint Cakes shop. Only audited RPCs may touch these tables.
create schema private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table private.staff_members (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  role text not null check (role in ('owner', 'attendant', 'production')),
  active boolean not null default true,
  can_view_financial boolean not null default false,
  constraint owner_has_finance check (role <> 'owner' or can_view_financial)
);
create table private.order_records (
  id uuid primary key,
  number bigint generated always as identity unique check (number between 1 and 9007199254740991),
  revision integer not null default 1 check (revision > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create table private.order_audit (
  id bigint generated always as identity primary key,
  order_id uuid not null references private.order_records(id) on delete restrict,
  revision integer not null,
  actor_id uuid not null, -- Deliberately no auth FK: deleting an identity must not erase history.
  actor_name text not null,
  action text not null check (action in ('created', 'updated', 'status_changed')),
  created_at timestamptz not null default clock_timestamp(),
  unique (order_id, revision)
);
create index order_audit_order_time_idx on private.order_audit(order_id, created_at, id);
alter table private.staff_members enable row level security;
alter table private.order_records enable row level security;
alter table private.order_audit enable row level security;
-- No policies: deny all raw access, including after an accidental future table grant.
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;

create function private.reject_audit_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'AUDIT_APPEND_ONLY';
end;
$$;
create trigger audit_append_only before update or delete on private.order_audit
for each row execute function private.reject_audit_mutation();

create function private.require_staff() returns private.staff_members
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  select * into member from private.staff_members
    where user_id = auth.uid() and active for share;
  if not found then raise exception using errcode = 'P0001', message = 'ACCESS_DENIED'; end if;
  return member;
end;
$$;

create function private.staff_json(member private.staff_members) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('userId', member.user_id, 'displayName', member.display_name,
    'role', member.role, 'canViewFinancial', member.role = 'owner' or member.can_view_financial,
    'active', member.active);
$$;

create function private.utf16_length(value text) returns bigint
language sql immutable strict set search_path = '' as $$
  select coalesce(sum(case when ascii(character) > 65535 then 2 else 1 end), 0)
  from regexp_split_to_table(value, '') as character;
$$;

create function private.validate_order(value jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  item jsonb; field text; quantity numeric; price numeric; total numeric := 0;
  received numeric; ids text[] := '{}'; item_id text; civil_date date;
begin
  if value is null or jsonb_typeof(value) <> 'object' then raise exception 'invalid'; end if;
  if (select count(*) from jsonb_object_keys(value)) <> 13 or not value ?&
    array['id','number','customer','phone','date','time','fulfillment','address','notes','lines',
          'receivedCents','status','createdAt'] then raise exception 'invalid'; end if;
  foreach field in array array['id','customer','phone','date','time','fulfillment','address','notes','status','createdAt'] loop
    if jsonb_typeof(value -> field) <> 'string' then raise exception 'invalid'; end if;
  end loop;
  perform (value ->> 'id')::uuid;
  if jsonb_typeof(value -> 'number') <> 'number' or (value ->> 'number')::numeric < 1
    or (value ->> 'number')::numeric > 9007199254740991
    or trunc((value ->> 'number')::numeric) <> (value ->> 'number')::numeric
    or private.utf16_length(value ->> 'customer') not between 2 and 100
    or private.utf16_length(value ->> 'phone') > 30
    or private.utf16_length(value ->> 'address') > 300
    or private.utf16_length(value ->> 'notes') > 2000
    or value ->> 'fulfillment' not in ('pickup','delivery')
    or (value ->> 'fulfillment' = 'delivery' and btrim(value ->> 'address') = '')
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
  if total <= 0 or received > total then raise exception 'invalid'; end if;
exception when others then
  raise exception using errcode = 'P0001', message = 'INVALID_ORDER';
end;
$$;

create function private.production_order(value jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', value -> 'id', 'number', value -> 'number',
    'customer', value -> 'customer', 'date', value -> 'date', 'time', value -> 'time',
    'fulfillment', value -> 'fulfillment', 'notes', value -> 'notes', 'status', value -> 'status',
    'lines', (select jsonb_agg(jsonb_build_object('id', item -> 'id',
      'description', item -> 'description', 'quantity', item -> 'quantity', 'unit', item -> 'unit') order by ordinal)
      from jsonb_array_elements(value -> 'lines') with ordinality as lines(item, ordinal)));
$$;

create function private.current_staff() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff();
begin return private.staff_json(member) - 'active'; end;
$$;

create function private.read_orders() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff(); result jsonb;
begin
  if not (member.role = 'owner' or member.can_view_financial) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('order', payload, 'revision', revision) order by number), '[]'::jsonb)
    into result from private.order_records;
  return result;
end;
$$;

create function private.read_production_orders() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff(); result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('order', private.production_order(payload), 'revision', revision)
    order by number), '[]'::jsonb) into result from private.order_records;
  return result;
end;
$$;

create function private.save_order(p_order jsonb, p_expected_revision integer default null) returns jsonb
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
  return jsonb_build_object('order', record.payload, 'revision', record.revision);
end;
$$;

create function private.set_order_status(p_id uuid, p_status text, p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff(); record private.order_records; result jsonb;
begin
  select * into record from private.order_records where id = p_id for update;
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
    revision = revision + 1, updated_at = clock_timestamp() where id = p_id returning * into record;
  insert into private.order_audit(order_id, revision, actor_id, actor_name, action)
    values (record.id, record.revision, member.user_id, member.display_name, 'status_changed');
  result := case when member.role = 'owner' or member.can_view_financial then record.payload
    else private.production_order(record.payload) end;
  return jsonb_build_object('order', result, 'revision', record.revision);
end;
$$;

create function private.list_staff() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff(); result jsonb;
begin
  if member.role <> 'owner' then raise exception using errcode = 'P0001', message = 'ACCESS_DENIED'; end if;
  select coalesce(jsonb_agg(private.staff_json(staff) order by display_name, user_id), '[]'::jsonb)
    into result from private.staff_members staff;
  return result;
end;
$$;

create function private.set_staff_access(p_user_id uuid, p_role text, p_active boolean,
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
  select * into target from private.staff_members where user_id = p_user_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'ACCESS_DENIED'; end if;
  if target.role = 'owner' and target.active and (p_role <> 'owner' or not p_active)
    and (select count(*) from private.staff_members where role = 'owner' and active) <= 1 then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  update private.staff_members set role = p_role, active = p_active,
    can_view_financial = p_can_view_financial where user_id = p_user_id returning * into target;
  return private.staff_json(target);
end;
$$;

create function private.read_audit(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.staff_members := private.require_staff(); result jsonb;
begin
  if not (member.role = 'owner' or member.can_view_financial) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('actorName', actor_name, 'action', action,
    'createdAt', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'revision', revision) order by revision), '[]'::jsonb)
    into result from private.order_audit where order_id = p_order_id;
  return result;
end;
$$;

-- Public endpoints are invokers. Privileged implementations remain outside exposed schemas.
create function public.current_staff() returns jsonb language sql security invoker set search_path = ''
as $$ select private.current_staff(); $$;
create function public.read_orders() returns jsonb language sql security invoker set search_path = ''
as $$ select private.read_orders(); $$;
create function public.read_production_orders() returns jsonb language sql security invoker set search_path = ''
as $$ select private.read_production_orders(); $$;
create function public.save_order(p_order jsonb, p_expected_revision integer default null) returns jsonb
language sql security invoker set search_path = '' as $$ select private.save_order(p_order, p_expected_revision); $$;
create function public.set_order_status(p_id uuid, p_status text, p_expected_revision integer) returns jsonb
language sql security invoker set search_path = '' as $$ select private.set_order_status(p_id, p_status, p_expected_revision); $$;
create function public.list_staff() returns jsonb language sql security invoker set search_path = ''
as $$ select private.list_staff(); $$;
create function public.set_staff_access(p_user_id uuid, p_role text, p_active boolean, p_can_view_financial boolean) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.set_staff_access(p_user_id, p_role, p_active, p_can_view_financial); $$;
create function public.read_audit(p_order_id uuid) returns jsonb language sql security invoker set search_path = ''
as $$ select private.read_audit(p_order_id); $$;

revoke execute on all functions in schema private from public, anon, authenticated;
do $$
declare signature text;
begin
  foreach signature in array array['current_staff()', 'read_orders()', 'read_production_orders()',
    'save_order(jsonb,integer)', 'set_order_status(uuid,text,integer)', 'list_staff()',
    'set_staff_access(uuid,text,boolean,boolean)', 'read_audit(uuid)'] loop
    execute 'revoke all on function public.' || signature || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || signature || ' to authenticated';
    execute 'grant execute on function private.' || signature || ' to authenticated';
  end loop;
end;
$$;
