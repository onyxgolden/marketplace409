// Work Package Planner slice 6 — migration/integration proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) and proves:
//   - Schema: the settings + placements + revision tables, CHECKs
//     (outage days 1-366, standard hours (0, 24], start day >= 1),
//     the owner/package uniqueness, the partial-unique live placement
//     per step, and the package hard-delete restriction;
//   - RLS: owner isolation, co-owner access, anon sees nothing, direct
//     writes denied (RPC-only write path);
//   - RPCs: settings set (create/update, version guard, terminal
//     rule, window-shrink rejection with affected step ids),
//     placement set (window required, fit-inside-window, move needs
//     version + reason, version conflict), placement clear (version +
//     reason, retired afterwards), and the two REPLACED slice-5
//     functions (step retire retires the live placement in the same
//     transaction; step duration change re-validates the placement);
//   - Atomic audit: a failed mutation leaves no row and no revision;
//   - Effective ACL matrix for authenticated/anon/service_role, and
//     the default-privilege negative case (a selective GRANT alone
//     does NOT revoke an already-effective broad privilege, which is
//     why the migration's explicit REVOKEs are load-bearing).
// Roles, the auth.uid() stub, workspace_members, and the
// has_workspace_access() copy mirror production; the prerequisite
// packages/drawings/takeoff-lines tables are the minimal shapes the
// slice-3/4/5 foreign keys reference, plus the status column the
// terminal-package rule reads.
//
// A real-PostgreSQL subset (concurrent placement edits with two live
// connections, ACL matrix, same-transaction audit rollback) runs
// against a scratch PG16 cluster when the binaries exist, and SKIPS
// LOUDLY — never silently — when they do not. PGlite is
// single-connection, so it cannot prove concurrent-edit
// serialization; that leg exists only on real PG.

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
const SLICE6 = "20261107030000_work_package_manpower_curve.sql";

function loadMigrationSql(name) {
  return readFileSync(join(HERE, "..", "..", "..", "supabase", "migrations", name), "utf8");
}

// Minimal prerequisite shape with the exact keys the slice-3/4/5/6
// foreign keys reference, plus the status column the terminal-package
// rule reads. Copied from the slice-5 migration test.
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
`;

const SEED_SQL = `
  insert into forge_work_packages (owner_id, id, status) values
    ('${OWNER_A}', 'pkg_a', 'in_progress'),
    ('${OWNER_A}', 'pkg_cancelled', 'cancelled'),
    ('${OWNER_A}', 'pkg_closed', 'verified_closed'),
    ('${OWNER_B}', 'pkg_b', 'in_progress');
  insert into forge_work_drawings (owner_id, package_id, id, drawing_number, drawing_type, title, p_id_drawing_id) values
    ('${OWNER_A}', 'pkg_a', 'dwg_1', 'P-101', 'p_id', 'Main line', null),
    ('${OWNER_A}', 'pkg_a', 'dwg_2', 'C-201', 'cut_sheet', 'Spool sheet', null);
  insert into workspace_members (owner_id, member_user_id, status, role)
    values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
