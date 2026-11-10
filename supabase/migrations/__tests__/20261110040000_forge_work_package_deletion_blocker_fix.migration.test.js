// Fix round for forge_work_package_deletion_blocker_counts (20261008030000):
// the function predates slices 1-5/8 and never counted their tables, so a
// package with (e.g.) steps passed the blocker preflight, hit the raw FK,
// and the route surfaced a generic 500 instead of the existing clean 409
// 'blocked' path. This migration test builds a fixture that mirrors every
// real FK this fix depends on (the original 14 dependency classes plus the
// ones added by this migration) and proves: (1) the new types block with
// the exact type+count the real schema would produce, (2) nothing in the
// original 14-type behavior regressed, (3) a truly empty draft still
// deletes and tombstones cleanly.

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const ORIGINAL_MIGRATION_PATH = new URL("../20261008030000_forge_work_package_deletions.sql", import.meta.url);
const FIX_MIGRATION_PATH = new URL("../20261110040000_forge_work_package_deletion_blocker_fix.sql", import.meta.url);
const RUNG1_PATH = new URL("../20261002120000_forge_work_management_rung1.sql", import.meta.url);

function extractFunction(sql, signature, endMarker = "$$;") {
  const start = sql.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(-1);
  return sql.slice(start, end + endMarker.length);
}

const originalMigrationSql = readFileSync(ORIGINAL_MIGRATION_PATH, "utf8");
const fixMigrationSql = readFileSync(FIX_MIGRATION_PATH, "utf8");
const rung1Sql = readFileSync(RUNG1_PATH, "utf8");
const nextNumberSql = extractFunction(
  rung1Sql,
  "create or replace function forge_work_next_package_number(p_owner_id text)",
);

