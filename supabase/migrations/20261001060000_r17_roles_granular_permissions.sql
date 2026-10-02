-- R17 (rentec-parity): roles & granular permissions UI.
--
-- Extends the workspace_members model from 20260829000000 instead of replacing it:
--
-- 1. Named staff roles (Rentec's manager set): property_manager, maintenance, marketing join the
--    existing co_owner / manager / bookkeeper / read_only. The old role check constraint is
--    dropped and re-added with the wider set. primary_owner stays implicit (never a row).
-- 2. Per-user permission overrides: workspace_members.permission_overrides (jsonb) holds explicit
--    grant/revoke entries keyed by permission key (see the catalog comment below). Effective
--    permission = override when present, otherwise the role default resolved in the API layer
--    (src/lib/rental/permissions.js). Deny-by-default: no entry anywhere means no permission.
-- 3. Authorization helper activation: has_workspace_access() and resolve_effective_owner_id() drop
--    the co_owner-only filter, so active staff rows (manager/bookkeeper/read_only and the new
--    named roles) finally resolve into the owner's workspace at the RLS/RPC layer -- exactly the
--    "future slice extends the helpers" step the original migrations anticipated. co_owner keeps
--    its current meaning (full access); the primary owner keeps implicit full access.
--    Write-level enforcement of individual permissions lives in the Next.js API layer
--    (requireRentalPermission), starting with the money-moving routes -- see the PR body for the
--    honest gated-vs-legacy coverage list. The DB layer remains the coarse workspace-access
--    boundary it always was; it does not evaluate individual permissions.
-- 4. Team management RPCs: invite_workspace_member's role guard widens to the staff set (the
--    original comment said relaxing that guard was the intended future change) and resolves the
--    effective workspace owner so an active co_owner can invite too. New update_workspace_member
--    (role / permission_overrides / suspend / reactivate, owner-or-co_owner only, audited) plus
--    get_workspace_team, log_team_audit, get_team_audit_log and the workspace_member_audit table
--    backing the "view as" preview safety story (preview sessions are read-only and audited).
--
-- Permission catalog (keys must match src/lib/rental/permissions.js RENTAL_PERMISSIONS):
--   payments.record        - record rent/ledger payments
--   payments.void_refund   - void or refund payments
--   vendor_bills.manage     - manage vendor bills
--   vendor_payments.record  - record vendor payments
--   transfers.record        - record bank transfers
--   tenants.manage          - manage tenants and leases
--   properties.manage       - manage properties and owners
--   maintenance.manage       - manage work orders and contractors
--   messages.send           - send messages and statements
--   reports.view            - view financial reports
--   settings.manage         - manage rental settings
--   team.manage            - manage team members and permissions

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

-- 2. Per-user permission overrides.
alter table workspace_members
    add column if not exists permission_overrides jsonb not null default '{}';

-- 3. Activate staff rows in the authorization helpers (extend, don't replace).
create or replace function public.has_workspace_access(p_owner_id text)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
    select p_owner_id = auth.uid()::text
        or exists (
            select 1 from workspace_members
            where owner_id = p_owner_id
              and member_user_id = auth.uid()
              and status = 'active'
        );
$$;

create or replace function public.resolve_effective_owner_id(p_actor uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
    select coalesce(
        (select owner_id from workspace_members
         where member_user_id = p_actor and status = 'active'
         limit 1),
        p_actor::text
    );
$$;

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

-- 4d. Update a team member: role reassignment, permission-override replacement, and
-- suspend/reactivate. Owner-or-co_owner only; audited. A co_owner can never touch another
-- co_owner's row -- only the primary owner can promote/demote co_owners. Nobody can edit
-- their own row through this path.
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
        'reports.view', 'settings.manage', 'team.manage'
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
