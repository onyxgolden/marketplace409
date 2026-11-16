-- ---------------------------------------------------------------------------
-- Planner busts: freeze labor hours into the plan baseline (bridge slice)
--
-- Scope brief: results/chatgpt/planner-busts-baseline-hours-scope-2026-11-16.md
-- (drop 9ec9e75c). Authorized build: Jason, Nov 15 21:30.
--
-- The scope freeze wrote membership-only scope baselines
-- (forge_work_scope_baselines) while the bust snapshot reads the
-- immutable plan baseline (forge_work_package_baselines: baseline_hours /
-- baseline_cost) — and nothing in the app ever created a plan-baseline
-- row, so no bust could be recorded. This migration bridges the two:
--
--   1. forge_work_freeze_scope: initial Freeze inserts scope v1 AND
--      plan v1 in the same transaction.
--   2. forge_work_decide_scope_change: post-freeze Approve inserts
--      scope vN+1 AND plan vN+1 in the same transaction. Reject inserts
--      neither (and needs no plan inputs).
--   3. One-time idempotent backfill for every current scope head,
--      stamped with the migration identity.
--
-- Plan fields are sourced server-side only (never from the browser):
-- baseline_hours = SUM of active, non-retired step planned_person_hours;
-- baseline_start/finish = package planned dates; baseline_cost = the
-- single active control estimate's current_estimate_cents / 100.
-- Missing/invalid inputs fail the freeze/approve closed with a specific
-- plain-words error code; nothing is written and the package pointer
-- does not advance. The brief's explicit migration-apply gate is
-- retained: this file is file-only until review/merge + Jason's apply
-- word — do NOT apply on GO alone.
--
-- Design notes for the reviewer (two deliberate deviations from a naive
-- reading of the brief):
--
--   (a) Brief §7.6 test 6 says "only the existing intended RPC path can
--       write" plan baselines. The codebase has a SECOND intended write
--       path: the Rung 4 scheduling freezeBaseline
--       (src/application/work-management/workScheduling.js) inserts
--       directly as the authenticated user through the live
--       POST /schedule/baseline route. Tightening the baselines table
--       to SELECT-only (RLS or ACL) would break that shipped flow, so
--       this migration PRESERVES the existing RLS policy and grants
--       per brief §6.3 and the test asserts the protections that
--       actually exist (anon cannot write, foreign workspace cannot
--       write, UPDATE/DELETE refused by the immutable trigger for every
--       role). Making writes RPC-only is a separate slice that must
--       first migrate or remove the scheduling freeze path.
--
--   (b) The backfill must stamp frozen_by with the migration identity,
--       but the BEFORE INSERT stamp trigger
--       (forge_work_package_baselines_stamp_actor_trg) overwrites
--       frozen_by with auth.uid() — and raises when there is no
--       authenticated identity, which a migration session has none of.
--       The backfill therefore DISABLEs only that trigger for the
--       duration of its inserts and re-enables it immediately, inside
--       the same transaction (a failure rolls the disable back with
--       everything else). The immutable trigger stays enabled throughout.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Internal helper: validate + compute the plan-baseline inputs for one
-- package, per brief §2. Returns {ok:true, hours, start, finish,
-- cost_cents} or {ok:false, error:<specific code>}. Read-only; called
-- by both RPCs (before any write, so a failure leaves nothing behind)
-- and by the backfill. No grant: runs only inside a SECURITY DEFINER
-- caller or the migration session.
-- ---------------------------------------------------------------------------
create or replace function forge_work_plan_baseline_inputs(
  p_owner_id text, p_package_id text
) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_start date;
  v_finish date;
  v_active_steps integer;
  v_hours numeric(14,2);
  v_bad_steps integer;
  v_est_count integer;
  v_cost_cents bigint;
begin
  select planned_start, planned_finish into v_start, v_finish
  from forge_work_packages
  where owner_id = p_owner_id and id = p_package_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select count(*), coalesce(sum(planned_person_hours), 0)
    into v_active_steps, v_hours
  from forge_work_steps
  where owner_id = p_owner_id and work_package_id = p_package_id
    and retired_at is null;
  if v_active_steps = 0 then
    return jsonb_build_object('ok', false, 'error', 'plan_no_active_steps');
  end if;

  select count(*) into v_bad_steps
  from forge_work_steps
  where owner_id = p_owner_id and work_package_id = p_package_id
    and retired_at is null
    and (planned_person_hours is null or planned_person_hours < 0);
  if v_bad_steps > 0 then
    return jsonb_build_object('ok', false, 'error', 'plan_step_hours_missing');
  end if;

  if v_start is null or v_finish is null then
    return jsonb_build_object('ok', false, 'error', 'plan_dates_missing');
  end if;
  if v_finish < v_start then
    return jsonb_build_object('ok', false, 'error', 'plan_dates_reversed');
  end if;

  select count(*), min(current_estimate_cents)
    into v_est_count, v_cost_cents
  from forge_work_control_estimates
  where owner_id = p_owner_id and work_package_id = p_package_id
    and retired_at is null;
  if v_est_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'plan_estimate_missing');
  end if;
  if v_est_count > 1 then
    return jsonb_build_object('ok', false, 'error', 'plan_estimate_ambiguous');
  end if;
  if v_cost_cents is null or v_cost_cents < 0 then
    return jsonb_build_object('ok', false, 'error', 'plan_estimate_negative');
  end if;

  return jsonb_build_object(
    'ok', true,
    'hours', round(v_hours, 2),
    'start', v_start,
    'finish', v_finish,
    'cost_cents', v_cost_cents
  );
