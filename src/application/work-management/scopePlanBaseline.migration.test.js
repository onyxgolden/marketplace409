// Planner busts — scope/plan baseline bridge migration proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) and proves:
//   - Freeze inserts scope v1 AND plan v1 in one transaction, same
//     package/owner/version/actor/freeze timestamp; plan hours equal
//     the sum of active non-retired step hours, dates equal the
//     package planned dates, cost equals the active estimate in
//     cents / 100; retired steps are excluded.
//   - Every §2 failure fails closed with its specific code and writes
//     nothing: no active steps, null/negative step hours, missing or
//     reversed dates, missing / ambiguous / negative estimate. The
//     package pointer does not advance and no scope baseline survives.
//   - Post-freeze Approve inserts scope vN+1 AND plan vN+1 atomically,
//     with values captured from the plan at approval time. Reject
//     creates no plan baseline and needs no plan inputs. Approving
//     with broken plan inputs leaves the change proposed.
//   - Rollback: a failing plan insert (unique collision with a
//     pre-existing SCOPE plan row) rolls the scope baseline and the
//     pointer advance back with it — no orphan scope row. A
//     schedule-only row at the same version does NOT collide: the
//     two writers version in separate series (fix round 1).
//   - Non-vacuity: the pre-fix RPCs (verbatim rung-1 text, applied
//     before the bridge) freeze scope-only with no plan row; applying
//     the bridge to the same database makes the next freeze produce
//     the pair. The bridge — not the old code — creates plan rows.
//   - Writer reconciliation (fix round 1, ChatGPT NEEDS CHANGES):
//     a schedule baseline v1 before the initial scope freeze, a
//     schedule baseline after a paired scope/plan v1, and a
//     scope-change approval after each sequence all succeed with
//     no collision; backfill inserts a scope row alongside
//     schedule-only rows; the preflight trips only on scope-kind
//     orphans; the migration's column/constraint ALTERs are proven
//     from the legacy (pre-kind) table shape.
//   - Backfill: latest scope head only, idempotent on re-apply,
//     migration-stamped frozen_by/time, skips incomplete packages
//     (never a zero row), leaves already-present rows untouched, and
//     fails closed on a version collision (preflight).
//   - RLS/ACL/immutability: anon and foreign workspaces cannot write;
//     UPDATE/DELETE refused by the immutable trigger for every role;
//     the freeze/decide RPCs keep EXECUTE for authenticated +
//     service_role only; the helper keeps no grant at all.
//
// Two deliberate deviations from a literal reading of brief §7.6,
// both documented in the migration header:
//   (a) The brief's test 6 says "only the existing intended RPC path
//       can write" plan baselines, but the Rung 4 scheduling
//       freezeBaseline (src/application/work-management/workScheduling.js)
//       inserts directly as the authenticated user through the live
//       POST /schedule/baseline route — and after fix round 1 it
//       stamps baseline_kind='schedule', versioning in its own
//       series, so it can never collide with a scope-paired row.
//       This suite therefore asserts the protections that actually
//       exist (anon/foreign cannot write; UPDATE/DELETE refused) and
//       asserts the owner direct insert still succeeds, so a future
//       hardening cannot silently break the scheduling flow. Making
//       writes RPC-only is a separate slice.
//   (b) The ambiguous-estimate leg is exercised against a prereq stub
//       that omits the production unique index on one active estimate
//       per package (uq_forge_work_control_estimates_active_package):
//       with the index present the case is unreachable in production,
//       so the helper check is defense-in-depth behind it.
//
// A real-PostgreSQL subset (concurrent freeze race, concurrent
// approve race) runs against a scratch PG16 cluster when the binaries
// exist, and SKIPS LOUDLY — never silently — when they do not. PGlite
// is single-connection, so it cannot prove concurrent-edit
// serialization; that leg exists only on real PG.
//
// The bust-snapshot integration leg (a bridge-created plan baseline
// appearing as the snapshot's `baseline` with the expected
// baseline_hours, exact named-version progress resolution, and a
// LABOR_HOURS bust recording against it) lives in the slice-9
// battery (busts.migration.test.js, "bridge integration" describe):
// it applies this bridge on top of the busts migration and calls
// the replaced RPCs against bridge-created rows. This suite proves
// the bridge produces exactly the row the snapshot's `baseline` CTE
// selects (latest SCOPE version for the package, and the exact named
// version), which is the bridge's whole contract.

import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { Client } from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const it60 = (name, fn) => it(name, fn, 60000);

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const MEMBER_C = "33333333-3333-4333-8333-333333333333";
const ANON_UID = "44444444-4444-4444-8444-444444444444";

const THIS_MIGRATION = "20261116000000_forge_work_scope_plan_baseline_bridge.sql";

function loadMigrationSql(name) {
  return readFileSync(join(HERE, "..", "..", "..", "supabase", "migrations", name), "utf8");
}

