-- =============================================================================
-- Work Package Planner — Slice 6: Manpower curve
-- =============================================================================
-- FILE ONLY. DO NOT APPLY without Jason's separate word. A production
-- migration apply needs his explicit authorization; this file ships the
-- change, nothing more.
--
-- What this slice adds (derived view only — nothing here stores a curve):
--   * forge_work_package_curve_settings — one outage window per package
--     (outage_start_date DATE, outage_days 1..366,
--     standard_hours_per_person_day >0 and <=24, default 8), owner/package
--     unique, versioned, with an immutable revision audit table.
--   * forge_work_step_curve_placements — one explicit start-day placement
--     per active step (start_day_index 1..N, unique per owner/package/step),
--     versioned, with an immutable revision audit table. A placement only
--     changes WHICH outage days receive a step's hours; it never changes
--     hours, craft, or duration.
--   * forge_work_manpower_curve_settings_set / placement_set / placement_clear
--     — SECURITY DEFINER RPCs (actor from auth.uid(), no caller-supplied
--     actor), optimistic expected_version, terminal-package guards, and a
--     reject-by-default placement-outside-window rule.
--   * forge_work_step_retire / forge_work_step_update are REPLACED verbatim
--     from slice 5 (20261107020000) — same signatures, same bodies — with
--     two slice-6 additions: retiring a step retires its live placement
--     in the same transaction (audited), and changing a step's duration
--     re-validates its placement against the outage window (rejects with
--     WPP6_PLACEMENT_OUTSIDE_WINDOW). The replacements MUST keep the
--     slice-5 signatures exactly (update: owner/step/version/title/.../
--     set-flags/historical/reason, 16 args; retire: owner/step/version/
--     reason/historical, 5 args) — PostgreSQL overloads by argument
--     types, so a different signature would silently create a second
--     function and leave the live one untouched.
--
-- What is NOT stored, by design: no materialized curve table, no daily
-- demand table, no per-craft duplicated totals. The curve is recomputed on
-- GET from steps + placements + assignments (see
-- src/domains/work-management/manpowerCurve.js and
-- src/application/work-management/manpowerCurve.js).
--
-- Live collision check, 2026-11-07 (before writing this file):
--   * No repo migration file 20261107030000 exists (latest repo file is
--     20261107020000); the live schema_migrations history tops out at
--     20261102000000. No timestamp collision.
--   * None of the four new tables and none of the three new functions
--     exist in the live public schema.
--   * The two replaced functions (forge_work_step_retire,
--     forge_work_step_update) already exist from slice 5; this file replaces
--     them with the slice-6 bodies only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One outage window per package. A window is stored exactly once: in this
-- table, never also as columns on forge_work_packages.
create table if not exists public.forge_work_package_curve_settings (
  owner_id text not null,
  work_package_id text not null,
  outage_start_date date not null,
  outage_days integer not null
    check (outage_days between 1 and 366),
  standard_hours_per_person_day numeric(4, 2) not null default 8
    check (
      standard_hours_per_person_day > 0
      and standard_hours_per_person_day <= 24
      and standard_hours_per_person_day = round(standard_hours_per_person_day, 2)
    ),
  version integer not null default 1 check (version >= 1),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, work_package_id),
  foreign key (owner_id, work_package_id)
    references public.forge_work_packages (owner_id, id)
    on delete restrict
);

-- Immutable audit of every settings change. One row per version.
create table if not exists public.forge_work_package_curve_settings_revisions (
  owner_id text not null,
  id text not null,
  work_package_id text not null,
  version integer not null check (version >= 1),
  actor_id text not null,
  action text not null check (action in ('create', 'update')),
  old_values jsonb,
  new_values jsonb,
  reason text check (reason is null or char_length(reason) <= 1000),
  recorded_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, work_package_id, version),
  foreign key (owner_id, work_package_id)
    references public.forge_work_package_curve_settings (owner_id, work_package_id)
    on delete restrict
);

