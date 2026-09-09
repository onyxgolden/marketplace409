-- Stripe Financial Connections prep: converts every owner-management RLS policy on the
-- connection-platform tables from the bare `owner_id = auth.uid()::text` form to
-- `has_workspace_access(owner_id)` -- the same drop-and-recreate-named-policies-only pattern
-- 20260829001300_convert_financial_policies_to_workspace_access.sql already used for
-- financial_accounts/financial_events/account_balances/financial_assets/etc. Those five tables
-- were NOT covered by that checkpoint (confirmed by grepping every migration after it for these
-- table names -- only their own original CREATE TABLE migrations ever reference them), so a
-- co-owner is currently unable to see or manage a shared workspace's connections, credential
-- references, institution references, vaulted credentials, or connection execution history at
-- all -- exactly the gap that would otherwise make Stripe Financial Connections (which reuses
-- these same tables) primary-owner-only in practice, contrary to the rest of Financial FORGE.
--
-- Historical migration files are never edited -- this only drops and recreates the specific named
-- policies below, verbatim by name, on the live tables. No column is added, dropped, or altered;
-- no existing owner_id value is rewritten; no new policy is added beyond what already existed.
-- has_workspace_access(owner_id) is true for the primary owner (falls back to `p_owner_id =
-- auth.uid()::text` when there is no active co-owner membership) and for exactly the single active
-- co-owner of that owner's workspace -- never for an unrelated authenticated user, never for an
-- unauthenticated request. 20 policies, 5 tables.
--
-- Tenant-facing rules: none of these 5 tables have any policy beyond the 4 owner-CRUD ones being
-- converted here (no public-select, no tenant-scoped policy exists on any of them) -- there is
-- nothing else to preserve or disturb.

drop policy "connections_owner_select" on connections;
create policy "connections_owner_select" on connections for select to authenticated
using (has_workspace_access(owner_id));

drop policy "connections_owner_insert" on connections;
create policy "connections_owner_insert" on connections for insert to authenticated
with check (has_workspace_access(owner_id));

drop policy "connections_owner_update" on connections;
create policy "connections_owner_update" on connections for update to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "connections_owner_delete" on connections;
create policy "connections_owner_delete" on connections for delete to authenticated
using (has_workspace_access(owner_id));

drop policy "credential_references_owner_select" on credential_references;
create policy "credential_references_owner_select" on credential_references for select to authenticated
using (has_workspace_access(owner_id));

drop policy "credential_references_owner_insert" on credential_references;
create policy "credential_references_owner_insert" on credential_references for insert to authenticated
with check (has_workspace_access(owner_id));

drop policy "credential_references_owner_update" on credential_references;
create policy "credential_references_owner_update" on credential_references for update to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "credential_references_owner_delete" on credential_references;
create policy "credential_references_owner_delete" on credential_references for delete to authenticated
using (has_workspace_access(owner_id));

drop policy "institution_references_owner_select" on institution_references;
create policy "institution_references_owner_select" on institution_references for select to authenticated
using (has_workspace_access(owner_id));

drop policy "institution_references_owner_insert" on institution_references;
create policy "institution_references_owner_insert" on institution_references for insert to authenticated
with check (has_workspace_access(owner_id));

drop policy "institution_references_owner_update" on institution_references;
create policy "institution_references_owner_update" on institution_references for update to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "institution_references_owner_delete" on institution_references;
create policy "institution_references_owner_delete" on institution_references for delete to authenticated
using (has_workspace_access(owner_id));

drop policy "credential_vault_owner_select" on credential_vault;
create policy "credential_vault_owner_select" on credential_vault for select to authenticated
using (has_workspace_access(owner_id));

drop policy "credential_vault_owner_insert" on credential_vault;
create policy "credential_vault_owner_insert" on credential_vault for insert to authenticated
with check (has_workspace_access(owner_id));

drop policy "credential_vault_owner_update" on credential_vault;
create policy "credential_vault_owner_update" on credential_vault for update to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "credential_vault_owner_delete" on credential_vault;
create policy "credential_vault_owner_delete" on credential_vault for delete to authenticated
using (has_workspace_access(owner_id));

drop policy "connection_execution_history_owner_select" on connection_execution_history;
create policy "connection_execution_history_owner_select" on connection_execution_history for select to authenticated
using (has_workspace_access(owner_id));

drop policy "connection_execution_history_owner_insert" on connection_execution_history;
create policy "connection_execution_history_owner_insert" on connection_execution_history for insert to authenticated
with check (has_workspace_access(owner_id));

drop policy "connection_execution_history_owner_update" on connection_execution_history;
create policy "connection_execution_history_owner_update" on connection_execution_history for update to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "connection_execution_history_owner_delete" on connection_execution_history;
create policy "connection_execution_history_owner_delete" on connection_execution_history for delete to authenticated
using (has_workspace_access(owner_id));
