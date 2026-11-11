-- =============================================================================
-- Scheduling Tool — Admin Permissions, Slice 1
-- =============================================================================
-- FILE ONLY. DO NOT APPLY without Jason's separate word.
--
-- Scope: results/chatgpt/scheduling-tool-admin-permissions-scope-2026-11-08.md
-- Build authorization: commands/claude/scheduling-admin-permissions-slice1-refile-2026-11-10.md
--
-- Mirrors the Rental (20261110010000) / Planner (20261110000000) slice-1
-- pattern exactly: a fixed capability catalog as a CHECK-constrained
-- enumeration, four tables (roles / role_capabilities /
-- user_role_assignments / permission_audit), owner/co-owner structural
-- bypass via has_workspace_access, narrow SECURITY DEFINER RPCs for every
-- write, RLS+FORCE with SELECT-only grants.
--
-- CAPABILITY CATALOG — grounded in the live code, not copied from the
-- scope brief verbatim. Before writing this catalog, the current
-- Scheduling app (src/app/api/forge/scheduling/**, 23 route files) was
-- checked for every noun the brief's table uses:
--   * "jobs" and "crews" do not exist as entities anywhere in this app.
--     Scheduling has projects (schedule_projects / forge_scheduling_projects),
--     activities/WBS nodes (schedule_wbs_nodes, ActivitiesPage.jsx,
--     WbsPage.jsx with a real reorderWbsNode operation), and resources
--     typed labor/nonlabor/material (schedule_resources) — never a
--     distinct "job" or "crew" record. scheduling.jobs.* and
--     scheduling.crews.* are therefore OMITTED from this catalog, not
--     just left unassigned — including them would catalog a capability
--     with no route, RPC, or table to ever gate, which this repo's own
--     "every assignable key must map to a tested route/RPC/table" rule
--     (and the brief's own "keys unsupported by current code stay
--     nonassignable" instruction) both rule out.
--   * No TV/kiosk route or component exists anywhere in this app (grepped
--     the whole src tree for tv/kiosk under forge/scheduling — zero
--     hits). scheduling.tv.* is OMITTED for the same reason. The
--     "authenticated TV view must never expose admin actions" hard rule
--     is therefore trivially satisfied: there is no TV view to expose
--     anything from, admin or otherwise.
--   * "Publish / unpublish / archive" is not a state any schedule/project
--     carries today (no status column, no publish flag anywhere in
--     20260818140000 or 20260827000000) — scheduling.schedules.* is
--     narrowed to read/create/edit only; publish/unpublish/archive stay
--     out until that feature itself exists.
--   * "Resequence" is real (WbsPage.jsx's reorderWbsNode); "allocate" /
--     "release" map onto the real assignments
--     POST (.../assignments) / DELETE (.../assignments/[assignmentId])
--     verbs; "configure" maps onto schedule_calendars +
--     schedule_blackout_windows writes.
-- The result is 8 groups / 21 keys (schedules, activities, resources,
-- calendars, settings, staff, roles, audit) rather than the brief's 11
-- groups — a verified reduction, documented in the build's result file,
-- not a silent one.
--
-- THE HARD RULE (Scheduling equivalent of Planner's drawing-edit ban):
-- no TV/kiosk-exposed administrative action exists, structurally, because
-- no TV/kiosk route exists in this slice or any prior one. If a future
-- slice adds a TV/kiosk view, it must be re-verified against this same
-- rule before any scheduling.tv.* key is ever added back to this catalog.
--
-- Live collision check, 2026-11-10 (before writing this file):
--   * On current main (head f84fe745): the newest migration is
--     20261110060000 (Scheduling workspace foundation, already applied).
--     20261110070000 is reserved by PR #774's fix round (open, not yet
--     merged) and 20261110050000 by the mode-selector PR #775 (open, not
--     yet merged) — neither is on main yet, but both are claimed by
--     in-flight PRs, so this file uses 20261110080000, the next number
--     free of every claim this session is aware of as of this build.
--   * No table or function with these names exists in any prior migration
--     file in this repo (grepped forge_scheduling_roles,
--     forge_scheduling_role_capabilities,
--     forge_scheduling_user_role_assignments,
--     forge_scheduling_permission_audit, has_scheduling_permission — zero
--     hits).
--   * No live-database check was performed (no connection path from this
--     session) — repo-file-level check only, same limit every other
--     slice's own note carries when connectivity isn't available.
-- =============================================================================

do $$
declare
  v_catalog text[] := array[
    'scheduling.schedules.read','scheduling.schedules.create','scheduling.schedules.edit',
    'scheduling.activities.read','scheduling.activities.create','scheduling.activities.edit','scheduling.activities.resequence',
    'scheduling.resources.read','scheduling.resources.create','scheduling.resources.edit','scheduling.resources.allocate','scheduling.resources.release',
    'scheduling.calendars.read','scheduling.calendars.configure',
    'scheduling.settings.read','scheduling.settings.edit',
    'scheduling.staff.read','scheduling.staff.invite',
    'scheduling.roles.read','scheduling.roles.manage',
    'scheduling.audit.read'
  ];
begin
  -- Explicit, permanent assertion: no scheduling.tv.* key ever exists in
  -- this catalog via this file (the TV/kiosk hard rule, Scheduling's
  -- equivalent of Planner's drawing-edit ban). Fails the migration
  -- outright if anyone ever edits this array to add one before a real
  -- TV/kiosk view exists and is re-verified against the rule.
  if exists (select 1 from unnest(v_catalog) k where k like 'scheduling.tv.%') then
    raise exception 'FORBIDDEN: no scheduling.tv.* capability may exist until a real TV/kiosk view is built and re-verified';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.forge_scheduling_roles (
  owner_id text not null,
  id text not null,
  role_key text not null,
  name text not null,
  is_builtin boolean not null default false,
  version integer not null default 1 check (version >= 1),
  retired_at timestamptz,
  retired_by text,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  check (char_length(trim(role_key)) > 0),
  check (char_length(trim(name)) > 0),
  check (retired_at is null or retired_by is not null)
);

create unique index if not exists forge_scheduling_roles_active_key_uq
  on public.forge_scheduling_roles (owner_id, role_key)
  where retired_at is null;

create table if not exists public.forge_scheduling_role_capabilities (
  owner_id text not null,
  id text not null,
  role_id text not null,
  capability_key text not null check (capability_key in (
    'scheduling.schedules.read','scheduling.schedules.create','scheduling.schedules.edit',
    'scheduling.activities.read','scheduling.activities.create','scheduling.activities.edit','scheduling.activities.resequence',
    'scheduling.resources.read','scheduling.resources.create','scheduling.resources.edit','scheduling.resources.allocate','scheduling.resources.release',
    'scheduling.calendars.read','scheduling.calendars.configure',
    'scheduling.settings.read','scheduling.settings.edit',
    'scheduling.staff.read','scheduling.staff.invite',
    'scheduling.roles.read','scheduling.roles.manage',
    'scheduling.audit.read'
  )),
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, role_id, capability_key),
  foreign key (owner_id, role_id) references public.forge_scheduling_roles (owner_id, id) on delete restrict
);

create index if not exists forge_scheduling_role_capabilities_role_idx
  on public.forge_scheduling_role_capabilities (owner_id, role_id);

create table if not exists public.forge_scheduling_user_role_assignments (
  owner_id text not null,
  id text not null,
  assignee_user_id text not null,
  role_id text not null,
  version integer not null default 1 check (version >= 1),
  retired_at timestamptz,
  retired_by text,
  assigned_by text not null,
  assigned_at timestamptz not null default now(),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, role_id) references public.forge_scheduling_roles (owner_id, id) on delete restrict,
  check (retired_at is null or retired_by is not null)
);

create unique index if not exists forge_scheduling_user_role_assignments_active_uq
  on public.forge_scheduling_user_role_assignments (owner_id, assignee_user_id)
  where retired_at is null;

create table if not exists public.forge_scheduling_permission_audit (
  owner_id text not null,
  id text not null,
  actor_id text not null,
  action text not null check (action in (
    'role_create','role_rename','role_retire',
    'capability_add','capability_remove',
    'assignment_create','assignment_revoke'
  )),
  target_role_id text,
  target_user_id text,
  old_values jsonb,
  new_values jsonb,
  reason text check (reason is null or char_length(reason) <= 1000),
  request_id text not null,
  recorded_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create index if not exists forge_scheduling_permission_audit_owner_idx
  on public.forge_scheduling_permission_audit (owner_id, recorded_at desc);
create index if not exists forge_scheduling_permission_audit_role_idx
  on public.forge_scheduling_permission_audit (owner_id, target_role_id, recorded_at desc)
  where target_role_id is not null;
create index if not exists forge_scheduling_permission_audit_user_idx
  on public.forge_scheduling_permission_audit (owner_id, target_user_id, recorded_at desc)
  where target_user_id is not null;

-- ---------------------------------------------------------------------------
-- has_scheduling_permission — the gate every scheduling admin write RPC
-- uses, and the SELECT policies on these same four tables also use. Owner
-- and active co-owner bypass the role table entirely (structural
-- authority, immune to role-table corruption/deletion) — mirrors
-- has_planner_permission / has_rental_permission exactly. Never broadens
-- has_workspace_access itself; this is additive and app-scoped.
-- ---------------------------------------------------------------------------

create or replace function public.has_scheduling_permission(p_owner_id text, p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select
    case
      when p_owner_id = auth.uid()::text then true
      when exists (
        select 1 from workspace_members
        where owner_id = p_owner_id and member_user_id = auth.uid()
          and status = 'active' and role = 'co_owner'
      ) then true
      else exists (
        select 1
        from public.forge_scheduling_user_role_assignments ura
        join public.forge_scheduling_role_capabilities rc
          on rc.owner_id = ura.owner_id and rc.role_id = ura.role_id
        where ura.owner_id = p_owner_id
          and ura.assignee_user_id = auth.uid()::text
          and ura.retired_at is null
          and rc.capability_key = p_capability_key
      )
    end;
$$;

revoke all on function public.has_scheduling_permission(text, text) from public, anon, service_role;
grant execute on function public.has_scheduling_permission(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: owner-scoped SELECT via has_workspace_access (the existing boundary,
-- now live on Scheduling as of 20261110060000) OR a scheduling-specific
-- reader via has_scheduling_permission. No write policies: every write
-- goes through the SECURITY DEFINER RPCs below.
-- ---------------------------------------------------------------------------

alter table public.forge_scheduling_roles enable row level security;
alter table public.forge_scheduling_roles force row level security;
alter table public.forge_scheduling_role_capabilities enable row level security;
alter table public.forge_scheduling_role_capabilities force row level security;
alter table public.forge_scheduling_user_role_assignments enable row level security;
alter table public.forge_scheduling_user_role_assignments force row level security;
alter table public.forge_scheduling_permission_audit enable row level security;
alter table public.forge_scheduling_permission_audit force row level security;

drop policy if exists forge_scheduling_roles_select on public.forge_scheduling_roles;
create policy forge_scheduling_roles_select
  on public.forge_scheduling_roles for select to authenticated
  using (
    public.has_workspace_access(owner_id)
    or public.has_scheduling_permission(owner_id, 'scheduling.roles.manage')
    or public.has_scheduling_permission(owner_id, 'scheduling.roles.read')
  );

drop policy if exists forge_scheduling_role_capabilities_select on public.forge_scheduling_role_capabilities;
create policy forge_scheduling_role_capabilities_select
  on public.forge_scheduling_role_capabilities for select to authenticated
  using (
    public.has_workspace_access(owner_id)
    or public.has_scheduling_permission(owner_id, 'scheduling.roles.manage')
    or public.has_scheduling_permission(owner_id, 'scheduling.roles.read')
  );

drop policy if exists forge_scheduling_user_role_assignments_select on public.forge_scheduling_user_role_assignments;
create policy forge_scheduling_user_role_assignments_select
  on public.forge_scheduling_user_role_assignments for select to authenticated
  using (
    public.has_workspace_access(owner_id)
    or assignee_user_id = auth.uid()::text
    or public.has_scheduling_permission(owner_id, 'scheduling.roles.manage')
    or public.has_scheduling_permission(owner_id, 'scheduling.roles.read')
    or public.has_scheduling_permission(owner_id, 'scheduling.staff.read')
  );

drop policy if exists forge_scheduling_permission_audit_select on public.forge_scheduling_permission_audit;
create policy forge_scheduling_permission_audit_select
  on public.forge_scheduling_permission_audit for select to authenticated
  using (
    public.has_workspace_access(owner_id)
    or public.has_scheduling_permission(owner_id, 'scheduling.roles.manage')
    or public.has_scheduling_permission(owner_id, 'scheduling.audit.read')
  );

revoke all on table public.forge_scheduling_roles from public, anon, service_role, authenticated;
grant select on table public.forge_scheduling_roles to authenticated;
revoke all on table public.forge_scheduling_role_capabilities from public, anon, service_role, authenticated;
grant select on table public.forge_scheduling_role_capabilities to authenticated;
revoke all on table public.forge_scheduling_user_role_assignments from public, anon, service_role, authenticated;
grant select on table public.forge_scheduling_user_role_assignments to authenticated;
revoke all on table public.forge_scheduling_permission_audit from public, anon, service_role, authenticated;
grant select on table public.forge_scheduling_permission_audit to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: forge_scheduling_roles_snapshot
-- ---------------------------------------------------------------------------

create or replace function public.forge_scheduling_roles_snapshot(p_owner_id text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not (
    public.has_workspace_access(p_owner_id)
    or public.has_scheduling_permission(p_owner_id, 'scheduling.roles.manage')
    or public.has_scheduling_permission(p_owner_id, 'scheduling.roles.read')
  ) then
    raise exception 'SADM1_WORKSPACE_FORBIDDEN';
  end if;

  with roles as (
    select id, role_key, name, is_builtin, version
    from public.forge_scheduling_roles
    where owner_id = p_owner_id and retired_at is null
  ),
  caps as (
    select role_id, capability_key
    from public.forge_scheduling_role_capabilities
    where owner_id = p_owner_id
  ),
  assignments as (
    select id, assignee_user_id, role_id, version, assigned_at
    from public.forge_scheduling_user_role_assignments
    where owner_id = p_owner_id and retired_at is null
  )
  select jsonb_build_object(
    'roles', coalesce((select jsonb_agg(to_jsonb(r) order by r.role_key) from roles r), '[]'::jsonb),
    'capabilities', coalesce((select jsonb_agg(to_jsonb(c) order by c.role_id, c.capability_key) from caps c), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(to_jsonb(a) order by a.assignee_user_id) from assignments a), '[]'::jsonb),
    'generations', jsonb_build_object(
      'roles', jsonb_build_object('count', (select count(*) from roles), 'max_version', (select max(version) from roles)),
      'assignments', jsonb_build_object('count', (select count(*) from assignments), 'max_version', (select max(version) from assignments))
    )
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.forge_scheduling_roles_snapshot(text) from public, anon, service_role;
grant execute on function public.forge_scheduling_roles_snapshot(text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: forge_scheduling_role_create — owner/co-owner only.
-- ---------------------------------------------------------------------------

create or replace function public.forge_scheduling_role_create(
  p_owner_id text, p_role_key text, p_name text, p_request_id text, p_reason text default null
)
returns setof public.forge_scheduling_roles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := auth.uid()::text;
  v_id text;
begin
  if v_actor is null then raise exception 'SADM1_INVALID_ACTOR'; end if;
  if not (p_owner_id = v_actor or exists (
    select 1 from workspace_members where owner_id = p_owner_id and member_user_id::text = v_actor and status = 'active' and role = 'co_owner'
  )) then
    raise exception 'SADM1_OWNER_ONLY';
  end if;
  if p_role_key is null or trim(p_role_key) = '' then raise exception 'SADM1_ROLE_KEY_REQUIRED'; end if;
  if p_name is null or trim(p_name) = '' then raise exception 'SADM1_NAME_REQUIRED'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'SADM1_REQUEST_ID_REQUIRED'; end if;

  v_id := 'forge_sr_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.forge_scheduling_roles (owner_id, id, role_key, name, is_builtin, created_by, updated_by)
  values (p_owner_id, v_id, trim(p_role_key), trim(p_name), false, v_actor, v_actor);

  insert into public.forge_scheduling_permission_audit (owner_id, id, actor_id, action, target_role_id, old_values, new_values, reason, request_id)
  values (p_owner_id, 'forge_sa_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'role_create', v_id,
          null, jsonb_build_object('role_key', p_role_key, 'name', p_name), p_reason, p_request_id);

  return query select * from public.forge_scheduling_roles where owner_id = p_owner_id and id = v_id;
end;
$$;

revoke all on function public.forge_scheduling_role_create(text, text, text, text, text) from public, anon, service_role;
grant execute on function public.forge_scheduling_role_create(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: forge_scheduling_role_capability_set — same non-escalation ceiling
-- as Planner's: a non-owner admin may only set a capability they
-- themselves hold, never their own role, never another admin's role
-- (one that itself grants scheduling.roles.manage).
-- ---------------------------------------------------------------------------

create or replace function public.forge_scheduling_role_capability_set(
  p_owner_id text, p_role_id text, p_capability_key text, p_grant boolean,
  p_expected_version integer, p_request_id text, p_reason text default null
)
returns setof public.forge_scheduling_roles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := auth.uid()::text;
  v_is_owner boolean;
  v_role public.forge_scheduling_roles%rowtype;
  v_role_grants_roles_manage boolean;
  v_actor_role_id text;
begin
  if v_actor is null then raise exception 'SADM1_INVALID_ACTOR'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'SADM1_REQUEST_ID_REQUIRED'; end if;

  v_is_owner := (p_owner_id = v_actor) or exists (
    select 1 from workspace_members where owner_id = p_owner_id and member_user_id::text = v_actor and status = 'active' and role = 'co_owner'
  );

  select * into v_role from public.forge_scheduling_roles
  where owner_id = p_owner_id and id = p_role_id and retired_at is null
  for update;
  if not found then raise exception 'SADM1_ROLE_NOT_FOUND'; end if;
  if v_role.role_key = 'owner' then raise exception 'SADM1_OWNER_ROLE_IMMUTABLE'; end if;
  if v_role.version <> p_expected_version then raise exception 'SADM1_VERSION_CONFLICT'; end if;

  if not v_is_owner then
    if not public.has_scheduling_permission(p_owner_id, 'scheduling.roles.manage') then
      raise exception 'SADM1_FORBIDDEN';
    end if;
    select ura.role_id into v_actor_role_id
    from public.forge_scheduling_user_role_assignments ura
    where ura.owner_id = p_owner_id and ura.assignee_user_id = v_actor and ura.retired_at is null;
    if v_actor_role_id = p_role_id then
      raise exception 'SADM1_CANNOT_EDIT_OWN_ROLE';
    end if;
    select exists (
      select 1 from public.forge_scheduling_role_capabilities
      where owner_id = p_owner_id and role_id = p_role_id and capability_key = 'scheduling.roles.manage'
    ) into v_role_grants_roles_manage;
    if v_role_grants_roles_manage then
      raise exception 'SADM1_CANNOT_EDIT_ANOTHER_ADMIN_ROLE';
    end if;
    if p_grant and not public.has_scheduling_permission(p_owner_id, p_capability_key) then
      raise exception 'SADM1_CANNOT_GRANT_UNHELD_CAPABILITY';
    end if;
  end if;

  if p_grant then
    insert into public.forge_scheduling_role_capabilities (owner_id, id, role_id, capability_key, created_by)
    values (p_owner_id, 'forge_src_' || replace(gen_random_uuid()::text, '-', ''), p_role_id, p_capability_key, v_actor)
    on conflict (owner_id, role_id, capability_key) do nothing;
  else
    delete from public.forge_scheduling_role_capabilities
    where owner_id = p_owner_id and role_id = p_role_id and capability_key = p_capability_key;
  end if;

  update public.forge_scheduling_roles
  set version = version + 1, updated_by = v_actor, updated_at = now()
  where owner_id = p_owner_id and id = p_role_id;

  insert into public.forge_scheduling_permission_audit (owner_id, id, actor_id, action, target_role_id, old_values, new_values, reason, request_id)
  values (p_owner_id, 'forge_sa_' || replace(gen_random_uuid()::text, '-', ''), v_actor,
          case when p_grant then 'capability_add' else 'capability_remove' end, p_role_id,
          jsonb_build_object('capability_key', p_capability_key), jsonb_build_object('capability_key', p_capability_key, 'granted', p_grant),
          p_reason, p_request_id);

  return query select * from public.forge_scheduling_roles where owner_id = p_owner_id and id = p_role_id;
end;
$$;

revoke all on function public.forge_scheduling_role_capability_set(text, text, text, boolean, integer, text, text) from public, anon, service_role;
grant execute on function public.forge_scheduling_role_capability_set(text, text, text, boolean, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: forge_scheduling_role_assign
-- ---------------------------------------------------------------------------

create or replace function public.forge_scheduling_role_assign(
  p_owner_id text, p_assignee_user_id text, p_role_id text, p_request_id text, p_reason text default null
)
returns setof public.forge_scheduling_user_role_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := auth.uid()::text;
  v_is_owner boolean;
  v_role public.forge_scheduling_roles%rowtype;
  v_existing public.forge_scheduling_user_role_assignments%rowtype;
  v_new_id text;
  v_role_grants_roles_manage boolean;
  v_unheld_cap text;
begin
  if v_actor is null then raise exception 'SADM1_INVALID_ACTOR'; end if;
  if p_assignee_user_id is null or trim(p_assignee_user_id) = '' then raise exception 'SADM1_ASSIGNEE_REQUIRED'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'SADM1_REQUEST_ID_REQUIRED'; end if;

  if p_assignee_user_id = p_owner_id or exists (
    select 1 from workspace_members where owner_id = p_owner_id and member_user_id::text = p_assignee_user_id and status = 'active' and role = 'co_owner'
  ) then
    raise exception 'SADM1_CANNOT_ASSIGN_OWNER_OR_COOWNER';
  end if;
  if p_assignee_user_id = v_actor then raise exception 'SADM1_CANNOT_EDIT_OWN_ROLE'; end if;

  v_is_owner := (p_owner_id = v_actor) or exists (
    select 1 from workspace_members where owner_id = p_owner_id and member_user_id::text = v_actor and status = 'active' and role = 'co_owner'
  );

  select * into v_role from public.forge_scheduling_roles where owner_id = p_owner_id and id = p_role_id and retired_at is null;
  if not found then raise exception 'SADM1_ROLE_NOT_FOUND'; end if;

  if not v_is_owner then
    if not public.has_scheduling_permission(p_owner_id, 'scheduling.roles.manage') then
      raise exception 'SADM1_FORBIDDEN';
    end if;
    select exists (
      select 1 from public.forge_scheduling_role_capabilities
      where owner_id = p_owner_id and role_id = p_role_id and capability_key = 'scheduling.roles.manage'
    ) into v_role_grants_roles_manage;
    if v_role_grants_roles_manage then
      raise exception 'SADM1_CANNOT_GRANT_ANOTHER_ADMIN_AUTHORITY';
    end if;
    select rc.capability_key into v_unheld_cap
    from public.forge_scheduling_role_capabilities rc
    where rc.owner_id = p_owner_id and rc.role_id = p_role_id
      and not public.has_scheduling_permission(p_owner_id, rc.capability_key)
    limit 1;
    if v_unheld_cap is not null then
      raise exception 'SADM1_CANNOT_ASSIGN_ROLE_EXCEEDING_OWN_CAPABILITIES';
    end if;
  end if;

  select * into v_existing from public.forge_scheduling_user_role_assignments
  where owner_id = p_owner_id and assignee_user_id = p_assignee_user_id and retired_at is null
  for update;

  if found then
    update public.forge_scheduling_user_role_assignments
    set role_id = p_role_id, version = version + 1, updated_by = v_actor, updated_at = now()
    where owner_id = p_owner_id and id = v_existing.id;
    v_new_id := v_existing.id;
    insert into public.forge_scheduling_permission_audit (owner_id, id, actor_id, action, target_role_id, target_user_id, old_values, new_values, reason, request_id)
    values (p_owner_id, 'forge_sa_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'assignment_create', p_role_id, p_assignee_user_id,
            jsonb_build_object('role_id', v_existing.role_id), jsonb_build_object('role_id', p_role_id), p_reason, p_request_id);
  else
    v_new_id := 'forge_sura_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.forge_scheduling_user_role_assignments (owner_id, id, assignee_user_id, role_id, assigned_by, updated_by)
    values (p_owner_id, v_new_id, p_assignee_user_id, p_role_id, v_actor, v_actor);
    insert into public.forge_scheduling_permission_audit (owner_id, id, actor_id, action, target_role_id, target_user_id, old_values, new_values, reason, request_id)
    values (p_owner_id, 'forge_sa_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'assignment_create', p_role_id, p_assignee_user_id,
            null, jsonb_build_object('role_id', p_role_id), p_reason, p_request_id);
  end if;

  return query select * from public.forge_scheduling_user_role_assignments where owner_id = p_owner_id and id = v_new_id;
end;
$$;

revoke all on function public.forge_scheduling_role_assign(text, text, text, text, text) from public, anon, service_role;
grant execute on function public.forge_scheduling_role_assign(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: forge_scheduling_role_assignment_revoke
-- ---------------------------------------------------------------------------

create or replace function public.forge_scheduling_role_assignment_revoke(
  p_owner_id text, p_assignment_id text, p_expected_version integer, p_request_id text, p_reason text default null
)
returns setof public.forge_scheduling_user_role_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := auth.uid()::text;
  v_is_owner boolean;
  v_row public.forge_scheduling_user_role_assignments%rowtype;
begin
  if v_actor is null then raise exception 'SADM1_INVALID_ACTOR'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'SADM1_REQUEST_ID_REQUIRED'; end if;

  select * into v_row from public.forge_scheduling_user_role_assignments
  where owner_id = p_owner_id and id = p_assignment_id and retired_at is null
  for update;
  if not found then raise exception 'SADM1_ASSIGNMENT_NOT_FOUND'; end if;
  if v_row.assignee_user_id = v_actor then raise exception 'SADM1_CANNOT_EDIT_OWN_ROLE'; end if;
  if v_row.version <> p_expected_version then raise exception 'SADM1_VERSION_CONFLICT'; end if;

  v_is_owner := (p_owner_id = v_actor) or exists (
    select 1 from workspace_members where owner_id = p_owner_id and member_user_id::text = v_actor and status = 'active' and role = 'co_owner'
  );
  if not v_is_owner and not public.has_scheduling_permission(p_owner_id, 'scheduling.roles.manage') then
    raise exception 'SADM1_FORBIDDEN';
  end if;

  update public.forge_scheduling_user_role_assignments
  set retired_at = now(), retired_by = v_actor, version = version + 1, updated_by = v_actor, updated_at = now()
  where owner_id = p_owner_id and id = p_assignment_id;

  insert into public.forge_scheduling_permission_audit (owner_id, id, actor_id, action, target_role_id, target_user_id, old_values, new_values, reason, request_id)
  values (p_owner_id, 'forge_sa_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'assignment_revoke', v_row.role_id, v_row.assignee_user_id,
          jsonb_build_object('role_id', v_row.role_id), null, p_reason, p_request_id);

  return query select * from public.forge_scheduling_user_role_assignments where owner_id = p_owner_id and id = p_assignment_id;
end;
$$;

revoke all on function public.forge_scheduling_role_assignment_revoke(text, text, integer, text, text) from public, anon, service_role;
grant execute on function public.forge_scheduling_role_assignment_revoke(text, text, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: forge_scheduling_roles_provision_starter_set — owner/co-owner only.
-- Five starter roles: Admin, Scheduler, Crew Lead, Viewer, plus the
-- structural Owner (never seeded as a row — see Planner's identical note).
-- Capability sets grounded in the 21-key catalog above, not the brief's
-- unverified groups:
--   * Admin: every .read key, every operational create/edit/resequence/
--     allocate/release/configure action. Deliberately EXCLUDES
--     settings.edit, staff.invite, and roles.manage — "roles.manage only
--     on explicit delegation" per the brief, extended here to the other
--     two administration-category writes, mirroring Planner's own
--     planner_admin starter set (which likewise omits planner.settings.edit
--     and planner.staff.invite even though "Planner Admin" sounds like it
--     should have them — verified by reading the migration, not assumed).
--   * Scheduler: reads on schedules/activities/resources/calendars, plus
--     schedules.edit, activities.edit, activities.resequence,
--     resources.allocate, resources.release ("routine edits/assignments/
--     reschedule"). No calendars.configure, no settings/staff/roles/audit.
--   * Crew Lead: READ-ONLY, same set as Viewer below — the brief's own
--     instruction ("default read-only until per-job scoping is proven
--     safe; per-job scoping is OUT of slice 1") means this role grants
--     nothing beyond Viewer today. A future slice that proves per-job
--     scoping safe should widen this role's capabilities then, not now.
--   * Viewer: schedules.read, activities.read, calendars.read only — the
--     brief's own list for Viewer omits resources, so this starter set
--     does too (verified against the brief's exact wording, not
--     generalized to "all reads").
-- ---------------------------------------------------------------------------

create or replace function public.forge_scheduling_roles_provision_starter_set(
  p_owner_id text, p_request_id text
)
returns setof public.forge_scheduling_roles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := auth.uid()::text;
  v_is_owner boolean;
  v_starter jsonb := '[
    {"role_key":"admin","name":"Admin","capabilities":["scheduling.schedules.read","scheduling.activities.read","scheduling.resources.read","scheduling.calendars.read","scheduling.settings.read","scheduling.staff.read","scheduling.roles.read","scheduling.audit.read","scheduling.schedules.create","scheduling.schedules.edit","scheduling.activities.create","scheduling.activities.edit","scheduling.activities.resequence","scheduling.resources.create","scheduling.resources.edit","scheduling.resources.allocate","scheduling.resources.release","scheduling.calendars.configure"]},
    {"role_key":"scheduler","name":"Scheduler","capabilities":["scheduling.schedules.read","scheduling.activities.read","scheduling.resources.read","scheduling.calendars.read","scheduling.schedules.edit","scheduling.activities.edit","scheduling.activities.resequence","scheduling.resources.allocate","scheduling.resources.release"]},
    {"role_key":"crew_lead","name":"Crew Lead","capabilities":["scheduling.schedules.read","scheduling.activities.read","scheduling.calendars.read"]},
    {"role_key":"viewer","name":"Viewer","capabilities":["scheduling.schedules.read","scheduling.activities.read","scheduling.calendars.read"]}
  ]'::jsonb;
  v_def jsonb;
  v_role_id text;
  v_cap text;
begin
  if v_actor is null then raise exception 'SADM1_INVALID_ACTOR'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'SADM1_REQUEST_ID_REQUIRED'; end if;

  v_is_owner := (p_owner_id = v_actor) or exists (
    select 1 from workspace_members where owner_id = p_owner_id and member_user_id::text = v_actor and status = 'active' and role = 'co_owner'
  );
  if not v_is_owner then
    raise exception 'SADM1_OWNER_ONLY';
  end if;

  for v_def in select * from jsonb_array_elements(v_starter)
  loop
    if exists (select 1 from public.forge_scheduling_roles where owner_id = p_owner_id and role_key = v_def->>'role_key') then
      continue;
    end if;

    v_role_id := 'forge_sr_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.forge_scheduling_roles (owner_id, id, role_key, name, is_builtin, created_by, updated_by)
    values (p_owner_id, v_role_id, v_def->>'role_key', v_def->>'name', true, v_actor, v_actor);

    for v_cap in select jsonb_array_elements_text(v_def->'capabilities')
    loop
      insert into public.forge_scheduling_role_capabilities (owner_id, id, role_id, capability_key, created_by)
      values (p_owner_id, 'forge_src_' || replace(gen_random_uuid()::text, '-', ''), v_role_id, v_cap, v_actor);
    end loop;

    insert into public.forge_scheduling_permission_audit (owner_id, id, actor_id, action, target_role_id, old_values, new_values, reason, request_id)
    values (p_owner_id, 'forge_sa_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'role_create', v_role_id,
            null, jsonb_build_object('role_key', v_def->>'role_key', 'name', v_def->>'name', 'capabilities', v_def->'capabilities'),
            'starter role provisioning', p_request_id);
  end loop;

  return query
    select * from public.forge_scheduling_roles
    where owner_id = p_owner_id and is_builtin = true and retired_at is null
    order by role_key;
end;
$$;

revoke all on function public.forge_scheduling_roles_provision_starter_set(text, text) from public, anon, service_role;
grant execute on function public.forge_scheduling_roles_provision_starter_set(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: forge_scheduling_staff_search — exact user-id-or-verified-email
-- lookup only, no account enumeration. Identical shape and reasoning to
-- forge_planner_staff_search / the Rental equivalent.
-- ---------------------------------------------------------------------------

create or replace function public.forge_scheduling_staff_search(
  p_owner_id text, p_user_id text default null, p_email text default null
)
returns table (user_id text, email text)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_normalized_email text := lower(btrim(coalesce(p_email, '')));
  v_user_id text := nullif(btrim(coalesce(p_user_id, '')), '');
begin
  if not (
    public.has_workspace_access(p_owner_id)
    or public.has_scheduling_permission(p_owner_id, 'scheduling.roles.manage')
    or public.has_scheduling_permission(p_owner_id, 'scheduling.staff.read')
  ) then
    raise exception 'SADM1_FORBIDDEN';
  end if;

  if (v_user_id is null) = (v_normalized_email = '') then
    return;
  end if;

  if v_user_id is not null then
    return query
      select u.id::text, u.email::text
      from auth.users u
      where u.id::text = v_user_id;
    return;
  end if;

  return query
    select u.id::text, u.email::text
    from auth.users u
    where lower(btrim(u.email)) = v_normalized_email
      and u.email_confirmed_at is not null;
end;
$$;

revoke all on function public.forge_scheduling_staff_search(text, text, text) from public, anon, service_role;
grant execute on function public.forge_scheduling_staff_search(text, text, text) to authenticated;
