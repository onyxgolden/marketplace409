-- Controls-sweep follow-up G25 (O-21): team membership removal, invite
-- cancellation, and invite resend. update_workspace_member knows only
-- suspend/reactivate, and direct table access fails RLS for co-owner
-- managers (owner-only policies), so this security-definer RPC owns the
-- three actions with the same guards the update RPC enforces: never self,
-- co-owner changes primary-owner-only. Audit rows carry no FK to
-- workspace_members, so deleting a row keeps its history. Resend re-runs
-- invite_workspace_member, whose upsert refreshes invited_at and resets
-- the row to invited — gated here to invited rows only, so an active
-- member can never be reset by a resend. Remove is for accepted members
-- (active/suspended); cancel is for unaccepted invites.
create or replace function public.manage_workspace_member_membership(p_member_id text, p_action text)
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
  resent workspace_members%rowtype;
begin
  if p_action not in ('remove', 'cancel', 'resend') then
    raise exception 'Unknown team membership action: %.', p_action using errcode = '22023';
  end if;
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
  if p_action = 'remove' and target.status = 'invited' then
    raise exception 'That invite is still unaccepted — cancel the invite instead.' using errcode = '22023';
  end if;
  if p_action = 'cancel' and target.status <> 'invited' then
    raise exception 'Only an unaccepted invite can be cancelled — remove an accepted member instead.' using errcode = '22023';
  end if;
  if p_action = 'resend' and target.status <> 'invited' then
    raise exception 'Only an unaccepted invite can be resent.' using errcode = '22023';
  end if;
  if p_action = 'resend' then
    select * into resent from public.invite_workspace_member(target.invited_email, target.role);
    insert into workspace_member_audit (owner_id, actor_user_id, action, target_member_id, detail)
      values (owner_id_value, auth.uid(), 'member.invite_resent', p_member_id, '{}');
    return resent;
  end if;
  delete from workspace_members where owner_id = owner_id_value and id = p_member_id;
  insert into workspace_member_audit (owner_id, actor_user_id, action, target_member_id, detail)
    values (owner_id_value, auth.uid(),
      case when p_action = 'cancel' then 'member.invite_cancelled' else 'member.removed' end,
      p_member_id, '{}');
  return null;
end;
$$;
revoke all on function public.manage_workspace_member_membership(text, text) from public, anon;
grant execute on function public.manage_workspace_member_membership(text, text) to authenticated;