-- One explicit start-day placement per active step. A placement names only a
-- start outage day; the step's hours are spread evenly over its duration
-- from that day. Retired rows stay on file for the audit trail; only one
-- live placement per step can exist (partial unique index below).
create table if not exists public.forge_work_step_curve_placements (
  owner_id text not null,
  id text not null,
  work_package_id text not null,
  step_id text not null,
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
  check (retired_at is null or retired_by is not null),
  check (retired_at is null or version >= 2)
);

create unique index if not exists forge_work_step_curve_placements_active_step_uq
  on public.forge_work_step_curve_placements (owner_id, work_package_id, step_id)
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
create index if not exists forge_work_package_curve_settings_revisions_package_idx
  on public.forge_work_package_curve_settings_revisions (owner_id, work_package_id, version);
create index if not exists forge_work_step_curve_placements_package_idx
  on public.forge_work_step_curve_placements (owner_id, work_package_id, step_id);

-- ---------------------------------------------------------------------------
-- Row-level security: owner-scoped SELECT only, forced on every role.
-- Writes go through the SECURITY DEFINER RPCs below; no direct app-client
-- mutations. This mirrors slices 3-5: the SELECT policy is the only policy,
-- and there are no write policies.
-- ---------------------------------------------------------------------------

alter table public.forge_work_package_curve_settings enable row level security;
alter table public.forge_work_package_curve_settings force row level security;
alter table public.forge_work_package_curve_settings_revisions enable row level security;
alter table public.forge_work_package_curve_settings_revisions force row level security;
alter table public.forge_work_step_curve_placements enable row level security;
alter table public.forge_work_step_curve_placements force row level security;
alter table public.forge_work_step_curve_placement_revisions enable row level security;
alter table public.forge_work_step_curve_placement_revisions force row level security;

drop policy if exists forge_work_package_curve_settings_select on public.forge_work_package_curve_settings;
create policy forge_work_package_curve_settings_select
  on public.forge_work_package_curve_settings for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_work_package_curve_settings_revisions_select on public.forge_work_package_curve_settings_revisions;
create policy forge_work_package_curve_settings_revisions_select
  on public.forge_work_package_curve_settings_revisions for select to authenticated
  using (has_workspace_access(owner_id));

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

revoke all on table public.forge_work_package_curve_settings from public, anon, service_role, authenticated;
grant select on table public.forge_work_package_curve_settings to authenticated;
revoke all on table public.forge_work_package_curve_settings_revisions from public, anon, service_role, authenticated;
grant select on table public.forge_work_package_curve_settings_revisions to authenticated;
revoke all on table public.forge_work_step_curve_placements from public, anon, service_role, authenticated;
grant select on table public.forge_work_step_curve_placements to authenticated;
revoke all on table public.forge_work_step_curve_placement_revisions from public, anon, service_role, authenticated;
grant select on table public.forge_work_step_curve_placement_revisions to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_manpower_curve_settings_set
-- Create or update the outage window for one package. Terminal packages are
-- read-only. Shrinking the window rejects (WPP6_PLACEMENT_OUTSIDE_WINDOW,
-- with the affected step ids after the colon) when a live placement would
-- run past the new window end — never clip, wrap, or silently clear.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_manpower_curve_settings_set(
  p_owner_id text,
  p_package_id text,
  p_outage_start_date date,
  p_outage_days integer,
  p_standard_hours_per_person_day numeric default null,
  p_expected_version integer default null,
  p_reason text default null
)
returns setof public.forge_work_package_curve_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id text := auth.uid();
  v_status text;
  v_standard numeric(4, 2);
  v_settings public.forge_work_package_curve_settings%rowtype;
  v_bad_steps text[];
