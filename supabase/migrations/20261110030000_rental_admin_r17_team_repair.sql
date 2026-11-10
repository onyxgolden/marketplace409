-- Rental admin R17 foundation repair, part 2: Team page (NOT YET APPLIED — file only).
--
-- R17 migrations 20261001060000 + 20261001070500 were never applied to production.
-- Part 1 (permission_overrides column + has_workspace_visibility) was applied live
-- 2026-11-10 ~09:45 on Jason's word and filed as PR #768 (merged). The Team page
-- (409marketplace.online/forge/rental?section=team) still fails: GET /api/rental/team
-- -> 500 (get_workspace_team missing) and GET /api/rental/team/audit -> 500
-- (get_team_audit_log missing). This file restores the remaining team-management
-- objects, verbatim R17 text, in dependency order.
--
-- Contents (all verbatim from the R17 files, except this header):
--   1. Role check-constraint widening (060000 §1): property_manager / maintenance /
--      marketing join the allowed role set. Live constraint is still the narrow
--      5-role set, so staff-role invites would fail without this.
--   2. workspace_member_audit table + index + RLS (forced) + owner policy (060000 §4a).
--   3. team_management_owner_id() (060000 §4b).
--   4. invite_workspace_member() — R17 version: staff roles + co_owner may invite,
--      audited (060000 §4c). REPLACES the live pre-R17 owner-only/co_owner-only version.
--   5. update_workspace_member() — 070500 Finding-2 version (team.manage NOT
--      staff-grantable; belt-and-braces rejection). SUPERSEDES the 060000 §4d version.
--   6. get_workspace_team() (060000 §4e).
--   7. log_team_audit() + get_team_audit_log() (060000 §4f).
--   8. suspend_workspace_member() + reactivate_workspace_member() — R17 versions:
--      co_owner may manage the team alongside the owner, audited (060000 §4g).
--      REPLACE the live pre-R17 owner-only versions.
--   9. The verbatim R17 GRANT/REVOKE block (060000 tail) for the five functions it
--      names. NOTE: `REVOKE ... FROM public` is a no-op under Supabase defaults —
--      new functions still get EXECUTE for anon. See the apply notes below.
--
-- Deliberately NOT in this file:
--   - has_workspace_access (060000 §3 would widen it to any active member; live is
--     correct: owner + active co-owner only).
--   - has_workspace_visibility, has_rental_permission (already live from part 1 /
--     slice 1). resolve_effective_owner_id (already live).
--   - permission_overrides column (already live from part 1).
--   - The 070500 Finding-1 staff SELECT/WRITE RLS policies on rental tables: a
--     separate outstanding R17 gap, not needed for the Team page endpoints.
--   - update_workspace_member's 060000 §4d version (superseded by the 070500
--     Finding-2 version included here).
--
-- APPLY NOTES (read before applying; this file was prepared, not applied):
--   a. Role-constraint DO block: its `pg_get_constraintdef(oid) ilike '%role in (%'`
--      pattern does NOT match the live constraint's deparsed form (live def is
--      `CHECK ((role = ANY (ARRAY[...` — verified in scratch). The block will no-op
--      live and the narrow `workspace_members_role_check` will remain alongside the
--      new wide one, so staff-role inserts would STILL fail. At apply time, drop the
--      narrow constraint by name first:
--        alter table workspace_members drop constraint workspace_members_role_check;
--      (then this file's `add constraint workspace_members_role_check_r17` applies
--      cleanly). The other live role constraint, `workspace_members_role_check1`
--      (role <> 'primary_owner'), stays — primary_owner remains implicit, never a row.
--   b. Grants: after applying, explicitly revoke EXECUTE from anon on every new
--      function (and on the three replaced ones), then verify proacl, e.g.:
--        revoke execute on function public.get_workspace_team() from anon;
--        revoke execute on function public.get_team_audit_log(integer) from anon;
--        revoke execute on function public.update_workspace_member(text, text, jsonb, text) from anon;
--        revoke execute on function public.invite_workspace_member(text, text) from anon;
--        revoke execute on function public.suspend_workspace_member(text) from anon;
--        revoke execute on function public.reactivate_workspace_member(text) from anon;
--        revoke execute on function public.log_team_audit(text, text, jsonb) from anon;
--        revoke execute on function public.team_management_owner_id() from anon;
--      The functions fail closed for anon anyway (team_management_owner_id raises
--      when auth.uid() is null), but anon EXECUTE must not be left in place — same
--      bug class as PR #766 (anon kept EXECUTE on all 21 RPCs). Pre-existing residue
--      of the same kind is already live on invite/suspend/reactivate/
--      resolve_effective_owner_id/has_workspace_access/has_rental_permission/
--      has_workspace_visibility (all carry anon=X today); that is a separate
--      hardening item, not part of this file.
--   c. manage_workspace_member_membership (already live, 20261101040000) calls
--      team_management_owner_id() and writes workspace_member_audit, and its resend
--      path calls invite_workspace_member() — it is broken live until this file
--      lands. No change to that function is needed; this file restores its deps.
--   d. Pre-apply backup + post-apply ACL/RLS receipt required before declaring done
--      (standing rule since the Nov 6 P8 apply).
--   e. Single-apply only: the §1 `add constraint workspace_members_role_check_r17`
--      has no IF NOT EXISTS guard (verbatim R17). A second run of this file aborts
--      at that statement (verified in scratch: ERROR constraint already exists).
--      Everything else in the file is re-runnable (create or replace / if not
--      exists / drop if exists). Apply once; do not re-run blindly after a partial
--      failure — check what landed first.

