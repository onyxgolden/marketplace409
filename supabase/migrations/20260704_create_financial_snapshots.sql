create table if not exists financial_snapshots (
  id text primary key,
  captured_at timestamptz not null,
  period_start date null,
  period_end date null,
  kpis jsonb not null default '{}'::jsonb,
  health jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists financial_snapshots_captured_at_idx
  on financial_snapshots (captured_at desc);
