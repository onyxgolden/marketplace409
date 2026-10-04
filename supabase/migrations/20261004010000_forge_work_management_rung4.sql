-- ---------------------------------------------------------------------------
-- FORGE Work Management — Rung 4: Scheduling integration
--
-- Four tables:
--   forge_work_package_baselines — immutable baseline versions per package.
--     A baseline freezes planned start/finish, hours, and cost. Baselines
--     are NEVER edited — a re-baseline is a new row that supersedes the
--     old one. Planned % complete is always computed against the frozen
--     baseline, never the live dates.
--   forge_work_progress_snapshots — per-package, per-status-date progress.
--     Planned %, actual %, earned %, earned/actual hours and cost, ETC/EAC.
--     Append-only: one row per package per reporting cycle. This table IS
--     the S-curve dataset.
--   forge_work_weekly_commitments — weekly schedule-reliability (PPC) per
--     crew/foreman: assignments planned vs completed, reasons for
--     non-completion. PPC measures the planning system's reliability, not
--     the work's progress — a different question on a weekly cadence.
--   forge_work_manpower_days — daily roll-up per package per company per
--     craft: planned heads, actual heads, planned/estimated/actual
--     manhours. Estimated comes from the daily manpower report; actual
--     comes from gate-clock imports (ground truth).
--
-- Calculation engine (domain layer, pure functions — never alternative
-- math): earned value, percent complete, PPC, ETC/EAC, manpower variance.
-- Measurement method and weight method are fields on the package (added
-- below as a Rung 1 amendment); every % is computed through them.
-- ---------------------------------------------------------------------------

-- Rung 1 amendment: progress measurement configuration lives on the package.
alter table forge_work_packages
  add column if not exists progress_method text not null default 'physical_quantity'
    constraint forge_work_packages_progress_method_check check (progress_method in (
      'physical_quantity','milestone','rules_of_credit')),
  add column if not exists weight_method text not null default 'hours'
    constraint forge_work_packages_weight_method_check check (weight_method in (
      'cost','hours','quantity','manual'));

-- ---------------------------------------------------------------------------
-- forge_work_package_baselines
-- ---------------------------------------------------------------------------
create table if not exists forge_work_package_baselines (
  owner_id text not null,
  id text not null default ('forge_wpb_' || gen_random_uuid()::text),
  package_id text not null,
  version_number integer not null,
  baseline_start date not null,
  baseline_finish date not null,
  baseline_hours numeric(14,2) not null,
  baseline_cost numeric(14,2) not null,
  frozen_by text not null,
  frozen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint forge_work_package_baselines_version_check check (version_number >= 1),
  constraint forge_work_package_baselines_dates_check check (baseline_finish >= baseline_start),
  constraint forge_work_package_baselines_hours_check check (baseline_hours >= 0),
  constraint forge_work_package_baselines_cost_check check (baseline_cost >= 0),
  constraint forge_work_package_baselines_version_unique unique (owner_id, package_id, version_number)
);
create index if not exists forge_work_package_baselines_pkg_idx
  on forge_work_package_baselines (owner_id, package_id, version_number desc);

-- Baselines are immutable: no UPDATE, no DELETE. A re-baseline inserts a
-- new version row and marks the old one superseded via superseded_by.
create or replace function forge_work_baselines_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'forge_work: baselines are immutable — insert a new version to re-baseline';
end $$;
drop trigger if exists forge_work_package_baselines_immutable_trg on forge_work_package_baselines;
create trigger forge_work_package_baselines_immutable_trg
  before update or delete on forge_work_package_baselines
  for each row execute function forge_work_baselines_immutable();

