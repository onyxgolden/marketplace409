-- FORGE Planner: owner-only test sample loader + audit-safe purge.
--
-- Scope brief: results/chatgpt/planner-test-client-scope-2026-11-17.md
-- (drop c92af13b0, Jason approved the build 2026-11-17 ~16:44 CST).
-- Companion to 20261117120000 (test visibility). This migration adds:
--   1. Receipt tables outside the deleted subtree
--      (forge_planner_test_load_receipts, forge_planner_test_purge_receipts):
--      owner-only SELECT, no direct-write policy; only SECURITY DEFINER
--      RPCs write. Purge receipts hash the client id; package/step ids
--      are stored as counts only.
--   2. The test-scoped purge exception to the forge_work_link_confirmations
--      append-only trigger (brief §4 option (a), the explicit reviewed
--      adjustment): a DELETE is allowed only while the purge function
--      holds the transaction-local app.forge_planner_test_purge flag AND
--      the confirmation's link is test-scoped. Every other update/delete
--      still raises. The forge_work_package_links append-only contract is
--      adjusted the same way, in the open: the purge deletes only
--      test-linked audit entries, after a durable external receipt.
--   3. forge_planner_test_load_samples: owner-only, one transaction,
--      six fictional packages / 31 steps born linked to the validated
--      test project (no Unassigned state), source_system
--      'forge_planner_test_seed_v1', stable source_record_ids, idempotent
--      (ON CONFLICT DO NOTHING on the source unique index: a repeat load
--      never overwrites edits; a later load with a new request id
--      restores only the missing rows), one link-audit row per package
--      inserted in that call, request-id replay/conflict semantics.
--   4. forge_planner_test_purge_scope: the single source of truth for
--      what a purge deletes — every in-scope (table, id) pair, derived
--      from the live FK graph (45 descendant tables + hierarchy).
--   5. forge_planner_test_purge_preview / forge_planner_test_purge:
--      owner-only preview -> confirm -> transactional purge. Preflight
--      lists the full transitive dependent rows, counts them, and
--      refuses (as BLOCKERS, never silently destroyed) on: non-sample
--      packages attached to a test project; real-package link rows
--      touching the subtree (permanent blockers — history is immutable);
--      cross-root references (a real package's change order / bust /
--      progress entry pointing at a sample step, drawing, or takeoff
--      line); work links with one test and one real endpoint; and any
--      FK edge from an unhandled table found in pg_constraint at runtime
--      (FORGE_PLANNER_TEST_UNHANDLED_DEPENDENT). The purge recomputes
--      the digest and refuses on mismatch; the confirm name must equal
--      the client name; replaying an identical request returns the
--      stored receipt, a mismatched replay conflicts.
--
-- FILE ONLY in this PR. Do NOT apply to production without a merge +
-- ChatGPT GO + Muse's agreement check AND Jason's separate word: this
-- brief retains an explicit migration-apply gate (apply on HOLD even
-- after code GO).
-- Migration number 20261117130000 confirmed as next free against main
-- 7f6509e1 at build time (newest on main is 20261117110000; 120000 is
-- the companion visibility migration in this PR).

-- ---------------------------------------------------------------------------
-- 1. Receipt tables (outside the deleted subtree).
-- ---------------------------------------------------------------------------

create table if not exists public.forge_planner_test_load_receipts (
  owner_id text not null,
  id text not null default ('forge_tlr_' || replace(gen_random_uuid()::text, '-', '')),
  project_id text not null,
  request_id text not null,
  package_count integer not null,
  step_count integer not null,
  package_ids jsonb not null default '[]'::jsonb,
  result text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, request_id)
);

create table if not exists public.forge_planner_test_purge_receipts (
  owner_id text not null,
  id text not null default ('forge_tpr_' || replace(gen_random_uuid()::text, '-', '')),
  client_id_hash text not null,
  client_name text not null,
  request_id text not null,
  digest text not null,
  deleted_counts jsonb not null default '{}'::jsonb,
  actor_id text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, request_id)
);

alter table public.forge_planner_test_load_receipts enable row level security;
alter table public.forge_planner_test_purge_receipts enable row level security;

drop policy if exists forge_planner_test_load_receipts_owner_select on public.forge_planner_test_load_receipts;
create policy forge_planner_test_load_receipts_owner_select on public.forge_planner_test_load_receipts
  for select to authenticated using (owner_id = auth.uid()::text);
drop policy if exists forge_planner_test_purge_receipts_owner_select on public.forge_planner_test_purge_receipts;
create policy forge_planner_test_purge_receipts_owner_select on public.forge_planner_test_purge_receipts
  for select to authenticated using (owner_id = auth.uid()::text);
-- No insert/update/delete policy on either receipt table: only the
-- SECURITY DEFINER loader/purge RPCs write, so a direct write from any
-- authenticated caller fails closed.
-- Table ACLs (Supabase's pg_default_acl would otherwise grant ALL to
-- anon/authenticated/service_role on a new table): SELECT only, to
-- authenticated; RLS then restricts rows to the owning workspace.
revoke all on public.forge_planner_test_load_receipts from public, anon, service_role;
revoke all on public.forge_planner_test_purge_receipts from public, anon, service_role;
grant select on public.forge_planner_test_load_receipts to authenticated;
grant select on public.forge_planner_test_purge_receipts to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Purge exception to the forge_work_link_confirmations append-only
--    trigger (brief §4 option (a)).
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_link_confirmations_immutable()
returns trigger language plpgsql as $$
declare
  v_purge_request text;
begin
  if TG_OP = 'DELETE' then
    -- The test purge function sets the transaction-local
    -- app.forge_planner_test_purge flag to its request id. A delete is
    -- allowed only while that flag is set AND the confirmation's link
    -- is test-scoped. Everything else still raises, exactly as before.
    v_purge_request := current_setting('app.forge_planner_test_purge', true);
    if v_purge_request is not null and btrim(v_purge_request) <> ''
       and forge_planner_internal.forge_test_work_link_confirmation_is_test(OLD.owner_id, OLD.link_id) then
      return OLD;
    end if;
  end if;
  raise exception 'forge_work_link_confirmations is append-only; updates and deletes are forbidden';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Sample loader.
-- ---------------------------------------------------------------------------

