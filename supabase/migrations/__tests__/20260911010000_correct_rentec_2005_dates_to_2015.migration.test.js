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

const MIGRATION_ID = "20260911010000_correct_rentec_2005_dates_to_2015";
const TARGET_ID_1 = "rentec-2005-01-25-1-expense";
const TARGET_ID_2 = "rentec-0005-11-17-0-expense";

// The exact two real production rows (minus owner_id, substituted per test), plus a menagerie of
// adversarial neighbors that share almost every individual attribute with the real targets but must
// never be touched: a different rentec row also dated in 2005 (proves targeting is by
// source_record_id, never by year or source_system alone), a row with one of the two real
// descriptions but a different source_record_id (proves targeting is never by description/amount),
// a soft-deleted row that happens to carry a LOOKALIKE (not the real) target id, and one ordinary,
// correctly-dated 2014 row for realism. `overrides1`/`overrides2` let individual tests mutate one
// field on a target row (e.g. a wrong amount, or a soft-deleted real target) to exercise the
// fail-closed evidence checks precisely.
function seedFixturesSql(ownerId, { target1 = {}, target2 = {} } = {}) {
  const t1 = {
    id: "fixture_target_1", eventDate: "2005-01-25", description: "Tools (TEMU)", amount: "87.76",
    kind: "expense", category: "tools", sourceSystem: "rentec", sourceRecordId: TARGET_ID_1,
    status: "active", isDeleted: "false", deletedAt: "null", propertyId: "business-expenses",
    metadata: '{"rawRow": {"DATE": "01/25/2005"}}',
    ...target1,
  };
  const t2 = {
    id: "fixture_target_2", eventDate: "2005-11-17", description: "Utilities (VERIZON WIRELESS)", amount: "97.23",
    kind: "expense", category: "utilities", sourceSystem: "rentec", sourceRecordId: TARGET_ID_2,
    status: "active", isDeleted: "false", deletedAt: "null", propertyId: "business-expenses",
    metadata: '{"rawRow": {"DATE": "11/17/0005"}}',
    ...target2,
  };

  function row(r) {
    return `('${r.id}', '${ownerId}', '${r.eventDate}', '${r.description}', ${r.amount}, '${r.kind}', '${r.category}', '${r.sourceSystem}', '${r.sourceRecordId}', '${r.status}', ${r.isDeleted}, ${r.deletedAt}, '${r.propertyId}', '${r.metadata}'::jsonb)`;
  }

  return `
    insert into financial_events (id, owner_id, event_date, description, amount, transaction_kind, normalized_category, source_system, source_record_id, status, is_deleted, deleted_at, property_id, metadata) values
      ${row(t1)},
      ${row(t2)},
      ('fixture_unrelated_2005_rentec', '${ownerId}', '2005-03-15', 'Commissions (Purchase Price)', 112500, 'asset_purchase', 'real_estate_purchase', 'rentec', 'rentec-2005-03-15-2-expense', 'active', false, null, '8760-old-hwy-90', '{}'::jsonb),
      ('fixture_same_description_different_id', '${ownerId}', '2019-01-27', 'Tools (TEMU)', 61.75, 'expense', 'tools', 'rentec', 'rentec-2019-01-27-999-expense', 'active', false, null, 'business-expenses', '{}'::jsonb),
      ('fixture_soft_deleted_lookalike_id', '${ownerId}', '2005-01-25', 'Deleted lookalike, must never be touched', 1.00, 'expense', 'other', 'rentec', 'rentec-2005-01-25-1-expense-deleted-lookalike', 'active', true, now(), 'business-expenses', '{}'::jsonb),
      ('fixture_ordinary_2014', '${ownerId}', '2014-01-01', 'Insurance', 692.00, 'expense', 'insurance', 'rentec', 'rentec-2014-01-01-4-expense', 'active', false, null, '335-butler', '{}'::jsonb);
  `;
}

