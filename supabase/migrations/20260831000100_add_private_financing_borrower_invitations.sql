-- Account-scoped borrower invitations. The seller may create/re-send an invited membership only
-- inside their effective workspace. Claiming remains email-bound to auth.uid() through the existing
-- claim_private_financing_borrower_portal() function.
create or replace function invite_private_financing_borrower(
    p_owner_id text,
    p_account_id text,
    p_email text,
    p_full_name text,
    p_role text default 'primary_borrower'
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    v_actor uuid := auth.uid();
    v_email text := lower(nullif(btrim(p_email), ''));
    v_borrower private_financing_borrowers;
    v_membership private_financing_account_borrowers;
    v_auth_user uuid;
    v_confirmed_at timestamptz;
begin
    if v_actor is null or not has_workspace_access(p_owner_id) then
        raise exception 'Seller workspace access is required.' using errcode = '42501';
    end if;
    if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        raise exception 'A valid borrower email is required.' using errcode = '22023';
    end if;
    if p_role not in ('primary_borrower', 'co_borrower', 'guarantor') then
        raise exception 'A supported borrower role is required.' using errcode = '22023';
    end if;
    if not exists (select 1 from private_financing_accounts a where a.owner_id=p_owner_id and a.id=p_account_id) then
        raise exception 'Private financing account not found.' using errcode = 'P0002';
    end if;

    insert into private_financing_borrowers(owner_id,id,email,full_name,created_by,updated_by)
    values(p_owner_id,'pf_brw_'||gen_random_uuid()::text,v_email,nullif(btrim(p_full_name),''),v_actor::text,v_actor::text)
    on conflict (owner_id,(lower(email))) do update
      set full_name=coalesce(nullif(btrim(excluded.full_name),''),private_financing_borrowers.full_name),
          updated_by=v_actor::text, updated_at=now()
    returning * into v_borrower;

    insert into private_financing_account_borrowers(owner_id,id,account_id,borrower_id,role,status,created_by,updated_by)
    values(p_owner_id,'pf_ab_'||gen_random_uuid()::text,p_account_id,v_borrower.id,p_role,'invited',v_actor::text,v_actor::text)
    on conflict (owner_id,account_id,borrower_id) do update
      set role=excluded.role, invited_at=case when private_financing_account_borrowers.status='invited' then now() else private_financing_account_borrowers.invited_at end,
          updated_by=v_actor::text, updated_at=now()
    returning * into v_membership;

    select u.id,u.email_confirmed_at into v_auth_user,v_confirmed_at from auth.users u where lower(u.email)=v_email limit 1;
    return jsonb_build_object('borrowerId',v_borrower.id,'membershipId',v_membership.id,'email',v_email,
      'fullName',v_borrower.full_name,'role',v_membership.role,'status',v_membership.status,
      'registeredAccount',v_auth_user is not null,'confirmedAccount',v_confirmed_at is not null);
end;
$$;

revoke all on function invite_private_financing_borrower(text,text,text,text,text) from public;
grant execute on function invite_private_financing_borrower(text,text,text,text,text) to authenticated;
