-- Durable sweep-execution evidence for the rental autopay sweep.
--
-- Background: GitHub Actions documents that scheduled workflow runs can be
-- delayed under load and dropped entirely (minute 00 called out explicitly).
-- The 02:00 CDT autopay sweep silently missed two consecutive nights
-- (2026-10-05, 2026-10-06) with no workflow run object created at all.
-- The recovery watchdog therefore checks THIS table -- durable
-- application evidence that the sweep ran -- and not the Actions API.
--
-- Written only by the service-role webhook client inside the sweep routes.
-- RLS is enabled with no permissive policies: authenticated/anon roles get
-- nothing; the service role bypasses RLS.

create table if not exists rental_sweep_runs (
  id uuid primary key default gen_random_uuid(),
  sweep_name text not null,
  sweep_date date not null,
  triggered_by text not null check (triggered_by in ('schedule', 'watchdog', 'manual')),
  status text not null default 'started' check (status in ('started', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  candidates integer,
  succeeded integer,
  failed integer,
  skipped integer,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists rental_sweep_runs_name_date_idx
  on rental_sweep_runs (sweep_name, sweep_date);

alter table rental_sweep_runs enable row level security;
-- Intentionally no policies: service-role only.
