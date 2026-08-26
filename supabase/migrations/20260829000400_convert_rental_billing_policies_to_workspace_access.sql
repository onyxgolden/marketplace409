-- Shared FORGE workspace membership -- Checkpoint 3, group 2/5 (billing/payments/autopay). Same
-- treatment as group 1 (20260829000300_...): converts owner-management RLS policies from
-- `owner_id = auth.uid()::text` to `has_workspace_access(owner_id)`, tenant-facing policies (e.g.
-- rent_charges_tenant_select, rent_schedules_tenant_select, rental_payments_tenant_select,
-- rental_autopay_tenant_read) untouched. Exact policy names/shapes confirmed against the live
-- linked Production database, not re-derived from migration history.

drop policy "rent_charges_owner_all" on rent_charges;
create policy "rent_charges_owner_all" on rent_charges for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rent_schedules_owner_all" on rent_schedules;
create policy "rent_schedules_owner_all" on rent_schedules for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_payments_owner_all" on rental_payments;
create policy "rental_payments_owner_all" on rental_payments for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_settlements_owner_all" on rental_settlements;
create policy "rental_settlements_owner_all" on rental_settlements for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "ach_authorizations_owner_all" on ach_authorizations;
create policy "ach_authorizations_owner_all" on ach_authorizations for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "landlord_payment_accounts_owner_select" on landlord_payment_accounts;
create policy "landlord_payment_accounts_owner_select" on landlord_payment_accounts for select to authenticated
using (has_workspace_access(owner_id));

drop policy "billing_customer_references_owner_select" on billing_customer_references;
create policy "billing_customer_references_owner_select" on billing_customer_references for select to authenticated
using (has_workspace_access(owner_id));

drop policy "rental_autopay_owner_all" on rental_autopay_enrollments;
create policy "rental_autopay_owner_all" on rental_autopay_enrollments for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_autopay_attempt_owner_read" on rental_autopay_attempts;
create policy "rental_autopay_attempt_owner_read" on rental_autopay_attempts for select to authenticated
using (has_workspace_access(owner_id));

drop policy "rental_billing_settings_owner_select" on rental_billing_settings;
create policy "rental_billing_settings_owner_select" on rental_billing_settings for select to authenticated
using (has_workspace_access(owner_id));

drop policy "rental_billing_settings_audit_owner_select" on rental_billing_settings_audit;
create policy "rental_billing_settings_audit_owner_select" on rental_billing_settings_audit for select to authenticated
using (has_workspace_access(owner_id));

drop policy "rent_schedule_cutover_audit_owner_select" on rent_schedule_collection_cutover_audit;
create policy "rent_schedule_cutover_audit_owner_select" on rent_schedule_collection_cutover_audit for select to authenticated
using (has_workspace_access(owner_id));

drop policy "rentec_transaction_imports_owner_insert" on rentec_transaction_imports;
create policy "rentec_transaction_imports_owner_insert" on rentec_transaction_imports for insert to authenticated
with check (has_workspace_access(owner_id));

drop policy "rentec_transaction_imports_owner_select" on rentec_transaction_imports;
create policy "rentec_transaction_imports_owner_select" on rentec_transaction_imports for select to authenticated
using (has_workspace_access(owner_id));

drop policy "rentec_financial_history_import_batches_owner_insert" on rentec_financial_history_import_batches;
create policy "rentec_financial_history_import_batches_owner_insert" on rentec_financial_history_import_batches for insert to authenticated
with check (has_workspace_access(owner_id));

drop policy "rentec_financial_history_import_batches_owner_select" on rentec_financial_history_import_batches;
create policy "rentec_financial_history_import_batches_owner_select" on rentec_financial_history_import_batches for select to authenticated
using (has_workspace_access(owner_id));
