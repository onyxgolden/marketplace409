// Follow-up to 20261110070000 (PR #774): that migration fixed the
// "retired-but-undeleted blocks deletion forever" dead end for steps. Its
// own header disclosed the identical pattern in five more tables --
// forge_work_permit_annotations, forge_work_craft_assignments,
// forge_work_control_estimates, forge_work_change_orders, and
// forge_work_craft_rates -- each with exactly one child (its own
// *_revisions table, ON DELETE RESTRICT back to the parent) and nothing
// else referencing it anywhere in the schema (verified by grepping every
// migration file for "references ... <table>" per table). This test
// applies 20261008030000 -> 20261110040000 -> 20261110070000 ->
// 20261111000000 in sequence and proves, for each of the five types: (1) a
// RETIRED row of that type no longer blocks deletion, (2) an ACTIVE row of
// that type still blocks exactly as before, (3) the retired row AND its
// revision rows are purged with the package, never orphaned, (4) nothing
// else regresses. forge_work_drawings' retire-due-to-review-history
// fallback is explicitly out of scope for this migration -- its own,
// materially more tangled graph is deferred as its own slice.

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const ORIGINAL_MIGRATION_PATH = new URL("../20261008030000_forge_work_package_deletions.sql", import.meta.url);
const BLOCKER_FIX_PATH = new URL("../20261110040000_forge_work_package_deletion_blocker_fix.sql", import.meta.url);
const STEP_CLEANUP_PATH = new URL("../20261110070000_forge_work_package_delete_retired_cleanup.sql", import.meta.url);
const RECORDS_CLEANUP_PATH = new URL("../20261111000000_forge_work_package_retired_records_cleanup_batch1.sql", import.meta.url);
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
const stepCleanupSql = readFileSync(STEP_CLEANUP_PATH, "utf8");
const recordsCleanupSql = readFileSync(RECORDS_CLEANUP_PATH, "utf8");
const rung1Sql = readFileSync(RUNG1_PATH, "utf8");
const nextNumberSql = extractFunction(
  rung1Sql,
  "create or replace function forge_work_next_package_number(p_owner_id text)",
);

// Same fixture shape as 20261110070000's own test, extended with the real
// *_revisions FK shape (ON DELETE RESTRICT) for each of the five new types
// -- the exact kind of omission that made PR #774's own first-round link
// test vacuous, not repeated here.
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
  create table forge_work_step_drawing_link_revisions (
    owner_id text not null, id text not null, link_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, link_id)
      references forge_work_step_drawing_links (owner_id, id) on delete restrict
  );

  -- The five types this migration fixes, each with the real retired_at
  -- column and the real revisions-table FK shape (ON DELETE RESTRICT).
  create table forge_work_permit_annotations (
    owner_id text not null, id text not null, work_package_id text not null,
    retired_at timestamptz,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_permit_annotation_revisions (
    owner_id text not null, id text not null, annotation_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, annotation_id) references forge_work_permit_annotations (owner_id, id) on delete restrict);

  create table forge_work_craft_assignments (
    owner_id text not null, id text not null, work_package_id text not null,
    retired_at timestamptz,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_craft_assignment_revisions (
    owner_id text not null, id text not null, assignment_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, assignment_id) references forge_work_craft_assignments (owner_id, id) on delete restrict);

  create table forge_work_control_estimates (
    owner_id text not null, id text not null, work_package_id text not null,
    retired_at timestamptz,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_control_estimate_revisions (
    owner_id text not null, id text not null, estimate_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, estimate_id) references forge_work_control_estimates (owner_id, id) on delete restrict);

  create table forge_work_change_orders (
    owner_id text not null, id text not null, work_package_id text not null,
    retired_at timestamptz,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_change_order_revisions (
    owner_id text not null, id text not null, change_order_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, change_order_id) references forge_work_change_orders (owner_id, id) on delete restrict);

  create table forge_work_craft_rates (
    owner_id text not null, id text not null, work_package_id text not null,
    retired_at timestamptz,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_craft_rate_revisions (
    owner_id text not null, id text not null, craft_rate_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, craft_rate_id) references forge_work_craft_rates (owner_id, id) on delete restrict);

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
  await db.exec(stepCleanupSql);
  await db.exec(recordsCleanupSql);
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

