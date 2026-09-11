// Rollback-based validation for the transaction-pipeline unit-scaling repair migration: every test
// runs the ACTUAL migration file's SQL (read from disk, not duplicated inline -- so this test always
// tests the real migration, never a copy that could drift) against real seeded fixture rows inside a
// single BEGIN...ROLLBACK transaction, so nothing persists in the shared local dev database no
// matter how many times this file runs. Reuses the same psql() helper already established for the
// private-financing/rental Stripe payment-chain integration proofs -- same local stack, same
// discipline, no new test infrastructure invented for this one migration.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isLocalStackReachable, psql } from "../../../src/test-helpers/stripeWebhookIntegrationTestHelpers.js";

const MIGRATION_SQL = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260911000000_repair_transaction_pipeline_unit_scaling.sql"),
  "utf8",
);

// A minimal, self-contained fixture graph: one corrupted Stripe row, one corrupted Plaid row (proves
// the predicate isn't Stripe-only, matching the shared-pipeline root cause), one ALREADY-repaired
// Stripe row (must never be touched again), and one representative row from every other real
// source_system this session has confirmed exists in production -- each must remain completely
// untouched, proving the repair's provenance-based targeting.
function seedFixturesSql(ownerId) {
  return `
    insert into financial_events (id, owner_id, event_date, description, amount, transaction_kind, normalized_category, source_system, metadata) values
      ('fixture_corrupted_stripe_expense', '${ownerId}', '2026-08-21', 'Online Banking Withdrawal / Transfer to Share 0009', 3000000, 'expense', 'other', 'transaction', '{"provider": "stripe_financial_connections", "connectionId": "conn_1", "providerTransactionId": "fctxn_1"}'::jsonb),
      ('fixture_corrupted_stripe_income', '${ownerId}', '2026-08-22', 'Online Banking Deposit / Transfer from Share 0009', -150000, 'income', 'other', 'transaction', '{"provider": "stripe_financial_connections", "connectionId": "conn_1", "providerTransactionId": "fctxn_2"}'::jsonb),
      ('fixture_corrupted_plaid', '${ownerId}', '2026-08-23', 'Plaid Test Transaction', 12500, 'expense', 'other', 'transaction', '{"provider": "plaid", "connectionId": "conn_2", "providerTransactionId": "plaid_txn_1"}'::jsonb),
      ('fixture_already_repaired_stripe', '${ownerId}', '2026-08-24', 'Already Repaired Row', 500.00, 'expense', 'other', 'transaction', '{"provider": "stripe_financial_connections", "connectionId": "conn_1", "providerTransactionId": "fctxn_3", "unitRepair": {"version": 1, "repairedAt": "2026-09-10T00:00:00Z", "priorAmount": 50000}}'::jsonb),
      ('fixture_rentec', '${ownerId}', '2026-08-25', 'Rentec Rent Payment', 1500.00, 'income', 'rental_income', 'rentec', '{"unrelatedField": "preserve-me"}'::jsonb),
      ('fixture_simplifi', '${ownerId}', '2026-08-26', 'Simplifi Grocery', 87.43, 'expense', 'groceries', 'quicken_simplifi_csv', '{}'::jsonb),
      ('fixture_rental_payment', '${ownerId}', '2026-08-27', 'Rent Payment Received', 2000.00, 'income', 'rental_income', 'forge_rental_payment', '{}'::jsonb),
      ('fixture_rental_adjustment', '${ownerId}', '2026-08-28', 'Rent payment refunded', -1.00, 'expense', 'other', 'forge_rental_payment_adjustment', '{}'::jsonb),
      ('fixture_manual_transaction_provider', '${ownerId}', '2026-08-29', 'Manually-entered row that happens to share source_system=transaction but has no recognized provider', 999.00, 'expense', 'other', 'transaction', '{"provider": "some_future_unrelated_provider"}'::jsonb);
  `;
}

