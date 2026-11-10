-- Scheduling workspace foundation. Gives /forge/scheduling a real multi-user/workspace concept by
-- reusing the existing generic workspace-authorization helpers verbatim
-- (has_workspace_access/resolve_effective_owner_id, 20260829000100_add_workspace_authorization_helpers.sql)
-- -- the same pattern already applied to Rental (20260829000400) and reused unchanged by Planner
-- admin permissions (PR #767). No new helper functions, no workspace_members schema change.
--
-- Scope: policy-only RLS predicate rewrites across the 16 scheduling tables that today gate on a
-- bare `owner_id = auth.uid()::text`, plus the matching in-body owner-check predicate inside the
-- two SECURITY DEFINER RPCs that bypass RLS and do their own check (sync_schedule_project_from_board,
-- save_schedule_project_board). Every `_public_select` policy (12 of them, exposing the shared
-- "example" demo project via a completely separate is_public=true mechanism) is untouched -- it is
-- orthogonal to ownership/workspace membership and was never owner-gated to begin with.
--
-- schedule_resources/schedule_cost_accounts/schedule_resource_assignments/schedule_expenses convert
-- too, consistent with the rest of the schema -- has_workspace_access() still returns true only for
-- the owner or an active co-owner, never a stranger or a public-select viewer, so the SCHED-05
-- "cost data stays owner-only, hidden from the general public-select audience" intent is preserved
-- while a genuine co-owner finally gets the same cost-data access Rental's billing tables already
-- grant their co-owners.
--
-- File-only in this slice -- applying it to production needs a separate word, same as every other
-- slice in this family. No admin roles, capability catalog, or role-assignment UI here; that is a
-- separate future slice once this foundation exists.

-- 16 owner-only RLS policies converted to the workspace-access pattern, drop-and-recreate by
-- policy name, exactly Rental's conversion shape (20260829000400_convert_rental_billing_policies_to_workspace_access.sql).

drop policy "forge_scheduling_projects_owner_all" on forge_scheduling_projects;
create policy "forge_scheduling_projects_owner_all" on forge_scheduling_projects for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "schedule_calendars_owner_all" on schedule_calendars;
create policy "schedule_calendars_owner_all" on schedule_calendars for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "schedule_calendar_holidays_owner_all" on schedule_calendar_holidays;
create policy "schedule_calendar_holidays_owner_all" on schedule_calendar_holidays for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "schedule_projects_owner_all" on schedule_projects;
create policy "schedule_projects_owner_all" on schedule_projects for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "schedule_wbs_nodes_owner_all" on schedule_wbs_nodes;
create policy "schedule_wbs_nodes_owner_all" on schedule_wbs_nodes for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "schedule_blackout_windows_owner_all" on schedule_blackout_windows;
create policy "schedule_blackout_windows_owner_all" on schedule_blackout_windows for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "schedule_lanes_owner_all" on schedule_lanes;
create policy "schedule_lanes_owner_all" on schedule_lanes for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "schedule_blocks_owner_all" on schedule_blocks;
create policy "schedule_blocks_owner_all" on schedule_blocks for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "schedule_dependencies_owner_all" on schedule_dependencies;
create policy "schedule_dependencies_owner_all" on schedule_dependencies for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "schedule_hammock_anchors_owner_all" on schedule_hammock_anchors;
create policy "schedule_hammock_anchors_owner_all" on schedule_hammock_anchors for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "schedule_baselines_owner_all" on schedule_baselines;
create policy "schedule_baselines_owner_all" on schedule_baselines for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "schedule_baseline_blocks_owner_all" on schedule_baseline_blocks;
create policy "schedule_baseline_blocks_owner_all" on schedule_baseline_blocks for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "schedule_resources_owner_all" on schedule_resources;
create policy "schedule_resources_owner_all" on schedule_resources for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "schedule_cost_accounts_owner_all" on schedule_cost_accounts;
create policy "schedule_cost_accounts_owner_all" on schedule_cost_accounts for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "schedule_resource_assignments_owner_all" on schedule_resource_assignments;
create policy "schedule_resource_assignments_owner_all" on schedule_resource_assignments for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy "schedule_expenses_owner_all" on schedule_expenses;
create policy "schedule_expenses_owner_all" on schedule_expenses for all to authenticated
using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

-- Two SECURITY DEFINER RPCs that bypass RLS and do their own in-body owner check -- the predicate
-- changes from a bare auth.uid() comparison to has_workspace_access(p_owner_id); the rest of each
-- body (including the differing failure shape -- sync_schedule_project_from_board silently returns,
-- save_schedule_project_board raises SCHEDULE_SAVE_NOT_FOUND -- that difference is intentional and
-- preserved, not harmonized) is copied verbatim from its current live definition.

create or replace function sync_schedule_project_from_board(p_owner_id text, p_project_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_board jsonb;
  v_schema_version int;
begin
  if auth.uid() is not null and not has_workspace_access(p_owner_id) then
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

create or replace function save_schedule_project_board(
  p_owner_id text, p_project_id text, p_board jsonb, p_expected_revision bigint
) returns table(board_revision bigint, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_current_revision bigint;
begin
  if auth.uid() is not null and not has_workspace_access(p_owner_id) then
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

  update schedule_projects sp
  set board_revision = coalesce(sp.board_revision, 0) + 1, updated_at = now()
  where sp.owner_id = p_owner_id and sp.id = p_project_id;

  return query
  select sp.board_revision, fsp.updated_at
  from schedule_projects sp
  join forge_scheduling_projects fsp on fsp.owner_id = sp.owner_id and fsp.id = sp.id
  where sp.owner_id = p_owner_id and sp.id = p_project_id;
end;
$$;
