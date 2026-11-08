// Work Package Planner slice 6 — migration/integration proof (reconciled scope).
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) and proves:
//   - Schema: NO second outage-setting source exists (no settings table,
//     no settings revisions, no standard-hours column anywhere); the
//     placements table carries baseline_version with a same-owner/
//     package/version FK to forge_work_package_baselines; the partial-
//     unique live placement per step per baseline version; revisions;
//   - Snapshot RPC: one statement returns baseline + steps + placements
//     + assignments + per-source generations; named version, latest
//     version, missing named version (404), no baseline (baseline null);
//   - Placement RPCs: set/move/clear against an EXACT baseline version
//     (stale/rebased input refused, terminal packages read-only,
//     version guards, reason rules, fit-inside-window);
//   - Re-baseline: old placements stay readable against their named
//     baseline, never carry forward, and are never mutated afterwards;
//   - Read consistency (P1-3): the snapshot's generation markers match
//     the arrays in the same result — one statement, one snapshot;
//   - RLS: owner isolation, co-owner access, anon sees nothing, direct
//     writes denied (RPC-only write path);
//   - Atomic audit: a failed mutation leaves no row and no revision;
//   - Slice-5 untouched: forge_work_step_update / forge_work_step_retire
//     keep their exact bodies across the slice-6 apply (a duration edit
//     that strands a placement succeeds; the placement is rejected ON
//     READ as unallocated, never by blocking the edit);
//   - Effective ACL matrix for authenticated/anon/service_role, and
//     the default-privilege negative case.
// Roles, the auth.uid() stub, workspace_members, and the
// has_workspace_access() copy mirror production; the prerequisite
// packages/drawings/takeoff-lines/baselines tables are the minimal
// shapes the slice-3/4/5/6 foreign keys reference, plus the status
// column the terminal-package rule reads.
//
// A real-PostgreSQL subset (concurrent placement edits with two live
// connections, an uncommitted step edit invisible to the snapshot,
// ACL matrix, same-transaction audit rollback) runs against a scratch
// PG16 cluster when the binaries exist, and SKIPS LOUDLY — never
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
import { Client } from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const it60 = (name, fn) => it(name, fn, 60000);

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const MEMBER_C = "33333333-3333-4333-8333-333333333333";

const SLICE3 = "20261107000000_forge_work_package_permit_annotations_slice3.sql";
const SLICE4 = "20261107010000_forge_work_package_craft_assignments_slice4.sql";
const SLICE5 = "20261107020000_forge_work_package_work_steps_slice5.sql";
const SLICE6 = "20261107030000_forge_work_package_manpower_curve_slice6.sql";

function loadMigrationSql(name) {
  return readFileSync(join(HERE, "..", "..", "..", "supabase", "migrations", name), "utf8");
}

// Minimal prerequisite shape with the exact keys the slice-3/4/5/6
// foreign keys reference, plus the status column the terminal-package
// rule reads. Copied from the slice-5 migration test, plus the rung-4
// baselines table (the reconciled slice-6 window source).
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
  create table forge_work_package_baselines (
    owner_id text not null,
    id text not null default ('forge_wpb_' || gen_random_uuid()::text),
    package_id text not null,
    version_number integer not null,
    baseline_start date not null,
    baseline_finish date not null,
    baseline_hours numeric(14,2) not null,
    baseline_cost numeric(14,2) not null,
    frozen_by text not null,
    frozen_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    primary key (owner_id, id),
    constraint forge_work_package_baselines_version_check check (version_number >= 1),
    constraint forge_work_package_baselines_dates_check check (baseline_finish >= baseline_start),
    constraint forge_work_package_baselines_version_unique unique (owner_id, package_id, version_number)
  );
  -- The snapshot RPC is SECURITY INVOKER: it reads packages and baselines
  -- as the caller, so the application role needs SELECT on these
  -- prerequisite tables (the steps/placements/assignments grants come
  -- from their own slice migrations). The placement RPCs are SECURITY
  -- DEFINER and do not need the caller's grants.
  grant select on forge_work_packages to authenticated;
  grant select on forge_work_package_baselines to authenticated;
  grant select on forge_work_drawings to authenticated;
  grant select on forge_work_takeoff_lines to authenticated;
