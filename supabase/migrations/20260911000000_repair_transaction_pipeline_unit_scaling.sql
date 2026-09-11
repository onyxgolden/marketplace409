-- Repairs financial_events rows written through the shared Transaction-to-FinancialEvent import
-- pipeline (FinancialEventImportService.toFinancialEvent()) before the unit-conversion fix in
-- src/domains/financial-event/minorUnitsToDecimalDollars.ts landed. That boundary previously wrote
-- transaction.amountCents (signed integer minor units) directly into financial_events.amount
-- (signed decimal dollars) with no division -- every affected row's stored amount is ~100x its
-- true value. Root-caused and confirmed against production data 2026-09-11: 209 real rows, all
-- source_system = 'transaction', all metadata->>'provider' = 'stripe_financial_connections', all
-- dated 2026 -- e.g. a real "Online Banking Withdrawal / Transfer to Share 0009" stored as
-- $3,000,000.00 whose true value is $30,000.00.
--
-- DO NOT APPLY THIS MIGRATION until the corrected application code (the commit containing
-- financial-event-import.service.ts's use of minorUnitsToDecimalDollars) is deployed and confirmed
-- live, and any in-flight Stripe Financial Connections import has settled. See
-- docs/financial/transaction-unit-repair-deployment-sequence.md for the full safe release sequence
-- -- applying this migration while old (buggy) application code is still writing new transaction
-- rows would repair the current backlog and then let another incorrectly-scaled row land right
-- after.
--
-- Targeting is by authoritative provenance ONLY, never amount size, description, account name, or
-- date: source_system = 'transaction' (the shared pipeline's own hardcoded sourceSystem, confirmed
-- in financial-event-import.service.ts) AND metadata->>'provider' identifying a transaction-based
-- provider. Both 'stripe_financial_connections' (the only provider with real corrupted production
-- rows at diagnosis time) and 'plaid' are included in the predicate, since PlaidTransactionMapper
-- and StripeFinancialConnectionsTransactionMapper both feed the identical shared, previously-buggy
-- boundary -- if any real Plaid-sourced transaction rows exist by the time this runs (none did at
-- diagnosis time), they carry the same defect and need the same fix.
--
-- Idempotent via a repair marker in metadata (metadata->'unitRepair'): a row already carrying this
-- marker is never re-matched by the WHERE clause below, so re-running this migration (accidentally,
-- or against a review/staging copy of already-repaired data) changes zero additional rows and zero
-- amounts.
--
-- Fails closed: asserts the qualifying, not-yet-repaired row count is within a generous safety
-- ceiling before changing anything, and raises an exception (aborting the whole migration
-- transaction -- nothing is written) rather than silently repairing an unexpected number of rows.
-- 209 is the confirmed count as of diagnosis (2026-09-11); this is intentionally NOT asserted as an
-- exact equality, since legitimate new Stripe activity may sync between diagnosis and this
-- migration actually running -- but a count wildly outside that neighborhood is exactly the signal
-- that the targeting predicate matched more than intended, and must stop the migration rather than
-- proceed.

do $$
declare
  v_qualifying_count integer;
  v_safety_ceiling constant integer := 5000;
begin
  select count(*) into v_qualifying_count
  from financial_events
  where source_system = 'transaction'
    and metadata->>'provider' in ('stripe_financial_connections', 'plaid')
    and metadata->'unitRepair' is null;

  if v_qualifying_count > v_safety_ceiling then
    raise exception
      'financial_events unit-repair: % qualifying row(s) exceeds the safety ceiling of % -- stopping without making any change. This likely means the targeting predicate matched more rows than expected; investigate before re-running.',
      v_qualifying_count, v_safety_ceiling;
  end if;

  raise notice 'financial_events unit-repair: % qualifying row(s) will be corrected.', v_qualifying_count;
end $$;

update financial_events
set
  -- amount is always an integer-valued numeric on every currently-qualifying row (it was written
  -- from an integer amountCents with no division) -- dividing a numeric by 100.0 in Postgres is
  -- exact decimal arithmetic (never floating-point), and always terminates to <=2 decimal places
  -- for an integer numerator, so no explicit rounding is needed to avoid drift.
  amount = amount / 100.0,
  metadata = metadata || jsonb_build_object(
    'unitRepair', jsonb_build_object(
      'version', 1,
      'repairedAt', now(),
      'priorAmount', amount
    )
  ),
  updated_at = now(),
  updated_by = 'system:financial-event-unit-repair-2026-09-11'
where source_system = 'transaction'
  and metadata->>'provider' in ('stripe_financial_connections', 'plaid')
  and metadata->'unitRepair' is null;