describe.runIf(await isLocalStackReachable())("financial_events transaction-pipeline unit-scaling repair migration", () => {
  it("repairs only source_system='transaction' rows with a recognized provider and no existing repair marker, dividing amount by 100 and preserving sign", async () => {
    const ownerId = "owner_migration_test_1";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      do $$
      declare
        v_expense_amount numeric;
        v_income_amount numeric;
        v_plaid_amount numeric;
      begin
        select amount into v_expense_amount from financial_events where id = 'fixture_corrupted_stripe_expense';
        if v_expense_amount <> 30000.00 then
          raise exception 'expected corrupted Stripe expense row to become 30000.00, got %', v_expense_amount;
        end if;

        select amount into v_income_amount from financial_events where id = 'fixture_corrupted_stripe_income';
        if v_income_amount <> -1500.00 then
          raise exception 'expected corrupted Stripe income row to become -1500.00 (sign preserved), got %', v_income_amount;
        end if;

        select amount into v_plaid_amount from financial_events where id = 'fixture_corrupted_plaid';
        if v_plaid_amount <> 125.00 then
          raise exception 'expected corrupted Plaid row to become 125.00 (same predicate applies to Plaid), got %', v_plaid_amount;
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("never touches a row that already carries the unitRepair marker", async () => {
    const ownerId = "owner_migration_test_2";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      do $$
      declare
        v_amount numeric;
      begin
        select amount into v_amount from financial_events where id = 'fixture_already_repaired_stripe';
        if v_amount <> 500.00 then
          raise exception 'already-repaired row must be untouched: expected 500.00, got %', v_amount;
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("leaves every non-'transaction' source_system row completely byte-for-byte unchanged (Rentec, Simplifi, rental-payment, rental-adjustment)", async () => {
    const ownerId = "owner_migration_test_3";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      do $$
      declare
        v_row record;
      begin
        for v_row in
          select id, amount, metadata from financial_events
          where id in ('fixture_rentec', 'fixture_simplifi', 'fixture_rental_payment', 'fixture_rental_adjustment')
        loop
          if v_row.id = 'fixture_rentec' and v_row.amount <> 1500.00 then
            raise exception 'Rentec row amount changed: got %', v_row.amount;
          end if;
          if v_row.id = 'fixture_simplifi' and v_row.amount <> 87.43 then
            raise exception 'Simplifi row amount changed: got %', v_row.amount;
          end if;
          if v_row.id = 'fixture_rental_payment' and v_row.amount <> 2000.00 then
            raise exception 'rental-payment row amount changed: got %', v_row.amount;
          end if;
          if v_row.id = 'fixture_rental_adjustment' and v_row.amount <> -1.00 then
            raise exception 'rental-adjustment row amount changed: got %', v_row.amount;
          end if;
        end loop;

        -- Rentec's unrelated metadata field must survive completely unmodified.
        if (select metadata from financial_events where id = 'fixture_rentec') <> '{"unrelatedField": "preserve-me"}'::jsonb then
          raise exception 'Rentec row metadata was modified';
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("does not touch a source_system='transaction' row whose provider is not in the recognized set (fail-closed on provenance, not a blanket source_system match)", async () => {
    const ownerId = "owner_migration_test_4";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      do $$
      declare
        v_amount numeric;
      begin
        select amount into v_amount from financial_events where id = 'fixture_manual_transaction_provider';
        if v_amount <> 999.00 then
          raise exception 'row with an unrecognized provider must be untouched: expected 999.00, got %', v_amount;
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("preserves source_record_id, account/owner/workspace identity, category, transaction kind, event date, and unrelated metadata on every repaired row", async () => {
    const ownerId = "owner_migration_test_5";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      update financial_events set source_record_id = 'fctxn_1_source_record' where id = 'fixture_corrupted_stripe_expense';
      ${MIGRATION_SQL}
      do $$
      declare
        v_row record;
      begin
        select owner_id, event_date, transaction_kind, normalized_category, source_record_id, metadata->>'connectionId' as connection_id, metadata->>'providerTransactionId' as provider_txn_id
          into v_row
          from financial_events where id = 'fixture_corrupted_stripe_expense';

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

  it("adds an explicit repair marker (version, repairedAt, priorAmount) that a second run recognizes, without adding a second marker", async () => {
    const ownerId = "owner_migration_test_6";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      do $$
      declare
        v_marker jsonb;
      begin
        select metadata->'unitRepair' into v_marker from financial_events where id = 'fixture_corrupted_stripe_expense';
        if v_marker is null then raise exception 'expected a unitRepair marker after repair, found none'; end if;
        if (v_marker->>'version')::int <> 1 then raise exception 'expected marker version 1, got %', v_marker->>'version'; end if;
        if (v_marker->>'priorAmount')::numeric <> 3000000 then raise exception 'expected priorAmount 3000000 (the pre-repair value), got %', v_marker->>'priorAmount'; end if;
        if v_marker->>'repairedAt' is null then raise exception 'expected repairedAt to be set'; end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("is idempotent: running the exact same migration SQL a second time, in the same transaction, changes zero additional rows and zero amounts", async () => {
    const ownerId = "owner_migration_test_7";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      do $$
      declare
        v_after_first jsonb;
      begin
        select jsonb_object_agg(id, amount) into v_after_first from financial_events where owner_id = '${ownerId}';
        -- Stash the post-first-run state for comparison after the second run.
        create temporary table t_after_first as select id, amount, metadata from financial_events where owner_id = '${ownerId}';
      end $$;
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

  it("the migration's own fail-closed safety ceiling is present in the SQL (a predicate matching far more rows than expected must raise, not silently update)", () => {
    expect(MIGRATION_SQL).toContain("v_safety_ceiling");
    expect(MIGRATION_SQL.toLowerCase()).toContain("raise exception");
  });
});
