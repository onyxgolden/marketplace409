-- Shared FORGE workspace membership -- Checkpoint 2. Invitation/acceptance/suspend/reactivate RPCs.
-- Mirrors claim_rental_tenant_portal() (20260812001600_claim_rental_tenant_portal.sql) in spirit,
-- but simpler: since requirement 9 is "invite an EXISTING user by email" (not a not-yet-signed-up
-- tenant), invite_workspace_member resolves the invitee's auth.users.id server-side, by email,
-- at invite time -- never from client input. accept_workspace_invitation() then only has to verify
-- auth.uid() matches an already-resolved member_user_id on an invited row, no ambiguous-email-match
-- handling needed (unlike the tenant flow, which predates signup and so must match by email at
-- claim time instead). This satisfies requirement 10 (never accept a browser-submitted UUID) by
-- construction: the only UUID that ever lands in member_user_id came from our own auth.users
-- lookup, never from a request parameter.
--
-- p_role is restricted to 'co_owner' here, not because the schema can't hold the other 4 roles
-- (it can, see 20260829000000_create_workspace_members.sql) but because only co_owner is activated
-- by the authorization helpers this slice -- offering an invite that silently grants nothing would
-- be misleading. Relaxing this guard is the only change a future slice needs to activate the other
-- roles' invite path.

create or replace function public.invite_workspace_member(p_email text, p_role text default 'co_owner')
returns workspace_members
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    owner_id_value text := auth.uid()::text;
    normalized_email text := lower(btrim(coalesce(p_email, '')));
    owner_email text;
    invitee_user_id uuid;
    invitee_confirmed_at timestamptz;
    new_id text;
    inserted workspace_members%rowtype;
begin
    if owner_id_value is null then
        raise exception 'An authenticated owner is required.' using errcode = '42501';
    end if;
    if normalized_email = '' then
        raise exception 'An email address is required.' using errcode = '22023';
    end if;
    if p_role <> 'co_owner' then
        raise exception 'Only co_owner invitations are supported in this release.' using errcode = '22023';
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

    return inserted;
end;
$$;

create or replace function public.accept_workspace_invitation()
returns workspace_members
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    authenticated_user_id uuid := auth.uid();
    updated workspace_members%rowtype;
begin
    if authenticated_user_id is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;

    update workspace_members
       set status = 'active',
           activated_at = now(),
           updated_at = now()
     where member_user_id = authenticated_user_id
       and status = 'invited'
     returning * into updated;

    if updated.id is null then
        raise exception 'No pending workspace invitation was found for this account.' using errcode = '22023';
    end if;

    return updated;
end;
$$;

create or replace function public.suspend_workspace_member(p_member_id text)
returns workspace_members
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    owner_id_value text := auth.uid()::text;
    updated workspace_members%rowtype;
begin
    if owner_id_value is null then
        raise exception 'An authenticated owner is required.' using errcode = '42501';
    end if;

    update workspace_members
       set status = 'suspended',
           suspended_at = now(),
           updated_at = now()
     where owner_id = owner_id_value
       and id = p_member_id
       and status = 'active'
     returning * into updated;

    if updated.id is null then
        raise exception 'No active membership matching that id was found in your workspace.' using errcode = '22023';
    end if;

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
    owner_id_value text := auth.uid()::text;
    updated workspace_members%rowtype;
begin
    if owner_id_value is null then
        raise exception 'An authenticated owner is required.' using errcode = '42501';
    end if;

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

    return updated;
end;
$$;

revoke all on function public.invite_workspace_member(text, text) from public;
revoke all on function public.accept_workspace_invitation() from public;
revoke all on function public.suspend_workspace_member(text) from public;
revoke all on function public.reactivate_workspace_member(text) from public;
grant execute on function public.invite_workspace_member(text, text) to authenticated;
grant execute on function public.accept_workspace_invitation() to authenticated;
grant execute on function public.suspend_workspace_member(text) to authenticated;
grant execute on function public.reactivate_workspace_member(text) to authenticated;
