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
-- STRUCTURAL VERSIONING (revised after review): the corrected import service now stamps every new
-- event with metadata.amountUnitVersion = CANONICAL_TRANSACTION_AMOUNT_UNIT_VERSION (see
-- src/domains/financial-event/minorUnitsToDecimalDollars.ts -- currently 1; kept in sync with this
-- migration's own literal `1` by hand, since there is no cross-language enforcement -- if that TS
-- constant is ever bumped, a NEW migration must be written for the new contract version, this one
-- stays a snapshot of the 2026-09-11 correction). This is what makes it SAFE to apply this migration
-- any time after the corrected code is deployed, even if a webhook delivers a new, already-correct
-- event moments before this runs: the predicate below excludes any row already carrying
-- metadata.amountUnitVersion >= 1, regardless of when it was written, rather than relying on a
-- deploy-timing assumption. See docs/financial/transaction-unit-repair-deployment-sequence.md for
-- the full safe release sequence -- deploying the corrected code before applying this migration
-- remains the sensible order, but this migration's own targeting no longer depends on that order
-- being followed within any particular time window.
--
-- Targeting is by authoritative provenance ONLY, never amount size, description, account name, or
-- date: source_system = 'transaction' (the shared pipeline's own hardcoded sourceSystem, confirmed
-- in financial-event-import.service.ts) AND metadata->>'provider' identifying a transaction-based
-- provider AND an amount-unit version that is absent or older than current AND no prior completed
-- repair marker. Both 'stripe_financial_connections' (the only provider with real corrupted
-- production rows at diagnosis time) and 'plaid' are included, since PlaidTransactionMapper and
-- StripeFinancialConnectionsTransactionMapper both feed the identical shared, previously-buggy
-- boundary.
--
-- Idempotent via a repair marker in metadata (metadata->'unitRepair'), kept SEPARATE from
-- amountUnitVersion: a correctly-scaled NEW event carries amountUnitVersion but was never repaired
-- (no unitRepair marker, and correctly so -- it never needed one). A row already carrying unitRepair
-- is never re-matched, so re-running this migration changes zero additional rows and zero amounts.
--
-- FAIL-CLOSED, REFACTORED INTO A TESTABLE FUNCTION (per review): the row-count safety check is now
-- financial_events_unit_repair_qualifying_count() (parameterless, reusable for
-- pre-repair/post-repair verification per the deployment doc) and
-- assert_financial_events_unit_repair_within_ceiling(p_ceiling) (parameterized, so a test can
-- exercise "exceeds ceiling -> raises" cheaply with a tiny ceiling and a handful of fixture rows,
-- without needing to seed thousands of rows to exercise the real production ceiling). The migration
-- itself calls the assert function with the real production ceiling (5000) -- a generous multiple of
-- the confirmed 209-row scope; a count wildly outside that neighborhood means the predicate matched
-- more than intended and must stop the migration, not proceed.

create or replace function financial_events_unit_repair_qualifying_count()
returns integer
language sql
stable
as $$
  select count(*)::integer
  from financial_events
  where source_system = 'transaction'
    and metadata->>'provider' in ('stripe_financial_connections', 'plaid')
    and (
      metadata->>'amountUnitVersion' is null
      or (metadata->>'amountUnitVersion')::integer < 1
    )
    and metadata->'unitRepair' is null;
$$;

create or replace function assert_financial_events_unit_repair_within_ceiling(p_ceiling integer)
returns integer
language plpgsql
as $$
declare
  v_qualifying_count integer;
begin
  v_qualifying_count := financial_events_unit_repair_qualifying_count();

  if v_qualifying_count > p_ceiling then
    raise exception
      'financial_events unit-repair: % qualifying row(s) exceeds the ceiling of % -- stopping without making any change. This likely means the targeting predicate matched more rows than expected; investigate before re-running.',
      v_qualifying_count, p_ceiling;
  end if;

  raise notice 'financial_events unit-repair: % qualifying row(s) will be corrected.', v_qualifying_count;
  return v_qualifying_count;
end;
$$;

select assert_financial_events_unit_repair_within_ceiling(5000);

update financial_events
set
  -- amount is always an integer-valued numeric on every currently-qualifying row (it was written
  -- from an integer amountCents with no division) -- dividing a numeric by 100.0 in Postgres is
  -- exact decimal arithmetic (never floating-point), and always terminates to <=2 decimal places
  -- for an integer numerator, so no explicit rounding is needed to avoid drift.
  amount = amount / 100.0,
  metadata = metadata || jsonb_build_object(
    'amountUnitVersion', 1,
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
  and (
    metadata->>'amountUnitVersion' is null
    or (metadata->>'amountUnitVersion')::integer < 1
  )
  and metadata->'unitRepair' is null;
