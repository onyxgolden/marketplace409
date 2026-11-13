-- FORGE shared client -> site -> project foundation (PR A).
--
-- Scope: results/chatgpt/shared-client-site-project-foundation-scope-2026-11-11.md
-- (Jason's word, Nov 12: "build as scoped"). PR A ONLY — foundation:
-- shared tables, capabilities, RPCs, RLS/ACL receipts, audit,
-- API/domain types, and the selector read model. NO app row is attached
-- here (no nullable forge_project_id on any app table — that is PRs
-- B–F, separate). No fake "Legacy Client/Site/Project" rows; no existing
-- row is rewritten.
--
-- What lands here:
--   1. forge_clients -> forge_sites -> forge_projects (composite
--      (owner_id, id) PKs, FK chain, status checks, unique normalized
--      names/codes). Identity only — NO billing account, rate, invoice,
--      payment, tax, or credit fields.
--   2. forge_hierarchy_audit — append-only receipt for every mutation
--      (actor, entity, old/new values, request id, timestamp).
--   3. Capabilities forge.hierarchy.read / forge.hierarchy.manage in
--      all three app catalogs (planner / scheduling / rental):
--      read on every starter role, manage on the admin role only.
--      Seeded by the existing admin model — no hard-coded role display
--      name grants authority anywhere in the new RPCs.
--   4. has_forge_hierarchy_permission(owner_id, key) — owner/co-owner
--      structural bypass, then OR across the three role frameworks.
--   5. Read RPCs: forge_hierarchy_selector (non-archived tree: all
--      clients/sites active, all projects except archived — a freshly
--      created 'planned' project is selectable immediately) and
--      forge_hierarchy_validate_selection (membership + hierarchy check
--      for a shareable ?forgeProject=<id> hint).
--   6. Mutation RPCs: create / update (incl. archive, restore,
--      reparent) / hard-delete per entity. SECURITY DEFINER, actor
--      from auth.uid(), optimistic version CAS, request-id idempotency.
--
-- Design decisions the brief forces, recorded so a reviewer does not
-- have to re-derive them:
--   * SELECT policy is has_workspace_access(owner_id) ONLY — the brief's
--     literal RLS line. Staff reads go through the selector/read RPCs,
--     which enforce forge.hierarchy.read via
--     has_forge_hierarchy_permission. Direct table SELECT by a staff
--     reader is denied by RLS even though the RPC would admit them.
--   * The rental leg of has_forge_hierarchy_permission queries
--     rental_user_roles + rental_role_capabilities DIRECTLY. It must
--     NOT call has_rental_permission with a forge.* key: that helper
--     only routes `rental.*` keys through the role framework and sends
--     every other key to its legacy R17 branch, where
--     property_manager/manager return true for everything — a forge.*
--     key would be over-granted to every R17 manager. The direct query
--     is the contained fix; has_rental_permission is untouched.
--   * Projects carry NO client_id (brief: "Never duplicate client/site
--     ids on the project row. Resolve them through the FK chain").
--     Cross-client mismatch is therefore impossible by construction on
--     the row; the tests prove it at the selector/validation layer
--     (a project resolves to exactly one client through its site) and
--     at the FK layer (a site/project naming another workspace's
--     parent is rejected).
--   * Reparent is an UPDATE variant, not a separate RPC: when an
--     update changes a site's client_id or a project's site_id, the
--     audit action is 'reparent' with old/new parent ids and the
--     moved-child counts in new_values. No cascade silently moves
--     work — the move is explicit, audited, and counted.
--   * The rental_property_site_links bridge and forge_project_link_audit
--     are NOT created here: the bridge is PR F's attachment work and
--     link-audit belongs with the link actions (PRs B–F). PR A's audit
--     table covers create/update/archive/restore/reparent/delete.
--   * Hard delete is archive-first with named blockers (brief §Selector).
--     A project delete in slice 1 has no app links to check yet — the
--     archived-only gate is the blocker today, and the RPC comment says
--     where the app-link check lands when PRs B–F create links.
--
-- Migration discipline (Nov 4 / Nov 10 lessons): Supabase default
-- privileges grant ALL on newly created public tables, so every privilege
-- this migration does NOT intend is explicitly REVOKED below (tables:
-- SELECT only for authenticated; functions: EXECUTE only for
-- authenticated). The post-apply effective-ACL receipt is still mandatory
-- before the migration gate counts complete — SQL text alone is never
-- proof. Table/function names were checked against the live production
-- schema before writing (no forge_client*/forge_site*/forge_project*/
-- forge_hierarchy_* object exists there; the three capability keys exist
-- in no catalog yet).
--
-- FILE ONLY in this PR. Do NOT apply to production without a merge +
-- Muse's GO (apply-on-GO standing rule, Jason 2026-11-10 ~14:03).
-- Migration number 20261112010000 confirmed as next free against main
-- 5fe750cb at build time (newest on main is 20261111010000;
-- 20261112000000 is PR #796's in-flight planning-process migration).
--
-- MERGE-ORDER NOTE: the planner CHECK list and provision JSON below are
-- written against CURRENT main (5fe750cb) — the original 35 planner keys
-- plus the two hierarchy keys. PR #796 (in flight) adds three
-- planner.planning_steps.* keys to the same CHECK and provision function.
-- If #796 merges FIRST, this migration must be rebased before merge:
-- add the three planning_steps keys to §3's planner CHECK list and to
-- the provision JSON (planner_admin: read+update+review; planner:
-- read+update; scheduler/reviewer/read_only: read). Applying this file
-- un-rebased after #796 would fail loudly (the recreated CHECK would
-- reject #796's backfilled planning_steps rows) — never silently — but
-- it would still fail, so the rebase is mandatory in that order.
-- The hazard is SYMMETRIC: if THIS PR merges first, #796 must rebase
-- the same way (its CHECK replacement would otherwise drop this
-- migration's hierarchy keys and fail loudly on the backfilled rows).
-- Whichever of #796 / PR A merges second carries the rebase. Either
-- failure mode is loud (a CHECK violation at apply time), never silent.

-- ============================================================================
-- 1. Shared hierarchy tables.
--    Composite (owner_id, id) PKs, matching the scheduling schema's
--    workspace-ownership convention. owner_id is the workspace/tenant
--    boundary and is NEVER the paying client id — the paying client is
--    forge_clients.id.
-- ============================================================================

create table if not exists public.forge_clients (
  owner_id text not null,
  id text not null,
  name text not null
    check (char_length(btrim(name)) >= 1 and char_length(name) <= 200)
    check (name !~ '[[:cntrl:]]'),
  name_normalized text generated always as (lower(btrim(name))) stored,
  external_reference text
    check (external_reference is null or char_length(external_reference) <= 200)
    check (external_reference is null or external_reference !~ '[[:cntrl:]]'),
  status text not null default 'active'
    check (status in ('active', 'inactive', 'archived')),
  notes text
    check (notes is null or char_length(notes) <= 2000)
    check (notes is null or notes !~ '[[:cntrl:]]'),
  version integer not null default 1 check (version >= 1),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

-- Unique normalized ACTIVE name per owner (brief §forge_clients). An
-- archived client's name is free for reuse; re-activating into a
-- collision fails on this index.
create unique index if not exists forge_clients_active_name_uq
  on public.forge_clients (owner_id, name_normalized)
  where status = 'active';

comment on table public.forge_clients is
  'Paying clients (identity only, slice 1 — no billing account, rate, invoice, payment, tax, or credit fields). One workspace-owned commercial hierarchy: forge_clients -> forge_sites -> forge_projects. owner_id is the workspace/tenant boundary, never the paying client id.';

create table if not exists public.forge_sites (
  owner_id text not null,
  id text not null,
  client_id text not null,
  name text not null
    check (char_length(btrim(name)) >= 1 and char_length(name) <= 200)
    check (name !~ '[[:cntrl:]]'),
  name_normalized text generated always as (lower(btrim(name))) stored,
  site_type text
    check (site_type is null or site_type in ('industrial', 'commercial', 'residential', 'other')),
  address_line1 text
    check (address_line1 is null or char_length(address_line1) <= 200)
    check (address_line1 is null or address_line1 !~ '[[:cntrl:]]'),
  address_line2 text
    check (address_line2 is null or char_length(address_line2) <= 200)
    check (address_line2 is null or address_line2 !~ '[[:cntrl:]]'),
  city text
    check (city is null or char_length(city) <= 120)
    check (city is null or city !~ '[[:cntrl:]]'),
  region text
    check (region is null or char_length(region) <= 120)
    check (region is null or region !~ '[[:cntrl:]]'),
  postal_code text
    check (postal_code is null or char_length(postal_code) <= 20)
    check (postal_code is null or postal_code !~ '[[:cntrl:]]'),
  country_code text
    check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  status text not null default 'active'
    check (status in ('active', 'inactive', 'archived')),
  version integer not null default 1 check (version >= 1),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, client_id)
    references public.forge_clients (owner_id, id) on delete restrict
);

-- Unique normalized ACTIVE name per client (brief §forge_sites). A site
-- belongs to exactly one paying client in slice 1; a physical location
-- used by a different client is a separate business site record.
create unique index if not exists forge_sites_active_name_uq
  on public.forge_sites (owner_id, client_id, name_normalized)
  where status = 'active';

create index if not exists forge_sites_client_idx
  on public.forge_sites (owner_id, client_id);

comment on table public.forge_sites is
  'Business sites. Exactly one paying client per site in slice 1 (FK, not a many-to-many). Address fields are optional industry-standard identity metadata.';

create table if not exists public.forge_projects (
  owner_id text not null,
  id text not null,
  site_id text not null,
  name text not null
    check (char_length(btrim(name)) >= 1 and char_length(name) <= 200)
    check (name !~ '[[:cntrl:]]'),
  name_normalized text generated always as (lower(btrim(name))) stored,
  project_code text
    check (project_code is null or char_length(btrim(project_code)) >= 1)
    check (project_code is null or char_length(project_code) <= 64)
    check (project_code is null or project_code !~ '[[:cntrl:]]'),
  description text
    check (description is null or char_length(description) <= 2000)
    check (description is null or description !~ '[[:cntrl:]]'),
  project_type text
    check (project_type is null or char_length(btrim(project_type)) >= 1)
    check (project_type is null or char_length(project_type) <= 64)
    check (project_type is null or project_type !~ '[[:cntrl:]]'),
  status text not null default 'planned'
    check (status in ('planned', 'active', 'on_hold', 'complete', 'archived')),
  planned_start date,
  planned_finish date,
  version integer not null default 1 check (version >= 1),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, site_id)
    references public.forge_sites (owner_id, id) on delete restrict,
  -- Planned dates are identity metadata only, not Scheduler authority.
  check (planned_finish is null or planned_start is null or planned_finish >= planned_start)
);

-- Unique code per owner when non-null (brief §forge_projects). No
-- client_id is duplicated on this row: the client resolves through the
-- site FK chain, so a project cannot point at a site under one client
-- and separately claim another.
create unique index if not exists forge_projects_code_uq
  on public.forge_projects (owner_id, project_code)
  where project_code is not null;

create index if not exists forge_projects_site_idx
  on public.forge_projects (owner_id, site_id);

comment on table public.forge_projects is
  'Shared commercial job identity used by all apps (PRs B–F attach app rows to it). Planned dates are identity metadata only — the Scheduler owns schedule authority. No client_id column by design: resolve the client through the site FK chain.';

create table if not exists public.forge_hierarchy_audit (
  owner_id text not null,
  id text not null,
  actor_id text not null,
  entity_type text not null check (entity_type in ('client', 'site', 'project')),
  entity_id text not null,
  action text not null check (action in ('create', 'update', 'archive', 'restore', 'reparent', 'delete')),
  old_values jsonb,
  new_values jsonb,
  request_id text not null,
  recorded_at timestamptz not null default now(),
  primary key (owner_id, id)
);

-- Idempotency: one request ID applies at most once per entity for
-- updates/deletes (the entity is known), and at most once per
-- (action, entity type) for creates (the entity id is generated inside
-- the call, so the replay lookup is by request id alone).
create unique index if not exists forge_hierarchy_audit_entity_request_uq
  on public.forge_hierarchy_audit (owner_id, entity_type, entity_id, request_id);
create unique index if not exists forge_hierarchy_audit_create_request_uq
  on public.forge_hierarchy_audit (owner_id, action, entity_type, request_id);

create index if not exists forge_hierarchy_audit_entity_idx
  on public.forge_hierarchy_audit (owner_id, entity_type, entity_id, recorded_at desc, id);

comment on table public.forge_hierarchy_audit is
  'Append-only audit for every hierarchy mutation: actor, entity, old/new values, request id, UTC time. Rows are written only by the hierarchy RPCs in the same transaction as the change. No UPDATE/DELETE is ever granted.';

-- ============================================================================
-- 2. RLS + effective ACLs. SELECT requires has_workspace_access
--    (owner/co-owner) — the brief's literal RLS line. Staff readers reach
--    hierarchy data through the selector/read RPCs in §5, which enforce
--    forge.hierarchy.read. No write policies anywhere — the RPCs in §6
--    are the only write path, and they re-check authorization
--    server-side on every call.
-- ============================================================================

alter table public.forge_clients enable row level security;
alter table public.forge_clients force row level security;
alter table public.forge_sites enable row level security;
alter table public.forge_sites force row level security;
alter table public.forge_projects enable row level security;
alter table public.forge_projects force row level security;
alter table public.forge_hierarchy_audit enable row level security;
alter table public.forge_hierarchy_audit force row level security;

drop policy if exists forge_clients_owner_select on public.forge_clients;
create policy forge_clients_owner_select
  on public.forge_clients for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_sites_owner_select on public.forge_sites;
create policy forge_sites_owner_select
  on public.forge_sites for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_projects_owner_select on public.forge_projects;
create policy forge_projects_owner_select
  on public.forge_projects for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_hierarchy_audit_owner_select on public.forge_hierarchy_audit;
create policy forge_hierarchy_audit_owner_select
  on public.forge_hierarchy_audit for select to authenticated
  using (has_workspace_access(owner_id));

revoke all on table public.forge_clients from public, anon, service_role, authenticated;
grant select on table public.forge_clients to authenticated;
revoke all on table public.forge_sites from public, anon, service_role, authenticated;
grant select on table public.forge_sites to authenticated;
revoke all on table public.forge_projects from public, anon, service_role, authenticated;
grant select on table public.forge_projects to authenticated;
revoke all on table public.forge_hierarchy_audit from public, anon, service_role, authenticated;
grant select on table public.forge_hierarchy_audit to authenticated;

-- ============================================================================
-- 3. Capabilities: forge.hierarchy.read (every starter role) and
--    forge.hierarchy.manage (admin role only) in all three app catalogs.
--    Planner + Scheduling use the planning-process §5 pattern (resolve
--    the auto-generated CHECK name from the catalog, drop + recreate
--    with the new keys, replace the provision function with only the
--    starter JSON differing, backfill roles that already exist).
--    Rental has no CHECK on its capability table — its catalog is the
--    rental_admin_catalog_keys() function, so extending that function
--    plus rental_admin_starter_role_keys() is the whole change, with a
--    backfill for roles that already exist.
-- ============================================================================

-- --- Planner ---------------------------------------------------------------

-- Extend the capability-key CHECK on forge_planner_role_capabilities.
do $$
declare
  v_con text;
  v_has_new boolean;
begin
  select conname into v_con
    from pg_constraint
    where conrelid = 'forge_planner_role_capabilities'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%planner.packages.read%';
  if v_con is null then
    raise exception 'FORGE_HIERARCHY_CAPABILITY_CHECK_MISSING: could not find the capability-key CHECK on forge_planner_role_capabilities';
  end if;
  select pg_get_constraintdef(oid) like '%forge.hierarchy.read%'
    into v_has_new
    from pg_constraint
    where conname = v_con
      and conrelid = 'forge_planner_role_capabilities'::regclass;
  if not coalesce(v_has_new, false) then
    execute format('alter table public.forge_planner_role_capabilities drop constraint %I', v_con);
    alter table public.forge_planner_role_capabilities
      add constraint forge_planner_role_capabilities_capability_key_check
        check (capability_key in (
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
          'planner.audit.read',
          'forge.hierarchy.read','forge.hierarchy.manage'
        ));
  end if;
end $$;

-- Starter-role provisioning, updated to grant the two hierarchy keys
-- (same function body as 20261110000000, only the v_starter JSON
-- differs — verified by diff at build time: five role lines changed,
-- nothing else). New workspaces provisioned after this migration get
-- the capabilities from here; workspaces that already exist are covered
-- by the backfill below.
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
    {"role_key":"planner_admin","name":"Planner Admin","capabilities":["planner.packages.read","planner.drawings.read","planner.steps.read","planner.crafts.read","planner.manpower.read","planner.baselines.read","planner.progress.read","planner.permits.read","planner.reports.read","planner.settings.read","planner.staff.read","planner.roles.read","planner.audit.read","planner.packages.create","planner.packages.edit","planner.packages.close","planner.packages.cancel","planner.steps.create","planner.steps.edit","planner.steps.reorder","planner.steps.retire","planner.crafts.assign","planner.crafts.reassign","planner.crafts.clear","planner.manpower.placements.edit","planner.progress.add","planner.progress.correct","planner.progress.void","planner.permits.annotations.link","planner.permits.annotations.unlink","planner.drawings.upload","planner.drawings.link","planner.drawings.delete","planner.baselines.freeze","planner.baselines.select","forge.hierarchy.read","forge.hierarchy.manage"]},
    {"role_key":"planner","name":"Planner","capabilities":["planner.packages.read","planner.drawings.read","planner.steps.read","planner.crafts.read","planner.manpower.read","planner.baselines.read","planner.progress.read","planner.permits.read","planner.reports.read","planner.packages.edit","planner.steps.edit","planner.crafts.assign","planner.manpower.placements.edit","planner.progress.add","planner.drawings.link","forge.hierarchy.read"]},
    {"role_key":"scheduler","name":"Scheduler","capabilities":["planner.packages.read","planner.steps.read","planner.crafts.read","planner.manpower.read","planner.baselines.read","planner.crafts.assign","planner.manpower.placements.edit","forge.hierarchy.read"]},
    {"role_key":"reviewer","name":"Reviewer","capabilities":["planner.packages.read","planner.drawings.read","planner.steps.read","planner.crafts.read","planner.manpower.read","planner.baselines.read","planner.progress.read","planner.permits.read","planner.reports.read","planner.settings.read","planner.staff.read","planner.roles.read","planner.audit.read","planner.reports.export","forge.hierarchy.read"]},
    {"role_key":"read_only","name":"Read-only","capabilities":["planner.packages.read","planner.drawings.read","planner.steps.read","planner.crafts.read","planner.manpower.read","planner.baselines.read","planner.progress.read","planner.permits.read","planner.reports.read","planner.settings.read","planner.staff.read","planner.roles.read","planner.audit.read","forge.hierarchy.read"]}
  ]'::jsonb;
  v_def jsonb;
  v_role_id text;
  v_cap text;
begin
  if v_actor is null then raise exception 'PADM1_INVALID_ACTOR'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'PADM1_REQUEST_ID_REQUIRED'; end if;

  v_is_owner := (p_owner_id = v_actor) or exists (
    select 1 from workspace_members where owner_id = p_owner_id and member_user_id::text = v_actor and status = 'active' and role = 'co_owner'
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

-- Backfill: builtin starter roles that already exist (provisioned before
-- this migration) gain the two hierarchy keys. Idempotent — the NOT
-- EXISTS guard means a second run inserts nothing. Custom roles are
-- untouched: an owner who built a custom role decides its capabilities
-- in the admin UI, where the two new keys now appear in the catalog.
insert into public.forge_planner_role_capabilities (owner_id, id, role_id, capability_key, created_by)
select r.owner_id,
       'forge_prc_' || replace(gen_random_uuid()::text, '-', ''),
       r.id, c.capability_key, 'migration-20261112010000'
from public.forge_planner_roles r
cross join (values
  ('planner_admin', 'forge.hierarchy.read'),
  ('planner_admin', 'forge.hierarchy.manage'),
  ('planner', 'forge.hierarchy.read'),
  ('scheduler', 'forge.hierarchy.read'),
  ('reviewer', 'forge.hierarchy.read'),
  ('read_only', 'forge.hierarchy.read')
) as c(role_key, capability_key)
where r.role_key = c.role_key
  and r.retired_at is null
  and not exists (
    select 1 from public.forge_planner_role_capabilities rc
    where rc.owner_id = r.owner_id
      and rc.role_id = r.id
      and rc.capability_key = c.capability_key
  );

-- --- Scheduling ------------------------------------------------------------

-- Extend the capability-key CHECK on forge_scheduling_role_capabilities.
do $$
declare
  v_con text;
  v_has_new boolean;
begin
  select conname into v_con
    from pg_constraint
    where conrelid = 'forge_scheduling_role_capabilities'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%scheduling.schedules.read%';
  if v_con is null then
    raise exception 'FORGE_HIERARCHY_CAPABILITY_CHECK_MISSING: could not find the capability-key CHECK on forge_scheduling_role_capabilities';
  end if;
  select pg_get_constraintdef(oid) like '%forge.hierarchy.read%'
    into v_has_new
    from pg_constraint
    where conname = v_con
      and conrelid = 'forge_scheduling_role_capabilities'::regclass;
  if not coalesce(v_has_new, false) then
    execute format('alter table public.forge_scheduling_role_capabilities drop constraint %I', v_con);
    alter table public.forge_scheduling_role_capabilities
      add constraint forge_scheduling_role_capabilities_capability_key_check
        check (capability_key in (
          'scheduling.schedules.read','scheduling.schedules.create','scheduling.schedules.edit',
          'scheduling.activities.read','scheduling.activities.create','scheduling.activities.edit','scheduling.activities.resequence',
          'scheduling.resources.read','scheduling.resources.create','scheduling.resources.edit','scheduling.resources.allocate','scheduling.resources.release',
          'scheduling.calendars.read','scheduling.calendars.configure',
          'scheduling.settings.read','scheduling.settings.edit',
          'scheduling.staff.read','scheduling.staff.invite',
          'scheduling.roles.read','scheduling.roles.manage',
          'scheduling.audit.read',
          'forge.hierarchy.read','forge.hierarchy.manage'
        ));
  end if;
end $$;

-- Starter-role provisioning, updated to grant the two hierarchy keys
-- (same function body as 20261110080000, only the v_starter JSON
-- differs — verified by diff at build time: four role lines changed,
-- nothing else). New workspaces provisioned after this migration get
-- the capabilities from here; workspaces that already exist are covered
-- by the backfill below.
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
    {"role_key":"admin","name":"Admin","capabilities":["scheduling.schedules.read","scheduling.activities.read","scheduling.resources.read","scheduling.calendars.read","scheduling.settings.read","scheduling.staff.read","scheduling.roles.read","scheduling.audit.read","scheduling.schedules.create","scheduling.schedules.edit","scheduling.activities.create","scheduling.activities.edit","scheduling.activities.resequence","scheduling.resources.create","scheduling.resources.edit","scheduling.resources.allocate","scheduling.resources.release","scheduling.calendars.configure","forge.hierarchy.read","forge.hierarchy.manage"]},
    {"role_key":"scheduler","name":"Scheduler","capabilities":["scheduling.schedules.read","scheduling.activities.read","scheduling.resources.read","scheduling.calendars.read","scheduling.schedules.edit","scheduling.activities.edit","scheduling.activities.resequence","scheduling.resources.allocate","scheduling.resources.release","forge.hierarchy.read"]},
    {"role_key":"crew_lead","name":"Crew Lead","capabilities":["scheduling.schedules.read","scheduling.activities.read","scheduling.calendars.read","forge.hierarchy.read"]},
    {"role_key":"viewer","name":"Viewer","capabilities":["scheduling.schedules.read","scheduling.activities.read","scheduling.calendars.read","forge.hierarchy.read"]}
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

-- Backfill: builtin starter roles that already exist gain the two
-- hierarchy keys. Idempotent (NOT EXISTS guard). Custom roles untouched.
insert into public.forge_scheduling_role_capabilities (owner_id, id, role_id, capability_key, created_by)
select r.owner_id,
       'forge_src_' || replace(gen_random_uuid()::text, '-', ''),
       r.id, c.capability_key, 'migration-20261112010000'
from public.forge_scheduling_roles r
cross join (values
  ('admin', 'forge.hierarchy.read'),
  ('admin', 'forge.hierarchy.manage'),
  ('scheduler', 'forge.hierarchy.read'),
  ('crew_lead', 'forge.hierarchy.read'),
  ('viewer', 'forge.hierarchy.read')
) as c(role_key, capability_key)
where r.role_key = c.role_key
  and r.retired_at is null
  and not exists (
    select 1 from public.forge_scheduling_role_capabilities rc
    where rc.owner_id = r.owner_id
      and rc.role_id = r.id
      and rc.capability_key = c.capability_key
  );

-- --- Rental ----------------------------------------------------------------
--
-- Rental has no CHECK on rental_role_capabilities.capability_key — the
-- catalog is rental_admin_catalog_keys(), enforced by
-- rental_admin_validate_keys() in the role RPCs. Extending the catalog
-- function plus the starter-role function is the whole change. The
-- backfill below covers roles that already exist (rental_ensure_starter_roles
-- would also backfill on its next call, via ON CONFLICT DO NOTHING —
-- the migration-time backfill makes the grant effective immediately and
-- testable, instead of lazily).

create or replace function public.rental_admin_catalog_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'rental.dashboard.read', 'rental.properties.read', 'rental.properties.create',
    'rental.properties.edit', 'rental.properties.archive',
    'rental.billing.read', 'rental.billing.activate', 'rental.billing.settings.edit',
    'rental.payments.read', 'rental.payments.record_offline', 'rental.payments.refund',
    'rental.credits.issue', 'rental.credits.apply', 'rental.credits.void',
    'rental.tenants.read', 'rental.tenants.create', 'rental.tenants.edit',
    'rental.tenants.remove', 'rental.tenants.invite',
    'rental.leases.read', 'rental.leases.create', 'rental.leases.terms.edit', 'rental.leases.end',
    'rental.charges.read', 'rental.schedules.read', 'rental.charges.generate',
    'rental.charges.adjust', 'rental.charges.void', 'rental.schedules.edit',
    'rental.deposits.read', 'rental.deposits.record', 'rental.deposits.adjust', 'rental.deposits.refund',
    'rental.maintenance.read', 'rental.maintenance.create', 'rental.maintenance.edit',
    'rental.maintenance.assign', 'rental.maintenance.close',
    'rental.documents.read', 'rental.documents.upload', 'rental.documents.edit', 'rental.documents.delete',
    'rental.reports.read', 'rental.settings.read', 'rental.reports.export', 'rental.settings.edit',
    'rental.staff.read', 'rental.roles.read', 'rental.audit.read',
    'rental.staff.invite', 'rental.roles.manage',
    'forge.hierarchy.read', 'forge.hierarchy.manage'
  ];
$$;

-- Starter role defaults (must match src/lib/rental/adminPermissions.js
-- RENTAL_ADMIN_STARTER_ROLES). Only the forge.hierarchy keys differ
-- from 20261110010000: rental_admin gains both, every other starter
-- role gains read. The owner/co-owner-only finance keys stay off every
-- starter role, as before.
create or replace function public.rental_admin_starter_role_keys(p_role_name text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role_name
    when 'rental_admin' then array[
      'rental.dashboard.read', 'rental.properties.read', 'rental.properties.create',
      'rental.properties.edit', 'rental.properties.archive',
      'rental.billing.read', 'rental.payments.read', 'rental.payments.record_offline',
      'rental.tenants.read', 'rental.tenants.create', 'rental.tenants.edit',
      'rental.tenants.remove', 'rental.tenants.invite',
      'rental.leases.read', 'rental.leases.create', 'rental.leases.terms.edit', 'rental.leases.end',
      'rental.charges.read', 'rental.schedules.read', 'rental.charges.generate',
      'rental.charges.adjust', 'rental.charges.void', 'rental.schedules.edit',
      'rental.deposits.read', 'rental.deposits.record', 'rental.deposits.adjust',
      'rental.maintenance.read', 'rental.maintenance.create', 'rental.maintenance.edit',
      'rental.maintenance.assign', 'rental.maintenance.close',
      'rental.documents.read', 'rental.documents.upload', 'rental.documents.edit', 'rental.documents.delete',
      'rental.reports.read', 'rental.settings.read', 'rental.reports.export', 'rental.settings.edit',
      'rental.staff.read', 'rental.roles.read', 'rental.audit.read',
      'forge.hierarchy.read', 'forge.hierarchy.manage'
    ]
    when 'manager' then array[
      'rental.dashboard.read', 'rental.properties.read', 'rental.properties.create', 'rental.properties.edit',
      'rental.tenants.read', 'rental.tenants.create', 'rental.tenants.edit',
      'rental.leases.read', 'rental.leases.create', 'rental.leases.terms.edit',
      'rental.charges.read', 'rental.schedules.read', 'rental.charges.generate',
      'rental.charges.adjust', 'rental.schedules.edit',
      'rental.maintenance.read', 'rental.maintenance.create', 'rental.maintenance.edit', 'rental.maintenance.assign',
      'rental.documents.read', 'rental.documents.upload', 'rental.documents.edit',
      'rental.reports.read',
      'forge.hierarchy.read'
    ]
    when 'bookkeeper' then array[
      'rental.dashboard.read', 'rental.properties.read', 'rental.tenants.read', 'rental.leases.read',
      'rental.billing.read', 'rental.payments.read', 'rental.charges.read', 'rental.schedules.read',
      'rental.deposits.read', 'rental.reports.read', 'rental.settings.read',
      'rental.payments.record_offline', 'rental.deposits.record',
      'forge.hierarchy.read'
    ]
    when 'read_only' then array[
      'rental.dashboard.read', 'rental.properties.read', 'rental.tenants.read',
      'rental.leases.read', 'rental.maintenance.read', 'rental.reports.read',
      'forge.hierarchy.read'
    ]
    else array[]::text[]
  end;
$$;

-- Backfill: starter roles that already exist gain the two hierarchy
-- keys. Idempotent (NOT EXISTS guard). Custom roles untouched.
insert into public.rental_role_capabilities (role_id, capability_key)
select r.id, c.capability_key
from public.rental_roles r
cross join (values
  ('rental_admin', 'forge.hierarchy.read'),
  ('rental_admin', 'forge.hierarchy.manage'),
  ('manager', 'forge.hierarchy.read'),
  ('bookkeeper', 'forge.hierarchy.read'),
  ('read_only', 'forge.hierarchy.read')
) as c(role_name, capability_key)
where r.name = c.role_name
  and r.retired_at is null
  and not exists (
    select 1 from public.rental_role_capabilities rc
    where rc.role_id = r.id
      and rc.capability_key = c.capability_key
  );

-- ============================================================================
-- 4. has_forge_hierarchy_permission — the gate every hierarchy RPC uses.
--    Owner and active co-owner bypass the role tables entirely
--    (structural authority, immune to role-table corruption/deletion).
--    Anyone else: looked up via their single active role assignment in
--    ANY of the three app frameworks. The rental leg queries
--    rental_user_roles + rental_role_capabilities DIRECTLY — it must not
--    call has_rental_permission with a forge.* key (see the header:
--    that helper routes non-rental.* keys to its legacy R17 branch,
--    where property_manager/manager return true for everything).
--    Unknown keys fail closed (no role can list a key this helper does
--    not know).
-- ============================================================================

create or replace function public.has_forge_hierarchy_permission(p_owner_id text, p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select
    case
      when p_capability_key not in ('forge.hierarchy.read', 'forge.hierarchy.manage') then false
      when p_owner_id = auth.uid()::text then true
      when exists (
        select 1 from workspace_members
        where owner_id = p_owner_id and member_user_id = auth.uid()
          and status = 'active' and role = 'co_owner'
      ) then true
      when public.has_planner_permission(p_owner_id, p_capability_key) then true
      when public.has_scheduling_permission(p_owner_id, p_capability_key) then true
      else exists (
        select 1
        from public.rental_user_roles ur
        join public.rental_role_capabilities rc on rc.role_id = ur.role_id
        where ur.owner_id = p_owner_id
          and ur.app_key = 'rental'
          and ur.user_id = auth.uid()
          and ur.status = 'active'
          and rc.capability_key = p_capability_key
      )
    end;
$$;

comment on function public.has_forge_hierarchy_permission(text, text) is
'DB-enforced hierarchy permission predicate. Owner/co-owner bypass first; otherwise an active role assignment in ANY of the planner, scheduling, or rental frameworks carrying forge.hierarchy.read/.manage. The rental leg queries the rental role tables directly because has_rental_permission routes non-rental.* keys to its legacy R17 defaults. Deny-by-default; unknown keys fail closed.';

revoke all on function public.has_forge_hierarchy_permission(text, text) from public, anon, service_role;
grant execute on function public.has_forge_hierarchy_permission(text, text) to authenticated;

-- ============================================================================
-- 5. Read RPCs. SECURITY DEFINER with row_security = off: they bypass
--    RLS deliberately, after their own forge.hierarchy.read gate — the
--    SELECT policies admit owner/co-owner only, so a staff reader's only
--    read path is these RPCs.
-- ============================================================================

-- The selector tree: active clients -> active sites -> active projects
-- for one workspace, ordered by normalized name. Archived and inactive
-- rows are excluded — an archived selection is cleared by the caller
-- (see forge_hierarchy_validate_selection), never silently replaced.
create or replace function public.forge_hierarchy_selector(p_owner_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_result jsonb;
begin
  if not public.has_forge_hierarchy_permission(p_owner_id, 'forge.hierarchy.read') then
    raise exception 'FORGE_HIERARCHY_FORBIDDEN';
  end if;

  select jsonb_build_object(
    'ownerId', p_owner_id,
    'clients', coalesce((
      select jsonb_agg(client_json order by client_json ->> 'name_normalized')
      from (
        select jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'name_normalized', c.name_normalized,
          'external_reference', c.external_reference,
          'status', c.status,
          'sites', coalesce((
            select jsonb_agg(site_json order by site_json ->> 'name_normalized')
            from (
              select jsonb_build_object(
                'id', s.id,
                'name', s.name,
                'name_normalized', s.name_normalized,
                'site_type', s.site_type,
                'status', s.status,
                'projects', coalesce((
                  select jsonb_agg(project_json order by project_json ->> 'name_normalized')
                  from (
                    select jsonb_build_object(
                      'id', p.id,
                      'name', p.name,
                      'name_normalized', p.name_normalized,
                      'project_code', p.project_code,
                      'project_type', p.project_type,
                      'status', p.status
                    ) as project_json
                    from public.forge_projects p
                    -- Every non-archived state is selectable (planned,
                    -- active, on_hold, complete). A freshly created
                    -- project is 'planned' and must be visible
                    -- immediately — only archived projects are hidden.
                    where p.owner_id = p_owner_id and p.site_id = s.id and p.status <> 'archived'
                  ) projects
                ), '[]'::jsonb)
              ) as site_json
              from public.forge_sites s
              where s.owner_id = p_owner_id and s.client_id = c.id and s.status = 'active'
            ) sites
          ), '[]'::jsonb)
        ) as client_json
        from public.forge_clients c
        where c.owner_id = p_owner_id and c.status = 'active'
      ) clients
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.forge_hierarchy_selector(text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_selector(text) to authenticated;

-- Validate a shareable ?forgeProject=<id> hint: the server validates
-- membership AND hierarchy before use. Returns the full chain
-- {client, site, project} or raises: FORBIDDEN (no read capability),
-- NOT_FOUND (no such project in this workspace), ARCHIVED (the project
-- or an ancestor is archived — the caller clears the selection with an
-- explanation, never silently substitutes another project).
create or replace function public.forge_hierarchy_validate_selection(p_owner_id text, p_project_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_project public.forge_projects%rowtype;
  v_site public.forge_sites%rowtype;
  v_client public.forge_clients%rowtype;
begin
  if not public.has_forge_hierarchy_permission(p_owner_id, 'forge.hierarchy.read') then
    raise exception 'FORGE_HIERARCHY_FORBIDDEN';
  end if;
  if p_project_id is null or btrim(p_project_id) = '' then
    raise exception 'FORGE_HIERARCHY_NOT_FOUND';
  end if;

  select * into v_project from public.forge_projects
  where owner_id = p_owner_id and id = p_project_id;
  if not found then
    raise exception 'FORGE_HIERARCHY_NOT_FOUND';
  end if;

  select * into v_site from public.forge_sites
  where owner_id = p_owner_id and id = v_project.site_id;
  if not found then
    raise exception 'FORGE_HIERARCHY_NOT_FOUND';
  end if;

  select * into v_client from public.forge_clients
  where owner_id = p_owner_id and id = v_site.client_id;
  if not found then
    raise exception 'FORGE_HIERARCHY_NOT_FOUND';
  end if;

  if v_project.status = 'archived' or v_site.status = 'archived' or v_client.status = 'archived' then
    raise exception 'FORGE_HIERARCHY_ARCHIVED';
  end if;

  return jsonb_build_object(
    'client', row_to_json(v_client),
    'site', row_to_json(v_site),
    'project', row_to_json(v_project)
  );
end;
$$;

revoke all on function public.forge_hierarchy_validate_selection(text, text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_validate_selection(text, text) to authenticated;

-- ============================================================================
-- 6. Mutation RPCs — the ONLY write path. All SECURITY DEFINER with
--    set search_path = '' and row_security = off. The actor is derived
--    from auth.uid() inside the database; there is no actor parameter to
--    forge. Every call requires forge.hierarchy.manage and a request id.
--
-- Conventions shared by all nine RPCs:
--   * Nullable update parameters mean "unchanged"; an empty string means
--     "clear to null" (clearable text fields only — a name can never be
--     cleared, and a status is never cleared).
--   * expected_version is MANDATORY on update/delete (stale = 409).
--   * Request ids are unique per ENTITY across all its mutations: a
--     replay (same request id, same change-set) returns the current row
--     without re-applying; reuse with a different change-set is a
--     conflict. Audit new_values carries {'changed': <change-set>,
--     'row': <full new row>} so the replay comparison reads the
--     change-set while the receipt still names full old/new values.
--   * A no-op update (resolved values equal the stored values) returns
--     the row with no version bump and no audit row — but only when
--     the supplied expected version matches the locked row. A stale
--     no-op is a 409 like any stale write: only a same-request-ID
--     replay may bypass the version check, never an ordinary no-op.
--   * Create/reparent targets must have an ACTIVE parent (and, for
--     projects, an active grandparent client): an archived parent
--     returns FORGE_HIERARCHY_ARCHIVED, an inactive one
--     FORGE_HIERARCHY_PARENT_INACTIVE. The parent row is locked
--     FOR SHARE before the status decision so a concurrent archive
--     cannot slip in between the check and the insert/update.
--     That parent check is a FIRST-EXECUTION check only: the
--     same-request receipt is looked up and resolved BEFORE it, so
--     an exact retry replays the committed row even if the parent
--     was inactivated or archived after the first execution. The
--     payload is canonicalized first so the replay comparison is
--     safe; the request advisory lock (creates) or the entity row
--     lock (updates) serializes same-request callers.
--   * Action label on update: a parent change is 'reparent'; else a
--     move to 'archived' is 'archive'; else a move out of 'archived'
--     is 'restore'; else 'update'. old/new values always carry the
--     full change either way.
-- ============================================================================

-- --- Creates ---------------------------------------------------------------

create or replace function public.forge_hierarchy_client_create(
  p_owner_id text, p_name text,
  p_external_reference text default null,
  p_notes text default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_name text;
  v_ext text;
  v_notes text;
  v_change jsonb;
  v_replay record;
  v_id text;
  v_row public.forge_clients%rowtype;
begin
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'FORGE_HIERARCHY_INVALID_ACTOR';
  end if;
  if not public.has_forge_hierarchy_permission(p_owner_id, 'forge.hierarchy.manage') then
    raise exception 'FORGE_HIERARCHY_FORBIDDEN';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'FORGE_HIERARCHY_REQUEST_ID_REQUIRED';
  end if;
  if char_length(p_request_id) > 128 then
    raise exception 'FORGE_HIERARCHY_INVALID_REQUEST_ID';
  end if;
  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' or char_length(v_name) > 200 or v_name ~ '[[:cntrl:]]' then
    raise exception 'FORGE_HIERARCHY_INVALID_NAME';
  end if;
  v_ext := nullif(btrim(coalesce(p_external_reference, '')), '');
  if v_ext is not null and (char_length(v_ext) > 200 or v_ext ~ '[[:cntrl:]]') then
    raise exception 'FORGE_HIERARCHY_INVALID_EXTERNAL_REFERENCE';
  end if;
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');
  if v_notes is not null and (char_length(v_notes) > 2000 or v_notes ~ '[[:cntrl:]]') then
    raise exception 'FORGE_HIERARCHY_INVALID_NOTES';
  end if;

  v_change := jsonb_build_object('name', v_name, 'external_reference', v_ext, 'notes', v_notes);

  -- Serialize concurrent creates sharing one request id: with no row to
  -- lock, two identical requests could both pass the replay pre-check
  -- below and collide on the audit unique index. The advisory lock makes
  -- the second wait, then see the first's audit row and replay it.
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_request_id));

  -- Replay: same request id + same payload returns the created row.
  select a.entity_id, a.new_values into v_replay
    from public.forge_hierarchy_audit a
    where a.owner_id = p_owner_id and a.action = 'create' and a.entity_type = 'client'
      and a.request_id = p_request_id;
  if found then
    if v_replay.new_values -> 'changed' <> v_change then
      raise exception 'FORGE_HIERARCHY_REQUEST_ID_CONFLICT';
    end if;
    select * into v_row from public.forge_clients where owner_id = p_owner_id and id = v_replay.entity_id;
    if not found then
      raise exception 'FORGE_HIERARCHY_NOT_FOUND';
    end if;
    return row_to_json(v_row)::jsonb;
  end if;

  -- Duplicate active name (the partial unique index is the backstop).
  if exists (select 1 from public.forge_clients
             where owner_id = p_owner_id and name_normalized = lower(v_name) and status = 'active') then
    raise exception 'FORGE_HIERARCHY_DUPLICATE_NAME';
  end if;

  v_id := 'forge_client_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.forge_clients (owner_id, id, name, external_reference, status, notes, created_by, updated_by)
    values (p_owner_id, v_id, v_name, v_ext, 'active', v_notes, v_actor, v_actor)
    returning * into v_row;
  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'client', v_id, 'create', null,
            jsonb_build_object('changed', v_change, 'row', row_to_json(v_row)::jsonb), p_request_id);
  return row_to_json(v_row)::jsonb;
end;
$$;

revoke all on function public.forge_hierarchy_client_create(text, text, text, text, text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_client_create(text, text, text, text, text) to authenticated;

create or replace function public.forge_hierarchy_site_create(
  p_owner_id text, p_client_id text, p_name text,
  p_site_type text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_city text default null,
  p_region text default null,
  p_postal_code text default null,
  p_country_code text default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_name text;
  v_type text;
  v_addr1 text;
  v_addr2 text;
  v_city text;
  v_region text;
  v_postal text;
  v_country text;
  v_change jsonb;
  v_replay record;
  v_id text;
  v_row public.forge_sites%rowtype;
  v_parent public.forge_clients%rowtype;
begin
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'FORGE_HIERARCHY_INVALID_ACTOR';
  end if;
  if not public.has_forge_hierarchy_permission(p_owner_id, 'forge.hierarchy.manage') then
    raise exception 'FORGE_HIERARCHY_FORBIDDEN';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'FORGE_HIERARCHY_REQUEST_ID_REQUIRED';
  end if;
  if char_length(p_request_id) > 128 then
    raise exception 'FORGE_HIERARCHY_INVALID_REQUEST_ID';
  end if;
  if p_client_id is null or btrim(p_client_id) = '' then
    raise exception 'FORGE_HIERARCHY_CLIENT_NOT_FOUND';
  end if;
  -- The parent-status check lives AFTER the replay lookup below:
  -- an exact retry must replay the committed row even if the
  -- parent was inactivated/archived after the first execution, so
  -- the receipt is resolved before any current-state parent
  -- decision. The check still runs for every first execution.
  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' or char_length(v_name) > 200 or v_name ~ '[[:cntrl:]]' then
    raise exception 'FORGE_HIERARCHY_INVALID_NAME';
  end if;
  v_type := nullif(btrim(coalesce(p_site_type, '')), '');
  if v_type is not null and v_type not in ('industrial', 'commercial', 'residential', 'other') then
    raise exception 'FORGE_HIERARCHY_INVALID_SITE_TYPE';
  end if;
  v_addr1 := nullif(btrim(coalesce(p_address_line1, '')), '');
  v_addr2 := nullif(btrim(coalesce(p_address_line2, '')), '');
  v_city := nullif(btrim(coalesce(p_city, '')), '');
  v_region := nullif(btrim(coalesce(p_region, '')), '');
  v_postal := nullif(btrim(coalesce(p_postal_code, '')), '');
  v_country := nullif(upper(btrim(coalesce(p_country_code, ''))), '');
  if (v_addr1 is not null and (char_length(v_addr1) > 200 or v_addr1 ~ '[[:cntrl:]]'))
     or (v_addr2 is not null and (char_length(v_addr2) > 200 or v_addr2 ~ '[[:cntrl:]]'))
     or (v_city is not null and (char_length(v_city) > 120 or v_city ~ '[[:cntrl:]]'))
     or (v_region is not null and (char_length(v_region) > 120 or v_region ~ '[[:cntrl:]]'))
     or (v_postal is not null and (char_length(v_postal) > 20 or v_postal ~ '[[:cntrl:]]')) then
    raise exception 'FORGE_HIERARCHY_INVALID_ADDRESS';
  end if;
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then
    raise exception 'FORGE_HIERARCHY_INVALID_COUNTRY_CODE';
  end if;

  v_change := jsonb_build_object(
    'client_id', p_client_id, 'name', v_name, 'site_type', v_type,
    'address_line1', v_addr1, 'address_line2', v_addr2, 'city', v_city,
    'region', v_region, 'postal_code', v_postal, 'country_code', v_country);

  -- Serialize concurrent creates sharing one request id (see the client
  -- create above: no row exists to lock yet).
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_request_id));

  -- Replay: same request id + same payload returns the created row.
  -- This runs BEFORE the parent-status check below: the receipt is
  -- the record of a committed logical operation, and a later parent
  -- inactivation/archive must not re-decide an exact retry.
  select a.entity_id, a.new_values into v_replay
    from public.forge_hierarchy_audit a
    where a.owner_id = p_owner_id and a.action = 'create' and a.entity_type = 'site'
      and a.request_id = p_request_id;
  if found then
    if v_replay.new_values -> 'changed' <> v_change then
      raise exception 'FORGE_HIERARCHY_REQUEST_ID_CONFLICT';
    end if;
    select * into v_row from public.forge_sites where owner_id = p_owner_id and id = v_replay.entity_id;
    if not found then
      raise exception 'FORGE_HIERARCHY_NOT_FOUND';
    end if;
    return row_to_json(v_row)::jsonb;
  end if;

  -- First execution only: the parent must exist in THIS workspace
  -- AND be active. A guessed id from another workspace fails here,
  -- never at the FK (clean error, no leak), and a site under an
  -- archived/inactive client would be unreachable in the selector.
  -- The parent row is locked FOR SHARE so a concurrent archive
  -- cannot slip in between this check and the insert — the
  -- archiver's FOR UPDATE waits, then this check sees the archived
  -- state and rejects.
  select * into v_parent from public.forge_clients
  where owner_id = p_owner_id and id = p_client_id for share;
  if not found then
    raise exception 'FORGE_HIERARCHY_CLIENT_NOT_FOUND';
  end if;
  if v_parent.status = 'archived' then
    raise exception 'FORGE_HIERARCHY_ARCHIVED';
  end if;
  if v_parent.status <> 'active' then
    raise exception 'FORGE_HIERARCHY_PARENT_INACTIVE';
  end if;

  if exists (select 1 from public.forge_sites
             where owner_id = p_owner_id and client_id = p_client_id
               and name_normalized = lower(v_name) and status = 'active') then
    raise exception 'FORGE_HIERARCHY_DUPLICATE_NAME';
  end if;

  v_id := 'forge_site_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.forge_sites
    (owner_id, id, client_id, name, site_type, address_line1, address_line2, city, region, postal_code, country_code, status, created_by, updated_by)
    values (p_owner_id, v_id, p_client_id, v_name, v_type, v_addr1, v_addr2, v_city, v_region, v_postal, v_country, 'active', v_actor, v_actor)
    returning * into v_row;
  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'site', v_id, 'create', null,
            jsonb_build_object('changed', v_change, 'row', row_to_json(v_row)::jsonb), p_request_id);
  return row_to_json(v_row)::jsonb;
end;
$$;

revoke all on function public.forge_hierarchy_site_create(text, text, text, text, text, text, text, text, text, text, text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_site_create(text, text, text, text, text, text, text, text, text, text, text) to authenticated;

create or replace function public.forge_hierarchy_project_create(
  p_owner_id text, p_site_id text, p_name text,
  p_project_code text default null,
  p_description text default null,
  p_project_type text default null,
  p_planned_start text default null,
  p_planned_finish text default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_name text;
  v_code text;
  v_desc text;
  v_type text;
  v_start date;
  v_finish date;
  v_change jsonb;
  v_replay record;
  v_id text;
  v_row public.forge_projects%rowtype;
  v_site public.forge_sites%rowtype;
  v_client public.forge_clients%rowtype;
  v_constraint text;
begin
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'FORGE_HIERARCHY_INVALID_ACTOR';
  end if;
  if not public.has_forge_hierarchy_permission(p_owner_id, 'forge.hierarchy.manage') then
    raise exception 'FORGE_HIERARCHY_FORBIDDEN';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'FORGE_HIERARCHY_REQUEST_ID_REQUIRED';
  end if;
  if char_length(p_request_id) > 128 then
    raise exception 'FORGE_HIERARCHY_INVALID_REQUEST_ID';
  end if;
  if p_site_id is null or btrim(p_site_id) = '' then
    raise exception 'FORGE_HIERARCHY_SITE_NOT_FOUND';
  end if;
  -- The parent-status checks live AFTER the replay lookup below:
  -- an exact retry must replay the committed row even if the site
  -- or its client was inactivated/archived after the first
  -- execution, so the receipt is resolved before any current-state
  -- parent decision. The checks still run for every first execution.
  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' or char_length(v_name) > 200 or v_name ~ '[[:cntrl:]]' then
    raise exception 'FORGE_HIERARCHY_INVALID_NAME';
  end if;
  v_code := nullif(btrim(coalesce(p_project_code, '')), '');
  if v_code is not null and (char_length(v_code) > 64 or v_code ~ '[[:cntrl:]]') then
    raise exception 'FORGE_HIERARCHY_INVALID_PROJECT_CODE';
  end if;
  v_desc := nullif(btrim(coalesce(p_description, '')), '');
  if v_desc is not null and (char_length(v_desc) > 2000 or v_desc ~ '[[:cntrl:]]') then
    raise exception 'FORGE_HIERARCHY_INVALID_DESCRIPTION';
  end if;
  v_type := nullif(btrim(coalesce(p_project_type, '')), '');
  if v_type is not null and (char_length(v_type) > 64 or v_type ~ '[[:cntrl:]]') then
    raise exception 'FORGE_HIERARCHY_INVALID_PROJECT_TYPE';
  end if;
  if nullif(btrim(coalesce(p_planned_start, '')), '') is not null then
    begin
      v_start := btrim(p_planned_start)::date;
    exception when others then
      raise exception 'FORGE_HIERARCHY_INVALID_DATE';
    end;
  end if;
  if nullif(btrim(coalesce(p_planned_finish, '')), '') is not null then
    begin
      v_finish := btrim(p_planned_finish)::date;
    exception when others then
      raise exception 'FORGE_HIERARCHY_INVALID_DATE';
    end;
  end if;
  if v_start is not null and v_finish is not null and v_finish < v_start then
    raise exception 'FORGE_HIERARCHY_INVALID_DATES';
  end if;

  v_change := jsonb_build_object(
    'site_id', p_site_id, 'name', v_name, 'project_code', v_code,
    'description', v_desc, 'project_type', v_type,
    'planned_start', v_start, 'planned_finish', v_finish);

  -- Serialize concurrent creates sharing one request id (see the client
  -- create above: no row exists to lock yet).
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_request_id));

  -- Replay: same request id + same payload returns the created row.
  -- This runs BEFORE the parent-status checks below: the receipt is
  -- the record of a committed logical operation, and a later parent
  -- inactivation/archive must not re-decide an exact retry.
  select a.entity_id, a.new_values into v_replay
    from public.forge_hierarchy_audit a
    where a.owner_id = p_owner_id and a.action = 'create' and a.entity_type = 'project'
      and a.request_id = p_request_id;
  if found then
    if v_replay.new_values -> 'changed' <> v_change then
      raise exception 'FORGE_HIERARCHY_REQUEST_ID_CONFLICT';
    end if;
    select * into v_row from public.forge_projects where owner_id = p_owner_id and id = v_replay.entity_id;
    if not found then
      raise exception 'FORGE_HIERARCHY_NOT_FOUND';
    end if;
    return row_to_json(v_row)::jsonb;
  end if;

  -- First execution only: the parent site must exist in THIS
  -- workspace AND be active, and so must its client. The client
  -- resolves through the site FK chain, so a project cannot point
  -- at a site under one client and claim another — and a project
  -- under an archived/inactive site or client would be unreachable
  -- in the selector. Both ancestors are locked FOR SHARE (site
  -- first, then its client — the site lock pins the client_id while
  -- the client lock is taken) so a concurrent archive/reparent
  -- cannot slip in between the check and the insert.
  select * into v_site from public.forge_sites
  where owner_id = p_owner_id and id = p_site_id for share;
  if not found then
    raise exception 'FORGE_HIERARCHY_SITE_NOT_FOUND';
  end if;
  if v_site.status = 'archived' then
    raise exception 'FORGE_HIERARCHY_ARCHIVED';
  end if;
  if v_site.status <> 'active' then
    raise exception 'FORGE_HIERARCHY_PARENT_INACTIVE';
  end if;
  select * into v_client from public.forge_clients
  where owner_id = p_owner_id and id = v_site.client_id for share;
  if not found then
    raise exception 'FORGE_HIERARCHY_SITE_NOT_FOUND';
  end if;
  if v_client.status = 'archived' then
    raise exception 'FORGE_HIERARCHY_ARCHIVED';
  end if;
  if v_client.status <> 'active' then
    raise exception 'FORGE_HIERARCHY_PARENT_INACTIVE';
  end if;

  if v_code is not null and exists (select 1 from public.forge_projects
             where owner_id = p_owner_id and project_code = v_code) then
    raise exception 'FORGE_HIERARCHY_DUPLICATE_CODE';
  end if;

  v_id := 'forge_project_' || replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.forge_projects
      (owner_id, id, site_id, name, project_code, description, project_type, planned_start, planned_finish, status, created_by, updated_by)
      values (p_owner_id, v_id, p_site_id, v_name, v_code, v_desc, v_type, v_start, v_finish, 'planned', v_actor, v_actor)
      returning * into v_row;
  exception when unique_violation then
    -- A raced duplicate code slips past the pre-check above; the
    -- partial unique index is the backstop. Translate the violated
    -- constraint so the caller gets DUPLICATE_CODE, not DUPLICATE_NAME.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'forge_projects_code_uq' then
      raise exception 'FORGE_HIERARCHY_DUPLICATE_CODE';
    end if;
    raise;
  end;
  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'project', v_id, 'create', null,
            jsonb_build_object('changed', v_change, 'row', row_to_json(v_row)::jsonb), p_request_id);
  return row_to_json(v_row)::jsonb;
end;
$$;

revoke all on function public.forge_hierarchy_project_create(text, text, text, text, text, text, text, text, text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_project_create(text, text, text, text, text, text, text, text, text) to authenticated;

-- --- Updates (incl. archive / restore / reparent) ---------------------------

create or replace function public.forge_hierarchy_client_update(
  p_owner_id text, p_client_id text,
  p_name text default null,
  p_external_reference text default null,
  p_notes text default null,
  p_status text default null,
  p_expected_version integer default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_old public.forge_clients%rowtype;
  v_name text;
  v_ext text;
  v_notes text;
  v_status text;
  v_change jsonb := '{}'::jsonb;
  v_action text;
  v_replay record;
  v_new public.forge_clients%rowtype;
  v_updated boolean;
begin
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'FORGE_HIERARCHY_INVALID_ACTOR';
  end if;
  if not public.has_forge_hierarchy_permission(p_owner_id, 'forge.hierarchy.manage') then
    raise exception 'FORGE_HIERARCHY_FORBIDDEN';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'FORGE_HIERARCHY_REQUEST_ID_REQUIRED';
  end if;
  if char_length(p_request_id) > 128 then
    raise exception 'FORGE_HIERARCHY_INVALID_REQUEST_ID';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'FORGE_HIERARCHY_EXPECTED_VERSION_REQUIRED';
  end if;

  select * into v_old from public.forge_clients
  where owner_id = p_owner_id and id = p_client_id for update;
  if not found then
    raise exception 'FORGE_HIERARCHY_NOT_FOUND';
  end if;

  -- Resolve the requested values (null = unchanged, '' = clear).
  v_name := v_old.name;
  if p_name is not null then
    v_name := btrim(p_name);
    if v_name = '' or char_length(v_name) > 200 or v_name ~ '[[:cntrl:]]' then
      raise exception 'FORGE_HIERARCHY_INVALID_NAME';
    end if;
    v_change := v_change || jsonb_build_object('name', v_name);
  end if;
  v_ext := v_old.external_reference;
  if p_external_reference is not null then
    v_ext := nullif(btrim(p_external_reference), '');
    if v_ext is not null and (char_length(v_ext) > 200 or v_ext ~ '[[:cntrl:]]') then
      raise exception 'FORGE_HIERARCHY_INVALID_EXTERNAL_REFERENCE';
    end if;
    v_change := v_change || jsonb_build_object('external_reference', v_ext);
  end if;
  v_notes := v_old.notes;
  if p_notes is not null then
    v_notes := nullif(btrim(p_notes), '');
    if v_notes is not null and (char_length(v_notes) > 2000 or v_notes ~ '[[:cntrl:]]') then
      raise exception 'FORGE_HIERARCHY_INVALID_NOTES';
    end if;
    v_change := v_change || jsonb_build_object('notes', v_notes);
  end if;
  v_status := v_old.status;
  if p_status is not null then
    v_status := btrim(p_status);
    if v_status not in ('active', 'inactive', 'archived') then
      raise exception 'FORGE_HIERARCHY_INVALID_STATUS';
    end if;
    v_change := v_change || jsonb_build_object('status', v_status);
  end if;

  -- Replay: same request id + same change-set returns the current row;
  -- the same request id with a different change-set is a conflict.
  select a.new_values into v_replay
    from public.forge_hierarchy_audit a
    where a.owner_id = p_owner_id and a.entity_type = 'client'
      and a.entity_id = p_client_id and a.request_id = p_request_id;
  if found then
    if v_replay.new_values -> 'changed' <> v_change then
      raise exception 'FORGE_HIERARCHY_REQUEST_ID_CONFLICT';
    end if;
    select * into v_new from public.forge_clients where owner_id = p_owner_id and id = p_client_id;
    return row_to_json(v_new)::jsonb;
  end if;

  -- Optimistic concurrency is mandatory even for a no-op: a caller
  -- holding a stale version must 409 rather than silently succeed.
  -- Only a same-request-ID replay above may bypass this check.
  if v_old.version <> p_expected_version then
    raise exception 'FORGE_HIERARCHY_STALE_VERSION';
  end if;

  -- No-op: nothing actually changes.
  if v_name = v_old.name and v_ext is not distinct from v_old.external_reference
     and v_notes is not distinct from v_old.notes and v_status = v_old.status then
    return row_to_json(v_old)::jsonb;
  end if;

  -- Duplicate active name (only when the name or the status changes).
  if (v_name <> v_old.name or v_status <> v_old.status) and v_status = 'active'
     and exists (select 1 from public.forge_clients
                 where owner_id = p_owner_id and id <> p_client_id
                   and name_normalized = lower(v_name) and status = 'active') then
    raise exception 'FORGE_HIERARCHY_DUPLICATE_NAME';
  end if;

  v_action := case
    when v_status = 'archived' and v_old.status <> 'archived' then 'archive'
    when v_old.status = 'archived' and v_status <> 'archived' then 'restore'
    else 'update' end;

  update public.forge_clients
     set name = v_name, external_reference = v_ext, notes = v_notes, status = v_status,
         version = version + 1, updated_by = v_actor, updated_at = now()
   where owner_id = p_owner_id and id = p_client_id and version = p_expected_version
   returning * into v_new;
  v_updated := found;
  if not v_updated then
    raise exception 'FORGE_HIERARCHY_STALE_VERSION';
  end if;

  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'client', p_client_id, v_action,
            row_to_json(v_old)::jsonb,
            jsonb_build_object('changed', v_change, 'row', row_to_json(v_new)::jsonb), p_request_id);
  return row_to_json(v_new)::jsonb;
end;
$$;

revoke all on function public.forge_hierarchy_client_update(text, text, text, text, text, text, integer, text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_client_update(text, text, text, text, text, text, integer, text) to authenticated;

create or replace function public.forge_hierarchy_site_update(
  p_owner_id text, p_site_id text,
  p_client_id text default null,
  p_name text default null,
  p_site_type text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_city text default null,
  p_region text default null,
  p_postal_code text default null,
  p_country_code text default null,
  p_status text default null,
  p_expected_version integer default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_old public.forge_sites%rowtype;
  v_client_id text;
  v_name text;
  v_type text;
  v_addr1 text;
  v_addr2 text;
  v_city text;
  v_region text;
  v_postal text;
  v_country text;
  v_status text;
  v_change jsonb := '{}'::jsonb;
  v_action text;
  v_moved integer;
  v_reparent boolean;
  v_parent public.forge_clients%rowtype;
  v_replay record;
  v_new public.forge_sites%rowtype;
  v_updated boolean;
begin
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'FORGE_HIERARCHY_INVALID_ACTOR';
  end if;
  if not public.has_forge_hierarchy_permission(p_owner_id, 'forge.hierarchy.manage') then
    raise exception 'FORGE_HIERARCHY_FORBIDDEN';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'FORGE_HIERARCHY_REQUEST_ID_REQUIRED';
  end if;
  if char_length(p_request_id) > 128 then
    raise exception 'FORGE_HIERARCHY_INVALID_REQUEST_ID';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'FORGE_HIERARCHY_EXPECTED_VERSION_REQUIRED';
  end if;

  select * into v_old from public.forge_sites
  where owner_id = p_owner_id and id = p_site_id for update;
  if not found then
    raise exception 'FORGE_HIERARCHY_NOT_FOUND';
  end if;

  -- Reparent: a new client_id moves the site (and its projects with
  -- it — counted in the audit, never silent). The target-parent
  -- eligibility check is deferred until AFTER the replay lookup
  -- below: a same-request replay must return the committed row even
  -- if the entity was moved again since, or the original target was
  -- inactivated/archived. The check still runs for every first
  -- execution, and only on an actual move, not a same-parent
  -- re-statement.
  v_client_id := v_old.client_id;
  v_reparent := false;
  if p_client_id is not null then
    if btrim(p_client_id) = '' then
      raise exception 'FORGE_HIERARCHY_CLIENT_NOT_FOUND';
    end if;
    if p_client_id <> v_old.client_id then
      v_reparent := true;
    end if;
    v_client_id := p_client_id;
    v_change := v_change || jsonb_build_object('client_id', v_client_id);
  end if;
  v_name := v_old.name;
  if p_name is not null then
    v_name := btrim(p_name);
    if v_name = '' or char_length(v_name) > 200 or v_name ~ '[[:cntrl:]]' then
      raise exception 'FORGE_HIERARCHY_INVALID_NAME';
    end if;
    v_change := v_change || jsonb_build_object('name', v_name);
  end if;
  v_type := v_old.site_type;
  if p_site_type is not null then
    v_type := nullif(btrim(p_site_type), '');
    if v_type is not null and v_type not in ('industrial', 'commercial', 'residential', 'other') then
      raise exception 'FORGE_HIERARCHY_INVALID_SITE_TYPE';
    end if;
    v_change := v_change || jsonb_build_object('site_type', v_type);
  end if;
  v_addr1 := v_old.address_line1;
  if p_address_line1 is not null then
    v_addr1 := nullif(btrim(p_address_line1), '');
    if v_addr1 is not null and (char_length(v_addr1) > 200 or v_addr1 ~ '[[:cntrl:]]') then
      raise exception 'FORGE_HIERARCHY_INVALID_ADDRESS';
    end if;
    v_change := v_change || jsonb_build_object('address_line1', v_addr1);
  end if;
  v_addr2 := v_old.address_line2;
  if p_address_line2 is not null then
    v_addr2 := nullif(btrim(p_address_line2), '');
    if v_addr2 is not null and (char_length(v_addr2) > 200 or v_addr2 ~ '[[:cntrl:]]') then
      raise exception 'FORGE_HIERARCHY_INVALID_ADDRESS';
    end if;
    v_change := v_change || jsonb_build_object('address_line2', v_addr2);
  end if;
  v_city := v_old.city;
  if p_city is not null then
    v_city := nullif(btrim(p_city), '');
    if v_city is not null and (char_length(v_city) > 120 or v_city ~ '[[:cntrl:]]') then
      raise exception 'FORGE_HIERARCHY_INVALID_ADDRESS';
    end if;
    v_change := v_change || jsonb_build_object('city', v_city);
  end if;
  v_region := v_old.region;
  if p_region is not null then
    v_region := nullif(btrim(p_region), '');
    if v_region is not null and (char_length(v_region) > 120 or v_region ~ '[[:cntrl:]]') then
      raise exception 'FORGE_HIERARCHY_INVALID_ADDRESS';
    end if;
    v_change := v_change || jsonb_build_object('region', v_region);
  end if;
  v_postal := v_old.postal_code;
  if p_postal_code is not null then
    v_postal := nullif(btrim(p_postal_code), '');
    if v_postal is not null and (char_length(v_postal) > 20 or v_postal ~ '[[:cntrl:]]') then
      raise exception 'FORGE_HIERARCHY_INVALID_ADDRESS';
    end if;
    v_change := v_change || jsonb_build_object('postal_code', v_postal);
  end if;
  v_country := v_old.country_code;
  if p_country_code is not null then
    v_country := nullif(upper(btrim(p_country_code)), '');
    if v_country is not null and v_country !~ '^[A-Z]{2}$' then
      raise exception 'FORGE_HIERARCHY_INVALID_COUNTRY_CODE';
    end if;
    v_change := v_change || jsonb_build_object('country_code', v_country);
  end if;
  v_status := v_old.status;
  if p_status is not null then
    v_status := btrim(p_status);
    if v_status not in ('active', 'inactive', 'archived') then
      raise exception 'FORGE_HIERARCHY_INVALID_STATUS';
    end if;
    v_change := v_change || jsonb_build_object('status', v_status);
  end if;

  select a.new_values into v_replay
    from public.forge_hierarchy_audit a
    where a.owner_id = p_owner_id and a.entity_type = 'site'
      and a.entity_id = p_site_id and a.request_id = p_request_id;
  if found then
    if v_replay.new_values -> 'changed' <> v_change then
      raise exception 'FORGE_HIERARCHY_REQUEST_ID_CONFLICT';
    end if;
    select * into v_new from public.forge_sites where owner_id = p_owner_id and id = p_site_id;
    return row_to_json(v_new)::jsonb;
  end if;

  -- First execution only: the reparent target must exist in THIS
  -- workspace AND be active — a move under an archived/inactive
  -- client would make the site unreachable in the selector. The
  -- target row is locked FOR SHARE so a concurrent archive cannot
  -- slip in between the check and the update.
  if v_reparent then
    select * into v_parent from public.forge_clients
    where owner_id = p_owner_id and id = v_client_id for share;
    if not found then
      raise exception 'FORGE_HIERARCHY_CLIENT_NOT_FOUND';
    end if;
    if v_parent.status = 'archived' then
      raise exception 'FORGE_HIERARCHY_ARCHIVED';
    end if;
    if v_parent.status <> 'active' then
      raise exception 'FORGE_HIERARCHY_PARENT_INACTIVE';
    end if;
  end if;

  -- Optimistic concurrency is mandatory even for a no-op: a caller
  -- holding a stale version must 409 rather than silently succeed.
  -- Only a same-request-ID replay above may bypass this check.
  if v_old.version <> p_expected_version then
    raise exception 'FORGE_HIERARCHY_STALE_VERSION';
  end if;

  if v_client_id = v_old.client_id and v_name = v_old.name and v_type is not distinct from v_old.site_type
     and v_addr1 is not distinct from v_old.address_line1 and v_addr2 is not distinct from v_old.address_line2
     and v_city is not distinct from v_old.city and v_region is not distinct from v_old.region
     and v_postal is not distinct from v_old.postal_code and v_country is not distinct from v_old.country_code
     and v_status = v_old.status then
    return row_to_json(v_old)::jsonb;
  end if;

  if (v_name <> v_old.name or v_client_id <> v_old.client_id or v_status <> v_old.status) and v_status = 'active'
     and exists (select 1 from public.forge_sites
                 where owner_id = p_owner_id and client_id = v_client_id and id <> p_site_id
                   and name_normalized = lower(v_name) and status = 'active') then
    raise exception 'FORGE_HIERARCHY_DUPLICATE_NAME';
  end if;

  v_action := case
    when v_client_id <> v_old.client_id then 'reparent'
    when v_status = 'archived' and v_old.status <> 'archived' then 'archive'
    when v_old.status = 'archived' and v_status <> 'archived' then 'restore'
    else 'update' end;
  -- A reparent moves the site's projects with it. Count them for the
  -- audit so the move is explicit, never a silent cascade.
  v_moved := 0;
  if v_action = 'reparent' then
    select count(*)::int into v_moved from public.forge_projects
    where owner_id = p_owner_id and site_id = p_site_id;
  end if;

  update public.forge_sites
     set client_id = v_client_id, name = v_name, site_type = v_type,
         address_line1 = v_addr1, address_line2 = v_addr2, city = v_city,
         region = v_region, postal_code = v_postal, country_code = v_country,
         status = v_status, version = version + 1, updated_by = v_actor, updated_at = now()
   where owner_id = p_owner_id and id = p_site_id and version = p_expected_version
   returning * into v_new;
  v_updated := found;
  if not v_updated then
    raise exception 'FORGE_HIERARCHY_STALE_VERSION';
  end if;

  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'site', p_site_id, v_action,
            row_to_json(v_old)::jsonb,
            jsonb_build_object('changed', v_change, 'row', row_to_json(v_new)::jsonb,
                               'movedProjectCount', case when v_action = 'reparent' then v_moved else null end),
            p_request_id);
  return row_to_json(v_new)::jsonb;
end;
$$;

revoke all on function public.forge_hierarchy_site_update(text, text, text, text, text, text, text, text, text, text, text, text, integer, text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_site_update(text, text, text, text, text, text, text, text, text, text, text, text, integer, text) to authenticated;

create or replace function public.forge_hierarchy_project_update(
  p_owner_id text, p_project_id text,
  p_site_id text default null,
  p_name text default null,
  p_project_code text default null,
  p_description text default null,
  p_project_type text default null,
  p_planned_start text default null,
  p_planned_finish text default null,
  p_status text default null,
  p_expected_version integer default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_old public.forge_projects%rowtype;
  v_site_id text;
  v_name text;
  v_code text;
  v_desc text;
  v_type text;
  v_start date;
  v_finish date;
  v_status text;
  v_change jsonb := '{}'::jsonb;
  v_action text;
  v_reparent boolean;
  v_site public.forge_sites%rowtype;
  v_client public.forge_clients%rowtype;
  v_constraint text;
  v_replay record;
  v_new public.forge_projects%rowtype;
  v_updated boolean;
begin
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'FORGE_HIERARCHY_INVALID_ACTOR';
  end if;
  if not public.has_forge_hierarchy_permission(p_owner_id, 'forge.hierarchy.manage') then
    raise exception 'FORGE_HIERARCHY_FORBIDDEN';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'FORGE_HIERARCHY_REQUEST_ID_REQUIRED';
  end if;
  if char_length(p_request_id) > 128 then
    raise exception 'FORGE_HIERARCHY_INVALID_REQUEST_ID';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'FORGE_HIERARCHY_EXPECTED_VERSION_REQUIRED';
  end if;

  select * into v_old from public.forge_projects
  where owner_id = p_owner_id and id = p_project_id for update;
  if not found then
    raise exception 'FORGE_HIERARCHY_NOT_FOUND';
  end if;

  -- Reparent: a new site_id moves the project. The target-site and
  -- target-client eligibility checks are deferred until AFTER the
  -- replay lookup below: a same-request replay must return the
  -- committed row even if the project was moved again since, or the
  -- original target was inactivated/archived. The checks still run
  -- for every first execution, and only on an actual move.
  v_site_id := v_old.site_id;
  v_reparent := false;
  if p_site_id is not null then
    if btrim(p_site_id) = '' then
      raise exception 'FORGE_HIERARCHY_SITE_NOT_FOUND';
    end if;
    if p_site_id <> v_old.site_id then
      v_reparent := true;
    end if;
    v_site_id := p_site_id;
    v_change := v_change || jsonb_build_object('site_id', v_site_id);
  end if;
  v_name := v_old.name;
  if p_name is not null then
    v_name := btrim(p_name);
    if v_name = '' or char_length(v_name) > 200 or v_name ~ '[[:cntrl:]]' then
      raise exception 'FORGE_HIERARCHY_INVALID_NAME';
    end if;
    v_change := v_change || jsonb_build_object('name', v_name);
  end if;
  v_code := v_old.project_code;
  if p_project_code is not null then
    v_code := nullif(btrim(p_project_code), '');
    if v_code is not null and (char_length(v_code) > 64 or v_code ~ '[[:cntrl:]]') then
      raise exception 'FORGE_HIERARCHY_INVALID_PROJECT_CODE';
    end if;
    v_change := v_change || jsonb_build_object('project_code', v_code);
  end if;
  v_desc := v_old.description;
  if p_description is not null then
    v_desc := nullif(btrim(p_description), '');
    if v_desc is not null and (char_length(v_desc) > 2000 or v_desc ~ '[[:cntrl:]]') then
      raise exception 'FORGE_HIERARCHY_INVALID_DESCRIPTION';
    end if;
    v_change := v_change || jsonb_build_object('description', v_desc);
  end if;
  v_type := v_old.project_type;
  if p_project_type is not null then
    v_type := nullif(btrim(p_project_type), '');
    if v_type is not null and (char_length(v_type) > 64 or v_type ~ '[[:cntrl:]]') then
      raise exception 'FORGE_HIERARCHY_INVALID_PROJECT_TYPE';
    end if;
    v_change := v_change || jsonb_build_object('project_type', v_type);
  end if;
  v_start := v_old.planned_start;
  if p_planned_start is not null then
    if btrim(p_planned_start) = '' then
      v_start := null;
    else
      begin
        v_start := btrim(p_planned_start)::date;
      exception when others then
        raise exception 'FORGE_HIERARCHY_INVALID_DATE';
      end;
    end if;
    v_change := v_change || jsonb_build_object('planned_start', v_start);
  end if;
  v_finish := v_old.planned_finish;
  if p_planned_finish is not null then
    if btrim(p_planned_finish) = '' then
      v_finish := null;
    else
      begin
        v_finish := btrim(p_planned_finish)::date;
      exception when others then
        raise exception 'FORGE_HIERARCHY_INVALID_DATE';
      end;
    end if;
    v_change := v_change || jsonb_build_object('planned_finish', v_finish);
  end if;
  if v_start is not null and v_finish is not null and v_finish < v_start then
    raise exception 'FORGE_HIERARCHY_INVALID_DATES';
  end if;
  v_status := v_old.status;
  if p_status is not null then
    v_status := btrim(p_status);
    if v_status not in ('planned', 'active', 'on_hold', 'complete', 'archived') then
      raise exception 'FORGE_HIERARCHY_INVALID_STATUS';
    end if;
    v_change := v_change || jsonb_build_object('status', v_status);
  end if;

  select a.new_values into v_replay
    from public.forge_hierarchy_audit a
    where a.owner_id = p_owner_id and a.entity_type = 'project'
      and a.entity_id = p_project_id and a.request_id = p_request_id;
  if found then
    if v_replay.new_values -> 'changed' <> v_change then
      raise exception 'FORGE_HIERARCHY_REQUEST_ID_CONFLICT';
    end if;
    select * into v_new from public.forge_projects where owner_id = p_owner_id and id = p_project_id;
    return row_to_json(v_new)::jsonb;
  end if;

  -- First execution only: the reparent target site must exist in
  -- THIS workspace AND be active, and so must its client (the client
  -- follows the site — no client_id lives on this row, so a
  -- cross-client move is exactly a site move). Both ancestors are
  -- locked FOR SHARE (site first, then its client) so a concurrent
  -- archive/reparent cannot slip in between the check and the update.
  if v_reparent then
    select * into v_site from public.forge_sites
    where owner_id = p_owner_id and id = v_site_id for share;
    if not found then
      raise exception 'FORGE_HIERARCHY_SITE_NOT_FOUND';
    end if;
    if v_site.status = 'archived' then
      raise exception 'FORGE_HIERARCHY_ARCHIVED';
    end if;
    if v_site.status <> 'active' then
      raise exception 'FORGE_HIERARCHY_PARENT_INACTIVE';
    end if;
    select * into v_client from public.forge_clients
    where owner_id = p_owner_id and id = v_site.client_id for share;
    if not found then
      raise exception 'FORGE_HIERARCHY_SITE_NOT_FOUND';
    end if;
    if v_client.status = 'archived' then
      raise exception 'FORGE_HIERARCHY_ARCHIVED';
    end if;
    if v_client.status <> 'active' then
      raise exception 'FORGE_HIERARCHY_PARENT_INACTIVE';
    end if;
  end if;

  -- Optimistic concurrency is mandatory even for a no-op: a caller
  -- holding a stale version must 409 rather than silently succeed.
  -- Only a same-request-ID replay above may bypass this check.
  if v_old.version <> p_expected_version then
    raise exception 'FORGE_HIERARCHY_STALE_VERSION';
  end if;

  if v_site_id = v_old.site_id and v_name = v_old.name and v_code is not distinct from v_old.project_code
     and v_desc is not distinct from v_old.description and v_type is not distinct from v_old.project_type
     and v_start is not distinct from v_old.planned_start and v_finish is not distinct from v_old.planned_finish
     and v_status = v_old.status then
    return row_to_json(v_old)::jsonb;
  end if;

  if v_code is not null and v_code is distinct from v_old.project_code
     and exists (select 1 from public.forge_projects
                 where owner_id = p_owner_id and id <> p_project_id and project_code = v_code) then
    raise exception 'FORGE_HIERARCHY_DUPLICATE_CODE';
  end if;

  v_action := case
    when v_site_id <> v_old.site_id then 'reparent'
    when v_status = 'archived' and v_old.status <> 'archived' then 'archive'
    when v_old.status = 'archived' and v_status <> 'archived' then 'restore'
    else 'update' end;

  begin
    update public.forge_projects
       set site_id = v_site_id, name = v_name, project_code = v_code,
           description = v_desc, project_type = v_type,
           planned_start = v_start, planned_finish = v_finish,
           status = v_status, version = version + 1, updated_by = v_actor, updated_at = now()
     where owner_id = p_owner_id and id = p_project_id and version = p_expected_version
     returning * into v_new;
  exception when unique_violation then
    -- A raced duplicate code slips past the pre-check above; the
    -- partial unique index is the backstop. Translate the violated
    -- constraint so the caller gets DUPLICATE_CODE, not DUPLICATE_NAME.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'forge_projects_code_uq' then
      raise exception 'FORGE_HIERARCHY_DUPLICATE_CODE';
    end if;
    raise;
  end;
  v_updated := found;
  if not v_updated then
    raise exception 'FORGE_HIERARCHY_STALE_VERSION';
  end if;

  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'project', p_project_id, v_action,
            row_to_json(v_old)::jsonb,
            jsonb_build_object('changed', v_change, 'row', row_to_json(v_new)::jsonb), p_request_id);
  return row_to_json(v_new)::jsonb;
end;
$$;

revoke all on function public.forge_hierarchy_project_update(text, text, text, text, text, text, text, text, text, text, integer, text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_project_update(text, text, text, text, text, text, text, text, text, text, integer, text) to authenticated;

-- --- Hard deletes (archive-first, blockers named) ---------------------------
--
-- Delete is archive-first: a row must be archived before it can be hard
-- deleted, and a parent with children cannot be deleted. The error names
-- the blocker (count included). A replay of the same request id returns
-- {deleted: true} without touching anything — the row is already gone,
-- so the receipt is the audit row itself.

create or replace function public.forge_hierarchy_client_delete(
  p_owner_id text, p_client_id text,
  p_expected_version integer default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_row public.forge_clients%rowtype;
  v_children integer;
  v_prior_action text;
begin
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'FORGE_HIERARCHY_INVALID_ACTOR';
  end if;
  if not public.has_forge_hierarchy_permission(p_owner_id, 'forge.hierarchy.manage') then
    raise exception 'FORGE_HIERARCHY_FORBIDDEN';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'FORGE_HIERARCHY_REQUEST_ID_REQUIRED';
  end if;
  if char_length(p_request_id) > 128 then
    raise exception 'FORGE_HIERARCHY_INVALID_REQUEST_ID';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'FORGE_HIERARCHY_EXPECTED_VERSION_REQUIRED';
  end if;

  -- Replay only a matching prior delete. A request id is unique per
  -- entity across ALL its mutations: reuse after an update/archive/
  -- reparent is a conflict, not a delete — the audit insert below
  -- would otherwise collide with a raw 23505.
  select a.action into v_prior_action
    from public.forge_hierarchy_audit a
    where a.owner_id = p_owner_id and a.entity_type = 'client'
      and a.entity_id = p_client_id and a.request_id = p_request_id;
  if found then
    if v_prior_action = 'delete' then
      return jsonb_build_object('deleted', true, 'id', p_client_id);
    end if;
    raise exception 'FORGE_HIERARCHY_REQUEST_ID_CONFLICT';
  end if;

  select * into v_row from public.forge_clients
  where owner_id = p_owner_id and id = p_client_id for update;
  if not found then
    raise exception 'FORGE_HIERARCHY_NOT_FOUND';
  end if;
  if v_row.version <> p_expected_version then
    raise exception 'FORGE_HIERARCHY_STALE_VERSION';
  end if;
  if v_row.status <> 'archived' then
    raise exception 'FORGE_HIERARCHY_NOT_ARCHIVED';
  end if;
  select count(*)::int into v_children from public.forge_sites
  where owner_id = p_owner_id and client_id = p_client_id;
  if v_children > 0 then
    raise exception 'FORGE_HIERARCHY_HAS_CHILDREN: client % still has % site(s). Archive or delete them first.', p_client_id, v_children;
  end if;

  delete from public.forge_clients where owner_id = p_owner_id and id = p_client_id;
  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'client', p_client_id, 'delete',
            row_to_json(v_row)::jsonb, null, p_request_id);
  return jsonb_build_object('deleted', true, 'id', p_client_id);
end;
$$;

revoke all on function public.forge_hierarchy_client_delete(text, text, integer, text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_client_delete(text, text, integer, text) to authenticated;

create or replace function public.forge_hierarchy_site_delete(
  p_owner_id text, p_site_id text,
  p_expected_version integer default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_row public.forge_sites%rowtype;
  v_children integer;
  v_prior_action text;
begin
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'FORGE_HIERARCHY_INVALID_ACTOR';
  end if;
  if not public.has_forge_hierarchy_permission(p_owner_id, 'forge.hierarchy.manage') then
    raise exception 'FORGE_HIERARCHY_FORBIDDEN';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'FORGE_HIERARCHY_REQUEST_ID_REQUIRED';
  end if;
  if char_length(p_request_id) > 128 then
    raise exception 'FORGE_HIERARCHY_INVALID_REQUEST_ID';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'FORGE_HIERARCHY_EXPECTED_VERSION_REQUIRED';
  end if;

  -- Replay only a matching prior delete (see the client delete: a
  -- request id is unique per entity across ALL its mutations).
  select a.action into v_prior_action
    from public.forge_hierarchy_audit a
    where a.owner_id = p_owner_id and a.entity_type = 'site'
      and a.entity_id = p_site_id and a.request_id = p_request_id;
  if found then
    if v_prior_action = 'delete' then
      return jsonb_build_object('deleted', true, 'id', p_site_id);
    end if;
    raise exception 'FORGE_HIERARCHY_REQUEST_ID_CONFLICT';
  end if;

  select * into v_row from public.forge_sites
  where owner_id = p_owner_id and id = p_site_id for update;
  if not found then
    raise exception 'FORGE_HIERARCHY_NOT_FOUND';
  end if;
  if v_row.version <> p_expected_version then
    raise exception 'FORGE_HIERARCHY_STALE_VERSION';
  end if;
  if v_row.status <> 'archived' then
    raise exception 'FORGE_HIERARCHY_NOT_ARCHIVED';
  end if;
  select count(*)::int into v_children from public.forge_projects
  where owner_id = p_owner_id and site_id = p_site_id;
  if v_children > 0 then
    raise exception 'FORGE_HIERARCHY_HAS_CHILDREN: site % still has % project(s). Archive or delete them first.', p_site_id, v_children;
  end if;

  delete from public.forge_sites where owner_id = p_owner_id and id = p_site_id;
  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'site', p_site_id, 'delete',
            row_to_json(v_row)::jsonb, null, p_request_id);
  return jsonb_build_object('deleted', true, 'id', p_site_id);
end;
$$;

revoke all on function public.forge_hierarchy_site_delete(text, text, integer, text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_site_delete(text, text, integer, text) to authenticated;

create or replace function public.forge_hierarchy_project_delete(
  p_owner_id text, p_project_id text,
  p_expected_version integer default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_row public.forge_projects%rowtype;
  v_prior_action text;
begin
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'FORGE_HIERARCHY_INVALID_ACTOR';
  end if;
  if not public.has_forge_hierarchy_permission(p_owner_id, 'forge.hierarchy.manage') then
    raise exception 'FORGE_HIERARCHY_FORBIDDEN';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'FORGE_HIERARCHY_REQUEST_ID_REQUIRED';
  end if;
  if char_length(p_request_id) > 128 then
    raise exception 'FORGE_HIERARCHY_INVALID_REQUEST_ID';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'FORGE_HIERARCHY_EXPECTED_VERSION_REQUIRED';
  end if;

  -- Replay only a matching prior delete (see the client delete: a
  -- request id is unique per entity across ALL its mutations).
  select a.action into v_prior_action
    from public.forge_hierarchy_audit a
    where a.owner_id = p_owner_id and a.entity_type = 'project'
      and a.entity_id = p_project_id and a.request_id = p_request_id;
  if found then
    if v_prior_action = 'delete' then
      return jsonb_build_object('deleted', true, 'id', p_project_id);
    end if;
    raise exception 'FORGE_HIERARCHY_REQUEST_ID_CONFLICT';
  end if;

  select * into v_row from public.forge_projects
  where owner_id = p_owner_id and id = p_project_id for update;
  if not found then
    raise exception 'FORGE_HIERARCHY_NOT_FOUND';
  end if;
  if v_row.version <> p_expected_version then
    raise exception 'FORGE_HIERARCHY_STALE_VERSION';
  end if;
  if v_row.status <> 'archived' then
    raise exception 'FORGE_HIERARCHY_NOT_ARCHIVED';
  end if;
  -- Slice 1 has no app links yet (PRs B–F create them). When they exist,
  -- this RPC must count them here and raise FORGE_HIERARCHY_HAS_CHILDREN
  -- naming the blockers before the delete below.

  delete from public.forge_projects where owner_id = p_owner_id and id = p_project_id;
  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'project', p_project_id, 'delete',
            row_to_json(v_row)::jsonb, null, p_request_id);
  return jsonb_build_object('deleted', true, 'id', p_project_id);
end;
$$;

revoke all on function public.forge_hierarchy_project_delete(text, text, integer, text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_project_delete(text, text, integer, text) to authenticated;
