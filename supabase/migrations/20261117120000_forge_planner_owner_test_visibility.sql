-- FORGE Planner: owner-only test client with DB-enforced isolation.
--
-- Scope brief: results/chatgpt/planner-test-client-scope-2026-11-17.md
-- (drop c92af13b0, Jason approved the build 2026-11-17 ~16:44 CST).
--
-- What this migration does:
--   1. Adds is_test (boolean, NOT NULL, default false) to forge_clients
--      ONLY. Sites/projects inherit by immutable FK ancestry; packages
--      inherit via forge_project_id. No backfill of true values: every
--      existing client stays real.
--   2. Denormalizes is_test onto forge_hierarchy_audit and
--      forge_work_package_links at write time (set by the SECURITY
--      DEFINER RPCs below): audit rows carry full row JSON including
--      test client names, and the flag must survive entity deletion.
--   3. Replaces the SELECT/INSERT/UPDATE/DELETE/ALL policies on every
--      package-descendant table with the same base predicate AND a test
--      predicate (not test-rooted OR the caller is the platform owner).
--      Base predicates are preserved verbatim (including the trial
--      entitlement AND clause and the busts / hierarchy exceptions).
--   4. Adds a BEFORE INSERT/UPDATE/DELETE trigger guard on every table
--      the ~60 SECURITY DEFINER work-package mutation RPCs write, so a
--      co-owner cannot mutate test data through an RPC that bypasses RLS.
--   5. Patches the 11 hierarchy/link RPCs (selector, validate,
--      admin_inventory, all client/site/project create/update/delete,
--      set_project) with the same visibility predicate, actor proof on
--      the actual client ancestor, reparent/link boundary rules, and
--      fresh actor/visibility checks on replays.
--   6. Adds the owner-only forge_hierarchy_client_create_test RPC (the
--      only way to create a test client) and the owner-only
--      forge_hierarchy_test_inventory RPC (?mode=test).
--   7. Patches the read-only forge_work_planning_process_checklist RPC
--      so a test package's 22-row checklist is invisible to non-owners.
--
-- Platform owner = auth.uid()::text = p_owner_id (the authenticated
-- immutable identity). NEVER has_workspace_access, a co-owner role, a
-- caller-supplied isOwner, JWT role claims, or effectiveOwnerId alone.
-- Non-owner reads of test rows return non-disclosing 404 / empty lists.
--
-- FILE ONLY in this PR. Do NOT apply to production without a merge +
-- ChatGPT GO + Muse's agreement check AND Jason's separate word: this
-- brief retains an explicit migration-apply gate (apply on HOLD even
-- after code GO).
-- Migration number 20261117120000 confirmed as next free against main
-- 7f6509e1 at build time (newest on main is 20261117110000).

-- ---------------------------------------------------------------------------
-- 1. is_test columns. Default false: every existing client stays real,
--    and the regular client-create RPC can never mint a test client
--    (it takes no is_test parameter and the column default applies).
--    The test marker is immutable: the trigger below rejects any UPDATE
--    that changes it, and there is no test->real conversion.
-- ---------------------------------------------------------------------------

alter table public.forge_clients
  add column if not exists is_test boolean not null default false;
comment on column public.forge_clients.is_test is
'Owner-only test client marker. True only for the platform owner''s fictional test clients (created via forge_hierarchy_client_create_test). Sites/projects/packages inherit test-ness by FK ancestry; the marker is immutable.';

alter table public.forge_hierarchy_audit
  add column if not exists is_test boolean not null default false;
comment on column public.forge_hierarchy_audit.is_test is
'Denormalized test marker, set at write time by the hierarchy RPCs. Audit rows carry full row JSON (including test client names) and must survive entity deletion, so the flag cannot be resolved by joining the entity afterwards.';

alter table public.forge_work_package_links
  add column if not exists is_test boolean not null default false;
comment on column public.forge_work_package_links.is_test is
'Denormalized test marker, set at write time by forge_work_package_set_project. True when the package, the old target, or the new target is test: once a link touches a test project it stays test forever.';

create index if not exists idx_forge_clients_owner_test
  on public.forge_clients (owner_id, is_test) where is_test;
create index if not exists idx_forge_hierarchy_audit_owner_test
  on public.forge_hierarchy_audit (owner_id, is_test) where is_test;
create index if not exists idx_forge_work_package_links_owner_test
  on public.forge_work_package_links (owner_id, is_test) where is_test;

create or replace function public.forge_clients_is_test_immutable()
returns trigger language plpgsql as $$
begin
  if old.is_test is distinct from new.is_test then
    raise exception 'FORGE_HIERARCHY_TEST_MARKER_IMMUTABLE: is_test cannot change after creation';
  end if;
  return new;
end;
$$;

drop trigger if exists forge_clients_is_test_immutable on public.forge_clients;
create trigger forge_clients_is_test_immutable
  before update on public.forge_clients
  for each row execute function public.forge_clients_is_test_immutable();


