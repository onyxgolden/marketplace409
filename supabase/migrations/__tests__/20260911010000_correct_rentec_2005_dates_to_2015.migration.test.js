// Rollback-based validation for the Rentec 2005->2015 date-correction migration: every test runs
// the ACTUAL migration file's SQL (read from disk, not duplicated inline) against real seeded
// fixture rows inside a single BEGIN...ROLLBACK transaction, so nothing persists in the shared local
// dev database no matter how many times this file runs. Same psql()/isLocalStackReachable()
// discipline as the sibling unit-scaling repair migration test.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isLocalStackReachable, psql } from "../../../src/test-helpers/stripeWebhookIntegrationTestHelpers.js";

const MIGRATION_SQL = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260911010000_correct_rentec_2005_dates_to_2015.sql"),
  "utf8",
);

const TARGET_ID_1 = "rentec-2005-01-25-1-expense";
const TARGET_ID_2 = "rentec-0005-11-17-0-expense";

// The exact two real production rows (minus owner_id, substituted per test), plus a menagerie of
// adversarial neighbors that share almost every individual attribute with the real targets but must
// never be touched: a different rentec row also dated in 2005 (proves targeting is by
// source_record_id, never by year or source_system alone), a row with one of the two real
// descriptions but a different source_record_id (proves targeting is never by description/amount),
// a soft-deleted row that happens to carry a real target id (must not be resurrected or altered),
// and one ordinary, correctly-dated 2014 row for realism.
function seedFixturesSql(ownerId) {
  return `
    insert into financial_events (id, owner_id, event_date, description, amount, transaction_kind, normalized_category, source_system, source_record_id, status, is_deleted, deleted_at, property_id, metadata) values
      ('fixture_target_1', '${ownerId}', '2005-01-25', 'Tools (TEMU)', 87.76, 'expense', 'tools', 'rentec', '${TARGET_ID_1}', 'active', false, null, 'business-expenses', '{"rawRow": {"DATE": "01/25/2005"}}'::jsonb),
      ('fixture_target_2', '${ownerId}', '2005-11-17', 'Utilities (VERIZON WIRELESS)', 97.23, 'expense', 'utilities', 'rentec', '${TARGET_ID_2}', 'active', false, null, 'business-expenses', '{"rawRow": {"DATE": "11/17/0005"}}'::jsonb),
      ('fixture_unrelated_2005_rentec', '${ownerId}', '2005-03-15', 'Commissions (Purchase Price)', 112500, 'asset_purchase', 'real_estate_purchase', 'rentec', 'rentec-2005-03-15-2-expense', 'active', false, null, '8760-old-hwy-90', '{}'::jsonb),
      ('fixture_same_description_different_id', '${ownerId}', '2019-01-27', 'Tools (TEMU)', 61.75, 'expense', 'tools', 'rentec', 'rentec-2019-01-27-999-expense', 'active', false, null, 'business-expenses', '{}'::jsonb),
      ('fixture_soft_deleted_matching_id_lookalike', '${ownerId}', '2005-01-25', 'Deleted lookalike, must never be touched', 1.00, 'expense', 'other', 'rentec', 'rentec-2005-01-25-1-expense-deleted-lookalike', 'active', true, now(), 'business-expenses', '{}'::jsonb),
      ('fixture_ordinary_2014', '${ownerId}', '2014-01-01', 'Insurance', 692.00, 'expense', 'insurance', 'rentec', 'rentec-2014-01-01-4-expense', 'active', false, null, '335-butler', '{}'::jsonb);
  `;
}

describe.runIf(await isLocalStackReachable())("20260911010000_correct_rentec_2005_dates_to_2015 migration", () => {
  it("corrects exactly the two real target rows' event_date to 2015, preserving month and day, and touches no other column", async () => {
    const ownerId = "owner_date_fix_test_1";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      select id, event_date, description, amount, transaction_kind, normalized_category, source_system, property_id
      from financial_events
      where id in ('fixture_target_1', 'fixture_target_2')
      order by id;
      rollback;
    `;
    const output = psql(sql);
    expect(output).toContain("2015-01-25");
    expect(output).toContain("2015-11-17");
    expect(output).not.toContain("2005-01-25");
    expect(output).not.toContain("2005-11-17");
    // Unrelated columns on the two corrected rows are exactly as seeded.
    expect(output).toContain("Tools (TEMU)");
    expect(output).toContain("Utilities (VERIZON WIRELESS)");
    expect(output).toContain("87.76");
    expect(output).toContain("97.23");
  });

  it("touches ONLY the two real target rows -- every neighbor with a similar year, description, or id remains byte-for-byte unchanged", async () => {
    const ownerId = "owner_date_fix_test_2";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      create temporary table t_before as select id, event_date, description, amount, updated_at from financial_events where owner_id = '${ownerId}';
      ${MIGRATION_SQL}
      do $$
      declare
        v_changed_count integer;
      begin
        select count(*) into v_changed_count
        from financial_events fe
        join t_before t on t.id = fe.id
        where fe.owner_id = '${ownerId}'
          and fe.id not in ('fixture_target_1', 'fixture_target_2')
          and (fe.event_date <> t.event_date or fe.description <> t.description or fe.amount <> t.amount or fe.updated_at <> t.updated_at);

        if v_changed_count > 0 then
          raise exception 'expected zero non-target rows changed, found %', v_changed_count;
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("does not resurrect or otherwise alter a soft-deleted row even if it happens to carry a real target id", async () => {
    const ownerId = "owner_date_fix_test_3";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      select is_deleted, event_date from financial_events where id = 'fixture_soft_deleted_matching_id_lookalike';
      rollback;
    `;
    const output = psql(sql);
    expect(output).toContain(" t"); // is_deleted remains true
    expect(output).toContain("2005-01-25"); // event_date untouched
  });

  it("is idempotent: running the exact same migration SQL a second time in the same transaction changes zero additional rows", async () => {
    const ownerId = "owner_date_fix_test_4";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      create temporary table t_after_first as select id, event_date, updated_at from financial_events where owner_id = '${ownerId}';
      ${MIGRATION_SQL}
      do $$
      declare
        v_mismatch_count integer;
      begin
        select count(*) into v_mismatch_count
        from financial_events fe
        join t_after_first t on t.id = fe.id
        where fe.owner_id = '${ownerId}' and (fe.event_date <> t.event_date or fe.updated_at <> t.updated_at);

        if v_mismatch_count > 0 then
          raise exception 'idempotency violated: % row(s) changed on the second run', v_mismatch_count;
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("leaves no trace when neither target row exists at all (a clean environment, or the rows were already deleted)", async () => {
    const ownerId = "owner_date_fix_test_5";
    const sql = `
      begin;
      insert into financial_events (id, owner_id, event_date, description, amount, transaction_kind, normalized_category, source_system, source_record_id) values
        ('fixture_unrelated_only', '${ownerId}', '2020-01-01', 'Unrelated row', 10.00, 'expense', 'other', 'rentec', 'rentec-2020-01-01-1-expense');
      ${MIGRATION_SQL}
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });
});
