-- SCHED-05: resources and costs, schema only -- third capability area of the P6-parity build-out
-- (CPM engine: Phase 0/SCHED-01/SCHED-03; baselines+progress: SCHED-02/SCHED-04; this slice:
-- resources+costs; EVM+DCMA still to come). Nothing in the app writes to these tables yet -- same
-- discipline as every prior schema-only slice (Phase 0, SCHED-01, SCHED-02).
--
-- Scope decisions (kept here, not repeated per-table below):
--   1. Three resource types only -- labor, nonlabor, material. P6's separate "Roles" concept
--      (generic placeholder resources assigned before a real resource exists) is a flagged v2 item,
--      not built here.
--   2. schedule_cost_accounts is FLAT (no parent_id/hierarchy), unlike schedule_wbs_nodes. P6's real
--      cost-account tree is a v2 item; a flat code/name dictionary is enough to categorize a cost
--      line without inventing hierarchy depth this slice has no real data to justify.
--   3. No resource curves (front-loaded/back-loaded/manual). schedulingResources.js's
--      spreadUnitsAcrossWorkingDays spreads every assignment's budgeted_units evenly (fractional
--      units per day, no rounding) across the block's working days -- the only spread shape this
--      schema needs to support for v1.
--   4. No resource leveling (auto-shifting non-critical assignments within float to resolve
--      over-allocation) -- that's an algorithm on top of this data, not a schema concern, and is
--      substantial enough (comparable to the CPM engine itself) to warrant its own future slice
--      rather than being folded in here.
--   5. Owner-only RLS, deliberately NOT mirroring schedule_baselines'/schedule_projects'
--      public-select policy: cost/rate data is sensitive by default even on a project whose
--      schedule a non-owner can otherwise view. No schedule_resources/schedule_resource_assignments/
--      schedule_expenses/schedule_cost_accounts row is ever visible to anyone but its owner.
--   6. schedule_resource_assignments.resource_id is ON DELETE RESTRICT, not CASCADE (unlike every
--      other child-of-dictionary FK in this schema) -- deleting a resource that still has budget/
--      actual data tied to it would silently destroy cost history; the caller must remove or
--      reassign those assignments first. block_id is still ON DELETE CASCADE, matching
--      schedule_dependencies: an assignment is meaningless once its activity is gone.
--   7. schedule_expenses.accrual_type defaults to 'uniform' (spread across the activity's duration),
--      matching decision #3's even-spread default for resource assignments -- 'start'/'end' are
--      available for a cost genuinely incurred at one end (e.g. a permit fee paid on day one).

create table if not exists schedule_resources (
    owner_id text not null, id text not null,
    name text not null,
    resource_type text not null check (resource_type in ('labor', 'nonlabor', 'material')),
    unit_of_measure text,
    calendar_id text,
    max_units_per_day numeric not null default 8 check (max_units_per_day > 0),
    std_rate numeric not null default 0 check (std_rate >= 0),
    is_active boolean not null default true,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, name),
    foreign key (owner_id, calendar_id) references schedule_calendars(owner_id, id) on delete set null
);

create table if not exists schedule_cost_accounts (
    owner_id text not null, id text not null,
    code text not null,
    name text not null,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, code)
);

create table if not exists schedule_resource_assignments (
    owner_id text not null, id text not null,
    block_id text not null,
    resource_id text not null,
    cost_account_id text,
    budgeted_units numeric not null default 0 check (budgeted_units >= 0),
    rate_override numeric check (rate_override is null or rate_override >= 0),
    actual_units numeric not null default 0 check (actual_units >= 0),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, block_id, resource_id),
    foreign key (owner_id, block_id) references schedule_blocks(owner_id, id) on delete cascade,
    foreign key (owner_id, resource_id) references schedule_resources(owner_id, id) on delete restrict,
    foreign key (owner_id, cost_account_id) references schedule_cost_accounts(owner_id, id) on delete set null
);

create table if not exists schedule_expenses (
    owner_id text not null, id text not null,
    block_id text not null,
    cost_account_id text,
    name text not null,
    accrual_type text not null default 'uniform' check (accrual_type in ('start', 'end', 'uniform')),
    budgeted_cost numeric not null default 0 check (budgeted_cost >= 0),
    actual_cost numeric not null default 0 check (actual_cost >= 0),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    foreign key (owner_id, block_id) references schedule_blocks(owner_id, id) on delete cascade,
    foreign key (owner_id, cost_account_id) references schedule_cost_accounts(owner_id, id) on delete set null
);

create index if not exists idx_schedule_resources_owner_calendar on schedule_resources(owner_id, calendar_id);
create index if not exists idx_schedule_resource_assignments_owner_block on schedule_resource_assignments(owner_id, block_id);
create index if not exists idx_schedule_resource_assignments_owner_resource on schedule_resource_assignments(owner_id, resource_id);
create index if not exists idx_schedule_expenses_owner_block on schedule_expenses(owner_id, block_id);

alter table schedule_resources enable row level security;
alter table schedule_resources force row level security;
alter table schedule_cost_accounts enable row level security;
alter table schedule_cost_accounts force row level security;
alter table schedule_resource_assignments enable row level security;
alter table schedule_resource_assignments force row level security;
alter table schedule_expenses enable row level security;
alter table schedule_expenses force row level security;

create policy "schedule_resources_owner_all" on schedule_resources for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "schedule_cost_accounts_owner_all" on schedule_cost_accounts for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "schedule_resource_assignments_owner_all" on schedule_resource_assignments for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "schedule_expenses_owner_all" on schedule_expenses for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