create or replace function public.forge_planner_test_load_samples(
  p_owner_id text, p_project_id text, p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text := auth.uid()::text;
  v_is_test boolean;
  v_loaded_pkgs integer := 0;
  v_loaded_steps integer := 0;
  v_total_pkgs integer := 0;
  v_total_steps integer := 0;
  v_receipt record;
  v_package_ids jsonb;
  v_result text;
  v_message text;
begin
  -- Owner-only: the authenticated immutable identity is the workspace
  -- owner id. A co-owner, a member, or an anonymous caller gets the
  -- same non-disclosing NOT_FOUND as for a missing project.
  if v_actor is null or v_actor <> p_owner_id then
    raise exception 'FORGE_PLANNER_TEST_NOT_FOUND';
  end if;
  -- Serialize concurrent loads for this project: two simultaneous
  -- loads yield exactly six packages, not twelve.
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_project_id));
  -- Replay: the same request id returns the stored result; the same
  -- request id for a different project is a conflict.
  select * into v_receipt from public.forge_planner_test_load_receipts
  where owner_id = p_owner_id and request_id = p_request_id;
  if found then
    if v_receipt.project_id <> p_project_id then
      raise exception 'FORGE_PLANNER_TEST_REQUEST_ID_CONFLICT';
    end if;
    return jsonb_build_object(
      'loaded', false, 'alreadyLoaded', true,
      'packages', v_receipt.package_count, 'steps', v_receipt.step_count,
      'packageIds', v_receipt.package_ids,
      'message', 'Already loaded — ' || v_receipt.package_count || ' sample packages / ' || v_receipt.step_count || ' steps');
  end if;
  -- The target must be a test project under a test client. A real
  -- project gets a 400 (the caller is the owner, so the distinction
  -- between "real" and "missing" is theirs to see); a missing project
  -- gets the non-disclosing NOT_FOUND.
  select c.is_test into v_is_test
  from public.forge_projects p
  join public.forge_sites s on s.owner_id = p.owner_id and s.id = p.site_id
  join public.forge_clients c on c.owner_id = s.owner_id and c.id = s.client_id
  where p.owner_id = p_owner_id and p.id = p_project_id;
  if not found then
    raise exception 'FORGE_PLANNER_TEST_NOT_FOUND';
  end if;
  if not coalesce(v_is_test, false) then
    raise exception 'FORGE_PLANNER_TEST_NOT_A_TEST_PROJECT';
  end if;
  -- Packages: born with forge_project_id set to the validated test
  -- project. There is no intermediate Unassigned state: a raw import
  -- followed by a link would expose the samples to every workspace
  -- member in between. ON CONFLICT DO NOTHING on the stable
  -- source_record_id makes the load idempotent and never overwrites
  -- Jason's edits to an already-loaded sample.
  with inserted as (
    insert into public.forge_work_packages
      (owner_id, id, code, title, description, package_type, priority, mode,
       planning_complexity, forge_project_id, source_system, source_record_id,
       unit, area, system, equipment_tag, planned_manhours, created_by, updated_by)
    select p_owner_id,
      'forge_wp_' || replace(gen_random_uuid()::text, '-', ''),
      public.forge_work_next_package_number(p_owner_id),
      v.title, v.description, v.package_type, v.priority, v.mode,
      'standard', p_project_id, 'forge_planner_test_seed_v1',
      'forge_planner_test_seed_v1:' || p_project_id || ':pkg' || v.ordinal,
      v.unit, v.area, v.system, v.equipment_tag, v.planned_manhours, v_actor, v_actor
    from (values
    (1, 'FCCU exchanger inspection [SAMPLE]', 'Sample package: inspect a fictional FCCU exchanger (E-101) during a planned outage. Test data only.', 'industrial', 'industrial', 'normal', 'FCCU', 'Process', 'Exchanger', 'E-101', 40),
    (2, 'Pump mechanical seal replacement [SAMPLE]', 'Sample package: replace the mechanical seal on fictional pump P-201. Test data only.', 'industrial', 'industrial', 'normal', 'FCCU', 'Process', 'Pumping', 'P-201', 19),
    (3, 'Valve replacement [SAMPLE]', 'Sample package: replace a fictional block valve (V-301) in kind. Test data only.', 'industrial', 'industrial', 'normal', 'FCCU', 'Process', 'Piping', 'V-301', 15),
    (4, 'Pipe spool fabrication and installation [SAMPLE]', 'Sample package: fabricate and install a fictional pipe spool (L-401). Test data only.', 'industrial', 'industrial', 'normal', 'FCCU', 'Process', 'Piping', 'L-401', 34),
    (5, 'Electrical MCC preventive maintenance [SAMPLE]', 'Sample package: preventive maintenance on fictional motor control center MCC-2. Test data only.', 'industrial', 'industrial', 'normal', 'FCCU', 'Electrical', 'Power distribution', 'MCC-2', 16),
    (6, 'Instrument loop checkout [SAMPLE]', 'Sample package: checkout of fictional instrument loop LIC-501. Test data only.', 'industrial', 'industrial', 'normal', 'FCCU', 'Process', 'Instrumentation', 'LIC-501', 15)
    ) as v(ordinal, title, description, package_type, mode, priority, unit, area, system, equipment_tag, planned_manhours)
    on conflict (owner_id, source_system, source_record_id) where source_record_id is not null do nothing
    returning id
  ),
  linked as (
    -- One link-audit row per package inserted in THIS call (old NULL
    -- -> new project, is_test = true). Packages that already existed
    -- keep the link row from the load that created them.
    insert into public.forge_work_package_links
      (owner_id, id, package_id, old_forge_project_id, new_forge_project_id, actor_id, request_id, reason, is_test)
    select p_owner_id,
      'forge_wpl_' || replace(gen_random_uuid()::text, '-', ''),
      i.id, null, p_project_id, v_actor, p_request_id, 'Sample load forge_planner_test_seed_v1', true
    from inserted i
    returning 1
  )
  select count(*)::int into v_loaded_pkgs from inserted;
  -- Steps: restored under their sample package by stable record id.
  -- Missing steps are restored; existing steps (and Jason's edits to
  -- them) are never touched.
  with inserted as (
    insert into public.forge_work_steps
      (owner_id, id, work_package_id, title, description, sequence_no, craft_key,
       craft_label, planned_duration_days, planned_person_hours,
       source_system, source_record_id, created_by, updated_by)
    select p_owner_id,
      'forge_wstp_' || replace(gen_random_uuid()::text, '-', ''),
      w.id, v.title, v.description, v.sequence_no, v.craft_key, v.craft_label,
      v.planned_duration_days, v.planned_person_hours,
      'forge_planner_test_seed_v1',
      'forge_planner_test_seed_v1:' || p_project_id || ':pkg' || v.package_ordinal || ':step' || v.sequence_no,
      v_actor, v_actor
    from (values
    (1, 1, 'Isolate and drain exchanger', 'Isolate E-101 from process, drain and vent.', 'operations', 'Operations', 4, 1),
    (1, 2, 'Remove channel head and bundle', 'Remove the channel head and pull the tube bundle.', 'mechanical', 'Mechanical', 8, 1),
    (1, 3, 'Inspect tubes and tubesheet', 'Visual inspection of tubes, tubesheet, and baffles.', 'inspection', 'Inspection', 6, 1),
    (1, 4, 'Eddy current test sample tubes', 'Eddy current test a sample of tubes and record results.', 'inspection', 'Inspection', 8, 2),
    (1, 5, 'Repair or plug defective tubes', 'Plug or repair tubes found defective during inspection.', 'mechanical', 'Mechanical', 6, 1),
    (1, 6, 'Reassemble and pressure test', 'Reassemble the exchanger and pressure test before return to service.', 'mechanical', 'Mechanical', 8, 1),
    (2, 1, 'Isolate pump and lock out energy', 'Isolate P-201, lock out electrical and process energy.', 'operations', 'Operations', 2, 1),
    (2, 2, 'Remove coupling and seal gland', 'Remove the coupling and seal gland plate.', 'mechanical', 'Mechanical', 4, 1),
    (2, 3, 'Inspect shaft sleeve and seal faces', 'Inspect the shaft sleeve and seal faces for wear or scoring.', 'mechanical', 'Mechanical', 3, 1),
    (2, 4, 'Install new seal and reassemble', 'Install the new seal, reassemble the gland and coupling.', 'mechanical', 'Mechanical', 6, 1),
    (2, 5, 'Align pump and return to service', 'Align the pump, remove locks, and return to service.', 'mechanical', 'Mechanical', 4, 1),
    (3, 1, 'Isolate line and drain section', 'Isolate the line section around V-301 and drain it.', 'operations', 'Operations', 3, 1),
    (3, 2, 'Remove existing valve', 'Unbolt and remove the existing valve.', 'pipefitting', 'Pipefitting', 4, 1),
    (3, 3, 'Install replacement valve and gaskets', 'Install the replacement valve with new gaskets and bolting.', 'pipefitting', 'Pipefitting', 5, 1),
    (3, 4, 'Leak test and restore line', 'Leak test the joints and restore the line to service.', 'pipefitting', 'Pipefitting', 3, 1),
    (4, 1, 'Verify field measurements', 'Verify field measurements against the spool drawing.', 'pipefitting', 'Pipefitting', 4, 1),
    (4, 2, 'Cut and fit spool pieces', 'Cut pipe to length and fit up the spool pieces.', 'pipefitting', 'Pipefitting', 8, 2),
    (4, 3, 'Weld spool joints', 'Weld the spool joints to the approved procedure.', 'welding', 'Welding', 8, 2),
    (4, 4, 'Inspect welds and test spool', 'Inspect welds and pressure test the spool.', 'inspection', 'Inspection', 4, 1),
    (4, 5, 'Install spool and bolt flanges', 'Set the spool in place and bolt up the flanges.', 'pipefitting', 'Pipefitting', 6, 1),
    (4, 6, 'Flush line and leak test', 'Flush the line and leak test before handover.', 'pipefitting', 'Pipefitting', 4, 1),
    (5, 1, 'De-energize MCC bucket and lock out', 'De-energize the MCC bucket and apply locks and tags.', 'electrical', 'Electrical', 2, 1),
    (5, 2, 'Inspect bus bars and connections', 'Inspect bus bars, stabs, and connections for heat or damage.', 'electrical', 'Electrical', 4, 1),
    (5, 3, 'Test breakers and overloads', 'Function test breakers and overload relays.', 'electrical', 'Electrical', 4, 1),
    (5, 4, 'Clean and torque connections', 'Clean the bucket and torque connections to spec.', 'electrical', 'Electrical', 3, 1),
    (5, 5, 'Re-energize and function test', 'Remove locks, re-energize, and function test the bucket.', 'electrical', 'Electrical', 3, 1),
    (6, 1, 'Verify loop drawings and setpoints', 'Verify the loop drawing, setpoints, and alarm values.', 'instrumentation', 'Instrumentation', 2, 1),
    (6, 2, 'Calibrate transmitter', 'Calibrate the loop transmitter and record as-found and as-left values.', 'instrumentation', 'Instrumentation', 4, 1),
    (6, 3, 'Check control valve stroke', 'Stroke the control valve and check travel and seating.', 'instrumentation', 'Instrumentation', 3, 1),
    (6, 4, 'Loop test from field to control room', 'Loop test the signal from the field device to the control room.', 'instrumentation', 'Instrumentation', 4, 1),
    (6, 5, 'Document results and close loop', 'Document the loop test results and close the loop checkout.', 'instrumentation', 'Instrumentation', 2, 1)
    ) as v(package_ordinal, sequence_no, title, description, craft_key, craft_label, planned_person_hours, planned_duration_days)
    join public.forge_work_packages w
      on w.owner_id = p_owner_id
      and w.source_system = 'forge_planner_test_seed_v1'
      and w.source_record_id = 'forge_planner_test_seed_v1:' || p_project_id || ':pkg' || v.package_ordinal
    on conflict (owner_id, source_system, source_record_id) where source_record_id is not null do nothing
    returning id
  )
  select count(*)::int into v_loaded_steps from inserted;
  -- Totals after this call (what is present now, not just what this
  -- call inserted: a restore reports what remains).
  select count(*)::int into v_total_pkgs from public.forge_work_packages
  where owner_id = p_owner_id and source_system = 'forge_planner_test_seed_v1' and forge_project_id = p_project_id;
  select count(*)::int into v_total_steps from public.forge_work_steps s
  join public.forge_work_packages w on w.owner_id = s.owner_id and w.id = s.work_package_id
  where s.owner_id = p_owner_id and s.source_system = 'forge_planner_test_seed_v1' and w.forge_project_id = p_project_id;
  select coalesce(jsonb_agg(id order by id), '[]'::jsonb) into v_package_ids from public.forge_work_packages
  where owner_id = p_owner_id and source_system = 'forge_planner_test_seed_v1' and forge_project_id = p_project_id;
  if v_loaded_pkgs = 0 and v_loaded_steps = 0 then
    v_result := 'already_loaded';
    v_message := 'Already loaded — ' || v_total_pkgs || ' sample packages / ' || v_total_steps || ' steps';
  elsif v_total_pkgs = 6 and v_total_steps = 31 then
    v_result := 'loaded';
    v_message := 'Loaded 6 sample packages / 31 steps';
  else
    v_result := 'restored';
    v_message := 'Restored missing samples — ' || v_total_pkgs || ' sample packages / ' || v_total_steps || ' steps now present';
  end if;
  insert into public.forge_planner_test_load_receipts
    (owner_id, id, project_id, request_id, package_count, step_count, package_ids, result)
  values (p_owner_id, 'forge_tlr_' || replace(gen_random_uuid()::text, '-', ''),
    p_project_id, p_request_id, v_total_pkgs, v_total_steps, v_package_ids, v_result);
  return jsonb_build_object(
    'loaded', v_loaded_pkgs > 0 or v_loaded_steps > 0,
    'alreadyLoaded', v_result = 'already_loaded',
    'packages', v_total_pkgs, 'steps', v_total_steps,
    'packageIds', v_package_ids, 'message', v_message);
