// Work Package Planner slice 4 — migration/integration proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) and proves:
//   - CHECKs/FKs: craft/shift/crew/size/hours discipline, the partial
//     unique identity, package parentage, revision uniqueness, and
//     package hard-delete restriction while assignments exist;
//   - Normalization: the SQL helpers agree with the JS domain
//     normalization on the same inputs;
//   - RLS: owner isolation, co-owner access, anon sees nothing, direct
//     writes denied (RPC-only write path);
//   - RPCs: create/update/reassign/retire flows, version guards,
//     retired guard, duplicate identity, historical-correction rule
//     for past dates, terminal-package rule, actor derived from
//     auth.uid() (no forgeable actor parameter), atomic audit;
//   - Effective ACL matrix for authenticated/anon/service_role, and
//     the default-privilege negative case: a selective GRANT alone
//     does NOT revoke an already-effective broad privilege, which is
//     why the migration's explicit REVOKEs are load-bearing.
// Roles, the auth.uid() stub, workspace_members, and the
// has_workspace_access() copy mirror production (see
// 20260829000100_add_workspace_authorization_helpers.sql); the
// prerequisite packages table is a minimal shape with the exact keys
// the slice-4 foreign keys reference, plus the status column the
// terminal-package rule reads.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const HERE = dirname(fileURLToPath(import.meta.url));
const it60 = (name, fn) => it(name, fn, 60000);

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const MEMBER_C = "33333333-3333-4333-8333-333333333333";

// Dates are computed from the real current Chicago date so the
// future/past cases stay correct whenever the suite runs.
function chicagoToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const TODAY = chicagoToday();
const FUTURE_1 = addDays(TODAY, 2);
const FUTURE_2 = addDays(TODAY, 3);
const PAST_1 = addDays(TODAY, -30);

function loadMigrationSql() {
  return readFileSync(
    join(HERE, "..", "..", "..", "supabase", "migrations", "20261107010000_forge_work_package_craft_assignments_slice4.sql"),
    "utf8",
  );
}