-- ---------------------------------------------------------------------------
-- 2. Test-visibility resolvers.
--
-- One STABLE SECURITY DEFINER helper per key shape. Each resolves whether
-- the row it is asked about is test-rooted (its client ancestor carries
-- is_test = true). Rules shared by all of them:
--   * No workspace access for the caller -> false. The RLS predicate
--     already ANDs has_workspace_access; the check inside the helper is
--     defense in depth for the policy-evaluation path.
--   * A missing parent (deleted, or an id that never existed) -> true:
--     fail closed, hide the row rather than leak it.
--   * A NULL project link (an Unassigned package) -> false: Unassigned
--     packages are never test data (the loader births samples linked).
-- The helpers read through RLS (row_security = off) because the caller's
-- own RLS would hide exactly the test rows they must resolve.
--
-- EXPOSURE (fix round 1, PR #829 NEEDS CHANGES P1): the resolvers live
-- in the private schema forge_planner_internal, NOT in public, and NO
-- USAGE is granted on that schema to any application role. PostgREST
-- (Supabase RPC) only exposes the public schema, so there is no public
-- RPC that returns a test classification for any id. A direct call to
-- a helper fails twice over: the public name does not exist (42883),
-- and the private-schema name is unreachable without schema USAGE
-- (42501), even for a role that holds EXECUTE on the function.
-- EXECUTE is still granted to authenticated (and service_role) because
-- RLS policy evaluation REQUIRES it: proven on real PG16, a policy
-- SELECT fails with "permission denied for function" when the querying
-- role lacks EXECUTE on the helper, even though the policy runs with
-- the table owner's privileges for table access. Revoking EXECUTE from
-- authenticated is therefore NOT a fix — it breaks the policies.
-- anon holds no EXECUTE (anon has no SELECT on any test-gated table
-- and never evaluates these policies) and no USAGE. The owner needs no
-- direct helper call: the app reads test rows through tables/RPCs, and
-- the policies answer for the owner exactly as for any caller.
-- ---------------------------------------------------------------------------

-- The private schema for the resolvers. No USAGE is granted on it to
-- any role (see the exposure note above): the helpers are reachable
-- only from RLS policy expressions and SECURITY DEFINER RPCs/triggers
-- running as postgres, never as an external RPC.
create schema if not exists forge_planner_internal;
comment on schema forge_planner_internal is
'Private helpers for the planner test-client slice (is_test resolvers). Not API-exposed: PostgREST only serves the public schema, and no USAGE is granted on this schema, so no application role can invoke these functions directly.';

create or replace function forge_planner_internal.forge_test_client_is_test(p_owner_id text, p_client_id text)
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when not public.has_workspace_access(p_owner_id) then false
    when p_client_id is null then true
    when not exists (select 1 from public.forge_clients c where c.owner_id = p_owner_id and c.id = p_client_id) then true
    else (select c.is_test from public.forge_clients c where c.owner_id = p_owner_id and c.id = p_client_id)
  end;
$$;

create or replace function forge_planner_internal.forge_test_site_is_test(p_owner_id text, p_site_id text)
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when not public.has_workspace_access(p_owner_id) then false
    when p_site_id is null then true
    when not exists (select 1 from public.forge_sites s where s.owner_id = p_owner_id and s.id = p_site_id) then true
    else forge_planner_internal.forge_test_client_is_test(p_owner_id, (select s.client_id from public.forge_sites s where s.owner_id = p_owner_id and s.id = p_site_id))
  end;
$$;

create or replace function forge_planner_internal.forge_test_project_is_test(p_owner_id text, p_project_id text)
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when not public.has_workspace_access(p_owner_id) then false
    when p_project_id is null then false
    when not exists (select 1 from public.forge_projects p where p.owner_id = p_owner_id and p.id = p_project_id) then true
    else forge_planner_internal.forge_test_site_is_test(p_owner_id, (select p.site_id from public.forge_projects p where p.owner_id = p_owner_id and p.id = p_project_id))
  end;
$$;

create or replace function forge_planner_internal.forge_test_package_is_test(p_owner_id text, p_package_id text)
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when not public.has_workspace_access(p_owner_id) then false
    when p_package_id is null then true
    when not exists (select 1 from public.forge_work_packages w where w.owner_id = p_owner_id and w.id = p_package_id) then true
    else forge_planner_internal.forge_test_project_is_test(p_owner_id, (select w.forge_project_id from public.forge_work_packages w where w.owner_id = p_owner_id and w.id = p_package_id))
  end;
$$;

create or replace function forge_planner_internal.forge_test_drawing_is_test(p_owner_id text, p_drawing_id text)
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when not public.has_workspace_access(p_owner_id) then false
    when p_drawing_id is null then true
    when not exists (select 1 from public.forge_work_drawings d where d.owner_id = p_owner_id and d.id = p_drawing_id) then true
    else forge_planner_internal.forge_test_package_is_test(p_owner_id, (select d.package_id from public.forge_work_drawings d where d.owner_id = p_owner_id and d.id = p_drawing_id))
  end;
$$;

create or replace function forge_planner_internal.forge_test_takeoff_line_is_test(p_owner_id text, p_takeoff_line_id text)
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when not public.has_workspace_access(p_owner_id) then false
    when p_takeoff_line_id is null then true
    when not exists (select 1 from public.forge_work_takeoff_lines t where t.owner_id = p_owner_id and t.id = p_takeoff_line_id) then true
    else forge_planner_internal.forge_test_drawing_is_test(p_owner_id, (select t.drawing_id from public.forge_work_takeoff_lines t where t.owner_id = p_owner_id and t.id = p_takeoff_line_id))
  end;
$$;

create or replace function forge_planner_internal.forge_test_step_is_test(p_owner_id text, p_step_id text)
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when not public.has_workspace_access(p_owner_id) then false
    when p_step_id is null then true
    when not exists (select 1 from public.forge_work_steps s where s.owner_id = p_owner_id and s.id = p_step_id) then true
    else forge_planner_internal.forge_test_package_is_test(p_owner_id, (select s.work_package_id from public.forge_work_steps s where s.owner_id = p_owner_id and s.id = p_step_id))
  end;
$$;

create or replace function forge_planner_internal.forge_test_change_order_is_test(p_owner_id text, p_change_order_id text)
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when not public.has_workspace_access(p_owner_id) then false
    when p_change_order_id is null then true
    when not exists (select 1 from public.forge_work_change_orders o where o.owner_id = p_owner_id and o.id = p_change_order_id) then true
    else forge_planner_internal.forge_test_package_is_test(p_owner_id, (select o.work_package_id from public.forge_work_change_orders o where o.owner_id = p_owner_id and o.id = p_change_order_id))
  end;
$$;

create or replace function forge_planner_internal.forge_test_control_estimate_is_test(p_owner_id text, p_control_estimate_id text)
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when not public.has_workspace_access(p_owner_id) then false
    when p_control_estimate_id is null then true
    when not exists (select 1 from public.forge_work_control_estimates e where e.owner_id = p_owner_id and e.id = p_control_estimate_id) then true
    else forge_planner_internal.forge_test_package_is_test(p_owner_id, (select e.work_package_id from public.forge_work_control_estimates e where e.owner_id = p_owner_id and e.id = p_control_estimate_id))
  end;
$$;

create or replace function forge_planner_internal.forge_test_craft_assignment_is_test(p_owner_id text, p_craft_assignment_id text)
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when not public.has_workspace_access(p_owner_id) then false
    when p_craft_assignment_id is null then true
    when not exists (select 1 from public.forge_work_craft_assignments a where a.owner_id = p_owner_id and a.id = p_craft_assignment_id) then true
    else forge_planner_internal.forge_test_package_is_test(p_owner_id, (select a.work_package_id from public.forge_work_craft_assignments a where a.owner_id = p_owner_id and a.id = p_craft_assignment_id))
  end;
$$;

create or replace function forge_planner_internal.forge_test_craft_rate_is_test(p_owner_id text, p_craft_rate_id text)
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when not public.has_workspace_access(p_owner_id) then false
    when p_craft_rate_id is null then true
    when not exists (select 1 from public.forge_work_craft_rates r where r.owner_id = p_owner_id and r.id = p_craft_rate_id) then true
    else forge_planner_internal.forge_test_package_is_test(p_owner_id, (select r.work_package_id from public.forge_work_craft_rates r where r.owner_id = p_owner_id and r.id = p_craft_rate_id))
  end;
$$;

create or replace function forge_planner_internal.forge_test_progress_entry_is_test(p_owner_id text, p_progress_entry_id text)
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when not public.has_workspace_access(p_owner_id) then false
    when p_progress_entry_id is null then true
    when not exists (select 1 from public.forge_work_progress_entries e where e.owner_id = p_owner_id and e.id = p_progress_entry_id) then true
    else forge_planner_internal.forge_test_package_is_test(p_owner_id, (select e.work_package_id from public.forge_work_progress_entries e where e.owner_id = p_owner_id and e.id = p_progress_entry_id))
  end;
$$;

create or replace function forge_planner_internal.forge_test_permit_annotation_is_test(p_owner_id text, p_permit_annotation_id text)
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when not public.has_workspace_access(p_owner_id) then false
    when p_permit_annotation_id is null then true
    when not exists (select 1 from public.forge_work_permit_annotations a where a.owner_id = p_owner_id and a.id = p_permit_annotation_id) then true
    else forge_planner_internal.forge_test_package_is_test(p_owner_id, (select a.work_package_id from public.forge_work_permit_annotations a where a.owner_id = p_owner_id and a.id = p_permit_annotation_id))
  end;
$$;

create or replace function forge_planner_internal.forge_test_placement_is_test(p_owner_id text, p_placement_id text)
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when not public.has_workspace_access(p_owner_id) then false
    when p_placement_id is null then true
    when not exists (select 1 from public.forge_work_step_curve_placements p where p.owner_id = p_owner_id and p.id = p_placement_id) then true
    else forge_planner_internal.forge_test_package_is_test(p_owner_id, (select p.work_package_id from public.forge_work_step_curve_placements p where p.owner_id = p_owner_id and p.id = p_placement_id))
  end;
$$;

create or replace function forge_planner_internal.forge_test_step_link_is_test(p_owner_id text, p_step_link_id text)
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when not public.has_workspace_access(p_owner_id) then false
    when p_step_link_id is null then true
    when not exists (select 1 from public.forge_work_step_drawing_links l where l.owner_id = p_owner_id and l.id = p_step_link_id) then true
    else forge_planner_internal.forge_test_package_is_test(p_owner_id, (select l.work_package_id from public.forge_work_step_drawing_links l where l.owner_id = p_owner_id and l.id = p_step_link_id))
  end;
$$;

create or replace function forge_planner_internal.forge_test_bust_is_test(p_owner_id text, p_bust_id text)
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when not public.has_workspace_access(p_owner_id) then false
    when p_bust_id is null then true
    when not exists (select 1 from public.forge_work_package_busts b where b.owner_id = p_owner_id and b.id = p_bust_id) then true
    else forge_planner_internal.forge_test_package_is_test(p_owner_id, (select b.work_package_id from public.forge_work_package_busts b where b.owner_id = p_owner_id and b.id = p_bust_id))
  end;
$$;

create or replace function forge_planner_internal.forge_test_work_link_is_test(
  p_owner_id text, p_source_domain text, p_source_type text, p_source_id text,
  p_target_domain text, p_target_type text, p_target_id text)
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when not public.has_workspace_access(p_owner_id) then false
    when p_source_domain = 'workmgmt' and p_source_type = 'work_package'
      and forge_planner_internal.forge_test_package_is_test(p_owner_id, p_source_id) then true
    when p_target_domain = 'workmgmt' and p_target_type = 'work_package'
      and forge_planner_internal.forge_test_package_is_test(p_owner_id, p_target_id) then true
    else false
  end;
$$;

create or replace function forge_planner_internal.forge_test_work_link_confirmation_is_test(p_owner_id text, p_link_id text)
returns boolean language sql stable security definer set search_path = public set row_security = off as $$
  select case
    when not public.has_workspace_access(p_owner_id) then false
    when p_link_id is null then true
    when not exists (select 1 from public.forge_work_links l where l.owner_id = p_owner_id and l.id = p_link_id) then true
    else forge_planner_internal.forge_test_work_link_is_test(
      p_owner_id,
      (select l.source_domain from public.forge_work_links l where l.owner_id = p_owner_id and l.id = p_link_id),
      (select l.source_type from public.forge_work_links l where l.owner_id = p_owner_id and l.id = p_link_id),
      (select l.source_id from public.forge_work_links l where l.owner_id = p_owner_id and l.id = p_link_id),
      (select l.target_domain from public.forge_work_links l where l.owner_id = p_owner_id and l.id = p_link_id),
      (select l.target_type from public.forge_work_links l where l.owner_id = p_owner_id and l.id = p_link_id),
      (select l.target_id from public.forge_work_links l where l.owner_id = p_owner_id and l.id = p_link_id))
  end;
$$;

revoke all on function forge_planner_internal.forge_test_client_is_test(text, text) from public;
revoke all on function forge_planner_internal.forge_test_site_is_test(text, text) from public;
revoke all on function forge_planner_internal.forge_test_project_is_test(text, text) from public;
revoke all on function forge_planner_internal.forge_test_package_is_test(text, text) from public;
revoke all on function forge_planner_internal.forge_test_drawing_is_test(text, text) from public;
revoke all on function forge_planner_internal.forge_test_takeoff_line_is_test(text, text) from public;
revoke all on function forge_planner_internal.forge_test_step_is_test(text, text) from public;
revoke all on function forge_planner_internal.forge_test_change_order_is_test(text, text) from public;
revoke all on function forge_planner_internal.forge_test_control_estimate_is_test(text, text) from public;
revoke all on function forge_planner_internal.forge_test_craft_assignment_is_test(text, text) from public;
revoke all on function forge_planner_internal.forge_test_craft_rate_is_test(text, text) from public;
revoke all on function forge_planner_internal.forge_test_progress_entry_is_test(text, text) from public;
revoke all on function forge_planner_internal.forge_test_permit_annotation_is_test(text, text) from public;
revoke all on function forge_planner_internal.forge_test_placement_is_test(text, text) from public;
revoke all on function forge_planner_internal.forge_test_step_link_is_test(text, text) from public;
revoke all on function forge_planner_internal.forge_test_bust_is_test(text, text) from public;
revoke all on function forge_planner_internal.forge_test_work_link_is_test(text, text, text, text, text, text, text) from public;
revoke all on function forge_planner_internal.forge_test_work_link_confirmation_is_test(text, text) from public;
grant execute on function forge_planner_internal.forge_test_client_is_test(text, text) to authenticated, service_role;
grant execute on function forge_planner_internal.forge_test_site_is_test(text, text) to authenticated, service_role;
grant execute on function forge_planner_internal.forge_test_project_is_test(text, text) to authenticated, service_role;
grant execute on function forge_planner_internal.forge_test_package_is_test(text, text) to authenticated, service_role;
grant execute on function forge_planner_internal.forge_test_drawing_is_test(text, text) to authenticated, service_role;
grant execute on function forge_planner_internal.forge_test_takeoff_line_is_test(text, text) to authenticated, service_role;
grant execute on function forge_planner_internal.forge_test_step_is_test(text, text) to authenticated, service_role;
grant execute on function forge_planner_internal.forge_test_change_order_is_test(text, text) to authenticated, service_role;
grant execute on function forge_planner_internal.forge_test_control_estimate_is_test(text, text) to authenticated, service_role;
grant execute on function forge_planner_internal.forge_test_craft_assignment_is_test(text, text) to authenticated, service_role;
grant execute on function forge_planner_internal.forge_test_craft_rate_is_test(text, text) to authenticated, service_role;
grant execute on function forge_planner_internal.forge_test_progress_entry_is_test(text, text) to authenticated, service_role;
grant execute on function forge_planner_internal.forge_test_permit_annotation_is_test(text, text) to authenticated, service_role;
grant execute on function forge_planner_internal.forge_test_placement_is_test(text, text) to authenticated, service_role;
grant execute on function forge_planner_internal.forge_test_step_link_is_test(text, text) to authenticated, service_role;
grant execute on function forge_planner_internal.forge_test_bust_is_test(text, text) to authenticated, service_role;
grant execute on function forge_planner_internal.forge_test_work_link_is_test(text, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function forge_planner_internal.forge_test_work_link_confirmation_is_test(text, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. RLS policy replacements. Each policy below is the exact effective
--    policy from production (base predicate preserved verbatim) AND the
--    test predicate: (not <test-resolver> or auth.uid()::text = owner_id).
--    A non-owner therefore reads/writes exactly what they read/wrote
--    before, minus test rows; the owner sees everything. Direct INSERTs
--    can never create test rows (the WITH CHECK fails for test-rooted
--    keys, and the hierarchy tables have no insert policy at all:
--    the RPCs are the only write path). forge_work_document_library is
--    deliberately untouched: a workspace-level library with no package
--    reference, so no row can be test-rooted.
-- ---------------------------------------------------------------------------

drop policy if exists forge_clients_owner_select on public.forge_clients;
create policy forge_clients_owner_select on public.forge_clients for select to authenticated
  using ((public.has_workspace_access(owner_id) AND (not is_test or auth.uid()::text = owner_id)));

drop policy if exists forge_hierarchy_audit_owner_select on public.forge_hierarchy_audit;
create policy forge_hierarchy_audit_owner_select on public.forge_hierarchy_audit for select to authenticated
  using ((public.has_workspace_access(owner_id) AND (not is_test or auth.uid()::text = owner_id)));

drop policy if exists forge_projects_owner_select on public.forge_projects;
create policy forge_projects_owner_select on public.forge_projects for select to authenticated
  using ((public.has_workspace_access(owner_id) AND (not forge_planner_internal.forge_test_project_is_test(owner_id, id) or auth.uid()::text = owner_id)));

drop policy if exists forge_sites_owner_select on public.forge_sites;
create policy forge_sites_owner_select on public.forge_sites for select to authenticated
  using ((public.has_workspace_access(owner_id) AND (not forge_planner_internal.forge_test_client_is_test(owner_id, client_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_change_order_revisions_select on public.forge_work_change_order_revisions;
create policy forge_work_change_order_revisions_select on public.forge_work_change_order_revisions for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_change_order_is_test(owner_id, change_order_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_change_orders_select on public.forge_work_change_orders;
create policy forge_work_change_orders_select on public.forge_work_change_orders for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, work_package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_control_estimate_revisions_select on public.forge_work_control_estimate_revisions;
create policy forge_work_control_estimate_revisions_select on public.forge_work_control_estimate_revisions for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_control_estimate_is_test(owner_id, estimate_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_control_estimates_select on public.forge_work_control_estimates;
create policy forge_work_control_estimates_select on public.forge_work_control_estimates for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, work_package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_craft_assignment_revisions_workspace_select on public.forge_work_craft_assignment_revisions;
create policy forge_work_craft_assignment_revisions_workspace_select on public.forge_work_craft_assignment_revisions for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_craft_assignment_is_test(owner_id, assignment_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_craft_assignments_workspace_select on public.forge_work_craft_assignments;
create policy forge_work_craft_assignments_workspace_select on public.forge_work_craft_assignments for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, work_package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_craft_rate_revisions_select on public.forge_work_craft_rate_revisions;
create policy forge_work_craft_rate_revisions_select on public.forge_work_craft_rate_revisions for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_craft_rate_is_test(owner_id, craft_rate_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_craft_rates_select on public.forge_work_craft_rates;
create policy forge_work_craft_rates_select on public.forge_work_craft_rates for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, work_package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_drawings_workspace_delete on public.forge_work_drawings;
create policy forge_work_drawings_workspace_delete on public.forge_work_drawings for delete to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_drawings_workspace_insert on public.forge_work_drawings;
create policy forge_work_drawings_workspace_insert on public.forge_work_drawings for insert to authenticated
  with check ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_drawings_workspace_select on public.forge_work_drawings;
create policy forge_work_drawings_workspace_select on public.forge_work_drawings for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_gate_attestations_workspace_insert on public.forge_work_gate_attestations;
create policy forge_work_gate_attestations_workspace_insert on public.forge_work_gate_attestations for insert to authenticated
  with check ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_gate_attestations_workspace_select on public.forge_work_gate_attestations;
create policy forge_work_gate_attestations_workspace_select on public.forge_work_gate_attestations for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_gate_evaluations_workspace_insert on public.forge_work_gate_evaluations;
create policy forge_work_gate_evaluations_workspace_insert on public.forge_work_gate_evaluations for insert to authenticated
  with check ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_gate_evaluations_workspace_select on public.forge_work_gate_evaluations;
create policy forge_work_gate_evaluations_workspace_select on public.forge_work_gate_evaluations for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_gate_overrides_workspace_insert on public.forge_work_gate_overrides;
create policy forge_work_gate_overrides_workspace_insert on public.forge_work_gate_overrides for insert to authenticated
  with check ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_gate_overrides_workspace_select on public.forge_work_gate_overrides;
create policy forge_work_gate_overrides_workspace_select on public.forge_work_gate_overrides for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_inspection_observations_workspace_select on public.forge_work_inspection_observations;
create policy forge_work_inspection_observations_workspace_select on public.forge_work_inspection_observations for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_inspection_observations_workspace_write on public.forge_work_inspection_observations;
create policy forge_work_inspection_observations_workspace_write on public.forge_work_inspection_observations for all to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)))
  with check ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_link_confirmations_workspace_all on public.forge_work_link_confirmations;
create policy forge_work_link_confirmations_workspace_all on public.forge_work_link_confirmations for all to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_work_link_confirmation_is_test(owner_id, link_id) or auth.uid()::text = owner_id)))
  with check ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_work_link_confirmation_is_test(owner_id, link_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_links_workspace_all on public.forge_work_links;
create policy forge_work_links_workspace_all on public.forge_work_links for all to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_work_link_is_test(owner_id, source_domain, source_type, source_id, target_domain, target_type, target_id) or auth.uid()::text = owner_id)))
  with check ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_work_link_is_test(owner_id, source_domain, source_type, source_id, target_domain, target_type, target_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_manpower_days_owner on public.forge_work_manpower_days;
create policy forge_work_manpower_days_owner on public.forge_work_manpower_days for all to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)))
  with check ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_package_baselines_owner on public.forge_work_package_baselines;
create policy forge_work_package_baselines_owner on public.forge_work_package_baselines for all to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)))
  with check ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_package_budget_revisions_workspace_select on public.forge_work_package_budget_revisions;
