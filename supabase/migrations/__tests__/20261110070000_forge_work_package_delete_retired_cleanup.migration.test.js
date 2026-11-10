// Follow-up to 20261110040000 (PR #770): a live click-through found that
// retiring a package's only step (the UI's sole "remove a step" action --
// there is no step hard-delete) still left the package permanently
// undeletable, because the blocker-count function counted retired step
// rows the same as active ones, and the FK backstop still threw once the
// (now-zero) blocker check tried to let the delete through. This migration
// test applies 20261008030000 -> 20261110040000 -> 20261110070000 in
// sequence and proves: (1) a RETIRED step no longer blocks deletion,
// (2) an ACTIVE step still blocks exactly as before, (3) step_revisions
// and step_order are cleaned up with the steps, never orphaned,
// (4) the previously-uncounted step_drawing_links table (a second raw-FK
// gap found while tracing this fix) never throws, retired or active,
// (5) nothing from 20261110040000's other 8 types regresses.

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const ORIGINAL_MIGRATION_PATH = new URL("../20261008030000_forge_work_package_deletions.sql", import.meta.url);
const BLOCKER_FIX_PATH = new URL("../20261110040000_forge_work_package_deletion_blocker_fix.sql", import.meta.url);
const CLEANUP_FIX_PATH = new URL("../20261110070000_forge_work_package_delete_retired_cleanup.sql", import.meta.url);
const RUNG1_PATH = new URL("../20261002120000_forge_work_management_rung1.sql", import.meta.url);

function extractFunction(sql, signature, endMarker = "$$;") {
  const start = sql.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(-1);
  return sql.slice(start, end + endMarker.length);
}

const originalMigrationSql = readFileSync(ORIGINAL_MIGRATION_PATH, "utf8");
const blockerFixSql = readFileSync(BLOCKER_FIX_PATH, "utf8");
const cleanupFixSql = readFileSync(CLEANUP_FIX_PATH, "utf8");
const rung1Sql = readFileSync(RUNG1_PATH, "utf8");
const nextNumberSql = extractFunction(
  rung1Sql,
  "create or replace function forge_work_next_package_number(p_owner_id text)",
);

// Same fixture shape as 20261110040000's own test, extended with
// forge_work_step_drawing_links (the second gap found by this fix) and a
// minimal forge_work_drawings row target for its FK.
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

  create table forge_work_drawings (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id),
    unique (owner_id, package_id, id),
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
    unique (owner_id, work_package_id, id),
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
  create table forge_work_step_drawing_links (
    owner_id text not null, id text not null, work_package_id text not null,
    step_id text not null, drawing_id text, retired_at timestamptz,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id, step_id)
      references forge_work_steps (owner_id, work_package_id, id) on delete restrict,
    foreign key (owner_id, work_package_id, drawing_id)
      references forge_work_drawings (owner_id, package_id, id) on delete restrict
  );
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
  await db.exec(blockerFixSql);
  await db.exec(cleanupFixSql);
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