begin
  if v_actor_id is null then
    raise exception 'WPP6_INVALID_ACTOR';
  end if;
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP6_WORKSPACE_FORBIDDEN';
  end if;
  if p_outage_start_date is null then
    raise exception 'WPP6_INVALID_START_DATE';
  end if;
  if p_outage_days is null or p_outage_days < 1 or p_outage_days > 366 then
    raise exception 'WPP6_INVALID_OUTAGE_DAYS';
  end if;
  if p_standard_hours_per_person_day is not null
    and (
      p_standard_hours_per_person_day <= 0
      or p_standard_hours_per_person_day > 24
      or p_standard_hours_per_person_day <> round(p_standard_hours_per_person_day, 2)
    )
  then
    raise exception 'WPP6_INVALID_STANDARD_HOURS';
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

  v_standard := coalesce(p_standard_hours_per_person_day, 8);

  select * into v_settings
  from public.forge_work_package_curve_settings
  where owner_id = p_owner_id and work_package_id = p_package_id
  for update;

  if found then
    if p_expected_version is null or p_expected_version <> v_settings.version then
      raise exception 'WPP6_VERSION_CONFLICT';
    end if;

    -- A window change must never strand a live placement outside the window.
    select array_agg(p.step_id) into v_bad_steps
    from public.forge_work_step_curve_placements p
    join public.forge_work_steps s
      on s.owner_id = p.owner_id
      and s.work_package_id = p.work_package_id
      and s.id = p.step_id
    where p.owner_id = p_owner_id
      and p.work_package_id = p_package_id
      and p.retired_at is null
      and s.retired_at is null
      and p.start_day_index + coalesce(s.planned_duration_days, p_outage_days) - 1 > p_outage_days;
    if v_bad_steps is not null then
      raise exception 'WPP6_PLACEMENT_OUTSIDE_WINDOW:%', array_to_string(v_bad_steps, ',');
    end if;

    update public.forge_work_package_curve_settings
    set outage_start_date = p_outage_start_date,
        outage_days = p_outage_days,
        standard_hours_per_person_day = v_standard,
        version = version + 1,
        updated_by = v_actor_id,
        updated_at = now()
    where owner_id = p_owner_id and work_package_id = p_package_id;

    insert into public.forge_work_package_curve_settings_revisions (
      owner_id, id, work_package_id, version, actor_id, action, old_values, new_values, reason
    ) values (
      p_owner_id,
      'forge_wpcsr_' || replace(gen_random_uuid()::text, '-', ''),
      p_package_id,
      v_settings.version + 1,
      v_actor_id,
      'update',
      jsonb_build_object(
        'outage_start_date', v_settings.outage_start_date,
        'outage_days', v_settings.outage_days,
        'standard_hours_per_person_day', v_settings.standard_hours_per_person_day,
        'version', v_settings.version
      ),
      jsonb_build_object(
        'outage_start_date', p_outage_start_date,
        'outage_days', p_outage_days,
        'standard_hours_per_person_day', v_standard,
        'version', v_settings.version + 1
      ),
      p_reason
    );
  else
    if p_expected_version is not null and p_expected_version <> 0 then
      raise exception 'WPP6_VERSION_CONFLICT';
    end if;

    insert into public.forge_work_package_curve_settings (
      owner_id, work_package_id, outage_start_date, outage_days,
      standard_hours_per_person_day, version, created_by, updated_by
    ) values (
      p_owner_id, p_package_id, p_outage_start_date, p_outage_days,
      v_standard, 1, v_actor_id, v_actor_id
    );

    insert into public.forge_work_package_curve_settings_revisions (
      owner_id, id, work_package_id, version, actor_id, action, old_values, new_values, reason
    ) values (
      p_owner_id,
      'forge_wpcsr_' || replace(gen_random_uuid()::text, '-', ''),
      p_package_id,
      1,
      v_actor_id,
      'create',
      null,
      jsonb_build_object(
        'outage_start_date', p_outage_start_date,
        'outage_days', p_outage_days,
        'standard_hours_per_person_day', v_standard,
        'version', 1
      ),
      p_reason
    );
  end if;

  return query
    select *
    from public.forge_work_package_curve_settings
    where owner_id = p_owner_id and work_package_id = p_package_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_manpower_curve_placement_set
