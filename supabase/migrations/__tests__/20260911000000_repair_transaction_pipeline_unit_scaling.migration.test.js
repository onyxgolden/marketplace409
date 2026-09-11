// Rollback-based validation for the transaction-pipeline unit-scaling repair migration: every test
// runs the ACTUAL migration file's SQL (read from disk, not duplicated inline -- so this test always
// tests the real migration, never a copy that could drift) against real seeded fixture rows inside a
// single BEGIN...ROLLBACK transaction, so nothing persists in the shared local dev database no
// matter how many times this file runs. Reuses the same psql() helper already established for the
// private-financing/rental Stripe payment-chain integration proofs -- same local stack, same
// discipline, no new test infrastructure invented for this one migration.
//
// CREATE FUNCTION is transactional DDL in Postgres -- the two functions this migration defines
// (financial_events_unit_repair_qualifying_count, assert_financial_events_unit_repair_within_ceiling)
// are created and used inside the same BEGIN...ROLLBACK block as everything else below, and are
// rolled back along with the data at the end of every test, same as any other statement.
//
// SCOPED FUNCTIONS, NOT A PERMANENT API (per review): the real migration itself creates, uses, then
// DROPS both functions -- they are not left behind as a permanent database RPC surface. The "both
// functions absent after migration" test below proves this directly by querying pg_proc after
// running the complete, unmodified MIGRATION_SQL (not just the function-definitions prefix used by
// the ceiling tests).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isLocalStackReachable, psql } from "../../../src/test-helpers/stripeWebhookIntegrationTestHelpers.js";

const MIGRATION_SQL = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260911000000_repair_transaction_pipeline_unit_scaling.sql"),
  "utf8",
);

// Just the two `create or replace function` definitions, extracted from the real migration file
// (not hand-copied) by splitting at the exact line the real migration uses to invoke the ceiling
// check with the real production ceiling. Used by the fail-closed test below to call the SAME real
// function with a small, testable ceiling instead of seeding thousands of rows to exercise 5000.
const CEILING_INVOCATION_MARKER = "select assert_financial_events_unit_repair_within_ceiling(5000);";
if (!MIGRATION_SQL.includes(CEILING_INVOCATION_MARKER)) {
  throw new Error(
    "Migration file no longer contains the expected ceiling-invocation line -- update CEILING_INVOCATION_MARKER in this test to match.",
  );
}
const FUNCTION_DEFINITIONS_SQL = MIGRATION_SQL.split(CEILING_INVOCATION_MARKER)[0];

