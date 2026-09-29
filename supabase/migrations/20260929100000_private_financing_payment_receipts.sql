-- Durable idempotency record for private-financing payment-received notifications
-- (src/app/api/private-financing/cron/payment-receipt-notifications/route.js). One row per
-- (owner_id, payment_id, recipient_type) -- the exact grain the pipeline must never send twice
-- for. Two rows are queued per successful borrower payment: one 'owner' receipt to the
-- owner-notification recipient (brandykaymorgan@gmail.com per Jason's 2026-09-29 instruction,
-- resolved via the shared owner-notification config) and one 'borrower' receipt to the
-- borrower's own email address.
--
-- Detection-time disposition mirrors the rental owner-notification precedent: a row detected
-- while sending is disabled is written terminally as 'skipped_disabled' -- it can never be
-- delivered later, not even if the flag flips on before the next cron run.
--
-- The unique constraint is durable LOGICAL deduplication (at most one row can ever exist per
-- logical delivery, across webhook redeliveries, reconciliations, retries, or overlapping cron
-- invocations) -- it is not, by itself, a guarantee against ever calling the email provider
-- twice for the same delivery under concurrent failure/retry timing. The route layer's stable
-- provider idempotency key (deterministic per delivery id) is the other half of that
-- guarantee; see the cron route's own comment for the full, honest statement.
create table if not exists private_financing_payment_receipt_deliveries (
    owner_id text not null,
    id text primary key,
    account_id text not null,
    payment_id text not null,
    borrower_id text not null,
    recipient_type text not null check (recipient_type in ('owner', 'borrower')),
    recipient_email text not null,
    status text not null check (status in ('queued', 'sending', 'sent', 'failed', 'skipped_disabled', 'skipped_not_allowlisted')),
    provider_message_id text,
    failure_reason text,
    -- Bounded retries: a failed delivery is retried at most MAX_NOTIFICATION_ATTEMPTS times
    -- (matching the rental owner-notification convention), then left terminally 'failed' for
    -- human review. Never reset; first_attempted_at/last_attempted_at bound the range.
    attempt_count integer not null default 1 check (attempt_count > 0),
    claim_token text,
    claimed_at timestamptz,
    first_attempted_at timestamptz not null default now(),
    last_attempted_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    unique (owner_id, payment_id, recipient_type),
    foreign key (owner_id, account_id) references private_financing_accounts (owner_id, id)
);

create index if not exists idx_pf_receipt_deliveries_claim
    on private_financing_payment_receipt_deliveries (owner_id, status, last_attempted_at)
    where status = 'queued';

-- Service-role-only access, RLS force-enabled with zero policies -- identical precedent to
-- private_financing_payment_reminder_deliveries (see its own migration): no authenticated user
-- session exists on the webhook/cron paths that write here.
alter table private_financing_payment_receipt_deliveries enable row level security;
alter table private_financing_payment_receipt_deliveries force row level security;
