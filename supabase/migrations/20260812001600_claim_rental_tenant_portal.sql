create or replace function claim_rental_tenant_portal()
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    authenticated_user_id uuid := auth.uid();
    authenticated_email text;
    confirmed_at timestamptz;
    matching_count integer;
    claimed rental_tenants%rowtype;
begin
    if authenticated_user_id is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    select lower(nullif(btrim(users.email), '')), users.email_confirmed_at
      into authenticated_email, confirmed_at from auth.users users where users.id = authenticated_user_id;
    if authenticated_email is null or confirmed_at is null then
        raise exception 'A confirmed account email is required.' using errcode = '42501';
    end if;

    select count(*) into matching_count from rental_tenants
     where lower(email) = authenticated_email
       and status in ('invited', 'applicant', 'active')
       and (auth_user_id is null or auth_user_id = authenticated_user_id);
    if matching_count = 0 then return null; end if;
    if matching_count > 1 then
        raise exception 'Multiple tenant invitations match this email.' using errcode = '21000';
    end if;

    update rental_tenants set auth_user_id = authenticated_user_id, status = 'active',
        activated_at = coalesce(activated_at, now()), updated_at = now()
     where lower(email) = authenticated_email
       and status in ('invited', 'applicant', 'active')
       and (auth_user_id is null or auth_user_id = authenticated_user_id)
     returning * into claimed;

    return jsonb_build_object('tenantId', claimed.id, 'status', claimed.status);
end;
$$;

revoke all on function claim_rental_tenant_portal() from public;
grant execute on function claim_rental_tenant_portal() to authenticated;
