// Work Package Planner slice 9 — migration/integration proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) and proves:
//   - Schema: exactly the three new tables (busts, append-only
//     revisions, bust/change-order junction) and the twelve functions
//     (seven application RPCs + four internal helpers + the
//     revisions-immutability trigger function); composite FKs tie
//     every target to its package;
//   - Snapshot RPC: one statement returns the package status, the
//     frozen baseline, per-line planned vs installed-as-of quantities
//     (voided and future-dated entries excluded), the slice-6 curve
//     inputs, the latest progress snapshot, the control estimate, and
//     the active busts' fingerprints — and calling it twice writes
//     nothing (read-only detection);
//   - Fingerprint parity: the SQL fingerprint equals the JavaScript
//     domain's fingerprint for the same comparison (and is
//     scale-insensitive: 40.5 and 40.5000 fingerprint identically),
//     so a candidate confirmation never 409s on a formatting
//     difference;
//   - Create RPC: server-computed variance/percent/fingerprint,
//     zero-plan percent is null, duplicate active is a 409 naming the
//     existing bust, stale fingerprint is a 409, idempotent replay
//     returns the existing bust, idempotency conflict is a 409,
//     invalid direction / fractional cents / missing baseline / wrong
//     unit / short evidence / cross-package target / retired step /
//     terminal package / foreign workspace are all refused, and the
//     audit actor is the caller's auth.uid() (there is no
//     caller-supplied actor parameter to forge);
//   - Status machine: the full legal path in order (including reopen
//     from a terminal state and from RETIRED), every skip refused,
//     RETIRED unreachable through transition, disposition reason
//     required at terminal states, RESOLVED_BY_CHANGE requires a
//     linked APPROVED order AND a frozen, newer, same-package
//     baseline — and FAILS CLOSED on provenance until a design proves
//     the new plan incorporates the linked change;
//   - Change-order non-closure: approving a linked order never closes
//     the bust; the explicit transition refuses until provenance exists;
//   - Retire: version-guarded with a reason, retired busts are
//     immutable, the row and its history stay on file;
//   - Link/unlink: link twice is a 409, a foreign-package order is
//     refused, unlink is version-guarded and never cascades;
//   - Atomic audit: a failed mutation leaves no row and no revision;
//   - RLS: owner isolation, co-owner access, anon sees nothing,
//     direct writes denied (RPC-only write path);
//   - Revision immutability: the trigger refuses UPDATE/DELETE;
//   - Effective ACL matrix for authenticated/anon/service_role, and
//     the default-privilege negative case;
//   - Missing prerequisites: a package with no baseline and no
//     progress snapshot still snapshots cleanly (nulls + empty
//     arrays), and a cost bust without a baseline is refused.
//
// Roles, the auth.uid() stub, workspace_members, and the
// has_workspace_access() copy mirror production; the prerequisite
// tables are the minimal shapes the slice-9 foreign keys and snapshot
// reference (packages, drawings, takeoff lines with the slice-2
// package_id + unique, progress entries, baselines, steps with the
// slice-5 composite unique, curve placements, craft assignments,
// progress snapshots, control estimates, change orders).
//
// A real-PostgreSQL subset (concurrent creates serialized by the
// package row lock, concurrent transitions on the same version, an
// uncommitted write invisible to the snapshot, ACL matrix, same-
// transaction audit rollback) runs against a scratch PG16 cluster
// when the binaries exist, and SKIPS LOUDLY — never silently — when
// they do not. PGlite is single-connection, so it cannot prove
// concurrent-edit serialization; that leg exists only on real PG.

import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Client } from "pg";
import { computeFingerprint } from "@/domains/work-management/busts";

const HERE = dirname(fileURLToPath(import.meta.url));
const it60 = (name, fn) => it(name, fn, 60000);

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const MEMBER_C = "33333333-3333-4333-8333-333333333333";
const ANON_UID = "44444444-4444-4444-8444-444444444444";

const SLICE9 = "20261115000000_forge_work_package_busts.sql";

function loadMigrationSql(name) {
  return readFileSync(join(HERE, "..", "..", "..", "supabase", "migrations", name), "utf8");
}

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
    primary key (owner_id, id)
  );
  create table forge_work_drawings (
    owner_id text not null,
    package_id text not null,
    id text not null,
    drawing_number text,
    primary key (owner_id, id),
    unique (owner_id, package_id, id)
  );
  create table forge_work_takeoff_lines (
    owner_id text not null,
    id text not null,
    drawing_id text not null,
    package_id text not null,
    quantity numeric(18,4) not null,
    unit text not null,
    primary key (owner_id, id),
    unique (owner_id, package_id, id)
  );
  create table forge_work_progress_entries (
    owner_id text not null,
    id text not null,
    work_package_id text not null,
    takeoff_line_id text not null,
    work_date date not null,
    installed_quantity numeric(18,4) not null,
    voided_at timestamptz,
    primary key (owner_id, id)
  );
  create table forge_work_package_baselines (
    owner_id text not null,
    id text not null,
    package_id text not null,
    version_number integer not null,
    baseline_start date not null,
    baseline_finish date not null,
    baseline_hours numeric(14,2) not null,
    baseline_cost numeric(14,2) not null,
    frozen_by text not null,
    frozen_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, package_id, version_number)
  );
  create table forge_work_steps (
    owner_id text not null,
    id text not null,
    work_package_id text not null,
    title text not null,
    sequence_no integer not null,
    craft_key text,
    craft_label text,
    planned_duration_days integer,
    planned_person_hours numeric(12,2),
    version integer not null default 1,
    retired_at timestamptz,
    primary key (owner_id, id),
    unique (owner_id, work_package_id, id)
  );
  create table forge_work_step_curve_placements (
    owner_id text not null,
    id text not null,
    work_package_id text not null,
    step_id text not null,
    baseline_version integer not null,
    start_day_index integer not null,
    version integer not null default 1,
    retired_at timestamptz,
    primary key (owner_id, id)
  );
  create table forge_work_craft_assignments (
    owner_id text not null,
    id text not null,
    work_package_id text not null,
    work_date date not null,
    craft_key text not null,
    craft_label text not null,
    shift_key text not null,
    crew_size integer not null,
    hours_per_person numeric(5,2) not null,
    retired_at timestamptz,
    primary key (owner_id, id)
  );
  create table forge_work_progress_snapshots (
    owner_id text not null,
    id text not null,
    package_id text not null,
    status_date date not null,
    actual_hours numeric(14,2) not null,
    actual_cost numeric(14,2) not null,
    baseline_version integer not null,
    created_at timestamptz not null default now(),
    primary key (owner_id, id)
  );
  create table forge_work_control_estimates (
    owner_id text not null,
    id text not null,
    work_package_id text not null,
    original_control_estimate_cents bigint not null,
    current_estimate_cents bigint not null,
    retired_at timestamptz,
    primary key (owner_id, id)
  );
  create table forge_work_change_orders (
    owner_id text not null,
    id text not null,
    work_package_id text not null,
    status text not null,
    primary key (owner_id, id)
  );
  grant select on forge_work_packages to authenticated;
  grant select on forge_work_drawings to authenticated;
  grant select on forge_work_takeoff_lines to authenticated;
  -- The snapshot RPC is SECURITY INVOKER; in production these
  -- tables grant SELECT to authenticated (the app reads them
  -- under RLS), so the prereq mirrors those grants. Isolation
  -- still comes from the RPC's own workspace predicates.
  grant select on forge_work_package_baselines to authenticated;
  grant select on forge_work_progress_entries to authenticated;
  grant select on forge_work_steps to authenticated;
  grant select on forge_work_step_curve_placements to authenticated;
  grant select on forge_work_craft_assignments to authenticated;
  grant select on forge_work_progress_snapshots to authenticated;
  grant select on forge_work_control_estimates to authenticated;
  grant select on forge_work_change_orders to authenticated;