create policy forge_work_package_budget_revisions_workspace_select on public.forge_work_package_budget_revisions for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_package_bust_change_orders_select on public.forge_work_package_bust_change_orders;
create policy forge_work_package_bust_change_orders_select on public.forge_work_package_bust_change_orders for select to authenticated
  using ((public.has_workspace_access(owner_id) AND (not forge_planner_internal.forge_test_bust_is_test(owner_id, bust_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_package_bust_revisions_select on public.forge_work_package_bust_revisions;
create policy forge_work_package_bust_revisions_select on public.forge_work_package_bust_revisions for select to authenticated
  using ((public.has_workspace_access(owner_id) AND (not forge_planner_internal.forge_test_bust_is_test(owner_id, bust_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_package_busts_select on public.forge_work_package_busts;
create policy forge_work_package_busts_select on public.forge_work_package_busts for select to authenticated
  using ((public.has_workspace_access(owner_id) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, work_package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_package_deletions_workspace_select on public.forge_work_package_deletions;
create policy forge_work_package_deletions_workspace_select on public.forge_work_package_deletions for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_package_links_owner_select on public.forge_work_package_links;
create policy forge_work_package_links_owner_select on public.forge_work_package_links for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not is_test or auth.uid()::text = owner_id)));

drop policy if exists forge_work_package_transitions_workspace_select on public.forge_work_package_transitions;
create policy forge_work_package_transitions_workspace_select on public.forge_work_package_transitions for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_packages_workspace_insert on public.forge_work_packages;
create policy forge_work_packages_workspace_insert on public.forge_work_packages for insert to authenticated
  with check ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_project_is_test(owner_id, forge_project_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_packages_workspace_select on public.forge_work_packages;
create policy forge_work_packages_workspace_select on public.forge_work_packages for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_project_is_test(owner_id, forge_project_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_packages_workspace_update on public.forge_work_packages;
create policy forge_work_packages_workspace_update on public.forge_work_packages for update to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_project_is_test(owner_id, forge_project_id) or auth.uid()::text = owner_id)))
  with check ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_project_is_test(owner_id, forge_project_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_permit_annotation_revisions_workspace_select on public.forge_work_permit_annotation_revisions;
create policy forge_work_permit_annotation_revisions_workspace_select on public.forge_work_permit_annotation_revisions for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_permit_annotation_is_test(owner_id, annotation_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_permit_annotations_workspace_select on public.forge_work_permit_annotations;
create policy forge_work_permit_annotations_workspace_select on public.forge_work_permit_annotations for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, work_package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_planning_process_instances_select on public.forge_work_planning_process_instances;
create policy forge_work_planning_process_instances_select on public.forge_work_planning_process_instances for select to authenticated
  using (((public.has_workspace_access(owner_id) OR public.has_planner_permission(owner_id, 'planner.planning_steps.read'::text)) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, work_package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_planning_process_revisions_select on public.forge_work_planning_process_revisions;
create policy forge_work_planning_process_revisions_select on public.forge_work_planning_process_revisions for select to authenticated
  using (((public.has_workspace_access(owner_id) OR public.has_planner_permission(owner_id, 'planner.planning_steps.read'::text)) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, work_package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_progress_entries_workspace_insert on public.forge_work_progress_entries;
create policy forge_work_progress_entries_workspace_insert on public.forge_work_progress_entries for insert to authenticated
  with check ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, work_package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_progress_entries_workspace_select on public.forge_work_progress_entries;
create policy forge_work_progress_entries_workspace_select on public.forge_work_progress_entries for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, work_package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_progress_entries_workspace_update on public.forge_work_progress_entries;
create policy forge_work_progress_entries_workspace_update on public.forge_work_progress_entries for update to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, work_package_id) or auth.uid()::text = owner_id)))
  with check ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, work_package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_progress_revisions_workspace_select on public.forge_work_progress_revisions;
create policy forge_work_progress_revisions_workspace_select on public.forge_work_progress_revisions for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_progress_entry_is_test(owner_id, entry_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_progress_snapshots_owner on public.forge_work_progress_snapshots;
create policy forge_work_progress_snapshots_owner on public.forge_work_progress_snapshots for all to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)))
  with check ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_scope_baselines_workspace_select on public.forge_work_scope_baselines;
create policy forge_work_scope_baselines_workspace_select on public.forge_work_scope_baselines for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_scope_changes_workspace_insert on public.forge_work_scope_changes;
create policy forge_work_scope_changes_workspace_insert on public.forge_work_scope_changes for insert to authenticated
  with check ((public.has_workspace_access(owner_id) AND (status = 'proposed'::text) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_scope_changes_workspace_select on public.forge_work_scope_changes;
create policy forge_work_scope_changes_workspace_select on public.forge_work_scope_changes for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_step_curve_placement_revisions_select on public.forge_work_step_curve_placement_revisions;
create policy forge_work_step_curve_placement_revisions_select on public.forge_work_step_curve_placement_revisions for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_placement_is_test(owner_id, placement_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_step_curve_placements_select on public.forge_work_step_curve_placements;
create policy forge_work_step_curve_placements_select on public.forge_work_step_curve_placements for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, work_package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_step_drawing_link_revisions_workspace_select on public.forge_work_step_drawing_link_revisions;
create policy forge_work_step_drawing_link_revisions_workspace_select on public.forge_work_step_drawing_link_revisions for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_step_link_is_test(owner_id, link_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_step_drawing_links_workspace_select on public.forge_work_step_drawing_links;
create policy forge_work_step_drawing_links_workspace_select on public.forge_work_step_drawing_links for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, work_package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_step_order_workspace_select on public.forge_work_step_order;
create policy forge_work_step_order_workspace_select on public.forge_work_step_order for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, work_package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_step_revisions_workspace_select on public.forge_work_step_revisions;
create policy forge_work_step_revisions_workspace_select on public.forge_work_step_revisions for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_step_is_test(owner_id, step_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_steps_workspace_select on public.forge_work_steps;
create policy forge_work_steps_workspace_select on public.forge_work_steps for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, work_package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_takeoff_lines_workspace_delete on public.forge_work_takeoff_lines;
create policy forge_work_takeoff_lines_workspace_delete on public.forge_work_takeoff_lines for delete to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_drawing_is_test(owner_id, drawing_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_takeoff_lines_workspace_insert on public.forge_work_takeoff_lines;
create policy forge_work_takeoff_lines_workspace_insert on public.forge_work_takeoff_lines for insert to authenticated
  with check ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_drawing_is_test(owner_id, drawing_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_takeoff_lines_workspace_select on public.forge_work_takeoff_lines;
create policy forge_work_takeoff_lines_workspace_select on public.forge_work_takeoff_lines for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_drawing_is_test(owner_id, drawing_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_takeoff_lines_workspace_update on public.forge_work_takeoff_lines;
create policy forge_work_takeoff_lines_workspace_update on public.forge_work_takeoff_lines for update to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_drawing_is_test(owner_id, drawing_id) or auth.uid()::text = owner_id)))
  with check ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_drawing_is_test(owner_id, drawing_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_work_weekly_commitments_owner on public.forge_work_weekly_commitments;
create policy forge_work_weekly_commitments_owner on public.forge_work_weekly_commitments for all to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)))
  with check ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_wp_drawing_artifacts_select on public.forge_wp_drawing_artifacts;
create policy forge_wp_drawing_artifacts_select on public.forge_wp_drawing_artifacts for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_wp_drawing_field_redlines_select on public.forge_wp_drawing_field_redlines;
create policy forge_wp_drawing_field_redlines_select on public.forge_wp_drawing_field_redlines for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_wp_drawing_ifc_releases_select on public.forge_wp_drawing_ifc_releases;
create policy forge_wp_drawing_ifc_releases_select on public.forge_wp_drawing_ifc_releases for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_wp_drawing_redlines_select on public.forge_wp_drawing_redlines;
create policy forge_wp_drawing_redlines_select on public.forge_wp_drawing_redlines for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_wp_drawing_review_events_select on public.forge_wp_drawing_review_events;
create policy forge_wp_drawing_review_events_select on public.forge_wp_drawing_review_events for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_wp_drawing_reviews_select on public.forge_wp_drawing_reviews;
create policy forge_wp_drawing_reviews_select on public.forge_wp_drawing_reviews for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));

drop policy if exists forge_wp_drawing_revisions_select on public.forge_wp_drawing_revisions;
create policy forge_wp_drawing_revisions_select on public.forge_wp_drawing_revisions for select to authenticated
  using ((public.has_workspace_access(owner_id) AND public.forge_has_app_entitlement(owner_id, 'planner'::text) AND (not forge_planner_internal.forge_test_package_is_test(owner_id, package_id) or auth.uid()::text = owner_id)));


-- ---------------------------------------------------------------------------
-- 4. Row-level trigger guard for SECURITY DEFINER mutation RPCs.
--
-- The ~60 work-package mutation RPCs (step/drawing/change-order/bust/
-- progress/permit/craft/planning-process creates, updates, transitions)
-- run as SECURITY DEFINER and bypass RLS, so a policy predicate alone
-- cannot stop a co-owner from mutating a test package through one of
-- them. Instead of patching all ~60 function bodies, one BEFORE
-- INSERT/UPDATE/DELETE trigger per directly-mutated table enforces the
-- same rule at the row: a non-owner write to a test-rooted row raises
-- FORGE_PLANNER_TEST_NOT_FOUND; the workspace owner and JWT-less
-- service-role/background paths pass through.
-- TG_ARGV[0] names the table's key shape (see the trigger list below).
-- The guard short-circuits on actor = owner before resolving
-- test-ness, so ordinary owner writes pay no extra lookup.
-- ---------------------------------------------------------------------------

create or replace function public.forge_test_guard_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_owner text;
  v_is_test boolean;
  v_key text;
  v_row record;
begin
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    return coalesce(NEW, OLD);
  end if;
  if TG_OP = 'DELETE' then
    v_owner := OLD.owner_id;
  else
    v_owner := NEW.owner_id;
  end if;
  if v_actor = v_owner then
    return coalesce(NEW, OLD);
  end if;
  v_key := TG_ARGV[0];
  if TG_OP = 'DELETE' then
    v_row := OLD;
  else
    v_row := NEW;
  end if;
  if v_key = 'package' then
    -- forge_work_packages itself: the row IS the package. Check the
    -- package's own test-ness and both the old and the new project
    -- link (a reparent across the boundary must fail either way).
    if TG_OP = 'INSERT' then
      v_is_test := forge_planner_internal.forge_test_project_is_test(NEW.owner_id, NEW.forge_project_id);
    else
      v_is_test := forge_planner_internal.forge_test_package_is_test(OLD.owner_id, OLD.id)
        or forge_planner_internal.forge_test_project_is_test(OLD.owner_id, OLD.forge_project_id)
        or (TG_OP = 'UPDATE' and forge_planner_internal.forge_test_project_is_test(NEW.owner_id, NEW.forge_project_id));
    end if;
  elsif v_key = 'work_package_id' then
    v_is_test := forge_planner_internal.forge_test_package_is_test(v_row.owner_id, v_row.work_package_id);
  elsif v_key = 'package_id' then
    v_is_test := forge_planner_internal.forge_test_package_is_test(v_row.owner_id, v_row.package_id);
  elsif v_key = 'drawing_id' then
    v_is_test := forge_planner_internal.forge_test_drawing_is_test(v_row.owner_id, v_row.drawing_id);
  elsif v_key = 'step_id' then
    v_is_test := forge_planner_internal.forge_test_step_is_test(v_row.owner_id, v_row.step_id);
  elsif v_key = 'change_order_id' then
    v_is_test := forge_planner_internal.forge_test_change_order_is_test(v_row.owner_id, v_row.change_order_id);
  elsif v_key = 'control_estimate_id' then
    v_is_test := forge_planner_internal.forge_test_control_estimate_is_test(v_row.owner_id, v_row.estimate_id);
  elsif v_key = 'craft_assignment_id' then
    v_is_test := forge_planner_internal.forge_test_craft_assignment_is_test(v_row.owner_id, v_row.assignment_id);
  elsif v_key = 'craft_rate_id' then
    v_is_test := forge_planner_internal.forge_test_craft_rate_is_test(v_row.owner_id, v_row.craft_rate_id);
  elsif v_key = 'progress_entry_id' then
    v_is_test := forge_planner_internal.forge_test_progress_entry_is_test(v_row.owner_id, v_row.entry_id);
  elsif v_key = 'permit_annotation_id' then
    v_is_test := forge_planner_internal.forge_test_permit_annotation_is_test(v_row.owner_id, v_row.annotation_id);
  elsif v_key = 'placement_id' then
    v_is_test := forge_planner_internal.forge_test_placement_is_test(v_row.owner_id, v_row.placement_id);
  elsif v_key = 'step_link_id' then
    v_is_test := forge_planner_internal.forge_test_step_link_is_test(v_row.owner_id, v_row.link_id);
  elsif v_key = 'bust_id' then
    v_is_test := forge_planner_internal.forge_test_bust_is_test(v_row.owner_id, v_row.bust_id);
  else
    raise exception 'FORGE_PLANNER_TEST_GUARD_KEY_UNKNOWN: %', v_key;
  end if;
  if coalesce(v_is_test, true) then
    raise exception 'FORGE_PLANNER_TEST_NOT_FOUND';
  end if;
  return coalesce(NEW, OLD);
end;
$$;

revoke all on function public.forge_test_guard_mutation() from public;

drop trigger if exists forge_test_guard_mutation on public.forge_work_packages;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_packages
  for each row execute function public.forge_test_guard_mutation('package');

drop trigger if exists forge_test_guard_mutation on public.forge_work_steps;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_steps
  for each row execute function public.forge_test_guard_mutation('work_package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_change_orders;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_change_orders
  for each row execute function public.forge_test_guard_mutation('work_package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_control_estimates;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_control_estimates
  for each row execute function public.forge_test_guard_mutation('work_package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_craft_assignments;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_craft_assignments
  for each row execute function public.forge_test_guard_mutation('work_package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_craft_rates;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_craft_rates
  for each row execute function public.forge_test_guard_mutation('work_package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_progress_entries;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_progress_entries
  for each row execute function public.forge_test_guard_mutation('work_package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_permit_annotations;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_permit_annotations
  for each row execute function public.forge_test_guard_mutation('work_package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_planning_process_instances;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_planning_process_instances
  for each row execute function public.forge_test_guard_mutation('work_package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_planning_process_revisions;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_planning_process_revisions
  for each row execute function public.forge_test_guard_mutation('work_package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_step_curve_placements;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_step_curve_placements
  for each row execute function public.forge_test_guard_mutation('work_package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_step_drawing_links;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_step_drawing_links
  for each row execute function public.forge_test_guard_mutation('work_package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_step_order;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_step_order
  for each row execute function public.forge_test_guard_mutation('work_package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_package_busts;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_package_busts
  for each row execute function public.forge_test_guard_mutation('work_package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_drawings;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_drawings
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_gate_attestations;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_gate_attestations
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_gate_evaluations;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_gate_evaluations
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_gate_overrides;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_gate_overrides
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_inspection_observations;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_inspection_observations
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_manpower_days;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_manpower_days
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_package_baselines;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_package_baselines
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_package_budget_revisions;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_package_budget_revisions
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_package_transitions;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_package_transitions
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_progress_snapshots;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_progress_snapshots
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_scope_baselines;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_scope_baselines
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_scope_changes;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_scope_changes
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_weekly_commitments;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_weekly_commitments
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_package_deletions;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_package_deletions
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_wp_drawing_redlines;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_wp_drawing_redlines
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_wp_drawing_revisions;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_wp_drawing_revisions
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_wp_drawing_reviews;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_wp_drawing_reviews
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_wp_drawing_review_events;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_wp_drawing_review_events
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_wp_drawing_ifc_releases;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_wp_drawing_ifc_releases
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_wp_drawing_field_redlines;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_wp_drawing_field_redlines
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_wp_drawing_artifacts;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_wp_drawing_artifacts
  for each row execute function public.forge_test_guard_mutation('package_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_takeoff_lines;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_takeoff_lines
  for each row execute function public.forge_test_guard_mutation('drawing_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_step_revisions;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_step_revisions
  for each row execute function public.forge_test_guard_mutation('step_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_change_order_revisions;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_change_order_revisions
  for each row execute function public.forge_test_guard_mutation('change_order_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_control_estimate_revisions;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_control_estimate_revisions
  for each row execute function public.forge_test_guard_mutation('control_estimate_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_craft_assignment_revisions;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_craft_assignment_revisions
  for each row execute function public.forge_test_guard_mutation('craft_assignment_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_craft_rate_revisions;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_craft_rate_revisions
  for each row execute function public.forge_test_guard_mutation('craft_rate_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_progress_revisions;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_progress_revisions
  for each row execute function public.forge_test_guard_mutation('progress_entry_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_permit_annotation_revisions;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_permit_annotation_revisions
  for each row execute function public.forge_test_guard_mutation('permit_annotation_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_step_curve_placement_revisions;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_step_curve_placement_revisions
  for each row execute function public.forge_test_guard_mutation('placement_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_step_drawing_link_revisions;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_step_drawing_link_revisions
  for each row execute function public.forge_test_guard_mutation('step_link_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_package_bust_revisions;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_package_bust_revisions
  for each row execute function public.forge_test_guard_mutation('bust_id');

drop trigger if exists forge_test_guard_mutation on public.forge_work_package_bust_change_orders;
create trigger forge_test_guard_mutation
  before insert or update or delete on public.forge_work_package_bust_change_orders
  for each row execute function public.forge_test_guard_mutation('bust_id');

-- ---------------------------------------------------------------------------
-- 5. Hierarchy / link RPC patches (full-body replacements; each body is
--    the shipped function with the test-visibility additions only).
-- ---------------------------------------------------------------------------

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
          'is_test', c.is_test,
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
          and (not c.is_test or auth.uid()::text = p_owner_id)
      ) clients
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.forge_hierarchy_selector(text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_selector(text) to authenticated;

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
  -- A test client (and everything under it) reads exactly like a
  -- nonexistent project to anyone but the platform owner.
  if v_client.is_test and auth.uid()::text <> p_owner_id then
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
    'canUseOwnerTestData', auth.uid()::text = p_owner_id,
    'clients', coalesce((
      select jsonb_agg(client_json order by client_json ->> 'name_normalized')
      from (
        select jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'name_normalized', c.name_normalized,
          'external_reference', c.external_reference,
          'status', c.status,
          'is_test', c.is_test,
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
        where c.owner_id = p_owner_id and (not c.is_test or auth.uid()::text = p_owner_id)
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
    -- A replay must re-check visibility before returning the cached
    -- receipt: a test client created through the test-create RPC must
    -- never replay out of the regular create path to a non-owner.
    if v_row.is_test and v_actor <> p_owner_id then
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

create or replace function public.forge_hierarchy_client_create_test(
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
  -- Owner-only: the platform owner is the authenticated immutable
  -- identity (auth.uid() = the workspace owner id). A co-owner passes
  -- the manage capability above and still stops here.
  if v_actor <> p_owner_id then
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
  insert into public.forge_clients (owner_id, id, name, external_reference, status, notes, is_test, created_by, updated_by)
    values (p_owner_id, v_id, v_name, v_ext, 'active', v_notes, true, v_actor, v_actor)
    returning * into v_row;
  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id, is_test)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'client', v_id, 'create', null,
            jsonb_build_object('changed', v_change, 'row', row_to_json(v_row)::jsonb), p_request_id, true);
  return row_to_json(v_row)::jsonb;
end;
$$;

revoke all on function public.forge_hierarchy_client_create_test(text, text, text, text, text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_client_create_test(text, text, text, text, text) to authenticated;

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
    -- Replay re-checks visibility before returning the cached receipt.
    select * into v_parent from public.forge_clients
    where owner_id = p_owner_id and id = v_row.client_id;
    if v_parent.is_test and v_actor <> p_owner_id then
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
  -- A site under a test client is invisible to non-owners (checked
  -- before the status checks so the error never reveals the parent).
  if v_parent.is_test and v_actor <> p_owner_id then
    raise exception 'FORGE_HIERARCHY_NOT_FOUND';
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
  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id, is_test)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'site', v_id, 'create', null,
            jsonb_build_object('changed', v_change, 'row', row_to_json(v_row)::jsonb), p_request_id, v_parent.is_test);
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
    -- Replay re-checks visibility before returning the cached receipt.
    select * into v_site from public.forge_sites
    where owner_id = p_owner_id and id = v_row.site_id;
    select * into v_client from public.forge_clients
    where owner_id = p_owner_id and id = v_site.client_id;
    if v_client.is_test and v_actor <> p_owner_id then
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
  -- A project under a test client is invisible to non-owners (checked
  -- before the status checks so the error never reveals the parent).
  if v_client.is_test and v_actor <> p_owner_id then
    raise exception 'FORGE_HIERARCHY_NOT_FOUND';
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
  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id, is_test)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'project', v_id, 'create', null,
            jsonb_build_object('changed', v_change, 'row', row_to_json(v_row)::jsonb), p_request_id, v_client.is_test);
  return row_to_json(v_row)::jsonb;
end;
$$;

revoke all on function public.forge_hierarchy_project_create(text, text, text, text, text, text, text, text, text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_project_create(text, text, text, text, text, text, text, text, text) to authenticated;

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
  -- A test client is invisible to non-owners: no read, no write.
  if v_old.is_test and v_actor <> p_owner_id then
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
    -- Replay re-checks visibility before returning the cached receipt.
    if v_new.is_test and v_actor <> p_owner_id then
      raise exception 'FORGE_HIERARCHY_NOT_FOUND';
    end if;
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

  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id, is_test)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'client', p_client_id, v_action,
            row_to_json(v_old)::jsonb,
            jsonb_build_object('changed', v_change, 'row', row_to_json(v_new)::jsonb), p_request_id, v_old.is_test);
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
  -- A site under a test client is invisible to non-owners.
  select * into v_parent from public.forge_clients
  where owner_id = p_owner_id and id = v_old.client_id;
  if v_parent.is_test and v_actor <> p_owner_id then
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
    -- Replay re-checks visibility before returning the cached receipt.
    select * into v_parent from public.forge_clients
    where owner_id = p_owner_id and id = v_new.client_id;
    if v_parent.is_test and v_actor <> p_owner_id then
      raise exception 'FORGE_HIERARCHY_NOT_FOUND';
    end if;
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
    -- A move into a test client is invisible to non-owners; a move
    -- across the test/real boundary is forbidden even for the owner.
    if v_parent.is_test and v_actor <> p_owner_id then
      raise exception 'FORGE_HIERARCHY_NOT_FOUND';
    end if;
    if v_parent.is_test is distinct from (
      select c.is_test from public.forge_clients c
      where c.owner_id = p_owner_id and c.id = v_old.client_id
    ) then
      raise exception 'FORGE_HIERARCHY_FORBIDDEN';
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

  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id, is_test)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'site', p_site_id, v_action,
            row_to_json(v_old)::jsonb,
            jsonb_build_object('changed', v_change, 'row', row_to_json(v_new)::jsonb,
                               'movedProjectCount', case when v_action = 'reparent' then v_moved else null end),
            p_request_id,
            -- v_client_id is set only on a reparent; otherwise the
            -- site's current parent decides the audit flag.
            (select c.is_test from public.forge_clients c where c.owner_id = p_owner_id and c.id = coalesce(v_client_id, v_old.client_id)));
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
  -- A project under a test client is invisible to non-owners.
  select * into v_site from public.forge_sites
  where owner_id = p_owner_id and id = v_old.site_id;
  select * into v_client from public.forge_clients
  where owner_id = p_owner_id and id = v_site.client_id;
  if v_client.is_test and v_actor <> p_owner_id then
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
    -- Replay re-checks visibility before returning the cached receipt.
    select * into v_site from public.forge_sites
    where owner_id = p_owner_id and id = v_new.site_id;
    select * into v_client from public.forge_clients
    where owner_id = p_owner_id and id = v_site.client_id;
    if v_client.is_test and v_actor <> p_owner_id then
      raise exception 'FORGE_HIERARCHY_NOT_FOUND';
    end if;
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
    -- A move into a test client is invisible to non-owners; a move
    -- across the test/real boundary is forbidden even for the owner.
    if v_client.is_test and v_actor <> p_owner_id then
      raise exception 'FORGE_HIERARCHY_NOT_FOUND';
    end if;
    if v_client.is_test is distinct from (
      select c.is_test from public.forge_clients c
      join public.forge_sites s on s.owner_id = c.owner_id and s.client_id = c.id
      where s.owner_id = p_owner_id and s.id = v_old.site_id
    ) then
      raise exception 'FORGE_HIERARCHY_FORBIDDEN';
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

  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id, is_test)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'project', p_project_id, v_action,
            row_to_json(v_old)::jsonb,
            jsonb_build_object('changed', v_change, 'row', row_to_json(v_new)::jsonb), p_request_id,
            -- v_site_id is set only on a reparent; otherwise the
            -- project's current site decides the audit flag.
            (select c.is_test from public.forge_clients c
             join public.forge_sites s on s.owner_id = c.owner_id and s.client_id = c.id
             where s.owner_id = p_owner_id and s.id = coalesce(v_site_id, v_old.site_id)));
  return row_to_json(v_new)::jsonb;
end;
$$;

revoke all on function public.forge_hierarchy_project_update(text, text, text, text, text, text, text, text, text, text, integer, text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_project_update(text, text, text, text, text, text, text, text, text, text, integer, text) to authenticated;

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
  -- A test client is invisible to non-owners: no read, no delete.
  if v_row.is_test and v_actor <> p_owner_id then
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
  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id, is_test)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'client', p_client_id, 'delete',
            row_to_json(v_row)::jsonb, null, p_request_id, v_row.is_test);
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
  -- A site under a test client is invisible to non-owners.
  if exists (select 1 from public.forge_clients
             where owner_id = p_owner_id and id = v_row.client_id and is_test)
     and v_actor <> p_owner_id then
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
  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id, is_test)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'site', p_site_id, 'delete',
            row_to_json(v_row)::jsonb, null, p_request_id,
            exists (select 1 from public.forge_clients where owner_id = p_owner_id and id = v_row.client_id and is_test));
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
  -- A project under a test client is invisible to non-owners.
  if exists (
    select 1 from public.forge_clients c
    join public.forge_sites s on s.owner_id = c.owner_id and s.client_id = c.id
    where s.owner_id = p_owner_id and s.id = v_row.site_id and c.is_test
  ) and v_actor <> p_owner_id then
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
  insert into public.forge_hierarchy_audit (owner_id, id, actor_id, entity_type, entity_id, action, old_values, new_values, request_id, is_test)
    values (p_owner_id, 'forge_ha_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'project', p_project_id, 'delete',
            row_to_json(v_row)::jsonb, null, p_request_id,
            exists (
              select 1 from public.forge_clients c
              join public.forge_sites s on s.owner_id = c.owner_id and s.client_id = c.id
              where s.owner_id = p_owner_id and s.id = v_row.site_id and c.is_test));
  return jsonb_build_object('deleted', true, 'id', p_project_id);
end;
$$;

revoke all on function public.forge_hierarchy_project_delete(text, text, integer, text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_project_delete(text, text, integer, text) to authenticated;

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
  v_link_is_test boolean;
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
    -- Replay re-checks visibility before returning the cached receipt.
    if forge_planner_internal.forge_test_package_is_test(v_pkg.owner_id, v_pkg.id) and v_actor <> p_owner_id then
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
  -- A test package is invisible to non-owners.
  if forge_planner_internal.forge_test_package_is_test(v_pkg.owner_id, v_pkg.id) and v_actor <> p_owner_id then
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
    -- A test project is invisible to non-owners.
    if v_client.is_test and v_actor <> p_owner_id then
      raise exception 'FORGE_PRB_PROJECT_NOT_FOUND';
    end if;
    -- Boundary, enforced for everyone including the owner: a test
    -- package never moves to a real project; test packages never move
    -- between test clients. (A real package moving to a test project
    -- is allowed for the owner only — it becomes a purge blocker —
    -- and is already gated above: a non-owner never sees the target.)
    if forge_planner_internal.forge_test_package_is_test(v_pkg.owner_id, v_pkg.id) then
      if not v_client.is_test then
        raise exception 'FORGE_PRB_TEST_BOUNDARY';
      end if;
      if v_pkg.forge_project_id is not null and exists (
        select 1 from public.forge_projects p2
        join public.forge_sites s2 on s2.owner_id = p2.owner_id and s2.id = p2.site_id
        where p2.owner_id = p_owner_id and p2.id = v_pkg.forge_project_id
          and s2.client_id <> v_client.id
      ) then
        raise exception 'FORGE_PRB_TEST_CLIENT_MISMATCH';
      end if;
    end if;
  end if;

  -- The link row is test-rooted when the package, the old target,
  -- or the new target is test: once a link touches a test project it
  -- stays test forever, even after an unlink back to real.
  v_link_is_test := forge_planner_internal.forge_test_package_is_test(v_pkg.owner_id, v_pkg.id)
    or (v_pkg.forge_project_id is not null and forge_planner_internal.forge_test_project_is_test(p_owner_id, v_pkg.forge_project_id))
    or (v_target is not null and v_client.is_test);

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
    (owner_id, id, package_id, old_forge_project_id, new_forge_project_id, actor_id, request_id, reason, is_test)
    values (
      p_owner_id,
      'forge_wpl_' || replace(gen_random_uuid()::text, '-', ''),
      p_package_id,
      v_old_target,
      v_target,
      v_actor,
      p_request_id,
      v_reason,
      v_link_is_test
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

create or replace function public.forge_work_planning_process_checklist(
  p_owner_id text,
  p_package_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_complexity text;
  v_template_version integer;
  v_can_update boolean;
  v_can_review boolean;
  v_is_owner boolean;
  v_count integer;
  v_keys integer;
  v_credit numeric;
  v_hours numeric;
  v_instances integer;
begin
  if not (public.has_workspace_access(p_owner_id)
          or public.has_planner_permission(p_owner_id, 'planner.planning_steps.read')) then
    raise exception 'WPP10_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP10_INVALID_ACTOR';
  end if;

  select planning_complexity, planning_template_version
    into v_complexity, v_template_version
    from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id;
  if v_complexity is null then
    raise exception 'WPP10_PACKAGE_NOT_FOUND';
  end if;
  -- A test package's checklist is invisible to non-owners: the
  -- package row, its 22 instance rows, and its template binding all
  -- name test data.
  if forge_planner_internal.forge_test_package_is_test(p_owner_id, p_package_id) and v_actor <> p_owner_id then
    raise exception 'WPP10_PACKAGE_NOT_FOUND';
  end if;

  -- F3: verify the bound template BEFORE instantiating. A template
  -- that cannot reach 100% (or has a missing/duplicated row) must fail
  -- closed, never mint a checklist that reports a misleading percent.
  select count(*), count(distinct step_key),
         coalesce(sum(credit_pct), 0), coalesce(sum(mhrs_standard), 0)
    into v_count, v_keys, v_credit, v_hours
    from public.forge_work_planning_process_template
    where version = v_template_version;
  if v_count <> 22 or v_keys <> 22 or v_credit <> 100 or v_hours <> 40 then
    raise exception 'WPP10_TEMPLATE_INVALID: template version % has % rows (% distinct keys), credits %, hours %',
      v_template_version, v_count, v_keys, v_credit, v_hours;
  end if;

  v_can_update := public.has_planner_permission(p_owner_id, 'planner.planning_steps.update');
  v_can_review := public.has_planner_permission(p_owner_id, 'planner.planning_steps.review');
  v_is_owner := public.has_workspace_access(p_owner_id);

  -- F1 (fix round 1): READ-ONLY. The 22 instance rows are created
  -- atomically with the package row (trigger, section 9) or by the
  -- idempotent backfill (section 10). A GET never mutates: a
  -- missing/duplicated set is unavailable, never auto-created.
  select count(*), count(distinct template_step_id) into v_instances, v_keys
    from public.forge_work_planning_process_instances
    where owner_id = p_owner_id and work_package_id = p_package_id;
  if v_instances <> 22 or v_keys <> 22 then
    raise exception 'WPP10_CHECKLIST_INCOMPLETE: package % has % planning instances (% distinct step keys), expected 22', p_package_id, v_instances, v_keys;
  end if;

  return jsonb_build_object(
    'packageId', p_package_id,
    'complexity', v_complexity,
    'templateVersion', v_template_version,
    'canUpdate', v_can_update,
    'canReview', v_can_review,
    'isOwner', v_is_owner,
    'constructionReadiness', jsonb_build_object(
      'status', 'not_established',
      'detail', 'No package-level release decision exists yet. Planning percent never authorizes construction or releases an IFC drawing.'
    ),
    'template', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.sort_order), '[]'::jsonb)
      from (select version, step_key, step_number, sort_order, name, role, credit_pct, mhrs_standard, description, provenance
              from public.forge_work_planning_process_template
              where version = v_template_version) t
    ),
    'instances', (
      select coalesce(jsonb_agg(row_to_json(i) order by i.template_step_id), '[]'::jsonb)
      from (select id, work_package_id, template_version, template_step_id, status, evidence_link,
                   reviewed_by, reviewed_at, submitted_by, version, updated_by, updated_at
              from public.forge_work_planning_process_instances
              where owner_id = p_owner_id and work_package_id = p_package_id) i
    )
  );
end;
$$;

revoke all on function public.forge_work_planning_process_checklist(text, text) from public, anon, service_role;
grant execute on function public.forge_work_planning_process_checklist(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. forge_hierarchy_test_inventory — owner-only test-subtree inventory.
--
-- The same tree shape as forge_hierarchy_admin_inventory, but only test
-- clients (is_test = true) and only for the platform owner. A non-owner
-- gets an empty tree and canUseOwnerTestData = false — the same shape,
-- never an existence-revealing error. The Planner manager's Test mode
-- reads this RPC (?mode=test); Real mode reads the admin inventory and
-- filters test rows client-side.
-- ---------------------------------------------------------------------------

create or replace function public.forge_hierarchy_test_inventory(p_owner_id text)
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
  v_can_use_test boolean;
begin
  if not public.has_forge_hierarchy_permission(p_owner_id, 'forge.hierarchy.read') then
    raise exception 'FORGE_HIERARCHY_FORBIDDEN';
  end if;
  v_can_manage := public.has_forge_hierarchy_permission(p_owner_id, 'forge.hierarchy.manage');
  v_can_use_test := auth.uid()::text = p_owner_id;

  select jsonb_build_object(
    'ownerId', p_owner_id,
    'canManage', v_can_manage,
    'canUseOwnerTestData', v_can_use_test,
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
          'is_test', true,
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
        where c.owner_id = p_owner_id and c.is_test and v_can_use_test
      ) clients
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

comment on function public.forge_hierarchy_test_inventory(text) is
'Owner-only test-subtree inventory for the Planner Test data section. Returns only is_test clients (with their sites/projects and assigned-package counts) and the server-computed canUseOwnerTestData flag. Non-owners get an empty tree.';

revoke all on function public.forge_hierarchy_test_inventory(text) from public, anon, service_role;
grant execute on function public.forge_hierarchy_test_inventory(text) to authenticated;