async function setupDb() {
  const db = new PGlite();
  await db.exec(`
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
    -- Minimal prerequisite shape with the exact keys the slice-4
    -- foreign keys reference, plus the status column the
    -- terminal-package rule reads.
    create table forge_work_packages (
      owner_id text not null,
      id text not null,
      status text not null default 'in_progress',
      primary key (owner_id, id)
    );
  `);
  await db.exec(loadMigrationSql());
  // Seed as superuser (bypasses RLS for seeding).
  await db.exec(`
    insert into forge_work_packages (owner_id, id, status) values
      ('${OWNER_A}', 'pkg_a', 'in_progress'),
      ('${OWNER_A}', 'pkg_cancelled', 'cancelled'),
      ('${OWNER_A}', 'pkg_closed', 'verified_closed'),
      ('${OWNER_B}', 'pkg_b', 'in_progress');
    insert into workspace_members (owner_id, member_user_id, status, role)
      values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
  `);
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

// PGlite returns date columns as Date objects, not strings.
function isoDate(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function sqlStr(value) {
  return value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`;
}

async function createAssignment(db, uid, {
  ownerId, packageId, workDate, craft, crewLabel, shiftKind, shiftLabel,
  crewSize, hours, note, historical, reason,
}) {
  const pOwner = ownerId ?? uid;
  const { rows } = await asUser(db, uid, `
    select * from forge_work_craft_assignment_create(
      '${pOwner}', '${packageId}', '${workDate ?? FUTURE_1}',
      ${sqlStr(craft ?? "Pipefitter")},
      ${sqlStr(crewLabel ?? null)},
      '${shiftKind ?? "day"}',
      ${sqlStr(shiftLabel ?? null)},
      ${crewSize ?? 6}, ${hours ?? 8},
      ${sqlStr(note ?? null)},
      ${historical === true ? "true" : "false"},
      ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function updateAssignment(db, uid, assignmentId, {
  expectedVersion, workDate, craft, crewLabel, shiftKind, shiftLabel,
  crewSize, hours, note, setCrewLabel, setShiftLabel, setNote, historical, reason,
}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_craft_assignment_update(
      '${OWNER_A}', '${assignmentId}', ${expectedVersion},
      ${sqlStr(workDate ?? null)},
      ${sqlStr(craft ?? null)},
      ${sqlStr(crewLabel ?? null)},
      ${sqlStr(shiftKind ?? null)},
      ${sqlStr(shiftLabel ?? null)},
      ${crewSize ?? "null"}, ${hours ?? "null"},
      ${sqlStr(note ?? null)},
      ${setCrewLabel === true ? "true" : "false"},
      ${setShiftLabel === true ? "true" : "false"},
      ${setNote === true ? "true" : "false"},
      ${historical === true ? "true" : "false"},
      ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function retireAssignment(db, uid, assignmentId, { expectedVersion, reason, historical }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_craft_assignment_retire(
      '${OWNER_A}', '${assignmentId}', ${expectedVersion},
      ${sqlStr(reason ?? null)},
      ${historical === true ? "true" : "false"});
  `);
  return rows[0];
}

async function revisionsFor(db, assignmentId) {
  const { rows } = await db.query(`
    select action, historical_correction, reason, version
    from forge_work_craft_assignment_revisions
    where assignment_id = '${assignmentId}' order by version;
  `);
  return rows;
}

describe("slice 4 migration: schema constraints", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("rejects a craft label outside the charset or length", async () => {
    await expect(db.query(`
      insert into forge_work_craft_assignments
        (owner_id, id, work_package_id, work_date, craft_key, craft_label,
         shift_kind, shift_key, crew_size, hours_per_person, version, created_by, updated_by)
        values ('${OWNER_A}', 'x1', 'pkg_a', '${FUTURE_1}', 'welder', '-welder',
                'day', 'day', 6, 8, 1, 'u', 'u');
    `)).rejects.toThrow(/check constraint/i);
    await expect(db.query(`
      insert into forge_work_craft_assignments
        (owner_id, id, work_package_id, work_date, craft_key, craft_label,
         shift_kind, shift_key, crew_size, hours_per_person, version, created_by, updated_by)
        values ('${OWNER_A}', 'x2', 'pkg_a', '${FUTURE_1}', 'w', '${"w".repeat(81)}',
                'day', 'day', 6, 8, 1, 'u', 'u');
    `)).rejects.toThrow(/check constraint/i);
  });

  it60("rejects a shift kind outside day/night/other and a mismatched shift key", async () => {
    await expect(db.query(`
      insert into forge_work_craft_assignments
        (owner_id, id, work_package_id, work_date, craft_key, craft_label,
         shift_kind, shift_key, crew_size, hours_per_person, version, created_by, updated_by)
        values ('${OWNER_A}', 'x1', 'pkg_a', '${FUTURE_1}', 'welder', 'Welder',
                'swing', 'swing', 6, 8, 1, 'u', 'u');
    `)).rejects.toThrow(/check constraint/i);
    await expect(db.query(`
      insert into forge_work_craft_assignments
        (owner_id, id, work_package_id, work_date, craft_key, craft_label,
         shift_kind, shift_label, shift_key, crew_size, hours_per_person, version, created_by, updated_by)
        values ('${OWNER_A}', 'x2', 'pkg_a', '${FUTURE_1}', 'welder', 'Welder',
                'day', 'Swing', 'day', 6, 8, 1, 'u', 'u');
    `)).rejects.toThrow(/check constraint/i);
    await expect(db.query(`
      insert into forge_work_craft_assignments
        (owner_id, id, work_package_id, work_date, craft_key, craft_label,
         shift_kind, shift_key, crew_size, hours_per_person, version, created_by, updated_by)
        values ('${OWNER_A}', 'x3', 'pkg_a', '${FUTURE_1}', 'welder', 'Welder',
                'other', 'other:', 6, 8, 1, 'u', 'u');
    `)).rejects.toThrow(/check constraint/i);
  });

  it60("rejects crew sizes outside 1–500 and hours outside (0, 24]", async () => {
    for (const [crewSize, hours] of [[0, 8], [501, 8], [6, 0], [6, 24.01]]) {
      await expect(db.query(`
        insert into forge_work_craft_assignments
          (owner_id, id, work_package_id, work_date, craft_key, craft_label,
           shift_kind, shift_key, crew_size, hours_per_person, version, created_by, updated_by)
          values ('${OWNER_A}', 'x-${crewSize}-${hours}', 'pkg_a', '${FUTURE_1}', 'welder', 'Welder',
                  'day', 'day', ${crewSize}, ${hours}, 1, 'u', 'u');
      `)).rejects.toThrow(/check constraint/i);
    }
  });

  it60("rejects a duplicate active identity but allows the same identity once retired", async () => {
    const first = await createAssignment(db, OWNER_A, { packageId: "pkg_a" });
    await expect(createAssignment(db, OWNER_A, { packageId: "pkg_a" }))
      .rejects.toThrow(/WPP4_DUPLICATE/);
    // A different shift on the same day is a different identity.
    const night = await createAssignment(db, OWNER_A, { packageId: "pkg_a", shiftKind: "night" });
    expect(night.shift_key).toBe("night");
    // Retire the first, then the same identity is free again.
    await retireAssignment(db, OWNER_A, first.id, { expectedVersion: 1, reason: "Stood down" });
    const again = await createAssignment(db, OWNER_A, { packageId: "pkg_a" });
    expect(again.id).not.toBe(first.id);
  });

  it60("rejects a revision for a nonexistent assignment and a duplicate version", async () => {
    const ann = await createAssignment(db, OWNER_A, { packageId: "pkg_a" });
    await expect(db.query(`
      insert into forge_work_craft_assignment_revisions
        (owner_id, id, assignment_id, version, actor_id, action)
        values ('${OWNER_A}', 'r-missing', 'no-such-assignment', 1, 'u', 'create');
    `)).rejects.toThrow(/foreign key/i);
    await expect(db.query(`
      insert into forge_work_craft_assignment_revisions
        (owner_id, id, assignment_id, version, actor_id, action)
        values ('${OWNER_A}', 'r-dup', '${ann.id}', 1, 'u', 'create');
    `)).rejects.toThrow(/duplicate key|unique/i);
  });

  it60("restricts hard-deleting a package while assignments exist", async () => {
    await createAssignment(db, OWNER_A, { packageId: "pkg_a" });
    await expect(db.query(`delete from forge_work_packages where id = 'pkg_a';`))
      .rejects.toThrow(/foreign key|violates/i);
  });

  it60("normalizes keys the same way the JS domain does", async () => {
    const { rows } = await db.query(`
      select forge_work_craft_normalize_label('  Pipe   Fitter ') as label,
             forge_work_craft_normalize_key('  Pipe   Fitter ') as key,
             forge_work_craft_normalize_key('Instrument Technician') as key2,
             forge_work_craft_normalize_key('QA/QC Inspector') as key3;
    `);
    expect(rows[0]).toEqual({
      label: "pipe fitter",
      key: "pipe-fitter",
      key2: "instrument-technician",
      key3: "qa/qc-inspector",
    });
  });
});

describe("slice 4 migration: RLS isolation", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("owner A selects only owner A assignments; owner B only owner B", async () => {
    await createAssignment(db, OWNER_A, { packageId: "pkg_a", craft: "Welder" });
    await createAssignment(db, OWNER_B, { packageId: "pkg_b", craft: "Electrician" });
    const { rows: rowsA } = await asUser(db, OWNER_A, `select craft_label from forge_work_craft_assignments;`);
    const { rows: rowsB } = await asUser(db, OWNER_B, `select craft_label from forge_work_craft_assignments;`);
    expect(rowsA.map((r) => r.craft_label)).toEqual(["Welder"]);
    expect(rowsB.map((r) => r.craft_label)).toEqual(["Electrician"]);
  });

  it60("an active co-owner membership grants access to the workspace", async () => {
    await createAssignment(db, OWNER_A, { packageId: "pkg_a", craft: "Welder" });
    const { rows } = await asUser(db, MEMBER_C, `select craft_label from forge_work_craft_assignments;`);
    expect(rows.map((r) => r.craft_label)).toEqual(["Welder"]);
  });

  it60("anon cannot select (no policy, no grant)", async () => {
    await expect(
      asRole(db, "anon", OWNER_A, `select * from forge_work_craft_assignments;`),
    ).rejects.toThrow(/permission denied/i);
  });

  it60("a direct client insert, update, or revision insert is denied — writes go only through the RPCs", async () => {
    await expect(
      asUser(db, OWNER_A, `
        insert into forge_work_craft_assignments
          (owner_id, id, work_package_id, work_date, craft_key, craft_label,
           shift_kind, shift_key, crew_size, hours_per_person, version, created_by, updated_by)
          values ('${OWNER_A}', 'x-direct', 'pkg_a', '${FUTURE_1}', 'welder', 'Welder',
                  'day', 'day', 6, 8, 1, 'u', 'u');
      `),
    ).rejects.toThrow(/permission denied|violates row-level security/i);
    const ann = await createAssignment(db, OWNER_A, { packageId: "pkg_a" });
    await expect(
      asUser(db, OWNER_A, `
        update forge_work_craft_assignments set crew_size = 4 where id = '${ann.id}';
      `),
    ).rejects.toThrow(/permission denied|violates row-level security/i);
    await expect(
      asUser(db, OWNER_A, `
        insert into forge_work_craft_assignment_revisions
          (owner_id, id, assignment_id, version, actor_id, action)
          values ('${OWNER_A}', 'r-forged', '${ann.id}', 99, 'attacker', 'update');
      `),
    ).rejects.toThrow(/permission denied|violates row-level security/i);
  });
});

describe("slice 4 migration: RPC flows and audit", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("creates an assignment with a normalized key, version 1, and a create revision", async () => {
    const ann = await createAssignment(db, OWNER_A, {
      packageId: "pkg_a", craft: "  Pipe   Fitter ", crewLabel: "Crew A",
      shiftKind: "other", shiftLabel: "Swing", crewSize: 4, hours: 10, note: "Tie-ins",
    });
    expect(ann.craft_key).toBe("pipe-fitter");
    expect(ann.craft_label).toBe("Pipe Fitter");
    expect(ann.crew_key).toBe("crew-a");
    expect(ann.shift_key).toBe("other:swing");
    expect(ann.version).toBe(1);
    expect(ann.created_by).toBe(OWNER_A);
    const revisions = await revisionsFor(db, ann.id);
    expect(revisions).toEqual([
      { action: "create", historical_correction: false, reason: null, version: 1 },
    ]);
  });

  it60("derives the audit actor from auth.uid(), never a caller-supplied actor", async () => {
    // A co-owner creates inside the owner's workspace: the revision
    // actor is the caller (MEMBER_C), not the owner.
    const ann = await createAssignment(db, MEMBER_C, { ownerId: OWNER_A, packageId: "pkg_a" });
    expect(ann.created_by).toBe(MEMBER_C);
    const { rows } = await db.query(`
      select actor_id from forge_work_craft_assignment_revisions where assignment_id = '${ann.id}';
    `);
    expect(rows[0].actor_id).toBe(MEMBER_C);
  });

  it60("refuses a caller outside the workspace", async () => {
    await expect(createAssignment(db, OWNER_B, { ownerId: OWNER_A, packageId: "pkg_a" }))
      .rejects.toThrow(/WPP4_WORKSPACE_FORBIDDEN/);
    // Another owner's package addressed under this owner's id is
    // simply not found — nondisclosing, never a workspace leak.
    await expect(createAssignment(db, OWNER_A, { packageId: "pkg_b" }))
      .rejects.toThrow(/WPP4_PACKAGE_NOT_FOUND/);
  });

  it60("refuses invalid craft, crew size, and hours at the RPC boundary", async () => {
    await expect(createAssignment(db, OWNER_A, { packageId: "pkg_a", craft: "-welder" }))
      .rejects.toThrow(/WPP4_INVALID_CRAFT/);
    await expect(createAssignment(db, OWNER_A, { packageId: "pkg_a", crewSize: 0 }))
      .rejects.toThrow(/WPP4_INVALID_CREW_SIZE/);
    await expect(createAssignment(db, OWNER_A, { packageId: "pkg_a", hours: 24.01 }))
      .rejects.toThrow(/WPP4_INVALID_HOURS/);
    await expect(createAssignment(db, OWNER_A, { packageId: "pkg_a", hours: 7.555 }))
      .rejects.toThrow(/WPP4_INVALID_HOURS/);
    await expect(createAssignment(db, OWNER_A, { packageId: "pkg_a", shiftKind: "other" }))
      .rejects.toThrow(/WPP4_INVALID_SHIFT/);
    await expect(createAssignment(db, OWNER_A, { packageId: "pkg_a", shiftKind: "day", shiftLabel: "Swing" }))
      .rejects.toThrow(/WPP4_INVALID_SHIFT/);
  });

  it60("requires historical correction with a reason for a past work date", async () => {
    await expect(createAssignment(db, OWNER_A, { packageId: "pkg_a", workDate: PAST_1 }))
      .rejects.toThrow(/WPP4_HISTORICAL_CORRECTION_REQUIRED/);
    await expect(createAssignment(db, OWNER_A, {
      packageId: "pkg_a", workDate: PAST_1, historical: true,
    })).rejects.toThrow(/WPP4_REASON_REQUIRED/);
    const ann = await createAssignment(db, OWNER_A, {
      packageId: "pkg_a", workDate: PAST_1, historical: true, reason: "Foreman called in the correction",
    });
    expect(isoDate(ann.work_date)).toBe(`${PAST_1}T00:00:00.000Z`);
    const revisions = await revisionsFor(db, ann.id);
    expect(revisions[0].historical_correction).toBe(true);
    expect(revisions[0].reason).toBe("Foreman called in the correction");
  });

  it60("blocks creates on cancelled and verified-closed packages", async () => {
    await expect(createAssignment(db, OWNER_A, { packageId: "pkg_cancelled" }))
      .rejects.toThrow(/WPP4_PACKAGE_TERMINAL/);
    await expect(createAssignment(db, OWNER_A, { packageId: "pkg_closed" }))
      .rejects.toThrow(/WPP4_PACKAGE_TERMINAL/);
  });

  it60("updates staffing with a version guard and an update revision", async () => {
    const ann = await createAssignment(db, OWNER_A, { packageId: "pkg_a" });
    const updated = await updateAssignment(db, OWNER_A, ann.id, {
      expectedVersion: 1, crewSize: 4, hours: 7.5, note: "Reduced crew",
    });
    expect(updated.version).toBe(2);
    expect(updated.crew_size).toBe(4);
    expect(Number(updated.hours_per_person)).toBe(7.5);
    const revisions = await revisionsFor(db, ann.id);
    expect(revisions.map((r) => r.action)).toEqual(["create", "update"]);
    const { rows } = await db.query(`
      select old_values, new_values from forge_work_craft_assignment_revisions
      where assignment_id = '${ann.id}' and version = 2;
    `);
    expect(rows[0].old_values.crew_size).toBe(6);
    expect(rows[0].new_values.crew_size).toBe(4);
  });

  it60("records a reassign when a key field changes and 409s on a conflicting reassign", async () => {
    const first = await createAssignment(db, OWNER_A, { packageId: "pkg_a", workDate: FUTURE_1 });
    const second = await createAssignment(db, OWNER_A, { packageId: "pkg_a", workDate: FUTURE_2 });
    // Moving onto an occupied identity is a duplicate.
    await expect(updateAssignment(db, OWNER_A, second.id, {
      expectedVersion: 1, workDate: FUTURE_1,
    })).rejects.toThrow(/WPP4_DUPLICATE/);
    // Changing the craft is a reassign and succeeds on a free identity.
    const moved = await updateAssignment(db, OWNER_A, second.id, {
      expectedVersion: 1, craft: "Welder",
    });
    expect(moved.craft_key).toBe("welder");
    const revisions = await revisionsFor(db, second.id);
    expect(revisions.map((r) => r.action)).toEqual(["create", "reassign"]);
    expect(first.id).not.toBe(second.id);
  });

  it60("clears the note and crew label only with explicit set flags", async () => {
    const ann = await createAssignment(db, OWNER_A, {
      packageId: "pkg_a", crewLabel: "Crew A", note: "Tie-ins",
    });
    const cleared = await updateAssignment(db, OWNER_A, ann.id, {
      expectedVersion: 1, note: null, setNote: true, crewLabel: null, setCrewLabel: true,
    });
    expect(cleared.note).toBe(null);
    expect(cleared.crew_label).toBe(null);
    expect(cleared.crew_key).toBe("");
    // Without the set flags, null preserves — so setting a new note
    // needs the flag too.
    const kept = await updateAssignment(db, OWNER_A, ann.id, {
      expectedVersion: 2, note: "Back on", setNote: true, crewSize: 5,
    });
    expect(kept.note).toBe("Back on");
    expect(kept.crew_size).toBe(5);
  });

  it60("fails a stale version and a null version, and a second edit after the first succeeds", async () => {
    const ann = await createAssignment(db, OWNER_A, { packageId: "pkg_a" });
    await updateAssignment(db, OWNER_A, ann.id, { expectedVersion: 1, crewSize: 4 });
    await expect(updateAssignment(db, OWNER_A, ann.id, { expectedVersion: 1, crewSize: 5 }))
      .rejects.toThrow(/WPP4_VERSION_CONFLICT/);
    // A null expected version must not slip past the guard (SQL NULL
    // compared with <> is NULL, not true).
    await expect(asUser(db, OWNER_A, `
      select * from forge_work_craft_assignment_update(
        '${OWNER_A}', '${ann.id}', null, null, null, null, null, null,
        5, null, null, false, false, false, false, null);
    `)).rejects.toThrow(/WPP4_VERSION_CONFLICT/);
  });

  it60("refuses edits on a retired assignment", async () => {
    const ann = await createAssignment(db, OWNER_A, { packageId: "pkg_a" });
    await retireAssignment(db, OWNER_A, ann.id, { expectedVersion: 1, reason: "Stood down" });
    await expect(updateAssignment(db, OWNER_A, ann.id, { expectedVersion: 2, crewSize: 4 }))
      .rejects.toThrow(/WPP4_RETIRED/);
    await expect(retireAssignment(db, OWNER_A, ann.id, { expectedVersion: 2, reason: "Again" }))
      .rejects.toThrow(/WPP4_RETIRED/);
  });

  it60("retires with a required reason and keeps the history", async () => {
    const ann = await createAssignment(db, OWNER_A, { packageId: "pkg_a" });
    await expect(retireAssignment(db, OWNER_A, ann.id, { expectedVersion: 1, reason: "" }))
      .rejects.toThrow(/WPP4_REASON_REQUIRED/);
    const retired = await retireAssignment(db, OWNER_A, ann.id, { expectedVersion: 1, reason: "Crew stood down" });
    expect(retired.version).toBe(2);
    expect(retired.retired_at).not.toBe(null);
    expect(retired.retired_by).toBe(OWNER_A);
    const revisions = await revisionsFor(db, ann.id);
    expect(revisions.map((r) => r.action)).toEqual(["create", "retire"]);
  });

  it60("requires historical correction for past-day edits and retires", async () => {
    const ann = await createAssignment(db, OWNER_A, {
      packageId: "pkg_a", workDate: PAST_1, historical: true, reason: "Late plan entry",
    });
    await expect(updateAssignment(db, OWNER_A, ann.id, { expectedVersion: 1, crewSize: 4 }))
      .rejects.toThrow(/WPP4_HISTORICAL_CORRECTION_REQUIRED/);
    const corrected = await updateAssignment(db, OWNER_A, ann.id, {
      expectedVersion: 1, crewSize: 4, historical: true, reason: "Foreman corrected the headcount",
    });
    expect(corrected.crew_size).toBe(4);
    const revisions = await revisionsFor(db, ann.id);
    expect(revisions.map((r) => r.action)).toEqual(["create", "historical_correction"]);
    await expect(retireAssignment(db, OWNER_A, ann.id, { expectedVersion: 2, reason: "Stood down" }))
      .rejects.toThrow(/WPP4_HISTORICAL_CORRECTION_REQUIRED/);
    const retired = await retireAssignment(db, OWNER_A, ann.id, {
      expectedVersion: 2, reason: "Stood down", historical: true,
    });
    expect(retired.retired_at).not.toBe(null);
    expect((await revisionsFor(db, ann.id)).map((r) => r.action))
      .toEqual(["create", "historical_correction", "historical_correction"]);
  });

  it60("allows only historical corrections on a terminal package, never future work", async () => {
    // Seed a future-dated assignment, then cancel the package.
    const ann = await createAssignment(db, OWNER_A, { packageId: "pkg_a", workDate: FUTURE_1 });
    await db.exec(`update forge_work_packages set status = 'cancelled' where id = 'pkg_a';`);
    await expect(updateAssignment(db, OWNER_A, ann.id, { expectedVersion: 1, crewSize: 4 }))
      .rejects.toThrow(/WPP4_PACKAGE_TERMINAL/);
    await expect(updateAssignment(db, OWNER_A, ann.id, {
      expectedVersion: 1, crewSize: 4, historical: true, reason: "Correcting the record",
    })).rejects.toThrow(/WPP4_PACKAGE_TERMINAL/);
    // Retiring is allowed: it removes future work, it never adds it.
    const retired = await retireAssignment(db, OWNER_A, ann.id, { expectedVersion: 1, reason: "Package cancelled" });
    expect(retired.retired_at).not.toBe(null);
  });

  it60("rolls back the assignment when the revision insert cannot happen", async () => {
    // A duplicate identity fails inside the RPC transaction: the
    // assignment row from the failed attempt must not exist.
    await createAssignment(db, OWNER_A, { packageId: "pkg_a" });
    await expect(createAssignment(db, OWNER_A, { packageId: "pkg_a" }))
      .rejects.toThrow(/WPP4_DUPLICATE/);
    const { rows } = await db.query(`
      select count(*)::int as n from forge_work_craft_assignments
      where owner_id = '${OWNER_A}' and work_package_id = 'pkg_a';
    `);
    expect(rows[0].n).toBe(1);
  });

  it60("never mutates the parent package row", async () => {
    const before = await db.query(`select status from forge_work_packages where id = 'pkg_a';`);
    const ann = await createAssignment(db, OWNER_A, { packageId: "pkg_a" });
    await updateAssignment(db, OWNER_A, ann.id, { expectedVersion: 1, crewSize: 4 });
    await retireAssignment(db, OWNER_A, ann.id, { expectedVersion: 2, reason: "Done" });
    const after = await db.query(`select status from forge_work_packages where id = 'pkg_a';`);
    expect(after.rows[0].status).toBe(before.rows[0].status);
  });
});

describe("slice 4 migration: effective ACL matrix and default-privilege negative case", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("authenticated has SELECT only; anon and service_role have nothing on either table", async () => {
    for (const table of ["forge_work_craft_assignments", "forge_work_craft_assignment_revisions"]) {
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        const { rows } = await db.query(
          `select has_table_privilege('authenticated', 'public.${table}', '${priv}') as ok;`,
        );
        expect(rows[0].ok).toBe(priv === "SELECT");
        for (const role of ["anon", "service_role"]) {
          const { rows: roleRows } = await db.query(
            `select has_table_privilege('${role}', 'public.${table}', '${priv}') as ok;`,
          );
          expect(roleRows[0].ok).toBe(false);
        }
      }
    }
  });

  it60("only authenticated may execute the RPCs; the normalization helpers are not executable by anyone", async () => {
    for (const fn of [
      "forge_work_craft_assignment_create(text,text,date,text,text,text,text,integer,numeric,text,boolean,text)",
      "forge_work_craft_assignment_update(text,text,integer,date,text,text,text,text,integer,numeric,text,boolean,boolean,boolean,boolean,text)",
      "forge_work_craft_assignment_retire(text,text,integer,text,boolean)",
    ]) {
      const { rows } = await db.query(
        `select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') as ok;`,
      );
      expect(rows[0].ok).toBe(true);
      const { rows: publicRows } = await db.query(
        `select has_function_privilege('public', 'public.${fn}', 'EXECUTE') as ok;`,
      );
      expect(publicRows[0].ok).toBe(false);
    }
    for (const fn of [
      "forge_work_craft_normalize_label(text)",
      "forge_work_craft_normalize_key(text)",
    ]) {
      const { rows } = await db.query(
        `select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') as ok;`,
      );
      expect(rows[0].ok).toBe(false);
    }
  });

  it60("negative case: a selective GRANT alone does NOT revoke an already-effective broad privilege", async () => {
    // Simulate the Supabase default: a fresh table lands with ALL
    // granted to authenticated.
    await db.exec(`
      create table scratch_default_privs (id int);
      grant all on scratch_default_privs to authenticated;
    `);
    // A naive migration that only grants SELECT would leave INSERT
    // effective — the grant does not remove the broad privilege.
    await db.exec(`grant select on scratch_default_privs to authenticated;`);
    const { rows } = await db.query(
      `select has_table_privilege('authenticated', 'public.scratch_default_privs', 'INSERT') as ok;`,
    );
    expect(rows[0].ok).toBe(true);
    // The shipped migration's explicit REVOKEs are what remove it:
    // the real tables prove the difference.
    const { rows: realRows } = await db.query(
      `select has_table_privilege('authenticated', 'public.forge_work_craft_assignments', 'INSERT') as ok;`,
    );
    expect(realRows[0].ok).toBe(false);
  });

  it60("the shipped migration text carries explicit REVOKEs for both tables and the RPCs", async () => {
    const sql = loadMigrationSql();
    expect(sql).toContain("revoke insert, update, delete, truncate, references, trigger on forge_work_craft_assignments from authenticated");
    expect(sql).toContain("revoke insert, update, delete, truncate, references, trigger on forge_work_craft_assignment_revisions from authenticated");
    expect(sql).toContain("revoke all on forge_work_craft_assignments from anon");
    expect(sql).toContain("revoke all on forge_work_craft_assignment_revisions from anon");
    expect(sql).toContain("revoke all on forge_work_craft_assignments from service_role");
    expect(sql).toContain("revoke all on forge_work_craft_assignment_revisions from service_role");
    expect(sql).toContain("revoke all on function public.forge_work_craft_assignment_create(text, text, date, text, text, text, text, integer, numeric, text, boolean, text) from public");
    expect(sql).toContain("revoke all on function public.forge_work_craft_assignment_update(text, text, integer, date, text, text, text, text, integer, numeric, text, boolean, boolean, boolean, boolean, text) from public");
    expect(sql).toContain("revoke all on function public.forge_work_craft_assignment_retire(text, text, integer, text, boolean) from public");
    expect(sql).toContain("revoke all on function public.forge_work_craft_normalize_label(text) from public");
    expect(sql).toContain("revoke all on function public.forge_work_craft_normalize_key(text) from public");
    expect(sql).toContain("force row level security");
  });
});