`;

const SEED_SQL = `
  insert into forge_work_packages (owner_id, id, status) values
    ('${OWNER_A}', 'pkg_a', 'in_progress'),
    ('${OWNER_A}', 'pkg_cancelled', 'cancelled'),
    ('${OWNER_A}', 'pkg_closed', 'verified_closed'),
    ('${OWNER_A}', 'pkg_noplan', 'in_progress'),
    ('${OWNER_B}', 'pkg_b', 'in_progress');
  insert into forge_work_drawings (owner_id, package_id, id, drawing_number) values
    ('${OWNER_A}', 'pkg_a', 'dwg_1', 'W-0005-1'),
    ('${OWNER_A}', 'pkg_a', 'dwg_2', 'C-201'),
    ('${OWNER_B}', 'pkg_b', 'dwg_b', 'B-001');
  insert into forge_work_takeoff_lines (owner_id, id, drawing_id, package_id, quantity, unit) values
    ('${OWNER_A}', 'line_1', 'dwg_1', 'pkg_a', 10, 'EA'),
    ('${OWNER_A}', 'line_2', 'dwg_1', 'pkg_a', 5, 'LF'),
    ('${OWNER_B}', 'line_b', 'dwg_b', 'pkg_b', 7, 'EA');
  insert into forge_work_progress_entries (owner_id, id, work_package_id, takeoff_line_id, work_date, installed_quantity, voided_at) values
    ('${OWNER_A}', 'entry_1', 'pkg_a', 'line_1', '2026-11-14', 12.5, null),
    ('${OWNER_A}', 'entry_2', 'pkg_a', 'line_1', '2026-11-16', 3, '2026-11-16T10:00:00Z'),
    ('${OWNER_A}', 'entry_3', 'pkg_a', 'line_1', '2026-11-20', 1, null),
    ('${OWNER_A}', 'entry_4', 'pkg_a', 'line_2', '2026-11-14', 4, null);
  insert into forge_work_package_baselines (owner_id, id, package_id, version_number, baseline_start, baseline_finish, baseline_hours, baseline_cost, frozen_by, frozen_at) values
    ('${OWNER_A}', 'base_1', 'pkg_a', 1, '2026-11-09', '2026-11-18', 400, 10000.00, 'planner_1', '2026-11-01T00:00:00Z'),
    ('${OWNER_A}', 'base_2', 'pkg_a', 2, '2026-11-09', '2026-11-18', 500, 12000.00, 'planner_1', '2026-11-10T00:00:00Z');
  insert into forge_work_steps (owner_id, id, work_package_id, title, sequence_no, craft_key, craft_label, planned_duration_days, planned_person_hours, version, retired_at) values
    ('${OWNER_A}', 'step_1', 'pkg_a', 'Fabricate spool', 1, 'pipefitters', 'Pipefitters', 4, 40, 1, null),
    ('${OWNER_A}', 'step_2', 'pkg_a', 'Weld spool', 2, 'welders', 'Welders', 2, 20, 1, '2026-11-12T00:00:00Z');
  insert into forge_work_step_curve_placements (owner_id, id, work_package_id, step_id, baseline_version, start_day_index, version, retired_at) values
    ('${OWNER_A}', 'place_1', 'pkg_a', 'step_1', 2, 1, 1, null),
    ('${OWNER_A}', 'place_2', 'pkg_a', 'step_2', 1, 2, 1, '2026-11-12T00:00:00Z'),
    ('${OWNER_A}', 'place_3', 'pkg_a', 'step_1', 1, 1, 1, null);
  insert into forge_work_craft_assignments (owner_id, id, work_package_id, work_date, craft_key, craft_label, shift_key, crew_size, hours_per_person, retired_at) values
    ('${OWNER_A}', 'assign_1', 'pkg_a', '2026-11-09', 'pipefitters', 'Pipefitters', 'day', 1, 8, null),
    ('${OWNER_A}', 'assign_2', 'pkg_a', '2026-11-10', 'pipefitters', 'Pipefitters', 'day', 1, 8, null),
    ('${OWNER_A}', 'assign_3', 'pkg_a', '2026-11-10', 'welders', 'Welders', 'day', 1, 8, null);
  insert into forge_work_progress_snapshots (owner_id, id, package_id, status_date, actual_hours, actual_cost, baseline_version) values
    ('${OWNER_A}', 'snap_1', 'pkg_a', '2026-11-15', 440.5, 12500.50, 1);
  insert into forge_work_control_estimates (owner_id, id, work_package_id, original_control_estimate_cents, current_estimate_cents, retired_at) values
    ('${OWNER_A}', 'est_1', 'pkg_a', 2000000, 2100000, null);
  insert into forge_work_change_orders (owner_id, id, work_package_id, status) values
    ('${OWNER_A}', 'co_1', 'pkg_a', 'estimated'),
    ('${OWNER_A}', 'co_2', 'pkg_a', 'approved'),
    ('${OWNER_B}', 'co_b', 'pkg_b', 'approved');
  insert into workspace_members (owner_id, member_user_id, status, role)
    values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
`;

async function setupDb() {
  const db = new PGlite();
  await db.exec(PREREQ_SQL);
  await db.exec(SEED_SQL);
  await db.exec(loadMigrationSql(SLICE9));
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

async function expectRpcError(promise, code) {
  let caught = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected RPC failure ${code}`).not.toBe(null);
  expect(String(caught.message)).toContain(code);
  return caught;
}

async function snapshot(db, uid, packageId, asOf = "2026-11-15", baselineVersion = null) {
  const { rows } = await asUser(db, uid, `
    select forge_work_package_busts_snapshot(
      '${OWNER_A}', '${packageId}', ${sqlStr(asOf)}, ${sqlNum(baselineVersion)}) as snap;
  `);
  return rows[0].snap;
}

async function createBust(db, uid, overrides = {}) {
  const input = {
    packageId: "pkg_a",
    scopeType: "PACKAGE",
    takeoffLineId: null,
    workStepId: null,
    craft: null,
    workDate: null,
    shiftKey: null,
    dimension: "LABOR_COST",
    baselineId: "base_1",
    baselineVersion: 1,
    plannedValue: 1000000,
    observedValue: 1250000,
    unit: "USD_CENTS",
    evidenceSummary: "Actual cost is over the frozen baseline.",
    evidenceRef: null,
    comparisonAsOf: "2026-11-15",
    sourceFingerprint: null,
    requestId: null,
    reason: null,
    ...overrides,
  };
  const { rows } = await asUser(db, uid, `
    select * from forge_work_package_bust_create(
      '${OWNER_A}', '${input.packageId}', ${sqlStr(input.scopeType)},
      ${sqlStr(input.takeoffLineId)}, ${sqlStr(input.workStepId)}, ${sqlStr(input.craft)},
      ${sqlStr(input.workDate)}, ${sqlStr(input.shiftKey)}, ${sqlStr(input.dimension)},
      ${sqlStr(input.baselineId)}, ${sqlNum(input.baselineVersion)},
      ${sqlNum(input.plannedValue)}, ${sqlNum(input.observedValue)}, ${sqlStr(input.unit)},
      ${sqlStr(input.evidenceSummary)}, ${sqlStr(input.evidenceRef)}, ${sqlStr(input.comparisonAsOf)},
      ${sqlStr(input.sourceFingerprint)}, ${sqlStr(input.requestId)}, ${sqlStr(input.reason)});
  `);
  return rows[0];
}

