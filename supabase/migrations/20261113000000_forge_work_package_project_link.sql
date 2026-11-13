-- ============================================================================
-- Foundation PR B — Planner vertical proof: attach work packages to the
-- shared commercial hierarchy (PR A, migration 20261112010000).
--
--   * forge_work_packages.forge_project_id text null, composite FK
--     (owner_id, forge_project_id) REFERENCES forge_projects(owner_id, id)
--     ON DELETE RESTRICT (never cascade-delete packages). Null is the
--     canonical Unassigned state. No sentinel id, no fake project, no
--     backfill: every existing package stays NULL and byte-identical.
--   * forge_work_package_links — append-only audit for every link/unlink
--     (actor from auth.uid(), request id, reason, timestamp).
--   * forge_work_package_set_project — the ONLY link/unlink write path.
--     SECURITY DEFINER RPC: capability conjunction
--     (planner.packages.edit AND forge.hierarchy.manage), optimistic
--     version CAS, request-id idempotency (same id + same target replays;
--     same id + different target conflicts), target validation (same
--     owner, project + site + client all non-archived), FK + audit in
--     one transaction. A no-op still writes an audit receipt (fix-round-5
--     lesson from #796: a receipt-less no-op can never consume its
--     request id, so a later reuse with a different target would apply
--     instead of conflicting).
--
-- Design decisions the brief forces, recorded so a reviewer does not
-- have to re-derive them:
--   * The legacy forge_work_packages.project_id column is NOT touched
--     and NOT reinterpreted: it keeps its current domain meaning. The
--     shared hierarchy link is forge_project_id only.
--   * Assignment never alters package title, status, type, property,
--     legacy project_id, planning fields, step rows, schedule rows,
--     budget rows/revisions, unrelated timestamps, or import provenance.
--     The RPC updates exactly forge_project_id (+ the trigger-managed
--     version/updated_at and updated_by).
--   * The RPC does NOT create hierarchy identities: a target project
--     must already exist (created through the PR A hierarchy RPCs/UI).
--   * RLS on forge_work_packages is unchanged (workspace policies from
--     the Rung 1 migration). The FK makes cross-workspace attachment
--     impossible at the DB boundary even if a caller guesses a valid
--     project id in another workspace.
--   * Bulk assignment is out of scope (brief §2): the RPC links one
--     package per call. Imports create Unassigned packages; they never
--     auto-link (see the application service note).
--
-- Migration discipline (Nov 4 / Nov 10 lessons): Supabase default
-- privileges grant ALL on newly created public tables, so every
-- privilege this migration does NOT intend is explicitly REVOKED
-- below (audit table: SELECT only for authenticated; RPC: EXECUTE
-- only for authenticated). The post-apply effective-ACL receipt is
-- still mandatory before the migration gate counts complete — SQL
-- text alone is never proof. Object names were checked against the
-- live production schema before writing (no forge_work_package_links
-- table or forge_work_package_set_project function exists there; no
-- forge_project_id column exists on forge_work_packages).
--
-- FILE ONLY in this PR. Do NOT apply to production without a merge +
-- Muse's GO (apply-on-GO standing rule, Jason 2026-11-10 ~14:03).
-- Migration number 20261113000000 confirmed as next free against main
-- 0eedf1e6 at build time (newest on main is 20261112010000).
-- ============================================================================

-- Preflight: fail loudly on a name collision instead of silently
-- redefining an existing column/table/function.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'forge_work_packages'
      and column_name = 'forge_project_id'
  ) then
    raise exception 'FORGE_PRB_COLUMN_EXISTS: forge_work_packages.forge_project_id already exists';
  end if;
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'forge_work_package_links'
  ) then
    raise exception 'FORGE_PRB_TABLE_EXISTS: forge_work_package_links already exists';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'forge_work_package_set_project'
  ) then
    raise exception 'FORGE_PRB_FUNCTION_EXISTS: forge_work_package_set_project already exists';
  end if;
  -- The composite FK needs the exact referenced key: forge_projects
  -- must carry PRIMARY KEY (owner_id, id). PR A created it; verify
  -- rather than assume, because a silently different key would make
  -- the FK reference the wrong uniqueness.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'forge_projects'::regclass and contype = 'p'
      and pg_get_constraintdef(oid) like '%(owner_id, id)%'
  ) then
    raise exception 'FORGE_PRB_PROJECT_KEY_MISSING: forge_projects has no (owner_id, id) primary key';
  end if;
end $$;

-- ============================================================================
-- 1. Package link column + composite FK + partial index.
-- ============================================================================

alter table public.forge_work_packages
  add column forge_project_id text null;

comment on column public.forge_work_packages.forge_project_id is
  'Shared commercial hierarchy link (Foundation PR B). References forge_projects(owner_id, id); null means Unassigned. Distinct from legacy project_id, which keeps its own domain meaning. Set only by forge_work_package_set_project; never by the generic package PATCH.';

