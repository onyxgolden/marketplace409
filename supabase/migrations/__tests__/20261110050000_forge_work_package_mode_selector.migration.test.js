// Work Package Planner mode selector — forge_work_packages.mode migration
// contract, executed against an in-process Postgres (PGlite). Minimal local
// fixture: just the columns this migration touches or reads (owner_id, id,
// package_type) — no RLS/grants to assert, since this migration adds no
// new table, function, or policy (a column add changes no grants).
//
// The migration is FILE ONLY in this PR; applying it to production is a
// separate word (the apply-on-GO standing rule for this PR covers the
// apply itself once merged, not this test).

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const MIGRATION_PATH = new URL("../20261110050000_forge_work_package_mode_selector.sql", import.meta.url);
const migrationSql = readFileSync(MIGRATION_PATH, "utf8");

const SETUP_SQL = `
  create table forge_work_packages (
    owner_id text not null,
    id text not null,
    package_type text not null default 'other',
    primary key (owner_id, id)
  );
`;

// Pre-migration rows, one per package_type family, proving the backfill
// classifies by package_type rather than blanket-defaulting everyone to
// industrial (which would hide the Property field for every real
// commercial-flavored package that exists today — the exact regression
// a plain ADD COLUMN DEFAULT would have caused).
const SEED_SQL = `
  insert into forge_work_packages (owner_id, id, package_type) values
    ('owner_1', 'wp_remodel', 'remodel'),
    ('owner_1', 'wp_rental_turn', 'rental_turn'),
    ('owner_1', 'wp_maintenance', 'maintenance_repair'),
    ('owner_1', 'wp_new_construction', 'new_construction_phase'),
    ('owner_1', 'wp_engineering', 'engineering'),
    ('owner_1', 'wp_industrial', 'industrial'),
    ('owner_1', 'wp_capital', 'capital_project'),
    ('owner_1', 'wp_other', 'other');
`;

let db;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP_SQL);
  await db.exec(SEED_SQL);
  await db.exec(migrationSql);
}, 60000);

async function query(sql) {
  const result = await db.query(sql);
  return result.rows;
}

describe("migration: forge_work_packages.mode (mode selector)", () => {
  it("adds a NOT NULL text mode column defaulting to 'industrial'", async () => {
    const rows = await query(`
      select data_type, is_nullable, column_default from information_schema.columns
      where table_name = 'forge_work_packages' and column_name = 'mode'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe("text");
    expect(rows[0].is_nullable).toBe("NO");
    expect(rows[0].column_default).toContain("industrial");
  });

  it("adds a CHECK constraint accepting only industrial/commercial", async () => {
    await expect(db.exec(`
      insert into forge_work_packages (owner_id, id, package_type, mode)
      values ('owner_1', 'wp_bad_mode', 'other', 'residential')
    `)).rejects.toThrow(/chk_forge_work_packages_mode|violates check constraint/);
  });

  it("backfills commercial-exclusive package types to mode = commercial", async () => {
    const rows = await query(`
      select id, mode from forge_work_packages
      where id in ('wp_remodel', 'wp_rental_turn', 'wp_maintenance', 'wp_new_construction')
      order by id
    `);
    for (const row of rows) expect(row.mode).toBe("commercial");
  });

  it("backfills industrial-exclusive and shared ('other') package types to mode = industrial", async () => {
    const rows = await query(`
      select id, mode from forge_work_packages
      where id in ('wp_engineering', 'wp_industrial', 'wp_capital', 'wp_other')
      order by id
    `);
    for (const row of rows) expect(row.mode).toBe("industrial");
  });

  it("a brand-new row with no explicit mode gets the column default, not a backfill rewrite", async () => {
    await db.exec(`
      insert into forge_work_packages (owner_id, id, package_type)
      values ('owner_1', 'wp_fresh', 'other')
    `);
    const rows = await query(`select mode from forge_work_packages where id = 'wp_fresh'`);
    expect(rows).toEqual([{ mode: "industrial" }]);
  });

  it("never rewrites package_type, owner_id, or id — additive only", async () => {
    const rows = await query(`
      select id, owner_id, package_type from forge_work_packages where id = 'wp_remodel'
    `);
    expect(rows).toEqual([{ id: "wp_remodel", owner_id: "owner_1", package_type: "remodel" }]);
  });

  it("is idempotent: reapplying changes nothing and does not error", async () => {
    const before = await query(`select id, mode from forge_work_packages order by id`);
    await expect(db.exec(migrationSql)).resolves.toBeDefined();
    const after = await query(`select id, mode from forge_work_packages order by id`);
    expect(after).toEqual(before);
    // Exactly one constraint, not a duplicate from the guarded re-add.
    const constraints = await query(`
      select count(*)::int as n from pg_constraint
      where conname = 'chk_forge_work_packages_mode'
        and conrelid = 'forge_work_packages'::regclass
    `);
    expect(constraints).toEqual([{ n: 1 }]);
  });

  it("contains no new table, function, or RLS policy — a column add changes no grants", () => {
    // Comment-stripped: the migration's own prose explains GRANT/REVOKE
    // is NOT needed, which would otherwise false-positive a naive grep.
    const codeOnly = migrationSql.replace(/--.*$/gm, "");
    expect(codeOnly).not.toMatch(/create\s+table/i);
    expect(codeOnly).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(codeOnly).not.toMatch(/create\s+policy/i);
    expect(codeOnly).not.toMatch(/\bgrant\s|\brevoke\s/i);
  });
});
