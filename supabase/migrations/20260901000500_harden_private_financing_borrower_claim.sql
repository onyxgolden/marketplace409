create or replace function claim_private_financing_borrower_portal()
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    authenticated_user_id uuid := auth.uid();
    authenticated_email text;
    email_confirmed timestamptz;
    v_claimed_count integer;
    v_activated_count integer;
begin
    if authenticated_user_id is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;

    -- Serialize repeat invitation-link opens for the same auth account. Read the canonical email from
    -- auth.users; the JWT email is only a fallback for providers that omit it from the row response.
    perform pg_advisory_xact_lock(hashtextextended('private-financing-borrower:' || authenticated_user_id::text, 0));
    select lower(nullif(btrim(coalesce(users.email, auth.jwt()->>'email')), '')), users.email_confirmed_at
      into authenticated_email, email_confirmed
      from auth.users users where users.id = authenticated_user_id limit 1;
    if authenticated_email is null or email_confirmed is null then
        raise exception 'A confirmed account email is required.' using errcode = '42501';
    end if;

    update public.private_financing_borrowers
       set auth_user_id = authenticated_user_id, updated_at = now()
     where lower(btrim(email)) = authenticated_email
       and (auth_user_id is null or auth_user_id = authenticated_user_id);
    get diagnostics v_claimed_count = row_count;

    update public.private_financing_account_borrowers m
       set status = 'active', activated_at = coalesce(m.activated_at, now()), updated_at = now()
      from public.private_financing_borrowers b
     where b.owner_id = m.owner_id and b.id = m.borrower_id
       and b.auth_user_id = authenticated_user_id
       and m.status = 'invited';
    get diagnostics v_activated_count = row_count;

    return jsonb_build_object('signedInEmail',authenticated_email,'claimedIdentityCount',v_claimed_count,'activatedMembershipCount',v_activated_count);
end;
$$;

revoke all on function claim_private_financing_borrower_portal() from public;
grant execute on function claim_private_financing_borrower_portal() to authenticated;
