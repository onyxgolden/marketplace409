-- Fixes a real bug: financial_events.business_scope defaults to 'business' at the DB level, and
-- the connection-import pipeline (Plaid / Stripe Financial Connections, source_system =
-- 'transaction') never set it explicitly -- so EVERY bank-connection-imported transaction, for
-- every account regardless of whether it's actually a personal or business account, silently
-- landed as business_scope = 'business'. Confirmed in production: 214 existing financial_events
-- rows, all business_scope = 'business', normalized_category = 'other', spanning real DuGood/
-- Capital One accounts including a personal checking account ("Advantage Checking Account").
--
-- financial_accounts gets a new business_scope column as the persisted classification an account's
-- transactions should carry going forward (the application code fix in this same change threads it
-- through both import paths). This migration also backfills BOTH tables for data that already
-- exists.
--
-- The classification itself is a NAME-BASED HEURISTIC, not an authoritative classification: an
-- account whose name or official_name contains the word "business" (case-insensitive) is treated
-- as a business account; everything else is treated as personal. This is a reasonable default given
-- real account names seen in production (e.g. DuGood's "Business Checking - No Div/Fee" vs.
-- "Advantage Checking Account"), but a future feature should let the account's owner override it
-- per account -- this migration does not build that, it only adds the column an override would live
-- in.

alter table financial_accounts
    add column if not exists business_scope text check (business_scope in ('business', 'personal'));

update financial_accounts
   set business_scope = case
           when lower(coalesce(name, '') || ' ' || coalesce(official_name, '')) like '%business%'
               then 'business'
           else 'personal'
       end
 where business_scope is null;

-- Only the connection-import path (source_system = 'transaction') is touched. Every other
-- financial_events source (Quicken Simplifi CSV import, Rentec, Rentec API, rental payments,
-- property setup) already manages its own business_scope correctly and independently -- this bug
-- was isolated to the shared Transaction-to-FinancialEvent boundary that only the connection-import
-- pipeline goes through.
update financial_events fe
   set business_scope = fa.business_scope,
       updated_at = now()
  from financial_accounts fa
 where fe.financial_account_id = fa.id
   and fe.owner_id = fa.owner_id
   and fe.source_system = 'transaction'
   and fa.business_scope is not null
   and fe.business_scope is distinct from fa.business_scope;
