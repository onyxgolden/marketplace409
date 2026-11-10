// Work Package Planner slice 8 — migration/integration proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) and proves:
//   - Schema: exactly the six new tables (control estimates +
//     revisions, change orders + revisions, craft rates + revisions);
//     per-package sequential numbering with a database-level unique
//     constraint that is never reused, even across a retire; the
//     planned_cost_cents carry-over seeds a control estimate per
//     package that has a planned budget, with a 'create' revision;
//   - Snapshot RPC: one statement returns the estimate + change
//     orders + stored craft rates + planned labor hours per craft
//     from the active step plan, plus the count of active steps
//     carrying no labor-cost basis;
//   - Estimate RPCs: set (create then version-guarded update, reason
//     required), retire (version-guarded, then a fresh set starts at
//     version 1), terminal-package refusal;
//   - Change-order RPCs: create (numbering, type/description rules,
//     terminal refusal, workspace refusal), update (version guard,
//     reason rules, no-op update bumps nothing), the full status
//     machine (every legal step in order; every skip refused;
//     po_number required at po_requested+; denial_reason required at
//     denied; denied is terminal and never reachable from
//     po_approved), retire (version-guarded, then immutable);
//   - Cost math, proven with both types in one package: Deviation
//     draws from contingency and never touches the contract price;
//     every other counted type rolls into the running contract price;
//     only approved+ statuses count; estimated/denied never count;
//     canonical cost is approved, then estimated, then actual;
//     over-contingency raises the warning, never clamps;
//   - Labor roll-up: planned step hours at each craft's rate — the
//     $89/hr flat default, and an edited per-site rate — rolling
//     into the total job cost;
//   - RLS: owner isolation, co-owner access, anon sees nothing,
//     direct writes denied (RPC-only write path);
//   - Atomic audit: a failed mutation leaves no row and no revision;
//   - Slice-5 untouched: forge_work_step_create / update / retire
//     keep their exact bodies across the slice-8 apply;
//   - Effective ACL matrix for authenticated/anon/service_role, and
//     the default-privilege negative case.
// Roles, the auth.uid() stub, workspace_members, and the
// has_workspace_access() copy mirror production; the prerequisite
// packages/drawings/takeoff-lines tables are the minimal shapes the
// slice-3/4/5 foreign keys reference, plus the planned_cost_cents
// column the carry-over reads (mirroring the real 20261008020000
// migration) and the status column the terminal-package rule reads.
//
// A real-PostgreSQL subset (concurrent creates serialized by the
// package row lock, concurrent transitions on the same version, an
// uncommitted estimate edit invisible to the snapshot, ACL matrix,
// same-transaction audit rollback) runs against a scratch PG16
// cluster when the binaries exist, and SKIPS LOUDLY — never
// silently — when they do not. PGlite is single-connection, so it
// cannot prove concurrent-edit serialization; that leg exists only
// on real PG.

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { computeChangeOrderSummary } from "@/domains/work-management/changeOrders";
import { Client } from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const it60 = (name, fn) => it(name, fn, 60000);

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const MEMBER_C = "33333333-3333-4333-8333-333333333333";

const SLICE3 = "20261107000000_forge_work_package_permit_annotations_slice3.sql";
const SLICE4 = "20261107010000_forge_work_package_craft_assignments_slice4.sql";
const SLICE5 = "20261107020000_forge_work_package_work_steps_slice5.sql";
const SLICE8 = "20261109010000_forge_work_package_change_orders_slice8.sql";

function loadMigrationSql(name) {
  return readFileSync(join(HERE, "..", "..", "..", "supabase", "migrations", name), "utf8");
}

// Minimal prerequisite shape with the exact keys the slice-3/4/5
// foreign keys reference, plus the status column the terminal-package
// rule reads and the planned_cost_cents column the slice-8 carry-over
// reads (mirroring the real 20261008020000 migration).
const PREREQ_SQL = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select current_setting('app.test_uid', true)::uuid
  $$;
  create table workspace_members (
    owner_id text not null,
    member_user_id uuid not null,
    status text not null,
    role text not null
  );
  create or replace function public.has_workspace_access(p_owner_id text)
  returns boolean language sql stable security definer
  set search_path = public set row_security = off as $$
    select p_owner_id = auth.uid()::text
      or exists (
        select 1 from workspace_members
        where owner_id = p_owner_id
          and member_user_id = auth.uid()
          and status = 'active'
          and role = 'co_owner'
      );
  $$;
  revoke all on function public.has_workspace_access(text) from public;
  grant execute on function public.has_workspace_access(text) to authenticated;
  create table forge_work_packages (
    owner_id text not null,
    id text not null,
    status text not null default 'in_progress',
    planned_cost_cents bigint,
    primary key (owner_id, id)
  );
  create table forge_work_drawings (
    owner_id text not null,
    package_id text not null,
    id text not null,
    drawing_number text,
    drawing_type text,
    title text,
    p_id_drawing_id text,
    primary key (owner_id, id),
    unique (owner_id, package_id, id)
  );
  create table forge_work_takeoff_lines (
    owner_id text not null,
    id text not null,
    drawing_id text not null,
    line_no integer,
    primary key (owner_id, id)
  );
  grant select on forge_work_packages to authenticated;
  grant select on forge_work_drawings to authenticated;
  grant select on forge_work_takeoff_lines to authenticated;
`;

const SEED_SQL = `
  insert into forge_work_packages (owner_id, id, status, planned_cost_cents) values
    ('${OWNER_A}', 'pkg_a', 'in_progress', 250000),
    ('${OWNER_A}', 'pkg_cancelled', 'cancelled', 100000),
    ('${OWNER_A}', 'pkg_closed', 'verified_closed', 100000),
    ('${OWNER_A}', 'pkg_noplan', 'in_progress', null),
    ('${OWNER_B}', 'pkg_b', 'in_progress', null);
  insert into forge_work_drawings (owner_id, package_id, id, drawing_number, drawing_type, title, p_id_drawing_id) values
    ('${OWNER_A}', 'pkg_a', 'dwg_1', 'P-101', 'p_id', 'Main line', null),
    ('${OWNER_A}', 'pkg_a', 'dwg_2', 'C-201', 'cut_sheet', 'Spool sheet', null);
  insert into workspace_members (owner_id, member_user_id, status, role)
    values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
