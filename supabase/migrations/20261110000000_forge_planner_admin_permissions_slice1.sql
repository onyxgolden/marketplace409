-- =============================================================================
-- Work Package Planner — Admin Permissions, Slice 1
-- =============================================================================
-- FILE ONLY. DO NOT APPLY without Jason's separate word.
--
-- Scope: results/chatgpt/work-package-planner-admin-permissions-scope-2026-11-08.md
-- Build authorization: commands/claude/planner-admin-permissions-slice1-2026-11-10.md
--
-- Shared role framework, Planner-scoped (one physical table set per app,
-- per the brief's own "each app has its own permission catalog" — the
-- reusable part is the pattern, not a cross-app shared table; Rental's
-- parallel slice 1 build is a separate worktree/PR and is not touched or
-- depended on here).
--
-- THE HARD RULE: no drawing-edit capability exists anywhere in this
-- catalog. Verified before writing this file (not assumed): grepped
-- every `update public.forge_work_drawings` in this repo's migrations —
-- both existing occurrences (slice 7, IFC release retirement) touch only
-- `retired_at`/`retired_by`, never content/path/hash. This migration
-- adds no new write path to that table at all.
--
-- One role per user per owner workspace (no per-user overrides, no
-- multiple roles). Owner/co-owner authority is a raw, structural
-- bypass of the role table entirely (has_planner_permission checks
-- owner_id = auth.uid() and the existing workspace_members co-owner
-- predicate FIRST, before ever consulting role assignments) — so even
-- if every role row were deleted or corrupted, the real owner and an
-- active co-owner retain full non-drawing-edit access. This is the
-- "Owner retains ultimate authority" requirement built as a structural
-- invariant, not merely a seeded role.
--
-- Live collision check, 2026-11-10 (before writing this file):
--   * Latest repo migration file is 20261109010000 (slice 8). This file
--     is dated after it.
--   * No table or function with these names exists in any prior
--     migration file in this repo (grepped forge_planner_roles,
--     forge_planner_role_capabilities, forge_planner_user_role_assignments,
--     forge_planner_permission_audit, has_planner_permission — zero hits).
--   * No live-database check was performed (no connection path from this
--     session) — this is a repo-file-level collision check only, same
--     limit every other slice's own "live collision check" note in this
--     repo has when connectivity isn't available; flagged plainly rather
--     than claimed as more than it is.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The fixed capability catalog, per the scope brief's table verbatim.
-- A CHECK constraint array, matching this repo's established pattern for
-- fixed enumerations (package_type, WP_STATUS) rather than a separate
-- lookup table — the catalog is part of the schema's own integrity, not
-- editable data.
-- ---------------------------------------------------------------------------

do $$
declare
  v_catalog text[] := array[
    'planner.packages.read','planner.packages.create','planner.packages.edit','planner.packages.close','planner.packages.cancel',
    'planner.drawings.read','planner.drawings.upload','planner.drawings.link','planner.drawings.unlink','planner.drawings.delete',
    'planner.steps.read','planner.steps.create','planner.steps.edit','planner.steps.reorder','planner.steps.retire',
    'planner.crafts.read','planner.crafts.assign','planner.crafts.reassign','planner.crafts.clear',
    'planner.manpower.read','planner.manpower.placements.edit',
    'planner.baselines.read','planner.baselines.freeze','planner.baselines.select',
    'planner.progress.read','planner.progress.add','planner.progress.correct','planner.progress.void',
    'planner.permits.read','planner.permits.annotations.link','planner.permits.annotations.unlink',
    'planner.reports.read','planner.reports.export',
    'planner.settings.read','planner.settings.edit',
    'planner.staff.read','planner.staff.invite',
    'planner.roles.read','planner.roles.manage',
    'planner.audit.read'
  ];
