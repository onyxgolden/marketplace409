-- Scheduling admin permissions slice 1 — authority-strip repair (2026-11-11).
--
-- ROOT CAUSE (ChatGPT post-merge review of PR #780,
-- results/chatgpt/pr780-scheduling-admin-permissions-slice1-postmerge-review-2026-11-11.md):
-- the original migration (20261110080000) correctly stops a non-owner role
-- manager from editing a ROLE that grants scheduling.roles.manage
-- (forge_scheduling_role_capability_set already has this check) and from
-- ASSIGNING a role that grants admin authority to someone (also already
-- checked in forge_scheduling_role_assign). It never checks the TARGET's
-- EXISTING assignment before mutating it:
--   * forge_scheduling_role_assign validated only the proposed p_role_id, so
--     a delegated admin could reassign another admin's CURRENT role down to
--     a lower-privilege one, demoting a peer administrator.
--   * forge_scheduling_role_assignment_revoke checked only that the actor
--     held scheduling.roles.manage and was not revoking their own
--     assignment -- never whether the assignment being revoked currently
--     points to a role that grants scheduling.roles.manage, so the same
--     delegated admin could outright revoke a peer administrator's access.
--
-- FIX: both functions now look up the target's CURRENT active assignment
-- (if any) before mutating it, and reject a non-owner actor whenever that
-- current role grants scheduling.roles.manage -- the exact same
-- SADM1_CANNOT_EDIT_ANOTHER_ADMIN_ROLE-style guard capability_set already
-- applies to role edits, mirrored here for assign/revoke. Owner and active
-- co-owner keep the full structural bypass (v_is_owner), unchanged.
--
-- This is a `create or replace function` correction with IDENTICAL
-- signatures to the live functions -- re-applying it replaces the function
-- bodies in place; no table/column change, no data migration. Idempotent.

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
  v_target_current_role_grants_roles_manage boolean;
  v_unheld_cap text;
  v_existing_found boolean;
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

  select * into v_existing from public.forge_scheduling_user_role_assignments
  where owner_id = p_owner_id and assignee_user_id = p_assignee_user_id and retired_at is null
  for update;
  v_existing_found := found; -- capture immediately: every later `select into` in this function
                              -- (the capability-manage checks below) overwrites plpgsql's
                              -- ambient FOUND, so the insert/update branch at the bottom must
                              -- read this captured boolean, never a bare `found` reference.

  if not v_is_owner then
    if not public.has_scheduling_permission(p_owner_id, 'scheduling.roles.manage') then
      raise exception 'SADM1_FORBIDDEN';
    end if;

    -- NEW: protect the target's EXISTING authority, not just the proposed role.
    if v_existing_found then
      select exists (
        select 1 from public.forge_scheduling_role_capabilities
        where owner_id = p_owner_id and role_id = v_existing.role_id and capability_key = 'scheduling.roles.manage'
      ) into v_target_current_role_grants_roles_manage;
      if v_target_current_role_grants_roles_manage then
        raise exception 'SADM1_CANNOT_EDIT_ANOTHER_ADMIN_ROLE';
      end if;
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

  if v_existing_found then
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
  v_target_current_role_grants_roles_manage boolean;
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
  if not v_is_owner then
    if not public.has_scheduling_permission(p_owner_id, 'scheduling.roles.manage') then
      raise exception 'SADM1_FORBIDDEN';
    end if;

    -- NEW: protect the target's EXISTING authority before revoking it.
    select exists (
      select 1 from public.forge_scheduling_role_capabilities
      where owner_id = p_owner_id and role_id = v_row.role_id and capability_key = 'scheduling.roles.manage'
    ) into v_target_current_role_grants_roles_manage;
    if v_target_current_role_grants_roles_manage then
      raise exception 'SADM1_CANNOT_EDIT_ANOTHER_ADMIN_ROLE';
    end if;
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