// Minimal fixture mirroring every table with a direct FK to
// forge_work_packages -- the original 14 (20261008030000) plus the ones
// this fix adds. Column shapes match production exactly where the FK or a
// test needs them (owner_id/id/package_id or work_package_id, retired_at
// where relevant); everything else is omitted as not load-bearing here.
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

  create table forge_work_package_sequences (
    owner_id text primary key,
    last_number integer not null default 0,
    updated_at timestamptz not null default now()
  );

  create table forge_work_packages (
    owner_id text not null,
    id text not null,
    code text not null,
    title text not null,
    status text not null default 'draft',
    designated_verifier text,
    version integer not null default 1,
    updated_by text,
    updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, code)
  );

  -- Original 14 dependency classes (minimal shapes, unchanged from
  -- 20261008030000's own test fixture).
  create table forge_work_package_budget_revisions (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id));
  create table forge_work_package_transitions (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id));
  create table forge_work_gate_attestations (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id));
  create table forge_work_scope_baselines (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id));
  create table forge_work_scope_changes (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id));
  create table forge_work_inspection_observations (
    owner_id text not null, id text not null, package_id text,
    primary key (owner_id, id));
  create table forge_work_gate_evaluations (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id));
  create table forge_work_gate_overrides (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id));
  create table forge_work_links (
    owner_id text not null, id text not null,
    source_domain text not null, source_type text not null, source_id text not null,
    target_domain text not null, target_type text not null, target_id text not null,
    primary key (owner_id, id));
  create table forge_work_link_confirmations (
    owner_id text not null, id text not null, link_id text not null,
    primary key (owner_id, id));
  create table forge_work_package_baselines (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, package_id) references forge_work_packages (owner_id, id));
  create table forge_work_progress_snapshots (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, package_id) references forge_work_packages (owner_id, id));
  create table forge_work_weekly_commitments (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, package_id) references forge_work_packages (owner_id, id));
  create table forge_work_manpower_days (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, package_id) references forge_work_packages (owner_id, id));

  -- Added by this fix: a direct FK to forge_work_packages that the
  -- original function never counted.
  create table forge_work_drawings (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_progress_entries (
    owner_id text not null, id text not null, work_package_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_permit_annotations (
    owner_id text not null, id text not null, work_package_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_craft_assignments (
    owner_id text not null, id text not null, work_package_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_steps (
    owner_id text not null, id text not null, work_package_id text not null,
    retired_at timestamptz,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_step_order (
    owner_id text not null, work_package_id text not null,
    generation integer not null default 0,
    primary key (owner_id, work_package_id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_step_revisions (
    owner_id text not null, id text not null, step_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, step_id) references forge_work_steps (owner_id, id) on delete restrict);
  create table forge_work_control_estimates (
    owner_id text not null, id text not null, work_package_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_change_orders (
    owner_id text not null, id text not null, work_package_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_craft_rates (
    owner_id text not null, id text not null, work_package_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);

  ${nextNumberSql}

  alter table forge_work_packages enable row level security;
  create policy forge_work_packages_workspace_select on forge_work_packages
    for select to authenticated using (has_workspace_access(owner_id));
  create policy forge_work_packages_workspace_insert on forge_work_packages
    for insert to authenticated with check (has_workspace_access(owner_id));
  create policy forge_work_packages_workspace_update on forge_work_packages
    for update to authenticated
    using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
  grant select, insert, update, delete on forge_work_packages to authenticated;
`;

let db;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP_SQL);
  await db.exec(originalMigrationSql);
  await db.exec(fixMigrationSql);
  await asActor("owner_1", "owner_1");
}, 60000);

async function query(sql) {
  const result = await db.query(sql);
  return result.rows;
}

async function asActor(actor, owners) {
  await db.exec(`select set_config('test.actor', '${actor}', false)`);
  await db.exec(`select set_config('test.owners', '${owners}', false)`);
}

let seedCounter = 2000;
async function seedPackage(ownerId, overrides = {}) {
  seedCounter += 1;
  const id = overrides.id || `forge_wp_delfix_${seedCounter}`;
  const code = overrides.code || `WP-DF-${seedCounter}`;
  const status = overrides.status || "draft";
  const version = overrides.version ?? 1;
  await db.exec(`
    insert into forge_work_packages (owner_id, id, code, title, status, version)
    values ('${ownerId}', '${id}', '${code}', 'Delete-fix test ${seedCounter}', '${status}', ${version})
  `);
  return { id, code, version, status };
}

async function callDelete(ownerId, packageId, version, code) {
  const rows = await query(`
    select forge_work_delete_empty_draft_package('${ownerId}', '${packageId}', ${version}, '${code}') as result
  `);
  return rows[0].result;
}

async function callBlockers(ownerId, packageId) {
  const rows = await query(`
    select forge_work_package_deletion_blockers('${ownerId}', '${packageId}') as result
  `);
  return rows[0].result;
}

async function packageCount(id) {
  const rows = await query(`select count(*)::int as count from forge_work_packages where id = '${id}'`);
  return rows[0].count;
}

async function tombstoneCount(packageId) {
  const rows = await query(`select count(*)::int as count from forge_work_package_deletions where package_id = '${packageId}'`);
  return rows[0].count;
}

describe("migration fix: forge_work_package_deletion_blocker_counts covers slices 1-5/8", () => {
  it("a truly empty draft still deletes and tombstones (no regression)", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    expect(await callBlockers("owner_1", pkg.id)).toEqual([]);
    const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
    expect(result.ok).toBe(true);
    expect(await packageCount(pkg.id)).toBe(0);
    expect(await tombstoneCount(pkg.id)).toBe(1);
  });

  // The 23503 reproduction: before this fix, a package with a step row
  // reached `delete from forge_work_packages` and the FK threw. After
  // this fix, the blocker preflight catches it first and the delete RPC
  // returns the clean 409 'blocked' shape instead of ever reaching the
  // raw DELETE statement.
  it("a draft package WITH steps gets a clean 409 naming 'steps', never a raw FK error", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    await db.exec(`
      insert into forge_work_steps (owner_id, id, work_package_id)
      values ('owner_1', 'forge_wstep_${pkg.id}', '${pkg.id}')
    `);

    const preflight = await callBlockers("owner_1", pkg.id);
    expect(preflight).toEqual([{ type: "steps", count: 1 }]);

    const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("blocked");
    expect(result.blockers).toEqual([{ type: "steps", count: 1 }]);
    expect(await packageCount(pkg.id)).toBe(1);
    expect(await tombstoneCount(pkg.id)).toBe(0);

    // The raw FK is still there as the backstop (defense in depth): a
    // direct, non-RPC delete attempt still fails at the database level.
    await expect(db.exec(`
      delete from forge_work_packages where owner_id = 'owner_1' and id = '${pkg.id}'
    `)).rejects.toThrow(/foreign key|forge_work_steps/);
  });

  it("a draft package with a RETIRED step still gets the same 409 (retiring doesn't remove the FK row)", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    await db.exec(`
      insert into forge_work_steps (owner_id, id, work_package_id, retired_at)
      values ('owner_1', 'forge_wstep_ret_${pkg.id}', '${pkg.id}', now())
    `);

    const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
    expect(result.error).toBe("blocked");
    expect(result.blockers).toEqual([{ type: "steps", count: 1 }]);
    expect(await packageCount(pkg.id)).toBe(1);
  });

  it("step_revisions are named in the blocker list alongside steps (joined count, never standalone)", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    const stepId = `forge_wstep_rev_${pkg.id}`;
    await db.exec(`
      insert into forge_work_steps (owner_id, id, work_package_id)
      values ('owner_1', '${stepId}', '${pkg.id}');
      insert into forge_work_step_revisions (owner_id, id, step_id)
      values ('owner_1', 'forge_wsrev_${pkg.id}', '${stepId}');
    `);
    const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
    expect(result.error).toBe("blocked");
    expect(result.blockers).toEqual(expect.arrayContaining([
      { type: "steps", count: 1 },
      { type: "step_revisions", count: 1 },
    ]));
  });

  // Every newly-added dependency class blocks with the exact type+count,
  // matching the original file's own BLOCKER_CASES convention.
  const NEW_BLOCKER_CASES = [
    ["drawings", (id) => `insert into forge_work_drawings (owner_id, id, package_id) values ('owner_1', 'forge_wdwg_${id}', '${id}')`],
    ["progress_entries", (id) => `insert into forge_work_progress_entries (owner_id, id, work_package_id) values ('owner_1', 'forge_wpe_${id}', '${id}')`],
    ["permit_annotations", (id) => `insert into forge_work_permit_annotations (owner_id, id, work_package_id) values ('owner_1', 'forge_wpa_${id}', '${id}')`],
    ["craft_assignments", (id) => `insert into forge_work_craft_assignments (owner_id, id, work_package_id) values ('owner_1', 'forge_wca_${id}', '${id}')`],
    ["step_order", (id) => `insert into forge_work_step_order (owner_id, work_package_id) values ('owner_1', '${id}')`],
    ["control_estimates", (id) => `insert into forge_work_control_estimates (owner_id, id, work_package_id) values ('owner_1', 'forge_wce_${id}', '${id}')`],
    ["change_orders", (id) => `insert into forge_work_change_orders (owner_id, id, work_package_id) values ('owner_1', 'forge_wco_${id}', '${id}')`],
    ["craft_rates", (id) => `insert into forge_work_craft_rates (owner_id, id, work_package_id) values ('owner_1', 'forge_wcr_${id}', '${id}')`],
  ];

  for (const [type, insertSql] of NEW_BLOCKER_CASES) {
    it(`blocks deletion when a ${type} record exists (previously missing from the blocker function)`, async () => {
      await asActor("owner_1", "owner_1");
      const pkg = await seedPackage("owner_1");
      await db.exec(insertSql(pkg.id));

      const preflight = await callBlockers("owner_1", pkg.id);
      expect(preflight).toEqual([{ type, count: 1 }]);

      const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("blocked");
      expect(result.blockers).toEqual([{ type, count: 1 }]);
      expect(await packageCount(pkg.id)).toBe(1);
      expect(await tombstoneCount(pkg.id)).toBe(0);
    });
  }

  // Non-regression: the 14 original dependency classes still block exactly
  // as before (20261008030000's own suite is the authority for these; this
  // is a light spot-check that the CREATE OR REPLACE didn't drop or
  // rename any of them).
  const ORIGINAL_SPOT_CHECKS = [
    ["budget_revisions", (id) => `insert into forge_work_package_budget_revisions (owner_id, id, package_id) values ('owner_1', 'forge_wpbr_${id}', '${id}')`],
    ["transitions", (id) => `insert into forge_work_package_transitions (owner_id, id, package_id) values ('owner_1', 'forge_wtr_${id}', '${id}')`],
    ["package_baselines", (id) => `insert into forge_work_package_baselines (owner_id, id, package_id) values ('owner_1', 'forge_wpb_${id}', '${id}')`],
    ["manpower_days", (id) => `insert into forge_work_manpower_days (owner_id, id, package_id) values ('owner_1', 'forge_wmd_${id}', '${id}')`],
  ];
  for (const [type, insertSql] of ORIGINAL_SPOT_CHECKS) {
    it(`(non-regression) still blocks on a pre-existing ${type} record`, async () => {
      await asActor("owner_1", "owner_1");
      const pkg = await seedPackage("owner_1");
      await db.exec(insertSql(pkg.id));
      const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
      expect(result.error).toBe("blocked");
      expect(result.blockers).toEqual([{ type, count: 1 }]);
    });
  }

  it("re-applies idempotently (create or replace, no destructive statement)", async () => {
    expect(fixMigrationSql.toLowerCase()).not.toContain("on delete cascade");
    expect(fixMigrationSql.toLowerCase()).not.toContain("drop table");
    expect(fixMigrationSql.toLowerCase()).not.toContain("drop function");
    await expect(db.exec(fixMigrationSql)).resolves.toBeDefined();
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
    expect(result.ok).toBe(true);
  });

  it("preflight (forge_work_package_deletion_blockers) reveals the new types only to workspace members", async () => {
    const pkg = await seedPackage("owner_1");
    await db.exec(`
      insert into forge_work_steps (owner_id, id, work_package_id)
      values ('owner_1', 'forge_wstep_vis_${pkg.id}', '${pkg.id}')
    `);
    await asActor("member_1", "owner_1");
    expect(await callBlockers("owner_1", pkg.id)).toEqual([{ type: "steps", count: 1 }]);
    await asActor("owner_9", "owner_9");
    expect(await callBlockers("owner_1", pkg.id)).toEqual([]);
    await asActor("owner_1", "owner_1");
  });
});
