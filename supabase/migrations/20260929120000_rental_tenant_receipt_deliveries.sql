-- Durable idempotency record for rental tenant payment receipts
-- (src/app/api/rental/cron/tenant-payment-receipts/route.js). One row per
-- (owner_id, payment_id): the exact grain the pipeline must never send twice
-- for. One row is queued per succeeded tenant Stripe payment, to the tenant's
-- own email — the receipt confirming their rent payment landed (Jason's
-- 2026-09-29 instruction; initial rollout: Eric Carrillo, 308 Paula).
--
-- Detection-time disposition mirrors the owner-notification precedent: a row
-- detected while sending is disabled (or for a non-allowlisted tenant) is
-- written terminally as 'skipped_disabled' -- it can never be delivered
-- later, not even if the flag flips on before the next cron run.
--
-- The unique constraint is durable LOGICAL deduplication (at most one row can
-- ever exist per logical delivery, across webhook redeliveries,
-- reconciliations, retries, or overlapping cron invocations) -- it is not, by
-- itself, a guarantee against ever calling the email provider twice for the
-- same delivery under concurrent failure/retry timing. The route layer's
-- stable provider idempotency key (deterministic per delivery id) is the
-- other half of that guarantee.
create table if not exists rental_tenant_receipt_deliveries (
    owner_id text not null,
    id text not null,
    payment_id text not null,
    tenant_id text not null,
    lease_id text,
    -- Denormalized at detection; the sender re-resolves name/property at send
    -- time so the email reflects current data.
    recipient_email text not null default '',
    amount_cents integer not null,
    transaction_ref text,
    status text not null default 'queued'
        check (status in ('queued', 'sending', 'sent', 'failed', 'skipped_disabled', 'skipped_not_allowlisted')),
    attempt_count integer not null default 0 check (attempt_count >= 0),
    provider_message_id text,
    failure_reason text,
    -- Stable provider idempotency key, deterministic per delivery id.
    idempotency_key text,
    -- Distributed-claim fencing: the run that claims a row writes a unique
    -- token here. Outcome updates must match the token, so a slow worker can
    -- never overwrite a newer worker's outcome. Cleared with every outcome.
    claim_token text,
    first_attempted_at timestamptz,
    last_attempted_at timestamptz,
    sent_at timestamptz,
    created_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, payment_id),
    check (status <> 'sent' or sent_at is not null)
);

create index if not exists rental_tenant_receipt_deliveries_owner_status_idx
    on rental_tenant_receipt_deliveries (owner_id, status, created_at);

-- Service-role-only: RLS is forced with zero policies, so only the server
-- (service role) can read or write. Same precedent as
-- rental_owner_notifications.
alter table rental_tenant_receipt_deliveries enable row level security;
alter table rental_tenant_receipt_deliveries force row level security;

-- No policies: RLS is forced, so only the table owner (service role) can touch
-- these rows. Revoke the Supabase default grants explicitly.
revoke all on table rental_tenant_receipt_deliveries from public, anon, authenticated;
