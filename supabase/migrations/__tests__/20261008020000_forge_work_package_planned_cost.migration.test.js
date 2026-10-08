// Residential Slice 3 (Stage A) — planned budget migration contract,
// executed against an in-process Postgres (PGlite). Minimal local fixture:
// the rung-1 packages table shape, the rung-1 lifecycle guard and version
// bump (extracted verbatim), a scope-baseline row, and workspace RLS backed
// by a test has_workspace_access stub. No linked/remote database is touched.
//
// The migration is PREPARED for review only; applying it to production is
// Jason's separate Stage B approval.

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const MIGRATION_PATH = new URL("../20261008020000_forge_work_package_planned_cost.sql", import.meta.url);
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
const versionBumpSql = extractFunction(
  rung1Sql,
  "create or replace function forge_work_packages_version_bump()",
);

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
    code text not null,
    title text not null,
    status text not null default 'draft',
    project_id text,
    property_id text,
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
    updated_by text,
    updated_at timestamptz not null default now(),
    primary key (owner_id, id)
  );

  create table forge_work_scope_baselines (
    owner_id text not null,
    id text not null,
    package_id text not null,
    version integer not null,
    membership jsonb not null default '[]'::jsonb,
    membership_hash text not null,
    primary key (owner_id, id)
  );

  ${lifecycleGuardSql}
  ${versionBumpSql}

  create trigger forge_work_packages_lifecycle_guard_trg
    before update on forge_work_packages
    for each row execute function forge_work_packages_lifecycle_guard();
  create trigger forge_work_packages_version_bump_trg
    before update on forge_work_packages
    for each row execute function forge_work_packages_version_bump();

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

const SEED_SQL = `
  insert into forge_work_packages (owner_id, id, code, title, project_id, property_id)
  values ('owner_1', 'forge_wp_1', 'WP-0001', 'Legacy package', 'PROJ-1', '1900-w-decker');
  insert into forge_work_packages (owner_id, id, code, title, status)
  values ('owner_1', 'forge_wp_terminal', 'WP-0002', 'Closed package', 'verified_closed');
  insert into forge_work_packages (owner_id, id, code, title)
  values ('owner_2', 'forge_wp_2', 'WP-0001', 'Another workspace package');
  insert into forge_work_scope_baselines
    (owner_id, id, package_id, version, membership, membership_hash)
  values ('owner_1', 'forge_wsb_1', 'forge_wp_1', 1,
          '[{"key":"BUNDLE-01","description":"Pull bundle","quantity":1,"unit":"each"}]'::jsonb,
          'fnv1a:baselinehash');
`;

let db;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP_SQL);
  await db.exec(SEED_SQL);
  await db.exec(migrationSql);
  await db.exec("select set_config('test.actor', 'owner_1', false)");
  await db.exec("select set_config('test.owners', 'owner_1', false)");
}, 60000);

async function query(sql) {
  const result = await db.query(sql);
  return result.rows;
}

