-- Shared FORGE workspace membership -- Checkpoint 3, group 3/5 (maintenance/contractors/documents/
-- inspections). Same treatment as groups 1-2: owner-management policies converted to
-- has_workspace_access(owner_id); tenant-facing policies (rental_maintenance_tenant_select,
-- rental_documents_tenant_select, rental_document_ack_tenant_select, rental_inspection_tenant_select,
-- rental_inspection_item_tenant_select, rental_inspection_ack_tenant_select) untouched.

drop policy "rental_maintenance_owner_all" on rental_maintenance_requests;
create policy "rental_maintenance_owner_all" on rental_maintenance_requests for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_work_order_owner_all" on rental_maintenance_work_orders;
create policy "rental_work_order_owner_all" on rental_maintenance_work_orders for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_work_event_owner_all" on rental_maintenance_work_events;
create policy "rental_work_event_owner_all" on rental_maintenance_work_events for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_contractor_owner_all" on rental_contractors;
create policy "rental_contractor_owner_all" on rental_contractors for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_contractor_payment_owner_all" on rental_contractor_payments;
create policy "rental_contractor_payment_owner_all" on rental_contractor_payments for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_1099_review_owner_all" on rental_1099_reviews;
create policy "rental_1099_review_owner_all" on rental_1099_reviews for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_documents_owner_all" on rental_documents;
create policy "rental_documents_owner_all" on rental_documents for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_document_ack_owner_select" on rental_document_acknowledgements;
create policy "rental_document_ack_owner_select" on rental_document_acknowledgements for select to authenticated
using (has_workspace_access(owner_id));

drop policy "rental_document_audit_log_owner_insert" on rental_document_audit_log;
create policy "rental_document_audit_log_owner_insert" on rental_document_audit_log for insert to authenticated
with check (has_workspace_access(owner_id));

drop policy "rental_document_audit_log_owner_select" on rental_document_audit_log;
create policy "rental_document_audit_log_owner_select" on rental_document_audit_log for select to authenticated
using (has_workspace_access(owner_id));

drop policy "rental_inspection_owner_all" on rental_inspections;
create policy "rental_inspection_owner_all" on rental_inspections for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_inspection_item_owner_all" on rental_inspection_items;
create policy "rental_inspection_item_owner_all" on rental_inspection_items for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "rental_inspection_ack_owner_select" on rental_inspection_acknowledgements;
create policy "rental_inspection_ack_owner_select" on rental_inspection_acknowledgements for select to authenticated
using (has_workspace_access(owner_id));
