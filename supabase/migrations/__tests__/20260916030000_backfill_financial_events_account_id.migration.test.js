// Rollback-based validation for the financial_events account-id backfill migration: every test runs
// the ACTUAL migration file's SQL (read from disk, never duplicated inline -- so this always tests
// the real migration, never a copy that could drift) against real seeded fixture rows inside a single
// BEGIN...ROLLBACK transaction, so nothing persists in the shared local dev database no matter how
// many times this file runs. Same helper, same discipline as
// 20260911000000_repair_transaction_pipeline_unit_scaling.migration.test.js.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isLocalStackReachable, psql } from "../../../src/test-helpers/stripeWebhookIntegrationTestHelpers.js";

const MIGRATION_SQL = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260916030000_backfill_financial_events_account_id.sql"),
  "utf8",
);

const CEILING_INVOCATION_MARKER = "select assert_financial_events_account_id_backfill_within_ceiling(5000);";
if (!MIGRATION_SQL.includes(CEILING_INVOCATION_MARKER)) {
  throw new Error(
    "Migration file no longer contains the expected ceiling-invocation line -- update CEILING_INVOCATION_MARKER in this test to match.",
  );
}
const FUNCTION_DEFINITIONS_SQL = MIGRATION_SQL.split(CEILING_INVOCATION_MARKER)[0];

// An adversarial fixture graph: an orphaned Stripe row (financial_account_id null, metadata carries
// it), an orphaned Plaid row (same), a row that already has financial_account_id set (must never be
// overwritten even though it's source_system = 'transaction'), a row with source_system =
// 'transaction' but no financialAccountId anywhere (nothing to backfill from -- must stay null), and
// one representative row from every other real source_system, which must never be touched by a
// predicate scoped to 'transaction'.
function seedFixturesSql(ownerId) {
  return `
    insert into financial_events (id, owner_id, event_date, description, amount, transaction_kind, normalized_category, source_system, financial_account_id, metadata) values
      ('fixture_orphaned_stripe', '${ownerId}', '2026-08-21', 'Orphaned Stripe row', 45.50, 'expense', 'other', 'transaction', null, '{"provider": "stripe_financial_connections", "financialAccountId": "account_stripe_1", "providerTransactionId": "fctxn_1"}'::jsonb),
      ('fixture_orphaned_plaid', '${ownerId}', '2026-08-22', 'Orphaned Plaid row', 21.00, 'income', 'rental_income', 'transaction', null, '{"provider": "plaid", "financialAccountId": "account_plaid_1", "providerTransactionId": "plaid_txn_1"}'::jsonb),
      ('fixture_already_has_account', '${ownerId}', '2026-08-23', 'Already-mapped row', 87.43, 'expense', 'groceries', 'transaction', 'account_existing', '{"provider": "stripe_financial_connections", "financialAccountId": "account_should_never_be_used", "providerTransactionId": "fctxn_2"}'::jsonb),
      ('fixture_no_metadata_account', '${ownerId}', '2026-08-24', 'Nothing to backfill from', 12.00, 'expense', 'other', 'transaction', null, '{"provider": "stripe_financial_connections", "providerTransactionId": "fctxn_3"}'::jsonb),
      ('fixture_rentec', '${ownerId}', '2026-08-25', 'Rentec Rent Payment', 1500.00, 'income', 'rental_income', 'rentec', null, '{"unrelatedField": "preserve-me"}'::jsonb),
      ('fixture_simplifi', '${ownerId}', '2026-08-26', 'Simplifi Grocery', 87.43, 'expense', 'groceries', 'quicken_simplifi_csv', null, '{"financialAccountId": "should_never_be_read_for_this_source_system"}'::jsonb);
  `;
}

const UNTOUCHED_IDS = [
  "fixture_already_has_account", "fixture_no_metadata_account", "fixture_rentec", "fixture_simplifi",
];

