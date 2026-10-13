-- Receipt-delivery confirmation ledger (AGENT-PROPOSALS.md 2026-10-11, Muse;
-- three-agent AGREE with conditions 2026-10-12).
--
-- Background: on 2026-10-11 GitHub's scheduler silently dropped all three
-- receipt/invite sweeps (10:00 tenant invites, 11:00 PF receipts, 13:00 tenant
-- receipts). The sweep watchdog refired each one, but actual delivery could
-- NOT be confirmed from the scheduled-run view -- delivery state was unknown,
-- and a refire without confirmation is indistinguishable from "sent".
--
-- This table is the durable per-recipient confirmation evidence each sweep
-- writes. The sweep watchdog checks THIS table (expected vs observed at the
-- scheduled hour + grace window), not the Actions API.
--
-- Write contract (agreed conditions):
--   * Durable PRE-SEND claim/outbox row first, keyed on
--     (schedule_name, scheduled_slot, recipient_allowlist_id). The unique
--     key makes the claim the distributed lock: a refire that finds an
--     existing terminal row reconciles (skips) instead of re-sending.
--   * States: claimed -> provider_accepted | provider_failed | no_op;
--     provider_accepted -> delivered | provider_failed.
--     provider_failed is sticky within a run; a LATER run_id may record
--     provider_accepted/delivered over it (recovery), but the same run never
--     downgrades a failure. delivered and no_op are terminal.
--   * No API-acceptance-as-delivery: provider_accepted means the provider
--     returned a message id; delivered is reserved for a delivery
--     confirmation (e.g. webhook) when one exists.
--   * scheduled_slot is the America/Chicago calendar date of the scheduled
--     run (text, YYYY-MM-DD) so slot boundaries match the sweep times Jason
--     reads (10:00/11:00/13:00 CDT), not UTC dates.
--
-- Written only by the service-role webhook client inside the sweep routes.
-- RLS is enabled with no permissive policies: authenticated/anon roles get
-- nothing; the service role bypasses RLS.
--
-- DEPLOY NOTE: migration file only. Applying to production Supabase is a
-- separate, explicit Jason authorization (not granted by the proposal or
-- by this PR).

create table if not exists scheduled_send_ledger (
  id uuid primary key default gen_random_uuid(),
  schedule_name text not null
    check (schedule_name in ('tenant_invite', 'pf_payment_receipts', 'tenant_payment_receipts')),
  scheduled_slot text not null
    check (scheduled_slot ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  recipient_allowlist_id text not null,
  run_id text,
  state text not null default 'claimed'
    check (state in ('claimed', 'provider_accepted', 'provider_failed', 'delivered', 'no_op')),
  provider_message_id text,
  failure_reason text,
  claimed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint scheduled_send_ledger_one_row_per_recipient_per_slot
    unique (schedule_name, scheduled_slot, recipient_allowlist_id)
);

create index if not exists scheduled_send_ledger_schedule_slot_idx
  on scheduled_send_ledger (schedule_name, scheduled_slot);

create index if not exists scheduled_send_ledger_state_idx
  on scheduled_send_ledger (state)
  where state in ('claimed', 'provider_failed');

alter table scheduled_send_ledger enable row level security;
-- Intentionally no policies: service-role only.
