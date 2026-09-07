-- SCHED-20: fixes a confirmed production data-integrity defect in sync_schedule_project_from_board
-- (added by 20260904230000_add_schedule_project_resync_function.sql). That function deletes every
-- schedule_blocks row for a project and reinserts from the board JSON on EVERY save, unconditionally
-- -- not just when an activity is genuinely removed. Three concrete consequences, all confirmed by
-- reading that migration directly:
--   1. The reinsert hardcodes percent_complete to 0 -- progress is wiped on every save.
--   2. actual_start/actual_finish/constraint_type/constraint_date/calendar_id are not in the
--      reinsert's column list at all -- they revert to their table defaults (null) on every save.
--   3. schedule_resource_assignments.block_id and schedule_expenses.block_id are ON DELETE CASCADE
--      (by design -- an assignment/expense is meaningless once its activity is truly gone). Because
--      the resync deletes every block unconditionally and Postgres cascades immediately on DELETE,
--      every resource assignment and every expense on the project is destroyed on the very next
--      autosave, regardless of whether that save touched cost/resource data at all.
--   4. schedule_calendar_holidays are also deleted whenever their owning calendar is touched, and
--      are never reinserted anywhere (holidays are managed by a separate route, not the board JSON)
--      -- holidays are destroyed on every save and never come back.
--
-- This migration is schema-only plus function definitions -- no data cleanup, backfill, or
-- destructive statement against existing rows. Existing schedule_projects rows simply get
-- board_revision defaulting to 0; the next legitimate save through the new, non-destructive path
-- upserts everything correctly with no separate remediation step needed. Existing relational data
-- is left exactly as it is until then.
--
-- Design: sync_schedule_project_from_board(owner_id, project_id) keeps its exact name and signature
-- (the project-creation route calls it directly and unconditionally on a brand-new project, where
-- there is nothing to preserve yet) but its internals are rewritten from delete-then-reinsert to
-- upsert-by-stable-id, deleting only rows whose id is no longer present in the board being synced.
-- A new save_schedule_project_board(owner_id, project_id, board, expected_revision) wraps it with
-- what an autosave actually needs: locks the project row, rejects a stale save with a distinctive
-- error a route can translate to 409, writes the new board JSON, calls the (now non-destructive)
-- sync function, and bumps board_revision -- all inside the one transaction a single plpgsql call
-- already is, so a relational-sync failure now rolls back the JSON write too instead of leaving the
-- JSON and relational tables silently out of sync (the old route logged and ignored sync errors).

alter table schedule_projects
  add column if not exists board_revision bigint not null default 0;

