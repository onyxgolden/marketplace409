// Work Package Planner slice 5 — migration/integration proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) and proves:
//   - CHECKs/FKs: title/description/craft charset discipline,
//     duration/hours ranges, the partial-unique active sequence,
//     supersession discipline, revision uniqueness, and the package
//     hard-delete restriction while steps exist;
//   - RLS: owner isolation, co-owner access, anon sees nothing, direct
//     writes denied (RPC-only write path);
//   - RPCs: create (append + insert-at with shifting), update
//     (version guard, explicit-null clears, historical corrections,
//     terminal-package rule), reorder (generation guard, exact-set
//     validation), retire (reason, gap closing, link retirement),
//     supersession, drawing links, and the slice-3 drawing-delete
//     replacement retiring/detaching step links in the SAME
//     transaction as the permit cleanup;
//   - Atomic audit: a failed mutation leaves no step and no revision;
//   - Effective ACL matrix for authenticated/anon/service_role, and
//     the default-privilege negative case: a selective GRANT alone
//     does NOT revoke an already-effective broad privilege, which is
//     why the migration's explicit REVOKEs are load-bearing.
// Roles, the auth.uid() stub, workspace_members, and the
// has_workspace_access() copy mirror production (see
// 20260829000100_add_workspace_authorization_helpers.sql); the
// prerequisite packages/drawings/takeoff-lines tables are minimal
// shapes with the exact keys the slice-3/4/5 foreign keys reference,
// plus the status column the terminal-package rule reads.
//
// A real-PostgreSQL subset (drawing-delete coordination, concurrent
// reorder with two live connections, ACL matrix, same-transaction
// audit rollback) runs against a scratch PG16 cluster when the
// binaries exist, and SKIPS LOUDLY — never silently — when they do
// not. PGlite is single-connection, so it cannot prove the
// concurrent-reorder serialization; that leg exists only on real PG.

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

function loadMigrationSql(name) {
  return readFileSync(join(HERE, "..", "..", "..", "supabase", "migrations", name), "utf8");
}

// Minimal prerequisite shape with the exact keys the slice-3/4/5
// foreign keys reference, plus the status column the terminal-package
// rule reads and the drawing columns the delete RPC and the step
// link display read.
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
  // Apply the shipped files in timestamp order: slice 3 first (the
  // permit tables + the delete RPC slice 5 replaces), then slice 4
  // (the craft-normalize helper slice 5 reuses), then slice 5.
  await db.exec(loadMigrationSql(SLICE3));
  await db.exec(loadMigrationSql(SLICE4));
  await db.exec(loadMigrationSql(SLICE5));
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

