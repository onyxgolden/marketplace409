-- ============================================================================
-- Planner hierarchy management page — admin inventory read RPC + project
-- delete package-block repair.
--
--   * forge_hierarchy_admin_inventory(p_owner_id) — new narrowly scoped
--     SECURITY DEFINER read RPC: the full management inventory for one
--     workspace (every client/site/project in ANY status, with complete
--     identity fields, parent links, and optimistic-concurrency
--     versions) plus a server-proven canManage flag. The existing
--     selector RPC returns only non-archived rows and a subset of
--     fields, so a durable full-CRUD manager cannot be built on it
--     (brief: planner-hierarchy-management-page-build-brief-2026-11-15,
--     drop b11bfe82; Jason approved this read extension + full CRUD
--     build Nov 15 13:37 CST). Read-only: no writes, no audit row.
--   * forge_hierarchy_project_delete — repaired: the shipped function
--     never counted assigned work packages (only a TODO comment said
--     "when they exist, count them here"). A project with assigned
--     packages now raises FORGE_HIERARCHY_HAS_CHILDREN naming the
--     count, instead of falling through to the FK RESTRICT (raw 23503,
--     which the application service mis-maps to NOT_FOUND). Any
--     status counts, including cancelled packages.
--
-- Prerequisites: foundation 20261112010000 (tables + capability
-- helper) and PR-B link 20261113000000 (forge_work_packages.
-- forge_project_id FK) must already be applied. This migration adds
-- ONE function and replaces ONE function; no tables, no RLS/policy
-- changes, no new write RPC, no billing fields.
--
-- Migration discipline (Nov 4 / Nov 10 lessons): Supabase default
-- privileges grant ALL on newly created public functions, so every
-- privilege this migration does NOT intend is explicitly REVOKED
-- below (new RPC: EXECUTE only for authenticated). The post-apply
-- effective-ACL receipt is still mandatory before the migration gate
-- counts complete — SQL text alone is never proof.
--
-- FILE ONLY in this PR. Do NOT apply to production without a merge +
-- Jason's separate word (the brief retains an explicit
-- migration-apply authorization gate).
-- Migration number 20261113050000 confirmed as next free against main
-- 82d061f6 at build time (newest on main is 20261113040000).
-- NOTE: the parallel busts slice (dispatched Nov 15 ~13:37 CST) may
-- also claim 20261113050000 as next-free; if both PRs land with this
-- number, the later merge renames its file to the next free number.
-- ============================================================================

-- Preflight: fail loudly on a name collision or a missing prerequisite
-- instead of silently redefining a function or shipping a broken RPC.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'forge_hierarchy_admin_inventory'
  ) then
    raise exception 'FORGE_HMI_FUNCTION_EXISTS: public.forge_hierarchy_admin_inventory already exists';
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'forge_clients'
  ) then
    raise exception 'FORGE_HMI_PREREQ_MISSING: forge_clients does not exist — apply 20261112010000 first';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'forge_work_packages'
      and column_name = 'forge_project_id'
  ) then
    raise exception 'FORGE_HMI_PREREQ_MISSING: forge_work_packages.forge_project_id does not exist — apply 20261113000000 first';
  end if;
end $$;

-- ============================================================================
-- forge_hierarchy_admin_inventory — full management inventory.
-- SECURITY DEFINER with row_security = off: it bypasses RLS deliberately,
-- after its own forge.hierarchy.read gate — the SELECT policies admit
-- owner/co-owner only, so a staff reader's only read path is this RPC
-- (same pattern as forge_hierarchy_selector). Read-only: no mutation,
-- no audit row, no request id. canManage is computed server-side from
-- the same capability helper the write RPCs use — the UI hides mutation
-- controls on this flag and never infers permission itself.
-- ============================================================================