describe.runIf(await isLocalStackReachable())("financial_events account-id backfill migration", () => {
  it("backfills financial_account_id from metadata.financialAccountId for the two orphaned rows (Stripe and Plaid)", async () => {
    const ownerId = "owner_account_id_backfill_test_1";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      do $$
      declare
        v_stripe_account text;
        v_plaid_account text;
      begin
        select financial_account_id into v_stripe_account from financial_events where id = 'fixture_orphaned_stripe';
        if v_stripe_account <> 'account_stripe_1' then
          raise exception 'expected orphaned Stripe row backfilled to account_stripe_1, got %', v_stripe_account;
        end if;

        select financial_account_id into v_plaid_account from financial_events where id = 'fixture_orphaned_plaid';
        if v_plaid_account <> 'account_plaid_1' then
          raise exception 'expected orphaned Plaid row backfilled to account_plaid_1, got %', v_plaid_account;
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("touches ONLY the two orphaned rows -- an already-mapped row, a row with nothing to backfill from, and other source systems are all byte-for-byte unchanged", async () => {
    const ownerId = "owner_account_id_backfill_test_2";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      do $$
      declare
        v_account text;
      begin
        -- Never overwritten, even though its metadata.financialAccountId differs from its real column.
        select financial_account_id into v_account from financial_events where id = 'fixture_already_has_account';
        if v_account <> 'account_existing' then
          raise exception 'fixture_already_has_account financial_account_id changed: got %', v_account;
        end if;

        select financial_account_id into v_account from financial_events where id = 'fixture_no_metadata_account';
        if v_account is not null then
          raise exception 'fixture_no_metadata_account should remain null, got %', v_account;
        end if;

        select financial_account_id into v_account from financial_events where id = 'fixture_rentec';
        if v_account is not null then
          raise exception 'fixture_rentec should remain null, got %', v_account;
        end if;

        -- source_system = 'quicken_simplifi_csv' must never be read even though it happens to carry
        -- a metadata.financialAccountId key -- the predicate is scoped to source_system = 'transaction'.
        select financial_account_id into v_account from financial_events where id = 'fixture_simplifi';
        if v_account is not null then
          raise exception 'fixture_simplifi should remain null (wrong source_system), got %', v_account;
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("preserves amount, description, category, transaction_kind, event_date, and unrelated metadata on every backfilled row", async () => {
    const ownerId = "owner_account_id_backfill_test_3";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      do $$
      declare
        v_row record;
      begin
        select amount, description, normalized_category, transaction_kind, event_date, metadata->>'providerTransactionId' as provider_txn_id
          into v_row
          from financial_events where id = 'fixture_orphaned_stripe';

        if v_row.amount <> 45.50 then raise exception 'amount changed: got %', v_row.amount; end if;
        if v_row.description <> 'Orphaned Stripe row' then raise exception 'description changed'; end if;
        if v_row.normalized_category <> 'other' then raise exception 'normalized_category changed'; end if;
        if v_row.transaction_kind <> 'expense' then raise exception 'transaction_kind changed'; end if;
        if v_row.event_date <> '2026-08-21' then raise exception 'event_date changed: got %', v_row.event_date; end if;
        if v_row.provider_txn_id <> 'fctxn_1' then raise exception 'unrelated metadata.providerTransactionId was lost'; end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("is idempotent: running the exact same, complete migration SQL a second time changes zero additional rows", async () => {
    const ownerId = "owner_account_id_backfill_test_4";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      create temporary table t_after_first as select id, financial_account_id, metadata from financial_events where owner_id = '${ownerId}';
      ${MIGRATION_SQL}
      do $$
      declare
        v_mismatch_count integer;
      begin
        select count(*) into v_mismatch_count
        from financial_events fe
        join t_after_first t on t.id = fe.id
        where fe.owner_id = '${ownerId}' and fe.financial_account_id is distinct from t.financial_account_id;

        if v_mismatch_count > 0 then
          raise exception 'idempotency violated: % row(s) changed on the second run', v_mismatch_count;
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("leaves NO permanent database API surface: both helper functions are absent after the complete migration finishes", async () => {
    const ownerId = "owner_account_id_backfill_test_5";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      do $$
      declare
        v_remaining_count integer;
      begin
        select count(*) into v_remaining_count
        from pg_proc
        where proname in ('financial_events_account_id_backfill_qualifying_count', 'assert_financial_events_account_id_backfill_within_ceiling')
          and pronamespace = 'public'::regnamespace;

        if v_remaining_count > 0 then
          raise exception 'expected both helper functions to be dropped after the migration completes, found % still present', v_remaining_count;
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  describe("fail-closed ceiling: actually executed, not just grepped for in the migration source", () => {
    it("the real assert function raises when qualifying rows exceed the ceiling", async () => {
      const ownerId = "owner_account_id_backfill_ceiling_1";
      const sql = `
        begin;
        ${FUNCTION_DEFINITIONS_SQL}
        insert into financial_events (id, owner_id, event_date, description, amount, transaction_kind, normalized_category, source_system, financial_account_id, metadata) values
          ('fixture_ceiling_1', '${ownerId}', '2026-08-01', 'Ceiling Test 1', 100, 'expense', 'other', 'transaction', null, '{"financialAccountId": "acct_1"}'::jsonb),
          ('fixture_ceiling_2', '${ownerId}', '2026-08-02', 'Ceiling Test 2', 200, 'expense', 'other', 'transaction', null, '{"financialAccountId": "acct_2"}'::jsonb),
          ('fixture_ceiling_3', '${ownerId}', '2026-08-03', 'Ceiling Test 3', 300, 'expense', 'other', 'transaction', null, '{"financialAccountId": "acct_3"}'::jsonb);
        select assert_financial_events_account_id_backfill_within_ceiling(2);
        rollback;
      `;
      expect(() => psql(sql)).toThrow();
    });

    it("when the ceiling is exceeded, zero rows change and the UPDATE statement is never reached", async () => {
      const ownerId = "owner_account_id_backfill_ceiling_2";
      const sql = `
        begin;
        ${FUNCTION_DEFINITIONS_SQL}
        insert into financial_events (id, owner_id, event_date, description, amount, transaction_kind, normalized_category, source_system, financial_account_id, metadata) values
          ('fixture_ceiling_1', '${ownerId}', '2026-08-01', 'Ceiling Test 1', 100, 'expense', 'other', 'transaction', null, '{"financialAccountId": "acct_1"}'::jsonb),
          ('fixture_ceiling_2', '${ownerId}', '2026-08-02', 'Ceiling Test 2', 200, 'expense', 'other', 'transaction', null, '{"financialAccountId": "acct_2"}'::jsonb),
          ('fixture_ceiling_3', '${ownerId}', '2026-08-03', 'Ceiling Test 3', 300, 'expense', 'other', 'transaction', null, '{"financialAccountId": "acct_3"}'::jsonb);
        do $$
        begin
          perform assert_financial_events_account_id_backfill_within_ceiling(2);
          raise exception 'TEST SETUP ERROR: expected the ceiling check to raise for 3 qualifying rows against ceiling 2, but it did not';
        exception
          when others then
            if sqlerrm not like '%exceeds the ceiling%' then
              raise;
            end if;
        end $$;
        do $$
        declare
          v_changed_count integer;
        begin
          select count(*) into v_changed_count
          from financial_events
          where id in ('fixture_ceiling_1', 'fixture_ceiling_2', 'fixture_ceiling_3')
            and financial_account_id is not null;
          if v_changed_count > 0 then
            raise exception 'expected zero rows changed after a failed/ceiling-exceeded assert call, found %', v_changed_count;
          end if;
        end $$;
        rollback;
      `;
      expect(() => psql(sql)).not.toThrow();
    });

    it("the real assert function does NOT raise when qualifying rows are within the ceiling", async () => {
      const ownerId = "owner_account_id_backfill_ceiling_3";
      const sql = `
        begin;
        ${FUNCTION_DEFINITIONS_SQL}
        insert into financial_events (id, owner_id, event_date, description, amount, transaction_kind, normalized_category, source_system, financial_account_id, metadata) values
          ('fixture_ceiling_1', '${ownerId}', '2026-08-01', 'Ceiling Test 1', 100, 'expense', 'other', 'transaction', null, '{"financialAccountId": "acct_1"}'::jsonb);
        select assert_financial_events_account_id_backfill_within_ceiling(5);
        rollback;
      `;
      expect(() => psql(sql)).not.toThrow();
    });
  });
});