// Prerequisite shapes mirror production for the tables the bridge
// touches. The pre-fix freeze/decide RPCs are the VERBATIM rung-1
// definitions (supabase/migrations/20261002120000_forge_work_management_rung1.sql
// lines 848-1016), so the non-vacuity leg runs the real old code.
const PREREQ_SQL = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  -- Production grants USAGE on the auth schema to the app roles; without
  -- it, auth.uid() inside policies/triggers fails for anon/authenticated.
  grant usage on schema auth to anon, authenticated, service_role;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select current_setting('app.test_uid', true)::uuid
  $$;
  create table workspace_members (
    owner_id text not null,
    member_user_id uuid not null,
    status text not null,
    role text not null
  );
  create or replace function public.has_workspace_access(p_owner_id text)
  returns boolean language sql stable security definer
  set search_path = public set row_security = off as $$
    select p_owner_id = auth.uid()::text
      or exists (
        select 1 from workspace_members
        where owner_id = p_owner_id
          and member_user_id = auth.uid()
          and status = 'active'
          and role = 'co_owner'
      );
  $$;
  revoke all on function public.has_workspace_access(text) from public;
  grant execute on function public.has_workspace_access(text) to anon, authenticated, service_role;

  create table forge_work_packages (
    owner_id text not null,
    id text not null,
    status text not null default 'draft',
    planned_start date,
    planned_finish date,
    planned_manhours numeric,
    scope_baseline_id text,
    designated_verifier text,
    actual_start date,
    actual_finish date,
    verified_at timestamptz,
    verified_by text,
    blocked_reason text,
    blocked_since timestamptz,
    blocked_from text,
    updated_by text,
    updated_at timestamptz,
    primary key (owner_id, id)
  );
  -- Lifecycle guard, verbatim rung 1: lifecycle columns change only
  -- through the lifecycle RPCs (or with the forge_work.lifecycle_rpc
  -- bypass the freeze/decide RPCs set).
  create or replace function public.forge_work_packages_lifecycle_guard()
  returns trigger language plpgsql as $$
  declare
    v_bypass boolean := coalesce(current_setting('forge_work.lifecycle_rpc', true) = 'on', false);
  begin
    if TG_OP = 'INSERT' then
      if NEW.status <> 'draft'
         or NEW.actual_start is not null or NEW.actual_finish is not null
         or NEW.verified_at is not null or NEW.verified_by is not null
         or NEW.scope_baseline_id is not null
         or NEW.blocked_reason is not null or NEW.blocked_since is not null
         or NEW.blocked_from is not null
         or NEW.designated_verifier is not null then
        raise exception 'forge_work: packages are created in draft; lifecycle state moves only through the lifecycle RPCs';
      end if;
      return NEW;
    end if;
    if v_bypass then
      return NEW;
    end if;
    if NEW.status is distinct from OLD.status
       or NEW.scope_baseline_id is distinct from OLD.scope_baseline_id
       or NEW.actual_start is distinct from OLD.actual_start
       or NEW.actual_finish is distinct from OLD.actual_finish
       or NEW.verified_at is distinct from OLD.verified_at
       or NEW.verified_by is distinct from OLD.verified_by
       or NEW.blocked_reason is distinct from OLD.blocked_reason
       or NEW.blocked_since is distinct from OLD.blocked_since
       or NEW.blocked_from is distinct from OLD.blocked_from
       or NEW.designated_verifier is distinct from OLD.designated_verifier then
      raise exception 'forge_work: lifecycle columns change only through the lifecycle RPCs';
    end if;
    return NEW;
  end $$;
  drop trigger if exists forge_work_packages_lifecycle_guard_trg on forge_work_packages;
  create trigger forge_work_packages_lifecycle_guard_trg
    before insert or update on forge_work_packages
    for each row execute function forge_work_packages_lifecycle_guard();

  create table forge_work_steps (
    owner_id text not null,
    id text not null,
    work_package_id text not null,
    sequence_no integer,
    planned_person_hours numeric,
    retired_at timestamptz,
    retired_by text,
    primary key (owner_id, id)
  );
  create table forge_work_control_estimates (
    owner_id text not null,
    id text not null,
    work_package_id text not null,
    original_control_estimate_cents bigint not null,
    current_estimate_cents bigint not null,
    contingency_cents bigint,
    version integer not null default 1,
    retired_at timestamptz,
    retired_by text,
    created_by text not null,
    updated_by text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (owner_id, id)
  );
  create table forge_work_scope_baselines (
    owner_id text not null,
    id text not null,
    package_id text not null,
    version integer not null,
    frozen_at timestamptz not null default now(),
    frozen_by text,
    membership jsonb,
    membership_hash text,
    supersedes_id text,
    primary key (owner_id, id)
  );
  create table forge_work_scope_changes (
    owner_id text not null,
    id text not null,
    package_id text not null,
    baseline_version integer not null,
    change_type text,
    description text,
    requested_by text,
    requested_at timestamptz,
    status text not null default 'proposed',
    decided_by text,
    decided_at timestamptz,
    resulting_baseline_version integer,
    primary key (owner_id, id)
  );
  -- Minimal forge_work_package_busts: the bridge migration replaces
  -- forge_work_package_bust_create, whose RETURNS type is this
  -- table — so the table must exist for the migration to apply
  -- (in production it exists from the busts migration
  -- 20261115000000, applied Nov 15). Only the columns the replaced
  -- snapshot reads are stubbed; bust behavior itself is proven in
  -- the slice-9 battery, where the full table lives.
  create table forge_work_package_busts (
    owner_id text not null,
    id text not null,
    work_package_id text not null,
    source_fingerprint text,
    status text not null,
    dimension text,
    primary key (owner_id, id)
  );
  -- Minimal forge_work_step_curve_placements: the bridge migration
  -- replaces the two slice-6 placement RPCs, whose RETURNS / %rowtype
  -- reference this table, and moves its FK to the per-kind unique —
  -- so the table must exist for the migration to apply (in
  -- production it exists from slice 6). Only the FK-relevant
  -- columns are stubbed; placement behavior is proven in the
  -- slice-6 battery, where the full table lives.
  create table forge_work_step_curve_placements (
    owner_id text not null,
    id text not null,
    work_package_id text not null,
    step_id text not null,
    baseline_version integer not null,
    baseline_kind text not null default 'schedule',
    primary key (owner_id, id)
  );
  -- Full rung-4 forge_work_progress_snapshots: the bridge migration
  -- moves its baseline FK to the per-kind unique, so the table must
  -- exist for the constraint swap to be proven (in production it
  -- exists from rung 4) — and fix round 4 installs the real
  -- calculation-integrity trigger on it, so the stub carries the
  -- FULL rung-4 column set, not just the FK-relevant columns plus
  -- the columns the replaced bust snapshot reads (status_date,
  -- actual_hours, actual_cost). RLS / the actor-stamp trigger are
  -- NOT stubbed: this suite inserts snapshots directly as the
  -- database owner, and the stamp trigger would demand an
  -- authenticated identity. Snapshot behavior is proven in the
  -- slice-9 battery, where the full table lives.
  create table forge_work_progress_snapshots (
    owner_id text not null,
    id text not null default ('forge_wps_' || gen_random_uuid()::text),
    package_id text not null,
    status_date date not null,
    planned_pct numeric(7,4) not null,
    actual_pct numeric(7,4) not null,
    earned_pct numeric(7,4) not null,
    earned_hours numeric(14,2) not null,
    earned_cost numeric(14,2) not null,
    actual_hours numeric(14,2) not null,
    actual_cost numeric(14,2) not null,
    etc_hours numeric(14,2),
    etc_cost numeric(14,2),
    eac_hours numeric(14,2),
    eac_cost numeric(14,2),
    baseline_version integer not null,
    baseline_kind text not null default 'schedule',
    recorded_by text not null,
    created_at timestamptz not null default now(),
    primary key (owner_id, id),
    constraint forge_work_progress_snapshots_pct_check check (
      planned_pct between 0 and 100 and
      actual_pct between 0 and 100 and
      earned_pct between 0 and 100),
    constraint forge_work_progress_snapshots_status_unique unique (owner_id, package_id, status_date)
  );
  create index if not exists forge_work_progress_snapshots_pkg_idx
    on forge_work_progress_snapshots (owner_id, package_id, status_date desc);
  -- VERBATIM rung-4 forge_work_snapshots_verify() (supabase/migrations/
  -- 20261004010000_forge_work_management_rung4.sql lines 213-309):
  -- the PRE-bridge function, resolving its baseline by version
  -- number alone. The bridge migration (fix round 4) replaces it
  -- with the kind-scoped version; this stub is what proves the
  -- replacement actually lands and changes behavior.
  create or replace function forge_work_snapshots_verify()
  returns trigger language plpgsql as $$
  declare
    v_baseline_hours numeric(14,2);
    v_baseline_cost numeric(14,2);
    v_baseline_start date;
    v_baseline_finish date;
    v_planned_pct numeric(7,4);
    v_tolerance constant numeric := 0.05;
    v_remaining_cost numeric;
    v_remaining_hours numeric;
    v_etc_cost numeric;
    v_etc_hours numeric;
  begin
    select baseline_hours, baseline_cost, baseline_start, baseline_finish
      into v_baseline_hours, v_baseline_cost, v_baseline_start, v_baseline_finish
      from forge_work_package_baselines
     where owner_id = NEW.owner_id
       and package_id = NEW.package_id
       and version_number = NEW.baseline_version;
    if not found then
      raise exception 'forge_work: snapshot references unknown baseline version % for package %',
        NEW.baseline_version, NEW.package_id;
    end if;
    if abs(NEW.earned_hours - (NEW.earned_pct / 100) * v_baseline_hours) > v_tolerance then
      raise exception 'forge_work: snapshot earned_hours % inconsistent with earned_pct % and baseline hours %',
        NEW.earned_hours, NEW.earned_pct, v_baseline_hours;
    end if;
    if abs(NEW.earned_cost - (NEW.earned_pct / 100) * v_baseline_cost) > v_tolerance then
      raise exception 'forge_work: snapshot earned_cost % inconsistent with earned_pct % and baseline cost %',
        NEW.earned_cost, NEW.earned_pct, v_baseline_cost;
    end if;
    if NEW.status_date <= v_baseline_start then
      v_planned_pct := 0;
    elsif NEW.status_date >= v_baseline_finish then
      v_planned_pct := 100;
    elsif v_baseline_finish = v_baseline_start then
      v_planned_pct := 100;
    else
      v_planned_pct := ((NEW.status_date - v_baseline_start)::numeric
        / (v_baseline_finish - v_baseline_start)::numeric) * 100;
    end if;
    if abs(NEW.planned_pct - v_planned_pct) > 0.01 then
      raise exception 'forge_work: snapshot planned_pct % does not match frozen schedule % for status date %',
        NEW.planned_pct, v_planned_pct, NEW.status_date;
    end if;
    if NEW.etc_hours is null or NEW.etc_cost is null
       or NEW.eac_hours is null or NEW.eac_cost is null then
      raise exception 'forge_work: snapshot forecast fields (etc/eac hours/cost) are required';
    end if;
    v_remaining_hours := v_baseline_hours - NEW.earned_hours;
    v_remaining_cost := v_baseline_cost - NEW.earned_cost;
    if v_remaining_hours <= 0 then
      v_etc_hours := 0;
    elsif NEW.actual_hours > 0 and NEW.earned_hours > 0 then
      v_etc_hours := v_remaining_hours / (NEW.earned_hours / NEW.actual_hours);
    else
      v_etc_hours := v_remaining_hours;
    end if;
    if v_remaining_cost <= 0 then
      v_etc_cost := 0;
    elsif NEW.actual_cost > 0 and NEW.earned_cost > 0 then
      v_etc_cost := v_remaining_cost / (NEW.earned_cost / NEW.actual_cost);
    else
      v_etc_cost := v_remaining_cost;
    end if;
    if abs(NEW.etc_hours - v_etc_hours) > v_tolerance then
      raise exception 'forge_work: snapshot etc_hours % inconsistent with engine forecast %',
        NEW.etc_hours, v_etc_hours;
    end if;
    if abs(NEW.etc_cost - v_etc_cost) > v_tolerance then
      raise exception 'forge_work: snapshot etc_cost % inconsistent with engine forecast %',
        NEW.etc_cost, v_etc_cost;
    end if;
    if abs(NEW.eac_hours - (NEW.actual_hours + v_etc_hours)) > v_tolerance then
      raise exception 'forge_work: snapshot eac_hours inconsistent with actual_hours + forecast etc_hours';
    end if;
    if abs(NEW.eac_cost - (NEW.actual_cost + v_etc_cost)) > v_tolerance then
      raise exception 'forge_work: snapshot eac_cost inconsistent with actual_cost + forecast etc_cost';
    end if;
    return NEW;
  end $$;
  drop trigger if exists forge_work_progress_snapshots_verify_trg on forge_work_progress_snapshots;
  create trigger forge_work_progress_snapshots_verify_trg
    before insert on forge_work_progress_snapshots
    for each row execute function forge_work_snapshots_verify();
  -- Plan baselines: full rung-4 definition (checks, unique, immutable
  -- + actor-stamp triggers, RLS owner policy), plus the fix-round-1
  -- baseline_kind split: scope-paired rows version with the scope
  -- chain, schedule-only rows in their own series. The OLD per-package
  -- unique is ALSO present: in production it is the constraint the
  -- bridge migration must drop, and the placements + progress-snapshot
  -- FKs below reference it — without it (and them) the fixture would
  -- let the constraint swap pass vacuously, which is how the missed
  -- snapshots FK shipped (rehearsal, Nov 16). The migration drops the
  -- old unique and both FKs, then re-adds the FKs against the per-kind
  -- unique; the legacy-shape test below reverts the column as well.
  create table if not exists forge_work_package_baselines (
    owner_id text not null,
    id text not null default ('forge_wpb_' || gen_random_uuid()::text),
    package_id text not null,
    version_number integer not null,
    baseline_kind text not null default 'schedule'
      constraint forge_work_package_baselines_kind_check
        check (baseline_kind in ('scope', 'schedule')),
    baseline_start date not null,
    baseline_finish date not null,
    baseline_hours numeric(14,2) not null,
    baseline_cost numeric(14,2) not null,
    frozen_by text not null,
    frozen_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    primary key (owner_id, id),
    constraint forge_work_package_baselines_version_check check (version_number >= 1),
    constraint forge_work_package_baselines_dates_check check (baseline_finish >= baseline_start),
    constraint forge_work_package_baselines_hours_check check (baseline_hours >= 0),
    constraint forge_work_package_baselines_cost_check check (baseline_cost >= 0),
    constraint forge_work_package_baselines_kind_version_unique unique (owner_id, package_id, baseline_kind, version_number),
    constraint forge_work_package_baselines_version_unique unique (owner_id, package_id, version_number)
  );
  create or replace function forge_work_baselines_immutable()
  returns trigger language plpgsql as $$
  begin
    raise exception 'forge_work: baselines are immutable — insert a new version to re-baseline';
  end $$;
  drop trigger if exists forge_work_package_baselines_immutable_trg on forge_work_package_baselines;
  create trigger forge_work_package_baselines_immutable_trg
    before update or delete on forge_work_package_baselines
    for each row execute function forge_work_baselines_immutable();
  create or replace function forge_work_stamp_actor()
  returns trigger language plpgsql as $$
  declare
    v_actor text;
  begin
    begin
      v_actor := auth.uid()::text;
    exception when undefined_function then
      v_actor := null;
    end;
    if v_actor is null or v_actor = '' then
      raise exception 'forge_work: missing authenticated identity — scheduling writes require a signed-in user';
    end if;
    if TG_ARGV[0] = 'frozen_by' then
      NEW.frozen_by := v_actor;
    else
      NEW.recorded_by := v_actor;
    end if;
    return NEW;
  end $$;
  drop trigger if exists forge_work_package_baselines_stamp_actor_trg on forge_work_package_baselines;
  create trigger forge_work_package_baselines_stamp_actor_trg
    before insert on forge_work_package_baselines
    for each row execute function forge_work_stamp_actor('frozen_by');
  -- Mirror production's Supabase default ACL (pg_default_acl grants ALL
  -- on new public tables to the app roles); the RLS policy below — not
  -- the ACL — is what restricts access.
  grant all on table forge_work_package_baselines to anon, authenticated, service_role;
  alter table forge_work_package_baselines enable row level security;
  drop policy if exists forge_work_package_baselines_owner on forge_work_package_baselines;
  create policy forge_work_package_baselines_owner on forge_work_package_baselines
    for all using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

  -- Pre-bridge FKs on the OLD per-package unique: the two dependents
  -- the bridge migration must drop before the old unique can go.
  -- Placements (slice 6, unnamed in production — hence no name here)
  -- and progress snapshots (rung 4, named). The migration drops both
  -- by target table and re-adds them against the per-kind unique.
  alter table forge_work_step_curve_placements
    add foreign key (owner_id, work_package_id, baseline_version)
      references forge_work_package_baselines (owner_id, package_id, version_number)
      on delete restrict;
  alter table forge_work_progress_snapshots
    add constraint forge_work_progress_snapshots_baseline_fk
      foreign key (owner_id, package_id, baseline_version)
      references forge_work_package_baselines (owner_id, package_id, version_number)
      on delete restrict;

  -- Pre-fix RPCs, verbatim rung 1 (scope-only freeze / decide).
  create or replace function forge_work_freeze_scope(
    p_owner_id text, p_package_id text,
    p_membership jsonb, p_membership_hash text
  ) returns jsonb
  language plpgsql security definer set search_path = public as $$
  declare
    v_caller text := nullif(auth.uid()::text, '');
    v_baseline_id text := 'forge_wsb_' || gen_random_uuid()::text;
    v_row forge_work_scope_baselines%rowtype;
  begin
    if v_caller is null or not has_workspace_access(p_owner_id) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
    perform set_config('forge_work.lifecycle_rpc', 'on', true);
    update forge_work_packages
    set scope_baseline_id = v_baseline_id, updated_by = v_caller, updated_at = now()
    where owner_id = p_owner_id and id = p_package_id and scope_baseline_id is null;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'already_frozen');
    end if;
    insert into forge_work_scope_baselines
      (owner_id, id, package_id, version, frozen_by, membership, membership_hash, supersedes_id)
    values
      (p_owner_id, v_baseline_id, p_package_id, 1, v_caller, p_membership, p_membership_hash, null)
    returning * into v_row;
    return jsonb_build_object('ok', true, 'baseline', row_to_json(v_row));
  end $$;
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
    v_new_baseline forge_work_scope_baselines%rowtype;
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
    update forge_work_packages
    set scope_baseline_id = v_new_id, updated_by = v_caller, updated_at = now()
    where owner_id = p_owner_id and id = v_change.package_id
      and scope_baseline_id = v_head.id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'conflict');
    end if;
    insert into forge_work_scope_baselines
      (owner_id, id, package_id, version, frozen_by, membership, membership_hash, supersedes_id)
    values
      (p_owner_id, v_new_id, v_change.package_id, v_new_version,
       v_caller, p_new_membership, p_membership_hash, v_head.id)
    returning * into v_new_baseline;
    update forge_work_scope_changes
    set status = 'approved', decided_by = v_caller, decided_at = now(),
        resulting_baseline_version = v_new_version
    where owner_id = p_owner_id and id = p_change_id
    returning * into v_change;
    return jsonb_build_object('ok', true, 'change', row_to_json(v_change),
      'baseline', row_to_json(v_new_baseline));
  end $$;
  revoke all on function forge_work_freeze_scope(text, text, jsonb, text) from public, anon, authenticated;
  grant execute on function forge_work_freeze_scope(text, text, jsonb, text) to authenticated, service_role;
  revoke all on function forge_work_decide_scope_change(text, text, boolean, jsonb, text) from public, anon, authenticated;
  grant execute on function forge_work_decide_scope_change(text, text, boolean, jsonb, text) to authenticated, service_role;