end;
$$;

comment on function public.forge_planner_test_load_samples(text, text, text) is
'Owner-only loader for the six fictional sample packages / 31 steps (forge_planner_test_seed_v1). Packages are born linked to the validated test project; the load is idempotent and never overwrites edits.';

revoke all on function public.forge_planner_test_load_samples(text, text, text) from public, anon, service_role;
grant execute on function public.forge_planner_test_load_samples(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Purge scope: the single source of truth for what a purge deletes.
-- ---------------------------------------------------------------------------

create or replace function public.forge_planner_test_purge_scope(
  p_owner_id text, p_client_id text)
returns table (table_name text, id text)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  with subtree_projects as (
    select p.id from public.forge_projects p
    join public.forge_sites s on s.owner_id = p.owner_id and s.id = p.site_id
    where p.owner_id = p_owner_id and s.client_id = p_client_id
  ),
  sample_pkgs as (
    select w.id from public.forge_work_packages w
    where w.owner_id = p_owner_id and w.source_system = 'forge_planner_test_seed_v1'
      and w.forge_project_id in (select id from subtree_projects)
  )
  select 'forge_clients'::text as table_name, p_client_id::text as id
  union all
  select 'forge_sites', s.id from public.forge_sites s
  where s.owner_id = p_owner_id and s.client_id = p_client_id
  union all
  select 'forge_projects', p.id from public.forge_projects p
  join public.forge_sites s on s.owner_id = p.owner_id and s.id = p.site_id
  where p.owner_id = p_owner_id and s.client_id = p_client_id
  union all
  select 'forge_work_packages', w.id from public.forge_work_packages w
  where w.owner_id = p_owner_id and w.source_system = 'forge_planner_test_seed_v1'
    and w.forge_project_id in (select id from subtree_projects)
  union all
  select 'forge_work_steps', t.id from public.forge_work_steps t
  join sample_pkgs sp on sp.id = t.work_package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_change_orders', t.id from public.forge_work_change_orders t
  join sample_pkgs sp on sp.id = t.work_package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_control_estimates', t.id from public.forge_work_control_estimates t
  join sample_pkgs sp on sp.id = t.work_package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_craft_assignments', t.id from public.forge_work_craft_assignments t
  join sample_pkgs sp on sp.id = t.work_package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_craft_rates', t.id from public.forge_work_craft_rates t
  join sample_pkgs sp on sp.id = t.work_package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_progress_entries', t.id from public.forge_work_progress_entries t
  join sample_pkgs sp on sp.id = t.work_package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_permit_annotations', t.id from public.forge_work_permit_annotations t
  join sample_pkgs sp on sp.id = t.work_package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_planning_process_instances', t.id from public.forge_work_planning_process_instances t
  join sample_pkgs sp on sp.id = t.work_package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_planning_process_revisions', t.id from public.forge_work_planning_process_revisions t
  join sample_pkgs sp on sp.id = t.work_package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_step_curve_placements', t.id from public.forge_work_step_curve_placements t
  join sample_pkgs sp on sp.id = t.work_package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_step_drawing_links', t.id from public.forge_work_step_drawing_links t
  join sample_pkgs sp on sp.id = t.work_package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_step_order', t.work_package_id from public.forge_work_step_order t
  join sample_pkgs sp on sp.id = t.work_package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_package_busts', t.id from public.forge_work_package_busts t
  join sample_pkgs sp on sp.id = t.work_package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_drawings', t.id from public.forge_work_drawings t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_gate_attestations', t.id from public.forge_work_gate_attestations t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_gate_evaluations', t.id from public.forge_work_gate_evaluations t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_gate_overrides', t.id from public.forge_work_gate_overrides t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_inspection_observations', t.id from public.forge_work_inspection_observations t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_manpower_days', t.id from public.forge_work_manpower_days t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_package_baselines', t.id from public.forge_work_package_baselines t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_package_budget_revisions', t.id from public.forge_work_package_budget_revisions t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_package_transitions', t.id from public.forge_work_package_transitions t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_progress_snapshots', t.id from public.forge_work_progress_snapshots t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_scope_baselines', t.id from public.forge_work_scope_baselines t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_scope_changes', t.id from public.forge_work_scope_changes t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_weekly_commitments', t.id from public.forge_work_weekly_commitments t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_package_deletions', t.id from public.forge_work_package_deletions t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_wp_drawing_redlines', t.id from public.forge_wp_drawing_redlines t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_wp_drawing_revisions', t.id from public.forge_wp_drawing_revisions t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_wp_drawing_reviews', t.id from public.forge_wp_drawing_reviews t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_wp_drawing_review_events', t.id from public.forge_wp_drawing_review_events t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_wp_drawing_ifc_releases', t.id from public.forge_wp_drawing_ifc_releases t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_wp_drawing_field_redlines', t.id from public.forge_wp_drawing_field_redlines t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_wp_drawing_artifacts', t.id from public.forge_wp_drawing_artifacts t
  join sample_pkgs sp on sp.id = t.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_change_order_revisions', r.id from public.forge_work_change_order_revisions r
  join public.forge_work_change_orders par on par.owner_id = r.owner_id and par.id = r.change_order_id
  join sample_pkgs sp on sp.id = par.work_package_id
  where r.owner_id = p_owner_id
  union all
  select 'forge_work_control_estimate_revisions', r.id from public.forge_work_control_estimate_revisions r
  join public.forge_work_control_estimates par on par.owner_id = r.owner_id and par.id = r.estimate_id
  join sample_pkgs sp on sp.id = par.work_package_id
  where r.owner_id = p_owner_id
  union all
  select 'forge_work_craft_assignment_revisions', r.id from public.forge_work_craft_assignment_revisions r
  join public.forge_work_craft_assignments par on par.owner_id = r.owner_id and par.id = r.assignment_id
  join sample_pkgs sp on sp.id = par.work_package_id
  where r.owner_id = p_owner_id
  union all
  select 'forge_work_craft_rate_revisions', r.id from public.forge_work_craft_rate_revisions r
  join public.forge_work_craft_rates par on par.owner_id = r.owner_id and par.id = r.craft_rate_id
  join sample_pkgs sp on sp.id = par.work_package_id
  where r.owner_id = p_owner_id
  union all
  select 'forge_work_progress_revisions', r.id from public.forge_work_progress_revisions r
  join public.forge_work_progress_entries par on par.owner_id = r.owner_id and par.id = r.entry_id
  join sample_pkgs sp on sp.id = par.work_package_id
  where r.owner_id = p_owner_id
  union all
  select 'forge_work_permit_annotation_revisions', r.id from public.forge_work_permit_annotation_revisions r
  join public.forge_work_permit_annotations par on par.owner_id = r.owner_id and par.id = r.annotation_id
  join sample_pkgs sp on sp.id = par.work_package_id
  where r.owner_id = p_owner_id
  union all
  select 'forge_work_step_curve_placement_revisions', r.id from public.forge_work_step_curve_placement_revisions r
  join public.forge_work_step_curve_placements par on par.owner_id = r.owner_id and par.id = r.placement_id
  join sample_pkgs sp on sp.id = par.work_package_id
  where r.owner_id = p_owner_id
  union all
  select 'forge_work_step_drawing_link_revisions', r.id from public.forge_work_step_drawing_link_revisions r
  join public.forge_work_step_drawing_links par on par.owner_id = r.owner_id and par.id = r.link_id
  join sample_pkgs sp on sp.id = par.work_package_id
  where r.owner_id = p_owner_id
  union all
  select 'forge_work_step_revisions', r.id from public.forge_work_step_revisions r
  join public.forge_work_steps par on par.owner_id = r.owner_id and par.id = r.step_id
  join sample_pkgs sp on sp.id = par.work_package_id
  where r.owner_id = p_owner_id
  union all
  select 'forge_work_package_bust_revisions', r.id from public.forge_work_package_bust_revisions r
  join public.forge_work_package_busts par on par.owner_id = r.owner_id and par.id = r.bust_id
  join sample_pkgs sp on sp.id = par.work_package_id
  where r.owner_id = p_owner_id
  union all
  select 'forge_work_package_bust_change_orders', r.id from public.forge_work_package_bust_change_orders r
  join public.forge_work_package_busts par on par.owner_id = r.owner_id and par.id = r.bust_id
  join sample_pkgs sp on sp.id = par.work_package_id
  where r.owner_id = p_owner_id
  union all
  select 'forge_work_takeoff_lines', t.id from public.forge_work_takeoff_lines t
  join public.forge_work_drawings d on d.owner_id = t.owner_id and d.id = t.drawing_id
  join sample_pkgs sp on sp.id = d.package_id
  where t.owner_id = p_owner_id
  union all
  select 'forge_work_package_links', l.id from public.forge_work_package_links l
  join sample_pkgs sp on sp.id = l.package_id
  where l.owner_id = p_owner_id
  union all
  select 'forge_work_links', l.id from public.forge_work_links l
  where l.owner_id = p_owner_id
    and forge_planner_internal.forge_test_work_link_is_test(l.owner_id, l.source_domain, l.source_type, l.source_id, l.target_domain, l.target_type, l.target_id)
    and not (
      (l.source_domain = 'workmgmt' and l.source_type = 'work_package' and exists (
        select 1 from public.forge_work_packages w where w.owner_id = l.owner_id and w.id = l.source_id
          and (w.source_system is distinct from 'forge_planner_test_seed_v1' or w.forge_project_id not in (select id from subtree_projects))))
      or (l.target_domain = 'workmgmt' and l.target_type = 'work_package' and exists (
        select 1 from public.forge_work_packages w where w.owner_id = l.owner_id and w.id = l.target_id
          and (w.source_system is distinct from 'forge_planner_test_seed_v1' or w.forge_project_id not in (select id from subtree_projects))))
      or l.source_id in (select id from public.forge_projects where owner_id = l.owner_id and id not in (select id from subtree_projects))
      or l.target_id in (select id from public.forge_projects where owner_id = l.owner_id and id not in (select id from subtree_projects))
    )
  union all
  select 'forge_work_link_confirmations', c.id from public.forge_work_link_confirmations c
  where c.owner_id = p_owner_id and c.link_id in (
    select l.id from public.forge_work_links l
    where l.owner_id = p_owner_id
      and forge_planner_internal.forge_test_work_link_is_test(l.owner_id, l.source_domain, l.source_type, l.source_id, l.target_domain, l.target_type, l.target_id)
      and not (
        (l.source_domain = 'workmgmt' and l.source_type = 'work_package' and exists (
          select 1 from public.forge_work_packages w where w.owner_id = l.owner_id and w.id = l.source_id
            and (w.source_system is distinct from 'forge_planner_test_seed_v1' or w.forge_project_id not in (select id from subtree_projects))))
        or (l.target_domain = 'workmgmt' and l.target_type = 'work_package' and exists (
          select 1 from public.forge_work_packages w where w.owner_id = l.owner_id and w.id = l.target_id
            and (w.source_system is distinct from 'forge_planner_test_seed_v1' or w.forge_project_id not in (select id from subtree_projects))))
        or l.source_id in (select id from public.forge_projects where owner_id = l.owner_id and id not in (select id from subtree_projects))
        or l.target_id in (select id from public.forge_projects where owner_id = l.owner_id and id not in (select id from subtree_projects))
      ))
  union all
  select 'forge_hierarchy_audit', a.id from public.forge_hierarchy_audit a
  where a.owner_id = p_owner_id and a.is_test
    and (a.entity_id = p_client_id
      or a.entity_id in (select id from public.forge_sites where owner_id = p_owner_id and client_id = p_client_id)
      or a.entity_id in (select id from subtree_projects))
$$;

comment on function public.forge_planner_test_purge_scope(text, text) is
'Every (table, id) pair a test-client purge deletes: the test client, its sites/projects, the sample packages, and all their test-only children. The preview counts this set; the purge deletes exactly this set.';

revoke all on function public.forge_planner_test_purge_scope(text, text) from public, anon, service_role;
grant execute on function public.forge_planner_test_purge_scope(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Purge preview.
-- ---------------------------------------------------------------------------

create or replace function public.forge_planner_test_purge_preview(
  p_owner_id text, p_client_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text := auth.uid()::text;
  v_client record;
  v_counts jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_digest_input text;
  v_digest text;
  v_can_purge boolean;
  v_fk record;
  v_fk_count integer;
  v_fk_sql text;
begin
  if v_actor is null or v_actor <> p_owner_id then
    raise exception 'FORGE_PLANNER_TEST_NOT_FOUND';
  end if;
  select * into v_client from public.forge_clients
  where owner_id = p_owner_id and id = p_client_id;
  if not found then
    raise exception 'FORGE_PLANNER_TEST_NOT_FOUND';
  end if;
  if not v_client.is_test then
    raise exception 'FORGE_PLANNER_TEST_NOT_A_TEST_PROJECT';
  end if;

  -- Counts of everything the purge would delete, by table.
  select coalesce(jsonb_object_agg(table_name, cnt), '{}'::jsonb) into v_counts
  from (select table_name, count(*)::int as cnt
        from public.forge_planner_test_purge_scope(p_owner_id, p_client_id)
        group by table_name) s;

  -- Blocker 1: non-sample packages attached to a test project. These
  -- are never silently destroyed; the owner must move or delete them
  -- first (moving a real package out is a normal set_project call).
  with bad as (
    select w.id, w.title from public.forge_work_packages w
    where w.owner_id = p_owner_id
      and w.forge_project_id in (
        select p.id from public.forge_projects p
        join public.forge_sites s on s.owner_id = p.owner_id and s.id = p.site_id
        where p.owner_id = p_owner_id and s.client_id = p_client_id)
      and (w.source_system is distinct from 'forge_planner_test_seed_v1'
        or coalesce(w.source_record_id, '') not like 'forge_planner_test_seed_v1:' || w.forge_project_id || ':pkg%')
  )
  select case when count(*) = 0 then v_blockers
    else v_blockers || jsonb_build_object(
      'type', 'non_sample_package',
      'table', 'forge_work_packages',
      'count', count(*)::int,
      'ids', coalesce(jsonb_agg(id order by id), '[]'::jsonb),
      'message', count(*)::int || ' non-sample package(s) attached to this test client — move or delete them first')
    end into v_blockers
  from bad;

  -- Blocker 2: real-package link rows touching the subtree. History is
  -- immutable: even after unlinking, the old link rows remain, so these
  -- block the purge permanently. (The owner removes them by deleting
  -- the real package's link history first — out of scope for this slice.)
  with bad as (
    select l.id from public.forge_work_package_links l
    where l.owner_id = p_owner_id
      and (l.old_forge_project_id in (
            select p.id from public.forge_projects p
            join public.forge_sites s on s.owner_id = p.owner_id and s.id = p.site_id
            where p.owner_id = p_owner_id and s.client_id = p_client_id)
        or l.new_forge_project_id in (
            select p.id from public.forge_projects p
            join public.forge_sites s on s.owner_id = p.owner_id and s.id = p.site_id
            where p.owner_id = p_owner_id and s.client_id = p_client_id))
      and l.package_id not in (
        select w.id from public.forge_work_packages w
        where w.owner_id = p_owner_id and w.source_system = 'forge_planner_test_seed_v1'
          and w.forge_project_id in (
            select p.id from public.forge_projects p
            join public.forge_sites s on s.owner_id = p.owner_id and s.id = p.site_id
            where p.owner_id = p_owner_id and s.client_id = p_client_id))
  )
  select case when count(*) = 0 then v_blockers
    else v_blockers || jsonb_build_object(
      'type', 'real_package_link_history',
      'table', 'forge_work_package_links',
      'count', count(*)::int,
      'ids', coalesce(jsonb_agg(id order by id), '[]'::jsonb),
      'message', count(*)::int || ' link-history row(s) for real packages touch this test client — they can never be purged')
    end into v_blockers
  from bad;

  -- Blocker 3: cross-root references — a REAL package's row pointing at
  -- a sample step, drawing, or takeoff line. Deleting the sample would
  -- break the real row's FK, so the purge refuses.
  with sample_steps as (
    select s.id from public.forge_work_steps s
    join public.forge_work_packages w on w.owner_id = s.owner_id and w.id = s.work_package_id
    where s.owner_id = p_owner_id and w.source_system = 'forge_planner_test_seed_v1'
      and w.forge_project_id in (
        select p.id from public.forge_projects p
        join public.forge_sites s2 on s2.owner_id = p.owner_id and s2.id = p.site_id
        where p.owner_id = p_owner_id and s2.client_id = p_client_id)
  ),
  sample_drawings as (
    select d.id from public.forge_work_drawings d
    join public.forge_work_packages w on w.owner_id = d.owner_id and w.id = d.package_id
    where d.owner_id = p_owner_id and w.source_system = 'forge_planner_test_seed_v1'
      and w.forge_project_id in (
        select p.id from public.forge_projects p
        join public.forge_sites s2 on s2.owner_id = p.owner_id and s2.id = p.site_id
        where p.owner_id = p_owner_id and s2.client_id = p_client_id)
  ),
  sample_lines as (
    select t.id from public.forge_work_takeoff_lines t
    join public.forge_work_drawings d on d.owner_id = t.owner_id and d.id = t.drawing_id
    join public.forge_work_packages w on w.owner_id = d.owner_id and w.id = d.package_id
    where t.owner_id = p_owner_id and w.source_system = 'forge_planner_test_seed_v1'
      and w.forge_project_id in (
        select p.id from public.forge_projects p
        join public.forge_sites s2 on s2.owner_id = p.owner_id and s2.id = p.site_id
        where p.owner_id = p_owner_id and s2.client_id = p_client_id)
  ),
  bad as (
    select o.id, 'forge_work_change_orders' as tbl from public.forge_work_change_orders o
    where o.owner_id = p_owner_id
      and o.work_package_id not in (select id from public.forge_work_packages w
        where w.owner_id = p_owner_id and w.source_system = 'forge_planner_test_seed_v1'
          and w.forge_project_id in (
            select p.id from public.forge_projects p
            join public.forge_sites s2 on s2.owner_id = p.owner_id and s2.id = p.site_id
            where p.owner_id = p_owner_id and s2.client_id = p_client_id))
      and (o.linked_step_id in (select id from sample_steps)
        or o.linked_drawing_id in (select id from sample_drawings)
        or o.linked_takeoff_line_id in (select id from sample_lines))
    union all
    select b.id, 'forge_work_package_busts' from public.forge_work_package_busts b
    where b.owner_id = p_owner_id
      and b.work_package_id not in (select id from public.forge_work_packages w
        where w.owner_id = p_owner_id and w.source_system = 'forge_planner_test_seed_v1'
          and w.forge_project_id in (
            select p.id from public.forge_projects p
            join public.forge_sites s2 on s2.owner_id = p.owner_id and s2.id = p.site_id
            where p.owner_id = p_owner_id and s2.client_id = p_client_id))
      and (b.work_step_id in (select id from sample_steps)
        or b.takeoff_line_id in (select id from sample_lines))
    union all
    select e.id, 'forge_work_progress_entries' from public.forge_work_progress_entries e
    where e.owner_id = p_owner_id
      and e.work_package_id not in (select id from public.forge_work_packages w
        where w.owner_id = p_owner_id and w.source_system = 'forge_planner_test_seed_v1'
          and w.forge_project_id in (
            select p.id from public.forge_projects p
            join public.forge_sites s2 on s2.owner_id = p.owner_id and s2.id = p.site_id
            where p.owner_id = p_owner_id and s2.client_id = p_client_id))
      and e.takeoff_line_id in (select id from sample_lines)
  )
  select case when count(*) = 0 then v_blockers
    else v_blockers || jsonb_build_object(
      'type', 'cross_root_reference',
      'count', count(*)::int,
      'ids', coalesce(jsonb_agg(jsonb_build_object('table', tbl, 'id', id) order by tbl, id), '[]'::jsonb),
      'message', count(*)::int || ' real-package row(s) point at sample steps/drawings/takeoff lines — unlink them first')
    end into v_blockers
  from bad;

  -- Blocker 4: work links with one test endpoint and one real endpoint.
  with bad as (
    select l.id from public.forge_work_links l
    where l.owner_id = p_owner_id
      and forge_planner_internal.forge_test_work_link_is_test(l.owner_id, l.source_domain, l.source_type, l.source_id, l.target_domain, l.target_type, l.target_id)
      and (
        (l.source_domain = 'workmgmt' and l.source_type = 'work_package' and exists (
          select 1 from public.forge_work_packages w where w.owner_id = l.owner_id and w.id = l.source_id
            and (w.source_system is distinct from 'forge_planner_test_seed_v1' or w.forge_project_id not in (
              select p.id from public.forge_projects p
              join public.forge_sites s2 on s2.owner_id = p.owner_id and s2.id = p.site_id
              where p.owner_id = p_owner_id and s2.client_id = p_client_id))))
        or (l.target_domain = 'workmgmt' and l.target_type = 'work_package' and exists (
          select 1 from public.forge_work_packages w where w.owner_id = l.owner_id and w.id = l.target_id
            and (w.source_system is distinct from 'forge_planner_test_seed_v1' or w.forge_project_id not in (
              select p.id from public.forge_projects p
              join public.forge_sites s2 on s2.owner_id = p.owner_id and s2.id = p.site_id
              where p.owner_id = p_owner_id and s2.client_id = p_client_id))))
        or l.source_id in (select id from public.forge_projects where owner_id = l.owner_id and id not in (
              select p.id from public.forge_projects p
              join public.forge_sites s2 on s2.owner_id = p.owner_id and s2.id = p.site_id
              where p.owner_id = p_owner_id and s2.client_id = p_client_id))
        or l.target_id in (select id from public.forge_projects where owner_id = l.owner_id and id not in (
              select p.id from public.forge_projects p
              join public.forge_sites s2 on s2.owner_id = p.owner_id and s2.id = p.site_id
              where p.owner_id = p_owner_id and s2.client_id = p_client_id))
      )
  )
  select case when count(*) = 0 then v_blockers
    else v_blockers || jsonb_build_object(
      'type', 'mixed_work_link',
      'table', 'forge_work_links',
      'count', count(*)::int,
      'ids', coalesce(jsonb_agg(id order by id), '[]'::jsonb),
      'message', count(*)::int || ' work link(s) join test data to real packages/projects — remove them first')
    end into v_blockers
  from bad;

  -- Safety net: any FK edge from a table OUTSIDE the handled scope set
  -- into a scope row. The handled set is the full transitive FK closure
  -- (verified against live pg_constraint at build time), so this should
  -- find nothing — but if a later migration adds a dependent, the purge
  -- refuses instead of failing mid-delete or silently orphaning rows.
  for v_fk in
    select c.conname,
           conrelid::regclass::text as ref_table,
           confrelid::regclass::text as target_table,
           (select string_agg(a.attname, ',' order by k.ord)
              from unnest(c.conkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as ref_cols,
           (select string_agg(a.attname, ',' order by k.ord)
              from unnest(c.confkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as target_cols
    from pg_constraint c
    where c.contype = 'f'
      and c.connamespace = 'public'::regnamespace
      and confrelid::regclass::text in (
        select table_name from public.forge_planner_test_purge_scope(p_owner_id, p_client_id)
      )
      and conrelid::regclass::text not in (
        select table_name from public.forge_planner_test_purge_scope(p_owner_id, p_client_id)
      )
  loop
    -- The FK key is (owner_id, <id column>) in every work table; check
    -- the non-owner_id columns against the scope ids for the target.
    v_fk_sql := format(
      'select count(*)::int from public.%I r where r.owner_id = %L and (%s) in (select id from public.forge_planner_test_purge_scope(%L, %L) where table_name = %L)',
      v_fk.ref_table, p_owner_id,
      (select string_agg(quote_ident(col), ', ')
         from unnest(string_to_array(v_fk.ref_cols, ',')) as col
         where col <> 'owner_id'),
      p_owner_id, p_client_id, v_fk.target_table);
    execute v_fk_sql into v_fk_count;
    if v_fk_count > 0 then
      v_blockers := v_blockers || jsonb_build_object(
        'type', 'unhandled_dependent',
        'table', v_fk.ref_table,
        'constraint', v_fk.conname,
        'count', v_fk_count,
        'message', v_fk_count || ' row(s) in ' || v_fk.ref_table || ' reference purged rows via ' || v_fk.conname || ' — unhandled dependent');
    end if;
  end loop;

  v_can_purge := jsonb_array_length(v_blockers) = 0;

  -- Digest: sha256 over the client id + the ordered scope rows + the
  -- ordered blocker list. The purge recomputes it and refuses on any
  -- mismatch, so a preview taken before a concurrent change cannot be
  -- used to delete a different set of rows.
  select coalesce(string_agg(table_name || ':' || id, ',' order by table_name, id), '') into v_digest_input
  from public.forge_planner_test_purge_scope(p_owner_id, p_client_id);
  v_digest := encode(sha256(convert_to(
    p_client_id || '|' || v_digest_input || '|' || v_blockers::text, 'UTF8')), 'hex');

  return jsonb_build_object(
    'clientId', p_client_id,
    'clientName', v_client.name,
    'counts', v_counts,
    'blockers', v_blockers,
    'canPurge', v_can_purge,
    'digest', v_digest);
end;
$$;

comment on function public.forge_planner_test_purge_preview(text, text) is
'Owner-only preflight for a test-client purge: counts the full transitive dependent rows, lists blockers, and returns the digest the purge must be confirmed against.';

revoke all on function public.forge_planner_test_purge_preview(text, text) from public, anon, service_role;
grant execute on function public.forge_planner_test_purge_preview(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Purge.
-- ---------------------------------------------------------------------------

create or replace function public.forge_planner_test_purge(
  p_owner_id text, p_client_id text, p_expected_digest text, p_request_id text, p_confirm_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text := auth.uid()::text;
  v_client record;
  v_preview jsonb;
  v_digest text;
  v_counts jsonb;
  v_receipt record;
  v_receipt_id text;
begin
  if v_actor is null or v_actor <> p_owner_id then
    raise exception 'FORGE_PLANNER_TEST_NOT_FOUND';
  end if;
  -- Serialize concurrent purges for this client.
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_client_id));
  -- Replay: an identical request returns the stored receipt, harmless.
  -- The same request id for a different client is a conflict.
  select * into v_receipt from public.forge_planner_test_purge_receipts
  where owner_id = p_owner_id and request_id = p_request_id;
  if found then
    if v_receipt.client_id_hash <> encode(sha256(convert_to(p_owner_id || ':' || p_client_id, 'UTF8')), 'hex') then
      raise exception 'FORGE_PLANNER_TEST_REQUEST_ID_CONFLICT';
    end if;
    return jsonb_build_object(
      'purged', false, 'alreadyPurged', true,
      'receiptId', v_receipt.id, 'deletedCounts', v_receipt.deleted_counts,
      'message', 'Already purged — receipt ' || v_receipt.id);
  end if;
  -- Load and confirm: the client must be a test client, and the typed
  -- confirm name must equal the client name exactly.
  select * into v_client from public.forge_clients
  where owner_id = p_owner_id and id = p_client_id;
  if not found or not v_client.is_test then
    raise exception 'FORGE_PLANNER_TEST_NOT_FOUND';
  end if;
  if v_client.name <> p_confirm_name then
    raise exception 'FORGE_PLANNER_TEST_CONFIRM_NAME_MISMATCH';
  end if;
  -- Recompute the preview now (inside the lock) and compare digests:
  -- the purge only ever deletes exactly what the preview showed.
  v_preview := public.forge_planner_test_purge_preview(p_owner_id, p_client_id);
  v_digest := v_preview ->> 'digest';
  if v_digest <> p_expected_digest then
    raise exception 'FORGE_PLANNER_TEST_DIGEST_MISMATCH';
  end if;
  if not (v_preview ->> 'canPurge')::boolean then
    raise exception 'FORGE_PLANNER_TEST_PURGE_BLOCKED';
  end if;
  v_counts := v_preview -> 'counts';
  -- Arm the confirmations trigger exception for this transaction only.
  perform set_config('app.forge_planner_test_purge', p_request_id, true);
  -- Delete the scope in child-before-parent FK order. Every statement
  -- deletes exactly the rows the scope function names for its table,
  -- so a row outside the scope can never be touched by the purge.
  delete from public.forge_work_package_bust_change_orders t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_package_bust_change_orders' and s.id = t.id);
  delete from public.forge_work_package_bust_revisions t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_package_bust_revisions' and s.id = t.id);
  delete from public.forge_work_change_order_revisions t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_change_order_revisions' and s.id = t.id);
  delete from public.forge_work_control_estimate_revisions t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_control_estimate_revisions' and s.id = t.id);
  delete from public.forge_work_craft_assignment_revisions t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_craft_assignment_revisions' and s.id = t.id);
  delete from public.forge_work_craft_rate_revisions t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_craft_rate_revisions' and s.id = t.id);
  delete from public.forge_work_progress_revisions t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_progress_revisions' and s.id = t.id);
  delete from public.forge_work_permit_annotation_revisions t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_permit_annotation_revisions' and s.id = t.id);
  delete from public.forge_work_step_curve_placement_revisions t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_step_curve_placement_revisions' and s.id = t.id);
  delete from public.forge_work_step_drawing_link_revisions t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_step_drawing_link_revisions' and s.id = t.id);
  delete from public.forge_work_step_revisions t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_step_revisions' and s.id = t.id);
  delete from public.forge_wp_drawing_redlines t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_wp_drawing_redlines' and s.id = t.id);
  delete from public.forge_wp_drawing_field_redlines t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_wp_drawing_field_redlines' and s.id = t.id);
  delete from public.forge_wp_drawing_ifc_releases t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_wp_drawing_ifc_releases' and s.id = t.id);
  delete from public.forge_wp_drawing_review_events t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_wp_drawing_review_events' and s.id = t.id);
  delete from public.forge_wp_drawing_artifacts t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_wp_drawing_artifacts' and s.id = t.id);
  delete from public.forge_wp_drawing_reviews t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_wp_drawing_reviews' and s.id = t.id);
  delete from public.forge_work_package_busts t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_package_busts' and s.id = t.id);
  delete from public.forge_work_change_orders t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_change_orders' and s.id = t.id);
  delete from public.forge_work_progress_entries t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_progress_entries' and s.id = t.id);
  delete from public.forge_work_step_curve_placements t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_step_curve_placements' and s.id = t.id);
  delete from public.forge_work_step_drawing_links t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_step_drawing_links' and s.id = t.id);
  delete from public.forge_work_permit_annotations t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_permit_annotations' and s.id = t.id);
  delete from public.forge_work_takeoff_lines t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_takeoff_lines' and s.id = t.id);
  delete from public.forge_work_steps t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_steps' and s.id = t.id);
  delete from public.forge_wp_drawing_revisions t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_wp_drawing_revisions' and s.id = t.id);
  delete from public.forge_work_drawings t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_drawings' and s.id = t.id);
  delete from public.forge_work_planning_process_revisions t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_planning_process_revisions' and s.id = t.id);
  delete from public.forge_work_planning_process_instances t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_planning_process_instances' and s.id = t.id);
  delete from public.forge_work_control_estimates t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_control_estimates' and s.id = t.id);
  delete from public.forge_work_craft_assignments t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_craft_assignments' and s.id = t.id);
  delete from public.forge_work_craft_rates t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_craft_rates' and s.id = t.id);
  delete from public.forge_work_step_order t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_step_order' and s.id = t.work_package_id);
  delete from public.forge_work_gate_attestations t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_gate_attestations' and s.id = t.id);
  delete from public.forge_work_gate_evaluations t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_gate_evaluations' and s.id = t.id);
  delete from public.forge_work_gate_overrides t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_gate_overrides' and s.id = t.id);
  delete from public.forge_work_inspection_observations t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_inspection_observations' and s.id = t.id);
  delete from public.forge_work_manpower_days t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_manpower_days' and s.id = t.id);
  delete from public.forge_work_package_baselines t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_package_baselines' and s.id = t.id);
  delete from public.forge_work_package_budget_revisions t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_package_budget_revisions' and s.id = t.id);
  delete from public.forge_work_package_transitions t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_package_transitions' and s.id = t.id);
  delete from public.forge_work_progress_snapshots t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_progress_snapshots' and s.id = t.id);
  delete from public.forge_work_scope_changes t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_scope_changes' and s.id = t.id);
  delete from public.forge_work_scope_baselines t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_scope_baselines' and s.id = t.id);
  delete from public.forge_work_weekly_commitments t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_weekly_commitments' and s.id = t.id);
  delete from public.forge_work_package_deletions t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_package_deletions' and s.id = t.id);
  delete from public.forge_work_link_confirmations t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_link_confirmations' and s.id = t.id);
  delete from public.forge_work_links t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_links' and s.id = t.id);
  delete from public.forge_work_package_links t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_package_links' and s.id = t.id);
  delete from public.forge_hierarchy_audit t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_hierarchy_audit' and s.id = t.id);
  delete from public.forge_work_packages t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_work_packages' and s.id = t.id);
  delete from public.forge_projects t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_projects' and s.id = t.id);
  delete from public.forge_sites t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_sites' and s.id = t.id);
  delete from public.forge_clients t
  where t.owner_id = p_owner_id
    and exists (select 1 from public.forge_planner_test_purge_scope(p_owner_id, p_client_id) s
      where s.table_name = 'forge_clients' and s.id = t.id);
  -- Durable external receipt (outside the deleted subtree): the client
  -- id is hashed, package/step ids are counts only.
  v_receipt_id := 'forge_tpr_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.forge_planner_test_purge_receipts
    (owner_id, id, client_id_hash, client_name, request_id, digest, deleted_counts, actor_id)
  values (p_owner_id, v_receipt_id,
    encode(sha256(convert_to(p_owner_id || ':' || p_client_id, 'UTF8')), 'hex'),
    v_client.name, p_request_id, v_digest, v_counts, v_actor);
  return jsonb_build_object(
    'purged', true, 'alreadyPurged', false,
    'receiptId', v_receipt_id, 'deletedCounts', v_counts,
    'message', 'Test data deleted — ' || v_client.name || ' and its samples are gone');
end;
$$;

comment on function public.forge_planner_test_purge(text, text, text, text, text) is
'Owner-only transactional purge of a test client and its sample packages. Requires the preview digest and the exact client name; deletes only the purge-scope rows in FK order; stores a durable receipt outside the deleted subtree.';

revoke all on function public.forge_planner_test_purge(text, text, text, text, text) from public, anon, service_role;
grant execute on function public.forge_planner_test_purge(text, text, text, text, text) to authenticated;
