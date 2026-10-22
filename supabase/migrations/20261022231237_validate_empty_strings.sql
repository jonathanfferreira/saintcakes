-- regexp_split_to_table('', '') yields one empty row, which must count as zero UTF-16 units.
create or replace function private.utf16_length(value text) returns bigint
language sql immutable strict set search_path = '' as $$
  select coalesce(sum(case when character = '' then 0
    when ascii(character) > 65535 then 2 else 1 end), 0)
  from regexp_split_to_table(value, '') as character;
$$;
revoke execute on function private.utf16_length(text) from public, anon, authenticated;
