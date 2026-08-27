-- Owner-only household profile data. Full Social Security numbers are intentionally prohibited;
-- only the last four digits may be retained. Tenant portal policies remain unchanged.
alter table rental_tenants add column if not exists work_phone text;
alter table rental_tenants add column if not exists date_of_birth date;
alter table rental_tenants add column if not exists employer_name text;
alter table rental_tenants add column if not exists employer_phone text;
alter table rental_tenants add column if not exists monthly_income_cents bigint check (monthly_income_cents is null or monthly_income_cents >= 0);
alter table rental_tenants add column if not exists emergency_contact_name text;
alter table rental_tenants add column if not exists emergency_contact_phone text;
alter table rental_tenants add column if not exists application_status text
  check (application_status is null or application_status in ('not_started','received','screening','approved','denied','withdrawn'));
alter table rental_tenants add column if not exists application_submitted_at timestamptz;
alter table rental_tenants add column if not exists screening_provider text;
alter table rental_tenants add column if not exists screening_reference text;
alter table rental_tenants add column if not exists screening_status text
  check (screening_status is null or screening_status in ('not_started','pending','complete','review_required'));
alter table rental_tenants add column if not exists screening_completed_at timestamptz;
alter table rental_tenants add column if not exists ssn_last_four text
  check (ssn_last_four is null or ssn_last_four ~ '^[0-9]{4}$');
alter table rental_tenants add column if not exists landlord_notes text;

alter table rental_lease_tenants add column if not exists occupancy_role text;

with ranked as (
  select owner_id, lease_id, tenant_id,
    row_number() over (partition by owner_id, lease_id order by created_at, tenant_id) as position
  from rental_lease_tenants
)
update rental_lease_tenants membership
set occupancy_role = case when ranked.position = 1 then 'primary' else 'co_tenant' end
from ranked
where membership.owner_id = ranked.owner_id and membership.lease_id = ranked.lease_id
  and membership.tenant_id = ranked.tenant_id and membership.occupancy_role is null;

alter table rental_lease_tenants alter column occupancy_role set default 'co_tenant';
alter table rental_lease_tenants alter column occupancy_role set not null;
alter table rental_lease_tenants drop constraint if exists rental_lease_tenants_occupancy_role_check;
alter table rental_lease_tenants add constraint rental_lease_tenants_occupancy_role_check
  check (occupancy_role in ('primary','co_tenant'));
create unique index if not exists idx_rental_lease_one_primary_tenant
  on rental_lease_tenants(owner_id, lease_id) where occupancy_role = 'primary';

create or replace function set_rental_primary_tenant(p_owner_id text, p_lease_id text, p_tenant_id text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not has_workspace_access(p_owner_id) then raise exception 'Workspace access is required.'; end if;
  if not exists(select 1 from rental_lease_tenants where owner_id=p_owner_id and lease_id=p_lease_id and tenant_id=p_tenant_id)
    then raise exception 'Tenant is not a member of this lease.'; end if;
  update rental_lease_tenants set occupancy_role='co_tenant'
    where owner_id=p_owner_id and lease_id=p_lease_id and occupancy_role='primary';
  update rental_lease_tenants set occupancy_role='primary'
    where owner_id=p_owner_id and lease_id=p_lease_id and tenant_id=p_tenant_id;
end;
$$;
revoke all on function set_rental_primary_tenant(text,text,text) from public, anon;
grant execute on function set_rental_primary_tenant(text,text,text) to authenticated;

