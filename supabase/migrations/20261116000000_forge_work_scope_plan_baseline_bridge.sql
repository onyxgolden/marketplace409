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
-- Design notes for the reviewer (fix round 1 — ChatGPT NEEDS CHANGES,
-- PR #816 review 2026-11-16):
--
--   The bridge asserts a scope/plan lockstep invariant: every plan row
--   pairs with a scope baseline at the same version. The shipped Rung 4
--   scheduling freezeBaseline (src/application/work-management/
--   workScheduling.js) writes plan rows directly with max+1 versioning
--   and no scope row, so the invariant cannot hold while both writers
--   share one version series.
--
--   Option 1 (the verdict's first option — route scheduling creation
--   through a paired scope/plan transaction) was evaluated and is NOT
--   feasible without breaking shipped behavior: a scheduling freeze
--   would have to mint a new scope baseline version (copying the
--   current membership) and advance the scope pointer, which voids
--   in-flight scope-change proposals (forge_work_decide_scope_change
--   returns baseline_moved), corrupts scope-version semantics and
--   audit provenance (a scheduling action recorded as a scope freeze),
--   and — with no scope baseline — would implicitly freeze scope the
--   scheduler never asked to freeze. The "fill the gap" variant
--   (insert at the current scope version when no plan row exists
--   there) degenerates after the bridge: every scope version already
--   has a plan row, so the scheduling freeze would always be refused
--   and the shipped feature would die.
--
--   Option 2 (the verdict's second option — a distinct versioning
--   model) is implemented instead: forge_work_package_baselines gains
--   baseline_kind ('scope' | 'schedule'), and the unique constraint
--   becomes (owner_id, package_id, baseline_kind, version_number).
--   Scope-paired rows (kind 'scope') version with the scope chain;
--   schedule-only rows (kind 'schedule') version in their own series
--   and can never collide with scope rows. Pre-existing rows are all
--   schedule-created, so the column defaults to 'schedule' — old
--   progress snapshots keep resolving. Readers are kind-scoped: the
--   bust snapshot selects the 'scope' row as its baseline and
--   resolves progress snapshots against 'schedule' rows; the manpower
--   curve resolves 'schedule' rows; bust creation requires a 'scope'
--   baseline; the scheduling app reads/writes 'schedule' rows only.
--   The preflight refuses only 'scope' rows without a matching scope
--   version; schedule-only rows are legitimate and pass. The
--   scheduling direct-insert path is PRESERVED (the RLS policy and
--   grants are unchanged per brief §6.3); making writes RPC-only
--   remains a separate slice.
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
--       The disable/enable is existence-guarded: the stamp trigger
--       lives in the busts migration, so a fixture without it must not
--       fail the backfill.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- baseline_kind: distinct versioning for the two plan-baseline writers
-- (fix round 1). Scope-paired rows (kind 'scope') version with the
-- scope chain; schedule-only rows (kind 'schedule') version in their
-- own series. The unique constraint becomes per-kind, so a schedule
-- freeze can never collide with a scope-paired row at the same
-- version. Pre-existing rows are all schedule-created, so the column
-- defaults to 'schedule'. Idempotent on re-apply: the column add and
-- the constraint swap are both guarded.
--
-- The slice-6 placements FK references the OLD 3-column unique
-- (owner_id, package_id, version_number), so the swap cannot drop
-- it while the FK stands — the migration would fail in production
-- with "cannot drop constraint ... because other objects depend on
-- it". Placements are schedule artifacts, so the placements table
-- gains its own baseline_kind (default 'schedule') and the FK moves
-- to the per-kind unique (owner_id, package_id, baseline_kind,
-- version_number). Every existing placement row matches: all
-- pre-bridge baselines are schedule-kind. The FK lookup is by
-- target table, not by name (slice 6 left it unnamed), and the
-- whole block is skipped when the placements table does not exist
-- (e.g. a fixture that never applied slice 6).
--
-- Fix round 2: the placement invariant is now enforced by the
-- schema itself — a placement row can only carry baseline_kind =
-- 'schedule'. No legitimate scope placement exists (the only
-- placement writers are the slice-6 / bridge placement_set RPCs,
-- which stamp 'schedule'), so the fix-round-1 permissive check
-- (scope | schedule) is replaced by a schedule-only check, and
-- the migration fails closed if any placement row already carries
-- a non-schedule kind. The composite FK is retained.
-- ---------------------------------------------------------------------------
alter table forge_work_package_baselines
  add column if not exists baseline_kind text not null default 'schedule'
    constraint forge_work_package_baselines_kind_check
      check (baseline_kind in ('scope', 'schedule'));
do $$
declare
  v_has_placements boolean;
  v_fk text;
begin
  v_has_placements := to_regclass('public.forge_work_step_curve_placements') is not null;
  if v_has_placements then
    execute $q$
      alter table public.forge_work_step_curve_placements
        add column if not exists baseline_kind text not null default 'schedule'
          constraint forge_work_step_curve_placements_kind_schedule_check
            check (baseline_kind = 'schedule')
    $q$;
    select conname into v_fk from pg_constraint
    where conrelid = 'public.forge_work_step_curve_placements'::regclass
      and contype = 'f'
      and confrelid = 'public.forge_work_package_baselines'::regclass;
    if v_fk is not null then
      execute 'alter table public.forge_work_step_curve_placements drop constraint ' || quote_ident(v_fk);
    end if;
  end if;
  if exists (
    select 1 from pg_constraint
    where conname = 'forge_work_package_baselines_version_unique'
      and conrelid = 'public.forge_work_package_baselines'::regclass
  ) then
    alter table forge_work_package_baselines
      drop constraint forge_work_package_baselines_version_unique;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'forge_work_package_baselines_kind_version_unique'
      and conrelid = 'public.forge_work_package_baselines'::regclass
  ) then
    alter table forge_work_package_baselines
      add constraint forge_work_package_baselines_kind_version_unique
        unique (owner_id, package_id, baseline_kind, version_number);
  end if;
  if v_has_placements then
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.forge_work_step_curve_placements'::regclass
        and contype = 'f'
        and confrelid = 'public.forge_work_package_baselines'::regclass
    ) then
      execute $q$
        alter table public.forge_work_step_curve_placements
          add constraint forge_work_step_curve_placements_baseline_fk
            foreign key (owner_id, work_package_id, baseline_kind, baseline_version)
            references public.forge_work_package_baselines
              (owner_id, package_id, baseline_kind, version_number)
            on delete restrict
      $q$;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fix round 2: enforce the schedule-only placement invariant.
