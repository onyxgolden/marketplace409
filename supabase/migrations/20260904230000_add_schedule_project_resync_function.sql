-- SCHED-03: makes the schedule_* relational tables a genuinely live mirror of
-- forge_scheduling_projects.board, not a one-time snapshot. The backfill migration
-- (20260827000100_backfill_scheduling_projects_from_board_jsonb.sql) is insert-only ("on conflict
-- do nothing") -- any project created or edited since it ran has stale or entirely missing
-- relational rows. sync_schedule_project_from_board(owner_id, project_id) is that migration's exact
-- per-table transformation (same week->day arithmetic, same <project_id>_<legacy_id> namespacing),
-- generalized into a callable, per-project, safely-re-runnable resync: delete every relational row
-- for that one project, then re-insert from its current board. Called by the API after every save
-- (see src/app/api/forge/scheduling/[projectId]/route.js) and once below for every existing project,
-- to fix today's staleness in the same deploy that starts relying on it.
--
-- Delete order respects FK dependents-before-parents; default_calendar_id is nulled before its
-- calendar row is deleted, mirroring the circular-reference handling the backfill migration already
-- does for creation. Runs security definer, callable only by `authenticated`, and re-derives
-- p_owner_id/p_project_id itself from forge_scheduling_projects rather than trusting the caller's
-- arguments blindly -- the function only ever touches the one (owner_id, project_id) row pair
-- actually found there, so a caller cannot use it to touch another owner's data even by passing a
-- mismatched owner_id/project_id pair.
--
-- client_metadata is the board's UI/config fields with no relational column of their own
-- (weekWidth, categoryNames, starterChips, customChips) -- an escape hatch for genuinely incidental,
-- non-scheduling data rather than inventing a column per field or a second full-fidelity store.
-- next_id/next_task_number are the board's monotonic id/task-number counters, which must survive
-- the cutover unchanged (resetting either would risk id collisions the next time something is added).

alter table schedule_projects
  add column if not exists next_id integer not null default 1,
  add column if not exists next_task_number integer not null default 1010,
  add column if not exists client_metadata jsonb not null default '{}'::jsonb;

-- Every other schedule_* table has only its owner-scoped "for all" policy -- unlike
-- schedule_projects (and forge_scheduling_projects), none of them carry schedule_projects'
-- is_public carve-out. That's harmless while nothing reads them, but the moment an API route
-- starts treating them as the real source of truth for a project's board (this migration's whole
-- point), a non-owner viewing the shared "Example project" would see an EMPTY board -- RLS would
-- return zero rows from every one of these tables even though they can already see the project
-- row and its (still-authoritative-for-now) jsonb board. schedule_dependencies and
-- schedule_hammock_anchors have no schedule_project_id column of their own, so their policy joins
-- through schedule_blocks to reach schedule_projects.is_public.
create policy "schedule_calendars_public_select" on schedule_calendars for select to authenticated
using (exists (
  select 1 from schedule_projects sp
  where sp.owner_id = schedule_calendars.owner_id and sp.id = schedule_calendars.schedule_project_id and sp.is_public = true
));
create policy "schedule_calendar_holidays_public_select" on schedule_calendar_holidays for select to authenticated
using (exists (
  select 1 from schedule_calendars c join schedule_projects sp on sp.owner_id = c.owner_id and sp.id = c.schedule_project_id
  where c.owner_id = schedule_calendar_holidays.owner_id and c.id = schedule_calendar_holidays.calendar_id and sp.is_public = true
));
create policy "schedule_wbs_nodes_public_select" on schedule_wbs_nodes for select to authenticated
using (exists (
  select 1 from schedule_projects sp
  where sp.owner_id = schedule_wbs_nodes.owner_id and sp.id = schedule_wbs_nodes.schedule_project_id and sp.is_public = true
));
create policy "schedule_blackout_windows_public_select" on schedule_blackout_windows for select to authenticated
using (exists (
  select 1 from schedule_projects sp
  where sp.owner_id = schedule_blackout_windows.owner_id and sp.id = schedule_blackout_windows.schedule_project_id and sp.is_public = true
));
create policy "schedule_lanes_public_select" on schedule_lanes for select to authenticated
using (exists (
  select 1 from schedule_projects sp
  where sp.owner_id = schedule_lanes.owner_id and sp.id = schedule_lanes.schedule_project_id and sp.is_public = true
));
create policy "schedule_blocks_public_select" on schedule_blocks for select to authenticated
using (exists (
  select 1 from schedule_projects sp
  where sp.owner_id = schedule_blocks.owner_id and sp.id = schedule_blocks.schedule_project_id and sp.is_public = true
));
create policy "schedule_dependencies_public_select" on schedule_dependencies for select to authenticated
using (exists (
  select 1 from schedule_blocks b join schedule_projects sp on sp.owner_id = b.owner_id and sp.id = b.schedule_project_id
  where b.owner_id = schedule_dependencies.owner_id and b.id = schedule_dependencies.predecessor_id and sp.is_public = true
));
create policy "schedule_hammock_anchors_public_select" on schedule_hammock_anchors for select to authenticated
using (exists (
  select 1 from schedule_blocks b join schedule_projects sp on sp.owner_id = b.owner_id and sp.id = b.schedule_project_id
  where b.owner_id = schedule_hammock_anchors.owner_id and b.id = schedule_hammock_anchors.hammock_block_id and sp.is_public = true
));

