-- Backfills the new schedule_* relational tables from every existing forge_scheduling_projects
-- row's board jsonb blob. Pure insert...select, runs at migration-runner privilege (no RLS/
-- auth.uid() involved), idempotent via "on conflict do nothing" keyed on each table's primary key.
-- Not hardcoded to any specific number of rows -- backfills whatever exists in
-- forge_scheduling_projects at the time this migration actually runs.
--
-- Id-namespacing: board-internal ids (e.g. "b1", "dep31", "lane_5") are per-board counters,
-- harmless inside a JSONB blob but colliding across an owner's multiple projects once flattened
-- into relational tables keyed by (owner_id, id). Every id and every id-shaped reference is
-- namespaced on the way in as <schedule_project_id>_<legacy_id>, applied identically on both ends
-- of every reference so joins still resolve. schedule_projects.id itself needs no namespacing --
-- it's already a globally-unique schedule_project_<uuid>.
--
-- Week-to-day conversion uses the exact arithmetic schedulingBoardState.js's computeWeeks() already
-- uses (start_date = board.startDate + startIdx * 7 days, duration_days = duration * 7), not a
-- lossy approximation -- src/domains/scheduling/schedulingRelationalMapping.js reimplements this
-- same transformation independently in JS as a second, cross-checked implementation.
--
-- schedule_projects and schedule_calendars have a circular reference (a project's default calendar
-- points at a calendar row, and a calendar's schedule_project_id points back at the project), so
-- projects are inserted first with default_calendar_id left null, then backfilled by a later
-- update once the referenced calendar rows exist.

-- 1. Projects, without default_calendar_id yet (resolved in step 3, after calendars exist).
insert into schedule_projects (
  owner_id, id, name, project_type, template_id, start_date, end_date,
  linked_entity_type, linked_entity_id, is_public, created_at, updated_at
)
select
  fsp.owner_id,
  fsp.id,
  fsp.project_name,
  fsp.project_type,
  fsp.board ->> 'templateId',
  coalesce(fsp.start_date, (fsp.board ->> 'startDate')::date, current_date),
  coalesce(fsp.end_date, (fsp.board ->> 'endDate')::date, current_date),
  null,
  null,
  fsp.is_public,
  fsp.created_at,
  fsp.updated_at
from forge_scheduling_projects fsp
on conflict (owner_id, id) do nothing;

-- 2. Calendars (schedule_projects now exists, satisfying schedule_calendars' project FK).
insert into schedule_calendars (
  owner_id, id, schedule_project_id, name, working_days, created_at, updated_at
)
select
  fsp.owner_id,
  fsp.id || '_' || (cal ->> 'id'),
  fsp.id,
  cal ->> 'name',
  coalesce(cal -> 'workingDays', '[1,2,3,4,5]'::jsonb),
  fsp.created_at,
  fsp.updated_at
from forge_scheduling_projects fsp,
     jsonb_array_elements(coalesce(fsp.board -> 'calendars', '[]'::jsonb)) as cal
on conflict (owner_id, id) do nothing;

-- 3. Now that calendars exist, backfill each project's default_calendar_id.
update schedule_projects sp
set default_calendar_id = fsp.id || '_' || (fsp.board ->> 'defaultCalendarId')
from forge_scheduling_projects fsp
where sp.owner_id = fsp.owner_id
  and sp.id = fsp.id
  and fsp.board ->> 'defaultCalendarId' is not null;

-- 4. WBS nodes.
insert into schedule_wbs_nodes (
  owner_id, id, schedule_project_id, parent_id, code, name, sort_order, created_at, updated_at
)
select
  fsp.owner_id,
  fsp.id || '_' || (node ->> 'id'),
  fsp.id,
  case when node ->> 'parentId' is null then null else fsp.id || '_' || (node ->> 'parentId') end,
  coalesce(node ->> 'code', ''),
  node ->> 'name',
  coalesce((node ->> 'order')::int, 0),
  fsp.created_at,
  fsp.updated_at
from forge_scheduling_projects fsp,
     jsonb_array_elements(coalesce(fsp.board -> 'wbs' -> 'nodes', '[]'::jsonb)) as node
on conflict (owner_id, id) do nothing;

-- 5. Blackout windows.
insert into schedule_blackout_windows (
  owner_id, id, schedule_project_id, label, start_date, end_date, created_at
)
select
  fsp.owner_id,
  fsp.id || '_' || (bw ->> 'id'),
  fsp.id,
  bw ->> 'label',
  (bw ->> 'startDate')::date,
  (bw ->> 'endDate')::date,
  fsp.created_at
from forge_scheduling_projects fsp,
     jsonb_array_elements(coalesce(fsp.board -> 'blackoutWindows', '[]'::jsonb)) as bw
on conflict (owner_id, id) do nothing;

-- 6. Lanes (needs calendars for the optional per-lane calendar_id override).
insert into schedule_lanes (
  owner_id, id, schedule_project_id, name, color, calendar_id, sort_order, created_at, updated_at
)
select
  fsp.owner_id,
  fsp.id || '_' || (lane ->> 'id'),
  fsp.id,
  lane ->> 'name',
  null,
  case when lane ->> 'calendarId' is null then null else fsp.id || '_' || (lane ->> 'calendarId') end,
  ordinality - 1,
  fsp.created_at,
  fsp.updated_at
from forge_scheduling_projects fsp,
     jsonb_array_elements(coalesce(fsp.board -> 'lanes', '[]'::jsonb)) with ordinality as t(lane, ordinality)
on conflict (owner_id, id) do nothing;

-- 7. Blocks -- Gantt blocks and WBS activities unified into one table (schema Decision 1). Gantt
-- blocks get lane_id set / wbs_node_id null; WBS activities get the reverse. WBS activities have
-- no category or placement data in the live shape, so category defaults to the 'wbs' sentinel and
-- start_date stays null (never had placement data to begin with).
insert into schedule_blocks (
  owner_id, id, task_code, schedule_project_id, lane_id, wbs_node_id, label, category, block_type,
  start_date, duration_days, percent_complete, font_size, text_color, bold, sort_order,
  created_at, updated_at
)
select
  fsp.owner_id,
  fsp.id || '_' || (block ->> 'id'),
  block ->> 'taskCode',
  fsp.id,
  fsp.id || '_' || (block ->> 'laneId'),
  null,
  block ->> 'label',
  block ->> 'category',
  case when (block ->> 'milestone')::boolean then 'milestone' else 'task' end,
  (fsp.board ->> 'startDate')::date + (((block ->> 'startIdx')::int) * 7),
  case when (block ->> 'milestone')::boolean then 0 else ((block ->> 'duration')::int) * 7 end,
  0,
  (block ->> 'fontSize')::numeric,
  block ->> 'textColor',
  coalesce((block ->> 'bold')::boolean, true),
  0,
  fsp.created_at,
  fsp.updated_at
from forge_scheduling_projects fsp,
     jsonb_array_elements(coalesce(fsp.board -> 'blocks', '[]'::jsonb)) as block
on conflict (owner_id, schedule_project_id, task_code) do nothing;

insert into schedule_blocks (
  owner_id, id, task_code, schedule_project_id, lane_id, wbs_node_id, label, category, block_type,
  start_date, duration_days, percent_complete, bold, sort_order, created_at, updated_at
)
select
  fsp.owner_id,
  fsp.id || '_' || (activity ->> 'id'),
  activity ->> 'code',
  fsp.id,
  null,
  fsp.id || '_' || (activity ->> 'wbsId'),
  activity ->> 'name',
  'wbs',
  'task',
  null,
  coalesce(((activity ->> 'durationWeeks')::int) * 7, 0),
  coalesce((activity ->> 'percentComplete')::int, 0),
  true,
  coalesce((activity ->> 'order')::int, 0),
  fsp.created_at,
  fsp.updated_at
from forge_scheduling_projects fsp,
     jsonb_array_elements(coalesce(fsp.board -> 'wbs' -> 'activities', '[]'::jsonb)) as activity
on conflict (owner_id, schedule_project_id, task_code) do nothing;

-- 8. Dependencies (needs schedule_blocks to exist for both ends).
insert into schedule_dependencies (
  owner_id, id, predecessor_id, successor_id, relationship_type, lag_days, created_at
)
select
  fsp.owner_id,
  fsp.id || '_' || (dep ->> 'id'),
  fsp.id || '_' || (dep ->> 'predecessorId'),
  fsp.id || '_' || (dep ->> 'successorId'),
  dep ->> 'relationshipType',
  coalesce((dep ->> 'lagDays')::int, 0),
  fsp.created_at
from forge_scheduling_projects fsp,
     jsonb_array_elements(coalesce(fsp.board -> 'dependencies', '[]'::jsonb)) as dep
on conflict (owner_id, predecessor_id, successor_id) do nothing;
