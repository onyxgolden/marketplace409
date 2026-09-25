-- Rental Manager: durable rent-due reminder delivery ledger.
--
-- Mirrors the private-financing reminder delivery table: every rent reminder the
-- automatic cron attempts gets one row at the logical grain
-- (owner, charge, tenant, due date, reminder type), so overlapping cron runs can
-- never deliver the same logical reminder twice. The row is the distributed
-- claim: a send attempt must INSERT (or re-claim a stale) its row BEFORE the
-- provider call, never after.
--
-- Service-role-only like its private-financing counterpart: RLS is forced with
-- zero policies, so only the server (service role) can read or write.

create table if not exists rental_rent_reminder_deliveries (
    owner_id text not null,
    id text not null,
    charge_id text not null,
    tenant_id text not null,
    due_date date not null,
    reminder_type text not null check (reminder_type in ('seven_days_before', 'due_date')),
    -- sending: this invocation claimed the delivery and is working it. A crashed
    -- invocation leaves a stale 'sending' row, which the cron re-claims after
    -- 30 minutes so the reminder is not suppressed forever.
    -- superseded: the live recheck after the claim found the charge already
    -- paid, so no email was sent. Terminal — never retried.
    status text not null check (status in ('sending', 'sent', 'failed', 'superseded')),
    provider_message_id text,
    failure_reason text,
    attempt_count integer not null default 1 check (attempt_count > 0),
    first_attempted_at timestamptz not null default now(),
    last_attempted_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, charge_id, tenant_id, due_date, reminder_type),
    foreign key (owner_id, charge_id) references rent_charges (owner_id, id) on delete cascade
);

create index if not exists rental_rent_reminder_deliveries_owner_charge_idx
    on rental_rent_reminder_deliveries (owner_id, charge_id, due_date, reminder_type);

alter table rental_rent_reminder_deliveries enable row level security;
alter table rental_rent_reminder_deliveries force row level security;

-- No policies: RLS is forced, so only the table owner (service role) can touch
-- these rows. Revoke the Supabase default grants explicitly.
revoke all on table rental_rent_reminder_deliveries from public, anon, authenticated;