`;

const SEED_SQL = `
  insert into forge_work_packages (owner_id, id, status) values
    ('${OWNER_A}', 'pkg_a', 'in_progress'),
    ('${OWNER_A}', 'pkg_cancelled', 'cancelled'),
    ('${OWNER_A}', 'pkg_closed', 'verified_closed'),
    ('${OWNER_A}', 'pkg_nobaseline', 'in_progress'),
    ('${OWNER_B}', 'pkg_b', 'in_progress');
  insert into forge_work_package_baselines
    (owner_id, package_id, version_number, baseline_start, baseline_finish, baseline_hours, baseline_cost, frozen_by)
  values
    ('${OWNER_A}', 'pkg_a', 1, '2026-11-09', '2026-11-18', 400, 100000, '${OWNER_A}'),
    ('${OWNER_A}', 'pkg_cancelled', 1, '2026-11-09', '2026-11-18', 400, 100000, '${OWNER_A}'),
    ('${OWNER_A}', 'pkg_closed', 1, '2026-11-09', '2026-11-18', 400, 100000, '${OWNER_A}'),
    ('${OWNER_B}', 'pkg_b', 1, '2026-11-09', '2026-11-18', 400, 100000, '${OWNER_B}');
  insert into forge_work_drawings (owner_id, package_id, id, drawing_number, drawing_type, title, p_id_drawing_id) values
    ('${OWNER_A}', 'pkg_a', 'dwg_1', 'P-101', 'p_id', 'Main line', null),
    ('${OWNER_A}', 'pkg_a', 'dwg_2', 'C-201', 'cut_sheet', 'Spool sheet', null);
  insert into workspace_members (owner_id, member_user_id, status, role)
    values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
`;

// Slice-5 function bodies captured BEFORE the slice-6 apply, so the
// "slice 6 does not replace slice-5 functions" test compares real text.
let slice5BodiesBefore = null;

async function setupDb() {
  const db = new PGlite();
  await db.exec(PREREQ_SQL);
  // Apply the shipped files in timestamp order: slice 3, slice 4,
  // slice 5, then slice 6. The slice-5 bodies are captured between
  // slice 5 and slice 6.
  await db.exec(loadMigrationSql(SLICE3));
  await db.exec(loadMigrationSql(SLICE4));
  await db.exec(loadMigrationSql(SLICE5));
  const { rows } = await db.query(`
    select proname, prosrc from pg_proc
    where proname in ('forge_work_step_update', 'forge_work_step_retire')
      and pronamespace = 'public'::regnamespace order by proname;
  `);
  slice5BodiesBefore = Object.fromEntries(rows.map((r) => [r.proname, r.prosrc]));
  await db.exec(loadMigrationSql(SLICE6));
  await db.exec(SEED_SQL);
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

function dateStr(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
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

async function updateStep(db, uid, stepId, {
  expectedVersion, title, durationDays, personHours, setDurationDays, setPersonHours, reason,
} = {}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_step_update(
      '${OWNER_A}', '${stepId}', ${sqlNum(expectedVersion)},
      ${sqlStr(title ?? null)}, null, null,
      ${sqlNum(durationDays ?? null)}, ${sqlNum(personHours ?? null)},
      null,
      false, false,
      ${setDurationDays === true ? "true" : "false"},
      ${setPersonHours === true ? "true" : "false"},
      false, false,
      ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function retireStep(db, uid, stepId, { expectedVersion, reason } = {}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_step_retire(
      '${OWNER_A}', '${stepId}', ${sqlNum(expectedVersion)},
      ${sqlStr(reason ?? null)}, false);
  `);
  return rows[0];
}

async function createAssignment(db, uid, {
  packageId, workDate, craftLabel, crewSize, hoursPerPerson,
} = {}) {
  // Slice-4 signature: (owner, package, work_date, craft_label,
  // crew_label, shift_kind, shift_label, crew_size, hours_per_person,
  // note, historical_correction, reason). craft_key is derived from the
  // label inside the RPC.
  const { rows } = await asUser(db, uid, `
    select * from forge_work_craft_assignment_create(
      '${OWNER_A}', '${packageId ?? "pkg_a"}', ${sqlStr(workDate ?? "2026-11-09")},
      ${sqlStr(craftLabel ?? "Pipefitter")},
      null, 'day', null, ${sqlNum(crewSize ?? 2)}, ${sqlNum(hoursPerPerson ?? 7)},
      null, null, null);
  `);
  return rows[0];
}

async function snapshot(db, uid, { packageId, baselineVersion } = {}) {
  const { rows } = await asUser(db, uid, `
    select forge_work_manpower_curve_snapshot(
      '${OWNER_A}', '${packageId ?? "pkg_a"}', ${sqlNum(baselineVersion ?? null)}) as snap;
  `);
  return rows[0].snap;
}

