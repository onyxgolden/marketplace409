-- Stripe Financial Connections webhook idempotency, provider-neutral (not Rental/Connect-
-- specific like payment_webhook_events, whose surrounding business logic is tied to
-- landlord_payment_accounts/rental_payments -- a different bounded context). Deliberately the
-- same minimal shape payment_webhook_events already uses, so any future provider's webhook work
-- (including Plaid's, which has none today) can share this same table rather than each provider
-- growing its own.
--
-- Stores only: provider, provider event id, event type, the relevant object id, processing
-- status, a payload hash (for detecting a redelivered event with a different body under the same
-- id, without keeping the body itself), timestamps, and sanitized error text. The full raw
-- Financial Connections webhook payload is never persisted -- no existing security-reviewed
-- requirement calls for it, and Stripe account/session identifiers are exactly the kind of detail
-- this table's own sibling (payment_webhook_events) already treats as too sensitive to log
-- verbatim.
--
-- No owner_id: webhook processing runs under a service-role client (no user session exists during
-- a webhook call, the same reason payment_webhook_events has no owner_id either) -- service-role-
-- only access, RLS force-enabled with zero policies, matching that same precedent.
create table if not exists connection_webhook_events (
    id text primary key,
    provider text not null,
    provider_event_id text not null,
    event_type text not null,
    object_id text,
    status text not null check (status in ('received', 'processing', 'processed', 'ignored', 'failed')),
    received_at timestamptz not null default now(),
    processed_at timestamptz,
    failure_message text,
    payload_hash text not null,
    unique (provider, provider_event_id)
);

alter table connection_webhook_events enable row level security;
alter table connection_webhook_events force row level security;
-- No policies: force row level security with none defined denies all access to every role
-- except the service role (which bypasses RLS entirely) -- the same pattern payment_webhook_events
-- itself relies on.
