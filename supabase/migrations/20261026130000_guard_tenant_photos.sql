-- A showcase item may reference only a photo in its own shop's folder.
-- Existing Saint Cakes uploads predate tenant folders and keep their legacy path.
create function private.guard_showcase_photo_path() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.photo_path is null then return new; end if;

  if new.photo_path ~ ('^' || new.tenant_id::text || '/showcase/[A-Za-z0-9_.-]+\.(jpg|png|webp)$')
    or (new.tenant_id = 'a0000000-0000-4000-8000-000000000001'::uuid
      and new.photo_path ~ '^showcase/[A-Za-z0-9_.-]+\.(jpg|png|webp)$') then
    return new;
  end if;

  raise exception using errcode = 'P0001', message = 'INVALID_SHOWCASE';
end;
$$;

revoke execute on function private.guard_showcase_photo_path() from public, anon, authenticated;

create trigger guard_showcase_photo_path
before insert or update of photo_path, tenant_id on private.showcase_items
for each row execute function private.guard_showcase_photo_path();