async function setPlacement(db, uid, {
  packageId, stepId, baselineVersion, startDay, expectedVersion, reason,
} = {}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_manpower_curve_placement_set(
      '${OWNER_A}', '${packageId ?? "pkg_a"}', '${stepId}',
      ${sqlNum(baselineVersion ?? 1)}, ${sqlNum(startDay)}, ${sqlNum(expectedVersion ?? null)}, ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function clearPlacement(db, uid, placementId, { expectedVersion, reason } = {}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_manpower_curve_placement_clear(
      '${OWNER_A}', '${placementId}', ${sqlNum(expectedVersion)}, ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function addBaseline(db, { packageId, version, start, finish } = {}) {
  await db.query(`
    insert into forge_work_package_baselines
      (owner_id, package_id, version_number, baseline_start, baseline_finish, baseline_hours, baseline_cost, frozen_by)
    values ('${OWNER_A}', '${packageId ?? "pkg_a"}', ${version}, '${start}', '${finish}', 400, 100000, '${OWNER_A}');
  `);
}

async function placementRows(db, stepId) {
  const { rows } = await db.query(`
    select * from forge_work_step_curve_placements
    where owner_id = '${OWNER_A}' and step_id = '${stepId}' order by created_at;
  `);
  return rows;
}

async function placementRevisionRows(db, placementId) {
  const { rows } = await db.query(`
    select * from forge_work_step_curve_placement_revisions
    where placement_id = '${placementId}' order by version;
  `);
  return rows;
}

describe("slice 6 migration: no second outage-setting source", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("creates exactly the two placement tables — no settings table, no standard-hours column", async () => {
    const { rows } = await db.query(`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name like '%manpower%' or table_name like '%curve%'
      order by table_name;
    `);
    expect(rows.map((r) => r.table_name)).toEqual([
      "forge_work_step_curve_placement_revisions",
      "forge_work_step_curve_placements",
    ]);
    const settings = await db.query(`
      select table_name from information_schema.tables
      where table_name in ('forge_work_package_curve_settings', 'forge_work_package_curve_settings_revisions');
    `);
    expect(settings.rows).toHaveLength(0);
    const stdHours = await db.query(`
      select column_name from information_schema.columns
      where column_name like '%standard_hours%';
    `);
    expect(stdHours.rows).toHaveLength(0);
    const fns = await db.query(`
      select proname from pg_proc
      where proname like '%manpower_curve%' and pronamespace = 'public'::regnamespace
      order by proname;
    `);
    expect(fns.rows.map((r) => r.proname)).toEqual([
      "forge_work_manpower_curve_placement_clear",
      "forge_work_manpower_curve_placement_set",
      "forge_work_manpower_curve_snapshot",
    ]);
  });

  it60("placements carry baseline_version with a FK to the same owner/package/version", async () => {
    const fks = await db.query(`
      select conname, pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'forge_work_step_curve_placements'::regclass and contype = 'f';
    `);
    const defs = fks.rows.map((r) => r.def);
    expect(defs.some((d) => d.includes("forge_work_package_baselines") && d.includes("baseline_version"))).toBe(true);
    expect(defs.some((d) => d.includes("forge_work_steps"))).toBe(true);
    // A placement naming a baseline version that does not exist is refused.
    const step = await createStep(db, OWNER_A, {});
    await expect(setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 9, startDay: 1 }))
      .rejects.toThrow(/WPP6_BASELINE_NOT_FOUND/);
    expect(await placementRows(db, step.id)).toHaveLength(0);
  });

  it60("rejects a second live placement for the same step AND baseline version at the database level", async () => {
    const step = await createStep(db, OWNER_A, {});
    const placement = await setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 1 });
    expect(placement.version).toBe(1);
    // A direct second live row for the same step + version violates the
    // partial unique index even for the table owner.
    await expect(db.query(`
      insert into forge_work_step_curve_placements
        (owner_id, id, work_package_id, step_id, baseline_version, start_day_index, version, created_by, updated_by)
        values ('${OWNER_A}', 'forge_wpsp_direct', 'pkg_a', '${step.id}', 1, 2, 1, 'u', 'u');
    `)).rejects.toThrow(/duplicate key/i);
    // The same step CAN hold a placement for a different baseline version.
    await addBaseline(db, { version: 2, start: "2026-11-20", finish: "2026-11-29" });
    const other = await setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 2, startDay: 1 });
    expect(other.baseline_version).toBe(2);
  });

  it60("refuses to delete a package while placements exist", async () => {
    const step = await createStep(db, OWNER_A, {});
    await setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 1 });
    await expect(db.query(`
      delete from forge_work_packages where owner_id = '${OWNER_A}' and id = 'pkg_a';
    `)).rejects.toThrow(/foreign key/i);
  });
});

