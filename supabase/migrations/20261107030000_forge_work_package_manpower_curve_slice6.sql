-- =============================================================================
-- Work Package Planner — Slice 6: Manpower curve (reconciled scope)
-- =============================================================================
-- FILE ONLY. DO NOT APPLY without Jason's separate word. A production
-- migration apply needs his explicit authorization; this file ships the
-- change, nothing more.
--
-- Reconciled scope (results/chatgpt/work-package-planner-slice6-scope-
-- 2026-11-07.md, revision 90e7aad3): the outage window is the package's
-- already-live immutable baseline (forge_work_package_baselines) — Slice 6
-- adds NO second outage setting, NO standard-hours divisor, and NO
-- persisted "required people" equivalent. Person-hours are the
-- authoritative unit. The curve is derived on read from the active step
-- plan, with craft-assignment staffing as an overlay.
--
-- What this slice adds (derived view only — nothing here stores a curve):
--   * forge_work_step_curve_placements — one explicit start-day placement
--     per active step AND baseline version (start_day_index 1..N, unique
--     per owner/package/step/baseline_version), versioned, with an
--     immutable revision audit table. A placement only changes WHICH
--     outage days receive a step's hours; it never changes hours, craft,
--     or duration. A re-baseline never inherits old placements: they stay
--     readable against their named baseline and never apply to the new one.
--   * forge_work_step_curve_placement_revisions — immutable old/new
--     snapshots, action, actor, reason, version and timestamp.
--   * forge_work_manpower_curve_snapshot — SECURITY INVOKER, STABLE read
--     RPC. ONE statement (one snapshot) returns the named/current
--     baseline, the active steps, the active placements for that baseline
--     version, and the active assignments, plus per-source generation
--     markers. Because the whole read is a single statement, a step edit,
--     placement move, retirement, or assignment edit can never produce a
--     mixed-revision curve — no retry loop, no STALE_SNAPSHOT.
--   * forge_work_manpower_curve_placement_set / placement_clear —
--     SECURITY DEFINER RPCs (actor from auth.uid(), no caller-supplied
--     actor), optimistic expected_version, terminal-package guards, and a
--     reject-by-default placement-outside-window rule. Placement writes
--     name the exact baseline version and refuse stale/rebased input.
--
-- What is NOT stored, by design: no materialized curve table, no daily
-- demand table, no per-craft duplicated totals, no outage-settings table,
-- no standard-hours rule. The curve is recomputed on GET from the single
-- snapshot (see src/domains/work-management/manpowerCurve.js and
-- src/application/work-management/manpowerCurve.js).
--
-- Slice-5 functions are NOT replaced by this migration. A step duration
-- edit that invalidates a current placement is rejected ON READ as
-- unallocated (PLACEMENT_OUTSIDE_WINDOW), per the reconciled scope — the
-- edit itself is never blocked — and a retired step's placement is inert
-- because the read only ever uses active steps. The slice-5
-- forge_work_step_update / forge_work_step_retire bodies are untouched.
--
-- Live collision check, 2026-11-07 (before writing this file):
--   * No repo migration file 20261107030000_forge_work_package_manpower_
--     curve_slice6.sql exists (latest repo file is 20261107020000).
--   * No live table or function with a slice-6 name exists
--     (forge_work_step_curve_placements, forge_work_step_curve_placement_
--     revisions, forge_work_manpower_curve_snapshot/set/clear) — verified
--     by a live catalog read.
--   * The sb-sql --file apply transport does not record rows in
--     supabase_migrations.schema_migrations, so the history table is not
--     a collision signal here; the live catalog is.
--   * forge_work_package_baselines (rung-4 migration 20261004010000,
--     applied 2026-11-04) already exists live with (owner_id, package_id,
--     version_number) unique; the placements FK below references it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One explicit start-day placement per active step AND baseline version.
-- A placement names only a start outage day; the step's hours are spread
-- evenly over its duration from that day. Retired rows stay on file for
-- the audit trail; only one live placement per step per baseline version
-- can exist (partial unique index below).
create table if not exists public.forge_work_step_curve_placements (
  owner_id text not null,
  id text not null,
  work_package_id text not null,
  step_id text not null,
  baseline_version integer not null check (baseline_version >= 1),
  start_day_index integer not null check (start_day_index >= 1),
  version integer not null default 1 check (version >= 1),
  retired_at timestamptz,
  retired_by text,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, work_package_id, step_id)
    references public.forge_work_steps (owner_id, work_package_id, id)
    on delete restrict,
  foreign key (owner_id, work_package_id, baseline_version)
    references public.forge_work_package_baselines (owner_id, package_id, version_number)
    on delete restrict,
  check (retired_at is null or retired_by is not null),
  check (retired_at is null or version >= 2)
);

create unique index if not exists forge_work_step_curve_placements_active_step_uq
  on public.forge_work_step_curve_placements (owner_id, work_package_id, step_id, baseline_version)
  where retired_at is null;

-- Immutable audit of every placement change. One row per version.
create table if not exists public.forge_work_step_curve_placement_revisions (
  owner_id text not null,
  id text not null,
  placement_id text not null,
  version integer not null check (version >= 1),
  actor_id text not null,
  action text not null check (action in ('set', 'clear', 'step_retired')),
  old_values jsonb,
  new_values jsonb,
  reason text check (reason is null or char_length(reason) <= 1000),
  recorded_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, placement_id, version),
  foreign key (owner_id, placement_id)
    references public.forge_work_step_curve_placements (owner_id, id)
    on delete restrict
);

create index if not exists forge_work_step_curve_placement_revisions_placement_idx
  on public.forge_work_step_curve_placement_revisions (owner_id, placement_id, version);