-- Set (or move) a step's explicit start day. A placement changes only WHICH
-- outage days receive the step's hours — never hours, craft, or duration.
-- The window must exist first; the placement must fit inside it
-- (start + duration - 1 <= outage_days). Moving an existing placement needs
-- its current version (optimistic concurrency) and a reason.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_manpower_curve_placement_set(
  p_owner_id text,
  p_package_id text,
  p_step_id text,
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
  v_settings public.forge_work_package_curve_settings%rowtype;
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

  select * into v_settings
  from public.forge_work_package_curve_settings
  where owner_id = p_owner_id and work_package_id = p_package_id;
  if not found then
    raise exception 'WPP6_WINDOW_NOT_CONFIGURED';
  end if;
  if p_start_day_index > v_settings.outage_days then
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

  v_duration := coalesce(v_step.planned_duration_days, v_settings.outage_days);
  if p_start_day_index + v_duration - 1 > v_settings.outage_days then
    raise exception 'WPP6_PLACEMENT_OUTSIDE_WINDOW:%', p_step_id;
  end if;

  select * into v_placement
  from public.forge_work_step_curve_placements
  where owner_id = p_owner_id and work_package_id = p_package_id
    and step_id = p_step_id and retired_at is null
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
      jsonb_build_object('start_day_index', v_placement.start_day_index, 'version', v_placement.version),
      jsonb_build_object('start_day_index', p_start_day_index, 'version', v_placement.version + 1),
      p_reason
    );
    v_placement_id := v_placement.id;
  else
    if p_expected_version is not null and p_expected_version <> 0 then
      raise exception 'WPP6_VERSION_CONFLICT';
    end if;

    v_placement_id := 'forge_wpsp_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.forge_work_step_curve_placements (
      owner_id, id, work_package_id, step_id, start_day_index,
      version, created_by, updated_by
    ) values (
      p_owner_id, v_placement_id, p_package_id, p_step_id, p_start_day_index,
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
      jsonb_build_object('start_day_index', p_start_day_index, 'version', 1),
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
-- read-only.
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
    jsonb_build_object('start_day_index', v_placement.start_day_index, 'version', v_placement.version),
    jsonb_build_object('start_day_index', null, 'version', v_placement.version + 1, 'retired_at', now()),
    p_reason
  );

  return query
    select *
    from public.forge_work_step_curve_placements
    where owner_id = p_owner_id and id = p_placement_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- REPLACED: forge_work_step_retire
