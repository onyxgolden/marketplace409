-- Explicit least-privilege read grants for Private Financing.
--
-- RLS policies decide which rows an authenticated identity may see, but policies do not themselves grant
-- table privileges. These tables were created without explicit SELECT grants, causing owner/co-owner API
-- reads to fail before RLS could authorize them. Grant only SELECT; all ledger writes and guarded policy
-- writes remain RPC-only, and no INSERT/UPDATE/DELETE/ALL privilege is added here.

grant select on table public.private_financing_accounts to authenticated;
grant select on table public.private_financing_components to authenticated;
grant select on table public.private_financing_borrowers to authenticated;
grant select on table public.private_financing_account_borrowers to authenticated;
grant select on table public.private_financing_events to authenticated;
grant select on table public.private_financing_payoff_offers to authenticated;
grant select on table public.private_financing_servicing_policy_versions to authenticated;
grant select on table public.private_financing_account_terms_versions to authenticated;

-- The convenience view uses security_invoker=true and therefore preserves the base component table's RLS.
grant select on table public.private_financing_current_components to authenticated;