-- ---------------------------------------------------------------------------
-- 1. Role check-constraint widening (060000 §1, lines 42-63).
-- ---------------------------------------------------------------------------
-- 1. Widen the role check constraint (drop the auto-named original, re-add with the named set).
do $$
declare
    constraint_name_value text;
begin
    select conname into constraint_name_value
      from pg_constraint
     where conrelid = 'workspace_members'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%role in (%';
    if constraint_name_value is not null then
        execute format('alter table workspace_members drop constraint %I', constraint_name_value);
    end if;
end
$$;

alter table workspace_members
    add constraint workspace_members_role_check_r17
    check (role in (
        'primary_owner', 'co_owner', 'manager', 'property_manager',
        'bookkeeper', 'maintenance', 'marketing', 'read_only'
    ));

-- ---------------------------------------------------------------------------
-- 2. workspace_member_audit table + RLS (060000 §4a, lines 103-122).
-- ---------------------------------------------------------------------------
-- 4a. Audit table for team management + preview sessions.
create table if not exists workspace_member_audit (
    id uuid not null default gen_random_uuid() primary key,
    owner_id text not null,
    actor_user_id uuid not null,
    action text not null check (btrim(action) <> ''),
    target_member_id text,
    detail jsonb not null default '{}',
    created_at timestamptz not null default now()
);

create index if not exists idx_workspace_member_audit_owner_created
    on workspace_member_audit (owner_id, created_at desc);

alter table workspace_member_audit enable row level security;
alter table workspace_member_audit force row level security;

drop policy if exists "workspace_member_audit_owner_all" on workspace_member_audit;
create policy "workspace_member_audit_owner_all" on workspace_member_audit for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 3. team_management_owner_id() (060000 §4b, lines 124-160).
-- ---------------------------------------------------------------------------
-- 4b. Resolves the workspace id team management acts within, and enforces that the caller is the
-- primary owner or an active co_owner (the only team.manage holders). Raises otherwise.
create or replace function public.team_management_owner_id()
returns text
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
    actor uuid := auth.uid();
    membership_role text;
    membership_owner text;
begin
    if actor is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;

    select role, owner_id into membership_role, membership_owner
      from workspace_members
     where member_user_id = actor
       and status = 'active'
     limit 1;

    if not found then
        return actor::text;
    end if;

    if membership_role = 'co_owner' then
        return membership_owner;
    end if;

    raise exception 'Team management requires the owner or co-owner role.' using errcode = '42501';
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. invite_workspace_member(), R17 version (060000 §4c, lines 161-240).
-- ---------------------------------------------------------------------------
-- 4c. Widen invite_workspace_member: any staff role may be invited (the future change the
-- original migration anticipated), and an active co_owner may invite into the shared workspace.
create or replace function public.invite_workspace_member(p_email text, p_role text default 'co_owner')
returns workspace_members
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    owner_id_value text := public.team_management_owner_id();
    normalized_email text := lower(btrim(coalesce(p_email, '')));
    owner_email text;
    invitee_user_id uuid;
    invitee_confirmed_at timestamptz;
    new_id text;
    inserted workspace_members%rowtype;
begin
    if normalized_email = '' then
        raise exception 'An email address is required.' using errcode = '22023';
    end if;
    if p_role not in (
        'co_owner', 'manager', 'property_manager',
        'bookkeeper', 'maintenance', 'marketing', 'read_only'
    ) then
        raise exception 'Unknown team role: %.', p_role using errcode = '22023';
    end if;

    select lower(nullif(btrim(users.email), ''))
      into owner_email
      from auth.users users
     where users.id = auth.uid();
    if owner_email is not null and owner_email = normalized_email then
        raise exception 'You cannot invite yourself.' using errcode = '22023';
    end if;

    select users.id, users.email_confirmed_at
      into invitee_user_id, invitee_confirmed_at
      from auth.users users
     where lower(nullif(btrim(users.email), '')) = normalized_email;
    if invitee_user_id is null then
        raise exception 'No existing account was found for that email address.' using errcode = '22023';
    end if;
    if invitee_confirmed_at is null then
        raise exception 'That account has not confirmed its email address yet.' using errcode = '22023';
    end if;

    if exists (
        select 1 from workspace_members
        where member_user_id = invitee_user_id and status = 'active'
    ) then
        raise exception 'That user already has an active workspace membership elsewhere.' using errcode = '23505';
    end if;

    new_id := 'workspace_member_' || gen_random_uuid()::text;

    insert into workspace_members (
        owner_id, id, member_user_id, role, status, invited_email, invited_by
    ) values (
        owner_id_value, new_id, invitee_user_id, p_role, 'invited', normalized_email, auth.uid()
    )
    on conflict (owner_id, member_user_id) do update
        set role = excluded.role,
            status = 'invited',
            invited_email = excluded.invited_email,
            invited_by = excluded.invited_by,
            invited_at = now(),
            activated_at = null,
            suspended_at = null,
            updated_at = now()
    returning * into inserted;

    insert into workspace_member_audit (owner_id, actor_user_id, action, target_member_id, detail)
    values (owner_id_value, auth.uid(), 'member.invited', inserted.id,
            jsonb_build_object('role', p_role, 'email', normalized_email));

    return inserted;
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. update_workspace_member(), 070500 Finding-2 version (070500 lines 160-304).
--    Supersedes the 060000 §4d version (team.manage NOT staff-grantable).
-- ---------------------------------------------------------------------------
-- ----------------------------------------------------------------------------
-- Finding 2: update_workspace_member — remove team.manage from the staff-overridable
-- catalog and reject team.manage=true on non-co_owner memberships outright.
-- ----------------------------------------------------------------------------

create or replace function public.update_workspace_member(
    p_member_id text,
    p_role text default null,
    p_permission_overrides jsonb default null,
    p_status_action text default null
)
returns workspace_members
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    owner_id_value text := public.team_management_owner_id();
    actor_is_primary_owner boolean := (owner_id_value = auth.uid()::text);
    target workspace_members%rowtype;
    updated workspace_members%rowtype;
    new_role text;
    new_overrides jsonb;
    new_status text;
    override_key text;
    valid_permissions text[] := array[
        'payments.record', 'payments.void_refund', 'vendor_bills.manage',
        'vendor_payments.record', 'transfers.record', 'tenants.manage',
        'properties.manage', 'maintenance.manage', 'messages.send',
        'reports.view', 'settings.manage'
        -- NO-GO fix (finding 2): team.manage is NOT staff-grantable. Only the
        -- primary owner (implicit) and co_owner (role) hold team management
        -- rights; the override catalog must not offer it to staff.
    ];
begin
    select * into target
      from workspace_members
     where owner_id = owner_id_value
       and id = p_member_id;

    if not found then
        raise exception 'No team member matching that id was found in your workspace.' using errcode = '22023';
    end if;

    if target.member_user_id = auth.uid() then
        raise exception 'You cannot change your own team membership.' using errcode = '22023';
    end if;

    if target.role = 'co_owner' and not actor_is_primary_owner then
        raise exception 'Only the primary owner can change a co-owner''s membership.' using errcode = '42501';
    end if;

    new_role := target.role;
    new_overrides := target.permission_overrides;
    new_status := target.status;

    if p_role is not null then
        if p_role not in (
            'co_owner', 'manager', 'property_manager',
            'bookkeeper', 'maintenance', 'marketing', 'read_only'
        ) then
            raise exception 'Unknown team role: %.', p_role using errcode = '22023';
        end if;
        new_role := p_role;
    end if;

    if p_permission_overrides is not null then
        if jsonb_typeof(p_permission_overrides) <> 'object' then
            raise exception 'Permission overrides must be a JSON object.' using errcode = '22023';
        end if;
        for override_key in select jsonb_object_keys(p_permission_overrides) loop
            if not (override_key = any (valid_permissions)) then
                raise exception 'Unknown permission: %.', override_key using errcode = '22023';
            end if;
            if jsonb_typeof(p_permission_overrides -> override_key) <> 'boolean' then
                raise exception 'Permission override values must be true or false.' using errcode = '22023';
            end if;
        end loop;
        new_overrides := p_permission_overrides;
    end if;

    -- NO-GO fix (finding 2, belt-and-braces): team.manage=true on a non-co_owner
    -- membership is rejected even if it bypassed the catalog above.
    if new_role <> 'co_owner' and (new_overrides ? 'team.manage')
       and (new_overrides ->> 'team.manage') = 'true' then
        raise exception 'team.manage can only be held by the primary owner or a co-owner.' using errcode = '42501';
    end if;

    if p_status_action is not null then
        if p_status_action = 'suspend' then
            if target.status <> 'active' then
                raise exception 'Only an active membership can be suspended.' using errcode = '22023';
            end if;
            new_status := 'suspended';
        elsif p_status_action = 'reactivate' then
            if target.status <> 'suspended' then
                raise exception 'Only a suspended membership can be reactivated.' using errcode = '22023';
            end if;
            new_status := 'active';
        else
            raise exception 'Unknown status action: %.', p_status_action using errcode = '22023';
        end if;
    end if;

    update workspace_members
       set role = new_role,
           permission_overrides = new_overrides,
           status = new_status,
           suspended_at = case
               when p_status_action = 'suspend' then now()
               when p_status_action = 'reactivate' then null
               else suspended_at
           end,
           updated_at = now()
     where owner_id = owner_id_value
       and id = p_member_id
    returning * into updated;

    if p_role is not null and p_role <> target.role then
        insert into workspace_member_audit (owner_id, actor_user_id, action, target_member_id, detail)
        values (owner_id_value, auth.uid(), 'member.role_changed', updated.id,
                jsonb_build_object('from', target.role, 'to', p_role));
    end if;

    if p_permission_overrides is not null then
        insert into workspace_member_audit (owner_id, actor_user_id, action, target_member_id, detail)
        values (owner_id_value, auth.uid(), 'member.permissions_changed', updated.id,
                jsonb_build_object('overrides', p_permission_overrides));
    end if;

    if p_status_action = 'suspend' then
        insert into workspace_member_audit (owner_id, actor_user_id, action, target_member_id, detail)
        values (owner_id_value, auth.uid(), 'member.suspended', updated.id, '{}');
    elsif p_status_action = 'reactivate' then
        insert into workspace_member_audit (owner_id, actor_user_id, action, target_member_id, detail)
        values (owner_id_value, auth.uid(), 'member.reactivated', updated.id, '{}');
    end if;

    return updated;
end;
$$;




-- ---------------------------------------------------------------------------
-- 6. get_workspace_team() (060000 §4e, lines 373-387).
-- ---------------------------------------------------------------------------
-- 4e. Team listing for the management UI (owner/co_owner only via team_management_owner_id).
create or replace function public.get_workspace_team()
returns setof workspace_members
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
    select *
      from workspace_members
     where owner_id = public.team_management_owner_id()
     order by invited_at desc;
$$;


-- ---------------------------------------------------------------------------
-- 7. log_team_audit() + get_team_audit_log() (060000 §4f, lines 388-431).
-- ---------------------------------------------------------------------------
-- 4f. Audit helpers: any workspace actor may write their own audit entries (used for preview
-- session start/end, which the primary owner or co_owner performs); only the owner/co_owner
-- may read the log.
create or replace function public.log_team_audit(
    p_action text,
    p_target_member_id text default null,
    p_detail jsonb default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    actor uuid := auth.uid();
begin
    if actor is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    if btrim(coalesce(p_action, '')) = '' then
        raise exception 'An audit action is required.' using errcode = '22023';
    end if;

    insert into workspace_member_audit (owner_id, actor_user_id, action, target_member_id, detail)
    values (public.resolve_effective_owner_id(actor), actor, p_action, p_target_member_id, coalesce(p_detail, '{}'));
end;
$$;

create or replace function public.get_team_audit_log(p_limit integer default 100)
returns setof workspace_member_audit
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
    select *
      from workspace_member_audit
     where owner_id = public.team_management_owner_id()
     order by created_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;


-- ---------------------------------------------------------------------------
-- 8. suspend/reactivate_workspace_member(), R17 versions (060000 §4g, lines 432-495).
-- ---------------------------------------------------------------------------
-- 4g. Extend suspend/reactivate to the shared workspace: a co_owner manages the team alongside
-- the primary owner. Semantics otherwise unchanged.
create or replace function public.suspend_workspace_member(p_member_id text)
returns workspace_members
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    owner_id_value text := public.team_management_owner_id();
    updated workspace_members%rowtype;
begin
    update workspace_members
       set status = 'suspended',
           suspended_at = now(),
           updated_at = now()
     where owner_id = owner_id_value
       and id = p_member_id
       and status = 'active'
       and member_user_id <> auth.uid()
    returning * into updated;

    if updated.id is null then
        raise exception 'No active membership matching that id was found in your workspace.' using errcode = '22023';
    end if;

    insert into workspace_member_audit (owner_id, actor_user_id, action, target_member_id, detail)
    values (owner_id_value, auth.uid(), 'member.suspended', updated.id, '{}');

    return updated;
end;
$$;

create or replace function public.reactivate_workspace_member(p_member_id text)
returns workspace_members
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    owner_id_value text := public.team_management_owner_id();
    updated workspace_members%rowtype;
begin
    update workspace_members
       set status = 'active',
           updated_at = now()
     where owner_id = owner_id_value
       and id = p_member_id
       and status = 'suspended'
    returning * into updated;

    if updated.id is null then
        raise exception 'No suspended membership matching that id was found in your workspace.' using errcode = '22023';
    end if;

    insert into workspace_member_audit (owner_id, actor_user_id, action, target_member_id, detail)
    values (owner_id_value, auth.uid(), 'member.reactivated', updated.id, '{}');

    return updated;
end;
$$;


-- ---------------------------------------------------------------------------
-- 9. Verbatim R17 GRANT/REVOKE block (060000 lines 496-505).
--    NOTE: `REVOKE ... FROM public` does not remove Supabase default EXECUTE
--    grants to named roles (anon keeps EXECUTE). See header note (b): apply
--    explicit `REVOKE EXECUTE ... FROM anon` per function after applying.
-- ---------------------------------------------------------------------------
revoke all on function public.team_management_owner_id() from public;
revoke all on function public.update_workspace_member(text, text, jsonb, text) from public;
revoke all on function public.get_workspace_team() from public;
revoke all on function public.log_team_audit(text, text, jsonb) from public;
revoke all on function public.get_team_audit_log(integer) from public;
grant execute on function public.team_management_owner_id() to authenticated;
grant execute on function public.update_workspace_member(text, text, jsonb, text) to authenticated;
grant execute on function public.get_workspace_team() to authenticated;
grant execute on function public.log_team_audit(text, text, jsonb) to authenticated;
grant execute on function public.get_team_audit_log(integer) to authenticated;