describe("slice 6 migration: snapshot RPC", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("returns baseline + steps + placements + assignments + generations in one snapshot", async () => {
    const step = await createStep(db, OWNER_A, { durationDays: 4, personHours: 40 });
    await setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 3 });
    await createAssignment(db, OWNER_A, { workDate: "2026-11-09", crewSize: 2, hoursPerPerson: 7 });
    const snap = await snapshot(db, OWNER_A, {});
    expect(snap.baseline.version_number).toBe(1);
    expect(dateStr(snap.baseline.baseline_start)).toBe("2026-11-09");
    expect(dateStr(snap.baseline.baseline_finish)).toBe("2026-11-18");
    expect(snap.steps).toHaveLength(1);
    expect(snap.steps[0].id).toBe(step.id);
    expect(Number(snap.steps[0].planned_person_hours)).toBe(40);
    expect(snap.placements).toHaveLength(1);
    expect(snap.placements[0].step_id).toBe(step.id);
    expect(snap.placements[0].start_day_index).toBe(3);
    expect(snap.assignments).toHaveLength(1);
    expect(dateStr(snap.assignments[0].work_date)).toBe("2026-11-09");
    expect(snap.assignments[0].crew_size).toBe(2);
    // The generation markers describe exactly the arrays in this same result.
    expect(snap.generations.steps.count).toBe(1);
    expect(snap.generations.steps.max_version).toBe(1);
    expect(snap.generations.placements.count).toBe(1);
    expect(snap.generations.assignments.count).toBe(1);
    expect(snap.generations.baseline_version).toBe(1);
  });

  it60("a named baseline version is read; a missing named version raises, and no baseline reads null", async () => {
    await addBaseline(db, { version: 2, start: "2026-11-20", finish: "2026-11-29" });
    const latest = await snapshot(db, OWNER_A, {});
    expect(latest.baseline.version_number).toBe(2);
    const named = await snapshot(db, OWNER_A, { baselineVersion: 1 });
    expect(named.baseline.version_number).toBe(1);
    expect(dateStr(named.baseline.baseline_start)).toBe("2026-11-09");
    await expect(snapshot(db, OWNER_A, { baselineVersion: 9 })).rejects.toThrow(/WPP6_BASELINE_NOT_FOUND/);
    const none = await snapshot(db, OWNER_A, { packageId: "pkg_nobaseline" });
    expect(none.baseline).toBeNull();
    expect(none.steps).toEqual([]);
    expect(none.generations.baseline_version).toBeNull();
  });

  it60("a retired step and its placement are invisible to the snapshot (placement inert, not deleted)", async () => {
    const step = await createStep(db, OWNER_A, {});
    const placed = await setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 3 });
    await retireStep(db, OWNER_A, step.id, { expectedVersion: 1, reason: "Superseded" });
    const snap = await snapshot(db, OWNER_A, {});
    expect(snap.steps).toHaveLength(0);
    expect(snap.placements).toHaveLength(0);
    // The placement row itself is untouched: still live, still readable.
    const rows = await placementRows(db, step.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(placed.id);
    expect(rows[0].retired_at).toBeNull();
  });

  it60("the snapshot refuses another owner's workspace", async () => {
    await expect(snapshot(db, OWNER_B, {})).rejects.toThrow(/WPP6_WORKSPACE_FORBIDDEN/);
  });
});

