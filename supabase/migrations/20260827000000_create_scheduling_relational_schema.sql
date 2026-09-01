-- Scheduling engine (Gantt/CPM/WBS) relational schema -- Phase 0 of the P6-parity build-out.
-- Reconciles the abandoned scheduling-engine-phase1-schema branch (never merged, predates the
-- live JSONB-blob implementation) against everything that has since shipped on
-- forge_scheduling_projects.board: WBS hierarchy, calendars + blackout windows, FS/SS/FF/SF
-- dependencies with lag, 5 templates, text styling. See docs/scheduling/SPEC.md for the original
-- design and the plan at the time of this migration for the reconciliation decisions.
--
-- Ownership/RLS pattern mirrors the abandoned branch and the dominant codebase convention: owner_id
-- text (not uuid), composite (owner_id, id) primary keys, composite (owner_id, x_id) foreign keys,
-- force RLS with an owner-scoped "all" policy.
--
-- Reconciliation decisions vs. the abandoned draft (kept here, not repeated per-table below):
--   1. schedule_blocks unifies Gantt blocks and WBS activities into one entity (they already share
--      one task-numbering counter in the live app) -- lane_id is now nullable, a new wbs_node_id
--      column is added, and an activity must belong to at least one axis.
--   2. Day granularity (start_date/duration_days), matching P6 and the abandoned draft. The
--      backfill migration converts the live app's week-index data using the exact arithmetic the
--      app's own computeWeeks() already uses.
--   3. schedule_blackout_windows is new and kept separate from schedule_calendar_holidays -- a
--      blackout blacks out every calendar in a project at once for a one-off range; a holiday
--      recurs on one specific calendar.
--   4. schedule_templates is dropped entirely. Templates only matter at project-creation time, the
--      live app already has 5 fully-built client-side templates (vs. the abandoned draft's 4, two
--      of which were placeholder seeds), and nothing ever joins against them in SQL.
--   5. schedule_blocks gains font_size/text_color/bold -- this is persisted user data in the live
--      app today (the seeded Example project has real bold:true values), not a UI-only concern.
--      Undo/redo genuinely is UI-only (session-only, never persisted) -- no schema for it.
--
-- Also new vs. the abandoned draft: schedule_wbs_nodes (parent/child WBS tree -- didn't exist
-- before the WBS feature shipped; MAX_WBS_DEPTH=7 is enforced app-side by walking the ancestor
-- chain, exactly as wbsState.js does today, not by a DB check); percent_complete on schedule_blocks
-- (didn't exist before ActivitiesPage.jsx); schedule_calendars.working_days as an array of weekday
-- ints (0=Sun..6=Sat), matching the live app's shape, not the abandoned draft's {mon:true,...}
-- object; schedule_lanes.color made nullable (live lanes have no color field -- deriving one at
-- migration time would be inventing data).
--
-- CPM-computed columns on schedule_blocks (early_start/early_finish/late_start/late_finish/
-- total_float_days/is_critical) are populated by a future CPM-engine phase, not this one -- they
-- stay null/false here since no engine exists yet to populate them correctly.

-- schedule_calendars is created before schedule_projects even though a calendar can optionally
-- belong to a project, because schedule_projects.default_calendar_id also references
-- schedule_calendars. The schedule_calendars -> schedule_projects direction of that cycle is added
-- via ALTER TABLE once schedule_projects exists.
create table if not exists schedule_calendars (
    owner_id text not null, id text not null,
    schedule_project_id text,
    name text not null,
    working_days jsonb not null default '[1,2,3,4,5]'::jsonb,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id)
);

create table if not exists schedule_calendar_holidays (
    owner_id text not null, id text not null, calendar_id text not null,
    holiday_date date not null, label text,
    created_at timestamptz not null default now(),
    primary key (owner_id, id),
    foreign key (owner_id, calendar_id) references schedule_calendars(owner_id, id) on delete cascade
);

create table if not exists schedule_projects (
    owner_id text not null, id text not null,
    name text not null,
    project_type text,
    template_id text,
    start_date date not null, end_date date not null,
    default_calendar_id text,
    linked_entity_type text, linked_entity_id text,
    is_public boolean not null default false,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    foreign key (owner_id, default_calendar_id) references schedule_calendars(owner_id, id) on delete set null,
    check (end_date >= start_date),
    check ((linked_entity_type is null) = (linked_entity_id is null))
);

alter table schedule_calendars
    add constraint schedule_calendars_project_fkey
    foreign key (owner_id, schedule_project_id) references schedule_projects(owner_id, id) on delete cascade;

create table if not exists schedule_wbs_nodes (
    owner_id text not null, id text not null,
    schedule_project_id text not null,
    parent_id text,
    code text not null,
    name text not null,
    sort_order int not null default 0,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    foreign key (owner_id, schedule_project_id) references schedule_projects(owner_id, id) on delete cascade,
    foreign key (owner_id, parent_id) references schedule_wbs_nodes(owner_id, id) on delete cascade,
    check (parent_id <> id)
);

create table if not exists schedule_blackout_windows (
    owner_id text not null, id text not null,
    schedule_project_id text not null,
    label text,
    start_date date not null, end_date date not null,
    created_at timestamptz not null default now(),
    primary key (owner_id, id),
    foreign key (owner_id, schedule_project_id) references schedule_projects(owner_id, id) on delete cascade,
    check (end_date >= start_date)
);

create table if not exists schedule_lanes (
    owner_id text not null, id text not null, schedule_project_id text not null,
    name text not null,
    color text check (color ~ '^#[0-9a-fA-F]{6}$'),
    calendar_id text,
    sort_order int not null default 0,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    foreign key (owner_id, schedule_project_id) references schedule_projects(owner_id, id) on delete cascade,
    foreign key (owner_id, calendar_id) references schedule_calendars(owner_id, id) on delete set null
);

