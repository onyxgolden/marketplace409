// Work Package Planner slice 1 — migration contract, executed against an
// in-process Postgres (PGlite). Minimal local fixture: a bare
// forge_work_packages shape (owner_id/id only — slice 1's FK only needs
// that pair) and a stub has_workspace_access/auth.uid(), mirroring the
// convention in 20261008030000_forge_work_package_deletions.migration.test.js.
//
// The migration is prepared for review only; applying it to production is
// Jason's separate approval, same as every migration. No linked/remote
// database is touched by this test.

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const MIGRATION_PATH = new URL("../20261104000000_forge_work_package_takeoff_slice1.sql", import.meta.url);
const migrationSql = readFileSync(MIGRATION_PATH, "utf8");

const SETUP_SQL = `
  create role authenticated;
  create role anon;
  create role service_role;
  create schema auth;
  create function auth.uid()
  returns text language sql stable as $$
    select nullif(current_setting('test.actor', true), '')
  $$;
  create function has_workspace_access(p_owner text)
  returns boolean language sql stable as $$
    select p_owner = any (string_to_array(coalesce(current_setting('test.owners', true), 'owner_1'), ','))
  $$;

  create table forge_work_packages (
    owner_id text not null,
    id text not null,
    primary key (owner_id, id)
  );
  grant select, insert, update, delete on forge_work_packages to authenticated;
`;

let db;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP_SQL);
  await db.exec(migrationSql);
  await asActor("owner_1", "owner_1");
  await db.exec("set role authenticated");
}, 60000);

async function query(sql) {
  const result = await db.query(sql);
  return result.rows;
}

async function exec(sql) {
  await db.exec(sql);
}

async function asActor(actor, owners) {
  await db.exec(`select set_config('test.actor', '${actor}', false)`);
  await db.exec(`select set_config('test.owners', '${owners}', false)`);
}

async function expectRejected(promise, pattern) {
  let threw = false;
  try {
    await promise;
  } catch (error) {
    threw = true;
    expect(String(error.message || error)).toMatch(pattern);
  }
  expect(threw).toBe(true);
}