begin
  -- Explicit, permanent assertion: no drawing-edit key is in the catalog,
  -- and never will be via this file. Fails the migration outright if
  -- anyone ever edits this array to add one.
  if v_catalog && array['planner.drawings.edit'] then
    raise exception 'FORBIDDEN: planner.drawings.edit must never exist in the capability catalog';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.forge_planner_roles (
  owner_id text not null,
  id text not null,
  role_key text not null, -- stable machine key, e.g. 'owner', 'planner_admin', or a custom slug for an owner-created role.
  name text not null,
  is_builtin boolean not null default false, -- the six starter roles; 'owner' is also immutable (see trigger below).
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

create unique index if not exists forge_planner_roles_active_key_uq
  on public.forge_planner_roles (owner_id, role_key)
  where retired_at is null;

create table if not exists public.forge_planner_role_capabilities (
  owner_id text not null,
  id text not null,
  role_id text not null,
  capability_key text not null check (capability_key in (
    'planner.packages.read','planner.packages.create','planner.packages.edit','planner.packages.close','planner.packages.cancel',
    'planner.drawings.read','planner.drawings.upload','planner.drawings.link','planner.drawings.unlink','planner.drawings.delete',
    'planner.steps.read','planner.steps.create','planner.steps.edit','planner.steps.reorder','planner.steps.retire',
    'planner.crafts.read','planner.crafts.assign','planner.crafts.reassign','planner.crafts.clear',
    'planner.manpower.read','planner.manpower.placements.edit',
    'planner.baselines.read','planner.baselines.freeze','planner.baselines.select',
    'planner.progress.read','planner.progress.add','planner.progress.correct','planner.progress.void',
    'planner.permits.read','planner.permits.annotations.link','planner.permits.annotations.unlink',
    'planner.reports.read','planner.reports.export',
    'planner.settings.read','planner.settings.edit',
    'planner.staff.read','planner.staff.invite',
    'planner.roles.read','planner.roles.manage',
    'planner.audit.read'
  )),
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, role_id, capability_key),
  foreign key (owner_id, role_id) references public.forge_planner_roles (owner_id, id) on delete restrict
);

create index if not exists forge_planner_role_capabilities_role_idx
  on public.forge_planner_role_capabilities (owner_id, role_id);

create table if not exists public.forge_planner_user_role_assignments (
  owner_id text not null,
  id text not null,
  assignee_user_id text not null,
  role_id text not null,
  version integer not null default 1 check (version >= 1),
  retired_at timestamptz, -- revocation.
  retired_by text,
  assigned_by text not null,
  assigned_at timestamptz not null default now(),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, role_id) references public.forge_planner_roles (owner_id, id) on delete restrict,
  check (retired_at is null or retired_by is not null)
);

-- One active role per user per owner workspace — the slice 1 "no
-- multiple roles per user" invariant, enforced structurally, not just
-- by RPC discipline.
create unique index if not exists forge_planner_user_role_assignments_active_uq
  on public.forge_planner_user_role_assignments (owner_id, assignee_user_id)
  where retired_at is null;

create table if not exists public.forge_planner_permission_audit (
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

create index if not exists forge_planner_permission_audit_owner_idx
  on public.forge_planner_permission_audit (owner_id, recorded_at desc);
create index if not exists forge_planner_permission_audit_role_idx
  on public.forge_planner_permission_audit (owner_id, target_role_id, recorded_at desc)
  where target_role_id is not null;
create index if not exists forge_planner_permission_audit_user_idx
  on public.forge_planner_permission_audit (owner_id, target_user_id, recorded_at desc)
  where target_user_id is not null;

-- ---------------------------------------------------------------------------
-- has_planner_permission — the gate every planner write RPC must use, and
-- (below) that the SELECT policies on these same four tables also use.
-- Owner and active co-owner bypass the role table entirely (structural
-- "ultimate authority," immune to role-table corruption or deletion).
-- Anyone else: looked up via their single active role assignment and
-- that role's granted capabilities. No capability_key outside the fixed
-- catalog can ever match (the CHECK constraint on
-- forge_planner_role_capabilities.capability_key makes an invalid key
-- structurally unrepresentable, not just unlikely). Defined BEFORE the
-- RLS policies below, since they call it; `row_security = off` is
-- required so this trusted lookup isn't itself blocked by the very RLS
-- it's deciding (same established pattern as has_workspace_access /
-- has_rental_permission elsewhere in this repo).
-- ---------------------------------------------------------------------------