-- Gantt-block-only fields (percent_complete, actual_start/actual_finish, constraint_type/date,
-- calendar_id override, and the CPM-computed early/late/float/critical columns) are relational-only
-- for a real Gantt activity (lane_id is not null, block_type in ('task','milestone')) -- edited via
-- their own dedicated routes (the progress PATCH route, the leveling-apply route, computeAndPersistCpm),
-- never through this board-sync path, and must never be touched by it on an update. WBS "activities"
-- (wbs_node_id is not null, lane_id is null) are a different case: percentComplete genuinely lives on
-- the board's own wbs.activities[].percentComplete field today (ActivitiesPage.jsx edits it there) --
-- that existing behavior is preserved unchanged, not part of this fix's scope.
create or replace function sync_schedule_project_from_board(p_owner_id text, p_project_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_board jsonb;
begin
  if auth.uid() is not null and p_owner_id <> auth.uid()::text then
    return;
  end if;

  select fsp.board into v_board
  from forge_scheduling_projects fsp
  where fsp.owner_id = p_owner_id and fsp.id = p_project_id;

  if v_board is null then
    return;
  end if;

  -- 1. Prune only what the caller actually removed. Children before parents, same order the
  -- original migration used, but "delete what's gone" instead of "delete everything then reinsert."
  --
  -- Dependencies/hammock anchors referencing a block this board no longer has.
  delete from schedule_dependencies sd
  where sd.owner_id = p_owner_id
    and (sd.predecessor_id in (select id from schedule_blocks where owner_id = p_owner_id and schedule_project_id = p_project_id)
      or sd.successor_id in (select id from schedule_blocks where owner_id = p_owner_id and schedule_project_id = p_project_id))
    and sd.id not in (
      select p_project_id || '_' || (dep ->> 'id')
      from jsonb_array_elements(coalesce(v_board -> 'dependencies', '[]'::jsonb)) as dep
    );
  delete from schedule_hammock_anchors sha
  where sha.owner_id = p_owner_id
    and sha.hammock_block_id in (select id from schedule_blocks where owner_id = p_owner_id and schedule_project_id = p_project_id)
    and sha.hammock_block_id not in (
      select p_project_id || '_' || (block ->> 'id')
      from jsonb_array_elements(coalesce(v_board -> 'blocks', '[]'::jsonb)) as block
      where (block ->> 'id') is not null
    );

  -- Blocks (Gantt + WBS-activity) genuinely removed from the board. Explicitly clear their
  -- assignments/expenses first -- ON DELETE CASCADE on schedule_blocks would do this anyway, but
  -- doing it explicitly here makes intentional-deletion cleanup predictable and auditable rather
  -- than an implicit side effect, per SCHED-20's own requirement.
  delete from schedule_resource_assignments sra
  where sra.owner_id = p_owner_id
    and sra.block_id in (
      select id from schedule_blocks
      where owner_id = p_owner_id and schedule_project_id = p_project_id
        and id not in (
          select p_project_id || '_' || (block ->> 'id') from jsonb_array_elements(coalesce(v_board -> 'blocks', '[]'::jsonb)) as block
          union all
          select p_project_id || '_' || (activity ->> 'id') from jsonb_array_elements(coalesce(v_board -> 'wbs' -> 'activities', '[]'::jsonb)) as activity
        )
    );
  delete from schedule_expenses se
  where se.owner_id = p_owner_id
    and se.block_id in (
      select id from schedule_blocks
      where owner_id = p_owner_id and schedule_project_id = p_project_id
        and id not in (
          select p_project_id || '_' || (block ->> 'id') from jsonb_array_elements(coalesce(v_board -> 'blocks', '[]'::jsonb)) as block
          union all
          select p_project_id || '_' || (activity ->> 'id') from jsonb_array_elements(coalesce(v_board -> 'wbs' -> 'activities', '[]'::jsonb)) as activity
        )
    );
  delete from schedule_blocks
  where owner_id = p_owner_id and schedule_project_id = p_project_id
    and id not in (
      select p_project_id || '_' || (block ->> 'id') from jsonb_array_elements(coalesce(v_board -> 'blocks', '[]'::jsonb)) as block
      union all
      select p_project_id || '_' || (activity ->> 'id') from jsonb_array_elements(coalesce(v_board -> 'wbs' -> 'activities', '[]'::jsonb)) as activity
    );

  -- Lanes, WBS nodes, blackout windows, calendars genuinely removed. A calendar's holidays are
  -- never touched here at all (they are not part of the board JSON -- managed by a separate route)
  -- and cascade-delete only if their owning calendar is itself genuinely pruned, which is correct.
  delete from schedule_lanes
  where owner_id = p_owner_id and schedule_project_id = p_project_id
    and id not in (select p_project_id || '_' || (lane ->> 'id') from jsonb_array_elements(coalesce(v_board -> 'lanes', '[]'::jsonb)) as lane);
  delete from schedule_wbs_nodes
  where owner_id = p_owner_id and schedule_project_id = p_project_id
    and id not in (select p_project_id || '_' || (node ->> 'id') from jsonb_array_elements(coalesce(v_board -> 'wbs' -> 'nodes', '[]'::jsonb)) as node);
  delete from schedule_blackout_windows
  where owner_id = p_owner_id and schedule_project_id = p_project_id
    and id not in (select p_project_id || '_' || (bw ->> 'id') from jsonb_array_elements(coalesce(v_board -> 'blackoutWindows', '[]'::jsonb)) as bw);
  delete from schedule_calendars
  where owner_id = p_owner_id and schedule_project_id = p_project_id
    and id not in (select p_project_id || '_' || (cal ->> 'id') from jsonb_array_elements(coalesce(v_board -> 'calendars', '[]'::jsonb)) as cal);

  -- 2. Project row itself: upsert core board-sourced fields. board_revision is deliberately never
  -- touched here (this function has no concurrency semantics of its own -- that's
  -- save_schedule_project_board's job); created_at is preserved on conflict, only updated_at moves.
  insert into schedule_projects (
    owner_id, id, name, project_type, template_id, start_date, end_date,
    is_public, next_id, next_task_number, client_metadata, created_at, updated_at
  )
  select
    p_owner_id, p_project_id, fsp.project_name, fsp.project_type, v_board ->> 'templateId',
    coalesce(fsp.start_date, (v_board ->> 'startDate')::date, current_date),
    coalesce(fsp.end_date, (v_board ->> 'endDate')::date, current_date),
    fsp.is_public,
    coalesce((v_board ->> 'nextId')::int, 1),
    coalesce((v_board ->> 'nextTaskNumber')::int, 1010),
    jsonb_build_object(
      'weekWidth', v_board -> 'weekWidth',
      'categoryNames', coalesce(v_board -> 'categoryNames', '{}'::jsonb),
      'starterChips', coalesce(v_board -> 'starterChips', '[]'::jsonb),
      'customChips', coalesce(v_board -> 'customChips', '[]'::jsonb)
    ),
    now(), now()
  from forge_scheduling_projects fsp
  where fsp.owner_id = p_owner_id and fsp.id = p_project_id
  on conflict (owner_id, id) do update set
    name = excluded.name, project_type = excluded.project_type, template_id = excluded.template_id,
    start_date = excluded.start_date, end_date = excluded.end_date, is_public = excluded.is_public,
    next_id = excluded.next_id, next_task_number = excluded.next_task_number,
    client_metadata = excluded.client_metadata, updated_at = now();

  -- 3. Calendars: upsert by id, name/working_days only -- holidays are never part of this table's
  -- write path.
  insert into schedule_calendars (owner_id, id, schedule_project_id, name, working_days, created_at, updated_at)
  select
    p_owner_id, p_project_id || '_' || (cal ->> 'id'), p_project_id, cal ->> 'name',
    coalesce(cal -> 'workingDays', '[1,2,3,4,5]'::jsonb), now(), now()
  from jsonb_array_elements(coalesce(v_board -> 'calendars', '[]'::jsonb)) as cal
  on conflict (owner_id, id) do update set
    name = excluded.name, working_days = excluded.working_days, updated_at = now();

  -- 4. Default calendar.
  update schedule_projects sp
  set default_calendar_id = case when v_board ->> 'defaultCalendarId' is null then null else p_project_id || '_' || (v_board ->> 'defaultCalendarId') end
  where sp.owner_id = p_owner_id and sp.id = p_project_id;

  -- 5. WBS nodes: upsert by id.
  insert into schedule_wbs_nodes (owner_id, id, schedule_project_id, parent_id, code, name, sort_order, created_at, updated_at)
  select
    p_owner_id, p_project_id || '_' || (node ->> 'id'), p_project_id,
    case when node ->> 'parentId' is null then null else p_project_id || '_' || (node ->> 'parentId') end,
    coalesce(node ->> 'code', ''), node ->> 'name', coalesce((node ->> 'order')::int, 0), now(), now()
  from jsonb_array_elements(coalesce(v_board -> 'wbs' -> 'nodes', '[]'::jsonb)) as node
  on conflict (owner_id, id) do update set
    parent_id = excluded.parent_id, code = excluded.code, name = excluded.name,
    sort_order = excluded.sort_order, updated_at = now();

  -- 6. Blackout windows: upsert by id.
  insert into schedule_blackout_windows (owner_id, id, schedule_project_id, label, start_date, end_date, created_at)
  select
    p_owner_id, p_project_id || '_' || (bw ->> 'id'), p_project_id, bw ->> 'label',
    (bw ->> 'startDate')::date, (bw ->> 'endDate')::date, now()
  from jsonb_array_elements(coalesce(v_board -> 'blackoutWindows', '[]'::jsonb)) as bw
  on conflict (owner_id, id) do update set
    label = excluded.label, start_date = excluded.start_date, end_date = excluded.end_date;

  -- 7. Lanes: upsert by id.
  insert into schedule_lanes (owner_id, id, schedule_project_id, name, color, calendar_id, sort_order, created_at, updated_at)
  select
    p_owner_id, p_project_id || '_' || (lane ->> 'id'), p_project_id, lane ->> 'name', null,
    case when lane ->> 'calendarId' is null then null else p_project_id || '_' || (lane ->> 'calendarId') end,
    ordinality - 1, now(), now()
  from jsonb_array_elements(coalesce(v_board -> 'lanes', '[]'::jsonb)) with ordinality as t(lane, ordinality)
  on conflict (owner_id, id) do update set
    name = excluded.name, calendar_id = excluded.calendar_id, sort_order = excluded.sort_order, updated_at = now();

  -- 8a. Gantt blocks: upsert by id. percent_complete/actual_start/actual_finish/constraint_type/
  -- constraint_date/calendar_id/early_start/early_finish/late_start/late_finish/total_float_days/
  -- is_critical are deliberately absent from the UPDATE SET below -- an existing block keeps
  -- whatever those routes already set. A brand-new block (INSERT branch) gets 0/null defaults,
  -- identical to today's behavior for a block nobody has touched yet.
  insert into schedule_blocks (
    owner_id, id, task_code, schedule_project_id, lane_id, wbs_node_id, label, category, block_type,
    start_date, duration_days, percent_complete, font_size, text_color, bold, sort_order,
    created_at, updated_at
  )
  select
    p_owner_id, p_project_id || '_' || (block ->> 'id'), block ->> 'taskCode', p_project_id,
    p_project_id || '_' || (block ->> 'laneId'), null, block ->> 'label', block ->> 'category',
    case when (block ->> 'milestone')::boolean then 'milestone' else 'task' end,
    (v_board ->> 'startDate')::date + (((block ->> 'startIdx')::int) * 7),
    case when (block ->> 'milestone')::boolean then 0 else ((block ->> 'duration')::int) * 7 end,
    0, (block ->> 'fontSize')::numeric, block ->> 'textColor',
    coalesce((block ->> 'bold')::boolean, true), 0, now(), now()
  from jsonb_array_elements(coalesce(v_board -> 'blocks', '[]'::jsonb)) as block
  on conflict (owner_id, id) do update set
    task_code = excluded.task_code, lane_id = excluded.lane_id, label = excluded.label,
    category = excluded.category, block_type = excluded.block_type, start_date = excluded.start_date,
    duration_days = excluded.duration_days, font_size = excluded.font_size, text_color = excluded.text_color,
    bold = excluded.bold, updated_at = now();

  -- 8b. WBS activities: upsert by id. percentComplete IS board-sourced for this kind of row (see
  -- the function-level comment above) -- unlike Gantt blocks, it is included in both branches here,
  -- unchanged from today's behavior. actual_start/actual_finish/constraint_type/constraint_date/
  -- calendar_id/CPM columns still excluded, matching every other block-kind consistently.
  insert into schedule_blocks (
    owner_id, id, task_code, schedule_project_id, lane_id, wbs_node_id, label, category, block_type,
    start_date, duration_days, percent_complete, bold, sort_order, created_at, updated_at
  )
  select
    p_owner_id, p_project_id || '_' || (activity ->> 'id'), activity ->> 'code', p_project_id, null,
    p_project_id || '_' || (activity ->> 'wbsId'), activity ->> 'name', 'wbs', 'task', null,
    coalesce(((activity ->> 'durationWeeks')::int) * 7, 0),
    coalesce((activity ->> 'percentComplete')::int, 0), true,
    coalesce((activity ->> 'order')::int, 0), now(), now()
  from jsonb_array_elements(coalesce(v_board -> 'wbs' -> 'activities', '[]'::jsonb)) as activity
  on conflict (owner_id, id) do update set
    task_code = excluded.task_code, wbs_node_id = excluded.wbs_node_id, label = excluded.label,
    duration_days = excluded.duration_days, percent_complete = excluded.percent_complete,
    sort_order = excluded.sort_order, updated_at = now();

  -- 9. Dependencies: upsert by id.
  insert into schedule_dependencies (owner_id, id, predecessor_id, successor_id, relationship_type, lag_days, created_at)
  select
    p_owner_id, p_project_id || '_' || (dep ->> 'id'), p_project_id || '_' || (dep ->> 'predecessorId'),
    p_project_id || '_' || (dep ->> 'successorId'), dep ->> 'relationshipType',
    coalesce((dep ->> 'lagDays')::int, 0), now()
  from jsonb_array_elements(coalesce(v_board -> 'dependencies', '[]'::jsonb)) as dep
  on conflict (owner_id, id) do update set
    predecessor_id = excluded.predecessor_id, successor_id = excluded.successor_id,
    relationship_type = excluded.relationship_type, lag_days = excluded.lag_days;
end;
$$;

revoke all on function sync_schedule_project_from_board(text, text) from public;
grant execute on function sync_schedule_project_from_board(text, text) to authenticated;

-- The atomic, concurrency-checked entry point every autosave now calls instead of a separate
-- forge_scheduling_projects.update() + a best-effort, errors-ignored rpc() from the route. Everything
-- below runs inside the one transaction a single plpgsql call already is: if the sync half throws,
-- the board-JSON write earlier in this same function rolls back too, so the two can never end up
-- disagreeing the way "log the sync error and return success anyway" allowed before.
--
-- p_expected_revision is the board_revision the caller last loaded (see GET .../[projectId], which
-- now returns it as board.boardRevision). "select ... for update" locks the row for the rest of this
-- transaction, closing the TOCTOU gap a plain "check then update" would leave open between two
-- concurrent saves. A null current revision (project not synced yet, or the RLS-owner check already
-- returned nothing) is treated as "cannot conflict with something that doesn't exist" and falls
-- through to the not-found path below instead.
create or replace function save_schedule_project_board(
  p_owner_id text, p_project_id text, p_board jsonb, p_expected_revision bigint
) returns table(board_revision bigint, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_current_revision bigint;
begin
  if auth.uid() is not null and p_owner_id <> auth.uid()::text then
    raise exception 'SCHEDULE_SAVE_NOT_FOUND';
  end if;

  select sp.board_revision into v_current_revision
  from schedule_projects sp
  where sp.owner_id = p_owner_id and sp.id = p_project_id
  for update;

  if v_current_revision is not null and v_current_revision <> p_expected_revision then
    raise exception 'SCHEDULE_SAVE_CONFLICT';
  end if;

  update forge_scheduling_projects
  set board = p_board,
      project_name = coalesce(p_board ->> 'projectName', project_name),
      start_date = coalesce((p_board ->> 'startDate')::date, start_date),
      end_date = coalesce((p_board ->> 'endDate')::date, end_date),
      updated_at = now()
  where owner_id = p_owner_id and id = p_project_id;

  if not found then
    raise exception 'SCHEDULE_SAVE_NOT_FOUND';
  end if;

  perform sync_schedule_project_from_board(p_owner_id, p_project_id);

  update schedule_projects
  set board_revision = coalesce(board_revision, 0) + 1, updated_at = now()
  where owner_id = p_owner_id and id = p_project_id;

  return query
  select sp.board_revision, fsp.updated_at
  from schedule_projects sp
  join forge_scheduling_projects fsp on fsp.owner_id = sp.owner_id and fsp.id = sp.id
  where sp.owner_id = p_owner_id and sp.id = p_project_id;
end;
$$;

revoke all on function save_schedule_project_board(text, text, jsonb, bigint) from public;
grant execute on function save_schedule_project_board(text, text, jsonb, bigint) to authenticated;