`;

const SEED_SQL = `
  -- The actor-stamp trigger on plan baselines needs an authenticated
  -- identity for the seeded plan row below.
  set app.test_uid = '${OWNER_A}';
  insert into forge_work_packages (owner_id, id, status, planned_start, planned_finish) values
    ('${OWNER_A}', 'pkg_freeze', 'draft', '2026-11-16', '2026-11-20'),
    ('${OWNER_A}', 'pkg_approve', 'draft', '2026-11-16', '2026-11-20'),
    ('${OWNER_A}', 'pkg_reject', 'draft', '2026-11-16', '2026-11-20'),
    ('${OWNER_A}', 'pkg_rollback', 'draft', '2026-11-16', '2026-11-20'),
    ('${OWNER_A}', 'pkg_bf_a', 'draft', '2026-11-10', '2026-11-30'),
    ('${OWNER_A}', 'pkg_bf_b', 'draft', '2026-11-10', '2026-11-30'),
    ('${OWNER_A}', 'pkg_bf_c', 'draft', '2026-11-10', '2026-11-30'),
    ('${OWNER_A}', 'pkg_rls', 'draft', '2026-11-16', '2026-11-20'),
    ('${OWNER_A}', 'pkg_bad', 'draft', '2026-11-16', '2026-11-20');
  insert into forge_work_steps (owner_id, id, work_package_id, sequence_no, planned_person_hours, retired_at) values
    ('${OWNER_A}', 'step_freeze_1', 'pkg_freeze', 1, 10.00, null),
    ('${OWNER_A}', 'step_freeze_retired', 'pkg_freeze', 2, 5.00, '2026-11-10T00:00:00Z'),
    ('${OWNER_A}', 'step_approve_1', 'pkg_approve', 1, 10.00, null),
    ('${OWNER_A}', 'step_reject_1', 'pkg_reject', 1, 10.00, null),
    ('${OWNER_A}', 'step_rollback_1', 'pkg_rollback', 1, 10.00, null),
    ('${OWNER_A}', 'step_bf_a_1', 'pkg_bf_a', 1, 15.50, null),
    ('${OWNER_A}', 'step_bf_a_2', 'pkg_bf_a', 2, 10.00, null),
    ('${OWNER_A}', 'step_bf_b_1', 'pkg_bf_b', 1, 8.00, null),
    ('${OWNER_A}', 'step_bf_c_1', 'pkg_bf_c', 1, 7.00, null),
    ('${OWNER_A}', 'step_bad_1', 'pkg_bad', 1, 10.00, null);
  insert into forge_work_control_estimates (owner_id, id, work_package_id, original_control_estimate_cents, current_estimate_cents, created_by, updated_by) values
    ('${OWNER_A}', 'est_freeze', 'pkg_freeze', 1000000, 1000000, '${OWNER_A}', '${OWNER_A}'),
    ('${OWNER_A}', 'est_approve', 'pkg_approve', 1000000, 1000000, '${OWNER_A}', '${OWNER_A}'),
    ('${OWNER_A}', 'est_reject', 'pkg_reject', 1000000, 1000000, '${OWNER_A}', '${OWNER_A}'),
    ('${OWNER_A}', 'est_rollback', 'pkg_rollback', 1000000, 1000000, '${OWNER_A}', '${OWNER_A}'),
    ('${OWNER_A}', 'est_bf_a', 'pkg_bf_a', 2500000, 2500000, '${OWNER_A}', '${OWNER_A}'),
    ('${OWNER_A}', 'est_bf_c', 'pkg_bf_c', 900000, 900000, '${OWNER_A}', '${OWNER_A}'),
    ('${OWNER_A}', 'est_bad', 'pkg_bad', 1000000, 1000000, '${OWNER_A}', '${OWNER_A}');
  -- Backfill fixtures: pkg_bf_a has scope v1+v2 (head v2, complete
  -- inputs -> plan v2 only); pkg_bf_b has scope v1 but no estimate
  -- (-> skipped); pkg_bf_c has scope v1 + a pre-existing plan v1
  -- (-> left untouched).
  insert into forge_work_scope_baselines (owner_id, id, package_id, version, frozen_by, frozen_at, membership, membership_hash, supersedes_id) values
    ('${OWNER_A}', 'wsb_bf_a1', 'pkg_bf_a', 1, '${OWNER_A}', '2026-11-15T00:00:00Z', '[]'::jsonb, 'h', null),
    ('${OWNER_A}', 'wsb_bf_a2', 'pkg_bf_a', 2, '${OWNER_A}', '2026-11-15T01:00:00Z', '[]'::jsonb, 'h', 'wsb_bf_a1'),
    ('${OWNER_A}', 'wsb_bf_b1', 'pkg_bf_b', 1, '${OWNER_A}', '2026-11-15T00:00:00Z', '[]'::jsonb, 'h', null),
    ('${OWNER_A}', 'wsb_bf_c1', 'pkg_bf_c', 1, '${OWNER_A}', '2026-11-15T00:00:00Z', '[]'::jsonb, 'h', null);
  alter table forge_work_package_baselines disable trigger forge_work_package_baselines_stamp_actor_trg;
  insert into forge_work_package_baselines (owner_id, id, package_id, version_number, baseline_kind, baseline_start, baseline_finish, baseline_hours, baseline_cost, frozen_by, frozen_at) values
    ('${OWNER_A}', 'wpb_bf_c1', 'pkg_bf_c', 1, 'schedule', '2026-11-10', '2026-11-30', 7.00, 9000.00, 'scheduler', '2026-11-15T00:00:00Z');
  alter table forge_work_package_baselines enable trigger forge_work_package_baselines_stamp_actor_trg;
  insert into workspace_members (owner_id, member_user_id, status, role)
    values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