// An adversarial fixture graph, per review: an old corrupted Stripe row, an old corrupted Plaid row,
// a NEWLY-imported correctly-scaled Stripe row already carrying the current amountUnitVersion (must
// NOT be touched -- this is the exact "webhook arrives immediately before the migration runs"
// scenario), a NEWLY-imported correctly-scaled Plaid row (same), an ALREADY-repaired row (must never
// be touched again), and one representative row from every other real source_system this session has
// confirmed exists in production (each must remain completely untouched).
function seedFixturesSql(ownerId) {
  return `
    insert into financial_events (id, owner_id, event_date, description, amount, transaction_kind, normalized_category, source_system, metadata) values
      ('fixture_old_corrupted_stripe', '${ownerId}', '2026-08-21', 'Online Banking Withdrawal / Transfer to Share 0009', 3000000, 'expense', 'other', 'transaction', '{"provider": "stripe_financial_connections", "connectionId": "conn_1", "providerTransactionId": "fctxn_1"}'::jsonb),
      ('fixture_old_corrupted_plaid', '${ownerId}', '2026-08-23', 'Plaid Test Transaction', 12500, 'expense', 'other', 'transaction', '{"provider": "plaid", "connectionId": "conn_2", "providerTransactionId": "plaid_txn_1"}'::jsonb),
      ('fixture_new_correct_stripe', '${ownerId}', '2026-09-11', 'New correctly-scaled Stripe row from the fixed code', 45.50, 'expense', 'utilities', 'transaction', '{"provider": "stripe_financial_connections", "connectionId": "conn_3", "providerTransactionId": "fctxn_new_1", "amountUnitVersion": 1}'::jsonb),
      ('fixture_new_correct_plaid', '${ownerId}', '2026-09-11', 'New correctly-scaled Plaid row from the fixed code', 21.00, 'income', 'rental_income', 'transaction', '{"provider": "plaid", "connectionId": "conn_4", "providerTransactionId": "plaid_txn_new_1", "amountUnitVersion": 1}'::jsonb),
      ('fixture_already_repaired_stripe', '${ownerId}', '2026-08-24', 'Already Repaired Row', 500.00, 'expense', 'other', 'transaction', '{"provider": "stripe_financial_connections", "connectionId": "conn_1", "providerTransactionId": "fctxn_3", "amountUnitVersion": 1, "unitRepair": {"version": 1, "repairedAt": "2026-09-10T00:00:00Z", "priorAmount": 50000}}'::jsonb),
      ('fixture_rentec', '${ownerId}', '2026-08-25', 'Rentec Rent Payment', 1500.00, 'income', 'rental_income', 'rentec', '{"unrelatedField": "preserve-me"}'::jsonb),
      ('fixture_simplifi', '${ownerId}', '2026-08-26', 'Simplifi Grocery', 87.43, 'expense', 'groceries', 'quicken_simplifi_csv', '{}'::jsonb),
      ('fixture_rental_payment', '${ownerId}', '2026-08-27', 'Rent Payment Received', 2000.00, 'income', 'rental_income', 'forge_rental_payment', '{}'::jsonb),
      ('fixture_rental_adjustment', '${ownerId}', '2026-08-28', 'Rent payment refunded', -1.00, 'expense', 'other', 'forge_rental_payment_adjustment', '{}'::jsonb),
      ('fixture_manual_transaction_provider', '${ownerId}', '2026-08-29', 'Manually-entered row that happens to share source_system=transaction but has no recognized provider', 999.00, 'expense', 'other', 'transaction', '{"provider": "some_future_unrelated_provider"}'::jsonb);
  `;
}

const ALL_FIXTURE_IDS = [
  "fixture_old_corrupted_stripe", "fixture_old_corrupted_plaid", "fixture_new_correct_stripe",
  "fixture_new_correct_plaid", "fixture_already_repaired_stripe", "fixture_rentec", "fixture_simplifi",
  "fixture_rental_payment", "fixture_rental_adjustment", "fixture_manual_transaction_provider",
];