create or replace function sync_schedule_project_from_board(p_owner_id text, p_project_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- security definer bypasses RLS (needed for the multi-table delete+reinsert below), so this
  -- function must enforce the ownership boundary RLS would otherwise apply -- without this check,
  -- any authenticated caller could pass an arbitrary owner_id (this function is a Postgres function
  -- callable directly via supabase.rpc(), not only from the Next.js API route that always passes
  -- the caller's own id) and force a resync of another owner's data. Guard is skipped only when
  -- there is no session at all (auth.uid() is null) -- true exclusively for the migration-runner-
  -- privilege one-time catch-up loop below, matching how the original backfill migration already
  -- runs "at migration-runner privilege, no RLS/auth.uid() involved." Written as an explicit
  -- "is not null and ..." rather than relying on `<>`'s implicit-false-on-null behavior, so the
  -- intent doesn't depend on a subtle SQL NULL-comparison detail.
  if auth.uid() is not null and p_owner_id <> auth.uid()::text then
    return;
  end if;

  -- Re-derive everything from the one forge_scheduling_projects row actually matching both
  -- arguments -- if it doesn't exist (wrong project id, or already deleted), there is nothing to
  -- sync and no relational row anywhere is touched.
  if not exists (
    select 1 from forge_scheduling_projects
    where owner_id = p_owner_id and id = p_project_id
  ) then
    return;
  end if;

  -- 1. Clear this project's existing relational rows, children before parents.
  delete from schedule_dependencies
    where owner_id = p_owner_id
      and predecessor_id in (select id from schedule_blocks where owner_id = p_owner_id and schedule_project_id = p_project_id);
  delete from schedule_hammock_anchors
    where owner_id = p_owner_id
      and hammock_block_id in (select id from schedule_blocks where owner_id = p_owner_id and schedule_project_id = p_project_id);
  delete from schedule_blocks where owner_id = p_owner_id and schedule_project_id = p_project_id;
  delete from schedule_lanes where owner_id = p_owner_id and schedule_project_id = p_project_id;
  delete from schedule_blackout_windows where owner_id = p_owner_id and schedule_project_id = p_project_id;
  delete from schedule_wbs_nodes where owner_id = p_owner_id and schedule_project_id = p_project_id;
  update schedule_projects set default_calendar_id = null where owner_id = p_owner_id and id = p_project_id;
  delete from schedule_calendar_holidays
    where owner_id = p_owner_id
      and calendar_id in (select id from schedule_calendars where owner_id = p_owner_id and schedule_project_id = p_project_id);
  delete from schedule_calendars where owner_id = p_owner_id and schedule_project_id = p_project_id;

  -- 2. Project row itself: upsert (it may not exist yet for a project created after this function
  -- was added), including the new client_metadata/next_id/next_task_number columns.
  insert into schedule_projects (
    owner_id, id, name, project_type, template_id, start_date, end_date,
    linked_entity_type, linked_entity_id, is_public, next_id, next_task_number, client_metadata,
    created_at, updated_at
  )
  select
    fsp.owner_id, fsp.id, fsp.project_name, fsp.project_type, fsp.board ->> 'templateId',
    coalesce(fsp.start_date, (fsp.board ->> 'startDate')::date, current_date),
    coalesce(fsp.end_date, (fsp.board ->> 'endDate')::date, current_date),
    null, null, fsp.is_public,
    coalesce((fsp.board ->> 'nextId')::int, 1),
    coalesce((fsp.board ->> 'nextTaskNumber')::int, 1010),
    jsonb_build_object(
      'weekWidth', fsp.board -> 'weekWidth',
      'categoryNames', coalesce(fsp.board -> 'categoryNames', '{}'::jsonb),
      'starterChips', coalesce(fsp.board -> 'starterChips', '[]'::jsonb),
      'customChips', coalesce(fsp.board -> 'customChips', '[]'::jsonb)
    ),
    fsp.created_at, fsp.updated_at
  from forge_scheduling_projects fsp
  where fsp.owner_id = p_owner_id and fsp.id = p_project_id
  on conflict (owner_id, id) do update set
    name = excluded.name, project_type = excluded.project_type, template_id = excluded.template_id,
    start_date = excluded.start_date, end_date = excluded.end_date, is_public = excluded.is_public,
    next_id = excluded.next_id, next_task_number = excluded.next_task_number,
    client_metadata = excluded.client_metadata, updated_at = excluded.updated_at;

  -- 3. Calendars.
  insert into schedule_calendars (owner_id, id, schedule_project_id, name, working_days, created_at, updated_at)
  select
    fsp.owner_id, fsp.id || '_' || (cal ->> 'id'), fsp.id, cal ->> 'name',
    coalesce(cal -> 'workingDays', '[1,2,3,4,5]'::jsonb), fsp.created_at, fsp.updated_at
  from forge_scheduling_projects fsp,
       jsonb_array_elements(coalesce(fsp.board -> 'calendars', '[]'::jsonb)) as cal
  where fsp.owner_id = p_owner_id and fsp.id = p_project_id;

  -- 4. Default calendar (now that calendars exist again).
  update schedule_projects sp
  set default_calendar_id = fsp.id || '_' || (fsp.board ->> 'defaultCalendarId')
  from forge_scheduling_projects fsp
  where sp.owner_id = fsp.owner_id and sp.id = fsp.id
    and fsp.owner_id = p_owner_id and fsp.id = p_project_id
    and fsp.board ->> 'defaultCalendarId' is not null;

  -- 5. WBS nodes.
  insert into schedule_wbs_nodes (owner_id, id, schedule_project_id, parent_id, code, name, sort_order, created_at, updated_at)
  select
    fsp.owner_id, fsp.id || '_' || (node ->> 'id'), fsp.id,
    case when node ->> 'parentId' is null then null else fsp.id || '_' || (node ->> 'parentId') end,
    coalesce(node ->> 'code', ''), node ->> 'name', coalesce((node ->> 'order')::int, 0),
    fsp.created_at, fsp.updated_at
  from forge_scheduling_projects fsp,
       jsonb_array_elements(coalesce(fsp.board -> 'wbs' -> 'nodes', '[]'::jsonb)) as node
  where fsp.owner_id = p_owner_id and fsp.id = p_project_id;

  -- 6. Blackout windows.
  insert into schedule_blackout_windows (owner_id, id, schedule_project_id, label, start_date, end_date, created_at)
  select
    fsp.owner_id, fsp.id || '_' || (bw ->> 'id'), fsp.id, bw ->> 'label',
    (bw ->> 'startDate')::date, (bw ->> 'endDate')::date, fsp.created_at
  from forge_scheduling_projects fsp,
       jsonb_array_elements(coalesce(fsp.board -> 'blackoutWindows', '[]'::jsonb)) as bw
  where fsp.owner_id = p_owner_id and fsp.id = p_project_id;

  -- 7. Lanes.
  insert into schedule_lanes (owner_id, id, schedule_project_id, name, color, calendar_id, sort_order, created_at, updated_at)
  select
    fsp.owner_id, fsp.id || '_' || (lane ->> 'id'), fsp.id, lane ->> 'name', null,
    case when lane ->> 'calendarId' is null then null else fsp.id || '_' || (lane ->> 'calendarId') end,
    ordinality - 1, fsp.created_at, fsp.updated_at
  from forge_scheduling_projects fsp,
       jsonb_array_elements(coalesce(fsp.board -> 'lanes', '[]'::jsonb)) with ordinality as t(lane, ordinality)
  where fsp.owner_id = p_owner_id and fsp.id = p_project_id;

  -- 8. Blocks -- Gantt blocks and WBS activities, unified table (see Phase 0 migration's rationale).
  insert into schedule_blocks (
    owner_id, id, task_code, schedule_project_id, lane_id, wbs_node_id, label, category, block_type,
    start_date, duration_days, percent_complete, font_size, text_color, bold, sort_order,
    created_at, updated_at
  )
  select
    fsp.owner_id, fsp.id || '_' || (block ->> 'id'), block ->> 'taskCode', fsp.id,
    fsp.id || '_' || (block ->> 'laneId'), null, block ->> 'label', block ->> 'category',
    case when (block ->> 'milestone')::boolean then 'milestone' else 'task' end,
    (fsp.board ->> 'startDate')::date + (((block ->> 'startIdx')::int) * 7),
    case when (block ->> 'milestone')::boolean then 0 else ((block ->> 'duration')::int) * 7 end,
    0, (block ->> 'fontSize')::numeric, block ->> 'textColor',
    coalesce((block ->> 'bold')::boolean, true), 0, fsp.created_at, fsp.updated_at
  from forge_scheduling_projects fsp,
       jsonb_array_elements(coalesce(fsp.board -> 'blocks', '[]'::jsonb)) as block
  where fsp.owner_id = p_owner_id and fsp.id = p_project_id;

  insert into schedule_blocks (
    owner_id, id, task_code, schedule_project_id, lane_id, wbs_node_id, label, category, block_type,
    start_date, duration_days, percent_complete, bold, sort_order, created_at, updated_at
  )
  select
    fsp.owner_id, fsp.id || '_' || (activity ->> 'id'), activity ->> 'code', fsp.id, null,
    fsp.id || '_' || (activity ->> 'wbsId'), activity ->> 'name', 'wbs', 'task', null,
    coalesce(((activity ->> 'durationWeeks')::int) * 7, 0),
    coalesce((activity ->> 'percentComplete')::int, 0), true,
    coalesce((activity ->> 'order')::int, 0), fsp.created_at, fsp.updated_at
  from forge_scheduling_projects fsp,
       jsonb_array_elements(coalesce(fsp.board -> 'wbs' -> 'activities', '[]'::jsonb)) as activity
  where fsp.owner_id = p_owner_id and fsp.id = p_project_id;

  -- 9. Dependencies.
  insert into schedule_dependencies (owner_id, id, predecessor_id, successor_id, relationship_type, lag_days, created_at)
  select
    fsp.owner_id, fsp.id || '_' || (dep ->> 'id'), fsp.id || '_' || (dep ->> 'predecessorId'),
    fsp.id || '_' || (dep ->> 'successorId'), dep ->> 'relationshipType',
    coalesce((dep ->> 'lagDays')::int, 0), fsp.created_at
  from forge_scheduling_projects fsp,
       jsonb_array_elements(coalesce(fsp.board -> 'dependencies', '[]'::jsonb)) as dep
  where fsp.owner_id = p_owner_id and fsp.id = p_project_id;
end;
$$;

revoke all on function sync_schedule_project_from_board(text, text) from public;
grant execute on function sync_schedule_project_from_board(text, text) to authenticated;

-- One-time catch-up: fix today's staleness (every project created/edited since the insert-only
-- backfill ran) in the same deploy that starts relying on this function going forward.
do $$
declare project_row record;
begin
  for project_row in select owner_id, id from forge_scheduling_projects loop
    perform sync_schedule_project_from_board(project_row.owner_id, project_row.id);
  end loop;
end $$;