describe.runIf(await isLocalStackReachable())("20260911010000_correct_rentec_2005_dates_to_2015 migration", () => {
  it("corrects exactly the two real target rows' event_date to 2015, preserving month and day, and touches no other identifying column", async () => {
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
    expect(output).toContain("Tools (TEMU)");
    expect(output).toContain("Utilities (VERIZON WIRELESS)");
    expect(output).toContain("87.76");
    expect(output).toContain("97.23");
  });

  it("writes a complete dateRepair audit record on each corrected row: original date, corrected date, reason, migration id, version, and a repair timestamp", async () => {
    const ownerId = "owner_date_fix_test_audit";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      select
        id,
        metadata->'dateRepair'->>'version' as repair_version,
        metadata->'dateRepair'->>'migrationId' as migration_id,
        metadata->'dateRepair'->>'reason' as reason,
        metadata->'dateRepair'->>'originalEventDate' as original_event_date,
        metadata->'dateRepair'->>'correctedEventDate' as corrected_event_date,
        (metadata->'dateRepair'->>'repairedAt') is not null as has_repaired_at
      from financial_events
      where id in ('fixture_target_1', 'fixture_target_2')
      order by id;
      rollback;
    `;
    const output = psql(sql);
    expect(output).toContain("manually entered year predates use of the source application");
    expect(output).toContain(MIGRATION_ID);
    expect(output).toContain("2005-01-25");
    expect(output).toContain("2015-01-25");
    expect(output).toContain("2005-11-17");
    expect(output).toContain("2015-11-17");
    // repair_version = 1 appears (as text) and has_repaired_at is true for both rows.
    const trueCount = (output.match(/\bt\b/g) || []).length;
    expect(trueCount).toBeGreaterThanOrEqual(2);
  });

  it("touches ONLY the two real target rows -- every neighbor with a similar year, description, or id remains byte-for-byte unchanged, including its metadata", async () => {
    const ownerId = "owner_date_fix_test_2";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      create temporary table t_before as select id, event_date, description, amount, metadata, updated_at from financial_events where owner_id = '${ownerId}';
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
          and (fe.event_date <> t.event_date or fe.description <> t.description or fe.amount <> t.amount or fe.metadata <> t.metadata or fe.updated_at <> t.updated_at);

        if v_changed_count > 0 then
          raise exception 'expected zero non-target rows changed, found %', v_changed_count;
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("fails closed and changes nothing at all when a target source_record_id belongs to a soft-deleted (inactive) row", async () => {
    const ownerId = "owner_date_fix_test_deleted";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId, { target1: { isDeleted: "true", deletedAt: "now()" } })}
      ${MIGRATION_SQL}
      rollback;
    `;
    expect(() => psql(sql)).toThrow(/is not an active record/);
  });

  it("fails closed and changes nothing at all when a target row's amount no longer matches the reviewed evidence", async () => {
    const ownerId = "owner_date_fix_test_amount_drift";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId, { target2: { amount: "999.99" } })}
      ${MIGRATION_SQL}
      rollback;
    `;
    expect(() => psql(sql)).toThrow(/no longer matches the reviewed evidence/);
  });

  it("fails closed and changes nothing at all when a target row's description no longer matches the reviewed evidence", async () => {
    const ownerId = "owner_date_fix_test_description_drift";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId, { target1: { description: "Tools (Something Else Entirely)" } })}
      ${MIGRATION_SQL}
      rollback;
    `;
    expect(() => psql(sql)).toThrow(/no longer matches the reviewed evidence/);
  });

  it("fails closed and changes nothing at all when a target row's event_date is neither the reviewed original nor this migration's own corrected date", async () => {
    const ownerId = "owner_date_fix_test_date_drift";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId, { target1: { eventDate: "2020-06-01" } })}
      ${MIGRATION_SQL}
      rollback;
    `;
    expect(() => psql(sql)).toThrow(/unexpected event_date/);
  });

  it("fails closed when either target row does not exist at all -- never silently no-ops on a missing row", async () => {
    const ownerId = "owner_date_fix_test_missing_row";
    const sql = `
      begin;
      insert into financial_events (id, owner_id, event_date, description, amount, transaction_kind, normalized_category, source_system, source_record_id) values
        ('fixture_unrelated_only', '${ownerId}', '2020-01-01', 'Unrelated row', 10.00, 'expense', 'other', 'rentec', 'rentec-2020-01-01-1-expense');
      ${MIGRATION_SQL}
      rollback;
    `;
    expect(() => psql(sql)).toThrow(/not found/);
  });

  it("does not resurrect or otherwise alter a soft-deleted row that merely LOOKS like a target id but is not one", async () => {
    const ownerId = "owner_date_fix_test_3";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      select is_deleted, event_date from financial_events where id = 'fixture_soft_deleted_lookalike_id';
      rollback;
    `;
    const output = psql(sql);
    expect(output).toContain(" t"); // is_deleted remains true
    expect(output).toContain("2005-01-25"); // event_date untouched
  });

  it("is idempotent: running the exact same migration SQL a second time in the same transaction changes zero additional rows, including the audit record's own repairedAt timestamp", async () => {
    const ownerId = "owner_date_fix_test_4";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      create temporary table t_after_first as select id, event_date, metadata, updated_at from financial_events where owner_id = '${ownerId}';
      ${MIGRATION_SQL}
      do $$
      declare
        v_mismatch_count integer;
      begin
        select count(*) into v_mismatch_count
        from financial_events fe
        join t_after_first t on t.id = fe.id
        where fe.owner_id = '${ownerId}' and (fe.event_date <> t.event_date or fe.metadata <> t.metadata or fe.updated_at <> t.updated_at);

        if v_mismatch_count > 0 then
          raise exception 'idempotency violated: % row(s) changed on the second run (including the dateRepair audit record, which must never re-fire)', v_mismatch_count;
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });

  it("retains the original dateRepair audit record's exact repairedAt value across a second run -- the timestamp does not silently advance", async () => {
    const ownerId = "owner_date_fix_test_audit_stable";
    const sql = `
      begin;
      ${seedFixturesSql(ownerId)}
      ${MIGRATION_SQL}
      create temporary table t_first_audit as
        select id, metadata->'dateRepair'->>'repairedAt' as repaired_at from financial_events where id in ('fixture_target_1', 'fixture_target_2');
      ${MIGRATION_SQL}
      do $$
      declare
        v_mismatch_count integer;
      begin
        select count(*) into v_mismatch_count
        from financial_events fe
        join t_first_audit t on t.id = fe.id
        where fe.metadata->'dateRepair'->>'repairedAt' <> t.repaired_at;

        if v_mismatch_count > 0 then
          raise exception 'dateRepair.repairedAt changed on the second run for % row(s) -- it must be written once and never touched again', v_mismatch_count;
        end if;
      end $$;
      rollback;
    `;
    expect(() => psql(sql)).not.toThrow();
  });
});
