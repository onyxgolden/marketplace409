-- Backfills financial_events.financial_account_id for rows written through the shared
-- Transaction-to-FinancialEvent import pipeline (FinancialEventImportService.toFinancialEvent())
-- before the account-id fix landed. That boundary always knew the real financial_accounts.id for
-- a Plaid/Stripe Financial Connections transaction, but only ever wrote it into
-- metadata.financialAccountId -- never onto the financial_account_id column itself, which stayed
-- null on every such row. The Financial FORGE account-activity click-through
-- (FinancialAccountBalancesPanel filtering allScopeTransactionPresentations by
-- financialAccountId) filters on the COLUMN, so every Plaid/Stripe-synced account showed no
-- transaction details when clicked, even though the correct account was known the entire time and
-- sitting right there in metadata.
--
-- Same repair discipline as 20260911000000_repair_transaction_pipeline_unit_scaling.sql: targeting
-- is by authoritative provenance only (source_system = 'transaction', a metadata.financialAccountId
-- actually present), NEVER by amount, description, or date; naturally idempotent (a row this
-- migration fixes no longer matches financial_account_id is null, so a second run changes zero
-- additional rows -- no separate repair marker needed, unlike the unit-scaling repair, because
-- "already has a financial_account_id" is itself the complete idempotency signal here); and
-- fail-closed via a row-count ceiling so an unexpectedly large match stops the migration instead
-- of silently rewriting more than intended. Both helper functions are created, used, and dropped
-- within this single migration -- no permanent database API surface is left behind.

create or replace function financial_events_account_id_backfill_qualifying_count()
returns integer
language sql
stable
as $$
  select count(*)::integer
  from financial_events
  where source_system = 'transaction'
    and financial_account_id is null
    and metadata->>'financialAccountId' is not null;
$$;

create or replace function assert_financial_events_account_id_backfill_within_ceiling(p_ceiling integer)
returns integer
language plpgsql
as $$
declare
  v_qualifying_count integer;
begin
  v_qualifying_count := financial_events_account_id_backfill_qualifying_count();

  if v_qualifying_count > p_ceiling then
    raise exception
      'financial_events account-id backfill: % qualifying row(s) exceeds the ceiling of % -- stopping without making any change. This likely means the targeting predicate matched more rows than expected; investigate before re-running.',
      v_qualifying_count, p_ceiling;
  end if;

  raise notice 'financial_events account-id backfill: % qualifying row(s) will be corrected.', v_qualifying_count;
  return v_qualifying_count;
end;
$$;

select assert_financial_events_account_id_backfill_within_ceiling(5000);

update financial_events
set
  financial_account_id = metadata->>'financialAccountId',
  updated_at = now(),
  updated_by = 'system:financial-event-account-id-backfill-2026-09-16'
where source_system = 'transaction'
  and financial_account_id is null
  and metadata->>'financialAccountId' is not null;

drop function if exists assert_financial_events_account_id_backfill_within_ceiling(integer);
drop function if exists financial_events_account_id_backfill_qualifying_count();
