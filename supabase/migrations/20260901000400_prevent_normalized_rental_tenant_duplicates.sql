create or replace function prevent_normalized_rental_tenant_duplicate()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  normalized_email text := lower(btrim(new.email));
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id || ':' || normalized_email, 0));
  if exists (
    select 1 from rental_tenants tenant
    where tenant.owner_id = new.owner_id
      and tenant.id <> new.id
      and lower(btrim(tenant.email)) = normalized_email
  ) then
    raise exception using errcode = '23505', message = 'A tenant with this email already exists.';
  end if;
  new.email := normalized_email;
  return new;
end;
$$;

drop trigger if exists rental_tenants_prevent_normalized_duplicate on rental_tenants;
create trigger rental_tenants_prevent_normalized_duplicate
before insert or update of email on rental_tenants
for each row execute function prevent_normalized_rental_tenant_duplicate();
