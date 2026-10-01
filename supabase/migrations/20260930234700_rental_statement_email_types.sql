-- Rentec parity R2: email tenant statements/invoices.
-- Extends the rental notification outbox with the two owner-triggered
-- statement notification types. Rows are written by the
-- POST /api/rental/tenant-statement-email route as the durable send log
-- (visible in the communications panel); the existing
-- /api/rental/notifications/deliver claim flow retries 'failed' rows.
alter table rental_notification_outbox drop constraint if exists rental_notification_outbox_notification_type_check;
alter table rental_notification_outbox add constraint rental_notification_outbox_notification_type_check check(notification_type in('payment_succeeded','payment_failed','maintenance_updated','document_published','rent_reminder','balance_overdue','statement_emailed','invoice_emailed'));
