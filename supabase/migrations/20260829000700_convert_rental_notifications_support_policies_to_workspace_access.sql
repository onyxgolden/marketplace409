-- Shared FORGE workspace membership -- Checkpoint 3, group 5/5 (notifications/support/deposits/
-- lease changes/late fees/lease preparations). Same treatment as groups 1-4: owner-management
-- policies converted to has_workspace_access(owner_id); tenant-facing policies
-- (rental_deposit_tenant_select, rental_deposit_tx_tenant_select, rental_lease_change_tenant_select,
-- rental_late_rule_tenant_select, rental_late_assessment_tenant_select,
-- rental_lease_preparation_tenant_select, rental_lease_preparation_version_tenant_select,
-- rental_support_tenant_read, rental_support_event_tenant_read) untouched.

drop policy "rental_notification_owner_select" on rental_notification_outbox;
create policy "rental_notification_owner_select" on rental_notification_outbox for select to authenticated
using (has_workspace_access(owner_id));

drop policy "rental_notification_preferences_owner_select" on rental_notification_preferences;
create policy "rental_notification_preferences_owner_select" on rental_notification_preferences for select to authenticated
using (has_workspace_access(owner_id));

drop policy "rental_delivery_owner_select" on rental_notification_delivery_events;
create policy "rental_delivery_owner_select" on rental_notification_delivery_events for select to authenticated
using (has_workspace_access(owner_id));

drop policy "rental_email_settings_owner" on rental_email_settings;
create policy "rental_email_settings_owner" on rental_email_settings for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_support_owner_all" on rental_support_cases;
create policy "rental_support_owner_all" on rental_support_cases for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_support_event_owner_all" on rental_support_case_events;
create policy "rental_support_event_owner_all" on rental_support_case_events for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_deposit_owner_all" on rental_security_deposits;
create policy "rental_deposit_owner_all" on rental_security_deposits for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_deposit_tx_owner_select" on rental_security_deposit_transactions;
create policy "rental_deposit_tx_owner_select" on rental_security_deposit_transactions for select to authenticated
using (has_workspace_access(owner_id));

drop policy "rental_lease_change_owner_all" on rental_lease_changes;
create policy "rental_lease_change_owner_all" on rental_lease_changes for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_late_rule_owner_all" on rental_late_fee_rules;
create policy "rental_late_rule_owner_all" on rental_late_fee_rules for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_late_assessment_owner_all" on rental_late_fee_assessments;
create policy "rental_late_assessment_owner_all" on rental_late_fee_assessments for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_lease_preparation_owner_all" on rental_lease_preparations;
create policy "rental_lease_preparation_owner_all" on rental_lease_preparations for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_lease_preparation_version_owner_all" on rental_lease_preparation_versions;
create policy "rental_lease_preparation_version_owner_all" on rental_lease_preparation_versions for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
