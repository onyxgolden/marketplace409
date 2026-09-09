-- Fixes a provider-neutral data-integrity bug found during a production audit: every provider's
-- account mapper (confirmed for Stripe Financial Connections; the same pattern exists for any
-- future provider using this same repository) stamps a fresh `createdAt` on every call, and
-- SupabaseFinancialAccountRepository.saveMany()'s upsert (onConflict: owner_id,provider,
-- provider_account_id) sends `created_at` in its write payload unconditionally. Supabase/
-- PostgREST's default upsert is "INSERT ... ON CONFLICT DO UPDATE SET <every column>", so any
-- re-import of an already-existing account -- e.g. a webhook-triggered refresh, not just the
-- initial link -- silently overwrites created_at to "now".
--
-- Confirmed live: a real Stripe Financial Connections account's created_at/updated_at both jumped
-- to the moment three ~1-hour-delayed automatic Stripe webhook retries each re-triggered an
-- import, even though the account had actually been created an hour earlier.
--
-- Fixed at the database layer, not in application code, so it is correct regardless of which
-- repository method, which provider's mapper, or which future code path writes this table --
-- an app-layer fix scoped to one call site could be bypassed by a different one; this cannot be.
-- Only created_at is pinned: updated_at and every other mutable field (active, mask, name, ...)
-- still update normally on every upsert, exactly as intended.
create or replace function preserve_financial_accounts_created_at()
returns trigger as $$
begin
  new.created_at := old.created_at;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_preserve_financial_accounts_created_at on financial_accounts;

create trigger trg_preserve_financial_accounts_created_at
before update on financial_accounts
for each row
execute function preserve_financial_accounts_created_at();