`;

async function setupDb() {
  const db = new PGlite();
  await db.exec(PREREQ_SQL);
  await db.exec(SEED_SQL);
  await db.exec(loadMigrationSql(THIS_MIGRATION));
  return db;
}

// Pre-fix database: prereq + seed, bridge NOT applied (non-vacuity leg).
async function setupPrefixedDb() {
  const db = new PGlite();
  await db.exec(PREREQ_SQL);
  await db.exec(SEED_SQL);
  return db;
}

async function asRole(db, role, uid, sql) {
  await db.exec(`set role ${role}; set app.test_uid = '${uid}';`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec(`reset role;`);
  }
}

async function asUser(db, uid, sql) {
  return asRole(db, "authenticated", uid, sql);
}

function sqlStr(value) {
  return value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`;
}

async function freezeRpc(db, uid, packageId, membership = [{ key: "BUNDLE-01", quantity: 1 }]) {
  const { rows } = await asUser(db, uid, `
    select forge_work_freeze_scope('${OWNER_A}', '${packageId}',
      '${JSON.stringify(membership)}'::jsonb, 'fnv1a:x') as r;
  `);
  return rows[0].r;
}

async function decideRpc(db, uid, changeId, approve, membership = [{ key: "BUNDLE-02", quantity: 1 }]) {
  const { rows } = await asUser(db, uid, `
    select forge_work_decide_scope_change('${OWNER_A}', '${changeId}',
      ${approve}, '${JSON.stringify(membership)}'::jsonb, 'fnv1a:y') as r;
  `);
  return rows[0].r;
}

async function proposeChange(db, changeId, packageId, baselineVersion) {
  await db.exec(`
    insert into forge_work_scope_changes
      (owner_id, id, package_id, baseline_version, change_type, description,
       requested_by, requested_at, status)
    values ('${OWNER_A}', '${changeId}', '${packageId}', ${baselineVersion},
      'substitution', 'test change', '${OWNER_A}', now(), 'proposed');
  `);
}

async function scopeRows(db, packageId) {
  const { rows } = await db.query(`
    select id, version from forge_work_scope_baselines
    where owner_id = '${OWNER_A}' and package_id = '${packageId}' order by version;
  `);
  return rows;
}

async function planRows(db, packageId) {
  const { rows } = await db.query(`
    select id, version_number, baseline_kind, baseline_start, baseline_finish,
      baseline_hours, baseline_cost, frozen_by, frozen_at
    from forge_work_package_baselines
    where owner_id = '${OWNER_A}' and package_id = '${packageId}'
    order by baseline_kind, version_number;
  `);
  return rows;
}

// A scheduling freeze, as the shipped app performs it: a direct
// insert as the authenticated user, versioning max+1 over the
// SCHEDULE series only (workScheduling.freezeBaseline). The
// actor-stamp trigger overwrites frozen_by with the caller.
async function scheduleFreeze(db, uid, packageId, hours = 10, cost = 10000) {
  const { rows } = await asUser(db, uid, `
    insert into forge_work_package_baselines
      (owner_id, package_id, version_number, baseline_kind, baseline_start, baseline_finish,
       baseline_hours, baseline_cost, frozen_by)
    select '${OWNER_A}', '${packageId}',
      coalesce(max(version_number), 0) + 1, 'schedule',
      '2026-11-16', '2026-11-20', ${hours}, ${cost}, '${uid}'
    from forge_work_package_baselines
    where owner_id = '${OWNER_A}' and package_id = '${packageId}' and baseline_kind = 'schedule'
    returning *;
  `);
  return rows[0];
}