-- ---------------------------------------------------------------------------
-- forge_work_progress_snapshots
-- ---------------------------------------------------------------------------
create table if not exists forge_work_progress_snapshots (
  owner_id text not null,
  id text not null default ('forge_wps_' || gen_random_uuid()::text),
  package_id text not null,
  status_date date not null,
  planned_pct numeric(7,4) not null,
  actual_pct numeric(7,4) not null,
  earned_pct numeric(7,4) not null,
  earned_hours numeric(14,2) not null,
  earned_cost numeric(14,2) not null,
  actual_hours numeric(14,2) not null,
  actual_cost numeric(14,2) not null,
  etc_hours numeric(14,2),
  etc_cost numeric(14,2),
  eac_hours numeric(14,2),
  eac_cost numeric(14,2),
  baseline_version integer not null,
  recorded_by text not null default 'system',
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint forge_work_progress_snapshots_pct_check check (
    planned_pct between 0 and 100 and
    actual_pct between 0 and 100 and
    earned_pct between 0 and 100),
  constraint forge_work_progress_snapshots_status_unique unique (owner_id, package_id, status_date)
);
create index if not exists forge_work_progress_snapshots_pkg_idx
  on forge_work_progress_snapshots (owner_id, package_id, status_date desc);

-- Snapshots are append-only history: no UPDATE, no DELETE.
create or replace function forge_work_snapshots_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'forge_work: progress snapshots are append-only — insert a new row to correct';
end $$;
drop trigger if exists forge_work_progress_snapshots_immutable_trg on forge_work_progress_snapshots;
create trigger forge_work_progress_snapshots_immutable_trg
  before update or delete on forge_work_progress_snapshots
  for each row execute function forge_work_snapshots_immutable();

-- ---------------------------------------------------------------------------
-- forge_work_weekly_commitments
-- ---------------------------------------------------------------------------
create table if not exists forge_work_weekly_commitments (
  owner_id text not null,
  id text not null default ('forge_wwc_' || gen_random_uuid()::text),
  package_id text,
  week_start_date date not null,
  crew_name text not null,
  foreman_name text,
  planned_count integer not null,
  completed_count integer not null,
  non_completion_reasons jsonb not null default '[]'::jsonb,
  recorded_by text not null default 'system',
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint forge_work_weekly_commitments_counts_check check (
    planned_count >= 0 and completed_count >= 0 and completed_count <= planned_count),
  constraint forge_work_weekly_commitments_week_unique unique (owner_id, package_id, week_start_date, crew_name)
);
create index if not exists forge_work_weekly_commitments_week_idx
  on forge_work_weekly_commitments (owner_id, week_start_date desc);

-- ---------------------------------------------------------------------------
-- forge_work_manpower_days
-- ---------------------------------------------------------------------------
create table if not exists forge_work_manpower_days (
  owner_id text not null,
  id text not null default ('forge_wmd_' || gen_random_uuid()::text),
  package_id text not null,
  work_date date not null,
  company text not null,
  craft text not null,
  planned_heads integer not null,
  actual_heads integer,
  planned_manhours numeric(10,2) not null,
  estimated_manhours numeric(10,2),
  actual_manhours numeric(10,2),
  recorded_by text not null default 'system',
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint forge_work_manpower_days_heads_check check (
    planned_heads >= 0 and (actual_heads is null or actual_heads >= 0)),
  constraint forge_work_manpower_days_hours_check check (
    planned_manhours >= 0 and
    (estimated_manhours is null or estimated_manhours >= 0) and
    (actual_manhours is null or actual_manhours >= 0)),
  constraint forge_work_manpower_days_day_unique unique (owner_id, package_id, work_date, company, craft)
);
create index if not exists forge_work_manpower_days_date_idx
  on forge_work_manpower_days (owner_id, package_id, work_date desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table forge_work_package_baselines enable row level security;
alter table forge_work_progress_snapshots enable row level security;
alter table forge_work_weekly_commitments enable row level security;
alter table forge_work_manpower_days enable row level security;

drop policy if exists forge_work_package_baselines_owner on forge_work_package_baselines;
create policy forge_work_package_baselines_owner on forge_work_package_baselines
  for all using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists forge_work_progress_snapshots_owner on forge_work_progress_snapshots;
create policy forge_work_progress_snapshots_owner on forge_work_progress_snapshots
  for all using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists forge_work_weekly_commitments_owner on forge_work_weekly_commitments;
create policy forge_work_weekly_commitments_owner on forge_work_weekly_commitments
  for all using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists forge_work_manpower_days_owner on forge_work_manpower_days;
create policy forge_work_manpower_days_owner on forge_work_manpower_days
  for all using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