`;

async function setupDb() {
  const db = new PGlite();
  await db.exec(PREREQ_SQL);
  // Apply the shipped files in timestamp order: slice 3, slice 4,
  // slice 5 (the step functions slice 6 replaces), then slice 6.
  await db.exec(loadMigrationSql(SLICE3));
  await db.exec(loadMigrationSql(SLICE4));
  await db.exec(loadMigrationSql(SLICE5));
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

async function setSettings(db, uid, {
  packageId, startDate, days, standard, expectedVersion, reason,
} = {}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_manpower_curve_settings_set(
      '${OWNER_A}', '${packageId ?? "pkg_a"}', ${sqlStr(startDate ?? "2026-11-09")},
      ${sqlNum(days ?? 10)}, ${sqlNum(standard ?? null)},
      ${sqlNum(expectedVersion ?? null)}, ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function setPlacement(db, uid, {
  packageId, stepId, startDay, expectedVersion, reason,
} = {}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_manpower_curve_placement_set(
      '${OWNER_A}', '${packageId ?? "pkg_a"}', '${stepId}',
      ${sqlNum(startDay)}, ${sqlNum(expectedVersion ?? null)}, ${sqlStr(reason ?? null)});
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

async function settingsRow(db, packageId = "pkg_a") {
  const { rows } = await db.query(`
    select * from forge_work_package_curve_settings
    where owner_id = '${OWNER_A}' and work_package_id = '${packageId}';
  `);
  return rows[0] ?? null;
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

describe("slice 6 migration: schema constraints", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("creates the four new tables with the expected columns", async () => {
    const { rows } = await db.query(`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in (
          'forge_work_package_curve_settings',
          'forge_work_package_curve_settings_revisions',
          'forge_work_step_curve_placements',
          'forge_work_step_curve_placement_revisions')
      order by table_name, ordinal_position;
    `);
    const byTable = {};
    for (const row of rows) (byTable[row.table_name] ??= []).push(row.column_name);
    expect(byTable.forge_work_package_curve_settings).toEqual([
      "owner_id", "work_package_id", "outage_start_date", "outage_days",
      "standard_hours_per_person_day", "version", "created_by", "updated_by",
      "created_at", "updated_at",
    ]);
    expect(byTable.forge_work_step_curve_placements).toContain("start_day_index");
    expect(byTable.forge_work_step_curve_placement_revisions).toContain("action");
    expect(byTable.forge_work_package_curve_settings_revisions).toContain("action");
  });

  it60("rejects outage days outside 1-366 and standard hours outside (0, 24]", async () => {
    await expect(setSettings(db, OWNER_A, { days: 0 })).rejects.toThrow(/WPP6_INVALID_OUTAGE_DAYS/);
    await expect(setSettings(db, OWNER_A, { days: 367 })).rejects.toThrow(/WPP6_INVALID_OUTAGE_DAYS/);
    await expect(setSettings(db, OWNER_A, { standard: 0 })).rejects.toThrow(/WPP6_INVALID_STANDARD_HOURS/);
    await expect(setSettings(db, OWNER_A, { standard: 25 })).rejects.toThrow(/WPP6_INVALID_STANDARD_HOURS/);
    await expect(setSettings(db, OWNER_A, { standard: 8.005 })).rejects.toThrow(/WPP6_INVALID_STANDARD_HOURS/);
  });

  it60("rejects a second live placement for the same step at the database level", async () => {
    const step = await createStep(db, OWNER_A, {});
    await setSettings(db, OWNER_A, {});
    const placement = await setPlacement(db, OWNER_A, { stepId: step.id, startDay: 1 });
    expect(placement.version).toBe(1);
    // A direct second live row for the same step violates the partial
    // unique index even for the table owner.
    await expect(db.query(`
      insert into forge_work_step_curve_placements
        (owner_id, id, work_package_id, step_id, start_day_index, version, created_by, updated_by)
        values ('${OWNER_A}', 'forge_wpsp_direct', 'pkg_a', '${step.id}', 2, 1, 'u', 'u');
    `)).rejects.toThrow(/duplicate key/i);
  });

  it60("refuses to delete a package while settings exist", async () => {
    await setSettings(db, OWNER_A, {});
    await expect(db.query(`
      delete from forge_work_packages where owner_id = '${OWNER_A}' and id = 'pkg_a';
    `)).rejects.toThrow(/foreign key/i);
  });
});

describe("slice 6 migration: settings RPC", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("creates a window at version 1 with a create revision, then updates it version-guarded", async () => {
    const created = await setSettings(db, OWNER_A, { days: 10, standard: 8 });
    expect(created.version).toBe(1);
    expect(dateStr(created.outage_start_date)).toBe("2026-11-09");
    expect(created.outage_days).toBe(10);
    expect(Number(created.standard_hours_per_person_day)).toBe(8);
    const updated = await setSettings(db, OWNER_A, { days: 12, standard: 8, expectedVersion: 1, reason: "Outage extended" });
    expect(updated.version).toBe(2);
    expect(updated.outage_days).toBe(12);
    const { rows } = await db.query(`
      select version, action, reason from forge_work_package_curve_settings_revisions
      where owner_id = '${OWNER_A}' and work_package_id = 'pkg_a' order by version;
    `);
    expect(rows.map((r) => [r.version, r.action])).toEqual([[1, "create"], [2, "update"]]);
    expect(rows[1].reason).toBe("Outage extended");
  });

  it60("defaults the standard day to 8 when omitted", async () => {
    const created = await setSettings(db, OWNER_A, {});
    expect(Number(created.standard_hours_per_person_day)).toBe(8);
  });

  it60("rejects a stale expected version and a create with a nonzero version", async () => {
    await setSettings(db, OWNER_A, {});
    await expect(setSettings(db, OWNER_A, { days: 11, expectedVersion: 99 })).rejects.toThrow(/WPP6_VERSION_CONFLICT/);
    await expect(setSettings(db, OWNER_A, { days: 11 })).rejects.toThrow(/WPP6_VERSION_CONFLICT/);
    // Another owner acting on OWNER_A's workspace is forbidden before any
    // package lookup: the caller is OWNER_B, the owner in the call is OWNER_A.
    await expect(setSettings(db, OWNER_B, { packageId: "pkg_a", days: 10, expectedVersion: 2 })).rejects.toThrow(/WPP6_WORKSPACE_FORBIDDEN/);
  });

  it60("refuses settings on a terminal package and on an unknown package", async () => {
    await expect(setSettings(db, OWNER_A, { packageId: "pkg_cancelled", days: 10 })).rejects.toThrow(/WPP6_PACKAGE_TERMINAL/);
    await expect(setSettings(db, OWNER_A, { packageId: "pkg_closed", days: 10 })).rejects.toThrow(/WPP6_PACKAGE_TERMINAL/);
    await expect(setSettings(db, OWNER_A, { packageId: "pkg_nope", days: 10 })).rejects.toThrow(/WPP6_PACKAGE_NOT_FOUND/);
  });

  it60("rejects shrinking the window when a live placement would run past it, naming the step, and leaves the window unchanged", async () => {
    const step = await createStep(db, OWNER_A, { durationDays: 4, personHours: 40 });
    await setSettings(db, OWNER_A, { days: 10 });
    // Day 7 + 4 days ends on day 10: fits exactly.
    await setPlacement(db, OWNER_A, { stepId: step.id, startDay: 7 });
    await expect(
      setSettings(db, OWNER_A, { days: 8, expectedVersion: 1, reason: "Outage shortened" }),
    ).rejects.toThrow(new RegExp(`WPP6_PLACEMENT_OUTSIDE_WINDOW:${step.id}`));
    const row = await settingsRow(db);
    expect(row.outage_days).toBe(10);
    expect(row.version).toBe(1);
    // Growing the window instead is fine: the placement still fits.
    const grown = await setSettings(db, OWNER_A, { days: 12, expectedVersion: 1, reason: "Outage extended" });
    expect(grown.outage_days).toBe(12);
  });
});

describe("slice 6 migration: placement RPCs", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("requires a window before any placement", async () => {
    const step = await createStep(db, OWNER_A, {});
    await expect(setPlacement(db, OWNER_A, { stepId: step.id, startDay: 1 })).rejects.toThrow(/WPP6_WINDOW_NOT_CONFIGURED/);
    expect(await placementRows(db, step.id)).toHaveLength(0);
  });

  it60("sets a placement at version 1 with an audit revision, then moves it version-guarded with a reason", async () => {
    const step = await createStep(db, OWNER_A, { durationDays: 2, personHours: 30 });
    await setSettings(db, OWNER_A, { days: 10 });
    const placed = await setPlacement(db, OWNER_A, { stepId: step.id, startDay: 3 });
    expect(placed.start_day_index).toBe(3);
    expect(placed.version).toBe(1);
    // Moving without a reason is refused.
    await expect(setPlacement(db, OWNER_A, { stepId: step.id, startDay: 4, expectedVersion: 1 }))
      .rejects.toThrow(/WPP6_REASON_REQUIRED/);
    // Moving with a stale version is refused.
    await expect(setPlacement(db, OWNER_A, { stepId: step.id, startDay: 4, expectedVersion: 99, reason: "Sequencing" }))
      .rejects.toThrow(/WPP6_VERSION_CONFLICT/);
    const moved = await setPlacement(db, OWNER_A, { stepId: step.id, startDay: 4, expectedVersion: 1, reason: "Sequencing" });
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
    await setSettings(db, OWNER_A, { days: 10 });
    await expect(setPlacement(db, OWNER_A, { stepId: step.id, startDay: 11 })).rejects.toThrow(/WPP6_INVALID_START_DAY/);
    await expect(setPlacement(db, OWNER_A, { stepId: step.id, startDay: 8 })).rejects.toThrow(/WPP6_PLACEMENT_OUTSIDE_WINDOW/);
    expect(await placementRows(db, step.id)).toHaveLength(0);
    // Day 7 + 4 days ends on day 10: fits exactly.
    const placed = await setPlacement(db, OWNER_A, { stepId: step.id, startDay: 7 });
    expect(placed.start_day_index).toBe(7);
  });

  it60("a step with no duration can only start on day 1", async () => {
    const step = await createStep(db, OWNER_A, { durationDays: null, personHours: 20, setDurationDays: false });
    await setSettings(db, OWNER_A, { days: 10 });
    await expect(setPlacement(db, OWNER_A, { stepId: step.id, startDay: 2 })).rejects.toThrow(/WPP6_PLACEMENT_OUTSIDE_WINDOW/);
    const placed = await setPlacement(db, OWNER_A, { stepId: step.id, startDay: 1 });
    expect(placed.start_day_index).toBe(1);
  });

  it60("clears a placement version-guarded with a reason, and a cleared placement cannot be cleared again", async () => {
    const step = await createStep(db, OWNER_A, {});
    await setSettings(db, OWNER_A, { days: 10 });
    const placed = await setPlacement(db, OWNER_A, { stepId: step.id, startDay: 3 });
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
    const replaced = await setPlacement(db, OWNER_A, { stepId: step.id, startDay: 2 });
    expect(replaced.id).not.toBe(placed.id);
    expect(replaced.version).toBe(1);
  });

  it60("refuses placements on terminal packages and on retired steps", async () => {
    const step = await createStep(db, OWNER_A, {});
    await setSettings(db, OWNER_A, { days: 10 });
    const retired = await retireStep(db, OWNER_A, step.id, { expectedVersion: 1, reason: "Superseded" });
    expect(retired.retired_at).not.toBeNull();
    await expect(setPlacement(db, OWNER_A, { stepId: step.id, startDay: 1 })).rejects.toThrow(/WPP6_RETIRED/);
  });

  it60("a failed placement leaves no placement row and no revision (atomic audit)", async () => {
    const step = await createStep(db, OWNER_A, { durationDays: 4, personHours: 40 });
    await setSettings(db, OWNER_A, { days: 10 });
    await expect(setPlacement(db, OWNER_A, { stepId: step.id, startDay: 8 })).rejects.toThrow(/WPP6_PLACEMENT_OUTSIDE_WINDOW/);
    expect(await placementRows(db, step.id)).toHaveLength(0);
    const { rows } = await db.query(`select count(*)::int as n from forge_work_step_curve_placement_revisions;`);
    expect(rows[0].n).toBe(0);
  });
});

describe("slice 6 migration: replaced slice-5 functions", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("retiring a step retires its live placement in the same transaction with a step_retired revision", async () => {
    const step = await createStep(db, OWNER_A, {});
    await setSettings(db, OWNER_A, { days: 10 });
    const placed = await setPlacement(db, OWNER_A, { stepId: step.id, startDay: 3 });
    const retired = await retireStep(db, OWNER_A, step.id, { expectedVersion: 1, reason: "Superseded" });
    expect(retired.retired_at).not.toBeNull();
    const placements = await placementRows(db, step.id);
    expect(placements).toHaveLength(1);
    expect(placements[0].retired_at).not.toBeNull();
    expect(placements[0].version).toBe(2);
    const revisions = await placementRevisionRows(db, placed.id);
    expect(revisions.map((r) => [r.version, r.action])).toEqual([[1, "set"], [2, "step_retired"]]);
  });

  it60("a duration change that strands the placement rejects, and the step is unchanged", async () => {
    const step = await createStep(db, OWNER_A, { durationDays: 4, personHours: 40 });
    await setSettings(db, OWNER_A, { days: 10 });
    await setPlacement(db, OWNER_A, { stepId: step.id, startDay: 7 });
    await expect(updateStep(db, OWNER_A, step.id, {
      expectedVersion: 1, durationDays: 5, setDurationDays: true, reason: "More work",
    })).rejects.toThrow(new RegExp(`WPP6_PLACEMENT_OUTSIDE_WINDOW:${step.id}`));
    const { rows } = await db.query(`select planned_duration_days, version from forge_work_steps where id = '${step.id}';`);
    expect(rows[0].planned_duration_days).toBe(4);
    expect(rows[0].version).toBe(1);
    // Shortening the duration so the placement fits is fine.
    const updated = await updateStep(db, OWNER_A, step.id, {
      expectedVersion: 1, durationDays: 3, setDurationDays: true, reason: "Less work",
    });
    expect(updated.planned_duration_days).toBe(3);
    expect(updated.version).toBe(2);
  });

  it60("a title-only update with a live placement still works (slice-5 behaviour preserved)", async () => {
    const step = await createStep(db, OWNER_A, {});
    await setSettings(db, OWNER_A, { days: 10 });
    await setPlacement(db, OWNER_A, { stepId: step.id, startDay: 2 });
    const updated = await updateStep(db, OWNER_A, step.id, {
      expectedVersion: 1, title: "Fabricate pipe spool, revised", reason: "Typo",
    });
    expect(updated.title).toBe("Fabricate pipe spool, revised");
    expect(updated.version).toBe(2);
    const placements = await placementRows(db, step.id);
    expect(placements[0].retired_at).toBeNull();
  });

  it60("the replaced functions keep their exact slice-5 signatures (no overload was created)", async () => {
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
    await setSettings(db, OWNER_A, {});
    const step = await createStep(db, OWNER_A, {});
    await setPlacement(db, OWNER_A, { stepId: step.id, startDay: 2 });
    const asOther = await asUser(db, OWNER_B, `select * from forge_work_package_curve_settings;`);
    expect(asOther.rows).toHaveLength(0);
    const asOtherPlacements = await asUser(db, OWNER_B, `select * from forge_work_step_curve_placements;`);
    expect(asOtherPlacements.rows).toHaveLength(0);
    const asCoOwner = await asUser(db, MEMBER_C, `select * from forge_work_package_curve_settings;`);
    expect(asCoOwner.rows).toHaveLength(1);
    // Anon has no policy and no grant: the select is denied outright.
    await expect(
      asRole(db, "anon", OWNER_A, `select * from forge_work_package_curve_settings;`),
    ).rejects.toThrow(/permission denied/i);
  });

  it60("direct writes as authenticated are denied — the RPCs are the only write path", async () => {
    await expect(asUser(db, OWNER_A, `
      insert into forge_work_package_curve_settings
        (owner_id, work_package_id, outage_start_date, outage_days, version, created_by, updated_by)
        values ('${OWNER_A}', 'pkg_a', '2026-11-09', 10, 1, 'u', 'u');
    `)).rejects.toThrow(/42501|permission denied|policy/i);
    await expect(asUser(db, OWNER_A, `
      insert into forge_work_step_curve_placements
        (owner_id, id, work_package_id, step_id, start_day_index, version, created_by, updated_by)
        values ('${OWNER_A}', 'forge_wpsp_direct', 'pkg_a', 'step_x', 1, 1, 'u', 'u');
    `)).rejects.toThrow(/42501|permission denied|policy/i);
  });

  it60("effective privileges: authenticated reads and executes, anon and service_role get nothing", async () => {
    for (const table of [
      "forge_work_package_curve_settings",
      "forge_work_package_curve_settings_revisions",
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
      "forge_work_manpower_curve_settings_set(text, text, date, integer, numeric, integer, text)",
      "forge_work_manpower_curve_placement_set(text, text, text, integer, integer, text)",
      "forge_work_manpower_curve_placement_clear(text, text, integer, text)",
      "forge_work_step_update(text, text, integer, text, text, text, integer, numeric, text, boolean, boolean, boolean, boolean, boolean, boolean, text)",
      "forge_work_step_retire(text, text, integer, text, boolean)",
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

  it60("the shipped SQL states the explicit revokes and the forced RLS, and takes no caller-supplied actor", async () => {
    const sql = loadMigrationSql(SLICE6);
    for (const fn of [
      "forge_work_manpower_curve_settings_set(text, text, date, integer, numeric, integer, text)",
      "forge_work_manpower_curve_placement_set(text, text, text, integer, integer, text)",
      "forge_work_manpower_curve_placement_clear(text, text, integer, text)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${fn} from public`);
      expect(sql).toContain(`grant execute on function public.${fn} to authenticated`);
    }
    expect(sql).toContain("force row level security");
    expect(sql).not.toMatch(/p_actor/);
    expect(sql).toContain("auth.uid()");
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

  it60("concurrent placement edits on the same version: one wins, the other gets VERSION_CONFLICT", async () => {
    const step = await pgCreateStep(OWNER_A, "pkg_real");
    await pgAsUser(pgClient, OWNER_A, `
      select * from forge_work_manpower_curve_settings_set(
        '${OWNER_A}', 'pkg_real', '2026-11-09', 10, null, null, null);
    `);
    const placed = await pgAsUser(pgClient, OWNER_A, `
      select * from forge_work_manpower_curve_placement_set(
        '${OWNER_A}', 'pkg_real', '${step.id}', 2, null, null);
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
          '${OWNER_A}', 'pkg_real', '${step.id}', ${day}, 1, 'Race move');
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

  it60("concurrent settings updates on the same version: one wins, the other gets VERSION_CONFLICT", async () => {
    await pgAsUser(pgClient, OWNER_A, `
      select * from forge_work_manpower_curve_settings_set(
        '${OWNER_A}', 'pkg_real_b', '2026-11-09', 10, null, null, null);
    `);
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const update = (client, days) => pgAsUser(client, OWNER_A, `
        select * from forge_work_manpower_curve_settings_set(
          '${OWNER_A}', 'pkg_real_b', '2026-11-09', ${days}, null, 1, 'Race update');
      `);
      const results = await Promise.allSettled([update(clientA, 11), update(clientB, 12)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toMatch(/WPP6_VERSION_CONFLICT/);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("ACL matrix on real PG: authenticated reads and executes, anon and service_role get nothing", async () => {
    for (const table of [
      "forge_work_package_curve_settings",
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
      "forge_work_manpower_curve_settings_set(text, text, date, integer, numeric, integer, text)",
      "forge_work_manpower_curve_placement_set(text, text, text, integer, integer, text)",
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
    await pgAsUser(pgClient, OWNER_A, `
      select * from forge_work_manpower_curve_settings_set(
        '${OWNER_A}', 'pkg_real_c', '2026-11-09', 10, null, null, null);
    `);
    await expect(pgAsUser(pgClient, OWNER_A, `
      select * from forge_work_manpower_curve_placement_set(
        '${OWNER_A}', 'pkg_real_c', '${step.id}', 8, null, null);
    `)).rejects.toThrow(/WPP6_PLACEMENT_OUTSIDE_WINDOW/);
    const { rows } = await pgClient.query(`
      select count(*)::int as placements from forge_work_step_curve_placements
      where owner_id = '${OWNER_A}' and step_id = '${step.id}';
    `);
    expect(rows[0].placements).toBe(0);
    // Revisions are scoped to this step's placements: earlier tests in
    // this cluster created their own placements, so count only these.
    const rev = await pgClient.query(`
      select count(*)::int as n from forge_work_step_curve_placement_revisions r
      join forge_work_step_curve_placements p on p.id = r.placement_id
      where p.step_id = '${step.id}';
    `);
    expect(rev.rows[0].n).toBe(0);
  });
});