function asDate(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

async function packagePointer(db, packageId) {
  const { rows } = await db.query(`
    select scope_baseline_id from forge_work_packages
    where owner_id = '${OWNER_A}' and id = '${packageId}';
  `);
  return rows[0]?.scope_baseline_id ?? null;
}

describe("scope/plan baseline bridge: PGlite battery", () => {
  let db;
  beforeEach(async () => {
    db = await setupDb();
  }, 60000);

  it60("freeze inserts scope v1 + plan v1 in one transaction with identical version/actor/timestamp", async () => {
    const r = await freezeRpc(db, OWNER_A, "pkg_freeze");
    expect(r.ok).toBe(true);
    expect(r.baseline.version).toBe(1);
    expect(r.plan_baseline).toBeDefined();
    expect(r.plan_baseline.version_number).toBe(1);
    expect(r.plan_baseline.baseline_kind).toBe("scope");
    expect(Number(r.plan_baseline.baseline_hours)).toBe(10);
    expect(r.plan_baseline.baseline_start).toBe("2026-11-16");
    expect(r.plan_baseline.baseline_finish).toBe("2026-11-20");
    expect(Number(r.plan_baseline.baseline_cost)).toBe(10000);
    expect(r.plan_baseline.frozen_by).toBe(OWNER_A);
    expect(r.plan_baseline.frozen_at).toBe(r.baseline.frozen_at);
    expect(await packagePointer(db, "pkg_freeze")).toBe(r.baseline.id);
    // The retired 5.00 step is excluded: hours are 10, not 15.
    const plans = await planRows(db, "pkg_freeze");
    expect(plans).toHaveLength(1);
  });

  it60("freeze resolves the snapshot's baseline predicates (latest + exact named version)", async () => {
    await freezeRpc(db, OWNER_A, "pkg_freeze");
    const { rows: latest } = await db.query(`
      select version_number, baseline_hours from forge_work_package_baselines
      where owner_id = '${OWNER_A}' and package_id = 'pkg_freeze'
      order by version_number desc limit 1;
    `);
    expect(latest).toHaveLength(1);
    expect(Number(latest[0].baseline_hours)).toBe(10);
    const { rows: named } = await db.query(`
      select version_number from forge_work_package_baselines
      where owner_id = '${OWNER_A}' and package_id = 'pkg_freeze' and version_number = 1;
    `);
    expect(named).toHaveLength(1);
  });

  it60("backfill inserts only the latest scope head, migration-stamped", async () => {
    const plans = await planRows(db, "pkg_bf_a");
    expect(plans).toHaveLength(1);
    expect(plans[0].version_number).toBe(2);
    expect(plans[0].baseline_kind).toBe("scope");
    expect(Number(plans[0].baseline_hours)).toBe(25.5);
    expect(asDate(plans[0].baseline_start)).toBe("2026-11-10");
    expect(asDate(plans[0].baseline_finish)).toBe("2026-11-30");
    expect(Number(plans[0].baseline_cost)).toBe(25000);
    expect(plans[0].frozen_by).toBe("migration:20261116_planner_bust_baseline_hours");
    // No fabricated v1: the current plan cannot prove the v1 values.
    const { rows: v1 } = await db.query(`
      select 1 from forge_work_package_baselines
      where owner_id = '${OWNER_A}' and package_id = 'pkg_bf_a' and version_number = 1;
    `);
    expect(v1).toHaveLength(0);
  });

  it60("backfill skips incomplete packages and adds a scope row alongside a schedule-only row", async () => {
    expect(await planRows(db, "pkg_bf_b")).toHaveLength(0);
    const plans = await planRows(db, "pkg_bf_c");
    expect(plans).toHaveLength(2);
    const seeded = plans.find((p) => p.id === "wpb_bf_c1");
    expect(seeded).toBeDefined();
    expect(seeded.baseline_kind).toBe("schedule");
    expect(seeded.version_number).toBe(1);
    expect(seeded.frozen_by).toBe("scheduler");
    expect(Number(seeded.baseline_hours)).toBe(7);
    // The backfill inserts the SCOPE row at the same version: the
    // seeded schedule row does not count as present.
    const scopeRow = plans.find((p) => p.baseline_kind === "scope");
    expect(scopeRow).toBeDefined();
    expect(scopeRow.version_number).toBe(1);
    expect(Number(scopeRow.baseline_hours)).toBe(7);
    expect(Number(scopeRow.baseline_cost)).toBe(9000);
    expect(scopeRow.frozen_by).toBe("migration:20261116_planner_bust_baseline_hours");
  });

  it60("backfill is idempotent on re-apply of the whole migration", async () => {
    await db.exec(loadMigrationSql(THIS_MIGRATION));
    expect(await planRows(db, "pkg_bf_a")).toHaveLength(1);
    expect(await planRows(db, "pkg_bf_b")).toHaveLength(0);
    const plans = await planRows(db, "pkg_bf_c");
    expect(plans).toHaveLength(2);
    expect(plans.filter((p) => p.baseline_kind === "schedule")).toHaveLength(1);
    expect(plans.filter((p) => p.baseline_kind === "scope")).toHaveLength(1);
    expect(plans.find((p) => p.id === "wpb_bf_c1").frozen_by).toBe("scheduler");
  });

  it60("approve inserts scope v2 + plan v2 atomically, values captured at approval time", async () => {
    const f = await freezeRpc(db, OWNER_A, "pkg_approve");
    expect(f.ok).toBe(true);
    // Plan changes after freeze: approval must snapshot the CURRENT plan.
    await db.exec(`
      update forge_work_steps set planned_person_hours = 12.00
      where owner_id = '${OWNER_A}' and id = 'step_approve_1';
    `);
    await proposeChange(db, "chg_1", "pkg_approve", 1);
    const r = await decideRpc(db, OWNER_A, "chg_1", true);
    expect(r.ok).toBe(true);
    expect(r.change.status).toBe("approved");
    expect(r.change.resulting_baseline_version).toBe(2);
    expect(r.baseline.version).toBe(2);
    expect(r.plan_baseline.version_number).toBe(2);
    expect(r.plan_baseline.baseline_kind).toBe("scope");
    expect(Number(r.plan_baseline.baseline_hours)).toBe(12);
    expect(r.plan_baseline.frozen_at).toBe(r.baseline.frozen_at);
    expect(await packagePointer(db, "pkg_approve")).toBe(r.baseline.id);
    expect(await planRows(db, "pkg_approve")).toHaveLength(2);
  });

  it60("reject creates no plan baseline and needs no plan inputs", async () => {
    const f = await freezeRpc(db, OWNER_A, "pkg_reject");
    expect(f.ok).toBe(true);
    // Break the plan inputs after freeze: rejection must still succeed.
    await db.exec(`
      update forge_work_control_estimates set retired_at = now()
      where owner_id = '${OWNER_A}' and id = 'est_reject';
    `);
    await proposeChange(db, "chg_2", "pkg_reject", 1);
    const r = await decideRpc(db, OWNER_A, "chg_2", false);
    expect(r.ok).toBe(true);
    expect(r.change.status).toBe("rejected");
    expect(await planRows(db, "pkg_reject")).toHaveLength(1);
    expect(await scopeRows(db, "pkg_reject")).toHaveLength(1);
  });

  it60("approve with broken plan inputs fails closed and the change stays proposed", async () => {
    await freezeRpc(db, OWNER_A, "pkg_approve");
    await db.exec(`
      update forge_work_control_estimates set retired_at = now()
      where owner_id = '${OWNER_A}' and id = 'est_approve';
    `);
    await proposeChange(db, "chg_3", "pkg_approve", 1);
    const r = await decideRpc(db, OWNER_A, "chg_3", true);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("plan_estimate_missing");
    const { rows } = await db.query(`
      select status from forge_work_scope_changes
      where owner_id = '${OWNER_A}' and id = 'chg_3';
    `);
    expect(rows[0].status).toBe("proposed");
    expect(await planRows(db, "pkg_approve")).toHaveLength(1);
    expect(await scopeRows(db, "pkg_approve")).toHaveLength(1);
  });

  it.each([
    ["no active steps", `delete from forge_work_steps where owner_id = '${OWNER_A}' and work_package_id = 'pkg_bad'`, "plan_no_active_steps"],
    ["null step hours", `update forge_work_steps set planned_person_hours = null where owner_id = '${OWNER_A}' and id = 'step_bad_1'`, "plan_step_hours_missing"],
    ["negative step hours", `update forge_work_steps set planned_person_hours = -1 where owner_id = '${OWNER_A}' and id = 'step_bad_1'`, "plan_step_hours_missing"],
    ["missing dates", `update forge_work_packages set planned_start = null, planned_finish = null where owner_id = '${OWNER_A}' and id = 'pkg_bad'`, "plan_dates_missing"],
    ["reversed dates", `update forge_work_packages set planned_start = '2026-11-20', planned_finish = '2026-11-16' where owner_id = '${OWNER_A}' and id = 'pkg_bad'`, "plan_dates_reversed"],
    ["missing estimate", `update forge_work_control_estimates set retired_at = now() where owner_id = '${OWNER_A}' and id = 'est_bad'`, "plan_estimate_missing"],
    ["negative estimate", `update forge_work_control_estimates set current_estimate_cents = -5 where owner_id = '${OWNER_A}' and id = 'est_bad'`, "plan_estimate_negative"],
  ])("freeze fails closed on %s with %s and writes nothing", async (_label, mutateSql, code) => {
    await db.exec(mutateSql);
    const r = await freezeRpc(db, OWNER_A, "pkg_bad");
    expect(r.ok).toBe(false);
    expect(r.error).toBe(code);
    expect(await scopeRows(db, "pkg_bad")).toHaveLength(0);
    expect(await planRows(db, "pkg_bad")).toHaveLength(0);
    expect(await packagePointer(db, "pkg_bad")).toBe(null);
  });

  it60("freeze fails closed on an ambiguous active estimate", async () => {
    await db.exec(`
      insert into forge_work_control_estimates
        (owner_id, id, work_package_id, original_control_estimate_cents,
         current_estimate_cents, created_by, updated_by)
      values ('${OWNER_A}', 'est_bad_2', 'pkg_bad', 500000, 500000, '${OWNER_A}', '${OWNER_A}');
    `);
    const r = await freezeRpc(db, OWNER_A, "pkg_bad");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("plan_estimate_ambiguous");
    expect(await scopeRows(db, "pkg_bad")).toHaveLength(0);
    expect(await planRows(db, "pkg_bad")).toHaveLength(0);
  });

  it60("a schedule-only v1 no longer blocks the initial scope freeze (fix round 1)", async () => {
    // A scheduling-created plan row already sits at v1 (kind
    // 'schedule'): the paired scope insert is a different series,
    // so the freeze succeeds and both v1 rows coexist.
    const sched = await scheduleFreeze(db, OWNER_A, "pkg_rollback");
    expect(sched.version_number).toBe(1);
    expect(sched.baseline_kind).toBe("schedule");
    const r = await freezeRpc(db, OWNER_A, "pkg_rollback");
    expect(r.ok).toBe(true);
    expect(r.baseline.version).toBe(1);
    expect(r.plan_baseline.version_number).toBe(1);
    expect(r.plan_baseline.baseline_kind).toBe("scope");
    expect(await scopeRows(db, "pkg_rollback")).toHaveLength(1);
    const plans = await planRows(db, "pkg_rollback");
    expect(plans).toHaveLength(2);
    expect(plans.map((p) => `${p.baseline_kind}:${p.version_number}`).sort()).toEqual(["schedule:1", "scope:1"]);
    expect(await packagePointer(db, "pkg_rollback")).toBe(r.baseline.id);
  });

  it60("a scope-kind v1 collision still rolls the scope baseline and pointer back", async () => {
    // A scope-paired plan row already sits at v1: the paired plan
    // insert collides on (owner, package, 'scope', 1), so the whole
    // freeze transaction must roll back — no orphan scope row, no
    // pointer advance.
    await asUser(db, OWNER_A, `
      insert into forge_work_package_baselines
        (owner_id, package_id, version_number, baseline_kind, baseline_start, baseline_finish,
         baseline_hours, baseline_cost, frozen_by)
      values ('${OWNER_A}', 'pkg_rollback', 1, 'scope', '2026-11-16', '2026-11-20', 10.00, 10000.00, '${OWNER_A}');
    `);
    await expect(freezeRpc(db, OWNER_A, "pkg_rollback")).rejects.toThrow(/duplicate key|unique/i);
    expect(await scopeRows(db, "pkg_rollback")).toHaveLength(0);
    expect(await planRows(db, "pkg_rollback")).toHaveLength(1);
    expect(await packagePointer(db, "pkg_rollback")).toBe(null);
  });

  it60("second freeze returns already_frozen and writes no duplicate plan row", async () => {
    expect((await freezeRpc(db, OWNER_A, "pkg_freeze")).ok).toBe(true);
    const r = await freezeRpc(db, OWNER_A, "pkg_freeze");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("already_frozen");
    expect(await planRows(db, "pkg_freeze")).toHaveLength(1);
  });

  it60("backfill preflight fails closed on a scope-kind version collision", async () => {
    const collision = new PGlite();
    try {
      await collision.exec(PREREQ_SQL);
      await collision.exec(SEED_SQL);
      await collision.exec(`set app.test_uid = '${OWNER_A}';`);
      await collision.exec(`
        insert into forge_work_package_baselines
          (owner_id, package_id, version_number, baseline_kind, baseline_start, baseline_finish,
           baseline_hours, baseline_cost, frozen_by)
        values ('${OWNER_A}', 'pkg_bf_a', 9, 'scope', '2026-11-10', '2026-11-30', 1.00, 1.00, '${OWNER_A}');
      `);
      await expect(collision.exec(loadMigrationSql(THIS_MIGRATION))).rejects.toThrow(/version collision/i);
    } finally {
      await collision.close();
    }
  });

  it60("backfill preflight passes a schedule-only orphan at the same version (fix round 1)", async () => {
    const db2 = new PGlite();
    try {
      await db2.exec(PREREQ_SQL);
      await db2.exec(SEED_SQL);
      await db2.exec(`set app.test_uid = '${OWNER_A}';`);
      // A schedule-only row at v9 has no scope version 9 and is
      // ahead of the scope head — legitimate by design, not a
      // collision: the migration must apply and backfill normally.
      await db2.exec(`
        insert into forge_work_package_baselines
          (owner_id, package_id, version_number, baseline_kind, baseline_start, baseline_finish,
           baseline_hours, baseline_cost, frozen_by)
        values ('${OWNER_A}', 'pkg_bf_a', 9, 'schedule', '2026-11-10', '2026-11-30', 1.00, 1.00, '${OWNER_A}');
      `);
      await db2.exec(loadMigrationSql(THIS_MIGRATION));
      const plans = await planRows(db2, "pkg_bf_a");
      expect(plans.map((p) => `${p.baseline_kind}:${p.version_number}`).sort()).toEqual(["schedule:9", "scope:2"]);
    } finally {
      await db2.close();
    }
  });

  it60("function grants: RPCs execute for authenticated + service_role only; helper has no grant", async () => {
    const { rows } = await db.query(`
      select proname, proacl::text as acl from pg_proc
      where proname in ('forge_work_freeze_scope', 'forge_work_decide_scope_change',
        'forge_work_plan_baseline_inputs');
    `);
    const byName = Object.fromEntries(rows.map((r) => [r.proname, r.acl ?? ""]));
    for (const fn of ["forge_work_freeze_scope", "forge_work_decide_scope_change"]) {
      expect(byName[fn]).toContain("authenticated");
      expect(byName[fn]).toContain("service_role");
      expect(byName[fn]).not.toContain("anon");
    }
    expect(byName["forge_work_plan_baseline_inputs"] ?? "").not.toContain("authenticated");
    expect(byName["forge_work_plan_baseline_inputs"] ?? "").not.toContain("anon");
    // Behavioral: anon cannot execute either RPC; the helper denies
    // even an authenticated caller.
    await expect(asRole(db, "anon", ANON_UID,
      `select forge_work_freeze_scope('${OWNER_A}', 'pkg_freeze', '[]'::jsonb, 'h');`))
      .rejects.toThrow(/permission denied/i);
    await expect(asUser(db, OWNER_A,
      `select forge_work_plan_baseline_inputs('${OWNER_A}', 'pkg_freeze');`))
      .rejects.toThrow(/permission denied/i);
  });

  it60("RLS/immutability: anon and foreign workspaces cannot write; UPDATE/DELETE refused for every role", async () => {
    // Anon and a foreign owner see nothing and cannot insert.
    const anonRows = await asRole(db, "anon", ANON_UID,
      `select id from forge_work_package_baselines where owner_id = '${OWNER_A}';`);
    expect(anonRows.rows).toHaveLength(0);
    await expect(asRole(db, "anon", ANON_UID, `
      insert into forge_work_package_baselines
        (owner_id, package_id, version_number, baseline_start, baseline_finish,
         baseline_hours, baseline_cost, frozen_by)
      values ('${OWNER_A}', 'pkg_rls', 1, '2026-11-16', '2026-11-20', 1.00, 1.00, '${ANON_UID}');
    `)).rejects.toThrow(/row-level security|permission denied/i);
    await expect(asUser(db, OWNER_B, `
      insert into forge_work_package_baselines
        (owner_id, package_id, version_number, baseline_start, baseline_finish,
         baseline_hours, baseline_cost, frozen_by)
      values ('${OWNER_A}', 'pkg_rls', 1, '2026-11-16', '2026-11-20', 1.00, 1.00, '${OWNER_B}');
    `)).rejects.toThrow(/row-level security|permission denied/i);
    // The preserved scheduling path: the owning workspace CAN insert
    // directly (see the header note) — UPDATE/DELETE stay refused.
    await asUser(db, OWNER_A, `
      insert into forge_work_package_baselines
        (owner_id, id, package_id, version_number, baseline_start, baseline_finish,
         baseline_hours, baseline_cost, frozen_by)
      values ('${OWNER_A}', 'wpb_rls_1', 'pkg_rls', 1, '2026-11-16', '2026-11-20', 1.00, 1.00, '${OWNER_A}');
    `);
    await expect(asUser(db, OWNER_A, `
      update forge_work_package_baselines set baseline_hours = 2.00
      where owner_id = '${OWNER_A}' and id = 'wpb_rls_1';
    `)).rejects.toThrow(/immutable/i);
    await expect(db.query(`
      delete from forge_work_package_baselines
      where owner_id = '${OWNER_A}' and id = 'wpb_rls_1';
    `)).rejects.toThrow(/immutable/i);
  });
});

describe("scope/plan baseline bridge: schedule/scope writer reconciliation (fix round 1)", () => {
  let db;
  beforeEach(async () => {
    db = await setupDb();
  }, 60000);

  it60("schedule v1 before the initial scope freeze, then approval: no collision at any step", async () => {
    // Sequence 1: scheduling freezes first.
    const sched = await scheduleFreeze(db, OWNER_A, "pkg_approve", 10, 10000);
    expect(sched.version_number).toBe(1);
    expect(sched.baseline_kind).toBe("schedule");
    // The initial scope freeze pairs scope v1 with a SCOPE plan v1
    // alongside the schedule v1 — same version, different series.
    const f = await freezeRpc(db, OWNER_A, "pkg_approve");
    expect(f.ok).toBe(true);
    expect(f.plan_baseline.baseline_kind).toBe("scope");
    let plans = await planRows(db, "pkg_approve");
    expect(plans.map((p) => `${p.baseline_kind}:${p.version_number}`).sort()).toEqual(["schedule:1", "scope:1"]);
    // Sequence 3 (after sequence 1): approving the scope change
    // inserts scope v2 + scope plan v2; the schedule v1 is untouched.
    await proposeChange(db, "chg_seq1", "pkg_approve", 1);
    const r = await decideRpc(db, OWNER_A, "chg_seq1", true);
    expect(r.ok).toBe(true);
    expect(r.plan_baseline.version_number).toBe(2);
    expect(r.plan_baseline.baseline_kind).toBe("scope");
    plans = await planRows(db, "pkg_approve");
    expect(plans.map((p) => `${p.baseline_kind}:${p.version_number}`).sort()).toEqual(["schedule:1", "scope:1", "scope:2"]);
    expect(await scopeRows(db, "pkg_approve")).toHaveLength(2);
  });

  it60("schedule baseline after a paired scope/plan v1, then approval: series stay independent", async () => {
    // Sequence 2: the paired freeze first.
    const f = await freezeRpc(db, OWNER_A, "pkg_freeze");
    expect(f.ok).toBe(true);
    // A scheduling freeze afterwards versions in the schedule
    // series — it reads only kind='schedule' rows, so it mints
    // schedule v1 even though a scope v1 already exists.
    const sched = await scheduleFreeze(db, OWNER_A, "pkg_freeze", 12, 12000);
    expect(sched.version_number).toBe(1);
    expect(sched.baseline_kind).toBe("schedule");
    // A second scheduling freeze advances the schedule series only.
    const sched2 = await scheduleFreeze(db, OWNER_A, "pkg_freeze", 14, 14000);
    expect(sched2.version_number).toBe(2);
    // Sequence 3 (after sequence 2): the scope-change approval
    // inserts scope v2 + scope plan v2 without colliding with the
    // schedule v2 at the same version.
    await proposeChange(db, "chg_seq2", "pkg_freeze", 1);
    const r = await decideRpc(db, OWNER_A, "chg_seq2", true);
    expect(r.ok).toBe(true);
    expect(r.plan_baseline.version_number).toBe(2);
    expect(r.plan_baseline.baseline_kind).toBe("scope");
    const plans = await planRows(db, "pkg_freeze");
    expect(plans.map((p) => `${p.baseline_kind}:${p.version_number}`).sort())
      .toEqual(["schedule:1", "schedule:2", "scope:1", "scope:2"]);
  });

  it60("the migration's kind column + constraint swap apply from the legacy table shape", async () => {
    // A database whose baselines table predates the split: no kind
    // column, old per-package unique (already in the fixture — see
    // the baselines stub). The bridge migration itself must perform
    // the ALTERs — they are not pre-applied here.
    const legacy = new PGlite();
    try {
      await legacy.exec(PREREQ_SQL);
      await legacy.exec(SEED_SQL);
      await legacy.exec(`
        alter table forge_work_package_baselines
          drop constraint forge_work_package_baselines_kind_version_unique;
        alter table forge_work_package_baselines drop column baseline_kind;
      `);
      await legacy.exec(loadMigrationSql(THIS_MIGRATION));
      // The column exists with default 'schedule': the pre-existing
      // seeded row was backfilled to the schedule kind.
      const { rows: kindRows } = await legacy.query(`
        select column_name, column_default, is_nullable
        from information_schema.columns
        where table_schema = 'public' and table_name = 'forge_work_package_baselines'
          and column_name = 'baseline_kind';
      `);
      expect(kindRows).toHaveLength(1);
      expect(kindRows[0].column_default).toContain("schedule");
      const { rows: cons } = await legacy.query(`
        select conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'public.forge_work_package_baselines'::regclass
          and contype = 'u';
      `);
      expect(cons.map((c) => c.conname)).toEqual(["forge_work_package_baselines_kind_version_unique"]);
      expect(cons[0].def).toContain("(owner_id, package_id, baseline_kind, version_number)");
      const seeded = await planRows(legacy, "pkg_bf_c");
      expect(seeded.find((p) => p.id === "wpb_bf_c1").baseline_kind).toBe("schedule");
      // And the split works end to end on the migrated table: the
      // scope freeze pairs a scope v1 beside the schedule v1.
      const f = await freezeRpc(legacy, OWNER_A, "pkg_freeze");
      expect(f.ok).toBe(true);
      const sched = await scheduleFreeze(legacy, OWNER_A, "pkg_freeze");
      expect(sched.version_number).toBe(1);
      expect(sched.baseline_kind).toBe("schedule");
      const plans = await planRows(legacy, "pkg_freeze");
      expect(plans.map((p) => `${p.baseline_kind}:${p.version_number}`).sort()).toEqual(["schedule:1", "scope:1"]);
    } finally {
      await legacy.close();
    }
  });

  it60("constraint swap moves BOTH baseline FKs to the per-kind unique (fix round 3)", async () => {
    // Regression for the rehearsal miss (Nov 16): the shipped
    // migration dropped the placements FK but not the progress-
    // snapshots FK, so the old-unique drop failed. The fixture now
    // carries both FKs on the old unique, so this test fails if
    // either move is ever dropped from the migration.
    const { rows: fks } = await db.query(`
      select conrelid::regclass::text as tbl, conname,
        pg_get_constraintdef(oid) as def
      from pg_constraint
      where confrelid = 'public.forge_work_package_baselines'::regclass
        and contype = 'f'
      order by tbl;
    `);
    expect(fks.map((r) => r.tbl)).toEqual([
      "forge_work_progress_snapshots",
      "forge_work_step_curve_placements",
    ]);
    for (const fk of fks) {
      expect(fk.def).toContain("(owner_id, package_id, baseline_kind, version_number)");
    }
    expect(fks.find((r) => r.tbl === "forge_work_progress_snapshots").conname)
      .toBe("forge_work_progress_snapshots_baseline_fk");
    expect(fks.find((r) => r.tbl === "forge_work_step_curve_placements").conname)
      .toBe("forge_work_step_curve_placements_baseline_fk");
    expect(fks.find((r) => r.tbl === "forge_work_progress_snapshots").def)
      .toContain("baseline_version");
    // The old unique is gone; only the per-kind unique remains.
    const { rows: cons } = await db.query(`
      select conname from pg_constraint
      where conrelid = 'public.forge_work_package_baselines'::regclass
        and contype = 'u';
    `);
    expect(cons.map((c) => c.conname)).toEqual(["forge_work_package_baselines_kind_version_unique"]);
    // Schedule-only checks are stamped on both dependent tables.
    const { rows: checks } = await db.query(`
      select conrelid::regclass::text as tbl, conname from pg_constraint
      where conname in (
        'forge_work_progress_snapshots_kind_schedule_check',
        'forge_work_step_curve_placements_kind_schedule_check')
      order by tbl;
    `);
    expect(checks.map((c) => `${c.tbl}:${c.conname}`)).toEqual([
      "forge_work_progress_snapshots:forge_work_progress_snapshots_kind_schedule_check",
      "forge_work_step_curve_placements:forge_work_step_curve_placements_kind_schedule_check",
    ]);
  });
});

describe("scope/plan baseline bridge: non-vacuity (pre-fix vs bridge)", () => {
  it60("pre-fix freeze is scope-only; the bridge makes the next freeze produce the pair", async () => {
    const pre = await setupPrefixedDb();
    try {
      const r = await freezeRpc(pre, OWNER_A, "pkg_freeze");
      expect(r.ok).toBe(true);
      expect(r.plan_baseline).toBeUndefined();
      expect(await planRows(pre, "pkg_freeze")).toHaveLength(0);
      expect(await scopeRows(pre, "pkg_freeze")).toHaveLength(1);
      // Apply the bridge to the SAME database: backfill covers the
      // already-frozen pkg_bf_a, and the next freeze pairs the rows.
      await pre.exec(loadMigrationSql(THIS_MIGRATION));
      const backfilled = await planRows(pre, "pkg_bf_a");
      expect(backfilled).toHaveLength(1);
      expect(backfilled[0].version_number).toBe(2);
      expect(backfilled[0].baseline_kind).toBe("scope");
      const r2 = await freezeRpc(pre, OWNER_A, "pkg_approve");
      expect(r2.ok).toBe(true);
      expect(r2.plan_baseline.version_number).toBe(1);
      expect(Number(r2.plan_baseline.baseline_hours)).toBe(10);
    } finally {
      await pre.close();
    }
  }, 60000);
});

// Real-PostgreSQL subset. PGlite is single-connection, so the
// concurrent-edit serialization legs can only run here, against a
// scratch PG16 cluster. The suite is gated on the binaries existing
// AND an unprivileged user to run the cluster as (initdb refuses
// root, and this VM's agent runs as root) — and SKIPS LOUDLY, never
// silently, when either is missing.
const PG_BIN = "/usr/lib/postgresql/16/bin";
function detectRealPgUser() {
  try {
    execSync(`ls ${PG_BIN}/initdb ${PG_BIN}/pg_ctl`, { stdio: "ignore" });
    execSync("which runuser", { stdio: "ignore" });
  } catch {
    return null;
  }
  for (const user of ["postgres", "nobody"]) {
    try {
      execSync(`id ${user}`, { stdio: "ignore" });
      return user;
    } catch { /* try the next user */ }
  }
  return null;
}
const PG_RUN_USER = detectRealPgUser();
const HAS_REAL_PG = PG_RUN_USER !== null;
if (!HAS_REAL_PG) {
  console.warn(
    "⚠️ LOUD SKIP: real-PostgreSQL subset SKIPPED — PG16 binaries or an unprivileged "
    + "user to run them as (initdb refuses root) were not found. "
    + "The PGlite battery still runs; run the real-PG leg where PG16 exists.",
  );
}

describe.skipIf(!HAS_REAL_PG)("scope/plan baseline bridge: real-PostgreSQL subset", () => {
  let pgDir;
  let pgClient;
  let pgCfg;

  beforeAll(async () => {
    pgDir = mkdtempSync(join(tmpdir(), "wpb-bridge-realpg-"));
    execSync(`chown ${PG_RUN_USER}:${PG_RUN_USER} "${pgDir}"`, { stdio: "pipe" });
    const asPgUser = (cmd) => `runuser -u ${PG_RUN_USER} -- ${cmd}`;
    execSync(asPgUser(`"${PG_BIN}/initdb" -D "${pgDir}" -U postgres --auth=trust`), { stdio: "pipe" });
    execSync(
      asPgUser(`"${PG_BIN}/pg_ctl" -D "${pgDir}" -o "-p 55435 -k ${pgDir} -c listen_addresses=''" -l "${pgDir}/server.log" start`),
      { stdio: "pipe" },
    );
    pgCfg = { host: pgDir, port: 55435, user: "postgres", database: "postgres" };
    pgClient = new Client(pgCfg);
    await pgClient.connect();
    await pgClient.query(PREREQ_SQL);
    await pgClient.query(SEED_SQL);
    await pgClient.query(loadMigrationSql(THIS_MIGRATION));
  }, 120000);

  afterAll(async () => {
    try { await pgClient?.end(); } catch { /* already closed */ }
    if (pgDir) {
      try { execSync(`runuser -u ${PG_RUN_USER} -- "${PG_BIN}/pg_ctl" -D "${pgDir}" stop -m fast`, { stdio: "pipe" }); } catch { /* already stopped */ }
      rmSync(pgDir, { recursive: true, force: true });
    }
  }, 120000);

  async function pgAsUser(uid, sql) {
    const client = new Client(pgCfg);
    await client.connect();
    try {
      await client.query(`set role authenticated; set app.test_uid = '${uid}';`);
      return await client.query(sql);
    } finally {
      await client.end();
    }
  }

  async function pgFreeze(uid, packageId) {
    const { rows } = await pgAsUser(uid, `
      select forge_work_freeze_scope('${OWNER_A}', '${packageId}',
        '[{"key":"BUNDLE-01","quantity":1}]'::jsonb, 'fnv1a:x') as r;
    `);
    return rows[0].r;
  }

  it60("concurrent freezes serialize: one pair, one already_frozen", async () => {
    const [a, b] = await Promise.all([
      pgFreeze(OWNER_A, "pkg_freeze"),
      pgFreeze(OWNER_A, "pkg_freeze"),
    ]);
    const oks = [a, b].filter((r) => r.ok === true);
    const frozen = [a, b].filter((r) => r.error === "already_frozen");
    expect(oks).toHaveLength(1);
    expect(frozen).toHaveLength(1);
    const scopes = await scopeRows({ query: (s) => pgClient.query(s) }, "pkg_freeze");
    expect(scopes).toHaveLength(1);
    const plans = await planRows({ query: (s) => pgClient.query(s) }, "pkg_freeze");
    expect(plans).toHaveLength(1);
    expect(plans[0].version_number).toBe(1);
  });

  it60("concurrent approvals serialize: one v2 pair, one conflict", async () => {
    const f = await pgFreeze(OWNER_A, "pkg_approve");
    expect(f.ok).toBe(true);
    await pgClient.query(`
      insert into forge_work_scope_changes
        (owner_id, id, package_id, baseline_version, change_type, description,
         requested_by, requested_at, status)
      values
        ('${OWNER_A}', 'chg_r1', 'pkg_approve', 1, 'substitution', 'race one', '${OWNER_A}', now(), 'proposed'),
        ('${OWNER_A}', 'chg_r2', 'pkg_approve', 1, 'substitution', 'race two', '${OWNER_A}', now(), 'proposed');
    `);
    async function approve(changeId) {
      const { rows } = await pgAsUser(OWNER_A, `
        select forge_work_decide_scope_change('${OWNER_A}', '${changeId}',
          true, '[{"key":"BUNDLE-02","quantity":1}]'::jsonb, 'fnv1a:y') as r;
      `);
      return rows[0].r;
    }
    const [a, b] = await Promise.all([approve("chg_r1"), approve("chg_r2")]);
    const oks = [a, b].filter((r) => r.ok === true);
    const losers = [a, b].filter((r) => r.ok === false);
    expect(oks).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(["conflict", "baseline_moved", "already_decided"]).toContain(losers[0].error);
    const scopes = await scopeRows({ query: (s) => pgClient.query(s) }, "pkg_approve");
    expect(scopes).toHaveLength(2);
    const plans = await planRows({ query: (s) => pgClient.query(s) }, "pkg_approve");
    expect(plans).toHaveLength(2);
    expect(plans.map((p) => p.version_number)).toEqual([1, 2]);
  });

  // Fix round 4 (ChatGPT NEEDS CHANGES, PR #817 review 2026-11-16):
  // the rung-4 snapshot calculation-integrity trigger resolved its
  // baseline by version number alone. After the bridge, scope v1 and
  // schedule v1 are different baselines at the same version, so the
  // trigger must resolve the schedule series — the same series the
  // FK and the bust snapshot's progress_baseline CTE resolve. This
  // test runs against the ACTUAL rung-4 snapshot schema and
  // forge_work_snapshots_verify_trg (installed verbatim in
  // PREREQ_SQL, replaced by the bridge in beforeAll), with both
  // series present at deliberately different hours/cost/dates.
  it60("snapshot verify trigger resolves the schedule series, not scope, at the same version (fix round 4)", async () => {
    // Self-check: the bridge must have replaced the trigger function
    // with the kind-scoped version — otherwise this test would prove
    // nothing about the fix.
    const { rows: fnRows } = await pgClient.query(
      "select prosrc from pg_proc where proname = 'forge_work_snapshots_verify'",
    );
    expect(fnRows).toHaveLength(1);
    expect(fnRows[0].prosrc).toContain("baseline_kind = NEW.baseline_kind");

    // Seed one package with BOTH series at v1 (deliberately
    // different hours/cost/dates) plus a schedule v2 while the scope
    // series stays at v1. The stamp trigger is disabled for the
    // direct baseline inserts, as in SEED_SQL.
    await pgClient.query(`
      insert into forge_work_packages (owner_id, id, status, planned_start, planned_finish)
        values ('${OWNER_A}', 'pkg_snap', 'draft', '2026-11-16', '2026-11-25');
      alter table forge_work_package_baselines disable trigger forge_work_package_baselines_stamp_actor_trg;
      insert into forge_work_package_baselines
        (owner_id, id, package_id, version_number, baseline_kind, baseline_start, baseline_finish,
         baseline_hours, baseline_cost, frozen_by, frozen_at) values
        ('${OWNER_A}', 'wpb_snap_scope1', 'pkg_snap', 1, 'scope', '2026-11-01', '2026-11-30', 100.00, 50000.00, '${OWNER_A}', '2026-11-15T00:00:00Z'),
        ('${OWNER_A}', 'wpb_snap_sched1', 'pkg_snap', 1, 'schedule', '2026-11-16', '2026-11-20', 10.00, 10000.00, '${OWNER_A}', '2026-11-15T00:00:00Z'),
        ('${OWNER_A}', 'wpb_snap_sched2', 'pkg_snap', 2, 'schedule', '2026-11-16', '2026-11-25', 20.00, 20000.00, '${OWNER_A}', '2026-11-15T00:00:00Z');
      alter table forge_work_package_baselines enable trigger forge_work_package_baselines_stamp_actor_trg;
    `);

    async function insertSnapshot(values) {
      return pgClient.query(`
        insert into forge_work_progress_snapshots
          (owner_id, package_id, status_date, planned_pct, actual_pct, earned_pct,
           earned_hours, earned_cost, actual_hours, actual_cost,
           etc_hours, etc_cost, eac_hours, eac_cost, baseline_version, recorded_by)
        values ${values} returning id;
      `);
    }

    // (a) A correctly computed schedule-v1 snapshot inserts: 50% of
    // the 10-hour / $10,000 schedule baseline at status 2026-11-18
    // (planned 50% of the 4-day schedule window).
    const ok = await insertSnapshot(`('${OWNER_A}', 'pkg_snap', '2026-11-18',
      50.0000, 50.0000, 50.0000, 5.00, 5000.00, 5.00, 5000.00,
      5.00, 5000.00, 10.00, 10000.00, 1, 'test')`);
    expect(ok.rows).toHaveLength(1);

    // (b) A fabricated row computed against the SCOPE v1 baseline
    // (100 hrs / $50,000, Nov 1–30: planned 62.0690% at 2026-11-19,
    // earned 50 hrs / $25,000) is REJECTED: the trigger must validate
    // against schedule v1 (10 hrs), not scope v1. Under the old
    // version-only lookup this row could insert whenever the SELECT
    // INTO happened to land on the scope row.
    await expect(insertSnapshot(`('${OWNER_A}', 'pkg_snap', '2026-11-19',
      62.0690, 50.0000, 50.0000, 50.00, 25000.00, 50.00, 25000.00,
      50.00, 25000.00, 100.00, 50000.00, 1, 'test')`)).rejects.toThrow(
      /earned_hours .* inconsistent/,
    );

    // (c) A later schedule-v2 snapshot still resolves schedule v2
    // even though the scope series is at v1: 25% of the 20-hour /
    // $20,000 schedule v2 at status 2026-11-21 (planned 55.5556% of
    // the 9-day v2 window). If the trigger resolved scope v1, the
    // planned_pct (68.9655%) and earned values would not match.
    const v2 = await insertSnapshot(`('${OWNER_A}', 'pkg_snap', '2026-11-21',
      55.5556, 25.0000, 25.0000, 5.00, 5000.00, 5.00, 5000.00,
      15.00, 15000.00, 20.00, 20000.00, 2, 'test')`);
    expect(v2.rows).toHaveLength(1);

    // Exactly the two valid snapshots are on file; the fabricated
    // row left nothing behind.
    const { rows: snaps } = await pgClient.query(`
      select status_date, baseline_version from forge_work_progress_snapshots
      where owner_id = '${OWNER_A}' and package_id = 'pkg_snap'
      order by status_date;
    `);
    expect(snaps.map((r) => [r.status_date.toISOString().slice(0, 10), r.baseline_version])).toEqual([
      ["2026-11-18", 1],
      ["2026-11-21", 2],
    ]);
  });
});