`;

// Slice-5 function bodies captured BEFORE the slice-8 apply, so the
// "slice 8 does not replace slice-5 functions" test compares real text.
let slice5BodiesBefore = null;

async function setupDb() {
  const db = new PGlite();
  await db.exec(PREREQ_SQL);
  // Apply the shipped files in timestamp order: slice 3, slice 4,
  // slice 5, then slice 8. The slice-5 bodies are captured between
  // slice 5 and slice 8.
  await db.exec(loadMigrationSql(SLICE3));
  await db.exec(loadMigrationSql(SLICE4));
  await db.exec(loadMigrationSql(SLICE5));
  // The seed packages must exist BEFORE the slice-8 apply: the
  // planned_cost_cents carry-over runs inside the migration, so it
  // can only see packages already in the table — exactly as in
  // production, where the packages predate the migration.
  await db.exec(SEED_SQL);
  const { rows } = await db.query(`
    select proname, prosrc from pg_proc
    where proname in ('forge_work_step_create', 'forge_work_step_update', 'forge_work_step_retire')
      and pronamespace = 'public'::regnamespace order by proname;
  `);
  slice5BodiesBefore = Object.fromEntries(rows.map((r) => [r.proname, r.prosrc]));
  await db.exec(loadMigrationSql(SLICE8));
  return db;
}

async function asRole(db, role, uid, sql) {
  await db.exec(`set role ${role}; set app.test_uid = '${uid}';`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec(`reset role;`);
  }
}

async function asUser(db, uid, sql) {
  return asRole(db, "authenticated", uid, sql);
}

function sqlStr(value) {
  return value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNum(value) {
  return value === null || value === undefined ? "null" : String(value);
}

async function createStep(db, uid, {
  packageId, title, craftLabel, durationDays, personHours, reason,
} = {}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_step_create(
      '${OWNER_A}', '${packageId ?? "pkg_a"}', ${sqlStr(title ?? "Fabricate pipe spool")},
      null, ${sqlStr(craftLabel ?? "Pipefitter")},
      ${sqlNum(durationDays === undefined ? 4 : durationDays)}, ${sqlNum(personHours === undefined ? 40 : personHours)},
      null, null, null, ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

// Maps the raw snapshot RPC result the way the application service
// does (snake_case rows -> camelCase), then runs the pure domain
// summary over it — so the test proves the full read path, RPC shape
// and running figures together.
function toCamelSnapshot(row) {
  const estimate = row?.estimate ?? null;
  return {
    packageStatus: row?.packageStatus ?? null,
    estimate: estimate ? {
      id: estimate.id,
      workPackageId: estimate.work_package_id,
      originalControlEstimateCents: estimate.original_control_estimate_cents,
      currentControlEstimateCents: estimate.current_estimate_cents,
      contingencyCents: estimate.contingency_cents,
      version: estimate.version,
    } : null,
    changeOrders: (row?.changeOrders ?? []).map((o) => ({
      id: o.id,
      changeOrderNumber: o.change_order_number,
      type: o.type,
      description: o.description,
      estimatedCostCents: o.estimated_cost_cents,
      approvedCostCents: o.approved_cost_cents,
      actualCostCents: o.actual_cost_cents,
      status: o.status,
      poNumber: o.po_number,
      denialReason: o.denial_reason,
      version: o.version,
    })),
    craftRates: (row?.craftRates ?? []).map((r) => ({
      id: r.id,
      craftKey: r.craft_key,
      craftLabel: r.craft_label,
      rateCentsPerHour: r.rate_cents_per_hour,
      version: r.version,
    })),
    craftHours: (row?.craftHours ?? []).map((h) => ({
      craftKey: h.craft_key,
      craftLabel: h.craft_label,
      plannedHours: h.planned_hours == null ? null : Number(h.planned_hours),
      stepCount: h.step_count ?? 0,
    })),
    stepsWithoutCraftHours: row?.stepsWithoutCraftHours ?? 0,
  };
}

function summarizeSnapshot(raw) {
  const camel = toCamelSnapshot(raw);
  const summary = computeChangeOrderSummary({
    estimate: camel.estimate,
    changeOrders: camel.changeOrders,
    craftHours: camel.craftHours,
    craftRates: camel.craftRates,
    stepsWithoutCraftHours: camel.stepsWithoutCraftHours,
  });
  return { ...summary, estimate: camel.estimate, changeOrders: camel.changeOrders, packageStatus: camel.packageStatus };
}

async function snapshot(db, uid, { packageId } = {}) {
  const { rows } = await asUser(db, uid, `
    select forge_work_change_orders_snapshot('${OWNER_A}', '${packageId ?? "pkg_a"}') as snap;
  `);
  return summarizeSnapshot(rows[0].snap);
}

async function setEstimate(db, uid, {
  packageId, originalCents, currentCents, contingencyCents, expectedVersion, reason,
} = {}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_control_estimate_set(
      '${OWNER_A}', '${packageId ?? "pkg_a"}',
      ${sqlNum(originalCents ?? null)}, ${sqlNum(currentCents ?? null)}, ${sqlNum(contingencyCents ?? null)},
      ${sqlNum(expectedVersion ?? null)}, ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function retireEstimate(db, uid, estimateId, { expectedVersion, reason } = {}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_control_estimate_retire(
      '${OWNER_A}', '${estimateId}', ${sqlNum(expectedVersion)}, ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function createCO(db, uid, {
  packageId, type, description, estimatedCostCents, reason,
} = {}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_change_order_create(
      '${OWNER_A}', '${packageId ?? "pkg_a"}', ${sqlStr(type ?? "bust")}, ${sqlStr(description ?? "Rework")},
      null, null, null, null, null,
      ${sqlNum(estimatedCostCents ?? null)}, null, null, null, null, null,
      ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function updateCO(db, uid, orderId, {
  expectedVersion, type, description, estimatedCostCents, approvedCostCents,
  actualCostCents, scheduleImpactDays, scheduleImpactNote, costCode, afeNo,
  referenceContractNo, referencePoNumber, initiatorName, poNumber, denialReason,
  linkedStepId, linkedDrawingId, linkedTakeoffLineId, reason,
} = {}) {
  // The update RPC takes interleaved p_set_* flags (slice-5 style): a
  // field is written only when its flag is true, so an explicit null
  // clears and an omitted field keeps.
  const set = (v) => (v === undefined ? "false" : "true");
  const { rows } = await asUser(db, uid, `
    select * from forge_work_change_order_update(
      '${OWNER_A}', '${orderId}', ${sqlNum(expectedVersion)},
      ${sqlStr(type ?? null)}, ${sqlStr(description ?? null)},
      ${sqlNum(estimatedCostCents ?? null)}, ${set(estimatedCostCents)},
      ${sqlNum(approvedCostCents ?? null)}, ${set(approvedCostCents)},
      ${sqlNum(actualCostCents ?? null)}, ${set(actualCostCents)},
      ${sqlNum(scheduleImpactDays ?? null)}, ${set(scheduleImpactDays)},
      ${sqlStr(scheduleImpactNote ?? null)}, ${set(scheduleImpactNote)},
      ${sqlStr(costCode ?? null)}, ${set(costCode)},
      ${sqlStr(afeNo ?? null)}, ${set(afeNo)},
      ${sqlStr(referenceContractNo ?? null)}, ${set(referenceContractNo)},
      ${sqlStr(referencePoNumber ?? null)}, ${set(referencePoNumber)},
      ${sqlStr(initiatorName ?? null)}, ${set(initiatorName)},
      ${sqlStr(poNumber ?? null)}, ${set(poNumber)},
      ${sqlStr(denialReason ?? null)}, ${set(denialReason)},
      ${sqlStr(linkedStepId ?? null)}, ${set(linkedStepId)},
      ${sqlStr(linkedDrawingId ?? null)}, ${set(linkedDrawingId)},
      ${sqlStr(linkedTakeoffLineId ?? null)}, ${set(linkedTakeoffLineId)},
      ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function transitionCO(db, uid, orderId, {
  expectedVersion, toStatus, poNumber, denialReason, approvedCostCents, reason,
} = {}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_change_order_transition(
      '${OWNER_A}', '${orderId}', ${sqlNum(expectedVersion)}, ${sqlStr(toStatus)},
      ${sqlStr(poNumber ?? null)}, ${sqlStr(denialReason ?? null)}, ${sqlNum(approvedCostCents ?? null)},
      ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function retireCO(db, uid, orderId, { expectedVersion, reason } = {}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_change_order_retire(
      '${OWNER_A}', '${orderId}', ${sqlNum(expectedVersion)}, ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function setRate(db, uid, {
  packageId, craftKey, craftLabel, rateCentsPerHour, expectedVersion, reason,
} = {}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_craft_rate_set(
      '${OWNER_A}', '${packageId ?? "pkg_a"}', ${sqlStr(craftKey ?? "pipefitter")},
      ${sqlStr(craftLabel ?? "Pipefitter")}, ${sqlNum(rateCentsPerHour ?? 10000)},
      ${sqlNum(expectedVersion ?? null)}, ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function retireRate(db, uid, rateId, { expectedVersion, reason } = {}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_craft_rate_retire(
      '${OWNER_A}', '${rateId}', ${sqlNum(expectedVersion)}, ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function estimateRows(db, packageId) {
  const { rows } = await db.query(`
    select * from forge_work_control_estimates
    where owner_id = '${OWNER_A}' and work_package_id = '${packageId}' order by created_at;
  `);
  return rows;
}

async function estimateRevisionRows(db, estimateId) {
  const { rows } = await db.query(`
    select * from forge_work_control_estimate_revisions
    where estimate_id = '${estimateId}' order by version;
  `);
  return rows;
}

async function orderRows(db, packageId) {
  const { rows } = await db.query(`
    select * from forge_work_change_orders
    where owner_id = '${OWNER_A}' and work_package_id = '${packageId}' order by change_order_number;
  `);
  return rows;
}

async function orderRevisionRows(db, orderId) {
  const { rows } = await db.query(`
    select * from forge_work_change_order_revisions
    where change_order_id = '${orderId}' order by version;
  `);
  return rows;
}

async function rateRows(db, packageId) {
  const { rows } = await db.query(`
    select * from forge_work_craft_rates
    where owner_id = '${OWNER_A}' and work_package_id = '${packageId}' order by craft_key;
  `);
  return rows;
}

describe("slice 8 migration: schema and planned-cost carry-over", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("creates exactly the six new tables and the nine callable functions", async () => {
    const { rows } = await db.query(`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and (table_name like '%control_estimate%' or table_name like '%change_order%' or table_name like '%craft_rate%')
      order by table_name;
    `);
    expect(rows.map((r) => r.table_name)).toEqual([
      "forge_work_change_order_revisions",
      "forge_work_change_orders",
      "forge_work_control_estimate_revisions",
      "forge_work_control_estimates",
      "forge_work_craft_rate_revisions",
      "forge_work_craft_rates",
    ]);
    const fns = await db.query(`
      select proname from pg_proc
      where (proname like '%change_order%' or proname like '%control_estimate%' or proname like '%craft_rate%')
        and proname not like '%_check_%'
        and pronamespace = 'public'::regnamespace
      order by proname;
    `);
    expect(fns.rows.map((r) => r.proname)).toEqual([
      "forge_work_change_order_create",
      "forge_work_change_order_retire",
      "forge_work_change_order_transition",
      "forge_work_change_order_update",
      "forge_work_change_orders_snapshot",
      "forge_work_control_estimate_retire",
      "forge_work_control_estimate_set",
      "forge_work_craft_rate_retire",
      "forge_work_craft_rate_set",
    ]);
    // The two check helpers are internal only: the migration revokes
    // PUBLIC execute, leaving only the owner (postgres) able to run
    // them — authenticated gets nothing.
    const helpers = await db.query(`
      select proname, proacl from pg_proc
      where proname like 'forge_work_change_order_check_%'
        and pronamespace = 'public'::regnamespace;
    `);
    expect(helpers.rows).toHaveLength(2);
    for (const helper of helpers.rows) {
      expect(helper.proacl).toEqual(["postgres=X/postgres"]);
    }
  });

  it60("seeds a control estimate from planned_cost_cents, with a create revision, and none where there is no planned cost", async () => {
    const rows = await estimateRows(db, "pkg_a");
    expect(rows).toHaveLength(1);
    expect(rows[0].original_control_estimate_cents).toBe(250000);
    expect(rows[0].current_estimate_cents).toBe(250000);
    expect(rows[0].contingency_cents).toBeNull();
    expect(rows[0].version).toBe(1);
    expect(rows[0].retired_at).toBeNull();
    const revisions = await estimateRevisionRows(db, rows[0].id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].action).toBe("create");
    expect(revisions[0].reason).toBe("Seeded from planned budget (slice 8 carry-over)");
    expect(revisions[0].new_values.original_control_estimate_cents).toBe(250000);
    expect(await estimateRows(db, "pkg_noplan")).toHaveLength(0);
    // The snapshot reads the seeded estimate.
    const snap = await snapshot(db, OWNER_A, {});
    expect(snap.hasEstimate).toBe(true);
    expect(snap.originalControlEstimateCents).toBe(250000);
    expect(snap.currentEstimateCents).toBe(250000);
    expect(snap.estimate.version).toBe(1);
    const noplan = await snapshot(db, OWNER_A, { packageId: "pkg_noplan" });
    expect(noplan.hasEstimate).toBe(false);
    expect(noplan.runningContractPriceCents).toBeNull();
    expect(noplan.totalJobCostCents).toBeNull();
  });

  it60("the snapshot is one statement: estimate + orders + rates + labor, with counts", async () => {
    await createStep(db, OWNER_A, { craftLabel: "Pipefitter", personHours: 40 });
    await createStep(db, OWNER_A, { craftLabel: "Welder", personHours: 20 });
    const order = await createCO(db, OWNER_A, { type: "bust", description: "Rework spool", estimatedCostCents: 10000 });
    const snap = await snapshot(db, OWNER_A, {});
    expect(snap.changeOrders).toHaveLength(1);
    expect(snap.changeOrders[0].changeOrderNumber).toBe(1);
    expect(snap.changeOrders[0].id).toBe(order.id);
    expect(snap.changeOrders[0].type).toBe("bust");
    expect(snap.changeOrders[0].status).toBe("estimated");
    expect(snap.countsByStatus.estimated).toBe(1);
    expect(snap.countsByStatus.approved).toBe(0);
    expect(snap.countsByStatus.denied).toBe(0);
    expect(snap.countsByStatus.po_approved).toBe(0);
    // Labor at the $89/hr default: 40h + 20h.
    expect(snap.laborByCraft).toHaveLength(2);
    const pipefitter = snap.laborByCraft.find((c) => c.craftKey === "pipefitter");
    expect(pipefitter.plannedHours).toBe(40);
    expect(pipefitter.rateCentsPerHour).toBe(8900);
    expect(pipefitter.isDefaultRate).toBe(true);
    expect(pipefitter.laborCostCents).toBe(356000);
    const welder = snap.laborByCraft.find((c) => c.craftKey === "welder");
    expect(welder.laborCostCents).toBe(178000);
    expect(snap.laborCostCents).toBe(534000);
    expect(snap.stepsWithoutCraftHours).toBe(0);
    expect(snap.warnings).toEqual([]);
    // Running contract price = current estimate + counted non-Deviation
    // (none counted yet) = 250000; total = contract + labor.
    expect(snap.runningContractPriceCents).toBe(250000);
    expect(snap.totalJobCostCents).toBe(784000);
  });

  it60("steps with no craft or no hours count as no-labor-basis and raise the warning", async () => {
    await createStep(db, OWNER_A, { craftLabel: "Pipefitter", personHours: 40 });
    await createStep(db, OWNER_A, { title: "Unassigned step", craftLabel: null, personHours: null });
    const snap = await snapshot(db, OWNER_A, {});
    expect(snap.stepsWithoutCraftHours).toBe(1);
    expect(snap.laborByCraft).toHaveLength(1);
    expect(snap.warnings).toHaveLength(1);
    expect(snap.warnings[0].code).toBe("steps_without_craft_hours");
    expect(snap.warnings[0].message).toMatch(/1 active step/);
  });

  it60("the snapshot refuses another owner's workspace and a missing package", async () => {
    await expect(snapshot(db, OWNER_B, {})).rejects.toThrow(/WPP8_WORKSPACE_FORBIDDEN/);
    await expect(snapshot(db, OWNER_A, { packageId: "pkg_missing" })).rejects.toThrow(/WPP8_PACKAGE_NOT_FOUND/);
  });
});

describe("slice 8 migration: control estimate RPCs", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("sets a fresh estimate at version 1, then updates it version-guarded with a reason", async () => {
    const created = await setEstimate(db, OWNER_A, {
      packageId: "pkg_noplan", originalCents: 100000, currentCents: 100000,
      contingencyCents: 20000, reason: "Budget approved",
    });
    expect(created.version).toBe(1);
    expect(created.original_control_estimate_cents).toBe(100000);
    expect(created.contingency_cents).toBe(20000);
    // No reason is refused.
    await expect(setEstimate(db, OWNER_A, {
      packageId: "pkg_noplan", originalCents: 110000, expectedVersion: 1,
    })).rejects.toThrow(/WPP8_REASON_REQUIRED/);
    // A stale version is refused.
    await expect(setEstimate(db, OWNER_A, {
      packageId: "pkg_noplan", originalCents: 110000, expectedVersion: 99, reason: "Revised",
    })).rejects.toThrow(/WPP8_VERSION_CONFLICT/);
    // A negative figure is refused.
    await expect(setEstimate(db, OWNER_A, {
      packageId: "pkg_noplan", originalCents: -1, expectedVersion: 1, reason: "Revised",
    })).rejects.toThrow(/WPP8_INVALID_COST/);
    const updated = await setEstimate(db, OWNER_A, {
      packageId: "pkg_noplan", originalCents: 110000, currentCents: 105000,
      expectedVersion: 1, reason: "Revised",
    });
    expect(updated.version).toBe(2);
    expect(updated.original_control_estimate_cents).toBe(110000);
    expect(updated.current_estimate_cents).toBe(105000);
    // Contingency was not passed: cleared to no pool (current is
    // the figure that keeps when it is not passed).
    expect(updated.contingency_cents).toBeNull();
    const revisions = await estimateRevisionRows(db, created.id);
    expect(revisions.map((r) => [r.version, r.action, r.reason])).toEqual([
      [1, "create", "Budget approved"],
      [2, "update", "Revised"],
    ]);
    // The update revision carries the OLD figures, not the new ones.
    expect(revisions[1].old_values.original_control_estimate_cents).toBe(100000);
    expect(revisions[1].new_values.original_control_estimate_cents).toBe(110000);
    expect(revisions[1].old_values.current_estimate_cents).toBe(100000);
    expect(revisions[1].new_values.current_estimate_cents).toBe(105000);
  });

  it60("a set with unchanged values still records a revision (no no-op special case, matching slice 5)", async () => {
    const before = await estimateRows(db, "pkg_a");
    const result = await setEstimate(db, OWNER_A, {
      originalCents: 250000, currentCents: 250000, expectedVersion: 1, reason: "Same figures",
    });
    // The RPCs do not special-case a no-op: the version bumps and an
    // 'update' revision is written, so the audit trail shows the save.
    expect(result.version).toBe(2);
    expect(before[0].version).toBe(1);
    const revisions = await estimateRevisionRows(db, before[0].id);
    expect(revisions).toHaveLength(2);
    expect(revisions[1].action).toBe("update");
    expect(revisions[1].reason).toBe("Same figures");
  });

  it60("retires version-guarded with a reason, and a fresh set after retire starts at version 1", async () => {
    const rows = await estimateRows(db, "pkg_a");
    await expect(retireEstimate(db, OWNER_A, rows[0].id, { expectedVersion: 1, reason: "  " }))
      .rejects.toThrow(/WPP8_REASON_REQUIRED/);
    await expect(retireEstimate(db, OWNER_A, rows[0].id, { expectedVersion: 99, reason: "Superseded" }))
      .rejects.toThrow(/WPP8_VERSION_CONFLICT/);
    const retired = await retireEstimate(db, OWNER_A, rows[0].id, { expectedVersion: 1, reason: "Superseded" });
    expect(retired.retired_at).not.toBeNull();
    expect(retired.version).toBe(2);
    const snap = await snapshot(db, OWNER_A, {});
    expect(snap.hasEstimate).toBe(false);
    await expect(retireEstimate(db, OWNER_A, rows[0].id, { expectedVersion: 2, reason: "Again" }))
      .rejects.toThrow(/WPP8_RETIRED/);
    const fresh = await setEstimate(db, OWNER_A, {
      originalCents: 300000, currentCents: 300000, reason: "Re-baselined",
    });
    expect(fresh.version).toBe(1);
    expect(fresh.id).not.toBe(rows[0].id);
    // The old estimate row stays retired in the table.
    const all = await estimateRows(db, "pkg_a");
    expect(all).toHaveLength(2);
    expect(all.find((e) => e.id === rows[0].id).retired_at).not.toBeNull();
  });

  it60("refuses estimate writes on terminal packages", async () => {
    await expect(setEstimate(db, OWNER_A, {
      packageId: "pkg_cancelled", originalCents: 1000, reason: "Too late",
    })).rejects.toThrow(/WPP8_PACKAGE_TERMINAL/);
  });

  it60("a failed estimate set leaves no row and no revision (atomic audit)", async () => {
    await expect(setEstimate(db, OWNER_A, {
      packageId: "pkg_noplan", originalCents: -5, reason: "Bad",
    })).rejects.toThrow(/WPP8_INVALID_COST/);
    expect(await estimateRows(db, "pkg_noplan")).toHaveLength(0);
    const { rows } = await db.query(`select count(*)::int as n from forge_work_control_estimate_revisions;`);
    expect(rows[0].n).toBe(3); // the three carry-over revisions (pkg_a, pkg_cancelled, pkg_closed)
  });
});

describe("slice 8 migration: change-order create and update", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("numbers per package from 1, never reuses a number across a retire, and keeps per-package sequences apart", async () => {
    const first = await createCO(db, OWNER_A, { description: "First" });
    const second = await createCO(db, OWNER_A, { description: "Second" });
    const third = await createCO(db, OWNER_A, { description: "Third" });
    expect([first, second, third].map((o) => o.change_order_number)).toEqual([1, 2, 3]);
    expect(first.version).toBe(1);
    expect(first.status).toBe("estimated");
    await retireCO(db, OWNER_A, second.id, { expectedVersion: 1, reason: "Duplicate" });
    // The next number is 4, not a reuse of 2 — and the live rows are 1 and 3.
    const fourth = await createCO(db, OWNER_A, { description: "Fourth" });
    expect(fourth.change_order_number).toBe(4);
    const rows = await orderRows(db, "pkg_a");
    expect(rows.filter((r) => r.retired_at === null).map((r) => r.change_order_number)).toEqual([1, 3, 4]);
    // A direct second live row with the same number violates the unique
    // constraint even for the table owner.
    await expect(db.query(`
      insert into forge_work_change_orders
        (owner_id, id, work_package_id, change_order_number, type, description, version, created_by, updated_by)
        values ('${OWNER_A}', 'forge_wco_direct', 'pkg_a', 1, 'bust', 'Direct', 1, 'u', 'u');
    `)).rejects.toThrow(/duplicate key/i);
    // Another package starts its own sequence at 1.
    const other = await createCO(db, OWNER_A, { packageId: "pkg_noplan", description: "Elsewhere" });
    expect(other.change_order_number).toBe(1);
  });

  it60("rejects a bad type, a blank description, a terminal package, and another owner's workspace", async () => {
    await expect(createCO(db, OWNER_A, { type: "explosion", description: "Nope" }))
      .rejects.toThrow(/WPP8_INVALID_TYPE/);
    await expect(createCO(db, OWNER_A, { description: "   " }))
      .rejects.toThrow(/WPP8_INVALID_DESCRIPTION/);
    await expect(createCO(db, OWNER_A, { packageId: "pkg_cancelled", description: "Too late" }))
      .rejects.toThrow(/WPP8_PACKAGE_TERMINAL/);
    await expect(createCO(db, OWNER_A, { packageId: "pkg_closed", description: "Too late" }))
      .rejects.toThrow(/WPP8_PACKAGE_TERMINAL/);
    await expect(createCO(db, OWNER_B, { description: "Not mine" }))
      .rejects.toThrow(/WPP8_WORKSPACE_FORBIDDEN/);
    expect(await orderRows(db, "pkg_a")).toHaveLength(0);
  });

  it60("a failed create leaves no row and no revision (atomic audit)", async () => {
    await expect(createCO(db, OWNER_A, { type: "bad", description: "Nope" }))
      .rejects.toThrow(/WPP8_INVALID_TYPE/);
    expect(await orderRows(db, "pkg_a")).toHaveLength(0);
    const { rows } = await db.query(`select count(*)::int as n from forge_work_change_order_revisions;`);
    expect(rows[0].n).toBe(0);
  });

  it60("updates version-guarded with a reason, and a no-op update bumps nothing", async () => {
    const order = await createCO(db, OWNER_A, { description: "Rework", estimatedCostCents: 10000 });
    await expect(updateCO(db, OWNER_A, order.id, { expectedVersion: 1, description: "Changed" }))
      .rejects.toThrow(/WPP8_REASON_REQUIRED/);
    await expect(updateCO(db, OWNER_A, order.id, { expectedVersion: 99, description: "Changed", reason: "Fix" }))
      .rejects.toThrow(/WPP8_VERSION_CONFLICT/);
    await expect(updateCO(db, OWNER_A, order.id, { expectedVersion: 1, description: "   ", reason: "Fix" }))
      .rejects.toThrow(/WPP8_INVALID_DESCRIPTION/);
    const updated = await updateCO(db, OWNER_A, order.id, {
      expectedVersion: 1, description: "Rework spool 7", approvedCostCents: 12000, reason: "Quoted",
    });
    expect(updated.version).toBe(2);
    expect(updated.description).toBe("Rework spool 7");
    expect(updated.approved_cost_cents).toBe(12000);
    // Estimated was not passed: kept, not cleared.
    expect(updated.estimated_cost_cents).toBe(10000);
    const revisions = await orderRevisionRows(db, order.id);
    expect(revisions.map((r) => [r.version, r.action, r.reason])).toEqual([
      [1, "create", null],
      [2, "update", "Quoted"],
    ]);
    expect(revisions[1].old_values.description).toBe("Rework");
    expect(revisions[1].new_values.description).toBe("Rework spool 7");
    expect(revisions[1].old_values.approved_cost_cents).toBeNull();
    expect(revisions[1].new_values.approved_cost_cents).toBe(12000);
    // No no-op special case here either (matching slice 5): the
    // unchanged save still bumps the version and writes a revision.
    const noop = await updateCO(db, OWNER_A, order.id, { expectedVersion: 2, reason: "Nothing changed" });
    expect(noop.version).toBe(3);
    const noopRevisions = await orderRevisionRows(db, order.id);
    expect(noopRevisions).toHaveLength(3);
    expect(noopRevisions[2].action).toBe("update");
    expect(noopRevisions[2].reason).toBe("Nothing changed");
  });

  it60("retires version-guarded with a reason, and a retired order is immutable", async () => {
    const order = await createCO(db, OWNER_A, { description: "Rework" });
    await expect(retireCO(db, OWNER_A, order.id, { expectedVersion: 1, reason: "  " }))
      .rejects.toThrow(/WPP8_REASON_REQUIRED/);
    const retired = await retireCO(db, OWNER_A, order.id, { expectedVersion: 1, reason: "Duplicate" });
    expect(retired.retired_at).not.toBeNull();
    expect(retired.version).toBe(2);
    await expect(updateCO(db, OWNER_A, order.id, { expectedVersion: 2, description: "Changed", reason: "Fix" }))
      .rejects.toThrow(/WPP8_RETIRED/);
    await expect(transitionCO(db, OWNER_A, order.id, { expectedVersion: 2, toStatus: "approved", reason: "Go" }))
      .rejects.toThrow(/WPP8_RETIRED/);
    await expect(retireCO(db, OWNER_A, order.id, { expectedVersion: 2, reason: "Again" }))
      .rejects.toThrow(/WPP8_RETIRED/);
    const snap = await snapshot(db, OWNER_A, {});
    expect(snap.changeOrders).toHaveLength(0);
    expect(snap.countsByStatus.estimated).toBe(0);
  });
});

describe("slice 8 migration: status machine", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("walks the full legal path in order, one version per step, with a revision each", async () => {
    const order = await createCO(db, OWNER_A, { description: "Rework", estimatedCostCents: 10000 });
    const steps = [
      { to: "approved", body: { approvedCostCents: 12000 }, expectStatus: "approved" },
      { to: "material_ordered", body: {}, expectStatus: "material_ordered" },
      { to: "requisition_filed", body: {}, expectStatus: "requisition_filed" },
      { to: "po_requested", body: { poNumber: "PO-7781" }, expectStatus: "po_requested" },
      { to: "po_approved", body: {}, expectStatus: "po_approved" },
    ];
    let version = 1;
    for (const step of steps) {
      const moved = await transitionCO(db, OWNER_A, order.id, {
        expectedVersion: version, toStatus: step.to, reason: `Move to ${step.to}`, ...step.body,
      });
      version += 1;
      expect(moved.status).toBe(step.expectStatus);
      expect(moved.version).toBe(version);
    }
    expect(version).toBe(6);
    const final = (await orderRows(db, "pkg_a"))[0];
    expect(final.status).toBe("po_approved");
    expect(final.po_number).toBe("PO-7781");
    expect(final.approved_cost_cents).toBe(12000);
    const revisions = await orderRevisionRows(db, order.id);
    expect(revisions.map((r) => [r.version, r.action])).toEqual([
      [1, "create"], [2, "status_change"], [3, "status_change"],
      [4, "status_change"], [5, "status_change"], [6, "status_change"],
    ]);
    expect(revisions[1].old_values.status).toBe("estimated");
    expect(revisions[1].new_values.status).toBe("approved");
    expect(revisions[1].new_values.approved_cost_cents).toBe(12000);
  });

  it60("refuses every state skip and every move from a terminal status", async () => {
    const order = await createCO(db, OWNER_A, { description: "Rework" });
    for (const skip of ["material_ordered", "requisition_filed", "po_requested", "po_approved", "denied"]) {
      if (skip === "denied") continue; // denied IS legal from estimated
      await expect(transitionCO(db, OWNER_A, order.id, { expectedVersion: 1, toStatus: skip, reason: "Skip" }))
        .rejects.toThrow(/WPP8_INVALID_TRANSITION/);
    }
    await expect(transitionCO(db, OWNER_A, order.id, { expectedVersion: 1, toStatus: "estimated", reason: "Back" }))
      .rejects.toThrow(/WPP8_INVALID_TRANSITION/);
    await expect(transitionCO(db, OWNER_A, order.id, { expectedVersion: 1, toStatus: "bogus", reason: "Bad" }))
      .rejects.toThrow(/WPP8_INVALID_STATUS/);
    // The failed moves left the order untouched: still version 1, estimated.
    const rows = await orderRows(db, "pkg_a");
    expect(rows[0].version).toBe(1);
    expect(rows[0].status).toBe("estimated");
    expect((await orderRevisionRows(db, order.id))).toHaveLength(1);
    // Deny it, then no move out of denied is legal.
    const denied = await transitionCO(db, OWNER_A, order.id, {
      expectedVersion: 1, toStatus: "denied", denialReason: "Not in scope", reason: "Deny",
    });
    expect(denied.status).toBe("denied");
    expect(denied.denial_reason).toBe("Not in scope");
    await expect(transitionCO(db, OWNER_A, order.id, { expectedVersion: 2, toStatus: "approved", reason: "Undo" }))
      .rejects.toThrow(/WPP8_INVALID_TRANSITION/);
    // And denied is not reachable from po_approved either.
    const second = await createCO(db, OWNER_A, { description: "Second" });
    let v = 1;
    for (const step of [
      { to: "approved", body: {} },
      { to: "material_ordered", body: {} },
      { to: "requisition_filed", body: {} },
      { to: "po_requested", body: { poNumber: "PO-1" } },
      { to: "po_approved", body: {} },
    ]) {
      const moved = await transitionCO(db, OWNER_A, second.id, {
        expectedVersion: v, toStatus: step.to, reason: "Go", ...step.body,
      });
      v = moved.version;
    }
    await expect(transitionCO(db, OWNER_A, second.id, {
      expectedVersion: v, toStatus: "denied", denialReason: "Too late", reason: "Deny",
    })).rejects.toThrow(/WPP8_INVALID_TRANSITION/);
  });

  it60("requires a PO number at po_requested and po_approved, and a denial reason at denied", async () => {
    const order = await createCO(db, OWNER_A, { description: "Rework" });
    await transitionCO(db, OWNER_A, order.id, { expectedVersion: 1, toStatus: "approved", reason: "Go" });
    await transitionCO(db, OWNER_A, order.id, { expectedVersion: 2, toStatus: "material_ordered", reason: "Go" });
    await transitionCO(db, OWNER_A, order.id, { expectedVersion: 3, toStatus: "requisition_filed", reason: "Go" });
    await expect(transitionCO(db, OWNER_A, order.id, { expectedVersion: 4, toStatus: "po_requested", reason: "Go" }))
      .rejects.toThrow(/WPP8_PO_NUMBER_REQUIRED/);
    await expect(transitionCO(db, OWNER_A, order.id, { expectedVersion: 4, toStatus: "po_requested", poNumber: "   ", reason: "Go" }))
      .rejects.toThrow(/WPP8_INVALID_FIELD/);
    const requested = await transitionCO(db, OWNER_A, order.id, {
      expectedVersion: 4, toStatus: "po_requested", poNumber: "PO-7781", reason: "Go",
    });
    expect(requested.po_number).toBe("PO-7781");
    // po_approved keeps the existing PO number when none is passed.
    const approved = await transitionCO(db, OWNER_A, order.id, { expectedVersion: 5, toStatus: "po_approved", reason: "Go" });
    expect(approved.po_number).toBe("PO-7781");
    // Denied without a reason is refused.
    const second = await createCO(db, OWNER_A, { description: "Second" });
    await expect(transitionCO(db, OWNER_A, second.id, { expectedVersion: 1, toStatus: "denied", reason: "Deny" }))
      .rejects.toThrow(/WPP8_DENIAL_REASON_REQUIRED/);
    await expect(transitionCO(db, OWNER_A, second.id, { expectedVersion: 1, toStatus: "denied", denialReason: "   ", reason: "Deny" }))
      .rejects.toThrow(/WPP8_INVALID_DENIAL_REASON/);
  });

  it60("a transition needs a reason and the right version, and refuses terminal packages", async () => {
    const order = await createCO(db, OWNER_A, { description: "Rework" });
    await expect(transitionCO(db, OWNER_A, order.id, { expectedVersion: 1, toStatus: "approved" }))
      .rejects.toThrow(/WPP8_REASON_REQUIRED/);
    await expect(transitionCO(db, OWNER_A, order.id, { expectedVersion: 99, toStatus: "approved", reason: "Go" }))
      .rejects.toThrow(/WPP8_VERSION_CONFLICT/);
    await expect(transitionCO(db, OWNER_B, order.id, { expectedVersion: 1, toStatus: "approved", reason: "Go" }))
      .rejects.toThrow(/WPP8_WORKSPACE_FORBIDDEN/);
    // A failed transition leaves no revision and no version bump.
    expect((await orderRevisionRows(db, order.id))).toHaveLength(1);
    expect((await orderRows(db, "pkg_a"))[0].version).toBe(1);
  });
});

describe("slice 8 migration: cost math — Deviation vs change order, counted vs excluded", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("Deviation draws from contingency only; other counted types roll into the running contract price; estimated/denied never count", async () => {
    // Estimate: original = current = $1,000, contingency $500.
    await setEstimate(db, OWNER_A, {
      originalCents: 100000, currentCents: 100000, contingencyCents: 50000,
      expectedVersion: 1, reason: "Set for test",
    });
    const bust = await createCO(db, OWNER_A, { type: "bust", description: "Shop bust", estimatedCostCents: 10000 });
    const deviation = await createCO(db, OWNER_A, { type: "deviation", description: "Field deviation", estimatedCostCents: 20000 });
    const pending = await createCO(db, OWNER_A, { type: "scope_addition", description: "Not yet approved", estimatedCostCents: 5000 });
    const denied = await createCO(db, OWNER_A, { type: "bust", description: "Refused", estimatedCostCents: 7000 });
    // Approve the bust (approved cost $120 — canonical cost is the
    // approved figure, not the $100 estimate) and the deviation.
    await transitionCO(db, OWNER_A, bust.id, { expectedVersion: 1, toStatus: "approved", approvedCostCents: 12000, reason: "Go" });
    await transitionCO(db, OWNER_A, deviation.id, { expectedVersion: 1, toStatus: "approved", reason: "Go" });
    await transitionCO(db, OWNER_A, denied.id, { expectedVersion: 1, toStatus: "denied", denialReason: "Out of scope", reason: "Deny" });

    const snap = await snapshot(db, OWNER_A, {});
    // Only the approved bust counts toward the contract price, at its
    // approved $120 — not its $100 estimate.
    expect(snap.countedNonDeviationCents).toBe(12000);
    // Only the approved deviation counts toward contingency.
    expect(snap.countedDeviationCents).toBe(20000);
    expect(snap.runningContractPriceCents).toBe(112000);
    expect(snap.contingencyRemainingCents).toBe(30000);
    expect(snap.totalJobCostCents).toBe(112000); // no labor steps yet
    expect(snap.countsByStatus).toEqual({
      estimated: 1, approved: 2, material_ordered: 0, requisition_filed: 0,
      po_requested: 0, po_approved: 0, denied: 1,
    });
    // The estimated scope change and the denied bust are both excluded.
    expect(snap.changeOrders.find((o) => o.id === pending.id).status).toBe("estimated");
    expect(snap.changeOrders.find((o) => o.id === denied.id).status).toBe("denied");
  });

  it60("canonical cost is approved, then estimated, then actual — and over-contingency warns, never clamps", async () => {
    await setEstimate(db, OWNER_A, {
      originalCents: 100000, currentCents: 100000, contingencyCents: 50000,
      expectedVersion: 1, reason: "Set for test",
    });
    // Estimated $80, approved $90, actual $95: the counted figure is $90.
    const first = await createCO(db, OWNER_A, { type: "bust", description: "First", estimatedCostCents: 8000 });
    await updateCO(db, OWNER_A, first.id, { expectedVersion: 1, actualCostCents: 9500, reason: "Actuals in" });
    await transitionCO(db, OWNER_A, first.id, { expectedVersion: 2, toStatus: "approved", approvedCostCents: 9000, reason: "Go" });
    // Estimated $80, no approved, actual $70: the counted figure is $80.
    const second = await createCO(db, OWNER_A, { type: "scope_addition", description: "Second", estimatedCostCents: 8000 });
    await updateCO(db, OWNER_A, second.id, { expectedVersion: 1, actualCostCents: 7000, reason: "Actuals in" });
    await transitionCO(db, OWNER_A, second.id, { expectedVersion: 2, toStatus: "approved", reason: "Go" });
    // A Deviation of $600 against a $500 pool: $100 over.
    const big = await createCO(db, OWNER_A, { type: "deviation", description: "Big deviation", estimatedCostCents: 60000 });
    await transitionCO(db, OWNER_A, big.id, { expectedVersion: 1, toStatus: "approved", reason: "Go" });

    const snap = await snapshot(db, OWNER_A, {});
    expect(snap.countedNonDeviationCents).toBe(17000);
    expect(snap.countedDeviationCents).toBe(60000);
    expect(snap.runningContractPriceCents).toBe(117000);
    expect(snap.contingencyRemainingCents).toBe(-10000);
    expect(snap.warnings).toHaveLength(1);
    expect(snap.warnings[0].code).toBe("contingency_overdrawn");
    expect(snap.warnings[0].message).toMatch(/overdrawn by \$100\.00/);
  });

  it60("no estimate means no running figures, even with counted change orders", async () => {
    const order = await createCO(db, OWNER_A, { packageId: "pkg_noplan", description: "Rework", estimatedCostCents: 10000 });
    await transitionCO(db, OWNER_A, order.id, { expectedVersion: 1, toStatus: "approved", reason: "Go" });
    const snap = await snapshot(db, OWNER_A, { packageId: "pkg_noplan" });
    expect(snap.countedNonDeviationCents).toBe(10000);
    expect(snap.runningContractPriceCents).toBeNull();
    expect(snap.totalJobCostCents).toBeNull();
  });
});

describe("slice 8 migration: labor roll-up at the $89 default and at an edited rate", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("planned hours at $89/hr by default, and an edited per-site rate replaces only that craft", async () => {
    await createStep(db, OWNER_A, { craftLabel: "Pipefitter", personHours: 40 });
    await createStep(db, OWNER_A, { craftLabel: "Pipefitter", personHours: 10 });
    await createStep(db, OWNER_A, { craftLabel: "Welder", personHours: 20 });
    const before = await snapshot(db, OWNER_A, {});
    expect(before.laborCostCents).toBe(623000); // 50h + 20h at $89
    expect(before.totalJobCostCents).toBe(250000 + 623000);

    const rate = await setRate(db, OWNER_A, {
      craftKey: "pipefitter", craftLabel: "Pipefitter", rateCentsPerHour: 10000, reason: "Site rate",
    });
    expect(rate.version).toBe(1);
    expect(rate.rate_cents_per_hour).toBe(10000);
    const after = await snapshot(db, OWNER_A, {});
    const pipefitter = after.laborByCraft.find((c) => c.craftKey === "pipefitter");
    expect(pipefitter.plannedHours).toBe(50);
    expect(pipefitter.rateCentsPerHour).toBe(10000);
    expect(pipefitter.isDefaultRate).toBe(false);
    expect(pipefitter.laborCostCents).toBe(500000);
    const welder = after.laborByCraft.find((c) => c.craftKey === "welder");
    expect(welder.isDefaultRate).toBe(true);
    expect(welder.laborCostCents).toBe(178000);
    expect(after.laborCostCents).toBe(678000);
    expect(after.totalJobCostCents).toBe(250000 + 678000);
  });

  it60("rate edits are version-guarded with a reason, validate the range, and revert to the default on retire", async () => {
    await createStep(db, OWNER_A, { craftLabel: "Pipefitter", personHours: 40 });
    await expect(setRate(db, OWNER_A, { craftKey: "pipefitter", rateCentsPerHour: 0, reason: "Free" }))
      .rejects.toThrow(/WPP8_INVALID_RATE/);
    await expect(setRate(db, OWNER_A, { craftKey: "pipefitter", rateCentsPerHour: 100001, reason: "Too much" }))
      .rejects.toThrow(/WPP8_INVALID_RATE/);
    await expect(setRate(db, OWNER_A, { craftKey: "pipefitter", rateCentsPerHour: 10000 }))
      .rejects.toThrow(/WPP8_REASON_REQUIRED/);
    const rate = await setRate(db, OWNER_A, { craftKey: "pipefitter", rateCentsPerHour: 10000, reason: "Site rate" });
    await expect(setRate(db, OWNER_A, {
      craftKey: "pipefitter", rateCentsPerHour: 11000, expectedVersion: 99, reason: "Again",
    })).rejects.toThrow(/WPP8_VERSION_CONFLICT/);
    const edited = await setRate(db, OWNER_A, {
      craftKey: "pipefitter", rateCentsPerHour: 11000, expectedVersion: 1, reason: "Revised",
    });
    expect(edited.version).toBe(2);
    expect(edited.rate_cents_per_hour).toBe(11000);
    const { rows } = await db.query(`
      select * from forge_work_craft_rate_revisions where craft_rate_id = '${rate.id}' order by version;
    `);
    expect(rows.map((r) => [r.version, r.action])).toEqual([[1, "create"], [2, "update"]]);
    expect(rows[1].old_values.rate_cents_per_hour).toBe(10000);
    expect(rows[1].new_values.rate_cents_per_hour).toBe(11000);
    // Retire: the stored row goes away from the snapshot, the craft
    // falls back to the $89 default, and the audit row stays.
    const retired = await retireRate(db, OWNER_A, rate.id, { expectedVersion: 2, reason: "Back to default" });
    expect(retired.retired_at).not.toBeNull();
    const snap = await snapshot(db, OWNER_A, {});
    const pipefitter = snap.laborByCraft.find((c) => c.craftKey === "pipefitter");
    expect(pipefitter.isDefaultRate).toBe(true);
    expect(pipefitter.rateCentsPerHour).toBe(8900);
    expect(pipefitter.laborCostCents).toBe(356000);
    await expect(retireRate(db, OWNER_A, rate.id, { expectedVersion: 3, reason: "Again" }))
      .rejects.toThrow(/WPP8_RETIRED/);
    // Craft keys are normalized: "Pipe Fitter" and "pipefitter" are one row.
    const normalized = await setRate(db, OWNER_A, { craftKey: "Pipe Fitter", rateCentsPerHour: 9500, reason: "Spelling" });
    expect(normalized.craft_key).toBe("pipe-fitter");
  });

  it60("rate writes refuse terminal packages and another owner's workspace", async () => {
    await expect(setRate(db, OWNER_A, { packageId: "pkg_cancelled", craftKey: "pipefitter", reason: "Too late" }))
      .rejects.toThrow(/WPP8_PACKAGE_TERMINAL/);
    await expect(setRate(db, OWNER_B, { craftKey: "pipefitter", reason: "Not mine" }))
      .rejects.toThrow(/WPP8_WORKSPACE_FORBIDDEN/);
  });

  it60("201 revisions page exactly with no duplicates and no missing rows", async () => {
    const rate = await setRate(db, OWNER_A, { craftKey: "pipefitter", rateCentsPerHour: 10000, reason: "Site rate" });
    const values = [];
    for (let v = 2; v <= 201; v++) {
      values.push(`('${OWNER_A}', 'forge_wcrr_seed_${v}', '${rate.id}', ${v}, '${OWNER_A}', 'update', '{}', '{}', null)`);
    }
    await db.query(`
      insert into forge_work_craft_rate_revisions
        (owner_id, id, craft_rate_id, version, actor_id, action, old_values, new_values, reason)
      values ${values.join(",")};
    `);
    const seen = [];
    for (let offset = 0; offset < 201; offset += 50) {
      const { rows } = await db.query(`
        select version from forge_work_craft_rate_revisions
        where owner_id = '${OWNER_A}' and craft_rate_id = '${rate.id}'
        order by version asc, id asc
        limit 50 offset ${offset};
      `);
      expect(rows.length).toBeLessThanOrEqual(50);
      seen.push(...rows.map((r) => r.version));
    }
    expect(seen).toHaveLength(201);
    expect(new Set(seen).size).toBe(201);
    expect(seen).toEqual(Array.from({ length: 201 }, (_, i) => i + 1));
  });
});

describe("slice 8 migration: slice-5 functions untouched", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("the slice-8 apply does not change the slice-5 step function bodies", async () => {
    const { rows } = await db.query(`
      select proname, prosrc from pg_proc
      where proname in ('forge_work_step_create', 'forge_work_step_update', 'forge_work_step_retire')
        and pronamespace = 'public'::regnamespace order by proname;
    `);
    expect(Object.fromEntries(rows.map((r) => [r.proname, r.prosrc]))).toEqual(slice5BodiesBefore);
  });

  it60("the slice-5 functions keep their exact signatures (no overload was created)", async () => {
    const { rows } = await db.query(`
      select proname, pg_get_function_identity_arguments(oid) as args
      from pg_proc where proname in ('forge_work_step_create', 'forge_work_step_update', 'forge_work_step_retire')
        and pronamespace = 'public'::regnamespace;
    `);
    expect(rows).toHaveLength(3);
    const create = rows.find((r) => r.proname === "forge_work_step_create");
    expect(create.args).toBe("p_owner_id text, p_package_id text, p_title text, p_description text, p_craft_label text, p_planned_duration_days integer, p_planned_person_hours numeric, p_source_note text, p_supersedes_step_id text, p_insert_at integer, p_reason text");
    const update = rows.find((r) => r.proname === "forge_work_step_update");
    expect(update.args).toBe("p_owner_id text, p_step_id text, p_expected_version integer, p_title text, p_description text, p_craft_label text, p_planned_duration_days integer, p_planned_person_hours numeric, p_source_note text, p_set_description boolean, p_set_craft_label boolean, p_set_duration_days boolean, p_set_person_hours boolean, p_set_source_note boolean, p_historical_correction boolean, p_reason text");
    const retire = rows.find((r) => r.proname === "forge_work_step_retire");
    expect(retire.args).toBe("p_owner_id text, p_step_id text, p_expected_version integer, p_reason text, p_historical_correction boolean");
  });

  it60("a step edit still works after the slice-8 apply and moves the labor roll-up", async () => {
    const step = await createStep(db, OWNER_A, { craftLabel: "Pipefitter", personHours: 40 });
    const { rows } = await asUser(db, OWNER_A, `
      select * from forge_work_step_update(
        '${OWNER_A}', '${step.id}', 1, null, null, null, null, 50, null,
        false, false, false, true, false, false, 'More hours');
    `);
    expect(rows[0].planned_person_hours).toBe("50.00");
    expect(rows[0].version).toBe(2);
    const snap = await snapshot(db, OWNER_A, {});
    expect(snap.laborCostCents).toBe(445000); // 50h at $89
  });
});

describe("slice 8 migration: RLS and ACL", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("owner isolation: another owner sees nothing, a co-owner sees the rows, anon sees nothing", async () => {
    await createCO(db, OWNER_A, { description: "Rework" });
    await setRate(db, OWNER_A, { craftKey: "pipefitter", rateCentsPerHour: 10000, reason: "Site rate" });
    for (const table of [
      "forge_work_control_estimates",
      "forge_work_control_estimate_revisions",
      "forge_work_change_orders",
      "forge_work_change_order_revisions",
      "forge_work_craft_rates",
      "forge_work_craft_rate_revisions",
    ]) {
      const asOther = await asUser(db, OWNER_B, `select * from ${table};`);
      expect(asOther.rows).toHaveLength(0);
      const asCoOwner = await asUser(db, MEMBER_C, `select * from ${table};`);
      expect(asCoOwner.rows.length).toBeGreaterThan(0);
    }
    // Anon has no policy and no grant: the select is denied outright.
    await expect(
      asRole(db, "anon", OWNER_A, `select * from forge_work_change_orders;`),
    ).rejects.toThrow(/permission denied/i);
  });

  it60("direct writes as authenticated are denied on every new table — the RPCs are the only write path", async () => {
    for (const [table, columns, values] of [
      ["forge_work_control_estimates", "(owner_id, id, work_package_id, original_control_estimate_cents, current_estimate_cents, version, created_by, updated_by)",
        `('${OWNER_A}', 'forge_wce_direct', 'pkg_a', 1, 1, 1, 'u', 'u')`],
      ["forge_work_change_orders", "(owner_id, id, work_package_id, change_order_number, type, description, version, created_by, updated_by)",
        `('${OWNER_A}', 'forge_wco_direct', 'pkg_a', 99, 'bust', 'Direct', 1, 'u', 'u')`],
      ["forge_work_craft_rates", "(owner_id, id, work_package_id, craft_key, craft_label, rate_cents_per_hour, version, created_by, updated_by)",
        `('${OWNER_A}', 'forge_wcr_direct', 'pkg_a', 'pipefitter', 'Pipefitter', 10000, 1, 'u', 'u')`],
    ]) {
      await expect(asUser(db, OWNER_A, `
        insert into ${table} ${columns} values ${values};
      `)).rejects.toThrow(/42501|permission denied|policy/i);
      await expect(asUser(db, OWNER_A, `update ${table} set version = 99 where owner_id = '${OWNER_A}';`))
        .rejects.toThrow(/42501|permission denied|policy/i);
      await expect(asUser(db, OWNER_A, `delete from ${table} where owner_id = '${OWNER_A}';`))
        .rejects.toThrow(/42501|permission denied|policy/i);
    }
    // Revision tables take no direct inserts either.
    await expect(asUser(db, OWNER_A, `
      insert into forge_work_change_order_revisions
        (owner_id, id, change_order_id, version, actor_id, action, old_values, new_values, reason)
        values ('${OWNER_A}', 'forge_wcor_direct', 'forge_wco_x', 1, 'u', 'create', '{}', '{}', null);
    `)).rejects.toThrow(/42501|permission denied|policy/i);
  });

  it60("effective privileges: authenticated reads and executes, anon and service_role get nothing", async () => {
    for (const table of [
      "forge_work_control_estimates",
      "forge_work_control_estimate_revisions",
      "forge_work_change_orders",
      "forge_work_change_order_revisions",
      "forge_work_craft_rates",
      "forge_work_craft_rate_revisions",
    ]) {
      const { rows } = await db.query(`
        select has_table_privilege('authenticated', 'public.${table}', 'SELECT') as can_select,
               has_table_privilege('authenticated', 'public.${table}', 'INSERT') as can_insert,
               has_table_privilege('authenticated', 'public.${table}', 'UPDATE') as can_update,
               has_table_privilege('authenticated', 'public.${table}', 'DELETE') as can_delete,
               has_table_privilege('anon', 'public.${table}', 'SELECT') as anon_select,
               has_table_privilege('service_role', 'public.${table}', 'SELECT') as sr_select;
      `);
      expect(rows[0]).toEqual({
        can_select: true, can_insert: false, can_update: false, can_delete: false,
        anon_select: false, sr_select: false,
      });
    }
    for (const fn of [
      "forge_work_change_orders_snapshot(text, text)",
      "forge_work_control_estimate_set(text, text, bigint, bigint, bigint, integer, text)",
      "forge_work_control_estimate_retire(text, text, integer, text)",
      "forge_work_change_order_create(text, text, text, text, text, text, text, text, text, bigint, integer, text, text, text, text, text)",
      "forge_work_change_order_update(text, text, integer, text, text, bigint, boolean, bigint, boolean, bigint, boolean, integer, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text)",
      "forge_work_change_order_transition(text, text, integer, text, text, text, bigint, text)",
      "forge_work_change_order_retire(text, text, integer, text)",
      "forge_work_craft_rate_set(text, text, text, text, bigint, integer, text)",
      "forge_work_craft_rate_retire(text, text, integer, text)",
    ]) {
      const { rows } = await db.query(`
        select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') as auth_exec,
               has_function_privilege('anon', 'public.${fn}', 'EXECUTE') as anon_exec,
               has_function_privilege('service_role', 'public.${fn}', 'EXECUTE') as sr_exec,
               has_function_privilege('public', 'public.${fn}', 'EXECUTE') as public_exec;
      `);
      expect(rows[0]).toEqual({ auth_exec: true, anon_exec: false, sr_exec: false, public_exec: false });
    }
  });

  it60("the shipped SQL states the explicit revokes and the forced RLS, takes no caller-supplied actor, and seeds no contractor rates", async () => {
    const sql = loadMigrationSql(SLICE8);
    for (const fn of [
      "forge_work_change_orders_snapshot(text, text)",
      "forge_work_control_estimate_set(text, text, bigint, bigint, bigint, integer, text)",
      "forge_work_control_estimate_retire(text, text, integer, text)",
      "forge_work_change_order_create(text, text, text, text, text, text, text, text, text, bigint, integer, text, text, text, text, text)",
      "forge_work_change_order_update(text, text, integer, text, text, bigint, boolean, bigint, boolean, bigint, boolean, integer, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text)",
      "forge_work_change_order_transition(text, text, integer, text, text, text, bigint, text)",
      "forge_work_change_order_retire(text, text, integer, text)",
      "forge_work_craft_rate_set(text, text, text, text, bigint, integer, text)",
      "forge_work_craft_rate_retire(text, text, integer, text)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${fn} from public`);
      expect(sql).toContain(`grant execute on function public.${fn} to authenticated`);
    }
    expect(sql).toContain("force row level security");
    expect(sql).not.toMatch(/p_actor/);
    expect(sql).toContain("auth.uid()");
    // The flat $89 default lives in exactly one place; no contractor
    // rate table is seeded from Appendix C or anywhere else.
    expect(sql).toMatch(/8900/);
    expect(sql).not.toMatch(/appendix/i);
    expect(sql).not.toMatch(/contractor_rate/i);
    // The carry-over reads planned_cost_cents from the PACKAGE, never
    // from the steps table (which has no such column).
    expect(sql).toContain("from public.forge_work_packages");
    expect(sql).not.toMatch(/forge_work_steps[\s\S]{0,200}planned_cost_cents/);
  });
});

// Real-PostgreSQL subset. PGlite is single-connection, so the
// concurrent-edit serialization legs can only run here, against a
// scratch PG16 cluster. The suite is gated on the binaries existing
// AND an unprivileged user to run the cluster as (initdb refuses
// root, and this VM's agent runs as root) — and SKIPS LOUDLY, never
// silently, when either is missing.
const PG_BIN = "/usr/lib/postgresql/16/bin";
function detectRealPgUser() {
  try {
    execSync(`ls ${PG_BIN}/initdb ${PG_BIN}/pg_ctl`, { stdio: "ignore" });
    execSync("which runuser", { stdio: "ignore" });
  } catch {
    return null;
  }
  for (const user of ["postgres", "nobody"]) {
    try {
      execSync(`id ${user}`, { stdio: "ignore" });
      return user;
    } catch { /* try the next user */ }
  }
  return null;
}
const PG_RUN_USER = detectRealPgUser();
const HAS_REAL_PG = PG_RUN_USER !== null;
if (!HAS_REAL_PG) {
  console.warn(
    "⚠️ LOUD SKIP: real-PostgreSQL subset SKIPPED — PG16 binaries or an unprivileged "
    + "user to run them as (initdb refuses root) were not found. "
    + "The PGlite battery still runs; run the real-PG leg where PG16 exists.",
  );
}

describe.skipIf(!HAS_REAL_PG)("slice 8 migration: real-PostgreSQL subset", () => {
  let pgDir;
  let pgClient;
  let pgCfg;

  beforeAll(async () => {
    pgDir = mkdtempSync(join(tmpdir(), "wpp8-realpg-"));
    execSync(`chown ${PG_RUN_USER}:${PG_RUN_USER} "${pgDir}"`, { stdio: "pipe" });
    const asPgUser = (cmd) => `runuser -u ${PG_RUN_USER} -- ${cmd}`;
    execSync(asPgUser(`"${PG_BIN}/initdb" -D "${pgDir}" -U postgres --auth=trust`), { stdio: "pipe" });
    execSync(
      asPgUser(`"${PG_BIN}/pg_ctl" -D "${pgDir}" -o "-p 55434 -k ${pgDir} -c listen_addresses=''" -l "${pgDir}/server.log" start`),
      { stdio: "pipe" },
    );
    pgCfg = { host: pgDir, port: 55434, user: "postgres", database: "postgres" };
    pgClient = new Client(pgCfg);
    await pgClient.connect();
    await pgClient.query(PREREQ_SQL);
    await pgClient.query(loadMigrationSql(SLICE3));
    await pgClient.query(loadMigrationSql(SLICE4));
    await pgClient.query(loadMigrationSql(SLICE5));
    // Packages first: the slice-8 carry-over runs inside the
    // migration, so it can only see packages already in the table.
    await pgClient.query(`
      insert into forge_work_packages (owner_id, id, status, planned_cost_cents) values
        ('${OWNER_A}', 'pkg_real', 'in_progress', 250000),
        ('${OWNER_A}', 'pkg_real_b', 'in_progress', null),
        ('${OWNER_A}', 'pkg_real_c', 'in_progress', null);
      insert into workspace_members (owner_id, member_user_id, status, role)
        values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
    `);
    await pgClient.query(loadMigrationSql(SLICE8));
  }, 120000);

  afterAll(async () => {
    try { await pgClient?.end(); } catch { /* already closed */ }
    if (pgDir) {
      try { execSync(`runuser -u ${PG_RUN_USER} -- "${PG_BIN}/pg_ctl" -D "${pgDir}" stop -m fast`, { stdio: "pipe" }); } catch { /* already stopped */ }
      rmSync(pgDir, { recursive: true, force: true });
    }
  }, 120000);

  async function pgAsUser(client, uid, sql) {
    await client.query(`set role authenticated; set app.test_uid = '${uid}';`);
    try {
      return await client.query(sql);
    } finally {
      await client.query(`reset role;`);
    }
  }

  async function pgCreateStep(uid, packageId, { durationDays = 4, personHours = 40 } = {}) {
    const { rows } = await pgAsUser(pgClient, uid, `
      select * from forge_work_step_create(
        '${OWNER_A}', '${packageId}', 'Fabricate pipe spool', null, 'Pipefitter',
        ${durationDays}, ${personHours}, null, null, null, null);
    `);
    return rows[0];
  }

  async function pgSnapshot(uid, packageId) {
    const { rows } = await pgAsUser(pgClient, uid, `
      select forge_work_change_orders_snapshot('${OWNER_A}', '${packageId}') as snap;
    `);
    return summarizeSnapshot(rows[0].snap);
  }

  it60("concurrent change-order creates on the same package serialize: both succeed, numbers 1 and 2, no duplicate", async () => {
    const create = (client, description) => pgAsUser(client, OWNER_A, `
      select * from forge_work_change_order_create(
        '${OWNER_A}', 'pkg_real', 'bust', '${description}',
        null, null, null, null, null, null, null, null, null, null, null, null);
    `);
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const results = await Promise.allSettled([create(clientA, "First"), create(clientB, "Second")]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
      const numbers = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value.rows[0].change_order_number)
        .sort();
      expect(numbers).toEqual([1, 2]);
      const { rows } = await pgClient.query(`
        select change_order_number from forge_work_change_orders
        where owner_id = '${OWNER_A}' and work_package_id = 'pkg_real' order by change_order_number;
      `);
      expect(rows.map((r) => r.change_order_number)).toEqual([1, 2]);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("concurrent transitions on the same version: one wins, the other gets VERSION_CONFLICT", async () => {
    const { rows } = await pgAsUser(pgClient, OWNER_A, `
      select * from forge_work_change_order_create(
        '${OWNER_A}', 'pkg_real_b', 'bust', 'Race order',
        null, null, null, null, null, null, null, null, null, null, null, null);
    `);
    const order = rows[0];
    expect(order.version).toBe(1);
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const move = (client) => pgAsUser(client, OWNER_A, `
        select * from forge_work_change_order_transition(
          '${OWNER_A}', '${order.id}', 1, 'approved', null, null, null, 'Race move');
      `);
      const results = await Promise.allSettled([move(clientA), move(clientB)]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toMatch(/WPP8_VERSION_CONFLICT/);
      const { rows: after } = await pgClient.query(`
        select status, version from forge_work_change_orders
        where owner_id = '${OWNER_A}' and id = '${order.id}';
      `);
      expect(after).toHaveLength(1);
      expect(after[0].status).toBe("approved");
      expect(after[0].version).toBe(2);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("an uncommitted estimate edit is invisible to the snapshot, and visible after commit", async () => {
    const before = await pgSnapshot(OWNER_A, "pkg_real");
    expect(before.currentEstimateCents).toBe(250000);
    expect(before.estimate.version).toBe(1);
    const writer = new Client(pgCfg);
    await writer.connect();
    try {
      await writer.query("begin");
      await pgAsUser(writer, OWNER_A, `
        select * from forge_work_control_estimate_set(
          '${OWNER_A}', 'pkg_real', 300000, 300000, null, 1, 'Bump');
      `);
      // The writer's change is uncommitted: a concurrent snapshot must
      // still see the old estimate — never a mix.
      const during = await pgSnapshot(OWNER_A, "pkg_real");
      expect(during.currentEstimateCents).toBe(250000);
      expect(during.estimate.version).toBe(1);
      await writer.query("commit");
    } finally {
      await writer.end().catch(() => {});
    }
    const after = await pgSnapshot(OWNER_A, "pkg_real");
    expect(after.currentEstimateCents).toBe(300000);
    expect(after.estimate.version).toBe(2);
  });

  it60("ACL matrix on real PG: authenticated reads and executes, anon and service_role get nothing", async () => {
    for (const table of [
      "forge_work_control_estimates",
      "forge_work_control_estimate_revisions",
      "forge_work_change_orders",
      "forge_work_change_order_revisions",
      "forge_work_craft_rates",
      "forge_work_craft_rate_revisions",
    ]) {
      const { rows } = await pgClient.query(`
        select has_table_privilege('authenticated', 'public.${table}', 'SELECT') as can_select,
               has_table_privilege('authenticated', 'public.${table}', 'INSERT') as can_insert,
               has_table_privilege('anon', 'public.${table}', 'SELECT') as anon_select,
               has_table_privilege('service_role', 'public.${table}', 'SELECT') as sr_select;
      `);
      expect(rows[0]).toEqual({ can_select: true, can_insert: false, anon_select: false, sr_select: false });
    }
    for (const fn of [
      "forge_work_change_orders_snapshot(text, text)",
      "forge_work_control_estimate_set(text, text, bigint, bigint, bigint, integer, text)",
      "forge_work_change_order_create(text, text, text, text, text, text, text, text, text, bigint, integer, text, text, text, text, text)",
      "forge_work_change_order_transition(text, text, integer, text, text, text, bigint, text)",
      "forge_work_craft_rate_set(text, text, text, text, bigint, integer, text)",
    ]) {
      const { rows } = await pgClient.query(`
        select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') as auth_exec,
               has_function_privilege('anon', 'public.${fn}', 'EXECUTE') as anon_exec,
               has_function_privilege('service_role', 'public.${fn}', 'EXECUTE') as sr_exec,
               has_function_privilege('public', 'public.${fn}', 'EXECUTE') as public_exec;
      `);
      expect(rows[0]).toEqual({ auth_exec: true, anon_exec: false, sr_exec: false, public_exec: false });
    }
  });

  it60("a failed transition on real PG leaves no revision and no version bump", async () => {
    const { rows } = await pgAsUser(pgClient, OWNER_A, `
      select * from forge_work_change_order_create(
        '${OWNER_A}', 'pkg_real_c', 'bust', 'Bad move',
        null, null, null, null, null, null, null, null, null, null, null, null);
    `);
    const order = rows[0];
    await expect(pgAsUser(pgClient, OWNER_A, `
      select * from forge_work_change_order_transition(
        '${OWNER_A}', '${order.id}', 1, 'po_approved', null, null, null, 'Skip');
    `)).rejects.toThrow(/WPP8_INVALID_TRANSITION/);
    const { rows: after } = await pgClient.query(`
      select status, version from forge_work_change_orders
      where owner_id = '${OWNER_A}' and id = '${order.id}';
    `);
    expect(after[0].status).toBe("estimated");
    expect(after[0].version).toBe(1);
    const rev = await pgClient.query(`
      select count(*)::int as n from forge_work_change_order_revisions
      where change_order_id = '${order.id}';
    `);
    expect(rev.rows[0].n).toBe(1);
  });
});