create or replace function public.has_planner_permission(p_owner_id text, p_capability_key text)
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
        from public.forge_planner_user_role_assignments ura
        join public.forge_planner_role_capabilities rc
          on rc.owner_id = ura.owner_id and rc.role_id = ura.role_id
        where ura.owner_id = p_owner_id
          and ura.assignee_user_id = auth.uid()::text
          and ura.retired_at is null
          and rc.capability_key = p_capability_key
      )
    end;
$$;

revoke all on function public.has_planner_permission(text, text) from public, anon, service_role;
grant execute on function public.has_planner_permission(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: owner-scoped SELECT via has_workspace_access (the existing,
-- unmodified authorization boundary) OR a planner-specific reader via
-- has_planner_permission (new, additive, app-scoped — never broadens
-- has_workspace_access itself). No write policies: every write goes
-- through the SECURITY DEFINER RPCs below.
-- ---------------------------------------------------------------------------

alter table public.forge_planner_roles enable row level security;
alter table public.forge_planner_roles force row level security;
alter table public.forge_planner_role_capabilities enable row level security;
alter table public.forge_planner_role_capabilities force row level security;
alter table public.forge_planner_user_role_assignments enable row level security;
alter table public.forge_planner_user_role_assignments force row level security;
alter table public.forge_planner_permission_audit enable row level security;
alter table public.forge_planner_permission_audit force row level security;

-- Read access: the coarse owner/co-owner boundary (has_workspace_access)
-- OR a planner-specific reader. A non-owner "Planner Admin" who holds
-- planner.roles.manage/.read must be able to see the role catalog and
-- assignments to administer them -- has_workspace_access alone would
-- lock every non-co-owner admin out of their own admin page. A user may
-- always see their own assignment row (so staff can see their own
-- effective role) even without planner.staff.read.
drop policy if exists forge_planner_roles_select on public.forge_planner_roles;
create policy forge_planner_roles_select
  on public.forge_planner_roles for select to authenticated
  using (
    public.has_workspace_access(owner_id)
    or public.has_planner_permission(owner_id, 'planner.roles.manage')
    or public.has_planner_permission(owner_id, 'planner.roles.read')
  );

drop policy if exists forge_planner_role_capabilities_select on public.forge_planner_role_capabilities;
create policy forge_planner_role_capabilities_select
  on public.forge_planner_role_capabilities for select to authenticated
  using (
    public.has_workspace_access(owner_id)
    or public.has_planner_permission(owner_id, 'planner.roles.manage')
    or public.has_planner_permission(owner_id, 'planner.roles.read')
  );

drop policy if exists forge_planner_user_role_assignments_select on public.forge_planner_user_role_assignments;
create policy forge_planner_user_role_assignments_select
  on public.forge_planner_user_role_assignments for select to authenticated
  using (
    public.has_workspace_access(owner_id)
    or assignee_user_id = auth.uid()::text
    or public.has_planner_permission(owner_id, 'planner.roles.manage')
    or public.has_planner_permission(owner_id, 'planner.roles.read')
    or public.has_planner_permission(owner_id, 'planner.staff.read')
  );

drop policy if exists forge_planner_permission_audit_select on public.forge_planner_permission_audit;
create policy forge_planner_permission_audit_select
  on public.forge_planner_permission_audit for select to authenticated
  using (
    public.has_workspace_access(owner_id)
    or public.has_planner_permission(owner_id, 'planner.roles.manage')
    or public.has_planner_permission(owner_id, 'planner.audit.read')
  );

revoke all on table public.forge_planner_roles from public, anon, service_role, authenticated;
grant select on table public.forge_planner_roles to authenticated;
revoke all on table public.forge_planner_role_capabilities from public, anon, service_role, authenticated;
grant select on table public.forge_planner_role_capabilities to authenticated;
revoke all on table public.forge_planner_user_role_assignments from public, anon, service_role, authenticated;
grant select on table public.forge_planner_user_role_assignments to authenticated;
revoke all on table public.forge_planner_permission_audit from public, anon, service_role, authenticated;
grant select on table public.forge_planner_permission_audit to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: forge_planner_roles_snapshot — one statement, the whole admin
-- page's read: every role, every role's capabilities, every active
-- assignment, plus which capabilities the CALLER themselves effectively
-- holds (for UI affordance only — every write RPC re-checks
-- has_planner_permission server-side regardless of what this returns).
-- ---------------------------------------------------------------------------

create or replace function public.forge_planner_roles_snapshot(p_owner_id text)
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
    or public.has_planner_permission(p_owner_id, 'planner.roles.manage')
    or public.has_planner_permission(p_owner_id, 'planner.roles.read')
  ) then
    raise exception 'PADM1_WORKSPACE_FORBIDDEN';
  end if;

  with roles as (
    select id, role_key, name, is_builtin, version
    from public.forge_planner_roles
    where owner_id = p_owner_id and retired_at is null
  ),
  caps as (
    select role_id, capability_key
    from public.forge_planner_role_capabilities
    where owner_id = p_owner_id
  ),
  assignments as (
    select id, assignee_user_id, role_id, version, assigned_at
    from public.forge_planner_user_role_assignments
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

revoke all on function public.forge_planner_roles_snapshot(text) from public, anon, service_role;
grant execute on function public.forge_planner_roles_snapshot(text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: forge_planner_role_create — owner/co-owner only (NOT gated by
-- planner.roles.manage, since role *creation* is an ownership-level act
-- per the brief: "designated admins may edit ordinary roles" — creating
-- a brand-new role is reserved to owner/co-owner).
-- ---------------------------------------------------------------------------

create or replace function public.forge_planner_role_create(
  p_owner_id text, p_role_key text, p_name text, p_request_id text, p_reason text default null
)
returns setof public.forge_planner_roles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := auth.uid()::text;
  v_id text;
begin
  if v_actor is null then raise exception 'PADM1_INVALID_ACTOR'; end if;
  if not (p_owner_id = v_actor or exists (
    select 1 from workspace_members where owner_id = p_owner_id and member_user_id = v_actor and status = 'active' and role = 'co_owner'
  )) then
    raise exception 'PADM1_OWNER_ONLY';
  end if;
  if p_role_key is null or trim(p_role_key) = '' then raise exception 'PADM1_ROLE_KEY_REQUIRED'; end if;
  if p_name is null or trim(p_name) = '' then raise exception 'PADM1_NAME_REQUIRED'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'PADM1_REQUEST_ID_REQUIRED'; end if;

  v_id := 'forge_pr_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.forge_planner_roles (owner_id, id, role_key, name, is_builtin, created_by, updated_by)
  values (p_owner_id, v_id, trim(p_role_key), trim(p_name), false, v_actor, v_actor);

  insert into public.forge_planner_permission_audit (owner_id, id, actor_id, action, target_role_id, old_values, new_values, reason, request_id)
  values (p_owner_id, 'forge_pa_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'role_create', v_id,
          null, jsonb_build_object('role_key', p_role_key, 'name', p_name), p_reason, p_request_id);

  return query select * from public.forge_planner_roles where owner_id = p_owner_id and id = v_id;
end;
$$;

revoke all on function public.forge_planner_role_create(text, text, text, text, text) from public, anon, service_role;
grant execute on function public.forge_planner_role_create(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: forge_planner_role_capability_set — grant or revoke one
-- capability on one role. Owner/co-owner may set anything in the
-- catalog. A non-owner admin (someone holding planner.roles.manage) may
-- only set a capability THEY THEMSELVES currently hold — the
-- server-enforced non-escalation ceiling. An admin may never edit
-- the 'owner' builtin role, their own role, or any role whose current
-- assignees include an owner/co-owner-equivalent admin (enforced below
-- by refusing any edit to a role that itself grants planner.roles.manage
-- unless the actor is the real owner/co-owner).
-- ---------------------------------------------------------------------------

create or replace function public.forge_planner_role_capability_set(
  p_owner_id text, p_role_id text, p_capability_key text, p_grant boolean,
  p_expected_version integer, p_request_id text, p_reason text default null
)
returns setof public.forge_planner_roles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := auth.uid()::text;
  v_is_owner boolean;
  v_role public.forge_planner_roles%rowtype;
  v_role_grants_roles_manage boolean;
  v_actor_assignment public.forge_planner_user_role_assignments%rowtype;
  v_actor_role_id text;
begin
  if v_actor is null then raise exception 'PADM1_INVALID_ACTOR'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'PADM1_REQUEST_ID_REQUIRED'; end if;

  v_is_owner := (p_owner_id = v_actor) or exists (
    select 1 from workspace_members where owner_id = p_owner_id and member_user_id = v_actor and status = 'active' and role = 'co_owner'
  );

  select * into v_role from public.forge_planner_roles
  where owner_id = p_owner_id and id = p_role_id and retired_at is null
  for update;
  if not found then raise exception 'PADM1_ROLE_NOT_FOUND'; end if;
  if v_role.role_key = 'owner' then raise exception 'PADM1_OWNER_ROLE_IMMUTABLE'; end if;
  if v_role.version <> p_expected_version then raise exception 'PADM1_VERSION_CONFLICT'; end if;

  if not v_is_owner then
    -- Non-owner path: actor must hold planner.roles.manage themselves,
    -- must currently hold the capability they are trying to grant (never
    -- grant what they lack), must not be editing their own role, and
    -- must not be editing a role that itself carries planner.roles.manage
    -- (never edit "another admin's authority").
    if not public.has_planner_permission(p_owner_id, 'planner.roles.manage') then
      raise exception 'PADM1_FORBIDDEN';
    end if;
    select ura.role_id into v_actor_role_id
    from public.forge_planner_user_role_assignments ura
    where ura.owner_id = p_owner_id and ura.assignee_user_id = v_actor and ura.retired_at is null;
    if v_actor_role_id = p_role_id then
      raise exception 'PADM1_CANNOT_EDIT_OWN_ROLE';
    end if;
    select exists (
      select 1 from public.forge_planner_role_capabilities
      where owner_id = p_owner_id and role_id = p_role_id and capability_key = 'planner.roles.manage'
    ) into v_role_grants_roles_manage;
    if v_role_grants_roles_manage then
      raise exception 'PADM1_CANNOT_EDIT_ANOTHER_ADMIN_ROLE';
    end if;
    if p_grant and not public.has_planner_permission(p_owner_id, p_capability_key) then
      raise exception 'PADM1_CANNOT_GRANT_UNHELD_CAPABILITY';
    end if;
  end if;

  if p_grant then
    insert into public.forge_planner_role_capabilities (owner_id, id, role_id, capability_key, created_by)
    values (p_owner_id, 'forge_prc_' || replace(gen_random_uuid()::text, '-', ''), p_role_id, p_capability_key, v_actor)
    on conflict (owner_id, role_id, capability_key) do nothing;
  else
    delete from public.forge_planner_role_capabilities
    where owner_id = p_owner_id and role_id = p_role_id and capability_key = p_capability_key;
  end if;

  update public.forge_planner_roles
  set version = version + 1, updated_by = v_actor, updated_at = now()
  where owner_id = p_owner_id and id = p_role_id;

  insert into public.forge_planner_permission_audit (owner_id, id, actor_id, action, target_role_id, old_values, new_values, reason, request_id)
  values (p_owner_id, 'forge_pa_' || replace(gen_random_uuid()::text, '-', ''), v_actor,
          case when p_grant then 'capability_add' else 'capability_remove' end, p_role_id,
          jsonb_build_object('capability_key', p_capability_key), jsonb_build_object('capability_key', p_capability_key, 'granted', p_grant),
          p_reason, p_request_id);

  return query select * from public.forge_planner_roles where owner_id = p_owner_id and id = p_role_id;
end;
$$;

revoke all on function public.forge_planner_role_capability_set(text, text, text, boolean, integer, text, text) from public, anon, service_role;
grant execute on function public.forge_planner_role_capability_set(text, text, text, boolean, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: forge_planner_role_assign — assign (or change) a user's single
-- active role. Same non-escalation discipline as capability_set: a
-- non-owner admin may only assign a role whose capability set is a
-- subset of what the admin currently holds themselves, and may never
-- assign/reassign an owner-equivalent (a role granting
-- planner.roles.manage) to anyone, nor touch their own assignment.
-- ---------------------------------------------------------------------------

create or replace function public.forge_planner_role_assign(
  p_owner_id text, p_assignee_user_id text, p_role_id text, p_request_id text, p_reason text default null
)
returns setof public.forge_planner_user_role_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := auth.uid()::text;
  v_is_owner boolean;
  v_role public.forge_planner_roles%rowtype;
  v_existing public.forge_planner_user_role_assignments%rowtype;
  v_new_id text;
  v_role_grants_roles_manage boolean;
  v_unheld_cap text;
begin
  if v_actor is null then raise exception 'PADM1_INVALID_ACTOR'; end if;
  if p_assignee_user_id is null or trim(p_assignee_user_id) = '' then raise exception 'PADM1_ASSIGNEE_REQUIRED'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'PADM1_REQUEST_ID_REQUIRED'; end if;

  -- Never assign a role to the real owner or an active co-owner through
  -- this path — their authority is structural, not role-table-driven.
  -- Checked BEFORE the generic self-edit guard below: when the actor IS
  -- the owner and names themselves as assignee, the more specific
  -- owner/co-owner reason must win, not the generic one.
  if p_assignee_user_id = p_owner_id or exists (
    select 1 from workspace_members where owner_id = p_owner_id and member_user_id = p_assignee_user_id and status = 'active' and role = 'co_owner'
  ) then
    raise exception 'PADM1_CANNOT_ASSIGN_OWNER_OR_COOWNER';
  end if;
  if p_assignee_user_id = v_actor then raise exception 'PADM1_CANNOT_EDIT_OWN_ROLE'; end if;

  v_is_owner := (p_owner_id = v_actor) or exists (
    select 1 from workspace_members where owner_id = p_owner_id and member_user_id = v_actor and status = 'active' and role = 'co_owner'
  );

  select * into v_role from public.forge_planner_roles where owner_id = p_owner_id and id = p_role_id and retired_at is null;
  if not found then raise exception 'PADM1_ROLE_NOT_FOUND'; end if;

  if not v_is_owner then
    if not public.has_planner_permission(p_owner_id, 'planner.roles.manage') then
      raise exception 'PADM1_FORBIDDEN';
    end if;
    select exists (
      select 1 from public.forge_planner_role_capabilities
      where owner_id = p_owner_id and role_id = p_role_id and capability_key = 'planner.roles.manage'
    ) into v_role_grants_roles_manage;
    if v_role_grants_roles_manage then
      raise exception 'PADM1_CANNOT_GRANT_ANOTHER_ADMIN_AUTHORITY';
    end if;
    select rc.capability_key into v_unheld_cap
    from public.forge_planner_role_capabilities rc
    where rc.owner_id = p_owner_id and rc.role_id = p_role_id
      and not public.has_planner_permission(p_owner_id, rc.capability_key)
    limit 1;
    if v_unheld_cap is not null then
      raise exception 'PADM1_CANNOT_ASSIGN_ROLE_EXCEEDING_OWN_CAPABILITIES';
    end if;
  end if;

  select * into v_existing from public.forge_planner_user_role_assignments
  where owner_id = p_owner_id and assignee_user_id = p_assignee_user_id and retired_at is null
  for update;

  if found then
    update public.forge_planner_user_role_assignments
    set role_id = p_role_id, version = version + 1, updated_by = v_actor, updated_at = now()
    where owner_id = p_owner_id and id = v_existing.id;
    v_new_id := v_existing.id;
    insert into public.forge_planner_permission_audit (owner_id, id, actor_id, action, target_role_id, target_user_id, old_values, new_values, reason, request_id)
    values (p_owner_id, 'forge_pa_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'assignment_create', p_role_id, p_assignee_user_id,
            jsonb_build_object('role_id', v_existing.role_id), jsonb_build_object('role_id', p_role_id), p_reason, p_request_id);
  else
    v_new_id := 'forge_pura_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.forge_planner_user_role_assignments (owner_id, id, assignee_user_id, role_id, assigned_by, updated_by)
    values (p_owner_id, v_new_id, p_assignee_user_id, p_role_id, v_actor, v_actor);
    insert into public.forge_planner_permission_audit (owner_id, id, actor_id, action, target_role_id, target_user_id, old_values, new_values, reason, request_id)
    values (p_owner_id, 'forge_pa_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'assignment_create', p_role_id, p_assignee_user_id,
            null, jsonb_build_object('role_id', p_role_id), p_reason, p_request_id);
  end if;

  return query select * from public.forge_planner_user_role_assignments where owner_id = p_owner_id and id = v_new_id;
end;
$$;

revoke all on function public.forge_planner_role_assign(text, text, text, text, text) from public, anon, service_role;
grant execute on function public.forge_planner_role_assign(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: forge_planner_role_assignment_revoke — never deletes the role
-- itself (the brief's "never delete an assigned role without
-- reassignment" is about ROLES; a user's own assignment can simply be
-- revoked, leaving them with no role).
-- ---------------------------------------------------------------------------

create or replace function public.forge_planner_role_assignment_revoke(
  p_owner_id text, p_assignment_id text, p_expected_version integer, p_request_id text, p_reason text default null
)
returns setof public.forge_planner_user_role_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := auth.uid()::text;
  v_is_owner boolean;
  v_row public.forge_planner_user_role_assignments%rowtype;
begin
  if v_actor is null then raise exception 'PADM1_INVALID_ACTOR'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'PADM1_REQUEST_ID_REQUIRED'; end if;

  select * into v_row from public.forge_planner_user_role_assignments
  where owner_id = p_owner_id and id = p_assignment_id and retired_at is null
  for update;
  if not found then raise exception 'PADM1_ASSIGNMENT_NOT_FOUND'; end if;
  if v_row.assignee_user_id = v_actor then raise exception 'PADM1_CANNOT_EDIT_OWN_ROLE'; end if;
  if v_row.version <> p_expected_version then raise exception 'PADM1_VERSION_CONFLICT'; end if;

  v_is_owner := (p_owner_id = v_actor) or exists (
    select 1 from workspace_members where owner_id = p_owner_id and member_user_id = v_actor and status = 'active' and role = 'co_owner'
  );
  if not v_is_owner and not public.has_planner_permission(p_owner_id, 'planner.roles.manage') then
    raise exception 'PADM1_FORBIDDEN';
  end if;

  update public.forge_planner_user_role_assignments
  set retired_at = now(), retired_by = v_actor, version = version + 1, updated_by = v_actor, updated_at = now()
  where owner_id = p_owner_id and id = p_assignment_id;

  insert into public.forge_planner_permission_audit (owner_id, id, actor_id, action, target_role_id, target_user_id, old_values, new_values, reason, request_id)
  values (p_owner_id, 'forge_pa_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'assignment_revoke', v_row.role_id, v_row.assignee_user_id,
          jsonb_build_object('role_id', v_row.role_id), null, p_reason, p_request_id);

  return query select * from public.forge_planner_user_role_assignments where owner_id = p_owner_id and id = p_assignment_id;
end;
$$;

revoke all on function public.forge_planner_role_assignment_revoke(text, text, integer, text, text) from public, anon, service_role;
grant execute on function public.forge_planner_role_assignment_revoke(text, text, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: forge_planner_roles_provision_starter_set — owner/co-owner only.
-- Creates the five editable starter roles (Planner Admin, Planner,
-- Scheduler, Reviewer, Read-only) with the exact capability sets from
-- the scope brief's "Editable starter roles" section, idempotently: a
-- role_key that already exists for this owner (in any state) is left
-- untouched, so calling this twice never duplicates or resets a role an
-- owner has since customized. 'owner' is deliberately never seeded as a
-- row here — owner authority is the structural bypass in
-- has_planner_permission above; seeding a literal 'owner' row is a
-- future per-workspace provisioning concern, not this migration's, and
-- the role_key='owner' immutability guard in
-- forge_planner_role_capability_set already covers that row if one is
-- ever created.
-- ---------------------------------------------------------------------------

create or replace function public.forge_planner_roles_provision_starter_set(
  p_owner_id text, p_request_id text
)
returns setof public.forge_planner_roles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := auth.uid()::text;
  v_is_owner boolean;
  v_starter jsonb := '[
    {"role_key":"planner_admin","name":"Planner Admin","capabilities":["planner.packages.read","planner.drawings.read","planner.steps.read","planner.crafts.read","planner.manpower.read","planner.baselines.read","planner.progress.read","planner.permits.read","planner.reports.read","planner.settings.read","planner.staff.read","planner.roles.read","planner.audit.read","planner.packages.create","planner.packages.edit","planner.packages.close","planner.packages.cancel","planner.steps.create","planner.steps.edit","planner.steps.reorder","planner.steps.retire","planner.crafts.assign","planner.crafts.reassign","planner.crafts.clear","planner.manpower.placements.edit","planner.progress.add","planner.progress.correct","planner.progress.void","planner.permits.annotations.link","planner.permits.annotations.unlink","planner.drawings.upload","planner.drawings.link","planner.drawings.delete","planner.baselines.freeze","planner.baselines.select"]},
    {"role_key":"planner","name":"Planner","capabilities":["planner.packages.read","planner.drawings.read","planner.steps.read","planner.crafts.read","planner.manpower.read","planner.baselines.read","planner.progress.read","planner.permits.read","planner.reports.read","planner.packages.edit","planner.steps.edit","planner.crafts.assign","planner.manpower.placements.edit","planner.progress.add","planner.drawings.link"]},
    {"role_key":"scheduler","name":"Scheduler","capabilities":["planner.packages.read","planner.steps.read","planner.crafts.read","planner.manpower.read","planner.baselines.read","planner.crafts.assign","planner.manpower.placements.edit"]},
    {"role_key":"reviewer","name":"Reviewer","capabilities":["planner.packages.read","planner.drawings.read","planner.steps.read","planner.crafts.read","planner.manpower.read","planner.baselines.read","planner.progress.read","planner.permits.read","planner.reports.read","planner.settings.read","planner.staff.read","planner.roles.read","planner.audit.read","planner.reports.export"]},
    {"role_key":"read_only","name":"Read-only","capabilities":["planner.packages.read","planner.drawings.read","planner.steps.read","planner.crafts.read","planner.manpower.read","planner.baselines.read","planner.progress.read","planner.permits.read","planner.reports.read","planner.settings.read","planner.staff.read","planner.roles.read","planner.audit.read"]}
  ]'::jsonb;
  v_def jsonb;
  v_role_id text;
  v_cap text;
begin
  if v_actor is null then raise exception 'PADM1_INVALID_ACTOR'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'PADM1_REQUEST_ID_REQUIRED'; end if;

  v_is_owner := (p_owner_id = v_actor) or exists (
    select 1 from workspace_members where owner_id = p_owner_id and member_user_id = v_actor and status = 'active' and role = 'co_owner'
  );
  if not v_is_owner then
    raise exception 'PADM1_OWNER_ONLY';
  end if;

  for v_def in select * from jsonb_array_elements(v_starter)
  loop
    if exists (select 1 from public.forge_planner_roles where owner_id = p_owner_id and role_key = v_def->>'role_key') then
      continue;
    end if;

    v_role_id := 'forge_pr_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.forge_planner_roles (owner_id, id, role_key, name, is_builtin, created_by, updated_by)
    values (p_owner_id, v_role_id, v_def->>'role_key', v_def->>'name', true, v_actor, v_actor);

    for v_cap in select jsonb_array_elements_text(v_def->'capabilities')
    loop
      insert into public.forge_planner_role_capabilities (owner_id, id, role_id, capability_key, created_by)
      values (p_owner_id, 'forge_prc_' || replace(gen_random_uuid()::text, '-', ''), v_role_id, v_cap, v_actor);
    end loop;

    insert into public.forge_planner_permission_audit (owner_id, id, actor_id, action, target_role_id, old_values, new_values, reason, request_id)
    values (p_owner_id, 'forge_pa_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'role_create', v_role_id,
            null, jsonb_build_object('role_key', v_def->>'role_key', 'name', v_def->>'name', 'capabilities', v_def->'capabilities'),
            'starter role provisioning', p_request_id);
  end loop;

  return query
    select * from public.forge_planner_roles
    where owner_id = p_owner_id and is_builtin = true and retired_at is null
    order by role_key;
end;
$$;

revoke all on function public.forge_planner_roles_provision_starter_set(text, text) from public, anon, service_role;
grant execute on function public.forge_planner_roles_provision_starter_set(text, text) to authenticated;
