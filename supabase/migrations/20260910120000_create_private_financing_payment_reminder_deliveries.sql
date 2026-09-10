-- Durable idempotency record for the private-financing payment-due reminder cron
-- (src/app/api/private-financing/cron/payment-due-reminders/route.js). One row per
-- (owner_id, account_id, borrower_id, due_date, reminder_type) -- the exact grain the cron must
-- never send twice for. A row exists only once a real send attempt was made for that specific
-- upcoming installment; "not due yet", "already satisfied", or "due-state unavailable" outcomes
-- are reported in the cron's own response/logs (matching how the existing rent-charge/autopay
-- crons already report processed/failed counts) rather than persisted here, since there is
-- nothing to deduplicate for an outcome that never attempted a send.
--
-- reminder_type is intentionally NOT 'overdue' or any past-due variant -- this cron never sends
-- overdue notices (see paymentDueReminders.js), so the table's own check constraint enforces that
-- boundary at the schema level, not just in application code.
--
-- This table's unique constraint is durable LOGICAL deduplication (at most one row can ever exist
-- per logical delivery, across any number of retries or overlapping cron invocations) -- it is not,
-- by itself, a guarantee against ever calling the email provider twice for the same delivery under
-- concurrent failure/retry timing. The route layer's stable provider idempotency key is the other
-- half of that guarantee; see the GET handler's own comment in route.js for the full, honest
-- statement of what is and is not guaranteed.
create table if not exists private_financing_payment_reminder_deliveries (
    owner_id text not null,
    id text primary key,
    account_id text not null,
    borrower_id text not null,
    due_date date not null,
    reminder_type text not null check (reminder_type in ('seven_days_before', 'due_date')),
    status text not null check (status in ('sent', 'failed')),
    provider_message_id text,
    failure_reason text,
    -- Incremented on each retry attempt for the same (account, borrower, due_date, reminder_type)
    -- row. Retries are BOUNDED, not simply "automatic every day forever" -- a failed
    -- "seven_days_before" row may retry on any subsequent daily run through the day BEFORE
    -- due_date; a failed "due_date" row may only retry later THAT SAME calendar day, never the
    -- next day or after (which would otherwise silently become an unauthorized overdue reminder --
    -- see the application-layer retry-window checks in reminderRunPlanner.js, which are the
    -- authority on this rule; this comment only summarizes it). Never reset; first_attempted_at/
    -- last_attempted_at bound the range.
    attempt_count integer not null default 1 check (attempt_count > 0),
    first_attempted_at timestamptz not null default now(),
    last_attempted_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    unique (owner_id, account_id, borrower_id, due_date, reminder_type),
    foreign key (owner_id, account_id) references private_financing_accounts (owner_id, id)
);

create index if not exists idx_private_financing_reminder_deliveries_lookup
    on private_financing_payment_reminder_deliveries (owner_id, account_id, borrower_id, due_date, reminder_type);

-- Service-role-only access, RLS force-enabled with zero policies -- identical precedent to
-- connection_webhook_events and financial_account_refresh_watermarks (see their own migrations):
-- no authenticated user session exists on this cron-triggered path. Deliberately no explicit
-- revoke/grant here either, for the same reason: this is new schema, not a table whose default
-- grants need tightening, and production's service_role reaches it via Supabase's default
-- RLS-bypass exactly as those tables already do (independently re-verified against production
-- system catalogs as part of the FORGE Production User Feedback and Activation program).
alter table private_financing_payment_reminder_deliveries enable row level security;
alter table private_financing_payment_reminder_deliveries force row level security;