end $$;

-- ---------------------------------------------------------------------------
-- forge_work_freeze_scope — atomic initial scope freeze + paired plan
-- baseline. Validation runs BEFORE the pointer CAS, so a failed freeze
-- writes nothing and the pointer never advances. The plan insert shares
-- the scope row's version, actor, and freeze timestamp. Any failure in
-- either insert raises and rolls the whole transaction back.
-- ---------------------------------------------------------------------------
create or replace function forge_work_freeze_scope(
  p_owner_id text, p_package_id text,
  p_membership jsonb, p_membership_hash text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_caller text := nullif(auth.uid()::text, '');
  v_baseline_id text := 'forge_wsb_' || gen_random_uuid()::text;
  v_frozen_at timestamptz := now();
  v_inputs jsonb;
  v_row forge_work_scope_baselines%rowtype;
  v_plan forge_work_package_baselines%rowtype;
begin
  if v_caller is null or not has_workspace_access(p_owner_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform set_config('forge_work.lifecycle_rpc', 'on', true);
  -- Plan inputs first: no writes have happened yet, so an invalid plan
  -- fails closed with nothing left behind.
  v_inputs := forge_work_plan_baseline_inputs(p_owner_id, p_package_id);
  if (v_inputs ->> 'ok')::boolean is not true then
    return jsonb_build_object('ok', false, 'error', v_inputs ->> 'error');
  end if;
  update forge_work_packages
  set scope_baseline_id = v_baseline_id, updated_by = v_caller, updated_at = now()
  where owner_id = p_owner_id and id = p_package_id and scope_baseline_id is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'already_frozen');
  end if;
  insert into forge_work_scope_baselines
    (owner_id, id, package_id, version, frozen_by, frozen_at, membership, membership_hash, supersedes_id)
  values
    (p_owner_id, v_baseline_id, p_package_id, 1, v_caller, v_frozen_at, p_membership, p_membership_hash, null)
  returning * into v_row;
  insert into forge_work_package_baselines
    (owner_id, package_id, version_number, baseline_start, baseline_finish,
     baseline_hours, baseline_cost, frozen_by, frozen_at)
  values
    (p_owner_id, p_package_id, 1,
     (v_inputs ->> 'start')::date, (v_inputs ->> 'finish')::date,
     (v_inputs ->> 'hours')::numeric, (v_inputs ->> 'cost_cents')::numeric / 100,
     v_caller, v_frozen_at)
  returning * into v_plan;
  return jsonb_build_object('ok', true, 'baseline', row_to_json(v_row),
    'plan_baseline', row_to_json(v_plan));
end $$;

-- ---------------------------------------------------------------------------
-- forge_work_decide_scope_change — atomic scope-change decision + paired
-- plan baseline on approval. Reject keeps the rejection-only write and
-- needs no plan inputs. On approval the plan is validated BEFORE the
-- pointer CAS, so invalid inputs leave the change proposed and write
-- nothing. The plan baseline captures the plan as it exists at the
-- approval instant.
-- ---------------------------------------------------------------------------
create or replace function forge_work_decide_scope_change(
  p_owner_id text, p_change_id text,
  p_approve boolean, p_new_membership jsonb, p_membership_hash text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_caller text := nullif(auth.uid()::text, '');
  v_change forge_work_scope_changes%rowtype;
  v_head forge_work_scope_baselines%rowtype;
  v_verifier text;
  v_new_id text := 'forge_wsb_' || gen_random_uuid()::text;
  v_new_version integer;
  v_frozen_at timestamptz := now();
  v_inputs jsonb;
  v_new_baseline forge_work_scope_baselines%rowtype;
  v_new_plan forge_work_package_baselines%rowtype;
begin
  if v_caller is null or not has_workspace_access(p_owner_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform set_config('forge_work.lifecycle_rpc', 'on', true);
  select * into v_change from forge_work_scope_changes
  where owner_id = p_owner_id and id = p_change_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  -- Approving or rejecting a scope change moves the cost baseline: it needs
  -- the same owner-or-designated-verifier authority as package transitions.
  -- Workspace members may PROPOSE changes; only the owner or the designated
  -- verifier may decide them.
  select designated_verifier into v_verifier from forge_work_packages
  where owner_id = p_owner_id and id = v_change.package_id;
  if v_verifier is null and v_caller <> p_owner_id then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if v_verifier is not null and v_caller <> p_owner_id and v_caller <> v_verifier then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if v_change.status <> 'proposed' then
    return jsonb_build_object('ok', false, 'error', 'already_decided');
  end if;
  if not p_approve then
    update forge_work_scope_changes
    set status = 'rejected', decided_by = v_caller, decided_at = now()
    where owner_id = p_owner_id and id = p_change_id
    returning * into v_change;
    return jsonb_build_object('ok', true, 'change', row_to_json(v_change));
  end if;
  -- Head of the supersession chain for this package (matches the
  -- deriveCurrentBaseline rule: the row no other row's supersedes_id
  -- points to).
  select b.* into v_head from forge_work_scope_baselines b
  where b.owner_id = p_owner_id and b.package_id = v_change.package_id
    and not exists (
      select 1 from forge_work_scope_baselines s
      where s.owner_id = p_owner_id and s.supersedes_id = b.id)
  order by b.version desc limit 1;
  if v_head is null or v_head.id is null or v_head.version <> v_change.baseline_version then
    return jsonb_build_object('ok', false, 'error', 'baseline_moved');
  end if;
  v_new_version := v_head.version + 1;
  -- Plan inputs before the pointer CAS: an invalid plan fails closed and
  -- the change stays proposed.
  v_inputs := forge_work_plan_baseline_inputs(p_owner_id, v_change.package_id);
  if (v_inputs ->> 'ok')::boolean is not true then
    return jsonb_build_object('ok', false, 'error', v_inputs ->> 'error');
  end if;
  -- Advance the pointer FIRST, conditional on it still aiming at the head
  -- this change was proposed against. The conflict return below happens
  -- before ANY row is written, so a loser leaves nothing behind. (An
  -- earlier draft inserted the baseline first and returned ok:false on
  -- conflict, which committed an orphan baseline row — never do that.)
  update forge_work_packages
  set scope_baseline_id = v_new_id, updated_by = v_caller, updated_at = now()
  where owner_id = p_owner_id and id = v_change.package_id
    and scope_baseline_id = v_head.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  -- The pointer claimed the new id; the insert now cannot orphan. Any
  -- failure from here raises and rolls the pointer advance back with it.
  insert into forge_work_scope_baselines
    (owner_id, id, package_id, version, frozen_by, frozen_at, membership, membership_hash, supersedes_id)
  values
    (p_owner_id, v_new_id, v_change.package_id, v_new_version,
     v_caller, v_frozen_at, p_new_membership, p_membership_hash, v_head.id)
  returning * into v_new_baseline;
  insert into forge_work_package_baselines
    (owner_id, package_id, version_number, baseline_start, baseline_finish,
     baseline_hours, baseline_cost, frozen_by, frozen_at)
  values
    (p_owner_id, v_change.package_id, v_new_version,
     (v_inputs ->> 'start')::date, (v_inputs ->> 'finish')::date,
     (v_inputs ->> 'hours')::numeric, (v_inputs ->> 'cost_cents')::numeric / 100,
     v_caller, v_frozen_at)
  returning * into v_new_plan;
  update forge_work_scope_changes
  set status = 'approved', decided_by = v_caller, decided_at = now(),
      resulting_baseline_version = v_new_version
  where owner_id = p_owner_id and id = p_change_id
  returning * into v_change;
  return jsonb_build_object('ok', true, 'change', row_to_json(v_change),
    'baseline', row_to_json(v_new_baseline),
    'plan_baseline', row_to_json(v_new_plan));
end $$;

-- ---------------------------------------------------------------------------
-- Function grants. Per the PR #766 lesson, REVOKE ... FROM public is a
-- no-op for function EXECUTE under Supabase-like defaults, so every
-- function is revoked from public, anon, authenticated AND service_role
-- explicitly, then EXECUTE is granted narrowly to the existing intended
-- grantees (authenticated + service_role for the two RPCs). The helper
-- keeps no grant: it runs only as the function owner inside a SECURITY
-- DEFINER caller, and a direct call by any app role is denied.
-- ---------------------------------------------------------------------------
revoke all on function forge_work_freeze_scope(text, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function forge_work_freeze_scope(text, text, jsonb, text) to authenticated, service_role;
revoke all on function forge_work_decide_scope_change(text, text, boolean, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function forge_work_decide_scope_change(text, text, boolean, jsonb, text) to authenticated, service_role;
revoke all on function forge_work_plan_baseline_inputs(text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill (brief §5): one paired plan-baseline row per current scope
-- head, using the package's CURRENT plan inputs. Latest head only — no
-- historical reconstruction. Stamped with the migration identity and the
-- backfill time, honestly recording that the values were captured during
-- backfill, not at the historical scope freeze.
--
--   - Preflight fails closed (with the package/version) if any existing
--     plan row sits at a version with no scope baseline, or ahead of
--     the package's current scope head: the mapping cannot be guessed.
--   - A package whose plan inputs are incomplete is SKIPPED (never a
--     zero-hour/zero-cost row) and reported by NOTICE with its reason;
--     it needs its inputs corrected plus an explicit, reviewed rerun.
--   - A package that already has a plan row at the head version is
--     left untouched (idempotent re-run).
--   - The actor-stamp trigger is disabled only for the backfill
--     inserts (see the header note) and re-enabled immediately; the
--     immutable trigger stays enabled throughout. The whole migration
--     is one transaction, so any failure rolls the disable back too.
-- ---------------------------------------------------------------------------
do $$
declare
  v_backfilled integer := 0;
  v_skipped integer := 0;
  v_present integer := 0;
  r record;
  v_head_version integer;
  v_inputs jsonb;
  v_bad record;
begin
  -- Preflight: no orphan or ahead-of-head plan rows.
  for v_bad in
    select p.owner_id, p.package_id, p.version_number
    from forge_work_package_baselines p
    where not exists (
      select 1 from forge_work_scope_baselines s
      where s.owner_id = p.owner_id and s.package_id = p.package_id
        and s.version = p.version_number
    )
    or exists (
      select 1 from forge_work_scope_baselines s
      where s.owner_id = p.owner_id and s.package_id = p.package_id
        and not exists (
          select 1 from forge_work_scope_baselines s2
          where s2.owner_id = p.owner_id and s2.supersedes_id = s.id)
        and s.version < p.version_number
    )
  loop
    raise exception 'forge_work: plan baseline version collision — package % already has plan version % with no matching scope head (backfill cannot map it); resolve before applying', v_bad.package_id, v_bad.version_number
      using errcode = 'check_violation', detail = 'package_id=' || v_bad.package_id || ' version_number=' || v_bad.version_number;
  end loop;

  alter table forge_work_package_baselines
    disable trigger forge_work_package_baselines_stamp_actor_trg;
  begin
    for r in
      select distinct b.owner_id, b.package_id
      from forge_work_scope_baselines b
    loop
      select s.version into v_head_version
      from forge_work_scope_baselines s
      where s.owner_id = r.owner_id and s.package_id = r.package_id
        and not exists (
          select 1 from forge_work_scope_baselines s2
          where s2.owner_id = r.owner_id and s2.supersedes_id = s.id)
      order by s.version desc limit 1;

      if exists (
        select 1 from forge_work_package_baselines p
        where p.owner_id = r.owner_id and p.package_id = r.package_id
          and p.version_number = v_head_version
      ) then
        v_present := v_present + 1;
        raise notice 'forge_work plan backfill: package % already has plan version % — left untouched',
          r.package_id, v_head_version;
        continue;
      end if;

      v_inputs := forge_work_plan_baseline_inputs(r.owner_id, r.package_id);
      if (v_inputs ->> 'ok')::boolean is not true then
        v_skipped := v_skipped + 1;
        raise notice 'forge_work plan backfill: package % skipped at scope head v% — % (correct the plan inputs and rerun an explicit backfill)',
          r.package_id, v_head_version, v_inputs ->> 'error';
        continue;
      end if;

      insert into forge_work_package_baselines
        (owner_id, package_id, version_number, baseline_start, baseline_finish,
         baseline_hours, baseline_cost, frozen_by, frozen_at)
      values
        (r.owner_id, r.package_id, v_head_version,
         (v_inputs ->> 'start')::date, (v_inputs ->> 'finish')::date,
         (v_inputs ->> 'hours')::numeric, (v_inputs ->> 'cost_cents')::numeric / 100,
         'migration:20261116_planner_bust_baseline_hours', now());
      v_backfilled := v_backfilled + 1;
    end loop;
  exception when others then
    alter table forge_work_package_baselines
      enable trigger forge_work_package_baselines_stamp_actor_trg;
    raise;
  end;
  alter table forge_work_package_baselines
    enable trigger forge_work_package_baselines_stamp_actor_trg;

  raise notice 'forge_work plan backfill complete: % backfilled, % skipped (incomplete plan inputs), % already present',
    v_backfilled, v_skipped, v_present;
end $$;