describe("slice 6 migration: placement RPCs", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("sets a placement at version 1 with an audit revision, then moves it version-guarded with a reason", async () => {
    const step = await createStep(db, OWNER_A, { durationDays: 2, personHours: 30 });
    const placed = await setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 3 });
    expect(placed.start_day_index).toBe(3);
    expect(placed.version).toBe(1);
    expect(placed.baseline_version).toBe(1);
    // Moving without a reason is refused.
    await expect(setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 4, expectedVersion: 1 }))
      .rejects.toThrow(/WPP6_REASON_REQUIRED/);
    // Moving with a stale version is refused.
    await expect(setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 4, expectedVersion: 99, reason: "Sequencing" }))
      .rejects.toThrow(/WPP6_VERSION_CONFLICT/);
    const moved = await setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 4, expectedVersion: 1, reason: "Sequencing" });
    expect(moved.start_day_index).toBe(4);
    expect(moved.version).toBe(2);
    const revisions = await placementRevisionRows(db, placed.id);
    expect(revisions.map((r) => [r.version, r.action, r.reason])).toEqual([
      [1, "set", null],
      [2, "set", "Sequencing"],
    ]);
    expect(revisions[1].old_values.start_day_index).toBe(3);
    expect(revisions[1].new_values.start_day_index).toBe(4);
  });

  it60("rejects a start day outside the window and a placement that runs past it", async () => {
    const step = await createStep(db, OWNER_A, { durationDays: 4, personHours: 40 });
    await expect(setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 11 })).rejects.toThrow(/WPP6_INVALID_START_DAY/);
    await expect(setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 8 })).rejects.toThrow(/WPP6_PLACEMENT_OUTSIDE_WINDOW/);
    expect(await placementRows(db, step.id)).toHaveLength(0);
    // Day 7 + 4 days ends on day 10: fits exactly.
    const placed = await setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 7 });
    expect(placed.start_day_index).toBe(7);
  });

  it60("a step with no duration can only start on day 1", async () => {
    const step = await createStep(db, OWNER_A, { durationDays: null, personHours: 20 });
    await expect(setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 2 })).rejects.toThrow(/WPP6_PLACEMENT_OUTSIDE_WINDOW/);
    const placed = await setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 1 });
    expect(placed.start_day_index).toBe(1);
  });

  it60("clears a placement version-guarded with a reason, and a cleared placement cannot be cleared again", async () => {
    const step = await createStep(db, OWNER_A, {});
    const placed = await setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 3 });
    await expect(clearPlacement(db, OWNER_A, placed.id, { expectedVersion: 1, reason: "  " }))
      .rejects.toThrow(/WPP6_REASON_REQUIRED/);
    await expect(clearPlacement(db, OWNER_A, placed.id, { expectedVersion: 99, reason: "No longer sequenced" }))
      .rejects.toThrow(/WPP6_VERSION_CONFLICT/);
    const cleared = await clearPlacement(db, OWNER_A, placed.id, { expectedVersion: 1, reason: "No longer sequenced" });
    expect(cleared.retired_at).not.toBeNull();
    expect(cleared.version).toBe(2);
    const revisions = await placementRevisionRows(db, placed.id);
    expect(revisions.map((r) => [r.version, r.action])).toEqual([[1, "set"], [2, "clear"]]);
    await expect(clearPlacement(db, OWNER_A, placed.id, { expectedVersion: 2, reason: "Again" }))
      .rejects.toThrow(/WPP6_RETIRED/);
    // A new placement can be set after a clear.
    const replaced = await setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 2 });
    expect(replaced.id).not.toBe(placed.id);
    expect(replaced.version).toBe(1);
  });

  it60("refuses placements on terminal packages and on retired steps", async () => {
    const step = await createStep(db, OWNER_A, {});
    await expect(setPlacement(db, OWNER_A, { packageId: "pkg_cancelled", stepId: step.id, baselineVersion: 1, startDay: 1 }))
      .rejects.toThrow(/WPP6_PACKAGE_TERMINAL/);
    const retired = await retireStep(db, OWNER_A, step.id, { expectedVersion: 1, reason: "Superseded" });
    expect(retired.retired_at).not.toBeNull();
    await expect(setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 1 })).rejects.toThrow(/WPP6_RETIRED/);
  });

  it60("a failed placement leaves no placement row and no revision (atomic audit)", async () => {
    const step = await createStep(db, OWNER_A, { durationDays: 4, personHours: 40 });
    await expect(setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 8 })).rejects.toThrow(/WPP6_PLACEMENT_OUTSIDE_WINDOW/);
    expect(await placementRows(db, step.id)).toHaveLength(0);
    const { rows } = await db.query(`select count(*)::int as n from forge_work_step_curve_placement_revisions;`);
    expect(rows[0].n).toBe(0);
  });
});