create index if not exists forge_work_step_curve_placements_package_idx
  on public.forge_work_step_curve_placements (owner_id, work_package_id, baseline_version, step_id);

-- ---------------------------------------------------------------------------
-- Row-level security: owner-scoped SELECT only, forced on every role.
-- Writes go through the SECURITY DEFINER RPCs below; no direct app-client
-- mutations. This mirrors slices 3-5: the SELECT policy is the only policy,
-- and there are no write policies.
-- ---------------------------------------------------------------------------

alter table public.forge_work_step_curve_placements enable row level security;
alter table public.forge_work_step_curve_placements force row level security;
alter table public.forge_work_step_curve_placement_revisions enable row level security;
alter table public.forge_work_step_curve_placement_revisions force row level security;

drop policy if exists forge_work_step_curve_placements_select on public.forge_work_step_curve_placements;
create policy forge_work_step_curve_placements_select
  on public.forge_work_step_curve_placements for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_work_step_curve_placement_revisions_select on public.forge_work_step_curve_placement_revisions;
create policy forge_work_step_curve_placement_revisions_select
  on public.forge_work_step_curve_placement_revisions for select to authenticated
  using (has_workspace_access(owner_id));

-- ---------------------------------------------------------------------------
-- Grants: SELECT-only for authenticated; nothing for anon or service_role.
-- Supabase default privileges re-grant ALL on new public tables and EXECUTE
-- on new functions to the app roles, so every grant is stated explicitly
-- here (and verified after the apply with an ACL/RLS receipt).
-- ---------------------------------------------------------------------------

revoke all on table public.forge_work_step_curve_placements from public, anon, service_role, authenticated;
grant select on table public.forge_work_step_curve_placements to authenticated;
revoke all on table public.forge_work_step_curve_placement_revisions from public, anon, service_role, authenticated;
grant select on table public.forge_work_step_curve_placement_revisions to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_manpower_curve_snapshot
-- The whole curve read in ONE statement (one snapshot): the named/current
-- baseline, the active steps, the active placements for that baseline
-- version, and the active assignments, plus per-source generation
-- markers. SECURITY INVOKER so the caller's RLS policies apply to every
-- table read; STABLE because it only reads. A named baseline version that
-- does not exist raises WPP6_BASELINE_NOT_FOUND; with no version given,
-- the latest version is used, and no baseline at all returns baseline
-- null (the caller shows the "freeze a baseline first" empty state).
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- RPC: forge_work_manpower_curve_placement_set
-- Set (or move) a step's explicit start day against an EXACT baseline
-- version. A placement changes only WHICH outage days receive the step's
-- hours — never hours, craft, or duration. The baseline version must
-- exist and must be the current/latest version: a stale/rebased input is
-- refused (WPP6_BASELINE_STALE) instead of silently reinterpreting an
-- old day ordinal against a new window. The window is the named
-- baseline's dates; the placement must fit inside it
-- (start + duration - 1 <= outage_days). Moving an existing placement
-- needs its current version (optimistic concurrency) and a reason.
-- ---------------------------------------------------------------------------

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
    and version_number = p_baseline_version;
  if not found then
    raise exception 'WPP6_BASELINE_NOT_FOUND';
  end if;
  -- The named version must still be the current one: a newer frozen
  -- baseline means the planner must re-establish placements explicitly.
  if exists (
    select 1 from public.forge_work_package_baselines
    where owner_id = p_owner_id and package_id = p_package_id
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

  select * into v_placement
  from public.forge_work_step_curve_placements
  where owner_id = p_owner_id and work_package_id = p_package_id
    and step_id = p_step_id and baseline_version = p_baseline_version
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
    insert into public.forge_work_step_curve_placements (
      owner_id, id, work_package_id, step_id, baseline_version, start_day_index,
      version, created_by, updated_by
    ) values (
      p_owner_id, v_placement_id, p_package_id, p_step_id, p_baseline_version, p_start_day_index,
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

-- ---------------------------------------------------------------------------
-- RPC: forge_work_manpower_curve_placement_clear
-- Retire a placement (the step reverts to the unsequenced baseline). A clear
-- always needs the current version and a reason. Terminal packages are
-- read-only. A placement whose baseline is no longer current is history:
-- clearing it is refused (WPP6_BASELINE_STALE) — old placements stay
-- readable against their named baseline and are never mutated after a
-- re-baseline.
-- ---------------------------------------------------------------------------

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
  if v_placement.retired_at is not null then
    raise exception 'WPP6_RETIRED';
  end if;
  if p_expected_version is null or p_expected_version <> v_placement.version then
    raise exception 'WPP6_VERSION_CONFLICT';
  end if;
  if exists (
    select 1 from public.forge_work_package_baselines
    where owner_id = p_owner_id and package_id = v_placement.work_package_id
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

-- ---------------------------------------------------------------------------
-- Function grants: no default PUBLIC EXECUTE on new functions (Supabase
-- defaults re-grant it — revoked here explicitly), EXECUTE only where the
-- app needs it. The snapshot RPC is a read, but PostgREST still needs
-- EXECUTE on it; its SECURITY INVOKER body enforces the caller's RLS.
-- ---------------------------------------------------------------------------

revoke all on function public.forge_work_manpower_curve_snapshot(text, text, integer) from public;
revoke all on function public.forge_work_manpower_curve_placement_set(text, text, text, integer, integer, integer, text) from public;
revoke all on function public.forge_work_manpower_curve_placement_clear(text, text, integer, text) from public;

grant execute on function public.forge_work_manpower_curve_snapshot(text, text, integer) to authenticated;
grant execute on function public.forge_work_manpower_curve_placement_set(text, text, text, integer, integer, integer, text) to authenticated;
grant execute on function public.forge_work_manpower_curve_placement_clear(text, text, integer, text) to authenticated;
