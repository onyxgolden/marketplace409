-- Rental Manager: Brandy's owner payment-notification outbox.
--
-- One row per logical owner notification at the grain
-- (owner, event type, notified subject), so overlapping webhook deliveries and
-- cron runs can never notify Brandy twice about the same event. The row is the
-- distributed claim: a delivery attempt must INSERT (or re-claim a stale) its
-- row BEFORE the provider call, never after.
--
-- Event types:
--   upcoming_autopay        - an autopay run is scheduled 3 days out
--   manual_payment_received - a tenant paid voluntarily through the portal
--   payment_completed       - an autopay payment succeeded
--   payment_failed          - a payment failed or bounced (autopay or manual)
--
-- Statuses:
--   queued           - detected, awaiting a delivery run
--   sending          - a run claimed this row and is working it
--   sent             - the email left via the provider
--   failed           - the provider call failed (retried up to 5 attempts)
--   skipped_disabled - sending was disabled when the event was DETECTED
--                      (queue time): terminal, never delivered — not even if
--                      the flag is enabled later. The row stays as the audit
--                      log of what WOULD have been sent. A notification is only
--                      ever sent for an event detected while sending is on.
--   superseded       - the live recheck found the underlying charge already
--                      paid, so no email was sent. Terminal, never retried.
--
-- Service-role-only like the rent-reminder deliveries table: RLS is forced
-- with zero policies, so only the server (service role) can read or write.

create table if not exists rental_owner_notifications (
    owner_id text not null,
    id text not null,
    event_type text not null
        check (event_type in ('upcoming_autopay', 'manual_payment_received', 'payment_completed', 'payment_failed')),
    -- The subject of the notification: a payment for terminal payment events,
    -- a charge for the upcoming-autopay notice. Lease/tenant are denormalized
    -- for the email; the payload carries the human facts (tenant name, amount).
    payment_id text,
    charge_id text,
    lease_id text,
    tenant_id text,
    payload jsonb not null default '{}'::jsonb,
    status text not null default 'queued'
        check (status in ('queued', 'sending', 'sent', 'failed', 'skipped_disabled', 'skipped_not_allowlisted', 'superseded')),
    attempt_count integer not null default 0 check (attempt_count >= 0),
    provider_message_id text,
    failure_reason text,
    -- Distributed-claim fencing: the run that claims a row writes a unique
    -- token here. Outcome updates must match the token, so a slow worker can
    -- never overwrite a newer worker's outcome. Cleared with every outcome.
    claim_token text,
    first_attempted_at timestamptz,
    last_attempted_at timestamptz,
    sent_at timestamptz,
    created_at timestamptz not null default now(),
    primary key (owner_id, id),
    check (status <> 'sent' or sent_at is not null)
);

create index if not exists rental_owner_notifications_owner_status_idx
    on rental_owner_notifications (owner_id, status, created_at);

alter table rental_owner_notifications enable row level security;
alter table rental_owner_notifications force row level security;

-- No policies: RLS is forced, so only the table owner (service role) can touch
-- these rows. Revoke the Supabase default grants explicitly.
revoke all on table rental_owner_notifications from public, anon, authenticated;
