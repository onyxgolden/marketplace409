-- Shared FORGE workspace membership -- Checkpoint 4 (RLS half), Financial FORGE. Converts every
-- owner-management RLS policy from `owner_id = auth.uid()::text` (or the uuid-typed
-- `auth.uid() = owner_id` form used by account_balances/financial_assets/financial_asset_valuations/
-- investment_accounts/investment_account_valuations) to `has_workspace_access(owner_id)` --
-- Postgres resolves the correct text/uuid overload automatically from owner_id's column type, so
-- one call form works uniformly across both typings.
--
-- simplifi_account_mappings and simplifi_import_rows carry a compound with_check -- their own
-- owner_id AND a transitive check that the financial_accounts row they link to also belongs to the
-- same workspace -- both halves of that check are converted, not just the outer one, or a co-owner
-- could link a mapping to a financial_account outside the shared workspace.
--
-- 20 policies, 11 tables. Every policy name and predicate confirmed against the live linked
-- Production database (pg_policies), not re-derived from migration history. Historical migration
-- files are never edited -- this only drops and recreates the specific named policies below.

drop policy "financial_accounts_owner_delete" on financial_accounts;
create policy "financial_accounts_owner_delete" on financial_accounts for delete to authenticated
using (has_workspace_access(owner_id));

drop policy "financial_accounts_owner_insert" on financial_accounts;
create policy "financial_accounts_owner_insert" on financial_accounts for insert to authenticated
with check (has_workspace_access(owner_id));

drop policy "financial_accounts_owner_select" on financial_accounts;
create policy "financial_accounts_owner_select" on financial_accounts for select to authenticated
using (has_workspace_access(owner_id));

drop policy "financial_accounts_owner_update" on financial_accounts;
create policy "financial_accounts_owner_update" on financial_accounts for update to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "financial_events_owner_delete" on financial_events;
create policy "financial_events_owner_delete" on financial_events for delete to authenticated
using (has_workspace_access(owner_id));

drop policy "financial_events_owner_insert" on financial_events;
create policy "financial_events_owner_insert" on financial_events for insert to authenticated
with check (has_workspace_access(owner_id));

drop policy "financial_events_owner_select" on financial_events;
create policy "financial_events_owner_select" on financial_events for select to authenticated
using (has_workspace_access(owner_id));

drop policy "financial_events_owner_update" on financial_events;
create policy "financial_events_owner_update" on financial_events for update to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "Users can delete their own account balances" on account_balances;
create policy "Users can delete their own account balances" on account_balances for delete to authenticated
using (has_workspace_access(owner_id));

drop policy "Users can insert their own account balances" on account_balances;
create policy "Users can insert their own account balances" on account_balances for insert to authenticated
with check (has_workspace_access(owner_id));

drop policy "Users can select their own account balances" on account_balances;
create policy "Users can select their own account balances" on account_balances for select to authenticated
using (has_workspace_access(owner_id));

drop policy "Users can update their own account balances" on account_balances;
create policy "Users can update their own account balances" on account_balances for update to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "financial_assets_owner_all" on financial_assets;
create policy "financial_assets_owner_all" on financial_assets for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "financial_asset_valuations_owner_all" on financial_asset_valuations;
create policy "financial_asset_valuations_owner_all" on financial_asset_valuations for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "investment_accounts_owner_all" on investment_accounts;
create policy "investment_accounts_owner_all" on investment_accounts for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "investment_account_valuations_owner_all" on investment_account_valuations;
create policy "investment_account_valuations_owner_all" on investment_account_valuations for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "simplifi_mappings_owner_all" on simplifi_account_mappings;
create policy "simplifi_mappings_owner_all" on simplifi_account_mappings for all to authenticated
using (has_workspace_access(owner_id))
with check (
    has_workspace_access(owner_id)
    and exists (
        select 1 from financial_accounts a
        where a.id = simplifi_account_mappings.financial_account_id
          and has_workspace_access(a.owner_id)
    )
);

drop policy "simplifi_batches_owner_all" on simplifi_import_batches;
create policy "simplifi_batches_owner_all" on simplifi_import_batches for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "simplifi_rows_owner_all" on simplifi_import_rows;
create policy "simplifi_rows_owner_all" on simplifi_import_rows for all to authenticated
using (has_workspace_access(owner_id))
with check (
    has_workspace_access(owner_id)
    and exists (
        select 1 from financial_accounts a
        where a.id = simplifi_import_rows.financial_account_id
          and has_workspace_access(a.owner_id)
    )
);

drop policy "property_financial_setups_owner_select" on property_financial_setups;
create policy "property_financial_setups_owner_select" on property_financial_setups for select to authenticated
using (has_workspace_access(owner_id));