-- The column add above stamps the schedule-only check on a fresh
-- apply, but it is a no-op wherever the column already exists
-- (re-apply, or a fixture that stubs the column — with or without
-- the fix-round-1 permissive check). This block closes both gaps:
-- it drops the permissive check wherever it exists, adds the
-- schedule-only check wherever it is absent, and fails closed if
-- any placement row already carries a non-schedule kind — the
-- migration aborts rather than silently redefining that row's
-- meaning. Idempotent on re-apply.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.forge_work_step_curve_placements') is not null then
    if exists (
      select 1 from public.forge_work_step_curve_placements
      where baseline_kind <> 'schedule'
    ) then
      raise exception 'forge_work: scope-kind placement rows exist; refusing to enforce the schedule-only placement invariant';
    end if;
    if exists (
      select 1 from pg_constraint
      where conname = 'forge_work_step_curve_placements_kind_check'
        and conrelid = 'public.forge_work_step_curve_placements'::regclass
    ) then
      execute 'alter table public.forge_work_step_curve_placements drop constraint forge_work_step_curve_placements_kind_check';
    end if;
    if not exists (
      select 1 from pg_constraint
      where conname = 'forge_work_step_curve_placements_kind_schedule_check'
        and conrelid = 'public.forge_work_step_curve_placements'::regclass
    ) then
      execute $q$
        alter table public.forge_work_step_curve_placements
          add constraint forge_work_step_curve_placements_kind_schedule_check
            check (baseline_kind = 'schedule')
      $q$;
    end if;
  end if;
