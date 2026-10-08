// Residential Slice 2 (Stage A) — forge_work_packages.property_id migration
// contract, executed against an in-process Postgres (PGlite). Minimal local
// fixture: the rung-1 packages table shape (columns this slice interacts
// with), the rung-1 lifecycle guard (extracted verbatim), and the rung-1
// workspace RLS policies backed by a test has_workspace_access stub. No
// linked/remote database is touched.
//
// The migration is PREPARED for review only; applying it to production is
// Jason's separate Stage B approval.

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const MIGRATION_PATH = new URL("../20261008010000_forge_work_packages_property_id.sql", import.meta.url);
const RUNG1_PATH = new URL("../20261002120000_forge_work_management_rung1.sql", import.meta.url);

function extractFunction(sql, signature, endMarker = "$$;") {
  const start = sql.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(-1);
  return sql.slice(start, end + endMarker.length);
}

const migrationSql = readFileSync(MIGRATION_PATH, "utf8");
const rung1Sql = readFileSync(RUNG1_PATH, "utf8");
const lifecycleGuardSql = extractFunction(
  rung1Sql,
  "create or replace function forge_work_packages_lifecycle_guard()",
);

const SETUP_SQL = `
  create role authenticated;
  create function has_workspace_access(p_owner text)
  returns boolean language sql stable as $$
    select p_owner = any (string_to_array(coalesce(current_setting('test.owners', true), 'owner_1'), ','))
  $$;

  create table forge_work_packages (
    owner_id text not null,
    id text not null,
    code text not null,
    title text not null,
    status text not null default 'draft',
    designated_verifier text,
    scope_baseline_id text,
    actual_start date,
    actual_finish date,
    verified_at timestamptz,
    verified_by text,
    blocked_reason text,
    blocked_since timestamptz,
    blocked_from text,
    version integer not null default 1,
    updated_at timestamptz not null default now(),
    primary key (owner_id, id)
  );

  ${lifecycleGuardSql}

  drop trigger if exists forge_work_packages_lifecycle_guard_trg on forge_work_packages;
  create trigger forge_work_packages_lifecycle_guard_trg
    before update on forge_work_packages
    for each row execute function forge_work_packages_lifecycle_guard();

  alter table forge_work_packages enable row level security;
  create policy forge_work_packages_workspace_select on forge_work_packages
    for select to authenticated using (has_workspace_access(owner_id));
  create policy forge_work_packages_workspace_insert on forge_work_packages
    for insert to authenticated with check (has_workspace_access(owner_id));
  create policy forge_work_packages_workspace_update on forge_work_packages
    for update to authenticated
    using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
  grant select, insert, update on forge_work_packages to authenticated;
`;

// Preexisting production rows (must stay property_id IS NULL after migrate).
const SEED_SQL = `
  insert into forge_work_packages (owner_id, id, code, title)
  values ('owner_1', 'forge_wp_1', 'WP-0001', 'Legacy unassigned package');
  insert into forge_work_packages (owner_id, id, code, title, project_id)
  values ('owner_1', 'forge_wp_2', 'WP-0002', 'Legacy project package', 'PROJ-1');
  insert into forge_work_packages (owner_id, id, code, title)
  values ('owner_2', 'forge_wp_3', 'WP-0001', 'Another workspace package');
`;

// Minimal table without project_id: recreate the fixture per-suite setup is
// overkill — add the column the seed references inside SETUP_SQL instead.
const SETUP_SQL_WITH_PROJECT = SETUP_SQL.replace(
  "blocked_from text,",
  "blocked_from text,\n    project_id text,",
);

let db;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP_SQL_WITH_PROJECT);
  await db.exec(SEED_SQL);
  await db.exec(migrationSql);
}, 60000);

async function query(sql) {
  const result = await db.query(sql);
  return result.rows;
}

describe("migration: forge_work_packages property_id (Slice 2, Stage A)", () => {
  it("adds a nullable text property_id column", async () => {
    const rows = await query(`
      select data_type, is_nullable from information_schema.columns
      where table_name = 'forge_work_packages' and column_name = 'property_id'
    `);
    expect(rows).toEqual([{ data_type: "text", is_nullable: "YES" }]);
  });

  it("creates the owner/property index", async () => {
    const rows = await query(`
      select indexdef from pg_indexes
      where tablename = 'forge_work_packages'
        and indexname = 'forge_work_packages_owner_property_idx'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/\(owner_id, property_id, updated_at DESC\)/);
  });

  it("does not backfill: preexisting rows stay NULL", async () => {
    const rows = await query(`
      select id, property_id from forge_work_packages order by id
    `);
    expect(rows).toEqual([
      { id: "forge_wp_1", property_id: null },
      { id: "forge_wp_2", property_id: null },
      { id: "forge_wp_3", property_id: null },
    ]);
  });

  it("property_id is an ordinary column the lifecycle guard ignores", async () => {
    await db.exec(`
      update forge_work_packages
      set property_id = '1900-w-decker'
      where owner_id = 'owner_1' and id = 'forge_wp_1'
    `);
    const rows = await query(`
      select property_id from forge_work_packages
      where owner_id = 'owner_1' and id = 'forge_wp_1'
    `);
    expect(rows).toEqual([{ property_id: "1900-w-decker" }]);
  });

  it("lifecycle guard still rejects a direct status change after the migration", async () => {
    await expect(db.exec(`
      update forge_work_packages
      set status = 'planned'
      where owner_id = 'owner_1' and id = 'forge_wp_1'
    `)).rejects.toThrow(/lifecycle columns change only through the lifecycle RPCs/);
  });

  it("keeps workspace RLS: owner sees own rows, co-owner sees shared rows, outsider sees none", async () => {
    await db.exec(`set role authenticated`);
    try {
      await db.exec("select set_config('test.owners', 'owner_1', false)");
      expect(await query("select id from forge_work_packages order by id")).toEqual([
        { id: "forge_wp_1" }, { id: "forge_wp_2" },
      ]);
      // Workspace model: a co-owner with access to both workspaces sees both.
      await db.exec("select set_config('test.owners', 'owner_1,owner_2', false)");
      expect(await query("select id from forge_work_packages order by id")).toHaveLength(3);
      // An outsider with access to neither sees nothing.
      await db.exec("select set_config('test.owners', 'owner_9', false)");
      expect(await query("select id from forge_work_packages")).toEqual([]);
      // An outsider cannot write into owner_1's workspace either.
      await expect(db.exec(`
        insert into forge_work_packages (owner_id, id, code, title)
        values ('owner_1', 'forge_wp_x', 'WP-0099', 'Intruder')
      `)).rejects.toThrow(/row-level security/);
    } finally {
      await db.exec("reset role");
    }
  });

  it("is idempotent: applying it a second time succeeds", async () => {
    await expect(db.exec(migrationSql)).resolves.toBeDefined();
    const rows = await query(`
      select count(*)::int as indexes from pg_indexes
      where tablename = 'forge_work_packages'
        and indexname = 'forge_work_packages_owner_property_idx'
    `);
    expect(rows).toEqual([{ indexes: 1 }]);
  });

  it("contains no backfill of property_id from project_id or text fields", () => {
    expect(migrationSql).not.toMatch(/update\s+forge_work_packages\s+set\s+property_id/i);
    expect(migrationSql).toMatch(/add column if not exists property_id text/);
  });
});