describe("forge_work_package_takeoff_slice1 migration", () => {
  it("creates forge_work_drawings and forge_work_takeoff_lines", async () => {
    const tables = await query(`
      select table_name from information_schema.tables
      where table_name in ('forge_work_drawings', 'forge_work_takeoff_lines')
      order by table_name
    `);
    expect(tables.map((t) => t.table_name)).toEqual(["forge_work_drawings", "forge_work_takeoff_lines"]);
  });

  it("a p_id drawing must not carry p_id_drawing_id", async () => {
    await exec(`insert into forge_work_packages (owner_id, id) values ('owner_1', 'pkg_1')`);
    await expectRejected(
      exec(`
        insert into forge_work_drawings (owner_id, id, package_id, drawing_number, drawing_type, p_id_drawing_id)
        values ('owner_1', 'dwg_bad', 'pkg_1', 'P-101', 'p_id', 'dwg_bad')
      `),
      /check/i,
    );
  });

  it("a cut_sheet/isometric drawing requires p_id_drawing_id", async () => {
    await expectRejected(
      exec(`
        insert into forge_work_drawings (owner_id, id, package_id, drawing_number, drawing_type)
        values ('owner_1', 'dwg_bad2', 'pkg_1', 'ISO-001', 'isometric')
      `),
      /check/i,
    );
  });

  it("accepts a valid P&ID then a valid isometric rolling up to it, enforces FK to the package", async () => {
    await exec(`
      insert into forge_work_drawings (owner_id, id, package_id, drawing_number, drawing_type)
      values ('owner_1', 'dwg_pid1', 'pkg_1', 'P-101', 'p_id')
    `);
    await exec(`
      insert into forge_work_drawings (owner_id, id, package_id, drawing_number, drawing_type, p_id_drawing_id)
      values ('owner_1', 'dwg_iso1', 'pkg_1', 'ISO-001', 'isometric', 'dwg_pid1')
    `);
    const rows = await query(`select id, drawing_type, p_id_drawing_id from forge_work_drawings where owner_id = 'owner_1' order by id`);
    expect(rows).toEqual([
      { id: "dwg_iso1", drawing_type: "isometric", p_id_drawing_id: "dwg_pid1" },
      { id: "dwg_pid1", drawing_type: "p_id", p_id_drawing_id: null },
    ]);

    await expectRejected(
      exec(`
        insert into forge_work_drawings (owner_id, id, package_id, drawing_number, drawing_type)
        values ('owner_1', 'dwg_orphan', 'pkg_missing', 'P-999', 'p_id')
      `),
      /foreign key/i,
    );
  });

  it("drawing_number is unique per package, not globally", async () => {
    await exec(`insert into forge_work_packages (owner_id, id) values ('owner_1', 'pkg_2')`);
    await exec(`
      insert into forge_work_drawings (owner_id, id, package_id, drawing_number, drawing_type)
      values ('owner_1', 'dwg_pkg2_pid1', 'pkg_2', 'P-101', 'p_id')
    `);
    // Same drawing_number "P-101" in a different package is fine.
    const rows = await query(`select id from forge_work_drawings where owner_id = 'owner_1' and drawing_number = 'P-101' order by id`);
    expect(rows.map((r) => r.id).sort()).toEqual(["dwg_pid1", "dwg_pkg2_pid1"]);

    await expectRejected(
      exec(`
        insert into forge_work_drawings (owner_id, id, package_id, drawing_number, drawing_type)
        values ('owner_1', 'dwg_dup', 'pkg_1', 'P-101', 'p_id')
      `),
      /duplicate key|unique/i,
    );
  });

  it("takeoff lines require a positive quantity, a valid category/fab_location, and a unique line_no per drawing", async () => {
    await exec(`
      insert into forge_work_takeoff_lines
        (owner_id, id, drawing_id, line_no, description, quantity, unit, category, fab_location)
      values
        ('owner_1', 'line_1', 'dwg_pid1', 1, '6in CS pipe', 40, 'ft', 'pipe', 'shop')
    `);
    await expectRejected(
      exec(`
        insert into forge_work_takeoff_lines
          (owner_id, id, drawing_id, line_no, description, quantity, unit, category, fab_location)
        values
          ('owner_1', 'line_bad_qty', 'dwg_pid1', 2, 'bad qty', -1, 'ft', 'pipe', 'shop')
      `),
      /check/i,
    );
    await expectRejected(
      exec(`
        insert into forge_work_takeoff_lines
          (owner_id, id, drawing_id, line_no, description, quantity, unit, category, fab_location)
        values
          ('owner_1', 'line_bad_cat', 'dwg_pid1', 3, 'bad category', 1, 'ea', 'nonsense', 'shop')
      `),
      /check/i,
    );
    await expectRejected(
      exec(`
        insert into forge_work_takeoff_lines
          (owner_id, id, drawing_id, line_no, description, quantity, unit, category, fab_location)
        values
          ('owner_1', 'line_dup_no', 'dwg_pid1', 1, 'duplicate line_no', 1, 'ea', 'other', 'field')
      `),
      /duplicate key|unique/i,
    );
  });

  it("RLS: a different owner cannot see or write another owner's drawings", async () => {
    await asActor("owner_2", "owner_2");
    const rows = await query(`select id from forge_work_drawings where owner_id = 'owner_1'`);
    expect(rows).toEqual([]);

    await expectRejected(
      exec(`
        insert into forge_work_drawings (owner_id, id, package_id, drawing_number, drawing_type)
        values ('owner_1', 'dwg_cross_owner', 'pkg_1', 'P-999', 'p_id')
      `),
      /row-level security|policy/i,
    );
    await asActor("owner_1", "owner_1");
  });

  it("WPP1-002 counterexample: a child in package B cannot roll up to a P&ID in package A", async () => {
    // dwg_pid1 is a P&ID in pkg_1; pkg_2 exists from the uniqueness test.
    await expectRejected(
      exec(`
        insert into forge_work_drawings (owner_id, id, package_id, drawing_number, drawing_type, p_id_drawing_id)
        values ('owner_1', 'dwg_cross_pkg', 'pkg_2', 'ISO-999', 'isometric', 'dwg_pid1')
      `),
      /foreign key/i,
    );
  });

  it("WPP1-001: no UPDATE policy exists on drawings, direct UPDATE is rejected, DELETE still allowed", async () => {
    const updatePolicies = await query(`
      select policyname from pg_policies
      where schemaname = 'public' and tablename = 'forge_work_drawings' and cmd = 'UPDATE'
    `);
    expect(updatePolicies).toEqual([]);

    await exec(`insert into forge_work_packages (owner_id, id) values ('owner_1', 'pkg_3')`);
    await exec(`
      insert into forge_work_drawings (owner_id, id, package_id, drawing_number, drawing_type)
      values ('owner_1', 'dwg_upd', 'pkg_3', 'P-301', 'p_id')
    `);
    // Same-workspace principal, own drawing — UPDATE must still be denied:
    // drawings are controlled documents, DELETE-only.
    await expectRejected(
      exec(`
        update forge_work_drawings set drawing_number = 'P-302' where id = 'dwg_upd'
      `),
      /permission denied|row-level security|policy/i,
    );
    await expectRejected(
      exec(`
        update forge_work_drawings set title = 'renamed' where id = 'dwg_upd'
      `),
      /permission denied|row-level security|policy/i,
    );
    await exec(`delete from forge_work_drawings where id = 'dwg_upd'`);
    const rows = await query(`select id from forge_work_drawings where id = 'dwg_upd'`);
    expect(rows).toEqual([]);
  });
});
