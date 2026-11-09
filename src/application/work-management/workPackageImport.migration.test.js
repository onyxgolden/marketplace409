// Work Package Planner editable grid — migration proof.
//
// Applies the SHIPPED import-tracking migration SQL (read from disk,
// never ad-hoc) in an in-memory PGlite database (real PostgreSQL) and
// proves:
//   - the columns land on both tables;
//   - the pair CHECK: a row carries both source columns or neither;
//   - the unique index (owner_id, source_system, source_record_id):
//     a second import of the same record is refused, the same record
//     under another owner or another system is fine, and rows never
//     imported (both NULL) are unaffected.
//
// The migration is FILE ONLY in this PR — this test proves the file,
// it does not apply anything to production.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = "20261109000000_work_package_import_source_tracking.sql";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

function loadMigrationSql() {
  return readFileSync(join(HERE, "..", "..", "..", "supabase", "migrations", MIGRATION), "utf8");
}

async function setupDb() {
  const db = new PGlite();
  await db.exec(`
    create table forge_work_packages (
      owner_id text not null,
      id text not null,
      status text not null default 'draft',
      primary key (owner_id, id)
    );
    create table forge_work_steps (
      owner_id text not null,
      id text not null,
      work_package_id text not null,
      sequence_no integer not null,
      primary key (owner_id, id)
    );
  `);
  await db.exec(loadMigrationSql());
  return db;
}

let db;
beforeEach(async () => {
  db = await setupDb();
}, 60000);

async function expectError(sql, params, code) {
  let caught = null;
  try {
    await db.query(sql, params);
  } catch (e) {
    caught = e;
  }
  expect(caught).not.toBe(null);
  if (code) expect(String(caught.code || caught.message)).toContain(code);
  return caught;
}

describe("import source tracking migration", () => {
  it("adds the columns and accepts a stamped row", async () => {
    await db.query(
      "insert into forge_work_packages (owner_id, id, source_system, source_record_id) values ($1, $2, 'sap', '1002345')",
      [OWNER_A, "wp_1"],
    );
    const rows = await db.query(
      "select source_system, source_record_id from forge_work_packages where id = 'wp_1'",
    );
    expect(rows.rows[0]).toEqual({ source_system: "sap", source_record_id: "1002345" });
  });

  it("refuses a source record id without its system, and vice versa", async () => {
    await expectError(
      "insert into forge_work_packages (owner_id, id, source_system) values ($1, $2, 'sap')",
      [OWNER_A, "wp_1"],
      "23514",
    );
    await expectError(
      "insert into forge_work_packages (owner_id, id, source_record_id) values ($1, $2, '1002345')",
      [OWNER_A, "wp_2"],
      "23514",
    );
    await expectError(
      "insert into forge_work_steps (owner_id, id, work_package_id, sequence_no, source_record_id) values ($1, $2, 'wp_1', 1, 'WO-88')",
      [OWNER_A, "s_1"],
      "23514",
    );
  });

  it("refuses the same record twice for one owner, allows it for another owner or system", async () => {
    await db.query(
      "insert into forge_work_packages (owner_id, id, source_system, source_record_id) values ($1, $2, 'sap', '1002345')",
      [OWNER_A, "wp_1"],
    );
    await expectError(
      "insert into forge_work_packages (owner_id, id, source_system, source_record_id) values ($1, $2, 'sap', '1002345')",
      [OWNER_A, "wp_2"],
      "23505",
    );
    // Same record, another owner: fine.
    await db.query(
      "insert into forge_work_packages (owner_id, id, source_system, source_record_id) values ($1, $2, 'sap', '1002345')",
      [OWNER_B, "wp_1"],
    );
    // Same record, another system: fine.
    await db.query(
      "insert into forge_work_packages (owner_id, id, source_system, source_record_id) values ($1, $2, 'maximo', '1002345')",
      [OWNER_A, "wp_3"],
    );
    // Rows never imported (both NULL) are unaffected.
    await db.query("insert into forge_work_packages (owner_id, id) values ($1, $2)", [OWNER_A, "wp_4"]);
    await db.query("insert into forge_work_packages (owner_id, id) values ($1, $2)", [OWNER_A, "wp_5"]);
  });

  it("enforces the same uniqueness on steps", async () => {
    await db.query(
      "insert into forge_work_steps (owner_id, id, work_package_id, sequence_no, source_system, source_record_id) values ($1, $2, 'wp_1', 1, 'maximo', 'WO-88')",
      [OWNER_A, "s_1"],
    );
    await expectError(
      "insert into forge_work_steps (owner_id, id, work_package_id, sequence_no, source_system, source_record_id) values ($1, $2, 'wp_1', 2, 'maximo', 'WO-88')",
      [OWNER_A, "s_2"],
      "23505",
    );
    // Another step, another record: fine.
    await db.query(
      "insert into forge_work_steps (owner_id, id, work_package_id, sequence_no, source_system, source_record_id) values ($1, $2, 'wp_1', 2, 'maximo', 'WO-89')",
      [OWNER_A, "s_2"],
    );
  });
});