async function createStep(db, uid, {
  ownerId, packageId, title, description, craftLabel, durationDays,
  personHours, sourceNote, supersedesStepId, insertAt, reason,
}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_step_create(
      '${ownerId ?? uid}', '${packageId}', ${sqlStr(title ?? "Fabricate pipe spool")},
      ${sqlStr(description ?? null)}, ${sqlStr(craftLabel ?? null)},
      ${sqlNum(durationDays ?? null)}, ${sqlNum(personHours ?? null)},
      ${sqlStr(sourceNote ?? null)}, ${sqlStr(supersedesStepId ?? null)},
      ${sqlNum(insertAt ?? null)}, ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function updateStep(db, uid, stepId, {
  expectedVersion, title, description, craftLabel, durationDays,
  personHours, sourceNote, setDescription, setCraftLabel,
  setDurationDays, setPersonHours, setSourceNote, historical, reason,
}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_step_update(
      '${OWNER_A}', '${stepId}', ${sqlNum(expectedVersion)},
      ${sqlStr(title ?? null)}, ${sqlStr(description ?? null)},
      ${sqlStr(craftLabel ?? null)},
      ${sqlNum(durationDays ?? null)}, ${sqlNum(personHours ?? null)},
      ${sqlStr(sourceNote ?? null)},
      ${setDescription === true ? "true" : "false"},
      ${setCraftLabel === true ? "true" : "false"},
      ${setDurationDays === true ? "true" : "false"},
      ${setPersonHours === true ? "true" : "false"},
      ${setSourceNote === true ? "true" : "false"},
      ${historical === true ? "true" : "false"},
      ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function retireStep(db, uid, stepId, { expectedVersion, reason, historical }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_step_retire(
      '${OWNER_A}', '${stepId}', ${sqlNum(expectedVersion)},
      ${sqlStr(reason ?? null)},
      ${historical === true ? "true" : "false"});
  `);
  return rows[0];
}

async function reorderSteps(db, uid, { packageId, stepIds, expectedGeneration, reason }) {
  const ids = `array[${stepIds.map((id) => sqlStr(id)).join(", ")}]`;
  const { rows } = await asUser(db, uid, `
    select * from forge_work_step_reorder(
      '${OWNER_A}', '${packageId}', ${ids}, ${sqlNum(expectedGeneration)},
      ${sqlStr(reason ?? null)});
  `);
  return rows;
}

async function createLink(db, uid, { packageId, stepId, drawingId, refinementNote, reason }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_step_link_drawing_create(
      '${OWNER_A}', '${packageId}', '${stepId}', '${drawingId}',
      ${sqlStr(refinementNote ?? null)}, ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function retireLink(db, uid, linkId, { expectedVersion, reason }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_step_link_drawing_retire(
      '${OWNER_A}', '${linkId}', ${sqlNum(expectedVersion)},
      ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function createAnnotation(db, uid, { packageId, targetKind, drawingId, label, url, reference, note }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_permit_annotation_create(
      '${OWNER_A}', '${packageId}', '${targetKind}',
      ${sqlStr(drawingId ?? null)}, ${sqlStr(label ?? "Permit A")},
      ${sqlStr(url ?? "https://example.gov/permits/a")},
      ${sqlStr(reference ?? null)}, ${sqlStr(note ?? null)});
  `);
  return rows[0];
}

async function deleteDrawing(db, uid, { packageId, drawingId }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_permit_annotation_delete_drawing(
      '${OWNER_A}', '${packageId}', '${drawingId}');
  `);
  return rows[0];
}

async function revisionsFor(db, stepId) {
  const { rows } = await db.query(`
    select action, reason, version
    from forge_work_step_revisions
    where step_id = '${stepId}' order by version;
  `);
  return rows;
}

async function linkRevisionsFor(db, linkId) {
  const { rows } = await db.query(`
    select action, reason, version
    from forge_work_step_drawing_link_revisions
    where link_id = '${linkId}' order by version;
  `);
  return rows;
}

async function stepsFor(db, packageId) {
  const { rows } = await db.query(`
    select id, title, sequence_no, version, retired_at
    from forge_work_steps
    where owner_id = '${OWNER_A}' and work_package_id = '${packageId}'
    order by sequence_no, id;
  `);
  return rows;
}

async function orderGeneration(db, packageId) {
  const { rows } = await db.query(`
    select generation from forge_work_step_order
    where owner_id = '${OWNER_A}' and work_package_id = '${packageId}';
  `);
  return rows[0]?.generation ?? null;
}

describe("slice 5 migration: schema constraints", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("rejects a title outside the charset or length", async () => {
    for (const [id, title] of [["x1", "-bad"], ["x2", "Bad <b>title</b>"], ["x3", "x".repeat(161)]]) {
      await expect(db.query(`
        insert into forge_work_steps
          (owner_id, id, work_package_id, title, sequence_no, version, created_by, updated_by)
          values ('${OWNER_A}', '${id}', 'pkg_a', '${title}', 1, 1, 'u', 'u');
      `)).rejects.toThrow(/check constraint/i);
    }
  });

  it60("rejects a description with HTML or control characters and one over 4000 chars", async () => {
    await expect(db.query(`
      insert into forge_work_steps
        (owner_id, id, work_package_id, title, description, sequence_no, version, created_by, updated_by)
        values ('${OWNER_A}', 'x1', 'pkg_a', 'Good title', 'See <a href="x">this</a>', 1, 1, 'u', 'u');
    `)).rejects.toThrow(/check constraint/i);
    await expect(db.query(`
      insert into forge_work_steps
        (owner_id, id, work_package_id, title, description, sequence_no, version, created_by, updated_by)
        values ('${OWNER_A}', 'x2', 'pkg_a', 'Good title', 'a' || chr(1) || 'b', 1, 1, 'u', 'u');
    `)).rejects.toThrow(/check constraint/i);
    await expect(db.query(`
      insert into forge_work_steps
        (owner_id, id, work_package_id, title, description, sequence_no, version, created_by, updated_by)
        values ('${OWNER_A}', 'x3', 'pkg_a', 'Good title', repeat('x', 4001), 1, 1, 'u', 'u');
    `)).rejects.toThrow(/check constraint/i);
  });

  it60("rejects duration days outside 1–366 and person-hours outside (0, 1000000]", async () => {
    for (const [id, days, hours] of [["x1", 0, 8], ["x2", 367, 8], ["x3", 3, 0], ["x4", 3, 1000000.01]]) {
      await expect(db.query(`
        insert into forge_work_steps
          (owner_id, id, work_package_id, title, sequence_no,
           planned_duration_days, planned_person_hours, version, created_by, updated_by)
          values ('${OWNER_A}', '${id}', 'pkg_a', 'Good title', 1, ${days}, ${hours}, 1, 'u', 'u');
      `)).rejects.toThrow(/check constraint/i);
    }
  });

  it60("rejects a duplicate active sequence number but allows reuse after retire", async () => {
    await db.query(`
      insert into forge_work_steps
        (owner_id, id, work_package_id, title, sequence_no, version, created_by, updated_by)
        values ('${OWNER_A}', 'x1', 'pkg_a', 'First', 1, 1, 'u', 'u');
    `);
    await expect(db.query(`
      insert into forge_work_steps
        (owner_id, id, work_package_id, title, sequence_no, version, created_by, updated_by)
        values ('${OWNER_A}', 'x2', 'pkg_a', 'Second', 1, 1, 'u', 'u');
    `)).rejects.toThrow(/duplicate key|unique/i);
    await db.query(`
      update forge_work_steps set retired_at = now(), retired_by = 'u', version = 2
      where id = 'x1';
    `);
    await db.query(`
      insert into forge_work_steps
        (owner_id, id, work_package_id, title, sequence_no, version, created_by, updated_by)
        values ('${OWNER_A}', 'x3', 'pkg_a', 'Third', 1, 1, 'u', 'u');
    `);
    const { rows } = await db.query(`select count(*)::int as n from forge_work_steps where sequence_no = 1;`);
    expect(rows[0].n).toBe(2);
  });

  it60("rejects a revision for a nonexistent step and a duplicate version", async () => {
    const step = await createStep(db, OWNER_A, { packageId: "pkg_a" });
    await expect(db.query(`
      insert into forge_work_step_revisions
        (owner_id, id, step_id, version, actor_id, action)
        values ('${OWNER_A}', 'r-missing', 'no-such-step', 1, 'u', 'create');
    `)).rejects.toThrow(/foreign key/i);
    await expect(db.query(`
      insert into forge_work_step_revisions
        (owner_id, id, step_id, version, actor_id, action)
        values ('${OWNER_A}', 'r-dup', '${step.id}', 1, 'u', 'create');
    `)).rejects.toThrow(/duplicate key|unique/i);
  });

  it60("restricts hard-deleting a package while steps exist", async () => {
    await createStep(db, OWNER_A, { packageId: "pkg_a" });
    await expect(db.query(`delete from forge_work_packages where id = 'pkg_a';`))
      .rejects.toThrow(/foreign key|violates/i);
  });

  it60("normalizes craft keys the same way the JS domain does", async () => {
    const { rows } = await db.query(`
      select forge_work_craft_normalize_key('  Pipe   Fitter ') as key,
             forge_work_craft_normalize_key('QA/QC Inspector') as key2;
    `);
    expect(rows[0]).toEqual({ key: "pipe-fitter", key2: "qa/qc-inspector" });
  });
});

describe("slice 5 migration: RLS isolation", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("owner A selects only owner A steps; owner B only owner B", async () => {
    await createStep(db, OWNER_A, { packageId: "pkg_a", title: "Owner A step" });
    await createStep(db, OWNER_B, { packageId: "pkg_b", title: "Owner B step" });
    const { rows: rowsA } = await asUser(db, OWNER_A, `select title from forge_work_steps;`);
    const { rows: rowsB } = await asUser(db, OWNER_B, `select title from forge_work_steps;`);
    expect(rowsA.map((r) => r.title)).toEqual(["Owner A step"]);
    expect(rowsB.map((r) => r.title)).toEqual(["Owner B step"]);
  });

  it60("an active co-owner membership grants access to the workspace", async () => {
    await createStep(db, OWNER_A, { packageId: "pkg_a", title: "Co-owner visible" });
    const { rows } = await asUser(db, MEMBER_C, `select title from forge_work_steps;`);
    expect(rows.map((r) => r.title)).toEqual(["Co-owner visible"]);
  });

  it60("anon cannot select (no policy, no grant)", async () => {
    await expect(
      asRole(db, "anon", OWNER_A, `select * from forge_work_steps;`),
    ).rejects.toThrow(/permission denied/i);
  });

  it60("a direct client insert, update, or revision insert is denied — writes go only through the RPCs", async () => {
    await expect(
      asUser(db, OWNER_A, `
        insert into forge_work_steps
          (owner_id, id, work_package_id, title, sequence_no, version, created_by, updated_by)
          values ('${OWNER_A}', 'x-direct', 'pkg_a', 'Direct', 1, 1, 'u', 'u');
      `),
    ).rejects.toThrow(/permission denied|violates row-level security/i);
    const step = await createStep(db, OWNER_A, { packageId: "pkg_a" });
    await expect(
      asUser(db, OWNER_A, `
        update forge_work_steps set title = 'Forged' where id = '${step.id}';
      `),
    ).rejects.toThrow(/permission denied|violates row-level security/i);
    await expect(
      asUser(db, OWNER_A, `
        insert into forge_work_step_revisions
          (owner_id, id, step_id, version, actor_id, action)
          values ('${OWNER_A}', 'r-forged', '${step.id}', 99, 'attacker', 'update');
      `),
    ).rejects.toThrow(/permission denied|violates row-level security/i);
  });
});

describe("slice 5 migration: RPC flows and audit", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("creates a step appended at the end with version 1 and a create revision", async () => {
    const first = await createStep(db, OWNER_A, {
      packageId: "pkg_a", title: "  Fabricate   pipe spool ",
      craftLabel: "  Pipe   Fitter ", durationDays: 3, personHours: 24.5,
      sourceNote: "Assumes two fitters.",
    });
    expect(first.sequence_no).toBe(1);
    expect(first.title).toBe("Fabricate pipe spool");
    expect(first.craft_key).toBe("pipe-fitter");
    expect(first.craft_label).toBe("Pipe Fitter");
    expect(Number(first.planned_person_hours)).toBe(24.5);
    expect(first.version).toBe(1);
    expect(first.created_by).toBe(OWNER_A);
    expect(await orderGeneration(db, "pkg_a")).toBe(1);
    const second = await createStep(db, OWNER_A, { packageId: "pkg_a", title: "Install supports" });
    expect(second.sequence_no).toBe(2);
    expect(await orderGeneration(db, "pkg_a")).toBe(2);
    expect(await revisionsFor(db, first.id)).toEqual([
      { action: "create", reason: null, version: 1 },
    ]);
  });

  it60("inserts at a position, shifting later steps with reorder revisions", async () => {
    const first = await createStep(db, OWNER_A, { packageId: "pkg_a", title: "First" });
    const second = await createStep(db, OWNER_A, { packageId: "pkg_a", title: "Second" });
    const inserted = await createStep(db, OWNER_A, {
      packageId: "pkg_a", title: "Inserted", insertAt: 1,
    });
    expect(inserted.sequence_no).toBe(1);
    expect(inserted.version).toBe(1);
    // The new step is exempt from a version bump — its create
    // revision carries the final position.
    expect(await revisionsFor(db, inserted.id)).toEqual([
      { action: "create", reason: null, version: 1 },
    ]);
    const steps = await stepsFor(db, "pkg_a");
    expect(steps.map((s) => [s.title, s.sequence_no, s.version])).toEqual([
      ["Inserted", 1, 1],
      ["First", 2, 2],
      ["Second", 3, 2],
    ]);
    expect((await revisionsFor(db, first.id)).map((r) => r.action)).toEqual(["create", "reorder"]);
    expect((await revisionsFor(db, second.id)).map((r) => r.action)).toEqual(["create", "reorder"]);
    expect(await orderGeneration(db, "pkg_a")).toBe(3);
    await expect(createStep(db, OWNER_A, { packageId: "pkg_a", title: "Out of range", insertAt: 5 }))
      .rejects.toThrow(/WPP5_INVALID_POSITION/);
  });

  it60("derives the audit actor from auth.uid(), never a caller-supplied actor", async () => {
    // A co-owner creates inside the owner's workspace: the revision
    // actor is the caller (MEMBER_C), not the owner.
    const step = await createStep(db, MEMBER_C, { ownerId: OWNER_A, packageId: "pkg_a" });
    expect(step.created_by).toBe(MEMBER_C);
    const { rows } = await db.query(`
      select actor_id from forge_work_step_revisions where step_id = '${step.id}';
    `);
    expect(rows[0].actor_id).toBe(MEMBER_C);
  });

  it60("refuses a caller outside the workspace", async () => {
    await expect(createStep(db, OWNER_B, { ownerId: OWNER_A, packageId: "pkg_a" }))
      .rejects.toThrow(/WPP5_WORKSPACE_FORBIDDEN/);
    // Another owner's package addressed under this owner's id is
    // simply not found — nondisclosing, never a workspace leak.
    await expect(createStep(db, OWNER_A, { packageId: "pkg_b" }))
      .rejects.toThrow(/WPP5_PACKAGE_NOT_FOUND/);
  });

  it60("refuses invalid title, duration, and hours at the RPC boundary", async () => {
    await expect(createStep(db, OWNER_A, { packageId: "pkg_a", title: "-bad" }))
      .rejects.toThrow(/WPP5_INVALID_TITLE/);
    await expect(createStep(db, OWNER_A, { packageId: "pkg_a", title: "Bad <b>title</b>" }))
      .rejects.toThrow(/WPP5_INVALID_TITLE/);
    await expect(createStep(db, OWNER_A, { packageId: "pkg_a", durationDays: 0 }))
      .rejects.toThrow(/WPP5_INVALID_DURATION/);
    await expect(createStep(db, OWNER_A, { packageId: "pkg_a", durationDays: 367 }))
      .rejects.toThrow(/WPP5_INVALID_DURATION/);
    await expect(createStep(db, OWNER_A, { packageId: "pkg_a", personHours: 0 }))
      .rejects.toThrow(/WPP5_INVALID_HOURS/);
    await expect(createStep(db, OWNER_A, { packageId: "pkg_a", personHours: 24.555 }))
      .rejects.toThrow(/WPP5_INVALID_HOURS/);
    await expect(createStep(db, OWNER_A, { packageId: "pkg_a", personHours: 1000001 }))
      .rejects.toThrow(/WPP5_INVALID_HOURS/);
    await expect(createStep(db, OWNER_A, { packageId: "pkg_a", craftLabel: "-Welder" }))
      .rejects.toThrow(/WPP5_INVALID_CRAFT/);
  });

  it60("blocks creates and normal edits on terminal packages, allows historical corrections and retire", async () => {
    await expect(createStep(db, OWNER_A, { packageId: "pkg_cancelled" }))
      .rejects.toThrow(/WPP5_PACKAGE_TERMINAL/);
    await expect(createStep(db, OWNER_A, { packageId: "pkg_closed" }))
      .rejects.toThrow(/WPP5_PACKAGE_TERMINAL/);
    const step = await createStep(db, OWNER_A, { packageId: "pkg_a", title: "Before close" });
    await db.exec(`update forge_work_packages set status = 'cancelled' where id = 'pkg_a';`);
    await expect(updateStep(db, OWNER_A, step.id, { expectedVersion: 1, title: "Normal edit" }))
      .rejects.toThrow(/WPP5_PACKAGE_TERMINAL/);
    // A historical correction without a reason is still terminal-blocked.
    await expect(updateStep(db, OWNER_A, step.id, {
      expectedVersion: 1, title: "Correction", historical: true,
    })).rejects.toThrow(/WPP5_PACKAGE_TERMINAL/);
    const corrected = await updateStep(db, OWNER_A, step.id, {
      expectedVersion: 1, title: "Corrected title", historical: true, reason: "Foreman called in the fix",
    });
    expect(corrected.title).toBe("Corrected title");
    expect(corrected.version).toBe(2);
    expect((await revisionsFor(db, step.id)).map((r) => r.action))
      .toEqual(["create", "historical_correction"]);
    // Reorder is blocked too; retire is allowed: it removes future
    // work, it never adds it.
    await expect(reorderSteps(db, OWNER_A, {
      packageId: "pkg_a", stepIds: [step.id], expectedGeneration: 1,
    })).rejects.toThrow(/WPP5_PACKAGE_TERMINAL/);
    const retired = await retireStep(db, OWNER_A, step.id, { expectedVersion: 2, reason: "Package cancelled" });
    expect(retired.retired_at).not.toBe(null);
  });

  it60("updates with a version guard and an update revision carrying old and new values", async () => {
    const step = await createStep(db, OWNER_A, {
      packageId: "pkg_a", title: "Install supports", durationDays: 3, personHours: 24,
    });
    const updated = await updateStep(db, OWNER_A, step.id, {
      expectedVersion: 1, durationDays: 5, personHours: 40, sourceNote: "Two crews",
      setDurationDays: true, setPersonHours: true, setSourceNote: true,
    });
    expect(updated.version).toBe(2);
    expect(updated.planned_duration_days).toBe(5);
    expect(Number(updated.planned_person_hours)).toBe(40);
    expect(updated.source_note).toBe("Two crews");
    expect((await revisionsFor(db, step.id)).map((r) => r.action)).toEqual(["create", "update"]);
    const { rows } = await db.query(`
      select old_values, new_values from forge_work_step_revisions
      where step_id = '${step.id}' and version = 2;
    `);
    expect(rows[0].old_values.planned_duration_days).toBe(3);
    expect(rows[0].new_values.planned_duration_days).toBe(5);
  });

  it60("clears optional fields only with explicit set flags", async () => {
    const step = await createStep(db, OWNER_A, {
      packageId: "pkg_a", description: "Shop work", craftLabel: "Welder",
      durationDays: 2, personHours: 16, sourceNote: "Note",
    });
    const cleared = await updateStep(db, OWNER_A, step.id, {
      expectedVersion: 1, description: null, setDescription: true,
      craftLabel: null, setCraftLabel: true, durationDays: null, setDurationDays: true,
    });
    expect(cleared.description).toBe(null);
    expect(cleared.craft_label).toBe(null);
    expect(cleared.craft_key).toBe(null);
    expect(cleared.planned_duration_days).toBe(null);
    // Without the set flags, null preserves.
    const kept = await updateStep(db, OWNER_A, step.id, {
      expectedVersion: 2, description: null, personHours: null, sourceNote: "Back on",
      setSourceNote: true,
    });
    expect(kept.description).toBe(null);
    expect(Number(kept.planned_person_hours)).toBe(16);
    expect(kept.source_note).toBe("Back on");
  });

  it60("fails a stale version and a null version, and a second edit after the first succeeds", async () => {
    const step = await createStep(db, OWNER_A, { packageId: "pkg_a" });
    await updateStep(db, OWNER_A, step.id, { expectedVersion: 1, title: "Edited once" });
    await expect(updateStep(db, OWNER_A, step.id, { expectedVersion: 1, title: "Stale" }))
      .rejects.toThrow(/WPP5_VERSION_CONFLICT/);
    // A null expected version must not slip past the guard (SQL NULL
    // compared with <> is NULL, not true).
    await expect(asUser(db, OWNER_A, `
      select * from forge_work_step_update(
        '${OWNER_A}', '${step.id}', null, 'Null version', null, null,
        null, null, null, false, false, false, false, false, false, null);
    `)).rejects.toThrow(/WPP5_VERSION_CONFLICT/);
  });

  it60("refuses edits on a retired step and refuses a double retire", async () => {
    const step = await createStep(db, OWNER_A, { packageId: "pkg_a" });
    await retireStep(db, OWNER_A, step.id, { expectedVersion: 1, reason: "Stood down" });
    await expect(updateStep(db, OWNER_A, step.id, { expectedVersion: 2, title: "Too late" }))
      .rejects.toThrow(/WPP5_RETIRED/);
    await expect(retireStep(db, OWNER_A, step.id, { expectedVersion: 2, reason: "Again" }))
      .rejects.toThrow(/WPP5_RETIRED/);
  });

  it60("retires with a required reason, keeps the history, and closes the gap", async () => {
    const first = await createStep(db, OWNER_A, { packageId: "pkg_a", title: "First" });
    const middle = await createStep(db, OWNER_A, { packageId: "pkg_a", title: "Middle" });
    const last = await createStep(db, OWNER_A, { packageId: "pkg_a", title: "Last" });
    await expect(retireStep(db, OWNER_A, middle.id, { expectedVersion: 1, reason: "" }))
      .rejects.toThrow(/WPP5_REASON_REQUIRED/);
    const retired = await retireStep(db, OWNER_A, middle.id, { expectedVersion: 1, reason: "No longer needed" });
    expect(retired.version).toBe(2);
    expect(retired.retired_at).not.toBe(null);
    expect(retired.retired_by).toBe(OWNER_A);
    expect(retired.sequence_no).toBe(2);
    expect((await revisionsFor(db, middle.id)).map((r) => r.action)).toEqual(["create", "retire"]);
    // The gap closes: the last step moves 3 → 2 with a reorder
    // revision; the first step is untouched. (Sorted by title: the
    // retired middle step and the last step share sequence 2, so id
    // order between them is not meaningful.)
    const steps = (await stepsFor(db, "pkg_a")).sort((a, b) => a.title.localeCompare(b.title));
    expect(steps.map((s) => [s.title, s.sequence_no, s.version, s.retired_at !== null])).toEqual([
      ["First", 1, 1, false],
      ["Last", 2, 2, false],
      ["Middle", 2, 2, true],
    ]);
    expect((await revisionsFor(db, last.id)).map((r) => r.action)).toEqual(["create", "reorder"]);
    expect(await orderGeneration(db, "pkg_a")).toBe(4);
  });

  it60("enforces supersession: only a retired step in the same package may be superseded", async () => {
    const old = await createStep(db, OWNER_A, { packageId: "pkg_a", title: "Old plan" });
    await expect(createStep(db, OWNER_A, {
      packageId: "pkg_a", title: "Too early", supersedesStepId: old.id,
    })).rejects.toThrow(/WPP5_INVALID_SUPERSEDES/);
    await retireStep(db, OWNER_A, old.id, { expectedVersion: 1, reason: "Replanned" });
    const replacement = await createStep(db, OWNER_A, {
      packageId: "pkg_a", title: "New plan", supersedesStepId: old.id,
    });
    expect(replacement.supersedes_step_id).toBe(old.id);
    const otherOwner = await createStep(db, OWNER_B, { packageId: "pkg_b", title: "Other owner" });
    await expect(createStep(db, OWNER_A, {
      packageId: "pkg_a", title: "Cross package", supersedesStepId: otherOwner.id,
    })).rejects.toThrow(/WPP5_INVALID_SUPERSEDES/);
    await expect(createStep(db, OWNER_A, {
      packageId: "pkg_a", title: "Ghost", supersedesStepId: "no-such-step",
    })).rejects.toThrow(/WPP5_INVALID_SUPERSEDES/);
  });

  it60("reorders with a generation guard and rejects a wrong set", async () => {
    const first = await createStep(db, OWNER_A, { packageId: "pkg_a", title: "First" });
    const second = await createStep(db, OWNER_A, { packageId: "pkg_a", title: "Second" });
    const third = await createStep(db, OWNER_A, { packageId: "pkg_a", title: "Third" });
    expect(await orderGeneration(db, "pkg_a")).toBe(3);
    // Stale generation.
    await expect(reorderSteps(db, OWNER_A, {
      packageId: "pkg_a", stepIds: [third.id, second.id, first.id], expectedGeneration: 2,
    })).rejects.toThrow(/WPP5_VERSION_CONFLICT/);
    // Missing one step / an extra id / a duplicate.
    for (const badIds of [[first.id, second.id], [first.id, second.id, third.id, "ghost"], [first.id, first.id, third.id]]) {
      await expect(reorderSteps(db, OWNER_A, {
        packageId: "pkg_a", stepIds: badIds, expectedGeneration: 3,
      })).rejects.toThrow(/WPP5_INVALID_ORDER/);
    }
    const reordered = await reorderSteps(db, OWNER_A, {
      packageId: "pkg_a", stepIds: [third.id, first.id, second.id],
      expectedGeneration: 3, reason: "Field order",
    });
    expect(reordered.map((s) => [s.title, s.sequence_no])).toEqual([
      ["Third", 1],
      ["First", 2],
      ["Second", 3],
    ]);
    expect(await orderGeneration(db, "pkg_a")).toBe(4);
    expect((await revisionsFor(db, third.id)).map((r) => r.action)).toEqual(["create", "reorder"]);
    // A no-op reorder still bumps the generation (the caller asked
    // for a reorder at a known generation) but writes no revisions.
    const same = await reorderSteps(db, OWNER_A, {
      packageId: "pkg_a", stepIds: [third.id, first.id, second.id], expectedGeneration: 4,
    });
    expect(same.map((s) => s.sequence_no)).toEqual([1, 2, 3]);
    expect(await orderGeneration(db, "pkg_a")).toBe(5);
    expect((await revisionsFor(db, third.id)).map((r) => r.action)).toEqual(["create", "reorder"]);
  });

  it60("rolls back the step when the transaction cannot commit", async () => {
    await db.exec("begin;");
    await createStep(db, OWNER_A, { packageId: "pkg_a", title: "Rolled back" });
    await db.exec("rollback;");
    const { rows } = await db.query(`
      select count(*)::int as n from forge_work_steps
      where owner_id = '${OWNER_A}' and work_package_id = 'pkg_a';
    `);
    expect(rows[0].n).toBe(0);
    const { rows: revRows } = await db.query(`
      select count(*)::int as n from forge_work_step_revisions where owner_id = '${OWNER_A}';
    `);
    expect(revRows[0].n).toBe(0);
    // A duplicate create fails inside the RPC transaction: the
    // step row from the failed attempt must not exist either.
    const first = await createStep(db, OWNER_A, { packageId: "pkg_a", title: "First" });
    await expect(reorderSteps(db, OWNER_A, {
      packageId: "pkg_a", stepIds: [first.id, first.id], expectedGeneration: 1,
    })).rejects.toThrow(/WPP5_INVALID_ORDER/);
    expect((await stepsFor(db, "pkg_a")).length).toBe(1);
  });

  it60("never mutates the parent package row", async () => {
    const before = await db.query(`select status from forge_work_packages where id = 'pkg_a';`);
    const step = await createStep(db, OWNER_A, { packageId: "pkg_a" });
    await updateStep(db, OWNER_A, step.id, { expectedVersion: 1, title: "Edited" });
    await retireStep(db, OWNER_A, step.id, { expectedVersion: 2, reason: "Done" });
    const after = await db.query(`select status from forge_work_packages where id = 'pkg_a';`);
    expect(after.rows[0].status).toBe(before.rows[0].status);
  });
});

describe("slice 5 migration: drawing links", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("links a drawing as planning context, with a create link revision", async () => {
    const step = await createStep(db, OWNER_A, { packageId: "pkg_a" });
    const link = await createLink(db, OWNER_A, {
      packageId: "pkg_a", stepId: step.id, drawingId: "dwg_1",
      refinementNote: "Per P&ID rev C",
    });
    expect(link.drawing_id).toBe("dwg_1");
    expect(link.original_drawing_id).toBe("dwg_1");
    expect(link.version).toBe(1);
    expect(link.created_by).toBe(OWNER_A);
    expect(await linkRevisionsFor(db, link.id)).toEqual([
      { action: "create", reason: null, version: 1 },
    ]);
  });

  it60("refuses a duplicate active pair, a foreign drawing, and a link on a retired step", async () => {
    const step = await createStep(db, OWNER_A, { packageId: "pkg_a" });
    await createLink(db, OWNER_A, { packageId: "pkg_a", stepId: step.id, drawingId: "dwg_1" });
    await expect(createLink(db, OWNER_A, { packageId: "pkg_a", stepId: step.id, drawingId: "dwg_1" }))
      .rejects.toThrow(/WPP5_DUPLICATE/);
    // A drawing from another package is simply not found.
    await db.exec(`
      insert into forge_work_drawings (owner_id, package_id, id, drawing_number, drawing_type, title, p_id_drawing_id)
        values ('${OWNER_B}', 'pkg_b', 'dwg_b', 'P-9', 'p_id', 'Other', null);
    `);
    await expect(createLink(db, OWNER_A, { packageId: "pkg_a", stepId: step.id, drawingId: "dwg_b" }))
      .rejects.toThrow(/WPP5_DRAWING_NOT_FOUND/);
    await expect(createLink(db, OWNER_A, { packageId: "pkg_a", stepId: step.id, drawingId: "ghost" }))
      .rejects.toThrow(/WPP5_DRAWING_NOT_FOUND/);
    await retireStep(db, OWNER_A, step.id, { expectedVersion: 1, reason: "Done" });
    const other = await createStep(db, OWNER_A, { packageId: "pkg_a", title: "Other" });
    await retireStep(db, OWNER_A, other.id, { expectedVersion: 1, reason: "Done" });
    await expect(createLink(db, OWNER_A, { packageId: "pkg_a", stepId: other.id, drawingId: "dwg_2" }))
      .rejects.toThrow(/WPP5_RETIRED/);
  });

  it60("retires a link with a required reason and a version guard, keeping its history", async () => {
    const step = await createStep(db, OWNER_A, { packageId: "pkg_a" });
    const link = await createLink(db, OWNER_A, { packageId: "pkg_a", stepId: step.id, drawingId: "dwg_1" });
    await expect(retireLink(db, OWNER_A, link.id, { expectedVersion: 1, reason: "" }))
      .rejects.toThrow(/WPP5_REASON_REQUIRED/);
    await expect(retireLink(db, OWNER_A, link.id, { expectedVersion: 9, reason: "Wrong drawing" }))
      .rejects.toThrow(/WPP5_VERSION_CONFLICT/);
    const retired = await retireLink(db, OWNER_A, link.id, { expectedVersion: 1, reason: "Wrong drawing" });
    expect(retired.version).toBe(2);
    expect(retired.retired_at).not.toBe(null);
    expect(retired.original_drawing_id).toBe("dwg_1");
    expect((await linkRevisionsFor(db, link.id)).map((r) => r.action)).toEqual(["create", "retire"]);
    // The same pair may link again once retired.
    const again = await createLink(db, OWNER_A, { packageId: "pkg_a", stepId: step.id, drawingId: "dwg_1" });
    expect(again.id).not.toBe(link.id);
  });

  it60("retiring a step retires its active drawing links with audited retire revisions", async () => {
    const step = await createStep(db, OWNER_A, { packageId: "pkg_a" });
    const link1 = await createLink(db, OWNER_A, { packageId: "pkg_a", stepId: step.id, drawingId: "dwg_1" });
    const link2 = await createLink(db, OWNER_A, { packageId: "pkg_a", stepId: step.id, drawingId: "dwg_2" });
    await retireStep(db, OWNER_A, step.id, { expectedVersion: 1, reason: "Step removed" });
    for (const link of [link1, link2]) {
      const { rows } = await db.query(`
        select retired_at, retired_by from forge_work_step_drawing_links where id = '${link.id}';
      `);
      expect(rows[0].retired_at).not.toBe(null);
      expect(rows[0].retired_by).toBe(OWNER_A);
      expect((await linkRevisionsFor(db, link.id)).map((r) => r.action)).toEqual(["create", "retire"]);
      expect((await linkRevisionsFor(db, link.id))[1].reason).toBe("Step removed");
    }
    // The drawings themselves are untouched.
    const { rows } = await db.query(`select count(*)::int as n from forge_work_drawings where id in ('dwg_1', 'dwg_2');`);
    expect(rows[0].n).toBe(2);
  });
});

describe("slice 5 migration: drawing-delete coordination", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("deleting a drawing retires permit annotations AND step links in the same transaction", async () => {
    const step1 = await createStep(db, OWNER_A, { packageId: "pkg_a", title: "Step one" });
    const step2 = await createStep(db, OWNER_A, { packageId: "pkg_a", title: "Step two" });
    const activeLink = await createLink(db, OWNER_A, { packageId: "pkg_a", stepId: step1.id, drawingId: "dwg_1" });
    const retiredLink = await createLink(db, OWNER_A, { packageId: "pkg_a", stepId: step2.id, drawingId: "dwg_1" });
    await retireLink(db, OWNER_A, retiredLink.id, { expectedVersion: 1, reason: "Wrong drawing" });
    const { rows: retiredLinkBefore } = await db.query(`
      select retired_at from forge_work_step_drawing_links where id = '${retiredLink.id}';
    `);
    const activeAnnotation = await createAnnotation(db, OWNER_A, {
      packageId: "pkg_a", targetKind: "drawing", drawingId: "dwg_1", label: "Permit A",
    });
    // An already-retired annotation (seeded directly): its retirement
    // stands, only the live drawing id is cleared.
    await db.exec(`
      insert into forge_work_permit_annotations
        (owner_id, id, work_package_id, target_kind, drawing_id, original_drawing_id,
         label, url, version, retired_at, retired_by, created_by, updated_by)
        values ('${OWNER_A}', 'ann_old', 'pkg_a', 'drawing', 'dwg_1', 'dwg_1',
                'Old permit', 'https://example.gov/permits/old', 2,
                now() - interval '1 day', '${OWNER_A}', '${OWNER_A}', '${OWNER_A}');
    `);
    const { rows: oldAnnBefore } = await db.query(`
      select retired_at from forge_work_permit_annotations where id = 'ann_old';
    `);

    const deleted = await deleteDrawing(db, OWNER_A, { packageId: "pkg_a", drawingId: "dwg_1" });
    expect(deleted.forge_work_permit_annotation_delete_drawing).toBe(true);

    // The drawing row is gone.
    const { rows: drawingRows } = await db.query(`select id from forge_work_drawings where id = 'dwg_1';`);
    expect(drawingRows).toHaveLength(0);

    // Active permit annotation: retired, detached, audited.
    const { rows: annRows } = await db.query(`
      select retired_at, drawing_id, original_drawing_id, version
      from forge_work_permit_annotations where id = '${activeAnnotation.id}';
    `);
    expect(annRows[0].retired_at).not.toBe(null);
    expect(annRows[0].drawing_id).toBe(null);
    expect(annRows[0].original_drawing_id).toBe("dwg_1");
    const { rows: annRevs } = await db.query(`
      select action from forge_work_permit_annotation_revisions
      where annotation_id = '${activeAnnotation.id}' order by version;
    `);
    expect(annRevs.map((r) => r.action)).toEqual(["create", "parent_drawing_deleted"]);

    // Already-retired annotation: retirement untouched, only detached.
    const { rows: oldAnnRows } = await db.query(`
      select retired_at, drawing_id, original_drawing_id, version
      from forge_work_permit_annotations where id = 'ann_old';
    `);
    expect(oldAnnRows[0].drawing_id).toBe(null);
    expect(oldAnnRows[0].original_drawing_id).toBe("dwg_1");
    expect(new Date(oldAnnRows[0].retired_at).getTime()).toBe(new Date(oldAnnBefore[0].retired_at).getTime());
    const { rows: oldAnnRevs } = await db.query(`
      select action from forge_work_permit_annotation_revisions
      where annotation_id = 'ann_old' order by version;
    `);
    expect(oldAnnRevs.map((r) => r.action)).toEqual(["parent_drawing_deleted"]);

    // Active step link: retired, detached, audited.
    const { rows: linkRows } = await db.query(`
      select retired_at, drawing_id, original_drawing_id, version
      from forge_work_step_drawing_links where id = '${activeLink.id}';
    `);
    expect(linkRows[0].retired_at).not.toBe(null);
    expect(linkRows[0].drawing_id).toBe(null);
    expect(linkRows[0].original_drawing_id).toBe("dwg_1");
    expect((await linkRevisionsFor(db, activeLink.id)).map((r) => r.action))
      .toEqual(["create", "parent_drawing_deleted"]);

    // Already-retired step link: retirement untouched, only detached.
    const { rows: retiredLinkRows } = await db.query(`
      select retired_at, drawing_id, original_drawing_id, version
      from forge_work_step_drawing_links where id = '${retiredLink.id}';
    `);
    expect(retiredLinkRows[0].drawing_id).toBe(null);
    expect(retiredLinkRows[0].original_drawing_id).toBe("dwg_1");
    expect(new Date(retiredLinkRows[0].retired_at).getTime())
      .toBe(new Date(retiredLinkBefore[0].retired_at).getTime());
    expect((await linkRevisionsFor(db, retiredLink.id)).map((r) => r.action))
      .toEqual(["create", "retire", "parent_drawing_deleted"]);

    // The steps themselves are untouched — still active, same order.
    const steps = await stepsFor(db, "pkg_a");
    expect(steps.map((s) => [s.title, s.sequence_no, s.retired_at !== null])).toEqual([
      ["Step one", 1, false],
      ["Step two", 2, false],
    ]);
  });

  it60("a failed drawing delete leaves the step links and the drawing untouched", async () => {
    // A takeoff line on dwg_2 blocks the delete (slice-3 guard).
    await db.exec(`
      insert into forge_work_takeoff_lines (owner_id, id, drawing_id, line_no)
        values ('${OWNER_A}', 'tl_1', 'dwg_2', 1);
    `);
    const step = await createStep(db, OWNER_A, { packageId: "pkg_a" });
    const link = await createLink(db, OWNER_A, { packageId: "pkg_a", stepId: step.id, drawingId: "dwg_2" });
    await expect(deleteDrawing(db, OWNER_A, { packageId: "pkg_a", drawingId: "dwg_2" }))
      .rejects.toThrow(/WPP3_DRAWING_HAS_LINES/);
    const { rows: linkRows } = await db.query(`
      select retired_at, drawing_id from forge_work_step_drawing_links where id = '${link.id}';
    `);
    expect(linkRows[0].retired_at).toBe(null);
    expect(linkRows[0].drawing_id).toBe("dwg_2");
    const { rows: drawingRows } = await db.query(`select id from forge_work_drawings where id = 'dwg_2';`);
    expect(drawingRows).toHaveLength(1);
    expect((await linkRevisionsFor(db, link.id)).map((r) => r.action)).toEqual(["create"]);
  });
});

describe("slice 5 migration: effective ACL matrix and default-privilege negative case", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  const TABLES = [
    "forge_work_steps",
    "forge_work_step_revisions",
    "forge_work_step_order",
    "forge_work_step_drawing_links",
    "forge_work_step_drawing_link_revisions",
  ];
  const RPCS = [
    "forge_work_step_create(text, text, text, text, text, integer, numeric, text, text, integer, text)",
    "forge_work_step_update(text, text, integer, text, text, text, integer, numeric, text, boolean, boolean, boolean, boolean, boolean, boolean, text)",
    "forge_work_step_reorder(text, text, text[], integer, text)",
    "forge_work_step_retire(text, text, integer, text, boolean)",
    "forge_work_step_link_drawing_create(text, text, text, text, text, text)",
    "forge_work_step_link_drawing_retire(text, text, integer, text)",
    "forge_work_permit_annotation_delete_drawing(text, text, text)",
  ];
  const HELPERS = [
    "forge_work_step_order_row(text, text)",
    "forge_work_step_apply_order(text, text, text[], text, text, text)",
  ];

  it60("authenticated has SELECT only; anon and service_role have nothing on all five tables", async () => {
    for (const table of TABLES) {
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

  it60("only authenticated may execute the RPCs; the internal helpers are not executable by anyone", async () => {
    for (const fn of RPCS) {
      const { rows } = await db.query(
        `select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') as ok;`,
      );
      expect(rows[0].ok).toBe(true);
      const { rows: publicRows } = await db.query(
        `select has_function_privilege('public', 'public.${fn}', 'EXECUTE') as ok;`,
      );
      expect(publicRows[0].ok).toBe(false);
    }
    for (const fn of HELPERS) {
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
      `select has_table_privilege('authenticated', 'public.forge_work_steps', 'INSERT') as ok;`,
    );
    expect(realRows[0].ok).toBe(false);
  });

  it60("the shipped migration text carries explicit REVOKEs for all five tables and all nine functions", async () => {
    const sql = loadMigrationSql(SLICE5);
    for (const table of TABLES) {
      expect(sql).toContain(`revoke insert, update, delete, truncate, references, trigger on ${table} from authenticated`);
      expect(sql).toContain(`revoke all on ${table} from anon`);
      expect(sql).toContain(`revoke all on ${table} from service_role`);
    }
    for (const fn of [...RPCS, ...HELPERS]) {
      expect(sql).toContain(`revoke all on function public.${fn} from public`);
    }
    expect(sql).toContain("force row level security");
  });
});