alter table public.forge_work_packages
  add constraint forge_work_packages_forge_project_fk
    foreign key (owner_id, forge_project_id)
    references public.forge_projects (owner_id, id)
    on delete restrict;

create index if not exists forge_work_packages_forge_project_idx
  on public.forge_work_packages (owner_id, forge_project_id)
  where forge_project_id is not null;

-- ============================================================================
-- 2. Append-only link audit. No UPDATE/DELETE is ever granted.
-- ============================================================================

create table if not exists public.forge_work_package_links (
  owner_id text not null,
  id text not null,
  package_id text not null,
  old_forge_project_id text,
  new_forge_project_id text,
  actor_id text not null,
  request_id text not null,
  reason text
    check (reason is null or char_length(reason) <= 500)
    check (reason is null or reason !~ '[[:cntrl:]]'),
  recorded_at timestamptz not null default now(),
  primary key (owner_id, id),
  -- One request id applies at most once per package: the replay lookup
  -- below is by (owner_id, package_id, request_id).
  constraint forge_work_package_links_request_uq
    unique (owner_id, package_id, request_id),
  -- Audit references stay inside the workspace: the package FK is
  -- composite on owner_id, and old/new targets (when non-null) must
  -- name projects under the same owner.
  foreign key (owner_id, package_id)
    references public.forge_work_packages (owner_id, id) on delete restrict,
  constraint forge_work_package_links_old_project_fk
    foreign key (owner_id, old_forge_project_id)
    references public.forge_projects (owner_id, id) on delete restrict,
  constraint forge_work_package_links_new_project_fk
    foreign key (owner_id, new_forge_project_id)
    references public.forge_projects (owner_id, id) on delete restrict
);

create index if not exists forge_work_package_links_package_idx
  on public.forge_work_package_links (owner_id, package_id, recorded_at desc, id);

comment on table public.forge_work_package_links is
  'Append-only audit for every work-package project link/unlink (PR B): actor, package, old/new project, request id, reason, UTC time. Rows are written only by forge_work_package_set_project in the same transaction as the link change. No UPDATE/DELETE is ever granted. A no-op link still writes a receipt row (old = new) so its request id is consumed.';

alter table public.forge_work_package_links enable row level security;
alter table public.forge_work_package_links force row level security;

drop policy if exists forge_work_package_links_owner_select on public.forge_work_package_links;
create policy forge_work_package_links_owner_select
  on public.forge_work_package_links for select to authenticated
  using (has_workspace_access(owner_id));

-- No write policies anywhere: the RPC below is the only write path.
revoke all on table public.forge_work_package_links from public, anon, service_role, authenticated;
grant select on table public.forge_work_package_links to authenticated;

-- ============================================================================
-- 3. Link/unlink RPC — the ONLY write path. SECURITY DEFINER, actor
--    from auth.uid(), optimistic version CAS, request-id idempotency.
--
-- Conventions (mirroring the PR A hierarchy RPCs and the #796 planning
-- RPCs): nullable target means "unlink" only when explicitly passed as
-- null (the JS service distinguishes omitted from null); expected
-- version is MANDATORY (stale = 409); request id is MANDATORY
-- (missing = 400, >128 chars = 400); same request id + same target
-- replays the current row; same request id + different target is a
-- 409 conflict; the package row is locked FOR UPDATE so concurrent
-- links serialize; the target project (and its site + client) must
-- exist under the same owner and be non-archived (a project whose
-- site or client is archived is rejected the same way
-- forge_hierarchy_validate_selection rejects it).
-- ============================================================================