-- Slice-5 body verbatim (same 5-arg signature: owner/step/version/reason/
-- historical), plus one slice-6 addition: retiring a step also retires its
-- live curve placement in the same transaction and records it as a
-- versioned 'step_retired' audit entry. A retired step keeps no live
-- placement, so its hours can never be scheduled by a stale placement.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_step_retire(
  p_owner_id text,
  p_step_id text,
  p_expected_version integer,
  p_reason text,
  p_historical_correction boolean
)
returns public.forge_work_steps
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_old public.forge_work_steps%rowtype;
  v_step public.forge_work_steps%rowtype;
  v_actor text;
  v_action text;
  v_remaining_ids text[];
  v_link public.forge_work_step_drawing_links%rowtype;
  v_placement record;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP5_WORKSPACE_FORBIDDEN';
  end if;
  -- The audit actor is the authenticated caller, never a parameter.
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP5_INVALID_ACTOR';
  end if;
  select * into v_old from public.forge_work_steps
    where owner_id = p_owner_id and id = p_step_id for update;
  if not found then
    raise exception 'WPP5_STEP_NOT_FOUND';
  end if;
  if v_old.retired_at is not null then
    raise exception 'WPP5_RETIRED';
  end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception 'WPP5_VERSION_CONFLICT';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'WPP5_REASON_REQUIRED';
  end if;
  if char_length(p_reason) > 1000 then
    raise exception 'WPP5_REASON_TOO_LONG';
  end if;
  -- Retiring can never reactivate work, so no terminal-package
  -- block: a closed package's steps may still be retired with a
  -- reason (slice 4's retire rule, same reasoning).
  v_action := case when coalesce(p_historical_correction, false) then 'historical_correction'
                   else 'retire' end;

  update public.forge_work_steps
    set retired_at = now(),
        retired_by = v_actor,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_step_id
    returning * into v_step;

  insert into public.forge_work_step_revisions
    (owner_id, id, step_id, version, actor_id, action,
     old_values, new_values, reason, recorded_at)
  values
    (p_owner_id, 'forge_wpsr_' || gen_random_uuid(), v_step.id, v_step.version, v_actor, v_action,
     jsonb_build_object(
       'title', v_old.title,
       'description', v_old.description,
       'sequence_no', v_old.sequence_no,
       'craft_key', v_old.craft_key,
       'craft_label', v_old.craft_label,
       'planned_duration_days', v_old.planned_duration_days,
       'planned_person_hours', v_old.planned_person_hours,
       'source_note', v_old.source_note,
       'supersedes_step_id', v_old.supersedes_step_id,
       'retired_at', v_old.retired_at,
       'version', v_old.version),
     jsonb_build_object(
       'title', v_step.title,
       'description', v_step.description,
       'sequence_no', v_step.sequence_no,
       'craft_key', v_step.craft_key,
       'craft_label', v_step.craft_label,
       'planned_duration_days', v_step.planned_duration_days,
       'planned_person_hours', v_step.planned_person_hours,
       'source_note', v_step.source_note,
       'supersedes_step_id', v_step.supersedes_step_id,
       'retired_at', v_step.retired_at,
       'retired_by', v_step.retired_by,
       'version', v_step.version),
     p_reason, now());

  -- Slice 6: retire any live curve placement for this step in the same
  -- transaction, with its own versioned audit entry.
  for v_placement in
    select id, version, start_day_index
    from public.forge_work_step_curve_placements
    where owner_id = p_owner_id and work_package_id = v_old.work_package_id
      and step_id = p_step_id and retired_at is null
    for update
  loop
    update public.forge_work_step_curve_placements
    set retired_at = now(),
        retired_by = v_actor,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = v_placement.id;

    insert into public.forge_work_step_curve_placement_revisions (
      owner_id, id, placement_id, version, actor_id, action, old_values, new_values, reason
    ) values (
      p_owner_id,
      'forge_wpspr_' || replace(gen_random_uuid()::text, '-', ''),
      v_placement.id,
      v_placement.version + 1,
      v_actor,
      'step_retired',
      jsonb_build_object('start_day_index', v_placement.start_day_index, 'version', v_placement.version),
      jsonb_build_object('start_day_index', null, 'version', v_placement.version + 1, 'retired_at', now()),
      'Step retired.'
    );
  end loop;

  -- Retiring a step closes its active drawing associations with
  -- audited retirement — the controlled drawings themselves are
  -- untouched, and the link history keeps the original drawing ids.
  for v_link in
    select * from public.forge_work_step_drawing_links
      where owner_id = p_owner_id and step_id = p_step_id and retired_at is null
      order by created_at asc
      for update
  loop
    update public.forge_work_step_drawing_links
      set retired_at = now(),
          retired_by = v_actor,
          version = version + 1
      where owner_id = p_owner_id and id = v_link.id
      returning * into v_link;
    insert into public.forge_work_step_drawing_link_revisions
      (owner_id, id, link_id, version, actor_id, action,
       old_values, new_values, reason, recorded_at)
    values
      (p_owner_id, 'forge_wplr_' || gen_random_uuid(), v_link.id, v_link.version, v_actor, 'retire',
       jsonb_build_object(
         'step_id', v_link.step_id,
         'drawing_id', v_link.drawing_id,
         'original_drawing_id', v_link.original_drawing_id,
         'refinement_note', v_link.refinement_note,
         'retired_at', null::timestamptz,
         'version', v_link.version - 1),
       jsonb_build_object(
         'step_id', v_link.step_id,
         'drawing_id', v_link.drawing_id,
         'original_drawing_id', v_link.original_drawing_id,
         'refinement_note', v_link.refinement_note,
         'retired_at', v_link.retired_at,
         'retired_by', v_link.retired_by,
         'version', v_link.version),
       p_reason, now());
  end loop;

  -- Close the gap: the remaining active steps renumber contiguously,
  -- each shifted step with its own 'reorder' revision.
  select array_agg(id order by sequence_no) into v_remaining_ids
    from public.forge_work_steps
    where owner_id = p_owner_id and work_package_id = v_old.work_package_id and retired_at is null;
  if v_remaining_ids is not null then
    perform public.forge_work_step_apply_order(
      p_owner_id, v_old.work_package_id, v_remaining_ids, null, v_actor, p_reason);
  end if;

  perform public.forge_work_step_order_row(p_owner_id, v_old.work_package_id);
  update public.forge_work_step_order
    set generation = generation + 1, updated_at = now()
    where owner_id = p_owner_id and work_package_id = v_old.work_package_id;

  return v_step;
end;
$$;

-- ---------------------------------------------------------------------------
-- REPLACED: forge_work_step_update
-- Slice-5 body verbatim (same 16-arg signature: owner/step/version/title/
-- description/craft/duration/hours/source-note/set-flags/historical/
-- reason), plus one slice-6 addition: when a step's duration changes and
-- the step has a live curve placement, the placement is re-validated
-- against the outage window (start + new duration - 1 must fit). A
-- duration change that would strand the placement rejects with
-- WPP6_PLACEMENT_OUTSIDE_WINDOW instead of silently stranding it.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_step_update(
  p_owner_id text,
  p_step_id text,
  p_expected_version integer,
  p_title text,
  p_description text,
  p_craft_label text,
  p_planned_duration_days integer,
  p_planned_person_hours numeric,
  p_source_note text,
  p_set_description boolean,
  p_set_craft_label boolean,
  p_set_duration_days boolean,
  p_set_person_hours boolean,
  p_set_source_note boolean,
  p_historical_correction boolean,
  p_reason text
)
returns public.forge_work_steps
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_pkg_status text;
  v_old public.forge_work_steps%rowtype;
  v_step public.forge_work_steps%rowtype;
  v_actor text;
  v_new_title text;
  v_new_description text;
  v_new_craft_key text;
  v_new_craft_label text;
  v_new_duration_days integer;
  v_new_person_hours numeric;
  v_new_source_note text;
  v_action text;
  v_outage_days integer;
  v_place_start integer;
  v_effective_duration integer;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP5_WORKSPACE_FORBIDDEN';
  end if;
  -- The audit actor is the authenticated caller, never a parameter.
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP5_INVALID_ACTOR';
  end if;
  -- Row lock: concurrent edits serialize here, so the second one sees
  -- the bumped version and fails the guard below instead of silently
  -- overwriting the first edit.
  select * into v_old from public.forge_work_steps
    where owner_id = p_owner_id and id = p_step_id for update;
  if not found then
    raise exception 'WPP5_STEP_NOT_FOUND';
  end if;
  if v_old.retired_at is not null then
    raise exception 'WPP5_RETIRED';
  end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception 'WPP5_VERSION_CONFLICT';
  end if;
  select status into v_pkg_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_old.work_package_id;
  if not found then
    raise exception 'WPP5_PACKAGE_NOT_FOUND';
  end if;
  -- Terminal packages: only an explicit historical correction with a
  -- reason may still edit an existing step.
  if v_pkg_status in ('cancelled', 'verified_closed') then
    if coalesce(p_historical_correction, false) is not true
       or p_reason is null or btrim(p_reason) = '' then
      raise exception 'WPP5_PACKAGE_TERMINAL';
    end if;
  end if;

  -- Resolve the new values first (NULL = preserve, except the five
  -- set-flag fields, where an explicit NULL means clear — the slice-3
  -- P1 lesson: a bare NULL cannot tell "omitted" from "cleared").
  -- The title is required: it can change, never clear.
  if p_title is not null then
    v_new_title := btrim(regexp_replace(p_title, '\s+', ' ', 'g'));
    if char_length(v_new_title) < 1 or char_length(v_new_title) > 160
       or v_new_title !~ '^[A-Za-z0-9][A-Za-z0-9 .&''/(),:;+-]*$' then
      raise exception 'WPP5_INVALID_TITLE';
    end if;
  else
    v_new_title := v_old.title;
  end if;
  if coalesce(p_set_description, false) then
    if p_description is null then
      v_new_description := null;
    else
      v_new_description := btrim(p_description);
      if char_length(v_new_description) > 4000
         or v_new_description ~ '[[:cntrl:]]'
         or v_new_description ~ '<[a-zA-Z/][^>]*>' then
        raise exception 'WPP5_INVALID_DESCRIPTION';
      end if;
    end if;
  else
    v_new_description := v_old.description;
  end if;
  if coalesce(p_set_craft_label, false) then
    if p_craft_label is null then
      v_new_craft_label := null;
      v_new_craft_key := null;
    else
      v_new_craft_label := btrim(regexp_replace(p_craft_label, '\s+', ' ', 'g'));
      if char_length(v_new_craft_label) < 1 or char_length(v_new_craft_label) > 80
         or v_new_craft_label !~ '^[A-Za-z0-9][A-Za-z0-9 .&''/-]*$' then
        raise exception 'WPP5_INVALID_CRAFT';
      end if;
      v_new_craft_key := public.forge_work_craft_normalize_key(v_new_craft_label);
    end if;
  else
    v_new_craft_label := v_old.craft_label;
    v_new_craft_key := v_old.craft_key;
  end if;
  if coalesce(p_set_duration_days, false) then
    v_new_duration_days := p_planned_duration_days;
    if v_new_duration_days is not null
       and (v_new_duration_days < 1 or v_new_duration_days > 366) then
      raise exception 'WPP5_INVALID_DURATION';
    end if;
  else
    v_new_duration_days := v_old.planned_duration_days;
  end if;
  if coalesce(p_set_person_hours, false) then
    v_new_person_hours := p_planned_person_hours;
    if v_new_person_hours is not null
       and (v_new_person_hours <= 0 or v_new_person_hours > 1000000
            or v_new_person_hours <> round(v_new_person_hours, 2)) then
      raise exception 'WPP5_INVALID_HOURS';
    end if;
  else
    v_new_person_hours := v_old.planned_person_hours;
  end if;
  if coalesce(p_set_source_note, false) then
    if p_source_note is null then
      v_new_source_note := null;
    else
      v_new_source_note := btrim(p_source_note);
      if char_length(v_new_source_note) > 1000 or v_new_source_note ~ '[[:cntrl:]]' then
        raise exception 'WPP5_INVALID_NOTE';
      end if;
    end if;
  else
    v_new_source_note := v_old.source_note;
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'WPP5_REASON_TOO_LONG';
  end if;

  -- Slice 6: a duration change must not strand a live curve placement
  -- outside the outage window. Check only when the duration actually
  -- changes; an unchanged duration cannot newly invalidate a placement
  -- (window shrinks reject at the settings RPC instead).
  if v_new_duration_days is distinct from v_old.planned_duration_days then
    select outage_days into v_outage_days
    from public.forge_work_package_curve_settings
    where owner_id = p_owner_id and work_package_id = v_old.work_package_id;
    if v_outage_days is not null then
      select start_day_index into v_place_start
      from public.forge_work_step_curve_placements
      where owner_id = p_owner_id and work_package_id = v_old.work_package_id
        and step_id = p_step_id and retired_at is null;
      if v_place_start is not null then
        v_effective_duration := coalesce(v_new_duration_days, v_outage_days);
        if v_place_start + v_effective_duration - 1 > v_outage_days then
          raise exception 'WPP6_PLACEMENT_OUTSIDE_WINDOW:%', p_step_id;
        end if;
      end if;
    end if;
  end if;

  v_action := case when coalesce(p_historical_correction, false) then 'historical_correction'
                   else 'update' end;

  update public.forge_work_steps
    set title = v_new_title,
        description = v_new_description,
        craft_key = v_new_craft_key,
        craft_label = v_new_craft_label,
        planned_duration_days = v_new_duration_days,
        planned_person_hours = v_new_person_hours,
        source_note = v_new_source_note,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_step_id
    returning * into v_step;

  insert into public.forge_work_step_revisions
    (owner_id, id, step_id, version, actor_id, action,
     old_values, new_values, reason, recorded_at)
  values
    (p_owner_id, 'forge_wpsr_' || gen_random_uuid(), v_step.id, v_step.version, v_actor, v_action,
     jsonb_build_object(
       'title', v_old.title,
       'description', v_old.description,
       'sequence_no', v_old.sequence_no,
       'craft_key', v_old.craft_key,
       'craft_label', v_old.craft_label,
       'planned_duration_days', v_old.planned_duration_days,
       'planned_person_hours', v_old.planned_person_hours,
       'source_note', v_old.source_note,
       'supersedes_step_id', v_old.supersedes_step_id,
       'retired_at', v_old.retired_at,
       'version', v_old.version),
     jsonb_build_object(
       'title', v_step.title,
       'description', v_step.description,
       'sequence_no', v_step.sequence_no,
       'craft_key', v_step.craft_key,
       'craft_label', v_step.craft_label,
       'planned_duration_days', v_step.planned_duration_days,
       'planned_person_hours', v_step.planned_person_hours,
       'source_note', v_step.source_note,
       'supersedes_step_id', v_step.supersedes_step_id,
       'retired_at', v_step.retired_at,
       'version', v_step.version),
     p_reason, now());

  return v_step;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants: no default PUBLIC EXECUTE on new functions (Supabase
-- defaults re-grant it — revoked here explicitly), EXECUTE only where the
-- app needs it. The two replaced step functions keep their slice-5 grants,
-- re-issued here with their exact slice-5 signatures.
-- ---------------------------------------------------------------------------

revoke all on function public.forge_work_manpower_curve_settings_set(text, text, date, integer, numeric, integer, text) from public;
revoke all on function public.forge_work_manpower_curve_placement_set(text, text, text, integer, integer, text) from public;
revoke all on function public.forge_work_manpower_curve_placement_clear(text, text, integer, text) from public;
revoke all on function public.forge_work_step_retire(text, text, integer, text, boolean) from public;
revoke all on function public.forge_work_step_update(text, text, integer, text, text, text, integer, numeric, text, boolean, boolean, boolean, boolean, boolean, boolean, text) from public;

grant execute on function public.forge_work_manpower_curve_settings_set(text, text, date, integer, numeric, integer, text) to authenticated;
grant execute on function public.forge_work_manpower_curve_placement_set(text, text, text, integer, integer, text) to authenticated;
grant execute on function public.forge_work_manpower_curve_placement_clear(text, text, integer, text) to authenticated;
grant execute on function public.forge_work_step_retire(text, text, integer, text, boolean) to authenticated;
grant execute on function public.forge_work_step_update(text, text, integer, text, text, text, integer, numeric, text, boolean, boolean, boolean, boolean, boolean, boolean, text) to authenticated;
