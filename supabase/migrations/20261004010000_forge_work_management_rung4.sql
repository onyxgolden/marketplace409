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
--
-- Attribution (reviewer finding, PR #549): frozen_by / recorded_by are the
-- AUTHENTICATED actor (routes pass auth.actor). There is no 'system'
-- default and no silent substitution — a write without an actor fails at
-- the NOT NULL constraint instead of forging attribution.
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
  recorded_by text not null,
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
  recorded_by text not null,
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
  recorded_by text not null,
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
-- Referential integrity (reviewer finding, PR #549): snapshots, baselines,
-- commitments, and manpower rows must reference real packages and real
-- baseline versions. Direct inserts of fabricated rows (nonexistent
-- package, invented baseline_version) are rejected by these constraints.
-- ---------------------------------------------------------------------------
alter table forge_work_package_baselines
  add constraint forge_work_package_baselines_package_fk
  foreign key (owner_id, package_id) references forge_work_packages (owner_id, id);

alter table forge_work_progress_snapshots
  add constraint forge_work_progress_snapshots_package_fk
  foreign key (owner_id, package_id) references forge_work_packages (owner_id, id);

alter table forge_work_progress_snapshots
  add constraint forge_work_progress_snapshots_baseline_fk
  foreign key (owner_id, package_id, baseline_version)
  references forge_work_package_baselines (owner_id, package_id, version_number);

alter table forge_work_weekly_commitments
  add constraint forge_work_weekly_commitments_package_fk
  foreign key (owner_id, package_id) references forge_work_packages (owner_id, id);

alter table forge_work_manpower_days
  add constraint forge_work_manpower_days_package_fk
  foreign key (owner_id, package_id) references forge_work_packages (owner_id, id);

-- ---------------------------------------------------------------------------
-- Snapshot calculation-integrity trigger (reviewer finding, PR #549).
--
-- The application engine computes every derived snapshot field from the
-- raw measurements plus the NAMED baseline version. This BEFORE INSERT
-- trigger re-derives the checkable fields at the database write boundary
-- and rejects fabricated rows (e.g. earned_pct=0 with earned_cost=999999,
-- or a planned_pct invented by the caller instead of the frozen schedule).
-- Raw human measurements (actual hours/cost, earned %) remain inputs —
-- the trigger verifies their internal consistency with the named baseline.
-- ---------------------------------------------------------------------------
create or replace function forge_work_snapshots_verify()
returns trigger language plpgsql as $$
declare
  v_baseline_hours numeric(14,2);
  v_baseline_cost numeric(14,2);
  v_baseline_start date;
  v_baseline_finish date;
  v_planned_pct numeric(7,4);
  v_tolerance constant numeric := 0.05;
begin
  select baseline_hours, baseline_cost, baseline_start, baseline_finish
    into v_baseline_hours, v_baseline_cost, v_baseline_start, v_baseline_finish
    from forge_work_package_baselines
   where owner_id = NEW.owner_id
     and package_id = NEW.package_id
     and version_number = NEW.baseline_version;
  if not found then
    raise exception 'forge_work: snapshot references unknown baseline version % for package %',
      NEW.baseline_version, NEW.package_id;
  end if;

  -- Earned value must be consistent with the named baseline budget.
  if abs(NEW.earned_hours - (NEW.earned_pct / 100) * v_baseline_hours) > v_tolerance then
    raise exception 'forge_work: snapshot earned_hours % inconsistent with earned_pct % and baseline hours %',
      NEW.earned_hours, NEW.earned_pct, v_baseline_hours;
  end if;
  if abs(NEW.earned_cost - (NEW.earned_pct / 100) * v_baseline_cost) > v_tolerance then
    raise exception 'forge_work: snapshot earned_cost % inconsistent with earned_pct % and baseline cost %',
      NEW.earned_cost, NEW.earned_pct, v_baseline_cost;
  end if;

  -- Planned % is derived from the frozen schedule, never caller-supplied.
  if NEW.status_date <= v_baseline_start then
    v_planned_pct := 0;
  elsif NEW.status_date >= v_baseline_finish then
    v_planned_pct := 100;
  elsif v_baseline_finish = v_baseline_start then
    v_planned_pct := 100;
  else
    v_planned_pct := ((NEW.status_date - v_baseline_start)::numeric
      / (v_baseline_finish - v_baseline_start)::numeric) * 100;
  end if;
  if abs(NEW.planned_pct - v_planned_pct) > 0.01 then
    raise exception 'forge_work: snapshot planned_pct % does not match frozen schedule % for status date %',
      NEW.planned_pct, v_planned_pct, NEW.status_date;
  end if;

  -- EAC must equal actuals + ETC (the engine's only forecast identity).
  if NEW.etc_hours is not null and NEW.eac_hours is not null
     and abs(NEW.eac_hours - (NEW.actual_hours + NEW.etc_hours)) > v_tolerance then
    raise exception 'forge_work: snapshot eac_hours inconsistent with actual_hours + etc_hours';
  end if;
  if NEW.etc_cost is not null and NEW.eac_cost is not null
     and abs(NEW.eac_cost - (NEW.actual_cost + NEW.etc_cost)) > v_tolerance then
    raise exception 'forge_work: snapshot eac_cost inconsistent with actual_cost + etc_cost';
  end if;

  return NEW;
end $$;
drop trigger if exists forge_work_progress_snapshots_verify_trg on forge_work_progress_snapshots;
create trigger forge_work_progress_snapshots_verify_trg
  before insert on forge_work_progress_snapshots
  for each row execute function forge_work_snapshots_verify();

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
