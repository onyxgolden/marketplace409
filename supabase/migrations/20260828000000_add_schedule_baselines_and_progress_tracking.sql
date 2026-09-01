-- SCHED-02: baseline snapshots + true actual_start/actual_finish progress tracking, on top of the
-- Phase 0 relational schema (20260827000000_create_scheduling_relational_schema.sql) and the
-- SCHED-01 CPM engine. Schema only, same as Phase 0 -- nothing in the app writes to these
-- columns/tables yet.
--
-- actual_start/actual_finish are distinct from the existing percent_complete: percent_complete is
-- a coarse manual 0-100 estimate already driven by ActivitiesPage.jsx; actual_start/actual_finish
-- are real dates an activity truly started/finished on, matching P6's Actual Start/Actual Finish
-- fields, and are what schedulingBaselines.js prefers over CPM-projected early_start/early_finish
-- when computing variance (see that module for the precedence rule).
--
-- schedule_baseline_blocks stores a durable copy of each block's task_code, not a live schedule_blocks
-- foreign key -- a baseline snapshot must survive the live block later being edited or deleted so
-- variance can still be computed/explained after the fact (see schedulingBaselines.js
-- computeScheduleVariance's removed/added-since-baseline handling). total_float_days/is_critical are
-- captured now (cheap) as raw material for a future EVM/DCMA slice's "did the critical path shift
-- since baseline" checks -- nothing computes with them yet.
--
-- No schedule_baseline_dependencies snapshot table -- a deliberate simplification, see
-- schedulingBaselines.js's rollupProjectVariance for the consequence (max-across-all-blocks instead
-- of max-across-leaves-only) and why that's an accepted limitation, not a silent gap.

alter table schedule_blocks
    add column actual_start date,
    add column actual_finish date,
    add constraint schedule_blocks_actual_dates_check
        check (actual_start is null or actual_finish is null or actual_finish >= actual_start);

create table if not exists schedule_baselines (
    owner_id text not null, id text not null,
    schedule_project_id text not null,
    name text not null,
    created_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, schedule_project_id, name),
    foreign key (owner_id, schedule_project_id) references schedule_projects(owner_id, id) on delete cascade
);

create table if not exists schedule_baseline_blocks (
    owner_id text not null, id text not null,
    baseline_id text not null,
    block_task_code text not null,
    label text not null,
    block_type text not null check (block_type in ('task', 'milestone', 'hammock')),
    baseline_start date, baseline_finish date,
    baseline_duration_days int not null default 0 check (baseline_duration_days >= 0),
    percent_complete smallint not null default 0 check (percent_complete between 0 and 100),
    total_float_days int,
    is_critical boolean not null default false,
    created_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, baseline_id, block_task_code),
    foreign key (owner_id, baseline_id) references schedule_baselines(owner_id, id) on delete cascade,
    check ((baseline_start is null) = (baseline_finish is null)),
    check (baseline_start is null or baseline_finish is null or baseline_finish >= baseline_start)
);

create index if not exists idx_schedule_baselines_owner_project on schedule_baselines(owner_id, schedule_project_id);
create index if not exists idx_schedule_baseline_blocks_owner_baseline on schedule_baseline_blocks(owner_id, baseline_id);

alter table schedule_baselines enable row level security;
alter table schedule_baselines force row level security;
alter table schedule_baseline_blocks enable row level security;
alter table schedule_baseline_blocks force row level security;

create policy "schedule_baselines_owner_all" on schedule_baselines for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "schedule_baseline_blocks_owner_all" on schedule_baseline_blocks for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