create or replace function public.forge_hierarchy_admin_inventory(p_owner_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_result jsonb;
  v_can_manage boolean;
begin
  if not public.has_forge_hierarchy_permission(p_owner_id, 'forge.hierarchy.read') then
    raise exception 'FORGE_HIERARCHY_FORBIDDEN';
  end if;
  v_can_manage := public.has_forge_hierarchy_permission(p_owner_id, 'forge.hierarchy.manage');

  select jsonb_build_object(
    'ownerId', p_owner_id,
    'canManage', v_can_manage,
    'clients', coalesce((
      select jsonb_agg(client_json order by client_json ->> 'name_normalized')
      from (
        select jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'name_normalized', c.name_normalized,
          'external_reference', c.external_reference,
          'status', c.status,
          'notes', c.notes,
          'version', c.version,
          'created_by', c.created_by,
          'updated_by', c.updated_by,
          'created_at', c.created_at,
          'updated_at', c.updated_at,
          'sites', coalesce((
            select jsonb_agg(site_json order by site_json ->> 'name_normalized')
            from (
              select jsonb_build_object(
                'id', s.id,
                'client_id', s.client_id,
                'name', s.name,
                'name_normalized', s.name_normalized,
                'site_type', s.site_type,
                'address_line1', s.address_line1,
                'address_line2', s.address_line2,
                'city', s.city,
                'region', s.region,
                'postal_code', s.postal_code,
                'country_code', s.country_code,
                'status', s.status,
                'version', s.version,
                'created_by', s.created_by,
                'updated_by', s.updated_by,
                'created_at', s.created_at,
                'updated_at', s.updated_at,
                'projects', coalesce((
                  select jsonb_agg(project_json order by project_json ->> 'name_normalized')
                  from (
                    select jsonb_build_object(
                      'id', p.id,
                      'site_id', p.site_id,
                      'name', p.name,
                      'name_normalized', p.name_normalized,
                      'project_code', p.project_code,
                      'description', p.description,
                      'project_type', p.project_type,
                      'planned_start', p.planned_start,
                      'planned_finish', p.planned_finish,
                      'status', p.status,
                      'version', p.version,
                      'created_by', p.created_by,
                      'updated_by', p.updated_by,
                      'created_at', p.created_at,
                      'updated_at', p.updated_at,
                      -- Assigned-package count (ANY status, including
                      -- cancelled): the UI shows the delete-block reason
                      -- without a second call. The server delete RPC
                      -- re-counts — this number is display only.
                      'package_count', (
                        select count(*)::int from public.forge_work_packages w
                        where w.owner_id = p_owner_id and w.forge_project_id = p.id
                      )
                    ) as project_json
                    from public.forge_projects p
                    where p.owner_id = p_owner_id and p.site_id = s.id
                  ) projects
                ), '[]'::jsonb)
              ) as site_json
              from public.forge_sites s
              where s.owner_id = p_owner_id and s.client_id = c.id
            ) sites
          ), '[]'::jsonb)
        ) as client_json
        from public.forge_clients c
        where c.owner_id = p_owner_id
      ) clients
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

comment on function public.forge_hierarchy_admin_inventory(text) is
'Read-only management inventory for the Planner hierarchy admin page. Returns every client/site/project in any status with complete identity fields and optimistic-concurrency versions, plus a server-computed canManage flag. Gated on forge.hierarchy.read; no writes, no audit row.';

revoke all on function public.forge_hierarchy_admin_inventory(text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_admin_inventory(text) to authenticated;

-- ============================================================================
-- forge_hierarchy_project_delete — repaired to block on assigned work
-- packages. The shipped function never counted them (only a TODO
-- comment); a delete with assigned packages fell through to the FK
-- RESTRICT (raw 23503, mis-mapped to NOT_FOUND by the application
-- service). Now the RPC counts forge_work_packages rows for the
-- project — any status, including cancelled — and raises
-- FORGE_HIERARCHY_HAS_CHILDREN naming the count before the delete.
-- Everything else is byte-identical to the shipped function.
-- ============================================================================

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
  v_packages integer;
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
  -- Assigned packages block the delete — ANY status counts, including
  -- cancelled packages (the FK link survives cancellation). Never
  -- silently clear forge_project_id, reassign, or delete packages.
  select count(*)::int into v_packages from public.forge_work_packages
  where owner_id = p_owner_id and forge_project_id = p_project_id;
  if v_packages > 0 then
    raise exception 'FORGE_HIERARCHY_HAS_CHILDREN: project % still has % assigned package(s). Unassign or move them first.', p_project_id, v_packages;
  end if;

  delete from public.forge_projects where owner_id = p_owner_id and id = p_project_id;
  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'project', p_project_id, 'delete',
            row_to_json(v_row)::jsonb, null, p_request_id);
  return jsonb_build_object('deleted', true, 'id', p_project_id);
end;
$$;

revoke all on function public.forge_hierarchy_project_delete(text, text, integer, text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_project_delete(text, text, integer, text) to authenticated;