create or replace function public.forge_work_package_set_project(
  p_owner_id text,
  p_package_id text,
  p_forge_project_id text,
  p_expected_version integer,
  p_request_id text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_target text;
  v_reason text;
  v_change jsonb;
  v_replay record;
  v_pkg public.forge_work_packages%rowtype;
  v_old_target text;
  v_project public.forge_projects%rowtype;
  v_site public.forge_sites%rowtype;
  v_client public.forge_clients%rowtype;
  v_is_noop boolean;
begin
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'FORGE_PRB_INVALID_ACTOR';
  end if;
  -- Capability conjunction: the Planner package-edit permission AND
  -- the hierarchy manage capability. Owner/co-owner pass both
  -- predicates automatically; a staff member needs both keys.
  if not public.has_planner_permission(p_owner_id, 'planner.packages.edit') then
    raise exception 'FORGE_PRB_FORBIDDEN';
  end if;
  if not public.has_forge_hierarchy_permission(p_owner_id, 'forge.hierarchy.manage') then
    raise exception 'FORGE_PRB_FORBIDDEN';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'FORGE_PRB_REQUEST_ID_REQUIRED';
  end if;
  if char_length(p_request_id) > 128 then
    raise exception 'FORGE_PRB_INVALID_REQUEST_ID';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'FORGE_PRB_EXPECTED_VERSION_REQUIRED';
  end if;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is not null and (char_length(v_reason) > 500 or v_reason ~ '[[:cntrl:]]') then
    raise exception 'FORGE_PRB_INVALID_REASON';
  end if;
  -- Canonicalize the target: empty string unlinks, exactly like null.
  v_target := nullif(btrim(coalesce(p_forge_project_id, '')), '');

  v_change := jsonb_build_object('forge_project_id', v_target);

  -- Serialize concurrent links sharing one request id: with no audit
  -- row yet, two identical requests could both pass the replay
  -- pre-check and collide on the audit unique index. The advisory
  -- lock makes the second wait, then see the first's audit row and
  -- replay it. (Same pattern as the PR A hierarchy creates.)
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_request_id));

  -- Replay: same request id + same target returns the current row.
  select l.new_forge_project_id into v_replay
    from public.forge_work_package_links l
    where l.owner_id = p_owner_id and l.package_id = p_package_id
      and l.request_id = p_request_id;
  if found then
    if v_replay.new_forge_project_id is distinct from v_target then
      raise exception 'FORGE_PRB_REQUEST_ID_CONFLICT';
    end if;
    select * into v_pkg from public.forge_work_packages
      where owner_id = p_owner_id and id = p_package_id;
    if not found then
      raise exception 'FORGE_PRB_PACKAGE_NOT_FOUND';
    end if;
    return row_to_json(v_pkg)::jsonb;
  end if;

  -- Lock the package row: the version CAS and the link write below
  -- are atomic under this lock, so a concurrent link cannot slip in
  -- between the check and the update. Owner-scoped: a package in
  -- another workspace is simply not found (non-disclosing).
  select * into v_pkg from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id
    for update;
  if not found then
    raise exception 'FORGE_PRB_PACKAGE_NOT_FOUND';
  end if;
  if v_pkg.version <> p_expected_version then
    raise exception 'FORGE_PRB_STALE_VERSION';
  end if;

  -- Validate the target project (first-execution check): same owner,
  -- exists, and project + site + client all non-archived. The
  -- composite FK is the backstop; this check names the reason.
  if v_target is not null then
    select * into v_project from public.forge_projects
      where owner_id = p_owner_id and id = v_target;
    if not found then
      raise exception 'FORGE_PRB_PROJECT_NOT_FOUND';
    end if;
    select * into v_site from public.forge_sites
      where owner_id = p_owner_id and id = v_project.site_id;
    if not found then
      raise exception 'FORGE_PRB_PROJECT_NOT_FOUND';
    end if;
    select * into v_client from public.forge_clients
      where owner_id = p_owner_id and id = v_site.client_id;
    if not found then
      raise exception 'FORGE_PRB_PROJECT_NOT_FOUND';
    end if;
    if v_project.status = 'archived' or v_site.status = 'archived' or v_client.status = 'archived' then
      raise exception 'FORGE_PRB_PROJECT_ARCHIVED';
    end if;
  end if;

  v_is_noop := (v_pkg.forge_project_id is not distinct from v_target);
  -- Capture the pre-update link now: the UPDATE below reassigns v_pkg
  -- to the new row, so the audit insert must read the old value from
  -- this variable, not from v_pkg.
  v_old_target := v_pkg.forge_project_id;

  -- The link write + audit receipt in one transaction. A no-op still
  -- writes its receipt row (old = new) so the request id is consumed:
  -- without it, a later reuse of the same request id with a different
  -- target would apply instead of conflicting. A no-op does NOT bump
  -- the package version (the update is skipped entirely).
  if not v_is_noop then
    update public.forge_work_packages
      set forge_project_id = v_target, updated_by = v_actor
      where owner_id = p_owner_id and id = p_package_id
      returning * into v_pkg;
  end if;
  insert into public.forge_work_package_links
    (owner_id, id, package_id, old_forge_project_id, new_forge_project_id, actor_id, request_id, reason)
    values (
      p_owner_id,
      'forge_wpl_' || replace(gen_random_uuid()::text, '-', ''),
      p_package_id,
      v_old_target,
      v_target,
      v_actor,
      p_request_id,
      v_reason
    );
  -- Re-read so the returned row is the stored row even on the no-op
  -- path (the UPDATE ... RETURNING above already did this when the
  -- link changed; the no-op path returns the locked row as stored).
  if v_is_noop then
    select * into v_pkg from public.forge_work_packages
      where owner_id = p_owner_id and id = p_package_id;
  end if;
  return row_to_json(v_pkg)::jsonb;
end;
$$;

revoke all on function public.forge_work_package_set_project(text, text, text, integer, text, text) from public, anon, service_role;
grant execute on function public.forge_work_package_set_project(text, text, text, integer, text, text) to authenticated;

comment on function public.forge_work_package_set_project(text, text, text, integer, text, text) is
  'PR B link/unlink RPC (the only write path for forge_work_packages.forge_project_id). Requires planner.packages.edit AND forge.hierarchy.manage; optimistic version CAS; request-id idempotency with audit receipt (a no-op still writes a receipt so its request id is consumed); target project + site + client must exist under the same owner and be non-archived. Returns the stored package row.';
