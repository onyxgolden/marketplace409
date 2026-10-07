-- Atomic daily execution claim for the rental autopay sweep.
--
-- One row per (sweep_name, sweep_date) -- the PRIMARY KEY is the mutual
-- exclusion. Both the scheduled primary sweep and the watchdog recovery
-- path must acquire this claim before running; the insert is atomic, so two
-- simultaneous callers cannot both own the sweep (no check-then-act race).
--
-- Claim lifecycle: claimed -> completed | failed.
--   * completed: terminal. No further claims today (watchdog no-ops).
--   * failed: retryable. A new caller may reclaim via atomic
--     compare-and-swap on status (only one reclaimer wins).
--   * claimed older than the stale threshold with no terminal state:
--     reclaimable (covers a dead runner). Compare-and-swap keeps it atomic.
--
-- rental_sweep_runs (20261006000000) remains the append-only per-run
-- evidence/audit log. This table is the lock.
--
-- Written only by the service-role webhook client. RLS enabled with no
-- permissive policies: authenticated/anon get nothing.

create table if not exists rental_sweep_claims (
  sweep_name text not null,
  sweep_date date not null,
  status text not null default 'claimed' check (status in ('claimed', 'completed', 'failed')),
  claimed_by text not null check (claimed_by in ('schedule', 'watchdog', 'manual')),
  claimed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attempts integer not null default 1,
  primary key (sweep_name, sweep_date)
);

alter table rental_sweep_claims enable row level security;
-- Intentionally no policies: service-role only.
