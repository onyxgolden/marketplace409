-- Borrower payoff and balance presentation needs the contractual schedule and allocation terms.
-- Keep this read account-scoped through the same active-membership identity boundary used by
-- borrower account/component reads. No borrower write policy is introduced.
create policy "pf_account_terms_versions_borrower_select"
on public.private_financing_account_terms_versions
for select
to authenticated
using (
  exists (
    select 1
      from public.private_financing_account_borrowers membership
      join public.private_financing_borrowers borrower
        on borrower.owner_id = membership.owner_id
       and borrower.id = membership.borrower_id
     where membership.owner_id = private_financing_account_terms_versions.owner_id
       and membership.account_id = private_financing_account_terms_versions.account_id
       and membership.status = 'active'
       and borrower.auth_user_id = auth.uid()
  )
);