let seedCounter = 5000;
async function seedPackage(ownerId, overrides = {}) {
  seedCounter += 1;
  const id = overrides.id || `forge_wp_recc_${seedCounter}`;
  const code = overrides.code || `WP-RECC-${seedCounter}`;
  const status = overrides.status || "draft";
  const version = overrides.version ?? 1;
  await db.exec(`
    insert into forge_work_packages (owner_id, id, code, title, status, version)
    values ('${ownerId}', '${id}', '${code}', 'Retired-records-cleanup test ${seedCounter}', '${status}', ${version})
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

// One shape per type: parent table, its revisions table, and the
// revisions table's own FK column name back to the parent.
const TYPES = [
  { type: "permit_annotations", table: "forge_work_permit_annotations", revTable: "forge_work_permit_annotation_revisions", revCol: "annotation_id" },
  { type: "craft_assignments", table: "forge_work_craft_assignments", revTable: "forge_work_craft_assignment_revisions", revCol: "assignment_id" },
  { type: "control_estimates", table: "forge_work_control_estimates", revTable: "forge_work_control_estimate_revisions", revCol: "estimate_id" },
  { type: "change_orders", table: "forge_work_change_orders", revTable: "forge_work_change_order_revisions", revCol: "change_order_id" },
  { type: "craft_rates", table: "forge_work_craft_rates", revTable: "forge_work_craft_rate_revisions", revCol: "craft_rate_id" },
];

async function rowCounts(def, packageId) {
  const parent = await query(`select count(*)::int as count from ${def.table} where work_package_id = '${packageId}'`);
  const revisions = await query(`
    select count(*)::int as count from ${def.revTable}
    where ${def.revCol} in (select id from ${def.table} where work_package_id = '${packageId}')
  `);
  return { parent: parent[0].count, revisions: revisions[0].count };
}

describe("migration fix: retired permit annotations / craft assignments / control estimate / change orders / craft rates no longer block package deletion forever", () => {
  for (const def of TYPES) {
    describe(def.type, () => {
      it(`a draft package with a RETIRED ${def.type} row now deletes cleanly, purging it and its revision`, async () => {
        await asActor("owner_1", "owner_1");
        const pkg = await seedPackage("owner_1");
        const rowId = `forge_rec_ret_${pkg.id}`;
        await db.exec(`
          insert into ${def.table} (owner_id, id, work_package_id, retired_at)
          values ('owner_1', '${rowId}', '${pkg.id}', now());
          insert into ${def.revTable} (owner_id, id, ${def.revCol})
          values ('owner_1', 'forge_rec_rev_${pkg.id}', '${rowId}');
        `);

        expect(await callBlockers("owner_1", pkg.id)).toEqual([]);

        const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
        expect(result.ok).toBe(true);
        expect(await packageCount(pkg.id)).toBe(0);
        expect(await rowCounts(def, pkg.id)).toEqual({ parent: 0, revisions: 0 });
      });

      it(`a draft package with an ACTIVE ${def.type} row still refuses cleanly, naming it (non-regression on 20261110040000's own case)`, async () => {
        await asActor("owner_1", "owner_1");
        const pkg = await seedPackage("owner_1");
        const rowId = `forge_rec_act_${pkg.id}`;
        await db.exec(`
          insert into ${def.table} (owner_id, id, work_package_id)
          values ('owner_1', '${rowId}', '${pkg.id}')
        `);

        const blockers = await callBlockers("owner_1", pkg.id);
        expect(blockers).toEqual([{ type: def.type, count: 1 }]);

        const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
        expect(result.ok).toBe(false);
        expect(result.error).toBe("blocked");
        expect(result.blockers).toEqual([{ type: def.type, count: 1 }]);
        expect(await packageCount(pkg.id)).toBe(1);
        // Never reaches the purge -- the row must survive.
        expect((await rowCounts(def, pkg.id)).parent).toBe(1);
      });

      it(`one active and one retired ${def.type} row: blocks on the active one only`, async () => {
        await asActor("owner_1", "owner_1");
        const pkg = await seedPackage("owner_1");
        await db.exec(`
          insert into ${def.table} (owner_id, id, work_package_id)
          values ('owner_1', 'forge_rec_mixact_${pkg.id}', '${pkg.id}');
          insert into ${def.table} (owner_id, id, work_package_id, retired_at)
          values ('owner_1', 'forge_rec_mixret_${pkg.id}', '${pkg.id}', now());
        `);
        expect(await callBlockers("owner_1", pkg.id)).toEqual([{ type: def.type, count: 1 }]);
        const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
        expect(result.error).toBe("blocked");
        expect(result.blockers).toEqual([{ type: def.type, count: 1 }]);
      });

      it(`a revision row of a RETIRED ${def.type} row never throws the ON DELETE RESTRICT FK on delete (the real-schema case)`, async () => {
        await asActor("owner_1", "owner_1");
        const pkg = await seedPackage("owner_1");
        const rowId = `forge_rec_revret_${pkg.id}`;
        await db.exec(`
          insert into ${def.table} (owner_id, id, work_package_id, retired_at)
          values ('owner_1', '${rowId}', '${pkg.id}', now());
          insert into ${def.revTable} (owner_id, id, ${def.revCol})
          values ('owner_1', 'forge_rec_rev1_${pkg.id}', '${rowId}'),
                 ('owner_1', 'forge_rec_rev2_${pkg.id}', '${rowId}');
        `);
        expect(await callBlockers("owner_1", pkg.id)).toEqual([]);
        const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
        expect(result.ok).toBe(true);
        expect(await rowCounts(def, pkg.id)).toEqual({ parent: 0, revisions: 0 });
      });
    });
  }

  it("a truly empty draft still deletes and tombstones (no regression)", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
    expect(result.ok).toBe(true);
    expect(await packageCount(pkg.id)).toBe(0);
  });

  // Non-regression on 20261110070000's own step-family fix (spot-check;
  // that file's own suite is the authority for exhaustive coverage).
  it("(non-regression) a package with a RETIRED step still deletes cleanly (the 20261110070000 case)", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    await db.exec(`
      insert into forge_work_steps (owner_id, id, work_package_id, retired_at)
      values ('owner_1', 'forge_wstep_${pkg.id}', '${pkg.id}', now())
    `);
    const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
    expect(result.ok).toBe(true);
  });

  it("(non-regression) a package with an ACTIVE step still blocks exactly as before", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    await db.exec(`
      insert into forge_work_steps (owner_id, id, work_package_id)
      values ('owner_1', 'forge_wstep_act_${pkg.id}', '${pkg.id}')
    `);
    expect(await callBlockers("owner_1", pkg.id)).toEqual([{ type: "steps", count: 1 }]);
  });

  it("(non-regression) a package with an active drawing still blocks exactly as before (drawings fallback is out of scope here)", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    await db.exec(`
      insert into forge_work_drawings (owner_id, id, package_id)
      values ('owner_1', 'forge_wdwg_${pkg.id}', '${pkg.id}')
    `);
    expect(await callBlockers("owner_1", pkg.id)).toEqual([{ type: "drawings", count: 1 }]);
  });

  it("all five types retired simultaneously on one package: deletes cleanly, nothing orphaned", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    for (const def of TYPES) {
      const rowId = `forge_rec_all_${def.type}_${pkg.id}`;
      await db.exec(`
        insert into ${def.table} (owner_id, id, work_package_id, retired_at)
        values ('owner_1', '${rowId}', '${pkg.id}', now());
        insert into ${def.revTable} (owner_id, id, ${def.revCol})
        values ('owner_1', 'forge_rec_allrev_${def.type}_${pkg.id}', '${rowId}');
      `);
    }
    expect(await callBlockers("owner_1", pkg.id)).toEqual([]);
    const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
    expect(result.ok).toBe(true);
    for (const def of TYPES) {
      expect(await rowCounts(def, pkg.id)).toEqual({ parent: 0, revisions: 0 });
    }
  });

  it("re-applies idempotently (create or replace, no destructive statement)", async () => {
    expect(recordsCleanupSql.toLowerCase()).not.toContain("on delete cascade");
    expect(recordsCleanupSql.toLowerCase()).not.toContain("drop table");
    expect(recordsCleanupSql.toLowerCase()).not.toContain("drop function");
    await expect(db.exec(recordsCleanupSql)).resolves.toBeDefined();
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    const result = await callDelete("owner_1", pkg.id, pkg.version, pkg.code);
    expect(result.ok).toBe(true);
  });
});
