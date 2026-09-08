-- SCHED-21B1: makes sync_schedule_project_from_board understand a day-precise board
-- (schemaVersion 2, block.startOffsetDays/durationDays) while continuing to serve every board
-- being saved today (no schemaVersion field, or schemaVersion 1, block.startIdx/duration in
-- weeks) exactly as before -- byte-for-byte the same arithmetic, same rounding.
--
-- This is deliberately schema-only-adjacent and function-only: no new column, no data migration,
-- no backfill. The live application does not send schemaVersion 2 yet -- that's SCHED-21B2, a
-- separate, later PR -- so after this migration ships, every real save in production still takes
-- the legacy branch below and behaves identically to before this migration. The new branch exists
-- and is tested, but is inert in production until SCHED-21B2's frontend ships.
--
-- Why this ships alone, ahead of the frontend: per Jason's explicit correction to the original
-- SCHED-21 day-precision proposal, a Vercel deployment and a Supabase migration are not one atomic
-- release and must never be treated as one -- shipping the SQL and the board-shape change together
-- would mean any rollback of either side, alone, breaks live saves for whichever board shape the
-- other side no longer understands. Shipping this migration first, alone, means: the old frontend
-- keeps saving legacy boards through it, unaffected, for as long as needed before SCHED-21B2 ships;
-- and if SCHED-21B2 itself ever needs to be rolled back later, this SQL still understands the
-- legacy shape it rolls back to, so no coordinated two-sided rollback is ever required.
--
-- v_schema_version is read once, coalesced to 1 (legacy) when absent -- an already-existing board
-- saved before this concept existed has no schemaVersion key at all, and must be treated exactly
-- like an explicit schemaVersion: 1, per SCHED-21's own compatibility design (see
-- schedulingBoardState.js's migrateBoardToDaySchema, SCHED-21B2). Any future schemaVersion > 2
-- also takes the >= 2 (day-precise) branch, forward-compatible with this same field shape by
-- construction, not by explicit enumeration.
create or replace function sync_schedule_project_from_board(p_owner_id text, p_project_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_board jsonb;
  v_schema_version int;
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

  v_schema_version := coalesce((v_board ->> 'schemaVersion')::int, 1);

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
  --
  -- SCHED-21B1: start_date/duration_days now branch on v_schema_version. schemaVersion >= 2 reads
  -- the day-precise startOffsetDays/durationDays fields directly, exact, no rounding. Anything else
  -- (absent, or explicit 1) takes the exact same startIdx*7/duration*7 arithmetic this function has
  -- always used -- byte-identical to before this migration, not just "equivalent."
  insert into schedule_blocks (
    owner_id, id, task_code, schedule_project_id, lane_id, wbs_node_id, label, category, block_type,
    start_date, duration_days, percent_complete, font_size, text_color, bold, sort_order,
    created_at, updated_at
  )
  select
    p_owner_id, p_project_id || '_' || (block ->> 'id'), block ->> 'taskCode', p_project_id,
    p_project_id || '_' || (block ->> 'laneId'), null, block ->> 'label', block ->> 'category',
    case when (block ->> 'milestone')::boolean then 'milestone' else 'task' end,
    case
      when v_schema_version >= 2 then (v_board ->> 'startDate')::date + ((block ->> 'startOffsetDays')::int)
      else (v_board ->> 'startDate')::date + (((block ->> 'startIdx')::int) * 7)
    end,
    case
      when (block ->> 'milestone')::boolean then 0
      when v_schema_version >= 2 then (block ->> 'durationDays')::int
      else ((block ->> 'duration')::int) * 7
    end,
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
  --
  -- SCHED-21B1: duration_days branches the same way as 8a's Gantt blocks -- durationDays direct for
  -- schemaVersion >= 2, durationWeeks*7 otherwise, unchanged from before this migration.
  insert into schedule_blocks (
    owner_id, id, task_code, schedule_project_id, lane_id, wbs_node_id, label, category, block_type,
    start_date, duration_days, percent_complete, bold, sort_order, created_at, updated_at
  )
  select
    p_owner_id, p_project_id || '_' || (activity ->> 'id'), activity ->> 'code', p_project_id, null,
    p_project_id || '_' || (activity ->> 'wbsId'), activity ->> 'name', 'wbs', 'task', null,
    case
      when v_schema_version >= 2 then coalesce((activity ->> 'durationDays')::int, 0)
      else coalesce(((activity ->> 'durationWeeks')::int) * 7, 0)
    end,
    coalesce((activity ->> 'percentComplete')::int, 0), true,
    coalesce((activity ->> 'order')::int, 0), now(), now()
  from jsonb_array_elements(coalesce(v_board -> 'wbs' -> 'activities', '[]'::jsonb)) as activity
  on conflict (owner_id, id) do update set
    task_code = excluded.task_code, wbs_node_id = excluded.wbs_node_id, label = excluded.label,
    duration_days = excluded.duration_days, percent_complete = excluded.percent_complete,
    sort_order = excluded.sort_order, updated_at = now();

  -- 9. Dependencies: upsert by id. lag_days is untouched by SCHED-21B1 -- it has always been
  -- day-precise, never week-encoded, in either board schema version.
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