describe("slice 6 migration: re-baseline", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("a re-baseline never reuses old placements: latest reads empty, the named old version still reads its placement", async () => {
    const step = await createStep(db, OWNER_A, { durationDays: 2, personHours: 30 });
    const placed = await setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 3 });
    await addBaseline(db, { version: 2, start: "2026-11-20", finish: "2026-11-29" });

    const latest = await snapshot(db, OWNER_A, {});
    expect(latest.baseline.version_number).toBe(2);
    expect(latest.placements).toHaveLength(0);
    const old = await snapshot(db, OWNER_A, { baselineVersion: 1 });
    expect(old.baseline.version_number).toBe(1);
    expect(old.placements).toHaveLength(1);
    expect(old.placements[0].id).toBe(placed.id);
    expect(old.placements[0].start_day_index).toBe(3);
  });

  it60("writes against a stale baseline version are refused; the new version accepts them", async () => {
    const step = await createStep(db, OWNER_A, { durationDays: 2, personHours: 30 });
    const placed = await setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 3 });
    await addBaseline(db, { version: 2, start: "2026-11-20", finish: "2026-11-29" });

    await expect(setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 4, expectedVersion: 1, reason: "Late move" }))
      .rejects.toThrow(/WPP6_BASELINE_STALE/);
    await expect(clearPlacement(db, OWNER_A, placed.id, { expectedVersion: 1, reason: "No longer sequenced" }))
      .rejects.toThrow(/WPP6_BASELINE_STALE/);
    // The old placement row is untouched by the refused writes.
    const rows = await placementRows(db, step.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(1);
    expect(rows[0].retired_at).toBeNull();
    // The new version takes a fresh placement.
    const fresh = await setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 2, startDay: 2 });
    expect(fresh.baseline_version).toBe(2);
    expect(fresh.version).toBe(1);
    expect(fresh.id).not.toBe(placed.id);
  });

  it60("201 revisions page exactly with no duplicates and no missing rows", async () => {
    const step = await createStep(db, OWNER_A, {});
    const placed = await setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 1 });
    // One set revision exists; seed 200 more directly (same shape the
    // RPC writes) so the paging proof does not need 200 RPC round trips.
    const values = [];
    for (let v = 2; v <= 201; v++) {
      values.push(`('${OWNER_A}', 'forge_wpspr_seed_${v}', '${placed.id}', ${v}, '${OWNER_A}', 'set', '{}', '{}', null)`);
    }
    await db.query(`
      insert into forge_work_step_curve_placement_revisions
        (owner_id, id, placement_id, version, actor_id, action, old_values, new_values, reason)
      values ${values.join(",")};
    `);
    const seen = [];
    for (let offset = 0; offset < 201; offset += 50) {
      const { rows } = await db.query(`
        select version from forge_work_step_curve_placement_revisions
        where owner_id = '${OWNER_A}' and placement_id = '${placed.id}'
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

describe("slice 6 migration: slice-5 functions untouched", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("the slice-6 apply does not change the slice-5 step function bodies", async () => {
    const { rows } = await db.query(`
      select proname, prosrc from pg_proc
      where proname in ('forge_work_step_update', 'forge_work_step_retire')
        and pronamespace = 'public'::regnamespace order by proname;
    `);
    expect(Object.fromEntries(rows.map((r) => [r.proname, r.prosrc]))).toEqual(slice5BodiesBefore);
  });

  it60("a duration edit that strands a placement SUCCEEDS — the placement is rejected on read, never by blocking the edit", async () => {
    const step = await createStep(db, OWNER_A, { durationDays: 4, personHours: 40 });
    await setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 7 });
    const updated = await updateStep(db, OWNER_A, step.id, {
      expectedVersion: 1, durationDays: 5, setDurationDays: true, reason: "More work",
    });
    expect(updated.planned_duration_days).toBe(5);
    expect(updated.version).toBe(2);
    // The snapshot still returns the step (new duration) and the placement;
    // the application layer marks it unallocated on read.
    const snap = await snapshot(db, OWNER_A, {});
    expect(snap.steps[0].planned_duration_days).toBe(5);
    expect(snap.placements).toHaveLength(1);
    expect(snap.placements[0].start_day_index).toBe(7);
  });

  it60("the slice-5 functions keep their exact signatures (no overload was created)", async () => {
    const { rows } = await db.query(`
      select proname, pg_get_function_identity_arguments(oid) as args
      from pg_proc where proname in ('forge_work_step_update', 'forge_work_step_retire')
        and pronamespace = 'public'::regnamespace;
    `);
    expect(rows).toHaveLength(2);
    const update = rows.find((r) => r.proname === "forge_work_step_update");
    expect(update.args).toBe("p_owner_id text, p_step_id text, p_expected_version integer, p_title text, p_description text, p_craft_label text, p_planned_duration_days integer, p_planned_person_hours numeric, p_source_note text, p_set_description boolean, p_set_craft_label boolean, p_set_duration_days boolean, p_set_person_hours boolean, p_set_source_note boolean, p_historical_correction boolean, p_reason text");
    const retire = rows.find((r) => r.proname === "forge_work_step_retire");
    expect(retire.args).toBe("p_owner_id text, p_step_id text, p_expected_version integer, p_reason text, p_historical_correction boolean");
  });
});

describe("slice 6 migration: RLS and ACL", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("owner isolation: another owner sees nothing, a co-owner sees the rows, anon sees nothing", async () => {
    const step = await createStep(db, OWNER_A, {});
    await setPlacement(db, OWNER_A, { stepId: step.id, baselineVersion: 1, startDay: 2 });
    const asOther = await asUser(db, OWNER_B, `select * from forge_work_step_curve_placements;`);
    expect(asOther.rows).toHaveLength(0);
    const asCoOwner = await asUser(db, MEMBER_C, `select * from forge_work_step_curve_placements;`);
    expect(asCoOwner.rows).toHaveLength(1);
    // Anon has no policy and no grant: the select is denied outright.
    await expect(
      asRole(db, "anon", OWNER_A, `select * from forge_work_step_curve_placements;`),
    ).rejects.toThrow(/permission denied/i);
  });

  it60("direct writes as authenticated are denied — the RPCs are the only write path", async () => {
    await expect(asUser(db, OWNER_A, `
      insert into forge_work_step_curve_placements
        (owner_id, id, work_package_id, step_id, baseline_version, start_day_index, version, created_by, updated_by)
        values ('${OWNER_A}', 'forge_wpsp_direct', 'pkg_a', 'step_x', 1, 1, 1, 'u', 'u');
    `)).rejects.toThrow(/42501|permission denied|policy/i);
  });

  it60("effective privileges: authenticated reads and executes, anon and service_role get nothing", async () => {
    for (const table of [
      "forge_work_step_curve_placements",
      "forge_work_step_curve_placement_revisions",
    ]) {
      const { rows } = await db.query(`
        select has_table_privilege('authenticated', 'public.${table}', 'SELECT') as can_select,
               has_table_privilege('authenticated', 'public.${table}', 'INSERT') as can_insert,
               has_table_privilege('anon', 'public.${table}', 'SELECT') as anon_select,
               has_table_privilege('service_role', 'public.${table}', 'SELECT') as sr_select;
      `);
      expect(rows[0]).toEqual({ can_select: true, can_insert: false, anon_select: false, sr_select: false });
    }
    for (const fn of [
      "forge_work_manpower_curve_snapshot(text, text, integer)",
      "forge_work_manpower_curve_placement_set(text, text, text, integer, integer, integer, text)",
      "forge_work_manpower_curve_placement_clear(text, text, integer, text)",
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

  it60("the shipped SQL states the explicit revokes and the forced RLS, names no second outage source, and takes no caller-supplied actor", async () => {
    const sql = loadMigrationSql(SLICE6);
    for (const fn of [
      "forge_work_manpower_curve_snapshot(text, text, integer)",
      "forge_work_manpower_curve_placement_set(text, text, text, integer, integer, integer, text)",
      "forge_work_manpower_curve_placement_clear(text, text, integer, text)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${fn} from public`);
      expect(sql).toContain(`grant execute on function public.${fn} to authenticated`);
    }
    expect(sql).toContain("force row level security");
    expect(sql).not.toMatch(/p_actor/);
    expect(sql).toContain("auth.uid()");
    // No second outage-setting source: no settings table/RPC and no
    // standard-hours divisor anywhere in the shipped file.
    expect(sql).not.toMatch(/forge_work_package_curve_settings/);
    expect(sql).not.toMatch(/standard_hours_per_person_day/);
    expect(sql).not.toMatch(/forge_work_manpower_curve_settings_set/);
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