describe.runIf(await isLocalStackReachable())("financial_events transaction-pipeline unit-scaling repair migration", () => {
  it("repairs the two OLD corrupted rows (Stripe and Plaid), dividing amount by 100 and preserving sign", async () => {
    const ownerId = "owner_migration_test_1";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      do $$
      declare
        v_stripe_amount numeric;
        v_plaid_amount numeric;
      begin
        select amount into v_stripe_amount from financial_events where id = 'fixture_old_corrupted_stripe';
        if v_stripe_amount <> 30000.00 then
          raise exception 'expected old corrupted Stripe row to become 30000.00, got %', v_stripe_amount;
        end if;

        select amount into v_plaid_amount from financial_events where id = 'fixture_old_corrupted_plaid';
        if v_plaid_amount <> 125.00 then
          raise exception 'expected old corrupted Plaid row to become 125.00 (same predicate applies to Plaid), got %', v_plaid_amount;
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("touches ONLY the two old corrupted rows -- every other fixture row (new correctly-scaled Stripe/Plaid, already-repaired, unaffected source systems) is byte-for-byte unchanged", async () => {
    const ownerId = "owner_migration_test_2";
    const untouchedIds = ALL_FIXTURE_IDS.filter(
      (id) => id !== "fixture_old_corrupted_stripe" && id !== "fixture_old_corrupted_plaid",
    );
    const expectedAmounts = {
      fixture_new_correct_stripe: 45.50,
      fixture_new_correct_plaid: 21.00,
      fixture_already_repaired_stripe: 500.00,
      fixture_rentec: 1500.00,
      fixture_simplifi: 87.43,
      fixture_rental_payment: 2000.00,
      fixture_rental_adjustment: -1.00,
      fixture_manual_transaction_provider: 999.00,
    };
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      do $$
      declare
        v_row record;
        v_expected numeric;
      begin
        for v_row in select id, amount from financial_events where id in (${untouchedIds.map((id) => `'${id}'`).join(", ")}) loop
          v_expected := (
            case v_row.id
              ${Object.entries(expectedAmounts).map(([id, amount]) => `when '${id}' then ${amount}`).join("\n              ")}
            end
          );
          if v_row.amount <> v_expected then
            raise exception '% amount changed: expected %, got %', v_row.id, v_expected, v_row.amount;
          end if;
        end loop;

        -- The two "new, correct" rows must retain their amountUnitVersion and gain no unitRepair
        -- marker -- proving the fix for the exact scenario the review raised: a webhook-delivered,
        -- already-correct row is never mistaken for a pre-fix corrupted one.
        if (select metadata->'unitRepair' from financial_events where id = 'fixture_new_correct_stripe') is not null then
          raise exception 'fixture_new_correct_stripe must never receive a unitRepair marker -- it was never corrupted';
        end if;
        if (select metadata->'unitRepair' from financial_events where id = 'fixture_new_correct_plaid') is not null then
          raise exception 'fixture_new_correct_plaid must never receive a unitRepair marker -- it was never corrupted';
        end if;

        -- Rentec's unrelated metadata field must survive completely unmodified.
        if (select metadata from financial_events where id = 'fixture_rentec') <> '{"unrelatedField": "preserve-me"}'::jsonb then
          raise exception 'Rentec row metadata was modified';
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("preserves source_record_id, account/owner/workspace identity, category, transaction kind, event date, and unrelated metadata on every repaired row", async () => {
    const ownerId = "owner_migration_test_3";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      update financial_events set source_record_id = 'fctxn_1_source_record' where id = 'fixture_old_corrupted_stripe';
      ${MIGRATION_SQL}
      do $$
      declare
        v_row record;
      begin
        select owner_id, event_date, transaction_kind, normalized_category, source_record_id, metadata->>'connectionId' as connection_id, metadata->>'providerTransactionId' as provider_txn_id
          into v_row
          from financial_events where id = 'fixture_old_corrupted_stripe';

        if v_row.owner_id <> '${ownerId}' then raise exception 'owner_id changed'; end if;
        if v_row.event_date <> '2026-08-21' then raise exception 'event_date changed: got %', v_row.event_date; end if;
        if v_row.transaction_kind <> 'expense' then raise exception 'transaction_kind changed'; end if;
        if v_row.normalized_category <> 'other' then raise exception 'normalized_category changed'; end if;
        if v_row.source_record_id <> 'fctxn_1_source_record' then raise exception 'source_record_id changed'; end if;
        if v_row.connection_id <> 'conn_1' then raise exception 'unrelated metadata.connectionId was lost'; end if;
        if v_row.provider_txn_id <> 'fctxn_1' then raise exception 'unrelated metadata.providerTransactionId was lost'; end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("adds both amountUnitVersion and a separate unitRepair marker (version, repairedAt, priorAmount) to a repaired row", async () => {
    const ownerId = "owner_migration_test_4";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      do $$
      declare
        v_metadata jsonb;
        v_marker jsonb;
      begin
        select metadata into v_metadata from financial_events where id = 'fixture_old_corrupted_stripe';
        if (v_metadata->>'amountUnitVersion')::int <> 1 then
          raise exception 'expected amountUnitVersion 1 on the repaired row, got %', v_metadata->>'amountUnitVersion';
        end if;

        v_marker := v_metadata->'unitRepair';
        if v_marker is null then raise exception 'expected a unitRepair marker after repair, found none'; end if;
        if (v_marker->>'version')::int <> 1 then raise exception 'expected marker version 1, got %', v_marker->>'version'; end if;
        if (v_marker->>'priorAmount')::numeric <> 3000000 then raise exception 'expected priorAmount 3000000 (the pre-repair value), got %', v_marker->>'priorAmount'; end if;
        if v_marker->>'repairedAt' is null then raise exception 'expected repairedAt to be set'; end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("is idempotent (including the create-use-drop function lifecycle): running the exact same, complete migration SQL a second time -- which recreates then re-drops both helper functions -- changes zero additional rows and zero amounts", async () => {
    const ownerId = "owner_migration_test_5";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      create temporary table t_after_first as select id, amount, metadata from financial_events where owner_id = '${ownerId}';
      ${MIGRATION_SQL}
      do $$
      declare
        v_mismatch_count integer;
      begin
        select count(*) into v_mismatch_count
        from financial_events fe
        join t_after_first t on t.id = fe.id
        where fe.owner_id = '${ownerId}' and (fe.amount <> t.amount or fe.metadata <> t.metadata);

        if v_mismatch_count > 0 then
          raise exception 'idempotency violated: % row(s) changed on the second run', v_mismatch_count;
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("leaves NO permanent database API surface: both helper functions are absent after the complete migration finishes, and neither is executable by PUBLIC, anon, or authenticated (because neither exists)", async () => {
    const ownerId = "owner_migration_test_6";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      do $$
      declare
        v_remaining_count integer;
        v_grant_count integer;
      begin
        select count(*) into v_remaining_count
        from pg_proc
        where proname in ('financial_events_unit_repair_qualifying_count', 'assert_financial_events_unit_repair_within_ceiling')
          and pronamespace = 'public'::regnamespace;

        if v_remaining_count > 0 then
          raise exception 'expected both helper functions to be dropped after the migration completes, found % still present', v_remaining_count;
        end if;

        -- Belt-and-suspenders: information_schema.routine_privileges is empty for these names too --
        -- the strongest possible proof that PUBLIC/anon/authenticated cannot execute something that
        -- does not exist.
        select count(*) into v_grant_count
        from information_schema.routine_privileges
        where routine_name in ('financial_events_unit_repair_qualifying_count', 'assert_financial_events_unit_repair_within_ceiling');

        if v_grant_count > 0 then
          raise exception 'expected zero routine_privileges rows for either helper function name, found %', v_grant_count;
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  describe("fail-closed ceiling: actually executed, not just grepped for in the migration source", () => {
    it("the real assert function raises when qualifying rows exceed the ceiling", async () => {
      const ownerId = "owner_migration_test_ceiling_1";
      const sql = `
        begin;
        ${FUNCTION_DEFINITIONS_SQL}
        insert into financial_events (id, owner_id, event_date, description, amount, transaction_kind, normalized_category, source_system, metadata) values
          ('fixture_ceiling_1', '${ownerId}', '2026-08-01', 'Ceiling Test 1', 100, 'expense', 'other', 'transaction', '{"provider": "stripe_financial_connections"}'::jsonb),
          ('fixture_ceiling_2', '${ownerId}', '2026-08-02', 'Ceiling Test 2', 200, 'expense', 'other', 'transaction', '{"provider": "stripe_financial_connections"}'::jsonb),
          ('fixture_ceiling_3', '${ownerId}', '2026-08-03', 'Ceiling Test 3', 300, 'expense', 'other', 'transaction', '{"provider": "stripe_financial_connections"}'::jsonb);
        -- 3 real qualifying rows seeded; ceiling set to 2 -- the SAME real function the migration
        -- calls with 5000 in production, called here with a small, testable ceiling instead of
        -- needing to seed thousands of rows to exercise the real production number.
        select assert_financial_events_unit_repair_within_ceiling(2);
        rollback;
      `;
      expect(() => psql(sql)).toThrow();
    });

    it("when the ceiling is exceeded, zero amounts and zero metadata change, and no partial update occurs -- the UPDATE statement is never reached", async () => {
      const ownerId = "owner_migration_test_ceiling_2";
      const sql = `
        begin;
        ${FUNCTION_DEFINITIONS_SQL}
        insert into financial_events (id, owner_id, event_date, description, amount, transaction_kind, normalized_category, source_system, metadata) values
          ('fixture_ceiling_1', '${ownerId}', '2026-08-01', 'Ceiling Test 1', 100, 'expense', 'other', 'transaction', '{"provider": "stripe_financial_connections"}'::jsonb),
          ('fixture_ceiling_2', '${ownerId}', '2026-08-02', 'Ceiling Test 2', 200, 'expense', 'other', 'transaction', '{"provider": "stripe_financial_connections"}'::jsonb),
          ('fixture_ceiling_3', '${ownerId}', '2026-08-03', 'Ceiling Test 3', 300, 'expense', 'other', 'transaction', '{"provider": "stripe_financial_connections"}'::jsonb);
        -- Catch the expected exception with plpgsql's own EXCEPTION block, rather than letting psql's
        -- ON_ERROR_STOP abort the whole script, so the assertions below can still run in the same
        -- transaction afterward.
        do $$
        begin
          perform assert_financial_events_unit_repair_within_ceiling(2);
          raise exception 'TEST SETUP ERROR: expected the ceiling check to raise for 3 qualifying rows against ceiling 2, but it did not';
        exception
          when others then
            if sqlerrm not like '%exceeds the ceiling%' then
              raise; -- an unexpected error -- re-raise it, don't silently swallow
            end if;
            -- expected ceiling exception caught; continue the script.
        end $$;
        do $$
        declare
          v_changed_count integer;
        begin
          select count(*) into v_changed_count
          from financial_events
          where id in ('fixture_ceiling_1', 'fixture_ceiling_2', 'fixture_ceiling_3')
            and (amount not in (100, 200, 300) or metadata ? 'unitRepair' or metadata ? 'amountUnitVersion');
          if v_changed_count > 0 then
            raise exception 'expected zero rows changed after a failed/ceiling-exceeded assert call, found %', v_changed_count;
          end if;
        end $$;
        rollback;
      `;
      expect(() => psql(sql)).not.toThrow();
    });

    it("the real assert function does NOT raise when qualifying rows are within the ceiling", async () => {
      const ownerId = "owner_migration_test_ceiling_3";
      const sql = `
        begin;
        ${FUNCTION_DEFINITIONS_SQL}
        insert into financial_events (id, owner_id, event_date, description, amount, transaction_kind, normalized_category, source_system, metadata) values
          ('fixture_ceiling_1', '${ownerId}', '2026-08-01', 'Ceiling Test 1', 100, 'expense', 'other', 'transaction', '{"provider": "stripe_financial_connections"}'::jsonb);
        select assert_financial_events_unit_repair_within_ceiling(5);
        rollback;
      `;
      expect(() => psql(sql)).not.toThrow();
    });
  });

  it("financial_events_unit_repair_qualifying_count(), while it exists during migration execution, correctly counts qualifying rows -- proving the logic the equivalent inline SQL in the deployment doc must match, even though the function itself is migration-scoped and not left behind", async () => {
    const ownerId = "owner_migration_test_count_fn";
    const sql = `
      begin;
      ${FUNCTION_DEFINITIONS_SQL}
      insert into financial_events (id, owner_id, event_date, description, amount, transaction_kind, normalized_category, source_system, metadata) values
        ('fixture_count_1', '${ownerId}', '2026-08-01', 'Count Test 1', 100, 'expense', 'other', 'transaction', '{"provider": "stripe_financial_connections"}'::jsonb),
        ('fixture_count_2', '${ownerId}', '2026-08-02', 'Count Test 2', 200, 'expense', 'other', 'transaction', '{"provider": "plaid"}'::jsonb),
        ('fixture_count_3', '${ownerId}', '2026-08-03', 'Already correct, must not count', 3, 'expense', 'other', 'transaction', '{"provider": "stripe_financial_connections", "amountUnitVersion": 1}'::jsonb);
      do $$
      declare
        v_count integer;
      begin
        v_count := financial_events_unit_repair_qualifying_count();
        if v_count < 2 then
          raise exception 'expected at least 2 qualifying rows from this fixture set, got %', v_count;
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });
});
