-- Match ECMAScript String.trim for the required delivery address.
create or replace function private.validate_order(value jsonb) returns void
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
  if total <= 0 or received > total then raise exception 'invalid'; end if;
exception when others then
  raise exception using errcode = 'P0001', message = 'INVALID_ORDER';
end;
$$;

revoke execute on function private.validate_order(jsonb) from public, anon, authenticated;
