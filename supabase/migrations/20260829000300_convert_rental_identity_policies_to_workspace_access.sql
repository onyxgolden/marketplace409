-- Shared FORGE workspace membership -- Checkpoint 3, group 1/5 (identity/units/leases). Converts
-- owner-management RLS policies from `owner_id = auth.uid()::text` to `has_workspace_access(owner_id)`
-- so an active co-owner gets the same access as the primary owner. Tenant-facing policies
-- (rental_units_tenant_select, rental_tenants_self_select, rental_leases_tenant_select,
-- rental_lease_tenants_tenant_select) are deliberately untouched -- confirmed via a live query
-- against pg_policies that their predicates never reference owner_id/auth.uid() at all, only
-- rental_actor_has_*_access()/auth_user_id, so nothing here can affect tenant scope.
--
-- Historical migration files are never edited -- this new migration only drops and recreates the
-- specific named policies below, layered on top of 20260812000100_create_rental_identity.sql.
-- Exact policy names, tables, and command shapes (for/select/insert/update/delete) were confirmed
-- against the live linked Production database (pg_policies), not re-derived from migration history,
-- per the approved workspace-membership plan.

drop policy "rental_units_owner_all" on rental_units;
create policy "rental_units_owner_all" on rental_units for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_tenants_owner_all" on rental_tenants;
create policy "rental_tenants_owner_all" on rental_tenants for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_leases_owner_all" on rental_leases;
create policy "rental_leases_owner_all" on rental_leases for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_lease_tenants_owner_all" on rental_lease_tenants;
create policy "rental_lease_tenants_owner_all" on rental_lease_tenants for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
