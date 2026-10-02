-- Widen the rental_owner_notifications event_type check to cover the new
-- payment_initiated event: Brandy's "autopay debit started" email, queued when
-- the autopay sweep triggers the Stripe debit (payment_intent.processing).
-- Existing rows are unaffected; the new value only appears on rows inserted
-- after this deploy. Safe to re-run.

alter table rental_owner_notifications drop constraint if exists rental_owner_notifications_event_type_check;
alter table rental_owner_notifications add constraint rental_owner_notifications_event_type_check
    check (event_type in ('upcoming_autopay', 'payment_initiated', 'manual_payment_received', 'payment_completed', 'payment_failed'));