// Real-PostgreSQL subset. PGlite is single-connection, so the
// concurrent-reorder serialization leg can only run here, against a
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

describe.skipIf(!HAS_REAL_PG)("slice 5 migration: real-PostgreSQL subset", () => {
  let pgDir;
  let pgClient;
  let pgCfg;

  beforeAll(async () => {
    pgDir = mkdtempSync(join(tmpdir(), "wpp5-realpg-"));
    // The scratch cluster runs as an unprivileged user (initdb
    // refuses root); the data dir must belong to that user.
    execSync(`chown ${PG_RUN_USER}:${PG_RUN_USER} "${pgDir}"`, { stdio: "pipe" });
    const asPgUser = (cmd) => `runuser -u ${PG_RUN_USER} -- ${cmd}`;
    execSync(asPgUser(`"${PG_BIN}/initdb" -D "${pgDir}" -U postgres --auth=trust`), { stdio: "pipe" });
    execSync(
      asPgUser(`"${PG_BIN}/pg_ctl" -D "${pgDir}" -o "-p 55432 -k ${pgDir} -c listen_addresses=''" -l "${pgDir}/server.log" start`),
      { stdio: "pipe" },
    );
    pgCfg = { host: pgDir, port: 55432, user: "postgres", database: "postgres" };
    pgClient = new Client(pgCfg);
    await pgClient.connect();
    await pgClient.query(PREREQ_SQL);
    await pgClient.query(loadMigrationSql(SLICE3));
    await pgClient.query(loadMigrationSql(SLICE4));
    await pgClient.query(loadMigrationSql(SLICE5));
    await pgClient.query(`
      insert into forge_work_packages (owner_id, id, status) values
        ('${OWNER_A}', 'pkg_real', 'in_progress'),
        ('${OWNER_A}', 'pkg_real_coord', 'in_progress'),
        ('${OWNER_A}', 'pkg_real_rb', 'in_progress'),
        ('${OWNER_B}', 'pkg_real_b', 'in_progress');
      insert into forge_work_drawings (owner_id, package_id, id, drawing_number, drawing_type, title, p_id_drawing_id) values
        ('${OWNER_A}', 'pkg_real_coord', 'dwg_r1', 'P-301', 'p_id', 'Real line', null);
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

  async function pgCreateStep(uid, packageId, title) {
    const { rows } = await pgAsUser(pgClient, uid, `
      select * from forge_work_step_create(
        '${uid}', '${packageId}', '${title}', null, null, null, null, null, null, null, null);
    `);
    return rows[0];
  }

  async function pgCreateLink(uid, packageId, stepId, drawingId) {
    const { rows } = await pgAsUser(pgClient, uid, `
      select * from forge_work_step_link_drawing_create(
        '${OWNER_A}', '${packageId}', '${stepId}', '${drawingId}', null, null);
    `);
    return rows[0];
  }

  async function pgCreateAnnotation(uid, packageId, drawingId) {
    const { rows } = await pgAsUser(pgClient, uid, `
      select * from forge_work_permit_annotation_create(
        '${OWNER_A}', '${packageId}', 'drawing', '${drawingId}',
        'Permit R', 'https://example.gov/permits/r', null, null);
    `);
    return rows[0];
  }

  async function pgOrderGeneration(packageId) {
    const { rows } = await pgClient.query(`
      select generation from forge_work_step_order
      where owner_id = '${OWNER_A}' and work_package_id = '${packageId}';
    `);
    return rows[0]?.generation ?? null;
  }

  it60("drawing-delete coordination detaches step links on real PostgreSQL", async () => {
    const step = await pgCreateStep(OWNER_A, "pkg_real_coord", "Real step");
    const link = await pgCreateLink(OWNER_A, "pkg_real_coord", step.id, "dwg_r1");
    const ann = await pgCreateAnnotation(OWNER_A, "pkg_real_coord", "dwg_r1");
    const { rows: deleted } = await pgAsUser(pgClient, OWNER_A, `
      select * from forge_work_permit_annotation_delete_drawing(
        '${OWNER_A}', 'pkg_real_coord', 'dwg_r1');
    `);
    expect(deleted[0].forge_work_permit_annotation_delete_drawing).toBe(true);
    const { rows: linkRows } = await pgClient.query(`
      select retired_at, drawing_id, original_drawing_id
      from forge_work_step_drawing_links where id = '${link.id}';
    `);
    expect(linkRows[0].retired_at).not.toBe(null);
    expect(linkRows[0].drawing_id).toBe(null);
    expect(linkRows[0].original_drawing_id).toBe("dwg_r1");
    const { rows: annRows } = await pgClient.query(`
      select retired_at, drawing_id from forge_work_permit_annotations where id = '${ann.id}';
    `);
    expect(annRows[0].retired_at).not.toBe(null);
    expect(annRows[0].drawing_id).toBe(null);
    const { rows: drawingRows } = await pgClient.query(`select id from forge_work_drawings where id = 'dwg_r1';`);
    expect(drawingRows).toHaveLength(0);
    const { rows: stepRows } = await pgClient.query(`
      select retired_at from forge_work_steps where id = '${step.id}';
    `);
    expect(stepRows[0].retired_at).toBe(null);
  });

  it60("two concurrent reorders serialize: one wins, the other gets a version conflict", async () => {
    const s1 = await pgCreateStep(OWNER_A, "pkg_real", "S1");
    const s2 = await pgCreateStep(OWNER_A, "pkg_real", "S2");
    expect(await pgOrderGeneration("pkg_real")).toBe(2);
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      await clientA.query(`set role authenticated; set app.test_uid = '${OWNER_A}';`);
      await clientB.query(`set role authenticated; set app.test_uid = '${OWNER_A}';`);
      // A takes the order-row lock first (its reorder completes while
      // its transaction stays open); B's reorder then blocks on the
      // same lock until A commits.
      await clientA.query("begin");
      const rowsA = await clientA.query(`
        select * from forge_work_step_reorder(
          '${OWNER_A}', 'pkg_real', array['${s2.id}', '${s1.id}'], 2, null);
      `);
      expect(rowsA.rows.map((r) => r.id)).toEqual([s2.id, s1.id]);
      await clientB.query("begin");
      const pB = clientB.query(`
        select * from forge_work_step_reorder(
          '${OWNER_A}', 'pkg_real', array['${s1.id}', '${s2.id}'], 2, null);
      `);
      pB.catch(() => {});
      await clientA.query("commit");
      await expect(pB).rejects.toThrow(/WPP5_VERSION_CONFLICT/);
      await clientB.query("rollback");
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
    expect(await pgOrderGeneration("pkg_real")).toBe(3);
    const { rows } = await pgClient.query(`
      select id from forge_work_steps
      where work_package_id = 'pkg_real' and retired_at is null order by sequence_no;
    `);
    expect(rows.map((r) => r.id)).toEqual([s2.id, s1.id]);
  });

  it60("effective ACL matrix holds on real PostgreSQL", async () => {
    for (const table of [
      "forge_work_steps", "forge_work_step_revisions", "forge_work_step_order",
      "forge_work_step_drawing_links", "forge_work_step_drawing_link_revisions",
    ]) {
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        const { rows } = await pgClient.query(
          `select has_table_privilege('authenticated', 'public.${table}', '${priv}') as ok;`,
        );
        expect(rows[0].ok).toBe(priv === "SELECT");
        const { rows: anonRows } = await pgClient.query(
          `select has_table_privilege('anon', 'public.${table}', '${priv}') as ok;`,
        );
        expect(anonRows[0].ok).toBe(false);
      }
    }
    const { rows } = await pgClient.query(`
      select has_function_privilege('authenticated',
        'public.forge_work_step_reorder(text, text, text[], integer, text)', 'EXECUTE') as ok;
    `);
    expect(rows[0].ok).toBe(true);
    const { rows: helperRows } = await pgClient.query(`
      select has_function_privilege('authenticated',
        'public.forge_work_step_apply_order(text, text, text[], text, text, text)', 'EXECUTE') as ok;
    `);
    expect(helperRows[0].ok).toBe(false);
  });

  it60("a rolled-back transaction leaves no step and no revision on real PostgreSQL", async () => {
    const c = new Client(pgCfg);
    await c.connect();
    try {
      await c.query(`set role authenticated; set app.test_uid = '${OWNER_A}';`);
      await c.query("begin");
      await c.query(`
        select * from forge_work_step_create(
          '${OWNER_A}', 'pkg_real_rb', 'Rolled back', null, null, null, null, null, null, null, null);
      `);
      await c.query("rollback");
    } finally {
      await c.end();
    }
    const { rows } = await pgClient.query(`
      select count(*)::int as n from forge_work_steps where work_package_id = 'pkg_real_rb';
    `);
    expect(rows[0].n).toBe(0);
    // No revision may survive for a step that never committed (join
    // through the step rows: revisions carry no package id of their
    // own, and other tests in this cluster wrote revisions elsewhere).
    const { rows: revRows } = await pgClient.query(`
      select count(*)::int as n from forge_work_step_revisions r
      join forge_work_steps s on s.id = r.step_id and s.owner_id = r.owner_id
      where s.work_package_id = 'pkg_real_rb';
    `);
    expect(revRows[0].n).toBe(0);
  });
});