describe("slice 9 migration: PGlite battery", () => {
  let db;
  beforeEach(async () => {
    db = await setupDb();
  }, 60000);

  it60("creates exactly the three new tables and the twelve functions", async () => {
    const { rows: tables } = await db.query(`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name like 'forge_work_package_bust%'
      order by table_name;
    `);
    expect(tables.map((r) => r.table_name)).toEqual([
      "forge_work_package_bust_change_orders",
      "forge_work_package_bust_revisions",
      "forge_work_package_busts",
    ]);
    const { rows: functions } = await db.query(`
      select proname from pg_proc
      where proname like 'forge_work_package_bust%'
        and pronamespace = 'public'::regnamespace
      order by proname;
    `);
    expect(functions.map((r) => r.proname)).toEqual([
      "forge_work_package_bust_check_cents",
      "forge_work_package_bust_check_decimal",
      "forge_work_package_bust_create",
      "forge_work_package_bust_fingerprint",
      "forge_work_package_bust_idempotency_check",
      "forge_work_package_bust_link_change_order",
      "forge_work_package_bust_retire",
      "forge_work_package_bust_revisions_immutable",
      "forge_work_package_bust_transition",
      "forge_work_package_bust_unlink_change_order",
      "forge_work_package_bust_update",
      "forge_work_package_busts_snapshot",
    ]);
  });

  it60("the snapshot is one statement: status, baseline, lines, curve inputs, progress, estimate, busts", async () => {
    const snap = await snapshot(db, OWNER_A, "pkg_a");
    expect(snap.packageStatus).toBe("in_progress");
    expect(snap.asOf).toBe("2026-11-15");
    expect(snap.baseline.version_number).toBe(2);
    expect(Number(snap.baseline.baseline_hours)).toBe(500);
    expect(Number(snap.baseline.baseline_cost)).toBe(12000);
    expect(snap.progressBaseline.version_number).toBe(1);
    // Installed-as-of: the counted entry (12.5) only — the voided
    // entry and the future-dated entry are excluded.
    const line1 = snap.takeoffLines.find((line) => line.id === "line_1");
    expect(line1.drawing_number).toBe("W-0005-1");
    expect(Number(line1.quantity)).toBe(10);
    expect(Number(line1.installed_quantity)).toBe(12.5);
    const line2 = snap.takeoffLines.find((line) => line.id === "line_2");
    expect(Number(line2.installed_quantity)).toBe(4);
    expect(snap.steps).toHaveLength(1);
    expect(snap.steps[0].id).toBe("step_1");
    expect(snap.placements).toHaveLength(1);
    expect(snap.placements[0].step_id).toBe("step_1");
    expect(snap.placements[0].baseline_version).toBe(2);
    // place_3 is a LIVE placement on the OLD baseline (v1) — it
    // must not leak into the v2 snapshot, or the manpower curve
    // would double-count the step.
    expect(snap.assignments).toHaveLength(3);
    expect(Number(snap.latestProgress.actual_hours)).toBe(440.5);
    expect(Number(snap.latestProgress.actual_cost)).toBe(12500.50);
    expect(snap.latestProgress.baseline_version).toBe(1);
    expect(snap.controlEstimate.original_control_estimate_cents).toBe(2000000);
    expect(snap.activeBusts).toEqual([]);
    // Two consecutive snapshots are identical — one statement, one revision.
    const snap2 = await snapshot(db, OWNER_A, "pkg_a");
    expect(snap2).toEqual(snap);
  });

  it60("calling the snapshot twice writes nothing (read-only detection)", async () => {
    await snapshot(db, OWNER_A, "pkg_a");
    await snapshot(db, OWNER_A, "pkg_a");
    const { rows } = await db.query("select count(*)::int as n from forge_work_package_busts;");
    expect(rows[0].n).toBe(0);
    const { rows: revisions } = await db.query("select count(*)::int as n from forge_work_package_bust_revisions;");
    expect(revisions[0].n).toBe(0);
  });

  it60("a package with no baseline and no progress still snapshots cleanly", async () => {
    const snap = await snapshot(db, OWNER_A, "pkg_noplan");
    expect(snap.packageStatus).toBe("in_progress");
    expect(snap.baseline).toBe(null);
    expect(snap.progressBaseline).toBe(null);
    expect(snap.takeoffLines).toEqual([]);
    expect(snap.steps).toEqual([]);
    expect(snap.latestProgress).toBe(null);
    expect(snap.controlEstimate).toBe(null);
    expect(snap.activeBusts).toEqual([]);
  });

  it60("the snapshot refuses another owner's workspace and a missing package", async () => {
    await expectRpcError(snapshot(db, OWNER_B, "pkg_a"), "WPP9_WORKSPACE_FORBIDDEN");
    await expectRpcError(snapshot(db, OWNER_A, "pkg_missing"), "WPP9_PACKAGE_NOT_FOUND");
  });

  it60("the SQL fingerprint equals the JavaScript fingerprint (JS/SQL parity)", async () => {
    const input = {
      ownerId: OWNER_A, packageId: "pkg_a", dimension: "LABOR_COST", scopeType: "PACKAGE",
      takeoffLineId: null, workStepId: null, craft: null, workDate: null, shiftKey: null,
      baselineId: "base_1", baselineVersion: 1, plannedValue: 1000000, observedValue: 1250000,
      unit: "USD_CENTS", comparisonAsOf: "2026-11-15",
    };
    const expected = computeFingerprint(input);
    // The fingerprint helper is internal: no grant to authenticated
    // by design, so the parity check calls it as the table owner.
    const { rows } = await db.query(`
      select forge_work_package_bust_fingerprint(
        '${OWNER_A}', 'pkg_a', 'LABOR_COST', 'PACKAGE',
        null, null, null, null, null,
        'base_1', 1, 1000000, 1250000, 'USD_CENTS', '2026-11-15') as fp;
    `);
    expect(rows[0].fp).toBe(expected);
    expect(rows[0].fp).toBe(createHash("md5").update(
      `${OWNER_A}|pkg_a|LABOR_COST|PACKAGE||||||base_1|1|1000000|1250000|USD_CENTS|2026-11-15`,
      "utf8",
    ).digest("hex"));
    // Scale-insensitive: 40.5 and 40.5000 fingerprint identically,
    // in SQL and in JavaScript. Values ending in 0 (10, 1000000)
    // must NOT be mangled — the naive trim(trailing '0') turns
    // 10 into 1; the migration strips zeros only after a decimal
    // point, and this pins that.
    const { rows: scaled } = await db.query(`
      select forge_work_package_bust_fingerprint(
        '${OWNER_A}', 'pkg_a', 'LABOR_HOURS', 'PACKAGE',
        null, null, null, null, null,
        'base_1', 1, 40.5, 45, 'HOURS', '2026-11-15') as a,
      forge_work_package_bust_fingerprint(
        '${OWNER_A}', 'pkg_a', 'LABOR_HOURS', 'PACKAGE',
        null, null, null, null, null,
        'base_1', 1, 40.5000, 45.0000, 'HOURS', '2026-11-15') as b,
      forge_work_package_bust_fingerprint(
        '${OWNER_A}', 'pkg_a', 'LABOR_COST', 'PACKAGE',
        null, null, null, null, null,
        'base_1', 1, 1000000, 1250000, 'USD_CENTS', '2026-11-15') as c;
    `);
    expect(scaled[0].a).toBe(scaled[0].b);
    expect(scaled[0].a).toBe(computeFingerprint({ ...input, dimension: "LABOR_HOURS", plannedValue: 40.5, observedValue: 45, unit: "HOURS" }));
    expect(scaled[0].c).toBe(expected);
  });

  it60("creates a quantity bust with server-computed variance, percent, and fingerprint", async () => {
    const bust = await createBust(db, OWNER_A, {
      dimension: "INSTALLED_QUANTITY",
      scopeType: "TAKEOFF_LINE",
      takeoffLineId: "line_1",
      baselineId: null,
      baselineVersion: null,
      plannedValue: 10,
      observedValue: 12.5,
      unit: "EA",
      evidenceSummary: "Installed 12.5 EA against 10 EA planned.",
    });
    expect(bust.status).toBe("OPEN");
    expect(bust.version).toBe(1);
    expect(Number(bust.variance_value)).toBe(2.5);
    expect(Number(bust.variance_percent)).toBe(25);
    expect(bust.created_by).toBe(OWNER_A);
    expect(bust.source_fingerprint).toBe(computeFingerprint({
      ownerId: OWNER_A, packageId: "pkg_a", dimension: "INSTALLED_QUANTITY",
      scopeType: "TAKEOFF_LINE", takeoffLineId: "line_1", workStepId: null,
      craft: null, workDate: null, shiftKey: null, baselineId: null,
      baselineVersion: null, plannedValue: 10, observedValue: 12.5,
      unit: "EA", comparisonAsOf: "2026-11-15",
    }));
    const { rows } = await db.query(`
      select action, version, actor_id from forge_work_package_bust_revisions
      where bust_id = '${bust.id}' order by version;
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("create");
    expect(rows[0].version).toBe(1);
    expect(rows[0].actor_id).toBe(OWNER_A);
  });

  it60("a zero plan has a null percent, never infinity", async () => {
    const bust = await createBust(db, OWNER_A, {
      dimension: "INSTALLED_QUANTITY",
      scopeType: "TAKEOFF_LINE",
      takeoffLineId: "line_1",
      baselineId: null,
      baselineVersion: null,
      plannedValue: 0,
      observedValue: 2,
      unit: "EA",
      evidenceSummary: "Installed 2 EA against a zero plan.",
    });
    expect(Number(bust.variance_value)).toBe(2);
    expect(bust.variance_percent).toBe(null);
  });

  it60("refuses a duplicate active bust, naming the existing one", async () => {
    const first = await createBust(db, OWNER_A, {
      dimension: "INSTALLED_QUANTITY",
      scopeType: "TAKEOFF_LINE",
      takeoffLineId: "line_1",
      baselineId: null,
      baselineVersion: null,
      plannedValue: 10,
      observedValue: 12.5,
      unit: "EA",
      evidenceSummary: "Installed 12.5 EA against 10 EA planned.",
    });
    const caught = await expectRpcError(createBust(db, OWNER_A, {
      dimension: "INSTALLED_QUANTITY",
      scopeType: "TAKEOFF_LINE",
      takeoffLineId: "line_1",
      baselineId: null,
      baselineVersion: null,
      plannedValue: 10,
      observedValue: 12.5,
      unit: "EA",
      evidenceSummary: "Installed 12.5 EA against 10 EA planned.",
    }), "WPP9_DUPLICATE_ACTIVE");
    expect(caught.message).toContain(first.id);
    const { rows } = await db.query("select count(*)::int as n from forge_work_package_busts;");
    expect(rows[0].n).toBe(1);
  });

  it60("a stale fingerprint is refused, and a matching one is accepted", async () => {
    const good = computeFingerprint({
      ownerId: OWNER_A, packageId: "pkg_a", dimension: "LABOR_COST", scopeType: "PACKAGE",
      takeoffLineId: null, workStepId: null, craft: null, workDate: null, shiftKey: null,
      baselineId: "base_1", baselineVersion: 1, plannedValue: 1000000, observedValue: 1250000,
      unit: "USD_CENTS", comparisonAsOf: "2026-11-15",
    });
    await expectRpcError(createBust(db, OWNER_A, { sourceFingerprint: "0".repeat(32) }), "WPP9_STALE_FINGERPRINT");
    const bust = await createBust(db, OWNER_A, { sourceFingerprint: good });
    expect(bust.source_fingerprint).toBe(good);
  });

  it60("an idempotent replay returns the existing bust; a conflicting reuse is refused", async () => {
    const first = await createBust(db, OWNER_A, { requestId: "req_1" });
    const replay = await createBust(db, OWNER_A, { requestId: "req_1" });
    expect(replay.id).toBe(first.id);
    const { rows } = await db.query("select count(*)::int as n from forge_work_package_busts;");
    expect(rows[0].n).toBe(1);
    const { rows: revisions } = await db.query("select count(*)::int as n from forge_work_package_bust_revisions;");
    expect(revisions[0].n).toBe(1);
    await expectRpcError(createBust(db, OWNER_A, {
      requestId: "req_1",
      observedValue: 1300000,
      evidenceSummary: "A different payload under the same request id.",
    }), "WPP9_IDEMPOTENCY_CONFLICT");
  });

  it60("refuses invalid direction, fractional cents, missing baseline, wrong unit, and short evidence", async () => {
    await expectRpcError(createBust(db, OWNER_A, { observedValue: 900000 }), "WPP9_INVALID_VALUE");
    await expectRpcError(createBust(db, OWNER_A, { plannedValue: 1000000.5 }), "WPP9_INVALID_COST");
    await expectRpcError(createBust(db, OWNER_A, { baselineId: null, baselineVersion: null }), "WPP9_INVALID_BASELINE");
    await expectRpcError(createBust(db, OWNER_A, { unit: "HOURS" }), "WPP9_INVALID_UNIT");
    await expectRpcError(createBust(db, OWNER_A, { evidenceSummary: "short" }), "WPP9_INVALID_EVIDENCE");
    await expectRpcError(createBust(db, OWNER_A, { dimension: "INSTALLED_QUANTITY", scopeType: "PACKAGE" }), "WPP9_INVALID_TARGET");
    await expectRpcError(createBust(db, OWNER_A, { dimension: "MANPOWER_SHORTFALL", scopeType: "CRAFT_DAY", craft: "pipefitters", workDate: "2026-11-09", baselineId: "base_1", baselineVersion: 1, plannedValue: 8, observedValue: 10, unit: "HOURS", evidenceSummary: "Capacity above required is not a shortfall." }), "WPP9_INVALID_VALUE");
  });

  it60("refuses a cross-package line, a retired step, a terminal package, and a foreign workspace", async () => {
    await expectRpcError(createBust(db, OWNER_A, {
      dimension: "INSTALLED_QUANTITY", scopeType: "TAKEOFF_LINE", takeoffLineId: "line_b",
      baselineId: null, baselineVersion: null, plannedValue: 7, observedValue: 9, unit: "EA",
      evidenceSummary: "A line from another package.",
    }), "WPP9_INVALID_TARGET");
    await expectRpcError(createBust(db, OWNER_A, {
      dimension: "SCHEDULE_DAYS", scopeType: "WORK_STEP", workStepId: "step_2",
      baselineId: "base_1", baselineVersion: 1, plannedValue: 2, observedValue: 4, unit: "DAYS",
      evidenceSummary: "A retired step cannot be attached.",
    }), "WPP9_TARGET_RETIRED");
    await expectRpcError(createBust(db, OWNER_A, { packageId: "pkg_cancelled" }), "WPP9_PACKAGE_TERMINAL");
    await expectRpcError(createBust(db, OWNER_A, { packageId: "pkg_closed" }), "WPP9_PACKAGE_TERMINAL");
    await expectRpcError(createBust(db, OWNER_B, { packageId: "pkg_a" }), "WPP9_WORKSPACE_FORBIDDEN");
    await expectRpcError(createBust(db, OWNER_A, {
      dimension: "LABOR_COST", packageId: "pkg_noplan", baselineId: null, baselineVersion: null,
    }), "WPP9_INVALID_BASELINE");
  });

  it60("a failed create leaves no row and no revision (atomic audit)", async () => {
    await expectRpcError(createBust(db, OWNER_A, { observedValue: 900000 }), "WPP9_INVALID_VALUE");
    const { rows } = await db.query("select count(*)::int as n from forge_work_package_busts;");
    expect(rows[0].n).toBe(0);
    const { rows: revisions } = await db.query("select count(*)::int as n from forge_work_package_bust_revisions;");
    expect(revisions[0].n).toBe(0);
  });
});


describe("slice 9 migration: PGlite battery (lifecycle)", () => {
  let db;
  beforeEach(async () => {
    db = await setupDb();
  }, 60000);

  async function openBust(uid = OWNER_A) {
    return createBust(db, uid, {});
  }

  // RPC signatures (no package_id — the bust carries its package):
  // update(owner, bustId, version, summary, setSummary, ref, setRef, reason)
  // transition(owner, bustId, version, toStatus, dispositionReason, resolvedBaselineId, reason)
  // retire(owner, bustId, version, reason)
  // link(owner, bustId, changeOrderId, requestId, reason) -> the LINK row
  // unlink(owner, linkId, linkVersion, reason) -> the LINK row
  async function updateBust(uid, bustId, version, overrides = {}) {
    const input = {
      evidenceSummary: "Revised evidence: the overrun is confirmed by the signed timesheets.",
      evidenceRef: null,
      reason: "Corrected the evidence wording.",
      ...overrides,
    };
    const { rows } = await asUser(db, uid, `
      select * from forge_work_package_bust_update(
        '${OWNER_A}', '${bustId}', ${version},
        ${sqlStr(input.evidenceSummary)}, true, ${sqlStr(input.evidenceRef)}, true,
        ${sqlStr(input.reason)});
    `);
    return rows[0];
  }

  async function transitionBust(uid, bustId, version, toStatus, overrides = {}) {
    const input = {
      dispositionReason: null,
      resolvedBaselineId: null,
      reason: "Moving the bust forward.",
      ...overrides,
    };
    const { rows } = await asUser(db, uid, `
      select * from forge_work_package_bust_transition(
        '${OWNER_A}', '${bustId}', ${version}, ${sqlStr(toStatus)},
        ${sqlStr(input.dispositionReason)}, ${sqlStr(input.resolvedBaselineId)}, ${sqlStr(input.reason)});
    `);
    return rows[0];
  }

  async function retireBust(uid, bustId, version, reason = "Duplicate of a re-detected bust.") {
    const { rows } = await asUser(db, uid, `
      select * from forge_work_package_bust_retire(
        '${OWNER_A}', '${bustId}', ${version}, ${sqlStr(reason)});
    `);
    return rows[0];
  }

  async function linkOrder(uid, bustId, changeOrderId, requestId = null, reason = "Covers the overrun.") {
    const { rows } = await asUser(db, uid, `
      select * from forge_work_package_bust_link_change_order(
        '${OWNER_A}', '${bustId}', '${changeOrderId}', ${sqlStr(requestId)}, ${sqlStr(reason)});
    `);
    return rows[0];
  }

  async function unlinkOrder(uid, linkId, linkVersion, reason = "Wrong order linked.") {
    const { rows } = await asUser(db, uid, `
      select * from forge_work_package_bust_unlink_change_order(
        '${OWNER_A}', '${linkId}', ${linkVersion}, ${sqlStr(reason)});
    `);
    return rows[0];
  }

  async function bustRow(bustId) {
    const { rows } = await db.query(`select * from forge_work_package_busts where id = '${bustId}';`);
    return rows[0];
  }

  async function revisionRows(bustId) {
    const { rows } = await db.query(`
      select version, action, actor_id, reason, old_values, new_values
      from forge_work_package_bust_revisions
      where bust_id = '${bustId}' order by version;
    `);
    return rows;
  }

  it60("updates evidence version-guarded with a reason, and refuses a stale version", async () => {
    const bust = await openBust();
    const updated = await updateBust(OWNER_A, bust.id, 1);
    expect(updated.version).toBe(2);
    expect(updated.evidence_summary).toContain("signed timesheets");
    const revisions = await revisionRows(bust.id);
    expect(revisions).toHaveLength(2);
    expect(revisions[1].action).toBe("update");
    expect(revisions[1].version).toBe(2);
    expect(revisions[1].actor_id).toBe(OWNER_A);
    await expectRpcError(updateBust(OWNER_A, bust.id, 1), "WPP9_VERSION_CONFLICT");
    await expectRpcError(updateBust(OWNER_A, bust.id, 2, { reason: "  " }), "WPP9_REASON_REQUIRED");
    const row = await bustRow(bust.id);
    expect(row.version).toBe(2);
  });

  it60("walks the full legal transition path, including reopen from a terminal status", async () => {
    const bust = await openBust();
    let row = await transitionBust(OWNER_A, bust.id, 1, "UNDER_REVIEW");
    expect(row.status).toBe("UNDER_REVIEW");
    expect(row.version).toBe(2);
    row = await transitionBust(OWNER_A, bust.id, 2, "ACCEPTED_OVERRUN", { dispositionReason: "Accepted: the overrun stands." });
    expect(row.status).toBe("ACCEPTED_OVERRUN");
    expect(row.disposition_reason).toBe("Accepted: the overrun stands.");
    expect(row.version).toBe(3);
    // A terminal status reopens to UNDER_REVIEW with a reason and a
    // new revision — history is kept, never rewritten.
    row = await transitionBust(OWNER_A, bust.id, 3, "UNDER_REVIEW", { reason: "New evidence arrived." });
    expect(row.status).toBe("UNDER_REVIEW");
    expect(row.version).toBe(4);
    const revisions = await revisionRows(bust.id);
    expect(revisions.map((r) => r.action)).toEqual(["create", "transition", "transition", "reopen"]);
    expect(revisions.map((r) => r.version)).toEqual([1, 2, 3, 4]);
  });

  it60("refuses every illegal transition and a missing disposition reason", async () => {
    const bust = await openBust();
    // A terminal disposition needs its own disposition reason, not
    // just the audit reason.
    await expectRpcError(transitionBust(OWNER_A, bust.id, 1, "ACCEPTED_OVERRUN"), "WPP9_REASON_REQUIRED");
    // RETIRED and OPEN are not reachable through the transition RPC.
    await expectRpcError(transitionBust(OWNER_A, bust.id, 1, "RETIRED"), "WPP9_INVALID_STATUS");
    await expectRpcError(transitionBust(OWNER_A, bust.id, 1, "OPEN"), "WPP9_INVALID_STATUS");
    await expectRpcError(transitionBust(OWNER_A, bust.id, 1, "BOGUS"), "WPP9_INVALID_STATUS");
    // A blank audit reason is refused.
    await expectRpcError(transitionBust(OWNER_A, bust.id, 1, "UNDER_REVIEW", { reason: "" }), "WPP9_REASON_REQUIRED");
    // A stale version is refused.
    await expectRpcError(transitionBust(OWNER_A, bust.id, 9, "UNDER_REVIEW"), "WPP9_VERSION_CONFLICT");
    let row = await bustRow(bust.id);
    expect(row.status).toBe("OPEN");
    expect(row.version).toBe(1);
    // UNDER_REVIEW -> UNDER_REVIEW is a self-move: refused.
    await transitionBust(OWNER_A, bust.id, 1, "UNDER_REVIEW");
    await expectRpcError(transitionBust(OWNER_A, bust.id, 2, "UNDER_REVIEW"), "WPP9_INVALID_TRANSITION");
    // A terminal status cannot move forward again — only reopen.
    await transitionBust(OWNER_A, bust.id, 2, "ACCEPTED_OVERRUN", { dispositionReason: "Accepted." });
    await expectRpcError(transitionBust(OWNER_A, bust.id, 3, "INVALID_DATA", { dispositionReason: "Bad data." }), "WPP9_INVALID_TRANSITION");
    row = await bustRow(bust.id);
    expect(row.status).toBe("ACCEPTED_OVERRUN");
    expect(row.version).toBe(3);
  });

  it60("RESOLVED_BY_CHANGE refuses the original baseline and fails closed on provenance", async () => {
    const bust = await openBust();
    await transitionBust(OWNER_A, bust.id, 1, "UNDER_REVIEW");
    // Valid baseline, no link yet: the approved order is missing.
    await expectRpcError(
      transitionBust(OWNER_A, bust.id, 2, "RESOLVED_BY_CHANGE", { dispositionReason: "Resolved by change.", resolvedBaselineId: "base_2" }),
      "WPP9_APPROVED_ORDER_REQUIRED",
    );
    // A baseline that is not on file is refused first.
    await expectRpcError(
      transitionBust(OWNER_A, bust.id, 2, "RESOLVED_BY_CHANGE", { dispositionReason: "Resolved by change.", resolvedBaselineId: "base_missing" }),
      "WPP9_RESOLVED_BASELINE_REQUIRED",
    );
    // Link the estimated order: still not resolved — estimated is
    // not approved.
    await linkOrder(OWNER_A, bust.id, "co_1");
    let row = await bustRow(bust.id);
    expect(row.version).toBe(3);
    await expectRpcError(
      transitionBust(OWNER_A, bust.id, 3, "RESOLVED_BY_CHANGE", { dispositionReason: "Resolved by change.", resolvedBaselineId: "base_2" }),
      "WPP9_APPROVED_ORDER_REQUIRED",
    );
    // Link the approved order, then resolve against a baseline that
    // is not on file: still refused.
    await linkOrder(OWNER_A, bust.id, "co_2");
    row = await bustRow(bust.id);
    expect(row.version).toBe(4);
    await expectRpcError(
      transitionBust(OWNER_A, bust.id, 4, "RESOLVED_BY_CHANGE", { dispositionReason: "Resolved by change.", resolvedBaselineId: "base_missing" }),
      "WPP9_RESOLVED_BASELINE_REQUIRED",
    );
    // The original baseline can never prove its own fix, even with
    // an approved order linked.
    await expectRpcError(
      transitionBust(OWNER_A, bust.id, 4, "RESOLVED_BY_CHANGE", { dispositionReason: "Resolved by change.", resolvedBaselineId: "base_1" }),
      "WPP9_RESOLVED_BASELINE_NOT_NEWER",
    );
    // A newer frozen baseline with an approved order linked is still
    // refused: nothing in the schema proves the new plan
    // incorporates the change (fail closed until a provenance design
    // lands). The bust, its version, and its history are untouched —
    // the failed transition writes nothing.
    const revisionsBefore = await revisionRows(bust.id);
    await expectRpcError(
      transitionBust(OWNER_A, bust.id, 4, "RESOLVED_BY_CHANGE", { dispositionReason: "Resolved by change.", resolvedBaselineId: "base_2" }),
      "WPP9_RESOLVED_PROVENANCE_UNAVAILABLE",
    );
    row = await bustRow(bust.id);
    expect(row.status).toBe("UNDER_REVIEW");
    expect(row.version).toBe(4);
    expect(row.resolved_baseline_id).toBe(null);
    expect(await revisionRows(bust.id)).toEqual(revisionsBefore);
  });

  it60("RESOLVED_BY_CHANGE refuses an older baseline and a foreign-package baseline; an unfrozen baseline cannot exist", async () => {
    // A bust measured against the newer baseline: the older plan is
    // not a fix.
    const bust = await createBust(db, OWNER_A, { baselineId: "base_2", baselineVersion: 2 });
    await transitionBust(OWNER_A, bust.id, 1, "UNDER_REVIEW");
    await linkOrder(OWNER_A, bust.id, "co_2");
    await expectRpcError(
      transitionBust(OWNER_A, bust.id, 3, "RESOLVED_BY_CHANGE", { dispositionReason: "Resolved by change.", resolvedBaselineId: "base_1" }),
      "WPP9_RESOLVED_BASELINE_NOT_NEWER",
    );
    // A baseline from another package is not on file for this one.
    await db.query(`insert into forge_work_package_baselines (owner_id, id, package_id, version_number, baseline_start, baseline_finish, baseline_hours, baseline_cost, frozen_by, frozen_at) values ('${OWNER_A}', 'base_b', 'pkg_b', 1, '2026-11-09', '2026-11-18', 400, 10000.00, 'planner_1', '2026-11-01T00:00:00Z');`);
    await expectRpcError(
      transitionBust(OWNER_A, bust.id, 3, "RESOLVED_BY_CHANGE", { dispositionReason: "Resolved by change.", resolvedBaselineId: "base_b" }),
      "WPP9_RESOLVED_BASELINE_REQUIRED",
    );
    // An unfrozen baseline cannot exist: frozen_at is NOT NULL and
    // there is no draft state, so the frozen predicate holds for
    // every row the database can contain — the insert itself fails.
    await expect(
      db.query(`insert into forge_work_package_baselines (owner_id, id, package_id, version_number, baseline_start, baseline_finish, baseline_hours, baseline_cost, frozen_by, frozen_at) values ('${OWNER_A}', 'base_draft', 'pkg_a', 9, '2026-11-09', '2026-11-18', 400, 10000.00, 'planner_1', null);`),
    ).rejects.toThrow(/null value/i);
    const { rows: frozen } = await db.query(
      `select id, frozen_at, frozen_by from forge_work_package_baselines where owner_id = '${OWNER_A}' and package_id = 'pkg_a';`,
    );
    expect(frozen.length).toBeGreaterThan(0);
    for (const baseline of frozen) {
      expect(baseline.frozen_at).not.toBe(null);
      expect(baseline.frozen_by).not.toBe(null);
    }
  });

  it60("approving a linked change order never closes the bust (change-order non-closure)", async () => {
    const bust = await openBust();
    await linkOrder(OWNER_A, bust.id, "co_1");
    // The order is estimated at link time. Approve it directly in
    // the seed tables (the slice-8 approval path is out of scope
    // here); the bust must stay OPEN.
    await db.query(`update forge_work_change_orders set status = 'approved' where id = 'co_1';`);
    let row = await bustRow(bust.id);
    expect(row.status).toBe("OPEN");
    expect(row.version).toBe(2);
    // And the now-approved linked order still does not close it:
    // resolution is fail closed on provenance until a design proves
    // the new plan incorporates the change.
    await transitionBust(OWNER_A, bust.id, 2, "UNDER_REVIEW");
    await expectRpcError(
      transitionBust(OWNER_A, bust.id, 3, "RESOLVED_BY_CHANGE", { dispositionReason: "Resolved by the now-approved order.", resolvedBaselineId: "base_2" }),
      "WPP9_RESOLVED_PROVENANCE_UNAVAILABLE",
    );
    row = await bustRow(bust.id);
    expect(row.status).toBe("UNDER_REVIEW");
    expect(row.version).toBe(3);
  });

  it60("retires version-guarded, keeps the row and its history, and reopens to review", async () => {
    const bust = await openBust();
    const retired = await retireBust(OWNER_A, bust.id, 1);
    expect(retired.status).toBe("RETIRED");
    expect(retired.version).toBe(2);
    expect(retired.retired_at).not.toBe(null);
    let revisions = await revisionRows(bust.id);
    expect(revisions.map((r) => r.action)).toEqual(["create", "retire"]);
    await expectRpcError(updateBust(OWNER_A, bust.id, 2), "WPP9_RETIRED");
    await expectRpcError(retireBust(OWNER_A, bust.id, 2), "WPP9_RETIRED");
    await expectRpcError(linkOrder(OWNER_A, bust.id, "co_2"), "WPP9_RETIRED");
    // The row and its history are still there — retirement is a
    // status, never a delete.
    let row = await bustRow(bust.id);
    expect(row).toBeDefined();
    expect((await revisionRows(bust.id))).toHaveLength(2);
    // A retired bust reopens to UNDER_REVIEW through the transition
    // RPC, and the retired markers clear.
    row = await transitionBust(OWNER_A, bust.id, 2, "UNDER_REVIEW", { reason: "Retired in error — reopening." });
    expect(row.status).toBe("UNDER_REVIEW");
    expect(row.version).toBe(3);
    expect(row.retired_at).toBe(null);
    revisions = await revisionRows(bust.id);
    expect(revisions.map((r) => r.action)).toEqual(["create", "retire", "reopen"]);
  });

  it60("links and unlinks change orders, with double-link and foreign-order refusals", async () => {
    const bust = await openBust();
    const linked = await linkOrder(OWNER_A, bust.id, "co_2");
    expect(linked.change_order_id).toBe("co_2");
    expect(linked.version).toBe(1);
    expect(linked.unlinked_at).toBe(null);
    let row = await bustRow(bust.id);
    expect(row.version).toBe(2);
    await expectRpcError(linkOrder(OWNER_A, bust.id, "co_2"), "WPP9_LINK_EXISTS");
    await expectRpcError(linkOrder(OWNER_A, bust.id, "co_b"), "WPP9_CHANGE_ORDER_NOT_FOUND");
    await expectRpcError(linkOrder(OWNER_A, bust.id, "co_missing"), "WPP9_CHANGE_ORDER_NOT_FOUND");
    // Unlink is version-guarded on the LINK row, retires the link
    // (history kept), and advances the bust version once; the same
    // order can be linked again after.
    await expectRpcError(unlinkOrder(OWNER_A, linked.id, 9), "WPP9_VERSION_CONFLICT");
    const unlinked = await unlinkOrder(OWNER_A, linked.id, 1);
    expect(unlinked.version).toBe(2);
    expect(unlinked.unlinked_at).not.toBe(null);
    row = await bustRow(bust.id);
    expect(row.version).toBe(3);
    await expectRpcError(unlinkOrder(OWNER_A, linked.id, 2), "WPP9_LINK_RETIRED");
    const relinked = await linkOrder(OWNER_A, bust.id, "co_2");
    expect(relinked.id).not.toBe(linked.id);
    expect(relinked.version).toBe(1);
    row = await bustRow(bust.id);
    expect(row.version).toBe(4);
    const { rows: allLinks } = await db.query(`
      select count(*)::int as n from forge_work_package_bust_change_orders where bust_id = '${bust.id}';
    `);
    expect(allLinks[0].n).toBe(2);
  });

  it60("a failed transition leaves no revision behind (atomic audit)", async () => {
    const bust = await openBust();
    await expectRpcError(transitionBust(OWNER_A, bust.id, 1, "ACCEPTED_OVERRUN"), "WPP9_REASON_REQUIRED");
    expect((await revisionRows(bust.id))).toHaveLength(1);
    const row = await bustRow(bust.id);
    expect(row.version).toBe(1);
    expect(row.status).toBe("OPEN");
  });
});

describe("slice 9 migration: PGlite battery (RLS, ACL, immutability)", () => {
  let db;
  beforeEach(async () => {
    db = await setupDb();
  }, 60000);

  async function asRole(uidOrRole, sql) {
    // uidOrRole is either an authenticated uid or the literal role name "anon".
    if (uidOrRole === "anon") {
      await db.query("set role anon;");
      try {
        return await db.query(sql);
      } finally {
        await db.query("reset role;");
      }
    }
    return asUser(db, uidOrRole, sql);
  }

  it60("owner isolation: another owner sees nothing, a co-owner sees the busts", async () => {
    const bust = await createBust(db, OWNER_A, {});
    const { rows: ownerRows } = await asRole(OWNER_A, "select id from forge_work_package_busts;");
    expect(ownerRows.map((r) => r.id)).toContain(bust.id);
    const { rows: otherRows } = await asRole(OWNER_B, "select id from forge_work_package_busts;");
    expect(otherRows).toEqual([]);
    const { rows: memberRows } = await asRole(MEMBER_C, "select id from forge_work_package_busts;");
    expect(memberRows.map((r) => r.id)).toContain(bust.id);
    const { rows: revOwner } = await asRole(OWNER_A, `select id from forge_work_package_bust_revisions where bust_id = '${bust.id}';`);
    expect(revOwner).toHaveLength(1);
    const { rows: revOther } = await asRole(OWNER_B, `select id from forge_work_package_bust_revisions where bust_id = '${bust.id}';`);
    expect(revOther).toEqual([]);
  });

  it60("anon gets nothing: no grant, so even a plain SELECT is denied", async () => {
    await createBust(db, OWNER_A, {});
    await expect(asRole("anon", "select id from forge_work_package_busts;")).rejects.toThrow(/permission denied/);
    await expect(asRole("anon", "select id from forge_work_package_bust_revisions;")).rejects.toThrow(/permission denied/);
    await expect(asRole("anon", "select id from forge_work_package_bust_change_orders;")).rejects.toThrow(/permission denied/);
  });

  it60("direct writes are denied: SELECT-only grants, so only the RPCs can mutate", async () => {
    const bust = await createBust(db, OWNER_A, {});
    // The migration grants SELECT only on the three tables (no
    // INSERT/UPDATE/DELETE grant at all), so a direct write dies at
    // the ACL layer — before RLS is even consulted. That is a
    // stronger denial than a missing write policy alone.
    await expect(asRole(OWNER_A, `
      insert into forge_work_package_busts
        (owner_id, id, work_package_id, dimension, scope_type, status, version,
         planned_value, observed_value, variance_value, unit, evidence_summary,
         comparison_as_of, created_by, updated_by)
      values ('${OWNER_A}', 'forge_wpbust_direct', 'pkg_a', 'LABOR_COST', 'PACKAGE',
        'OPEN', 1, 1000000, 1250000, 250000, 'USD_CENTS', 'Direct insert attempt.',
        '2026-11-15', '${OWNER_A}', '${OWNER_A}');
    `)).rejects.toThrow(/permission denied/);
    await expect(asRole(OWNER_A, `
      update forge_work_package_busts set evidence_summary = 'Forged.'
      where id = '${bust.id}';
    `)).rejects.toThrow(/permission denied/);
    await expect(asRole(OWNER_A, `
      delete from forge_work_package_busts where id = '${bust.id}';
    `)).rejects.toThrow(/permission denied/);
    await expect(asRole(OWNER_A, `
      insert into forge_work_package_bust_revisions
        (owner_id, id, bust_id, version, actor_id, action)
      values ('${OWNER_A}', 'forge_wpbustr_direct', '${bust.id}', 99, '${OWNER_A}', 'update');
    `)).rejects.toThrow(/permission denied/);
    // Nothing changed through the direct path.
    const { rows } = await db.query(`select evidence_summary, version from forge_work_package_busts where id = '${bust.id}';`);
    expect(rows[0].evidence_summary).toBe("Actual cost is over the frozen baseline.");
    expect(rows[0].version).toBe(1);
  });

  it60("revisions are append-only: the trigger refuses UPDATE and DELETE", async () => {
    const bust = await createBust(db, OWNER_A, {});
    await expect(db.query(`
      update forge_work_package_bust_revisions set reason = 'Rewritten history'
      where bust_id = '${bust.id}';
    `)).rejects.toThrow(/append-only/);
    await expect(db.query(`
      delete from forge_work_package_bust_revisions where bust_id = '${bust.id}';
    `)).rejects.toThrow(/append-only/);
    const { rows } = await db.query(`select count(*)::int as n from forge_work_package_bust_revisions where bust_id = '${bust.id}';`);
    expect(rows[0].n).toBe(1);
  });

  it60("ACL matrix: the seven RPCs run for authenticated only; helpers run for nobody", async () => {
    const rpcs = [
      "forge_work_package_busts_snapshot(text, text, date, integer)",
      "forge_work_package_bust_create(text, text, text, text, text, text, date, text, text, text, integer, numeric, numeric, text, text, text, date, text, text, text)",
      "forge_work_package_bust_update(text, text, integer, text, boolean, text, boolean, text)",
      "forge_work_package_bust_transition(text, text, integer, text, text, text, text)",
      "forge_work_package_bust_retire(text, text, integer, text)",
      "forge_work_package_bust_link_change_order(text, text, text, text, text)",
      "forge_work_package_bust_unlink_change_order(text, text, integer, text)",
    ];
    for (const fn of rpcs) {
      const { rows } = await db.query(`
        select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') as auth_exec,
               has_function_privilege('anon', 'public.${fn}', 'EXECUTE') as anon_exec,
               has_function_privilege('service_role', 'public.${fn}', 'EXECUTE') as sr_exec,
               has_function_privilege('public', 'public.${fn}', 'EXECUTE') as public_exec;
      `);
      expect(rows[0]).toEqual({ auth_exec: true, anon_exec: false, sr_exec: false, public_exec: false });
    }
    const helpers = [
      "forge_work_package_bust_fingerprint(text, text, text, text, text, text, text, date, text, text, integer, numeric, numeric, text, date)",
      "forge_work_package_bust_idempotency_check(text, text, text, text, text)",
      "forge_work_package_bust_check_cents(numeric)",
      "forge_work_package_bust_check_decimal(numeric, integer)",
      "forge_work_package_bust_revisions_immutable()",
    ];
    for (const fn of helpers) {
      const { rows } = await db.query(`
        select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') as auth_exec,
               has_function_privilege('anon', 'public.${fn}', 'EXECUTE') as anon_exec,
               has_function_privilege('service_role', 'public.${fn}', 'EXECUTE') as sr_exec,
               has_function_privilege('public', 'public.${fn}', 'EXECUTE') as public_exec;
      `);
      expect(rows[0]).toEqual({ auth_exec: false, anon_exec: false, sr_exec: false, public_exec: false });
    }
    for (const table of [
      "forge_work_package_busts",
      "forge_work_package_bust_revisions",
      "forge_work_package_bust_change_orders",
    ]) {
      const { rows } = await db.query(`
        select has_table_privilege('authenticated', 'public.${table}', 'SELECT') as can_select,
               has_table_privilege('authenticated', 'public.${table}', 'INSERT') as can_insert,
               has_table_privilege('anon', 'public.${table}', 'SELECT') as anon_select,
               has_table_privilege('service_role', 'public.${table}', 'SELECT') as sr_select;
      `);
      expect(rows[0]).toEqual({ can_select: true, can_insert: false, anon_select: false, sr_select: false });
    }
  });

  it60("default-privilege negative case: a fresh function is open by default, so the revokes are load-bearing", async () => {
    await db.query(`
      create or replace function public.forge_work_package_bust_probe()
      returns text language sql as $$ select 'probe' $$;
    `);
    const { rows } = await db.query(`
      select has_function_privilege('authenticated', 'public.forge_work_package_bust_probe()', 'EXECUTE') as auth_exec,
             has_function_privilege('anon', 'public.forge_work_package_bust_probe()', 'EXECUTE') as anon_exec;
    `);
    // Without the migration's explicit revokes, any new function is
    // EXECUTE-able by every app role through PUBLIC — that is the
    // PR #766 lesson, and it is why the slice-9 functions are each
    // revoked from public, anon, authenticated AND service_role.
    expect(rows[0].auth_exec).toBe(true);
    expect(rows[0].anon_exec).toBe(true);
    await db.query("drop function public.forge_work_package_bust_probe();");
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

describe.skipIf(!HAS_REAL_PG)("slice 9 migration: real-PostgreSQL subset", () => {
  let pgDir;
  let pgClient;
  let pgCfg;

  beforeAll(async () => {
    pgDir = mkdtempSync(join(tmpdir(), "wpp9-realpg-"));
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
    await pgClient.query(SEED_SQL);
    await pgClient.query(loadMigrationSql(SLICE9));
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

  async function pgSnapshot(uid, packageId) {
    const { rows } = await pgAsUser(pgClient, uid, `
      select forge_work_package_busts_snapshot('${OWNER_A}', '${packageId}', '2026-11-15', null) as snap;
    `);
    return rows[0].snap;
  }

  async function pgCreateBust(uid, overrides = {}) {
    const input = {
      dimension: "LABOR_COST",
      scopeType: "PACKAGE",
      takeoffLineId: null,
      workStepId: null,
      craft: null,
      workDate: null,
      shiftKey: null,
      baselineId: "base_1",
      baselineVersion: 1,
      plannedValue: 1000000,
      observedValue: 1250000,
      unit: "USD_CENTS",
      evidenceSummary: "Actual cost is over the frozen baseline.",
      ...overrides,
    };
    const { rows } = await pgAsUser(pgClient, uid, `
      select * from forge_work_package_bust_create(
        '${OWNER_A}', 'pkg_a', ${sqlStr(input.scopeType)},
        ${sqlStr(input.takeoffLineId)}, ${sqlStr(input.workStepId)}, ${sqlStr(input.craft)},
        ${sqlStr(input.workDate)}, ${sqlStr(input.shiftKey)}, ${sqlStr(input.dimension)},
        ${sqlStr(input.baselineId)}, ${sqlNum(input.baselineVersion)},
        ${sqlNum(input.plannedValue)}, ${sqlNum(input.observedValue)}, ${sqlStr(input.unit)},
        ${sqlStr(input.evidenceSummary)}, null, '2026-11-15',
        null, null, null);
    `);
    return rows[0];
  }

  it60("concurrent creates of the same bust serialize: one wins, the other gets DUPLICATE_ACTIVE", async () => {
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const create = (client) => pgAsUser(client, OWNER_A, `
        select * from forge_work_package_bust_create(
          '${OWNER_A}', 'pkg_a', 'PACKAGE',
          null, null, null, null, null, 'LABOR_COST',
          'base_1', 1, 1000000, 1250000, 'USD_CENTS',
          'Actual cost is over the frozen baseline.', null, '2026-11-15',
          null, null, null);
      `);
      const results = await Promise.allSettled([create(clientA), create(clientB)]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toMatch(/WPP9_DUPLICATE_ACTIVE/);
      const { rows } = await pgClient.query(`
        select count(*)::int as n from forge_work_package_busts
        where owner_id = '${OWNER_A}' and dimension = 'LABOR_COST';
      `);
      expect(rows[0].n).toBe(1);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("concurrent transitions on the same version: one wins, the other gets VERSION_CONFLICT", async () => {
    const bust = await pgCreateBust(OWNER_A, {
      dimension: "LABOR_HOURS",
      plannedValue: 400,
      observedValue: 440.5,
      unit: "HOURS",
      evidenceSummary: "Actual hours are over the frozen baseline.",
    });
    expect(bust.version).toBe(1);
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const move = (client) => pgAsUser(client, OWNER_A, `
        select * from forge_work_package_bust_transition(
          '${OWNER_A}', '${bust.id}', 1, 'UNDER_REVIEW', null, null, 'Race move');
      `);
      const results = await Promise.allSettled([move(clientA), move(clientB)]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toMatch(/WPP9_VERSION_CONFLICT/);
      const { rows: after } = await pgClient.query(`
        select status, version from forge_work_package_busts where id = '${bust.id}';
      `);
      expect(after[0].status).toBe("UNDER_REVIEW");
      expect(after[0].version).toBe(2);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("an uncommitted bust is invisible to the snapshot, and visible after commit", async () => {
    const before = await pgSnapshot(OWNER_A, "pkg_a");
    const beforeCount = before.activeBusts.length;
    const writer = new Client(pgCfg);
    await writer.connect();
    try {
      await writer.query("begin");
      await pgAsUser(writer, OWNER_A, `
        select * from forge_work_package_bust_create(
          '${OWNER_A}', 'pkg_a', 'PACKAGE',
          null, null, null, null, null, 'SCHEDULE_DAYS',
          'base_1', 1, 9, 12, 'DAYS',
          'Package ran 12 days against a 9-day plan.', null, '2026-11-15',
          null, null, null);
      `);
      // The writer's bust is uncommitted: a concurrent snapshot must
      // still see only the committed busts — never a mix.
      const during = await pgSnapshot(OWNER_A, "pkg_a");
      expect(during.activeBusts.length).toBe(beforeCount);
      await writer.query("commit");
    } finally {
      await writer.end().catch(() => {});
    }
    const after = await pgSnapshot(OWNER_A, "pkg_a");
    expect(after.activeBusts.length).toBe(beforeCount + 1);
    expect(after.activeBusts.map((b) => b.dimension)).toContain("SCHEDULE_DAYS");
  });

  it60("ACL matrix on real PG: authenticated reads and executes, anon and service_role get nothing", async () => {
    for (const table of [
      "forge_work_package_busts",
      "forge_work_package_bust_revisions",
      "forge_work_package_bust_change_orders",
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
      "forge_work_package_busts_snapshot(text, text, date, integer)",
      "forge_work_package_bust_create(text, text, text, text, text, text, date, text, text, text, integer, numeric, numeric, text, text, text, date, text, text, text)",
      "forge_work_package_bust_update(text, text, integer, text, boolean, text, boolean, text)",
      "forge_work_package_bust_transition(text, text, integer, text, text, text, text)",
      "forge_work_package_bust_retire(text, text, integer, text)",
      "forge_work_package_bust_link_change_order(text, text, text, text, text)",
      "forge_work_package_bust_unlink_change_order(text, text, integer, text)",
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

  it60("a rolled-back create leaves no bust and no revision (same-transaction audit rollback)", async () => {
    const { rows: beforeBusts } = await pgClient.query("select count(*)::int as n from forge_work_package_busts;");
    const { rows: beforeRevs } = await pgClient.query("select count(*)::int as n from forge_work_package_bust_revisions;");
    const writer = new Client(pgCfg);
    await writer.connect();
    try {
      await writer.query("begin");
      await pgAsUser(writer, OWNER_A, `
        select * from forge_work_package_bust_create(
          '${OWNER_A}', 'pkg_a', 'TAKEOFF_LINE',
          'line_1', null, null, null, null, 'INSTALLED_QUANTITY',
          null, null, 10, 12.5, 'EA',
          'Installed 12.5 EA against 10 EA planned.', null, '2026-11-15',
          null, null, null);
      `);
      await writer.query("rollback");
    } finally {
      await writer.end().catch(() => {});
    }
    const { rows: afterBusts } = await pgClient.query("select count(*)::int as n from forge_work_package_busts;");
    const { rows: afterRevs } = await pgClient.query("select count(*)::int as n from forge_work_package_bust_revisions;");
    expect(afterBusts[0].n).toBe(beforeBusts[0].n);
    expect(afterRevs[0].n).toBe(beforeRevs[0].n);
  });

  it60("RLS on real PG: another owner sees nothing, a co-owner sees the busts, anon is denied", async () => {
    const { rows: ownerRows } = await pgAsUser(pgClient, OWNER_A, "select id from forge_work_package_busts;");
    expect(ownerRows.length).toBeGreaterThan(0);
    const { rows: otherRows } = await pgAsUser(pgClient, OWNER_B, "select id from forge_work_package_busts;");
    expect(otherRows).toEqual([]);
    const { rows: memberRows } = await pgAsUser(pgClient, MEMBER_C, "select id from forge_work_package_busts;");
    expect(memberRows.length).toBe(ownerRows.length);
    await pgClient.query("set role anon;");
    try {
      await expect(pgClient.query("select id from forge_work_package_busts;")).rejects.toThrow(/permission denied/);
    } finally {
      await pgClient.query("reset role;");
    }
  });

  it60("RESOLVED_BY_CHANGE fails closed on provenance on real PG, and the failed move writes nothing", async () => {
    // Distinct figures from the concurrent-creates bust, so the
    // duplicate-active identity cannot collide in the shared cluster.
    const bust = await pgCreateBust(OWNER_A, { plannedValue: 900000, observedValue: 1100000 });
    await pgAsUser(pgClient, OWNER_A, `
      select * from forge_work_package_bust_link_change_order(
        '${OWNER_A}', '${bust.id}', 'co_2', null, 'Covers the overrun.');
    `);
    const { rows: before } = await pgClient.query(`
      select status, version, resolved_baseline_id from forge_work_package_busts where id = '${bust.id}';
    `);
    expect(before[0].status).toBe("OPEN");
    expect(before[0].version).toBe(2);
    const { rows: revsBefore } = await pgClient.query(`
      select count(*)::int as n from forge_work_package_bust_revisions where bust_id = '${bust.id}';
    `);
    // Newer frozen baseline (base_2, version 2) + linked approved
    // order: still refused — no provenance linkage exists.
    await expectRpcError(pgAsUser(pgClient, OWNER_A, `
      select * from forge_work_package_bust_transition(
        '${OWNER_A}', '${bust.id}', 2, 'RESOLVED_BY_CHANGE',
        'Resolved by change.', 'base_2', 'Moving the bust forward.');
    `), "WPP9_RESOLVED_PROVENANCE_UNAVAILABLE");
    const { rows: after } = await pgClient.query(`
      select status, version, resolved_baseline_id from forge_work_package_busts where id = '${bust.id}';
    `);
    expect(after[0].status).toBe("OPEN");
    expect(after[0].version).toBe(2);
    expect(after[0].resolved_baseline_id).toBe(null);
    const { rows: revsAfter } = await pgClient.query(`
      select count(*)::int as n from forge_work_package_bust_revisions where bust_id = '${bust.id}';
    `);
    expect(revsAfter[0].n).toBe(revsBefore[0].n);
  });
});
