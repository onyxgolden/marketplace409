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
--
-- attempt_count: incremented by every successful atomic claim (a normal claim, `status in
-- ('received','failed') -> 'processing'`, or a stale-processing reclaim, see claimed_at below) --
-- this is what makes concurrent redeliveries of the same event id safe: only one concurrent
-- request's UPDATE can ever match a claim's WHERE clause and see a nonzero affected-row count, so
-- only one ever proceeds to import. received_at deliberately has no corresponding "on retry" write
-- path anywhere in the route -- it is set once, by the initial insert-or-ignore, and never touched
-- again, so it always reflects the FIRST delivery of an event id, not the most recent retry.
--
-- claimed_at: set every time a claim succeeds (normal or stale-reclaim) -- the timestamp "this
-- attempt's processing began." Lets the route detect a row stuck in 'processing' because a prior
-- attempt crashed mid-request (confirmed live: a dev-server restart mid-webhook-request left a
-- row permanently 'processing', which the normal claim correctly refuses to touch, by design,
-- forever) and safely reclaim it once claimed_at is older than the route's defined staleness
-- timeout -- still a single atomic UPDATE with claimed_at itself in the WHERE clause, so a second
-- concurrent reclaim attempt can never also succeed (the first one's UPDATE already advanced
-- claimed_at past the staleness threshold before the second's WHERE clause is evaluated).
create table if not exists connection_webhook_events (
    id text primary key,
    provider text not null,
    provider_event_id text not null,
    event_type text not null,
    object_id text,
    status text not null check (status in ('received', 'processing', 'processed', 'ignored', 'failed')),
    attempt_count integer not null default 0,
    received_at timestamptz not null default now(),
    claimed_at timestamptz,
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