create table if not exists schedule_blocks (
    owner_id text not null, id text not null,
    task_code text not null,
    schedule_project_id text not null,
    lane_id text,
    wbs_node_id text,
    label text not null,
    category text not null,
    block_type text not null check (block_type in ('task', 'milestone', 'hammock')),
    start_date date,
    duration_days int not null default 0 check (duration_days >= 0),
    percent_complete smallint not null default 0 check (percent_complete between 0 and 100),
    calendar_id text,
    constraint_type text check (constraint_type in ('ASAP', 'ALAP', 'start_on', 'finish_on', 'SNET', 'SNLT', 'FNET', 'FNLT', 'must_start_on', 'must_finish_on')),
    constraint_date date,
    -- Computed by a future CPM engine, never directly user-edited.
    early_start date, early_finish date, late_start date, late_finish date,
    total_float_days int,
    is_critical boolean not null default false,
    font_size numeric,
    text_color text,
    bold boolean not null default true,
    sort_order int not null default 0,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, schedule_project_id, task_code),
    foreign key (owner_id, schedule_project_id) references schedule_projects(owner_id, id) on delete cascade,
    foreign key (owner_id, lane_id) references schedule_lanes(owner_id, id) on delete cascade,
    foreign key (owner_id, wbs_node_id) references schedule_wbs_nodes(owner_id, id) on delete cascade,
    foreign key (owner_id, calendar_id) references schedule_calendars(owner_id, id) on delete set null,
    check ((constraint_type is null) = (constraint_date is null)),
    check (block_type <> 'milestone' or duration_days = 0),
    check (lane_id is not null or wbs_node_id is not null)
);

create table if not exists schedule_dependencies (
    owner_id text not null, id text not null,
    predecessor_id text not null, successor_id text not null,
    relationship_type text not null check (relationship_type in ('FS', 'SS', 'FF', 'SF')),
    lag_days int not null default 0,
    created_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, predecessor_id, successor_id),
    foreign key (owner_id, predecessor_id) references schedule_blocks(owner_id, id) on delete cascade,
    foreign key (owner_id, successor_id) references schedule_blocks(owner_id, id) on delete cascade,
    check (predecessor_id <> successor_id)
);

create table if not exists schedule_hammock_anchors (
    owner_id text not null, id text not null,
    hammock_block_id text not null, anchor_block_id text not null,
    anchor_role text not null check (anchor_role in ('start', 'finish', 'both')),
    created_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, hammock_block_id, anchor_block_id),
    foreign key (owner_id, hammock_block_id) references schedule_blocks(owner_id, id) on delete cascade,
    foreign key (owner_id, anchor_block_id) references schedule_blocks(owner_id, id) on delete cascade,
    check (hammock_block_id <> anchor_block_id)
);

create index if not exists idx_schedule_calendar_holidays_owner_calendar on schedule_calendar_holidays(owner_id, calendar_id);
create index if not exists idx_schedule_wbs_nodes_owner_project on schedule_wbs_nodes(owner_id, schedule_project_id);
create index if not exists idx_schedule_wbs_nodes_owner_parent on schedule_wbs_nodes(owner_id, parent_id);
create index if not exists idx_schedule_blackout_windows_owner_project on schedule_blackout_windows(owner_id, schedule_project_id);
create index if not exists idx_schedule_lanes_owner_project on schedule_lanes(owner_id, schedule_project_id);
create index if not exists idx_schedule_blocks_owner_project on schedule_blocks(owner_id, schedule_project_id);
create index if not exists idx_schedule_blocks_owner_lane on schedule_blocks(owner_id, lane_id);
create index if not exists idx_schedule_blocks_owner_wbs_node on schedule_blocks(owner_id, wbs_node_id);
create index if not exists idx_schedule_dependencies_owner_predecessor on schedule_dependencies(owner_id, predecessor_id);
create index if not exists idx_schedule_dependencies_owner_successor on schedule_dependencies(owner_id, successor_id);
create index if not exists idx_schedule_hammock_anchors_owner_hammock on schedule_hammock_anchors(owner_id, hammock_block_id);

alter table schedule_calendars enable row level security;
alter table schedule_calendars force row level security;
alter table schedule_calendar_holidays enable row level security;
alter table schedule_calendar_holidays force row level security;
alter table schedule_projects enable row level security;
alter table schedule_projects force row level security;
alter table schedule_wbs_nodes enable row level security;
alter table schedule_wbs_nodes force row level security;
alter table schedule_blackout_windows enable row level security;
alter table schedule_blackout_windows force row level security;
alter table schedule_lanes enable row level security;
alter table schedule_lanes force row level security;
alter table schedule_blocks enable row level security;
alter table schedule_blocks force row level security;
alter table schedule_dependencies enable row level security;
alter table schedule_dependencies force row level security;
alter table schedule_hammock_anchors enable row level security;
alter table schedule_hammock_anchors force row level security;

create policy "schedule_calendars_owner_all" on schedule_calendars for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "schedule_calendar_holidays_owner_all" on schedule_calendar_holidays for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "schedule_projects_owner_all" on schedule_projects for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "schedule_projects_public_select" on schedule_projects for select to authenticated
using (is_public = true);
create policy "schedule_wbs_nodes_owner_all" on schedule_wbs_nodes for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "schedule_blackout_windows_owner_all" on schedule_blackout_windows for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "schedule_lanes_owner_all" on schedule_lanes for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "schedule_blocks_owner_all" on schedule_blocks for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "schedule_dependencies_owner_all" on schedule_dependencies for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "schedule_hammock_anchors_owner_all" on schedule_hammock_anchors for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