describe.skipIf(!HAS_REAL_PG)("slice 6 migration: real-PostgreSQL subset", () => {
  let pgDir;
  let pgClient;
  let pgCfg;

  beforeAll(async () => {
    pgDir = mkdtempSync(join(tmpdir(), "wpp6-realpg-"));
    execSync(`chown ${PG_RUN_USER}:${PG_RUN_USER} "${pgDir}"`, { stdio: "pipe" });
    const asPgUser = (cmd) => `runuser -u ${PG_RUN_USER} -- ${cmd}`;
    execSync(asPgUser(`"${PG_BIN}/initdb" -D "${pgDir}" -U postgres --auth=trust`), { stdio: "pipe" });
    execSync(
      asPgUser(`"${PG_BIN}/pg_ctl" -D "${pgDir}" -o "-p 55433 -k ${pgDir} -c listen_addresses=''" -l "${pgDir}/server.log" start`),
      { stdio: "pipe" },
    );
    pgCfg = { host: pgDir, port: 55433, user: "postgres", database: "postgres" };
    pgClient = new Client(pgCfg);
    await pgClient.connect();
    await pgClient.query(PREREQ_SQL);
    await pgClient.query(loadMigrationSql(SLICE3));
    await pgClient.query(loadMigrationSql(SLICE4));
    await pgClient.query(loadMigrationSql(SLICE5));
    await pgClient.query(loadMigrationSql(SLICE6));
    await pgClient.query(`
      insert into forge_work_packages (owner_id, id, status) values
        ('${OWNER_A}', 'pkg_real', 'in_progress'),
        ('${OWNER_A}', 'pkg_real_b', 'in_progress'),
        ('${OWNER_A}', 'pkg_real_c', 'in_progress');
      insert into forge_work_package_baselines
        (owner_id, package_id, version_number, baseline_start, baseline_finish, baseline_hours, baseline_cost, frozen_by)
      values
        ('${OWNER_A}', 'pkg_real', 1, '2026-11-09', '2026-11-18', 400, 100000, '${OWNER_A}'),
        ('${OWNER_A}', 'pkg_real_b', 1, '2026-11-09', '2026-11-18', 400, 100000, '${OWNER_A}'),
        ('${OWNER_A}', 'pkg_real_c', 1, '2026-11-09', '2026-11-18', 400, 100000, '${OWNER_A}');
      insert into workspace_members (owner_id, member_user_id, status, role)
        values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
    `);
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

  async function pgSnapshot(uid, packageId, baselineVersion = null) {
    const { rows } = await pgAsUser(pgClient, uid, `
      select forge_work_manpower_curve_snapshot('${OWNER_A}', '${packageId}', ${baselineVersion ?? "null"}) as snap;
    `);
    return rows[0].snap;
  }

  it60("concurrent placement edits on the same version: one wins, the other gets VERSION_CONFLICT", async () => {
    const step = await pgCreateStep(OWNER_A, "pkg_real");
    const placed = await pgAsUser(pgClient, OWNER_A, `
      select * from forge_work_manpower_curve_placement_set(
        '${OWNER_A}', 'pkg_real', '${step.id}', 1, 2, null, null);
    `);
    expect(placed.rows[0].version).toBe(1);

    // Two live connections race to move the same placement from version 1.
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const move = (client, day) => pgAsUser(client, OWNER_A, `
        select * from forge_work_manpower_curve_placement_set(
          '${OWNER_A}', 'pkg_real', '${step.id}', 1, ${day}, 1, 'Race move');
      `);
      const results = await Promise.allSettled([move(clientA, 3), move(clientB, 4)]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toMatch(/WPP6_VERSION_CONFLICT/);
      const { rows } = await pgClient.query(`
        select start_day_index, version from forge_work_step_curve_placements
        where owner_id = '${OWNER_A}' and step_id = '${step.id}' and retired_at is null;
      `);
      expect(rows).toHaveLength(1);
      expect(rows[0].version).toBe(2);
      expect([3, 4]).toContain(rows[0].start_day_index);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("an uncommitted step edit is invisible to the snapshot, and visible after commit with a bumped generation (P1-3)", async () => {
    const step = await pgCreateStep(OWNER_A, "pkg_real_b");
    const before = await pgSnapshot(OWNER_A, "pkg_real_b");
    expect(before.steps[0].planned_duration_days).toBe(4);
    expect(before.generations.steps.max_version).toBe(1);

    const writer = new Client(pgCfg);
    await writer.connect();
    try {
      await writer.query("begin");
      await pgAsUser(writer, OWNER_A, `
        select * from forge_work_step_update(
          '${OWNER_A}', '${step.id}', 1, null, null, null, 6, null, null,
          false, false, true, false, false, false, 'More work');
      `);
      // The writer's change is uncommitted: a concurrent snapshot must
      // still see the old duration and the old generation — never a mix.
      const during = await pgSnapshot(OWNER_A, "pkg_real_b");
      expect(during.steps[0].planned_duration_days).toBe(4);
      expect(during.generations.steps.max_version).toBe(1);
      await writer.query("commit");
    } finally {
      await writer.end().catch(() => {});
    }
    const after = await pgSnapshot(OWNER_A, "pkg_real_b");
    expect(after.steps[0].planned_duration_days).toBe(6);
    expect(after.generations.steps.max_version).toBe(2);
  });

  it60("ACL matrix on real PG: authenticated reads and executes, anon and service_role get nothing", async () => {
    for (const table of [
      "forge_work_step_curve_placements",
      "forge_work_step_curve_placement_revisions",
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
      "forge_work_manpower_curve_snapshot(text, text, integer)",
      "forge_work_manpower_curve_placement_set(text, text, text, integer, integer, integer, text)",
      "forge_work_manpower_curve_placement_clear(text, text, integer, text)",
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

  it60("a failed placement set on real PG leaves no placement and no revision", async () => {
    const step = await pgCreateStep(OWNER_A, "pkg_real_c");
    await expect(pgAsUser(pgClient, OWNER_A, `
      select * from forge_work_manpower_curve_placement_set(
        '${OWNER_A}', 'pkg_real_c', '${step.id}', 1, 8, null, null);
    `)).rejects.toThrow(/WPP6_PLACEMENT_OUTSIDE_WINDOW/);
    const { rows } = await pgClient.query(`
      select count(*)::int as placements from forge_work_step_curve_placements
      where owner_id = '${OWNER_A}' and step_id = '${step.id}';
    `);
    expect(rows[0].placements).toBe(0);
    const rev = await pgClient.query(`
      select count(*)::int as n from forge_work_step_curve_placement_revisions r
      join forge_work_step_curve_placements p on p.id = r.placement_id
      where p.step_id = '${step.id}';
    `);
    expect(rev.rows[0].n).toBe(0);
  });
});