describe("migration: package planned cost (Slice 3, Stage A)", () => {
  it("adds a nullable bigint planned_cost_cents column and existing rows stay NULL", async () => {
    const columns = await query(`
      select data_type, is_nullable from information_schema.columns
      where table_name = 'forge_work_packages' and column_name = 'planned_cost_cents'
    `);
    expect(columns).toEqual([{ data_type: "bigint", is_nullable: "YES" }]);
    const rows = await query(`
      select id, planned_cost_cents from forge_work_packages order by id
    `);
    expect(rows).toEqual([
      { id: "forge_wp_1", planned_cost_cents: null },
      { id: "forge_wp_2", planned_cost_cents: null },
      { id: "forge_wp_terminal", planned_cost_cents: null },
    ]);
  });

  it("enforces the nonnegative CHECK", async () => {
    await expect(db.exec(`
      update forge_work_packages set planned_cost_cents = -1
      where owner_id = 'owner_1' and id = 'forge_wp_1'
    `)).rejects.toThrow(/forge_work_packages_planned_cost_nonnegative/);
  });

  it("updates the budget and appends the audit revision atomically through the guarded RPC", async () => {
    const result = await query(`
      select forge_work_update_package_budget(
        'owner_1', 'forge_wp_1', 1, 125000, 'Initial budget'
      ) as result
    `);
    expect(result[0].result.ok).toBe(true);
    expect(Number(result[0].result.package.planned_cost_cents)).toBe(125000);
    expect(result[0].result.package.version).toBe(2);
    expect(result[0].result.revision.old_planned_cost_cents).toBeNull();
    expect(Number(result[0].result.revision.new_planned_cost_cents)).toBe(125000);
    expect(result[0].result.revision.actor).toBe("owner_1");
    expect(result[0].result.revision.reason).toBe("Initial budget");

    const revisions = await query(`
      select package_id, actor, old_planned_cost_cents, new_planned_cost_cents, reason
      from forge_work_package_budget_revisions
      where owner_id = 'owner_1' and package_id = 'forge_wp_1'
    `);
    expect(revisions).toHaveLength(1);
    expect(Number(revisions[0].new_planned_cost_cents)).toBe(125000);
  });

  it("returns conflict for a stale version and writes no revision", async () => {
    const result = await query(`
      select forge_work_update_package_budget(
        'owner_1', 'forge_wp_1', 1, 130000, 'Stale edit'
      ) as result
    `);
    expect(result[0].result).toEqual({ ok: false, error: "conflict" });
    const rows = await query(`
      select planned_cost_cents, version from forge_work_packages
      where owner_id = 'owner_1' and id = 'forge_wp_1'
    `);
    expect(Number(rows[0].planned_cost_cents)).toBe(125000);
    expect(rows[0].version).toBe(2);
    expect(await query(`
      select count(*)::int as count from forge_work_package_budget_revisions
      where owner_id = 'owner_1' and package_id = 'forge_wp_1'
    `)).toEqual([{ count: 1 }]);
  });

  it("rolls back the package update when the revision insert fails", async () => {
    await db.exec(`
      create function fail_budget_revision()
      returns trigger language plpgsql as $$
      begin raise exception 'forced revision failure'; end
      $$;
      create trigger fail_budget_revision_trg
        before insert on forge_work_package_budget_revisions
        for each row execute function fail_budget_revision();
    `);
    try {
      await expect(db.exec(`
        select forge_work_update_package_budget(
          'owner_1', 'forge_wp_1', 2, 130000, 'Must roll back'
        )
      `)).rejects.toThrow(/forced revision failure/);
      const rows = await query(`
        select planned_cost_cents, version from forge_work_packages
        where owner_id = 'owner_1' and id = 'forge_wp_1'
      `);
      expect(Number(rows[0].planned_cost_cents)).toBe(125000);
      expect(rows[0].version).toBe(2);
    } finally {
      await db.exec(`
        drop trigger fail_budget_revision_trg on forge_work_package_budget_revisions;
        drop function fail_budget_revision();
      `);
    }
  });

  it("rejects terminal and invalid budget RPC calls without revisions", async () => {
    const terminal = await query(`
      select forge_work_update_package_budget(
        'owner_1', 'forge_wp_terminal', 1, 1000, 'Too late'
      ) as result
    `);
    expect(terminal[0].result).toEqual({ ok: false, error: "terminal" });

    const invalid = await query(`
      select forge_work_update_package_budget(
        'owner_1', 'forge_wp_1', 2, -1, 'Bad budget'
      ) as result
    `);
    expect(invalid[0].result).toEqual({ ok: false, error: "invalid_budget" });
    expect(await query(`
      select count(*)::int as count from forge_work_package_budget_revisions
      where owner_id = 'owner_1'
    `)).toEqual([{ count: 1 }]);
  });

  it("keeps revisions workspace-scoped and append-only for authenticated users", async () => {
    await db.exec("set role authenticated");
    try {
      await db.exec("select set_config('test.owners', 'owner_1', false)");
      expect(await query(`
        select count(*)::int as count from forge_work_package_budget_revisions
      `)).toEqual([{ count: 1 }]);

      await db.exec("select set_config('test.owners', 'owner_9', false)");
      expect(await query(`
        select count(*)::int as count from forge_work_package_budget_revisions
      `)).toEqual([{ count: 0 }]);
      await expect(db.exec(`
        insert into forge_work_package_budget_revisions
          (owner_id, package_id, actor, new_planned_cost_cents, reason)
        values ('owner_1', 'forge_wp_1', 'owner_9', 1, 'Forged')
      `)).rejects.toThrow(/permission denied|row-level security/);
    } finally {
      await db.exec("reset role");
      await db.exec("select set_config('test.owners', 'owner_1', false)");
    }
  });

  it("planned_cost_cents is an ordinary column: the lifecycle guard still guards lifecycle columns", async () => {
    await expect(db.exec(`
      update forge_work_packages set status = 'planned'
      where owner_id = 'owner_1' and id = 'forge_wp_1'
    `)).rejects.toThrow(/lifecycle columns change only through the lifecycle RPCs/);
    const rows = await query(`
      select planned_cost_cents from forge_work_packages
      where owner_id = 'owner_1' and id = 'forge_wp_1'
    `);
    expect(Number(rows[0].planned_cost_cents)).toBe(125000);
  });

  it("does not alter scope baseline membership or hash", async () => {
    const rows = await query(`
      select membership, membership_hash from forge_work_scope_baselines
      where owner_id = 'owner_1' and package_id = 'forge_wp_1'
    `);
    expect(rows).toEqual([{
      membership: [{ key: "BUNDLE-01", description: "Pull bundle", quantity: 1, unit: "each" }],
      membership_hash: "fnv1a:baselinehash",
    }]);
  });

  it("is idempotent: applying it a second time succeeds and preserves revisions", async () => {
    await expect(db.exec(migrationSql)).resolves.toBeDefined();
    expect(await query(`
      select count(*)::int as count from forge_work_package_budget_revisions
      where owner_id = 'owner_1'
    `)).toEqual([{ count: 1 }]);
  });

  it("contains no backfill and no property/project rewrite", () => {
    expect(migrationSql).toMatch(/add column if not exists planned_cost_cents bigint/);
    expect(migrationSql).not.toMatch(/update\s+forge_work_packages\s+set\s+(property_id|project_id)\s*=/i);
    expect(migrationSql).not.toMatch(/insert\s+into\s+forge_work_package_budget_revisions[\s\S]*select/i);
  });
});