let seedCounter = 3000;
async function seedPackage(ownerId, overrides = {}) {
  seedCounter += 1;
  const id = overrides.id || `forge_wp_retcln_${seedCounter}`;
  const code = overrides.code || `WP-RC-${seedCounter}`;
  const status = overrides.status || "draft";
  const version = overrides.version ?? 1;
  await db.exec(`
    insert into forge_work_packages (owner_id, id, code, title, status, version)
    values ('${ownerId}', '${id}', '${code}', 'Retired-cleanup test ${seedCounter}', '${status}', ${version})
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

async function stepFamilyRowCounts(packageId) {
  const steps = await query(`select count(*)::int as count from forge_work_steps where work_package_id = '${packageId}'`);
  const order = await query(`select count(*)::int as count from forge_work_step_order where work_package_id = '${packageId}'`);
  const revisions = await query(`
    select count(*)::int as count from forge_work_step_revisions
    where step_id in (select id from forge_work_steps where work_package_id = '${packageId}')
       or step_id like 'forge_wstep%${packageId}%'
  `);
  const links = await query(`select count(*)::int as count from forge_work_step_drawing_links where work_package_id = '${packageId}'`);
  return { steps: steps[0].count, order: order[0].count, revisions: revisions[0].count, links: links[0].count };
}

describe("migration fix: retired steps no longer block package deletion forever", () => {
  it("a draft package with a RETIRED step now deletes cleanly (the WP-0012 case)", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    const stepId = `forge_wstep_ret_${pkg.id}`;
    await db.exec(`
      insert into forge_work_steps (owner_id, id, work_package_id, retired_at)
      values ('owner_1', '${stepId}', '${pkg.id}', now());
      insert into forge_work_step_order (owner_id, work_package_id)
      values ('owner_1', '${pkg.id}');
      insert into forge_work_step_revisions (owner_id, id, step_id)
      values ('owner_1', 'forge_wsrev_${pkg.id}', '${stepId}');
    `);

    expect(await callBlockers("owner_1", pkg.id)).toEqual([]);

    const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
    expect(result.ok).toBe(true);
    expect(await packageCount(pkg.id)).toBe(0);

    const remaining = await stepFamilyRowCounts(pkg.id);
    expect(remaining).toEqual({ steps: 0, order: 0, revisions: 0, links: 0 });
  });

  it("a draft package with an ACTIVE step still refuses cleanly, naming it (PR #770's own case, unchanged)", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    await db.exec(`
      insert into forge_work_steps (owner_id, id, work_package_id)
      values ('owner_1', 'forge_wstep_act_${pkg.id}', '${pkg.id}')
    `);

    expect(await callBlockers("owner_1", pkg.id)).toEqual([{ type: "steps", count: 1 }]);

    const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("blocked");
    expect(result.blockers).toEqual([{ type: "steps", count: 1 }]);
    expect(await packageCount(pkg.id)).toBe(1);
  });

  it("a package with one active and one retired step still blocks on the active one only", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    await db.exec(`
      insert into forge_work_steps (owner_id, id, work_package_id)
      values ('owner_1', 'forge_wstep_mix_act_${pkg.id}', '${pkg.id}');
      insert into forge_work_steps (owner_id, id, work_package_id, retired_at)
      values ('owner_1', 'forge_wstep_mix_ret_${pkg.id}', '${pkg.id}', now());
    `);
    expect(await callBlockers("owner_1", pkg.id)).toEqual([{ type: "steps", count: 1 }]);
    const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
    expect(result.error).toBe("blocked");
    expect(result.blockers).toEqual([{ type: "steps", count: 1 }]);
  });

  it("step_revisions of a RETIRED step no longer block (only active steps' revisions count)", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    const stepId = `forge_wstep_revret_${pkg.id}`;
    await db.exec(`
      insert into forge_work_steps (owner_id, id, work_package_id, retired_at)
      values ('owner_1', '${stepId}', '${pkg.id}', now());
      insert into forge_work_step_revisions (owner_id, id, step_id)
      values ('owner_1', 'forge_wsrev_ret_${pkg.id}', '${stepId}');
    `);
    expect(await callBlockers("owner_1", pkg.id)).toEqual([]);
    const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
    expect(result.ok).toBe(true);
  });

  it("step_drawing_links (retired or active) never throw a raw FK error on delete -- purged with the step", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    const stepId = `forge_wstep_link_${pkg.id}`;
    await db.exec(`
      insert into forge_work_steps (owner_id, id, work_package_id, retired_at)
      values ('owner_1', '${stepId}', '${pkg.id}', now());
      insert into forge_work_step_drawing_links (owner_id, id, work_package_id, step_id, drawing_id)
      values ('owner_1', 'forge_wsdl_${pkg.id}', '${pkg.id}', '${stepId}', null);
    `);
    // Blocker check passes (the step is retired); the delete RPC itself
    // must not hit the step_drawing_links -> forge_work_steps restrict FK.
    expect(await callBlockers("owner_1", pkg.id)).toEqual([]);
    const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
    expect(result.ok).toBe(true);
  });

  it("an all-retired step family fully disappears -- no orphaned steps/order/revisions/links survive the package", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    const stepId = `forge_wstep_full_${pkg.id}`;
    await db.exec(`
      insert into forge_work_steps (owner_id, id, work_package_id, retired_at)
      values ('owner_1', '${stepId}', '${pkg.id}', now());
      insert into forge_work_step_order (owner_id, work_package_id)
      values ('owner_1', '${pkg.id}');
      insert into forge_work_step_revisions (owner_id, id, step_id)
      values ('owner_1', 'forge_wsrev_full1_${pkg.id}', '${stepId}'),
             ('owner_1', 'forge_wsrev_full2_${pkg.id}', '${stepId}');
      insert into forge_work_step_drawing_links (owner_id, id, work_package_id, step_id, drawing_id)
      values ('owner_1', 'forge_wsdl_full_${pkg.id}', '${pkg.id}', '${stepId}', null);
    `);
    const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
    expect(result.ok).toBe(true);
    expect(await stepFamilyRowCounts(pkg.id)).toEqual({ steps: 0, order: 0, revisions: 0, links: 0 });
  });

  it("a truly empty draft still deletes and tombstones (no regression)", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
    expect(result.ok).toBe(true);
    expect(await packageCount(pkg.id)).toBe(0);
  });

  // Non-regression on 20261110040000's other 8 blocker types (spot-check;
  // that file's own suite is the authority for exhaustive coverage).
  const OTHER_BLOCKER_SPOT_CHECKS = [
    ["drawings", (id) => `insert into forge_work_drawings (owner_id, id, package_id) values ('owner_1', 'forge_wdwg_${id}', '${id}')`],
    ["permit_annotations", (id) => `insert into forge_work_permit_annotations (owner_id, id, work_package_id) values ('owner_1', 'forge_wpa_${id}', '${id}')`],
    ["craft_assignments", (id) => `insert into forge_work_craft_assignments (owner_id, id, work_package_id) values ('owner_1', 'forge_wca_${id}', '${id}')`],
    ["control_estimates", (id) => `insert into forge_work_control_estimates (owner_id, id, work_package_id) values ('owner_1', 'forge_wce_${id}', '${id}')`],
    ["change_orders", (id) => `insert into forge_work_change_orders (owner_id, id, work_package_id) values ('owner_1', 'forge_wco_${id}', '${id}')`],
    ["craft_rates", (id) => `insert into forge_work_craft_rates (owner_id, id, work_package_id) values ('owner_1', 'forge_wcr_${id}', '${id}')`],
  ];
  for (const [type, insertSql] of OTHER_BLOCKER_SPOT_CHECKS) {
    it(`(non-regression) still blocks on a ${type} record exactly as 20261110040000 established`, async () => {
      await asActor("owner_1", "owner_1");
      const pkg = await seedPackage("owner_1");
      await db.exec(insertSql(pkg.id));
      const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
      expect(result.error).toBe("blocked");
      expect(result.blockers).toEqual([{ type, count: 1 }]);
      expect(await packageCount(pkg.id)).toBe(1);
    });
  }

  it("re-applies idempotently (create or replace, no destructive statement)", async () => {
    expect(cleanupFixSql.toLowerCase()).not.toContain("on delete cascade");
    expect(cleanupFixSql.toLowerCase()).not.toContain("drop table");
    expect(cleanupFixSql.toLowerCase()).not.toContain("drop function");
    await expect(db.exec(cleanupFixSql)).resolves.toBeDefined();
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
    expect(result.ok).toBe(true);
  });
});
