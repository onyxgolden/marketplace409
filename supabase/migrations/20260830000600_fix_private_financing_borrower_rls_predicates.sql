-- Repair private-financing borrower RLS predicates that directly joined other protected tables under
-- the caller's privileges. PostgreSQL validates every permissive policy expression, so those joins could
-- raise permission errors even for a seller already authorized by the independent workspace policy.
--
-- These narrow predicates mirror has_workspace_access: SECURITY DEFINER, fixed search_path, RLS disabled,
-- boolean-only return, and no data exposure. They add no write permission and preserve self-only
-- membership visibility.

create function has_private_financing_borrower_account_access(
    p_owner_id text,
    p_account_id text
)
returns boolean
language sql
security definer
set search_path = public
set row_security = off
stable
as $$
    select exists (
        select 1
          from public.private_financing_account_borrowers m
          join public.private_financing_borrowers b
            on b.owner_id = m.owner_id and b.id = m.borrower_id
         where m.owner_id = p_owner_id
           and m.account_id = p_account_id
           and m.status = 'active'
           and b.auth_user_id = auth.uid()
    );
$$;

create function is_private_financing_borrower_identity(
    p_owner_id text,
    p_borrower_id text
)
returns boolean
language sql
security definer
set search_path = public
set row_security = off
stable
as $$
    select exists (
        select 1
          from public.private_financing_borrowers b
         where b.owner_id = p_owner_id
           and b.id = p_borrower_id
           and b.auth_user_id = auth.uid()
    );
$$;

revoke all on function has_private_financing_borrower_account_access(text, text) from public;
grant execute on function has_private_financing_borrower_account_access(text, text) to authenticated;
revoke all on function is_private_financing_borrower_identity(text, text) from public;
grant execute on function is_private_financing_borrower_identity(text, text) to authenticated;

drop policy if exists "private_financing_accounts_borrower_select" on private_financing_accounts;
create policy "private_financing_accounts_borrower_select" on private_financing_accounts
    for select to authenticated
    using (has_private_financing_borrower_account_access(owner_id, id));

drop policy if exists "private_financing_components_borrower_select" on private_financing_components;
create policy "private_financing_components_borrower_select" on private_financing_components
    for select to authenticated
    using (has_private_financing_borrower_account_access(owner_id, account_id));

drop policy if exists "private_financing_account_borrowers_self_select" on private_financing_account_borrowers;
create policy "private_financing_account_borrowers_self_select" on private_financing_account_borrowers
    for select to authenticated
    using (is_private_financing_borrower_identity(owner_id, borrower_id));

drop policy if exists "private_financing_payoff_offers_borrower_select" on private_financing_payoff_offers;
create policy "private_financing_payoff_offers_borrower_select" on private_financing_payoff_offers
    for select to authenticated
    using (has_private_financing_borrower_account_access(owner_id, account_id));

comment on function has_private_financing_borrower_account_access(text, text) is
'Boolean-only RLS predicate for an active claimed borrower membership on one financing account.';
comment on function is_private_financing_borrower_identity(text, text) is
'Boolean-only RLS predicate preserving self-only borrower membership visibility.';