end $$;

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
    (owner_id, package_id, version_number, baseline_kind, baseline_start, baseline_finish,
     baseline_hours, baseline_cost, frozen_by, frozen_at)
  values
    (p_owner_id, p_package_id, 1, 'scope',
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
    (owner_id, package_id, version_number, baseline_kind, baseline_start, baseline_finish,
     baseline_hours, baseline_cost, frozen_by, frozen_at)
  values
    (p_owner_id, v_change.package_id, v_new_version, 'scope',
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
--     SCOPE plan row sits at a version with no scope baseline, or ahead
--     of the package's current scope head: the mapping cannot be
--     guessed. Schedule-only rows are legitimate by design and pass.
--   - A package whose plan inputs are incomplete is SKIPPED (never a
--     zero-hour/zero-cost row) and reported by NOTICE with its reason;
--     it needs its inputs corrected plus an explicit, reviewed rerun.
--   - A package that already has a SCOPE plan row at the head version
--     is left untouched (idempotent re-run); a schedule-only row at
--     that version does not count as present — the package still gets
--     its scope-paired row.
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
  v_trigger_exists boolean;
begin
  -- Preflight: no orphan or ahead-of-head SCOPE plan rows.
  -- Schedule-only rows are legitimate by design and are ignored.
  for v_bad in
    select p.owner_id, p.package_id, p.version_number
    from forge_work_package_baselines p
    where p.baseline_kind = 'scope'
      and (not exists (
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
      ))
  loop
    raise exception 'forge_work: plan baseline version collision — package % already has plan version % with no matching scope head (backfill cannot map it); resolve before applying', v_bad.package_id, v_bad.version_number
      using errcode = 'check_violation', detail = 'package_id=' || v_bad.package_id || ' version_number=' || v_bad.version_number;
  end loop;

  -- The stamp trigger exists in production (busts migration) but not
  -- in every fixture; guard the disable/enable on its existence.
  select exists (
    select 1 from pg_trigger
    where tgname = 'forge_work_package_baselines_stamp_actor_trg'
      and tgrelid = 'public.forge_work_package_baselines'::regclass
  ) into v_trigger_exists;
  if v_trigger_exists then
    alter table forge_work_package_baselines
      disable trigger forge_work_package_baselines_stamp_actor_trg;
  end if;
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

      -- Already present (a SCOPE row at the head version)? Leave it.
      -- A schedule-only row at that version does NOT count as present.
      if exists (
        select 1 from forge_work_package_baselines p
        where p.owner_id = r.owner_id and p.package_id = r.package_id
          and p.version_number = v_head_version
          and p.baseline_kind = 'scope'
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
        (owner_id, package_id, version_number, baseline_kind, baseline_start, baseline_finish,
         baseline_hours, baseline_cost, frozen_by, frozen_at)
      values
        (r.owner_id, r.package_id, v_head_version, 'scope',
         (v_inputs ->> 'start')::date, (v_inputs ->> 'finish')::date,
         (v_inputs ->> 'hours')::numeric, (v_inputs ->> 'cost_cents')::numeric / 100,
         'migration:20261116_planner_bust_baseline_hours', now());
      v_backfilled := v_backfilled + 1;
    end loop;
  exception when others then
    if v_trigger_exists then
      alter table forge_work_package_baselines
        enable trigger forge_work_package_baselines_stamp_actor_trg;
    end if;
    raise;
  end;
  if v_trigger_exists then
    alter table forge_work_package_baselines
      enable trigger forge_work_package_baselines_stamp_actor_trg;
  end if;

  raise notice 'forge_work plan backfill complete: % backfilled, % skipped (incomplete plan inputs), % already present',
    v_backfilled, v_skipped, v_present;
end $$;

-- ---------------------------------------------------------------------------
-- Fix round 1: kind-filter the three already-applied busts RPCs so the
-- two version series stay distinct. The bust snapshot selects the
-- 'scope' row as its baseline and resolves progress snapshots against
-- 'schedule' rows; the manpower curve resolves 'schedule' rows; bust
-- creation requires a 'scope' baseline (a schedule-only row is refused
-- with WPP9_INVALID_BASELINE). These are full verbatim replacements
-- of the functions as applied by migration 20261115000000, plus the
-- baseline_kind filters — no other change.
--
-- The two slice-6 placement RPCs are replaced likewise (full verbatim
-- replacements as applied by migration 20261107030000, plus the
-- baseline_kind filters): placement_set resolves the named baseline
-- among 'schedule' rows only and treats only a newer 'schedule'
-- version as stale; placement_clear's staleness check is
-- schedule-only. Without the filters a placement could anchor to a
-- scope row and fail on the moved FK with a raw error, or be falsely
-- staled by a newer scope version.
--
-- Fix round 2: the placement version is now resolved against the
-- SCHEDULE series everywhere, never the scope series, and every
-- placement reader/RPC enforces schedule kind. The bust snapshot
-- resolves placements against the latest schedule baseline (its
-- `baseline` CTE is the scope row, so comparing placement versions
-- to it drops current placements once the series diverge); the
-- manpower snapshot joins placements to the schedule baseline by
-- version AND kind; placement_set looks up and inserts schedule
-- rows only; placement_clear rejects a non-schedule row outright.
-- Together with the schedule-only CHECK above, a placement is
-- identified by (baseline_kind, baseline_version) with kind always
-- 'schedule' — the version integer is never again treated as
-- globally meaningful.
-- ---------------------------------------------------------------------------
create or replace function public.forge_work_package_busts_snapshot(
  p_owner_id text,
  p_package_id text,
  p_as_of date,
  p_baseline_version integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
  v_as_of date := coalesce(p_as_of, current_date);
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP9_WORKSPACE_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id
  ) then
    raise exception 'WPP9_PACKAGE_NOT_FOUND';
  end if;

  -- ONE statement = ONE snapshot: baseline, lines, curve inputs,
  -- progress, estimate and fingerprints below can never come from
  -- two different revisions.
  with baseline as (
    select id, version_number, baseline_start, baseline_finish,
           baseline_hours, baseline_cost, frozen_at
    from public.forge_work_package_baselines
    where owner_id = p_owner_id and package_id = p_package_id
      and baseline_kind = 'scope'
      and (p_baseline_version is null or version_number = p_baseline_version)
    order by version_number desc
    limit 1
  ),
  lines as (
    select l.id, l.drawing_id, d.drawing_number, l.quantity, l.unit,
           coalesce(sum(e.installed_quantity), 0) as installed_quantity
    from public.forge_work_takeoff_lines l
    join public.forge_work_drawings d
      on d.owner_id = l.owner_id and d.id = l.drawing_id
    left join public.forge_work_progress_entries e
      on e.owner_id = l.owner_id and e.takeoff_line_id = l.id
      and e.work_package_id = p_package_id
      and e.voided_at is null
      and e.work_date <= v_as_of
    where l.owner_id = p_owner_id and d.package_id = p_package_id
    group by l.id, l.drawing_id, d.drawing_number, l.quantity, l.unit
  ),
  steps as (
    select id, title, sequence_no, craft_key, craft_label,
           planned_duration_days, planned_person_hours, version
    from public.forge_work_steps
    where owner_id = p_owner_id and work_package_id = p_package_id
      and retired_at is null
  ),
  -- Placements are schedule artifacts: resolve them against the
  -- latest SCHEDULE baseline, never the scope `baseline` above.
  -- With independent per-kind series the two version numbers are
  -- unrelated — comparing a placement's version to the scope
  -- version drops current placements (scope v2 + schedule v1) or
  -- binds a stale same-number row (scope v1 + schedule v2).
  schedule_baseline as (
    select id, version_number
    from public.forge_work_package_baselines
    where owner_id = p_owner_id and package_id = p_package_id
      and baseline_kind = 'schedule'
    order by version_number desc
    limit 1
  ),
  placements as (
    select p.id, p.step_id, p.baseline_version, p.start_day_index, p.version
    from public.forge_work_step_curve_placements p
    where p.owner_id = p_owner_id and p.work_package_id = p_package_id
      and p.retired_at is null
      and p.baseline_kind = 'schedule'
      and (p.baseline_version is null
        or p.baseline_version = (select version_number from schedule_baseline))
  ),
  assignments as (
    select work_date, craft_key, craft_label, shift_key, crew_size, hours_per_person
    from public.forge_work_craft_assignments
    where owner_id = p_owner_id and work_package_id = p_package_id
      and retired_at is null
  ),
  latest_progress as (
    select status_date, actual_hours, actual_cost, baseline_version
    from public.forge_work_progress_snapshots
    where owner_id = p_owner_id and package_id = p_package_id
    order by status_date desc, created_at desc
    limit 1
  ),
  -- The baseline the latest progress snapshot was measured against.
  -- It can be an older version than the current frozen baseline (a
  -- re-baseline must not rewrite what an earlier snapshot measured),
  -- so labor/schedule candidates name THIS row as their allowance.
  progress_baseline as (
    select id, version_number, baseline_start, baseline_finish,
           baseline_hours, baseline_cost, frozen_at
    from public.forge_work_package_baselines
    where owner_id = p_owner_id and package_id = p_package_id
      and baseline_kind = 'schedule'
      and version_number = (select baseline_version from latest_progress)
    limit 1
  ),
  estimate as (
    select original_control_estimate_cents, current_estimate_cents
    from public.forge_work_control_estimates
    where owner_id = p_owner_id and work_package_id = p_package_id
      and retired_at is null
    limit 1
  ),
  active_busts as (
    select id, source_fingerprint, status, dimension
    from public.forge_work_package_busts
    where owner_id = p_owner_id and work_package_id = p_package_id
      and status in ('OPEN', 'UNDER_REVIEW')
  ),
  pkg as (
    select status from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id
  )
  select jsonb_build_object(
    'packageStatus', (select status from pkg),
    'asOf', v_as_of,
    'baseline', (select to_jsonb(b) from baseline b),
    'progressBaseline', (select to_jsonb(pb) from progress_baseline pb),
    'takeoffLines', coalesce(
      (select jsonb_agg(to_jsonb(l) order by l.id) from lines l),
      '[]'::jsonb),
    'steps', coalesce(
      (select jsonb_agg(to_jsonb(s) order by s.sequence_no, s.id) from steps s),
      '[]'::jsonb),
    'placements', coalesce(
      (select jsonb_agg(to_jsonb(p) order by p.step_id) from placements p),
      '[]'::jsonb),
    'assignments', coalesce(
      (select jsonb_agg(to_jsonb(a) order by a.work_date, a.craft_key, a.shift_key) from assignments a),
      '[]'::jsonb),
    'latestProgress', (select to_jsonb(lp) from latest_progress lp),
    'controlEstimate', (select to_jsonb(e) from estimate e),
    'activeBusts', coalesce(
      (select jsonb_agg(to_jsonb(ab) order by ab.id) from active_busts ab),
      '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.forge_work_manpower_curve_snapshot(
  p_owner_id text,
  p_package_id text,
  p_baseline_version integer default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP6_WORKSPACE_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id
  ) then
    raise exception 'WPP6_PACKAGE_NOT_FOUND';
  end if;
  -- Baselines are immutable, so a named version that exists here still
  -- exists in the snapshot statement below; one that does not exist here
  -- cannot appear there.
  if p_baseline_version is not null then
    if p_baseline_version < 1 then
      raise exception 'WPP6_BASELINE_NOT_FOUND';
    end if;
    if not exists (
      select 1 from public.forge_work_package_baselines
      where owner_id = p_owner_id and package_id = p_package_id
        and baseline_kind = 'schedule'
        and version_number = p_baseline_version
    ) then
      raise exception 'WPP6_BASELINE_NOT_FOUND';
    end if;
  end if;

  -- ONE statement = ONE snapshot: the baseline, steps, placements and
  -- assignments below can never come from two different revisions.
  with baseline as (
    select version_number, baseline_start, baseline_finish, frozen_at
    from public.forge_work_package_baselines
    where owner_id = p_owner_id and package_id = p_package_id
      and baseline_kind = 'schedule'
      and (p_baseline_version is null or version_number = p_baseline_version)
    order by version_number desc
    limit 1
  ),
  steps as (
    select id, title, sequence_no, craft_key, craft_label,
           planned_duration_days, planned_person_hours, version
    from public.forge_work_steps
    where owner_id = p_owner_id and work_package_id = p_package_id
      and retired_at is null
  ),
  placements as (
    select p.id, p.step_id, p.start_day_index, p.version
    from public.forge_work_step_curve_placements p
    join baseline b on b.version_number = p.baseline_version
    -- A retired step's placement is inert: the snapshot only ever
    -- returns placements for active steps. The placement row itself
    -- stays on file (never deleted, never retired by the step's
    -- retirement) — it simply never reaches the curve again.
    join public.forge_work_steps s
      on s.owner_id = p.owner_id and s.id = p.step_id and s.retired_at is null
    where p.owner_id = p_owner_id and p.work_package_id = p_package_id
      and p.retired_at is null
      -- Fix round 2: the version number alone is not an identity
      -- across the independent scope/schedule series — a placement
      -- only joins its schedule baseline when it carries the
      -- schedule kind (the schema CHECK now enforces this; the
      -- filter keeps the reader correct for every row the schema
      -- permits).
      and p.baseline_kind = 'schedule'
  ),
  assignments as (
    select id, work_date, craft_key, craft_label, crew_size, hours_per_person, version
    from public.forge_work_craft_assignments
    where owner_id = p_owner_id and work_package_id = p_package_id
      and retired_at is null
  )
  select jsonb_build_object(
    'baseline', (
      select case when count(*) = 0 then null
        else jsonb_build_object(
          'version_number', max(version_number),
          'baseline_start', max(baseline_start),
          'baseline_finish', max(baseline_finish),
          'frozen_at', max(frozen_at))
      end from baseline
    ),
    'steps', coalesce(
      (select jsonb_agg(to_jsonb(s) order by s.sequence_no, s.id) from steps s),
      '[]'::jsonb),
    'placements', coalesce(
      (select jsonb_agg(to_jsonb(p) order by p.step_id) from placements p),
      '[]'::jsonb),
    'assignments', coalesce(
      (select jsonb_agg(to_jsonb(a) order by a.work_date, a.id) from (
        select id, work_date, craft_key, craft_label, crew_size, hours_per_person
        from assignments) a),
      '[]'::jsonb),
    'generations', jsonb_build_object(
      'steps', jsonb_build_object(
        'count', (select count(*) from steps),
        'max_version', (select max(version) from steps)),
      'placements', jsonb_build_object(
        'count', (select count(*) from placements),
        'max_version', (select max(version) from placements)),
      'assignments', jsonb_build_object(
        'count', (select count(*) from assignments),
        'max_version', (select max(version) from assignments)),
      'baseline_version', (select max(version_number) from baseline))
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.forge_work_package_bust_create(
  p_owner_id text,
  p_package_id text,
  p_scope_type text,
  p_takeoff_line_id text,
  p_work_step_id text,
  p_craft text,
  p_work_date date,
  p_shift_key text,
  p_dimension text,
  p_baseline_id text,
  p_baseline_version integer,
  p_planned_value numeric,
  p_observed_value numeric,
  p_unit text,
  p_evidence_summary text,
  p_evidence_ref text,
  p_comparison_as_of date,
  p_source_fingerprint text,
  p_request_id text,
  p_reason text
)
returns public.forge_work_package_busts
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_bust public.forge_work_package_busts%rowtype;
  v_fingerprint text;
  v_digest text;
  v_replay_bust_id text;
  v_existing_bust_id text;
  v_variance numeric;
  v_percent numeric;
  v_line_unit text;
  v_reason text;
  v_planned numeric;
  v_observed numeric;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP9_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP9_INVALID_ACTOR';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id for update;
  if not found then
    raise exception 'WPP9_PACKAGE_NOT_FOUND';
  end if;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP9_PACKAGE_TERMINAL';
  end if;

  -- Dimension / scope shape. The table CHECKs enforce the same
  -- mapping; these raises give the application a stable error code.
  if p_dimension is null or p_dimension not in (
    'INSTALLED_QUANTITY', 'LABOR_HOURS', 'LABOR_COST',
    'SCHEDULE_DAYS', 'MANPOWER_SHORTFALL') then
    raise exception 'WPP9_INVALID_DIMENSION';
  end if;
  if p_scope_type is null or p_scope_type not in (
    'PACKAGE', 'TAKEOFF_LINE', 'WORK_STEP', 'CRAFT_DAY') then
    raise exception 'WPP9_INVALID_SCOPE';
  end if;
  if (p_dimension = 'INSTALLED_QUANTITY' and p_scope_type <> 'TAKEOFF_LINE')
    or (p_dimension = 'MANPOWER_SHORTFALL' and p_scope_type <> 'CRAFT_DAY')
    or (p_dimension = 'SCHEDULE_DAYS' and p_scope_type not in ('PACKAGE', 'WORK_STEP'))
    or (p_dimension in ('LABOR_HOURS', 'LABOR_COST')
        and p_scope_type not in ('PACKAGE', 'TAKEOFF_LINE')) then
    raise exception 'WPP9_INVALID_TARGET';
  end if;
  if p_scope_type = 'TAKEOFF_LINE' and p_takeoff_line_id is null then
    raise exception 'WPP9_INVALID_TARGET';
  end if;
  if p_scope_type = 'WORK_STEP' and p_work_step_id is null then
    raise exception 'WPP9_INVALID_TARGET';
  end if;
  if p_scope_type = 'CRAFT_DAY' and (p_craft is null or p_work_date is null) then
    raise exception 'WPP9_INVALID_TARGET';
  end if;

  -- Target existence in this same package (a retired step cannot be
  -- attached; a takeoff line must hang off a drawing of this
  -- package). Drawings carry no retired column, so no drawing check.
  if p_scope_type = 'TAKEOFF_LINE' then
    select l.unit into v_line_unit
      from public.forge_work_takeoff_lines l
      join public.forge_work_drawings d
        on d.owner_id = l.owner_id and d.id = l.drawing_id
      where l.owner_id = p_owner_id and l.id = p_takeoff_line_id
        and d.package_id = p_package_id;
    if not found then
      raise exception 'WPP9_INVALID_TARGET';
    end if;
    if p_unit is null or p_unit <> v_line_unit then
      raise exception 'WPP9_INVALID_UNIT';
    end if;
  end if;
  if p_scope_type = 'WORK_STEP' then
    if not exists (
      select 1 from public.forge_work_steps
      where owner_id = p_owner_id and work_package_id = p_package_id
        and id = p_work_step_id and retired_at is null
    ) then
      raise exception 'WPP9_TARGET_RETIRED';
    end if;
  end if;

  -- Baseline: required for every dimension except installed
  -- quantity (whose allowance is the takeoff line itself); when
  -- given it must be a frozen baseline row for this package.
  if p_dimension <> 'INSTALLED_QUANTITY' then
    if p_baseline_id is null or p_baseline_version is null then
      raise exception 'WPP9_INVALID_BASELINE';
    end if;
  end if;
  if p_baseline_id is not null then
    if p_baseline_version is null or not exists (
      select 1 from public.forge_work_package_baselines
      where owner_id = p_owner_id and package_id = p_package_id
        and id = p_baseline_id and version_number = p_baseline_version
        and baseline_kind = 'scope'
    ) then
      raise exception 'WPP9_INVALID_BASELINE';
    end if;
  end if;

  -- Unit per dimension (quantity carries the line's unit, checked
  -- above against the live line row).
  if p_dimension = 'LABOR_COST' and p_unit <> 'USD_CENTS' then
    raise exception 'WPP9_INVALID_UNIT';
  end if;
  if p_dimension = 'SCHEDULE_DAYS' and p_unit <> 'DAYS' then
    raise exception 'WPP9_INVALID_UNIT';
  end if;
  if p_dimension in ('LABOR_HOURS', 'MANPOWER_SHORTFALL') and p_unit <> 'HOURS' then
    raise exception 'WPP9_INVALID_UNIT';
  end if;

  -- Values: cost is whole cents, schedule is whole days, hours use
  -- 3 decimals, quantities 4. Direction is zero-tolerance:
  -- observed > planned, except manpower where required > capacity.
  if p_planned_value is null or p_observed_value is null then
    raise exception 'WPP9_INVALID_VALUE';
  end if;
  if p_dimension = 'LABOR_COST' then
    v_planned := public.forge_work_package_bust_check_cents(p_planned_value);
    v_observed := public.forge_work_package_bust_check_cents(p_observed_value);
  elsif p_dimension = 'SCHEDULE_DAYS' then
    if p_planned_value <> trunc(p_planned_value) or p_observed_value <> trunc(p_observed_value)
       or p_planned_value < 0 or p_observed_value < 0 then
      raise exception 'WPP9_INVALID_VALUE';
    end if;
    v_planned := p_planned_value;
    v_observed := p_observed_value;
  elsif p_dimension in ('LABOR_HOURS', 'MANPOWER_SHORTFALL') then
    v_planned := public.forge_work_package_bust_check_decimal(p_planned_value, 3);
    v_observed := public.forge_work_package_bust_check_decimal(p_observed_value, 3);
  else
    v_planned := public.forge_work_package_bust_check_decimal(p_planned_value, 4);
    v_observed := public.forge_work_package_bust_check_decimal(p_observed_value, 4);
  end if;
  if p_dimension = 'MANPOWER_SHORTFALL' then
    if not (v_planned > v_observed) then
      raise exception 'WPP9_INVALID_VALUE';
    end if;
    v_variance := v_planned - v_observed;
  else
    if not (v_observed > v_planned) then
      raise exception 'WPP9_INVALID_VALUE';
    end if;
    v_variance := v_observed - v_planned;
  end if;
  -- Percent is null for a zero plan, never infinity.
  if v_planned = 0 then
    v_percent := null;
  else
    v_percent := round(v_variance / v_planned * 100, 4);
  end if;

  -- Evidence: a bounded narrative is required; the reference is
  -- optional. The comparison date may not be in the future.
  if p_evidence_summary is null or char_length(btrim(p_evidence_summary)) < 10
     or char_length(p_evidence_summary) > 2000
     or p_evidence_summary ~ '[[:cntrl:]]' then
    raise exception 'WPP9_INVALID_EVIDENCE';
  end if;
  if p_evidence_ref is not null and (char_length(p_evidence_ref) > 500
     or p_evidence_ref ~ '[[:cntrl:]]') then
    raise exception 'WPP9_INVALID_EVIDENCE';
  end if;
  if p_comparison_as_of is null or p_comparison_as_of > current_date then
    raise exception 'WPP9_INVALID_VALUE';
  end if;
  if p_request_id is not null and char_length(p_request_id) > 200 then
    raise exception 'WPP9_INVALID_VALUE';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) > 1000 then
    raise exception 'WPP9_REASON_TOO_LONG';
  end if;
  if v_reason = '' then
    v_reason := 'Bust recorded';
  end if;

  -- The server computes the fingerprint from the submitted values;
  -- a caller-supplied fingerprint that disagrees means the
  -- confirmation is stale (the sources moved since detection).
  v_fingerprint := public.forge_work_package_bust_fingerprint(
    p_owner_id, p_package_id, p_dimension, p_scope_type,
    p_takeoff_line_id, p_work_step_id, p_craft, p_work_date, p_shift_key,
    p_baseline_id, p_baseline_version, v_planned, v_observed, p_unit,
    p_comparison_as_of);
  if p_source_fingerprint is not null and p_source_fingerprint <> v_fingerprint then
    raise exception 'WPP9_STALE_FINGERPRINT';
  end if;

  -- Idempotency first: the same request id + actor + action with the
  -- same payload digest replays to the existing bust; a different
  -- payload under the same request id is a conflict.
  v_digest := md5(v_fingerprint || '|' || btrim(p_evidence_summary) || '|'
    || coalesce(btrim(p_evidence_ref), ''));
  v_replay_bust_id := public.forge_work_package_bust_idempotency_check(
    p_owner_id, v_actor, 'create', p_request_id, v_digest);
  if v_replay_bust_id is not null then
    select * into v_bust from public.forge_work_package_busts
      where owner_id = p_owner_id and id = v_replay_bust_id;
    if found then
      return v_bust;
    end if;
    -- The revision names a bust that no longer exists (should not
    -- happen — busts are never hard-deleted); fall through and
    -- create a fresh row rather than failing the caller.
  end if;

  -- Dedup: one active bust per comparison identity. A re-confirm
  -- of an existing candidate is a 409 naming the existing bust.
  select id into v_existing_bust_id
    from public.forge_work_package_busts
    where owner_id = p_owner_id and work_package_id = p_package_id
      and source_fingerprint = v_fingerprint
      and status in ('OPEN', 'UNDER_REVIEW')
    limit 1;
  if found then
    raise exception 'WPP9_DUPLICATE_ACTIVE:%', v_existing_bust_id;
  end if;

  insert into public.forge_work_package_busts
    (owner_id, id, work_package_id, scope_type, takeoff_line_id,
     work_step_id, craft, work_date, shift_key, dimension,
     baseline_id, baseline_version, source_fingerprint,
     comparison_as_of, unit, planned_value, observed_value,
     variance_value, variance_percent, evidence_summary, evidence_ref,
     status, version, created_by, updated_by)
  values
    (p_owner_id,
     'forge_wpbust_' || replace(gen_random_uuid()::text, '-', ''),
     p_package_id, p_scope_type, p_takeoff_line_id,
     p_work_step_id, case when p_craft is null then null else btrim(p_craft) end,
     p_work_date, p_shift_key, p_dimension,
     p_baseline_id, p_baseline_version, v_fingerprint,
     p_comparison_as_of, p_unit, v_planned, v_observed,
     v_variance, v_percent, btrim(p_evidence_summary),
     case when p_evidence_ref is null then null else btrim(p_evidence_ref) end,
     'OPEN', 1, v_actor, v_actor)
  returning * into v_bust;

  insert into public.forge_work_package_bust_revisions
    (owner_id, id, bust_id, version, actor_id, action, old_values, new_values, reason, request_id)
  values
    (p_owner_id,
     'forge_wpbustr_' || replace(gen_random_uuid()::text, '-', ''),
     v_bust.id, 1, v_actor, 'create', null,
     jsonb_build_object(
       'dimension', v_bust.dimension,
       'scope_type', v_bust.scope_type,
       'planned_value', v_bust.planned_value,
       'observed_value', v_bust.observed_value,
       'variance_value', v_bust.variance_value,
       'variance_percent', v_bust.variance_percent,
       'unit', v_bust.unit,
       'status', 'OPEN',
       'version', 1,
       'requestDigest', v_digest),
     v_reason, p_request_id);

  return v_bust;
end;
$$;
create or replace function public.forge_work_manpower_curve_placement_set(
  p_owner_id text,
  p_package_id text,
  p_step_id text,
  p_baseline_version integer,
  p_start_day_index integer,
  p_expected_version integer default null,
  p_reason text default null
)
returns setof public.forge_work_step_curve_placements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id text := auth.uid();
  v_status text;
  v_baseline public.forge_work_package_baselines%rowtype;
  v_outage_days integer;
  v_step public.forge_work_steps%rowtype;
  v_duration integer;
  v_placement public.forge_work_step_curve_placements%rowtype;
  v_placement_id text;
begin
  if v_actor_id is null then
    raise exception 'WPP6_INVALID_ACTOR';
  end if;
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP6_WORKSPACE_FORBIDDEN';
  end if;
  if p_baseline_version is null or p_baseline_version < 1 then
    raise exception 'WPP6_BASELINE_NOT_FOUND';
  end if;
  if p_start_day_index is null or p_start_day_index < 1 then
    raise exception 'WPP6_INVALID_START_DAY';
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'WPP6_REASON_TOO_LONG';
  end if;

  select status into v_status
  from public.forge_work_packages
  where owner_id = p_owner_id and id = p_package_id;
  if not found then
    raise exception 'WPP6_PACKAGE_NOT_FOUND';
  end if;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP6_PACKAGE_TERMINAL';
  end if;

  select * into v_baseline
  from public.forge_work_package_baselines
  where owner_id = p_owner_id and package_id = p_package_id
    and baseline_kind = 'schedule'
    and version_number = p_baseline_version;
  if not found then
    raise exception 'WPP6_BASELINE_NOT_FOUND';
  end if;
  -- The named version must still be the current one: a newer frozen
  -- baseline means the planner must re-establish placements explicitly.
  if exists (
    select 1 from public.forge_work_package_baselines
    where owner_id = p_owner_id and package_id = p_package_id
      and baseline_kind = 'schedule'
      and version_number > p_baseline_version
  ) then
    raise exception 'WPP6_BASELINE_STALE';
  end if;
  v_outage_days := (v_baseline.baseline_finish - v_baseline.baseline_start) + 1;
  if p_start_day_index > v_outage_days then
    raise exception 'WPP6_INVALID_START_DAY';
  end if;

  select * into v_step
  from public.forge_work_steps
  where owner_id = p_owner_id and work_package_id = p_package_id and id = p_step_id;
  if not found then
    raise exception 'WPP6_STEP_NOT_FOUND';
  end if;
  if v_step.retired_at is not null then
    raise exception 'WPP6_RETIRED';
  end if;

  v_duration := coalesce(v_step.planned_duration_days, v_outage_days);
  if p_start_day_index + v_duration - 1 > v_outage_days then
    raise exception 'WPP6_PLACEMENT_OUTSIDE_WINDOW:%', p_step_id;
  end if;

  -- Fix round 2: the lookup is kind-scoped. The version number
  -- alone is not an identity across the independent scope/schedule
  -- series — without the kind filter a scope-kind placement at the
  -- same number could be selected and updated as though it were
  -- the schedule placement.
  select * into v_placement
  from public.forge_work_step_curve_placements
  where owner_id = p_owner_id and work_package_id = p_package_id
    and step_id = p_step_id and baseline_version = p_baseline_version
    and baseline_kind = 'schedule'
    and retired_at is null
  for update;

  if found then
    if p_expected_version is null or p_expected_version <> v_placement.version then
      raise exception 'WPP6_VERSION_CONFLICT';
    end if;
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'WPP6_REASON_REQUIRED';
    end if;

    update public.forge_work_step_curve_placements
    set start_day_index = p_start_day_index,
        version = version + 1,
        updated_by = v_actor_id,
        updated_at = now()
    where owner_id = p_owner_id and id = v_placement.id;

    insert into public.forge_work_step_curve_placement_revisions (
      owner_id, id, placement_id, version, actor_id, action, old_values, new_values, reason
    ) values (
      p_owner_id,
      'forge_wpspr_' || replace(gen_random_uuid()::text, '-', ''),
      v_placement.id,
      v_placement.version + 1,
      v_actor_id,
      'set',
      jsonb_build_object('baseline_version', v_placement.baseline_version, 'start_day_index', v_placement.start_day_index, 'version', v_placement.version),
      jsonb_build_object('baseline_version', p_baseline_version, 'start_day_index', p_start_day_index, 'version', v_placement.version + 1),
      p_reason
    );
    v_placement_id := v_placement.id;
  else
    if p_expected_version is not null and p_expected_version <> 0 then
      raise exception 'WPP6_VERSION_CONFLICT';
    end if;

    v_placement_id := 'forge_wpsp_' || replace(gen_random_uuid()::text, '-', '');
    -- Fix round 2: stamp the kind explicitly. The column default
    -- is 'schedule' and the schema CHECK enforces it, but the RPC
    -- must not rely on the default to keep the placement invariant.
    insert into public.forge_work_step_curve_placements (
      owner_id, id, work_package_id, step_id, baseline_kind, baseline_version, start_day_index,
      version, created_by, updated_by
    ) values (
      p_owner_id, v_placement_id, p_package_id, p_step_id, 'schedule', p_baseline_version, p_start_day_index,
      1, v_actor_id, v_actor_id
    );

    insert into public.forge_work_step_curve_placement_revisions (
      owner_id, id, placement_id, version, actor_id, action, old_values, new_values, reason
    ) values (
      p_owner_id,
      'forge_wpspr_' || replace(gen_random_uuid()::text, '-', ''),
      v_placement_id,
      1,
      v_actor_id,
      'set',
      null,
      jsonb_build_object('baseline_version', p_baseline_version, 'start_day_index', p_start_day_index, 'version', 1),
      p_reason
    );
  end if;

  return query
    select *
    from public.forge_work_step_curve_placements
    where owner_id = p_owner_id and id = v_placement_id;
end;
$$;

create or replace function public.forge_work_manpower_curve_placement_clear(
  p_owner_id text,
  p_placement_id text,
  p_expected_version integer,
  p_reason text
)
returns setof public.forge_work_step_curve_placements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id text := auth.uid();
  v_status text;
  v_placement public.forge_work_step_curve_placements%rowtype;
begin
  if v_actor_id is null then
    raise exception 'WPP6_INVALID_ACTOR';
  end if;
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP6_WORKSPACE_FORBIDDEN';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'WPP6_REASON_REQUIRED';
  end if;
  if char_length(p_reason) > 1000 then
    raise exception 'WPP6_REASON_TOO_LONG';
  end if;

  select * into v_placement
  from public.forge_work_step_curve_placements
  where owner_id = p_owner_id and id = p_placement_id
  for update;
  if not found then
    raise exception 'WPP6_PLACEMENT_NOT_FOUND';
  end if;
  -- Fix round 2: placements are schedule artifacts. A row whose
  -- kind is not 'schedule' is not a schedule placement — reject it
  -- outright instead of clearing it against the schedule series.
  -- (The schema CHECK now forbids such rows; this is the reader's
  -- own enforcement for every row the schema permits.)
  if v_placement.baseline_kind <> 'schedule' then
    raise exception 'WPP6_PLACEMENT_NOT_FOUND';
  end if;
  if v_placement.retired_at is not null then
    raise exception 'WPP6_RETIRED';
  end if;
  if p_expected_version is null or p_expected_version <> v_placement.version then
    raise exception 'WPP6_VERSION_CONFLICT';
  end if;
  if exists (
    select 1 from public.forge_work_package_baselines
    where owner_id = p_owner_id and package_id = v_placement.work_package_id
      and baseline_kind = 'schedule'
      and version_number > v_placement.baseline_version
  ) then
    raise exception 'WPP6_BASELINE_STALE';
  end if;

  select status into v_status
  from public.forge_work_packages
  where owner_id = p_owner_id and id = v_placement.work_package_id;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP6_PACKAGE_TERMINAL';
  end if;

  update public.forge_work_step_curve_placements
  set retired_at = now(),
      retired_by = v_actor_id,
      version = version + 1,
      updated_by = v_actor_id,
      updated_at = now()
  where owner_id = p_owner_id and id = p_placement_id;

  insert into public.forge_work_step_curve_placement_revisions (
    owner_id, id, placement_id, version, actor_id, action, old_values, new_values, reason
  ) values (
    p_owner_id,
    'forge_wpspr_' || replace(gen_random_uuid()::text, '-', ''),
    p_placement_id,
    v_placement.version + 1,
    v_actor_id,
    'clear',
    jsonb_build_object('baseline_version', v_placement.baseline_version, 'start_day_index', v_placement.start_day_index, 'version', v_placement.version),
    jsonb_build_object('baseline_version', v_placement.baseline_version, 'start_day_index', null, 'version', v_placement.version + 1, 'retired_at', now()),
    p_reason
  );

  return query
    select *
    from public.forge_work_step_curve_placements
    where owner_id = p_owner_id and id = p_placement_id;
end;
$$;
