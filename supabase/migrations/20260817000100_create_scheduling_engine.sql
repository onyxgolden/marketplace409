-- Scheduling engine (Gantt/CPM) core schema. See docs/scheduling/SPEC.md.
-- Ownership/RLS pattern mirrors supabase/migrations/20260812000300_create_rent_schedules_and_charges.sql
-- exactly: owner_id text (not uuid), composite (owner_id, id) primary keys, composite
-- (owner_id, x_id) foreign keys, force RLS with an owner-scoped "all" policy.

-- schedule_calendars is created before schedule_projects even though a calendar can
-- optionally belong to a project, because schedule_projects.default_calendar_id also
-- references schedule_calendars. The schedule_calendars -> schedule_projects direction
-- of that cycle is added via ALTER TABLE once schedule_projects exists.
create table if not exists schedule_calendars (
    owner_id text not null, id text not null,
    schedule_project_id text,
    name text not null,
    working_days jsonb not null default '{"mon":true,"tue":true,"wed":true,"thu":true,"fri":true,"sat":false,"sun":false}'::jsonb,
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
    project_type text not null check (project_type in ('capital_industrial', 'commercial_construction', 'residential_construction', 'custom')),
    start_date date not null, end_date date not null,
    default_calendar_id text,
    linked_entity_type text, linked_entity_id text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    foreign key (owner_id, default_calendar_id) references schedule_calendars(owner_id, id) on delete set null,
    check (end_date >= start_date),
    check ((linked_entity_type is null) = (linked_entity_id is null))
);

alter table schedule_calendars
    add constraint schedule_calendars_project_fkey
    foreign key (owner_id, schedule_project_id) references schedule_projects(owner_id, id) on delete cascade;

-- System-seeded reference data (starter lane/block sets per project_type), not owner-scoped.
create table if not exists schedule_templates (
    id text primary key,
    project_type text not null check (project_type in ('capital_industrial', 'commercial_construction', 'residential_construction', 'custom')),
    name text not null,
    template jsonb not null,
    created_at timestamptz not null default now()
);

create table if not exists schedule_lanes (
    owner_id text not null, id text not null, schedule_project_id text not null,
    name text not null,
    color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
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
    schedule_project_id text not null, lane_id text not null,
    label text not null,
    category text not null,
    block_type text not null check (block_type in ('task', 'milestone', 'hammock')),
    start_date date,
    duration_days int not null default 0 check (duration_days >= 0),
    calendar_id text,
    constraint_type text check (constraint_type in ('ASAP', 'ALAP', 'start_on', 'finish_on', 'SNET', 'SNLT', 'FNET', 'FNLT', 'must_start_on', 'must_finish_on')),
    constraint_date date,
    -- Computed by the CPM engine (spec §4), never directly user-edited.
    early_start date, early_finish date, late_start date, late_finish date,
    total_float_days int,
    is_critical boolean not null default false,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, schedule_project_id, task_code),
    foreign key (owner_id, schedule_project_id) references schedule_projects(owner_id, id) on delete cascade,
    foreign key (owner_id, lane_id) references schedule_lanes(owner_id, id) on delete cascade,
    foreign key (owner_id, calendar_id) references schedule_calendars(owner_id, id) on delete set null,
    check ((constraint_type is null) = (constraint_date is null)),
    check (block_type <> 'milestone' or duration_days = 0)
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
create index if not exists idx_schedule_lanes_owner_project on schedule_lanes(owner_id, schedule_project_id);
create index if not exists idx_schedule_blocks_owner_project on schedule_blocks(owner_id, schedule_project_id);
create index if not exists idx_schedule_blocks_owner_lane on schedule_blocks(owner_id, lane_id);
create index if not exists idx_schedule_dependencies_owner_predecessor on schedule_dependencies(owner_id, predecessor_id);
create index if not exists idx_schedule_dependencies_owner_successor on schedule_dependencies(owner_id, successor_id);
create index if not exists idx_schedule_hammock_anchors_owner_hammock on schedule_hammock_anchors(owner_id, hammock_block_id);

alter table schedule_calendars enable row level security;
alter table schedule_calendars force row level security;
alter table schedule_calendar_holidays enable row level security;
alter table schedule_calendar_holidays force row level security;
alter table schedule_projects enable row level security;
alter table schedule_projects force row level security;
alter table schedule_templates enable row level security;
alter table schedule_templates force row level security;
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
create policy "schedule_lanes_owner_all" on schedule_lanes for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "schedule_blocks_owner_all" on schedule_blocks for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "schedule_dependencies_owner_all" on schedule_dependencies for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "schedule_hammock_anchors_owner_all" on schedule_hammock_anchors for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);

-- Reference data: readable by any authenticated user, writable only via migration/service role.
create policy "schedule_templates_read_all" on schedule_templates for select to authenticated using (true);
