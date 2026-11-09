// Work Package Planner slice 7 — migration/integration proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) and proves:
//   - CHECKs/FKs: anchor bounds, severity/resolution discipline, the
//     REQUIRED-needs-note rule, the partial-unique single OPEN review
//     per revision, one ACTIVE IFC release per drawing, revision-code
//     uniqueness, idempotency unique keys;
//   - RLS: owner isolation, co-owner access, unrelated owner sees
//     nothing, anon sees nothing, direct writes denied (RPC-only
//     write path);
//   - RPCs: the full IFA → review → redlines → decision → IFC release
//     lifecycle, idempotency replay, version guards, the stale-review
//     and open-review guards on IFC release, field hand-redline
//     capture/reconciliation (never construction-usable), retire
//     (cancels OPEN reviews, retires the ACTIVE release), and the
//     readiness snapshot badges at every stage;
//   - Delete coordination: a drawing WITH slice-7 history is RETIRED
//     by the slice-5 delete RPC replacement (never physically
//     deleted); a drawing WITHOUT history keeps exact slice-5
//     behavior (physical delete + step-link/annotation cleanup);
//   - Atomic audit: a failed decision leaves no review event;
//   - Effective ACL matrix for authenticated/anon/service_role, and
//     the default-privilege negative case: a selective GRANT alone
//     does NOT revoke an already-effective broad privilege, which is
//     why the migration's explicit REVOKEs are load-bearing;
//   - Reapply: the migration applies cleanly a second time (idempotent
//     DDL), and applies cleanly WITHOUT slice 6 present — slice 7
//     references no slice-6 object, so its timestamp order against
//     20261107030000 is safe either way.
// Roles, the auth.uid() stub, workspace_members, and the
// has_workspace_access() copy mirror production as redefined by R17
// (20261001060000_r17_roles_granular_permissions.sql): any active
// member, not just owner/co-owner — which is why the decide RPC must
// validate owner/co-owner status itself instead of relying on it; the
// prerequisite packages/drawings/takeoff-lines tables are minimal
// shapes with the exact keys the slice-3/4/5 foreign keys reference,
// plus the status column the terminal-package rule reads.
//
// A real-PostgreSQL subset (full lifecycle, ACL matrix, delete
// coordination, reapply) runs against a scratch PG16 cluster when the
// binaries exist, and SKIPS LOUDLY — never silently — when they do
// not. PGlite is single-connection, so it cannot prove concurrent
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
const MEMBER_D = "44444444-4444-4444-8444-444444444444";
const MEMBER_M = "55555555-5555-4555-8555-555555555555";

const SLICE3 = "20261107000000_forge_work_package_permit_annotations_slice3.sql";
const SLICE4 = "20261107010000_forge_work_package_craft_assignments_slice4.sql";
const SLICE5 = "20261107020000_forge_work_package_work_steps_slice5.sql";
const SLICE7 = "20261107040000_forge_work_package_ifa_ifc_slice7.sql";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

function loadMigrationSql(name) {
  return readFileSync(join(HERE, "..", "..", "..", "supabase", "migrations", name), "utf8");
}

// Minimal prerequisite shape with the exact keys the slice-3/4/5
// foreign keys reference, plus the status column the terminal-package
// rule reads and the drawing columns the delete RPC and the step
// link display read. Identical to the slice-5 test's prereq.
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
  -- Production grants the app role SELECT on the pre-existing
  -- packages/drawings tables (their own migrations own those grants);
  -- the minimal prereq must state them, because the slice-7 readiness
  -- snapshot is SECURITY INVOKER and reads them as the caller.
  grant select on forge_work_packages to authenticated;
  grant select on forge_work_drawings to authenticated;
  grant select on forge_work_takeoff_lines to authenticated;
`;

const SEED_SQL = `
  insert into forge_work_packages (owner_id, id, status) values
    ('${OWNER_A}', 'pkg_a', 'in_progress'),
    ('${OWNER_A}', 'pkg_cancelled', 'cancelled'),
    ('${OWNER_A}', 'pkg_closed', 'verified_closed'),
    ('${OWNER_B}', 'pkg_b', 'in_progress');
  insert into forge_work_drawings (owner_id, package_id, id, drawing_number, drawing_type, title, p_id_drawing_id) values
    ('${OWNER_A}', 'pkg_a', 'dwg_1', 'P-101', 'p_id', 'Main line', null),
    ('${OWNER_A}', 'pkg_a', 'dwg_2', 'C-201', 'cut_sheet', 'Spool sheet', null),
    ('${OWNER_A}', 'pkg_a', 'dwg_3', 'P-102', 'p_id', 'Second line', null),
    ('${OWNER_A}', 'pkg_cancelled', 'dwg_c1', 'P-901', 'p_id', 'Cancelled line', null);
  insert into workspace_members (owner_id, member_user_id, status, role)
    values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
`;

async function setupDb() {
  const db = new PGlite();
  await db.exec(PREREQ_SQL);
  // Slice 3 (permit tables + the delete RPC slice 5/7 replace), then
  // slice 4 (the craft-normalize helper slice 5 reuses), then slice
  // 5 (steps + links), then slice 7. Slice 6 is deliberately NOT
  // applied: slice 7 references no slice-6 object, and this setup
  // proves the migration is safe whether or not slice 6 is applied.
  await db.exec(loadMigrationSql(SLICE3));
  await db.exec(loadMigrationSql(SLICE4));
  await db.exec(loadMigrationSql(SLICE5));
  await db.exec(loadMigrationSql(SLICE7));
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

async function createRevision(db, uid, { ownerId, packageId, drawingId, code, docRef, sha }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_wp_drawing_revision_create(
      '${ownerId ?? OWNER_A}', '${packageId}', '${drawingId}',
      '${code}', ${sqlStr(docRef ?? "s3://forge/dwg.pdf")}, '${sha}');
  `);
  return rows[0];
}

async function createReview(db, uid, { ownerId, packageId, drawingId, revisionId, reviewerId, key, reason }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_wp_drawing_review_create(
      '${ownerId ?? OWNER_A}', '${packageId}', '${drawingId}', '${revisionId}',
      ${sqlStr(reviewerId ?? null)}, ${sqlStr(key ?? null)}, ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function createRedline(db, uid, { ownerId, reviewId, revisionId, comment, severity, stepId, page, x, y, anchorText, key }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_wp_drawing_redline_create(
      '${ownerId ?? OWNER_A}', '${reviewId}', '${revisionId}',
      ${sqlStr(comment ?? "Move this nozzle.")}, '${severity ?? "REQUIRED"}',
      ${sqlStr(stepId ?? null)}, ${sqlNum(page ?? null)}, ${sqlNum(x ?? null)},
      ${sqlNum(y ?? null)}, ${sqlStr(anchorText ?? null)}, ${sqlStr(key ?? null)});
  `);
  return rows[0];
}

async function resolveRedline(db, uid, { ownerId, redlineId, expectedVersion, resolution, note, retire, reason }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_wp_drawing_redline_resolve(
      '${ownerId ?? OWNER_A}', '${redlineId}', ${sqlNum(expectedVersion)},
      '${resolution}', ${sqlStr(note ?? null)},
      ${retire === true ? "true" : "false"}, ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function decideReview(db, uid, { ownerId, reviewId, expectedVersion, decision, reason }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_wp_drawing_review_decide(
      '${ownerId ?? OWNER_A}', '${reviewId}', ${sqlNum(expectedVersion)},
      '${decision}', ${sqlStr(reason)});
  `);
  return rows[0];
}

async function createIfcRelease(db, uid, { ownerId, packageId, drawingId, reviewId, code, docRef, sha, reason }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_wp_drawing_ifc_release(
      '${ownerId ?? OWNER_A}', '${packageId}', '${drawingId}', '${reviewId}',
      '${code}', ${sqlStr(docRef ?? "s3://forge/ifc.pdf")}, '${sha}', ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function createFieldRedline(db, uid, { ownerId, packageId, drawingId, revisionId, artifactRef, sha, fieldReason, reviewId }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_wp_drawing_field_redline_create(
      '${ownerId ?? OWNER_A}', '${packageId}', '${drawingId}', '${revisionId}',
      ${sqlStr(artifactRef ?? "s3://forge/field/scan.pdf")}, '${sha}',
      ${sqlStr(fieldReason ?? "Hand-marked on site.")}, ${sqlStr(reviewId ?? null)});
  `);
  return rows[0];
}

async function reconcileFieldRedline(db, uid, { ownerId, fieldRedlineId, reconciledRevisionId, reason }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_wp_drawing_field_redline_reconcile(
      '${ownerId ?? OWNER_A}', '${fieldRedlineId}',
      ${sqlStr(reconciledRevisionId ?? null)}, ${sqlStr(reason ?? null)});
  `);
  return rows[0];
}

async function retireDrawingRpc(db, uid, { ownerId, packageId, drawingId, reason }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_wp_drawing_retire(
      '${ownerId ?? OWNER_A}', '${packageId}', '${drawingId}', ${sqlStr(reason)});
  `);
  return rows[0];
}

async function snapshot(db, uid, { ownerId, packageId }) {
  const { rows } = await asUser(db, uid, `
    select forge_wp_drawing_readiness_snapshot('${ownerId ?? OWNER_A}', '${packageId}');
  `);
  return rows[0].forge_wp_drawing_readiness_snapshot;
}

async function deleteDrawing(db, uid, { ownerId, packageId, drawingId }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_permit_annotation_delete_drawing(
      '${ownerId ?? OWNER_A}', '${packageId}', '${drawingId}');
  `);
  return rows[0];
}

async function eventsFor(db, reviewId) {
  const { rows } = await db.query(`
    select event_type, before_state, after_state
    from forge_wp_drawing_review_events
    where review_id = '${reviewId}' order by occurred_at, id;
  `);
  return rows;
}

async function badgeFor(db, packageId, drawingId) {
  const snap = await snapshot(db, OWNER_A, { packageId });
  const row = snap.drawings.find((d) => d.drawing_id === drawingId);
  return row ? { badge: row.badge, constructionUsable: row.construction_usable } : null;
}

describe("slice 7 migration: schema constraints", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("rejects an anchor outside 0..1 and a bad severity at the CHECK level", async () => {
    const revision = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "A", sha: SHA_A,
    });
    const review = await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revision.id,
    });
    await expect(createRedline(db, OWNER_A, {
      reviewId: review.id, revisionId: revision.id, x: 1.5,
    })).rejects.toThrow(/WPP7_INVALID_ANCHOR/);
    await expect(createRedline(db, OWNER_A, {
      reviewId: review.id, revisionId: revision.id, severity: "BLOCKER",
    })).rejects.toThrow(/WPP7_INVALID_SEVERITY/);
    await expect(db.query(`
      insert into forge_wp_drawing_redlines
        (owner_id, id, package_id, drawing_id, review_id, drawing_revision_id,
         comment, severity, resolution, version, created_by)
        values ('${OWNER_A}', 'forge_wpdrl_bad', 'pkg_a', 'dwg_1', '${review.id}',
          '${revision.id}', 'x', 'REQUIRED', 'BOGUS', 1, 'u');
    `)).rejects.toThrow(/check constraint/i);
  });

  it60("rejects a non-OPEN resolution on a REQUIRED redline without a note", async () => {
    const revision = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "A", sha: SHA_A,
    });
    const review = await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revision.id,
    });
    const redline = await createRedline(db, OWNER_A, {
      reviewId: review.id, revisionId: revision.id, severity: "REQUIRED",
    });
    await expect(resolveRedline(db, OWNER_A, {
      redlineId: redline.id, expectedVersion: 1, resolution: "RESOLVED",
    })).rejects.toThrow(/WPP7_RESOLUTION_NOTE_REQUIRED/);
    const resolved = await resolveRedline(db, OWNER_A, {
      redlineId: redline.id, expectedVersion: 1, resolution: "RESOLVED", note: "Moved.",
    });
    expect(resolved.resolution).toBe("RESOLVED");
    expect(resolved.resolution_note).toBe("Moved.");
  });

  it60("enforces one OPEN review per revision and unique revision codes", async () => {
    const revision = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "A", sha: SHA_A,
    });
    await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revision.id,
    });
    await expect(createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revision.id,
    })).rejects.toThrow(/WPP7_DUPLICATE_OPEN_REVIEW/);
    await expect(createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "A", sha: SHA_B,
    })).rejects.toThrow(/WPP7_DUPLICATE_REVISION/);
    // A second revision with a different code is fine.
    const revisionB = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "B", sha: SHA_B,
    });
    expect(revisionB.revision_code).toBe("B");
    expect(revisionB.issued_as).toBe("IFA");
  });

  it60("rejects a redline whose revision belongs to another review", async () => {
    const revisionA = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "A", sha: SHA_A,
    });
    const revisionB = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "B", sha: SHA_B,
    });
    const review = await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revisionA.id,
    });
    await expect(createRedline(db, OWNER_A, {
      reviewId: review.id, revisionId: revisionB.id,
    })).rejects.toThrow(/WPP7_REVISION_MISMATCH/);
  });

  it60("applies cleanly a second time and without slice 6 present", async () => {
    // setupDb already proves the no-slice-6 apply. Re-apply the
    // shipped file: idempotent DDL (IF NOT EXISTS / OR REPLACE /
    // DROP POLICY IF EXISTS) must not fail, and the RPCs still work.
    await db.exec(loadMigrationSql(SLICE7));
    const revision = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "A", sha: SHA_A,
    });
    expect(revision.revision_code).toBe("A");
    const snap = await snapshot(db, OWNER_A, { packageId: "pkg_a" });
    expect(snap.counts.drawingsTotal).toBe(3);
  });
});

describe("slice 7 migration: RLS and direct-write denial", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("owner and co-owner read rows; unrelated owner and anon see nothing", async () => {
    const revision = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "A", sha: SHA_A,
    });
    const ownerRows = await asUser(db, OWNER_A, `
      select id from forge_wp_drawing_revisions where id = '${revision.id}';`);
    expect(ownerRows.rows).toHaveLength(1);
    const coOwnerRows = await asUser(db, MEMBER_C, `
      select id from forge_wp_drawing_revisions where id = '${revision.id}';`);
    expect(coOwnerRows.rows).toHaveLength(1);
    const strangerRows = await asUser(db, OWNER_B, `
      select id from forge_wp_drawing_revisions where id = '${revision.id}';`);
    expect(strangerRows.rows).toHaveLength(0);
    await expect(asRole(db, "anon", OWNER_B, `
      select id from forge_wp_drawing_revisions where id = '${revision.id}';`))
      .rejects.toThrow(/permission denied/i);
  });

  it60("direct INSERT/UPDATE/DELETE are denied for authenticated; writes go through RPCs only", async () => {
    await expect(asUser(db, OWNER_A, `
      insert into forge_wp_drawing_revisions
        (owner_id, id, package_id, drawing_id, revision_code, document_ref, content_sha256, issued_as, created_by)
        values ('${OWNER_A}', 'forge_wpdrv_direct', 'pkg_a', 'dwg_1', 'Z', 's3://forge/z.pdf', '${SHA_A}', 'IFA', 'u');
    `)).rejects.toThrow(/row-level security|permission denied/i);
    const revision = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "A", sha: SHA_A,
    });
    await expect(asUser(db, OWNER_A, `
      update forge_wp_drawing_revisions set revision_code = 'Z' where id = '${revision.id}';
    `)).rejects.toThrow(/row-level security|permission denied/i);
    await expect(asUser(db, OWNER_A, `
      delete from forge_wp_drawing_revisions where id = '${revision.id}';
    `)).rejects.toThrow(/row-level security|permission denied/i);
  });

  it60("a caller outside the workspace cannot open a review or read the snapshot", async () => {
    const revision = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "A", sha: SHA_A,
    });
    await expect(createReview(db, OWNER_B, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revision.id,
    })).rejects.toThrow(/WPP7_WORKSPACE_FORBIDDEN/);
    await expect(snapshot(db, OWNER_B, { packageId: "pkg_a" }))
      .rejects.toThrow(/WPP7_WORKSPACE_FORBIDDEN/);
    await expect(snapshot(db, OWNER_A, { packageId: "pkg_missing" }))
      .rejects.toThrow(/WPP7_PACKAGE_NOT_FOUND/);
  });

  it60("a forged actor (no authenticated uid) cannot call a write RPC", async () => {
    // app.test_uid is never set in this fresh database, so auth.uid()
    // returns NULL and the RPC must raise WPP7_INVALID_ACTOR itself.
    // (Do NOT RESET the setting here: RESET leaves an empty string,
    // whose ::uuid cast raises before the RPC's own actor check.)
    await db.exec(`set role authenticated;`);
    try {
      await expect(db.query(`
        select * from forge_wp_drawing_revision_create(
          '${OWNER_A}', 'pkg_a', 'dwg_1', 'A', 's3://forge/a.pdf', '${SHA_A}');
      `)).rejects.toThrow(/WPP7_INVALID_ACTOR/);
    } finally {
      await db.exec(`reset role;`);
    }
  });
});

describe("slice 7 migration: lifecycle", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  async function openReviewedDrawing({ drawingId = "dwg_1", packageId = "pkg_a" } = {}) {
    const revision = await createRevision(db, OWNER_A, {
      packageId, drawingId, code: "A", sha: SHA_A,
    });
    const review = await createReview(db, OWNER_A, {
      packageId, drawingId, revisionId: revision.id,
    });
    return { revision, review };
  }

  it60("runs IFA → review → redlines → approve → IFC release, and the snapshot badge follows each stage", async () => {
    expect(await badgeFor(db, "pkg_a", "dwg_1")).toEqual({ badge: "No issued revision", constructionUsable: false });
    const { revision, review } = await openReviewedDrawing();
    expect(review.round_no).toBe(1);
    expect(review.state).toBe("OPEN");
    expect(await badgeFor(db, "pkg_a", "dwg_1")).toEqual({ badge: "IFA — In review", constructionUsable: false });

    const redline = await createRedline(db, OWNER_A, {
      reviewId: review.id, revisionId: revision.id,
      comment: "Move this nozzle 50 mm up.", severity: "REQUIRED", page: 2, x: 0.5, y: 0.25,
    });
    expect(redline.resolution).toBe("OPEN");

    // Approve is blocked while any redline is open.
    await expect(decideReview(db, OWNER_A, {
      reviewId: review.id, expectedVersion: 1, decision: "APPROVE", reason: "Checked.",
    })).rejects.toThrow(/WPP7_OPEN_REDLINES/);
    // Approve-with-redlines is blocked only while a REQUIRED redline is open.
    await expect(decideReview(db, OWNER_A, {
      reviewId: review.id, expectedVersion: 1, decision: "APPROVE_WITH_REDLINES", reason: "Checked.",
    })).rejects.toThrow(/WPP7_OPEN_REQUIRED_REDLINES/);

    await resolveRedline(db, OWNER_A, {
      redlineId: redline.id, expectedVersion: 1, resolution: "RESOLVED", note: "Moved.",
    });
    const decided = await decideReview(db, OWNER_A, {
      reviewId: review.id, expectedVersion: 1, decision: "APPROVE", reason: "Checked against the P&ID.",
    });
    expect(decided.state).toBe("APPROVED");
    expect(await badgeFor(db, "pkg_a", "dwg_1")).toEqual({ badge: "IFA — Approved; IFC not issued", constructionUsable: false });

    // Approval alone never makes the drawing construction-usable.
    const snapBefore = await snapshot(db, OWNER_A, { packageId: "pkg_a" });
    expect(snapBefore.counts.ifcReleased).toBe(0);

    const release = await createIfcRelease(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", reviewId: review.id,
      code: "C", sha: SHA_C, reason: "Issued for construction.",
    });
    expect(release.ifc_revision_id).toBeTruthy();
    const { rows: ifcRevision } = await db.query(`
      select revision_code, issued_as from forge_wp_drawing_revisions where id = '${release.ifc_revision_id}';
    `);
    expect(ifcRevision[0]).toEqual({ revision_code: "C", issued_as: "IFC" });
    expect(await badgeFor(db, "pkg_a", "dwg_1")).toEqual({ badge: "IFC — Issued for construction", constructionUsable: true });
    const snapAfter = await snapshot(db, OWNER_A, { packageId: "pkg_a" });
    expect(snapAfter.counts.ifcReleased).toBe(1);
  });

  it60("approve-with-redlines allows open INFO redlines but not open REQUIRED ones", async () => {
    const { revision, review } = await openReviewedDrawing();
    const info = await createRedline(db, OWNER_A, {
      reviewId: review.id, revisionId: revision.id, comment: "Nit: label font.", severity: "INFO",
    });
    const decided = await decideReview(db, OWNER_A, {
      reviewId: review.id, expectedVersion: 1, decision: "APPROVE_WITH_REDLINES", reason: "Minor nits noted.",
    });
    expect(decided.state).toBe("APPROVED_WITH_REDLINES");
    // The open INFO redline stays open on the closed round.
    const { rows } = await db.query(`select resolution from forge_wp_drawing_redlines where id = '${info.id}';`);
    expect(rows[0].resolution).toBe("OPEN");
  });

  it60("return to drafter is always allowed and reopening starts a new round", async () => {
    const { revision, review } = await openReviewedDrawing();
    await createRedline(db, OWNER_A, {
      reviewId: review.id, revisionId: revision.id, comment: "Wrong size.", severity: "REQUIRED",
    });
    const returned = await decideReview(db, OWNER_A, {
      reviewId: review.id, expectedVersion: 1, decision: "RETURN_TO_DRAFTER", reason: "Resize the line.",
    });
    expect(returned.state).toBe("RETURNED");
    expect(await badgeFor(db, "pkg_a", "dwg_1")).toEqual({ badge: "IFA — Returned to drafter", constructionUsable: false });
    // Closed rounds are immutable: no more redlines, no second decision.
    await expect(createRedline(db, OWNER_A, {
      reviewId: review.id, revisionId: revision.id, comment: "Late note.", severity: "INFO",
    })).rejects.toThrow(/WPP7_REVIEW_CLOSED/);
    await expect(decideReview(db, OWNER_A, {
      reviewId: review.id, expectedVersion: 2, decision: "APPROVE", reason: "Changed my mind.",
    })).rejects.toThrow(/WPP7_REVIEW_CLOSED/);
    // Reopen = a new round on the new revision. Rounds are numbered
    // per revision (the unique key is owner+revision+round), so the
    // first round on revision B is round 1 — a new round, not a
    // reopened round 1.
    const revisionB = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "B", sha: SHA_B,
    });
    const round2 = await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revisionB.id,
    });
    expect(round2.id).not.toBe(review.id);
    expect(round2.round_no).toBe(1);
    expect(round2.state).toBe("OPEN");
  });

  it60("idempotency keys replay the original review and redline", async () => {
    const { revision } = await openReviewedDrawing();
    // Close round 1 first (a second OPEN review on the same revision
    // is refused); then the keyed create + retry must replay.
    const { rows: openReviews } = await db.query(`
      select id, version from forge_wp_drawing_reviews
      where drawing_id = 'dwg_1' and state = 'OPEN' order by round_no desc limit 1;
    `);
    await decideReview(db, OWNER_A, {
      reviewId: openReviews[0].id, expectedVersion: openReviews[0].version,
      decision: "RETURN_TO_DRAFTER", reason: "Reset for the idempotency check.",
    });
    const round2a = await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revision.id,
      key: "review-key-1", reason: "First attempt.",
    });
    const round2b = await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revision.id,
      key: "review-key-1", reason: "Retry after a timeout.",
    });
    expect(round2b.id).toBe(round2a.id);
    expect(round2b.round_no).toBe(round2a.round_no);

    const redlineA = await createRedline(db, OWNER_A, {
      reviewId: round2a.id, revisionId: revision.id,
      comment: "Same note twice.", severity: "INFO", key: "redline-key-1",
    });
    const redlineB = await createRedline(db, OWNER_A, {
      reviewId: round2a.id, revisionId: revision.id,
      comment: "Same note twice.", severity: "INFO", key: "redline-key-1",
    });
    expect(redlineB.id).toBe(redlineA.id);
    const { rows: redlineRows } = await db.query(`
      select count(*)::integer as n from forge_wp_drawing_redlines
      where review_id = '${round2a.id}' and idempotency_key = 'redline-key-1';
    `);
    expect(redlineRows[0].n).toBe(1);
  });

  it60("idempotency keys are bound to their target and payload", async () => {
    const { revision, review } = await openReviewedDrawing();
    const revisionB = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "B", sha: SHA_B,
    });
    // A review key replayed for a different revision is refused.
    const roundB = await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revisionB.id,
      key: "bound-review-1", reason: "First.",
    });
    await expect(createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revision.id,
      key: "bound-review-1", reason: "Same key, other revision.",
    })).rejects.toThrow(/WPP7_IDEMPOTENCY_CONFLICT/);
    // Same revision, different designated reviewer: refused.
    await expect(createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revisionB.id,
      reviewerId: MEMBER_C, key: "bound-review-1", reason: "Same key, other reviewer.",
    })).rejects.toThrow(/WPP7_IDEMPOTENCY_CONFLICT/);
    // Same key, same target and reviewer: replays (a reworded reason
    // is free text and does not break the replay).
    const replay = await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revisionB.id,
      key: "bound-review-1", reason: "Retry after a timeout.",
    });
    expect(replay.id).toBe(roundB.id);

    // Redlines: same key, different content is refused.
    const redlineA = await createRedline(db, OWNER_A, {
      reviewId: review.id, revisionId: revision.id,
      comment: "Move this nozzle.", severity: "REQUIRED", key: "bound-redline-1",
    });
    await expect(createRedline(db, OWNER_A, {
      reviewId: review.id, revisionId: revision.id,
      comment: "Different note.", severity: "REQUIRED", key: "bound-redline-1",
    })).rejects.toThrow(/WPP7_IDEMPOTENCY_CONFLICT/);
    await expect(createRedline(db, OWNER_A, {
      reviewId: review.id, revisionId: revision.id,
      comment: "Move this nozzle.", severity: "INFO", key: "bound-redline-1",
    })).rejects.toThrow(/WPP7_IDEMPOTENCY_CONFLICT/);
    await expect(createRedline(db, OWNER_A, {
      reviewId: review.id, revisionId: revision.id,
      comment: "Move this nozzle.", severity: "REQUIRED", page: 3, x: 0.1, y: 0.1,
      key: "bound-redline-1",
    })).rejects.toThrow(/WPP7_IDEMPOTENCY_CONFLICT/);
    await expect(createRedline(db, OWNER_A, {
      reviewId: roundB.id, revisionId: revisionB.id,
      comment: "Move this nozzle.", severity: "REQUIRED", key: "bound-redline-1",
    })).rejects.toThrow(/WPP7_IDEMPOTENCY_CONFLICT/);
    // Same key, same payload: replays — even after the review closes.
    const redlineB = await createRedline(db, OWNER_A, {
      reviewId: review.id, revisionId: revision.id,
      comment: "Move this nozzle.", severity: "REQUIRED", key: "bound-redline-1",
    });
    expect(redlineB.id).toBe(redlineA.id);
    await decideReview(db, OWNER_A, {
      reviewId: review.id, expectedVersion: 1, decision: "RETURN_TO_DRAFTER", reason: "Reset.",
    });
    const redlineC = await createRedline(db, OWNER_A, {
      reviewId: review.id, revisionId: revision.id,
      comment: "Move this nozzle.", severity: "REQUIRED", key: "bound-redline-1",
    });
    expect(redlineC.id).toBe(redlineA.id);
    const { rows: redlineRows } = await db.query(`
      select count(*)::integer as n from forge_wp_drawing_redlines
      where idempotency_key = 'bound-redline-1';
    `);
    expect(redlineRows[0].n).toBe(1);
  });

  it60("separation of duties: the round opener cannot decide when a different reviewer is assigned", async () => {
    const { revision, review } = await openReviewedDrawing();
    // No designated reviewer: the single-owner flow is unchanged —
    // the opener decides.
    const decided = await decideReview(db, OWNER_A, {
      reviewId: review.id, expectedVersion: 1, decision: "RETURN_TO_DRAFTER", reason: "Reset for the SoD check.",
    });
    expect(decided.state).toBe("RETURNED");
    // Round 2 with a designated reviewer (the co-owner MEMBER_C).
    const round2 = await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revision.id, reviewerId: MEMBER_C,
    });
    // The opener may not decide their own round now.
    await expect(decideReview(db, OWNER_A, {
      reviewId: round2.id, expectedVersion: 1, decision: "APPROVE", reason: "Checked.",
    })).rejects.toThrow(/WPP7_DECISION_FORBIDDEN/);
    // The designated reviewer decides.
    const decided2 = await decideReview(db, MEMBER_C, {
      reviewId: round2.id, expectedVersion: 1, decision: "APPROVE", reason: "Checked by the reviewer.",
    });
    expect(decided2.state).toBe("APPROVED");
    expect(decided2.closed_by).toBe(MEMBER_C);
    // The opener designating themself as reviewer is still allowed
    // to decide.
    const round3 = await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revision.id, reviewerId: OWNER_A,
    });
    const decided3 = await decideReview(db, OWNER_A, {
      reviewId: round3.id, expectedVersion: 1, decision: "RETURN_TO_DRAFTER", reason: "Self-designated.",
    });
    expect(decided3.state).toBe("RETURNED");
  });

  // Fix round 2 (P1): decision authority is explicit — the
  // designated reviewer, the opener (single-owner flow), or an
  // owner/co-owner. An unrelated workspace member (a manager here)
  // may not decide, even though has_workspace_access admits every
  // active member since R17.
  it60("decision authority: only the designated reviewer, the opener, or an owner/co-owner may decide", async () => {
    await db.query(`
      insert into workspace_members (owner_id, member_user_id, status, role) values
        ('${OWNER_A}', '${MEMBER_D}', 'active', 'co_owner'),
        ('${OWNER_A}', '${MEMBER_M}', 'active', 'manager');
    `);
    const { revision, review } = await openReviewedDrawing();
    // Close round 1 first: one OPEN review per revision.
    await decideReview(db, OWNER_A, {
      reviewId: review.id, expectedVersion: 1, decision: "RETURN_TO_DRAFTER", reason: "Reset for the authority check.",
    });
    // Round 2 with a designated reviewer (the co-owner MEMBER_C),
    // opened by the owner.
    const round2 = await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revision.id, reviewerId: MEMBER_C,
    });
    // An unrelated workspace member may not decide.
    await expect(decideReview(db, MEMBER_M, {
      reviewId: round2.id, expectedVersion: 1, decision: "APPROVE", reason: "Not my call.",
    })).rejects.toThrow(/WPP7_DECISION_FORBIDDEN/);
    // A second co-owner — neither opener nor designated reviewer —
    // may decide.
    const decided2 = await decideReview(db, MEMBER_D, {
      reviewId: round2.id, expectedVersion: 1, decision: "APPROVE", reason: "Checked as co-owner.",
    });
    expect(decided2.state).toBe("APPROVED");
    expect(decided2.closed_by).toBe(MEMBER_D);
    // No designated reviewer: the opener decides, an owner/co-owner
    // may also decide, but an unrelated member may not.
    const round3 = await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revision.id,
    });
    await expect(decideReview(db, MEMBER_M, {
      reviewId: round3.id, expectedVersion: 1, decision: "APPROVE", reason: "Not my call.",
    })).rejects.toThrow(/WPP7_DECISION_FORBIDDEN/);
    const decided3 = await decideReview(db, MEMBER_D, {
      reviewId: round3.id, expectedVersion: 1, decision: "RETURN_TO_DRAFTER", reason: "Checked as co-owner.",
    });
    expect(decided3.state).toBe("RETURNED");
    // A round opened by a co-owner with no designated reviewer: the
    // opener decides, an unrelated member may not.
    const round4 = await createReview(db, MEMBER_C, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revision.id,
    });
    await expect(decideReview(db, MEMBER_M, {
      reviewId: round4.id, expectedVersion: 1, decision: "APPROVE", reason: "Not my call.",
    })).rejects.toThrow(/WPP7_DECISION_FORBIDDEN/);
    const decided4 = await decideReview(db, MEMBER_C, {
      reviewId: round4.id, expectedVersion: 1, decision: "RETURN_TO_DRAFTER", reason: "Opened it myself.",
    });
    expect(decided4.state).toBe("RETURNED");
    // The primary owner may decide a round opened by someone else
    // when no independent reviewer was designated.
    const round5 = await createReview(db, MEMBER_C, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revision.id,
    });
    const decided5 = await decideReview(db, OWNER_A, {
      reviewId: round5.id, expectedVersion: 1, decision: "RETURN_TO_DRAFTER", reason: "Owner sign-off.",
    });
    expect(decided5.state).toBe("RETURNED");
  });

  it60("version guards reject stale decisions and resolutions", async () => {
    const { revision, review } = await openReviewedDrawing();
    const redline = await createRedline(db, OWNER_A, {
      reviewId: review.id, revisionId: revision.id, comment: "Fix.", severity: "REQUIRED",
    });
    await expect(resolveRedline(db, OWNER_A, {
      redlineId: redline.id, expectedVersion: 99, resolution: "RESOLVED", note: "Fixed.",
    })).rejects.toThrow(/WPP7_VERSION_CONFLICT/);
    await expect(decideReview(db, OWNER_A, {
      reviewId: review.id, expectedVersion: 99, decision: "RETURN_TO_DRAFTER", reason: "No.",
    })).rejects.toThrow(/WPP7_VERSION_CONFLICT/);
  });

  it60("IFC release refuses a stale review, an open review, and an unapproved review", async () => {
    const { revision, review } = await openReviewedDrawing();
    // Unapproved (still OPEN) review cannot release.
    await expect(createIfcRelease(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", reviewId: review.id, code: "C", sha: SHA_C,
    })).rejects.toThrow(/WPP7_REVIEW_NOT_APPROVED/);
    await decideReview(db, OWNER_A, {
      reviewId: review.id, expectedVersion: 1, decision: "APPROVE", reason: "Checked.",
    });
    // A newer revision after approval makes the review stale.
    await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "B", sha: SHA_B,
    });
    await expect(createIfcRelease(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", reviewId: review.id, code: "C", sha: SHA_C,
    })).rejects.toThrow(/WPP7_REVIEW_STALE/);
    // An OPEN review on the drawing blocks release even from an approved round.
    const { rows: revB } = await db.query(`
      select id from forge_wp_drawing_revisions
      where drawing_id = 'dwg_1' and revision_code = 'B';
    `);
    const round2 = await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revB[0].id,
    });
    await expect(createIfcRelease(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", reviewId: review.id, code: "C", sha: SHA_C,
    })).rejects.toThrow(/WPP7_OPEN_REVIEW_EXISTS|WPP7_REVIEW_STALE/);
    expect(round2.state).toBe("OPEN");
  });

  it60("a second IFC release retires the first; a re-issue keeps one ACTIVE release", async () => {
    const { revision, review } = await openReviewedDrawing();
    await decideReview(db, OWNER_A, {
      reviewId: review.id, expectedVersion: 1, decision: "APPROVE", reason: "Checked.",
    });
    const release1 = await createIfcRelease(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", reviewId: review.id, code: "C", sha: SHA_C,
    });
    // New round on a new IFA revision, approved, then re-issued.
    const revisionD = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "D", sha: SHA_B,
    });
    const round2 = await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revisionD.id,
    });
    await decideReview(db, OWNER_A, {
      reviewId: round2.id, expectedVersion: 1, decision: "APPROVE", reason: "Checked again.",
    });
    const release2 = await createIfcRelease(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", reviewId: round2.id, code: "E", sha: SHA_A,
    });
    expect(release2.ifc_revision_id).not.toBe(release1.ifc_revision_id);
    const { rows } = await db.query(`
      select id, retired_at from forge_wp_drawing_ifc_releases
      where drawing_id = 'dwg_1' order by released_at;
    `);
    expect(rows).toHaveLength(2);
    expect(rows[0].retired_at).not.toBe(null);
    expect(rows[1].retired_at).toBe(null);
    expect(await badgeFor(db, "pkg_a", "dwg_1")).toEqual({ badge: "IFC — Issued for construction", constructionUsable: true });
  });

  it60("terminal packages refuse new revisions, reviews, and releases", async () => {
    await expect(createRevision(db, OWNER_A, {
      packageId: "pkg_cancelled", drawingId: "dwg_c1", code: "A", sha: SHA_A,
    })).rejects.toThrow(/WPP7_PACKAGE_TERMINAL/);
    const snap = await snapshot(db, OWNER_A, { packageId: "pkg_cancelled" });
    expect(snap.packageStatus).toBe("cancelled");
  });

  // Fix round 1 (P1): issue IFC, open a second round, then cancel
  // the package — the trigger retires the release and cancels the
  // open round in the same transaction, and the snapshot withdraws
  // the drawing. History stays on file.
  async function issueIfcAndTerminate(status) {
    const { revision, review } = await openReviewedDrawing();
    await decideReview(db, OWNER_A, {
      reviewId: review.id, expectedVersion: 1, decision: "APPROVE", reason: "Checked.",
    });
    await createIfcRelease(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", reviewId: review.id, code: "C", sha: SHA_C,
    });
    expect(await badgeFor(db, "pkg_a", "dwg_1")).toEqual({ badge: "IFC — Issued for construction", constructionUsable: true });
    const revisionD = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "D", sha: SHA_B,
    });
    const round2 = await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revisionD.id,
    });
    // Cancel/close the package the way production does: the
    // transition RPC runs SECURITY DEFINER as the table owner (the
    // app role holds SELECT only on forge_work_packages), with the
    // caller's JWT set — so the status change here runs as the
    // table owner with app.test_uid set, never as `authenticated`.
    // The explicit `reset role` states that precondition instead of
    // relying on the previous helper's `finally` having run.
    await db.exec(`reset role; set app.test_uid = '${OWNER_A}';`);
    await db.query(`update forge_work_packages set status = '${status}' where owner_id = '${OWNER_A}' and id = 'pkg_a';`);
    return { review, round2 };
  }

  it60("cancelling a package withdraws its IFC release and cancels its open review", async () => {
    const { review, round2 } = await issueIfcAndTerminate("cancelled");
    expect(await badgeFor(db, "pkg_a", "dwg_1")).toEqual({ badge: "Withdrawn — package cancelled", constructionUsable: false });
    const snap = await snapshot(db, OWNER_A, { packageId: "pkg_a" });
    expect(snap.packageStatus).toBe("cancelled");
    expect(snap.counts.ifcReleased).toBe(0);
    const row = snap.drawings.find((d) => d.drawing_id === "dwg_1");
    expect(row.preliminary).toBe(false);
    const { rows: releaseRows } = await db.query(`
      select retired_at, retired_by from forge_wp_drawing_ifc_releases where drawing_id = 'dwg_1';
    `);
    expect(releaseRows).toHaveLength(1);
    expect(releaseRows[0].retired_at).not.toBe(null);
    expect(releaseRows[0].retired_by).toBe(OWNER_A);
    const { rows: reviewRows } = await db.query(`
      select state, closed_by, decision_reason from forge_wp_drawing_reviews where id = '${round2.id}';
    `);
    expect(reviewRows[0].state).toBe("CANCELLED");
    expect(reviewRows[0].closed_by).toBe(OWNER_A);
    expect(reviewRows[0].decision_reason).toBe("Package cancelled.");
    // The withdrawal is auditable, and both rounds stay on file.
    expect((await eventsFor(db, round2.id)).map((e) => e.event_type)).toContain("REVIEW_CANCELLED");
    const { rows: releaseEvents } = await db.query(`
      select event_type from forge_wp_drawing_review_events
      where review_id = '${review.id}' and event_type = 'IFC_RELEASE_RETIRED';
    `);
    expect(releaseEvents).toHaveLength(1);
    const { rows: allReviews } = await db.query(`
      select count(*)::integer as n from forge_wp_drawing_reviews where drawing_id = 'dwg_1';
    `);
    expect(allReviews[0].n).toBe(2);
    // No new release or review after cancellation.
    await expect(createIfcRelease(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", reviewId: review.id, code: "E", sha: SHA_A,
    })).rejects.toThrow(/WPP7_PACKAGE_TERMINAL/);
    await expect(createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: review.drawing_revision_id,
    })).rejects.toThrow(/WPP7_PACKAGE_TERMINAL/);
  });

  it60("verified-closed packages withdraw IFC the same way", async () => {
    const { review, round2 } = await issueIfcAndTerminate("verified_closed");
    expect(await badgeFor(db, "pkg_a", "dwg_1")).toEqual({ badge: "Withdrawn — package verified closed", constructionUsable: false });
    const snap = await snapshot(db, OWNER_A, { packageId: "pkg_a" });
    expect(snap.packageStatus).toBe("verified_closed");
    expect(snap.counts.ifcReleased).toBe(0);
    const { rows: reviewRows } = await db.query(`
      select state, decision_reason from forge_wp_drawing_reviews where id = '${round2.id}';
    `);
    expect(reviewRows[0].state).toBe("CANCELLED");
    expect(reviewRows[0].decision_reason).toBe("Package verified closed.");
    expect((await eventsFor(db, review.id)).map((e) => e.event_type)).toContain("IFC_RELEASE_RETIRED");
  });

  it60("a failed decision leaves no review event (atomic audit)", async () => {
    const { revision, review } = await openReviewedDrawing();
    await createRedline(db, OWNER_A, {
      reviewId: review.id, revisionId: revision.id, comment: "Blocking.", severity: "REQUIRED",
    });
    const before = await eventsFor(db, review.id);
    await expect(decideReview(db, OWNER_A, {
      reviewId: review.id, expectedVersion: 1, decision: "APPROVE", reason: "Too soon.",
    })).rejects.toThrow(/WPP7_OPEN_REDLINES/);
    const after = await eventsFor(db, review.id);
    expect(after).toHaveLength(before.length);
    // A successful decision records exactly one event.
    await resolveRedline(db, OWNER_A, {
      redlineId: (await db.query(`select id from forge_wp_drawing_redlines where review_id = '${review.id}'`)).rows[0].id,
      expectedVersion: 1, resolution: "RESOLVED", note: "Fixed.",
    });
    await decideReview(db, OWNER_A, {
      reviewId: review.id, expectedVersion: 1, decision: "APPROVE", reason: "Checked.",
    });
    const decided = await eventsFor(db, review.id);
    expect(decided.map((e) => e.event_type)).toContain("REVIEW_APPROVED");
  });
});

describe("slice 7 migration: field hand-redlines and retire", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("a field hand-redline never makes an IFA drawing construction-usable", async () => {
    const revision = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "A", sha: SHA_A,
    });
    const field = await createFieldRedline(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revision.id,
      sha: SHA_B, fieldReason: "No time to send pipe back; hand-marked on site.",
    });
    expect(field.record_state).toBe("HISTORICAL_PENDING_RECONCILIATION");
    expect(await badgeFor(db, "pkg_a", "dwg_1")).toEqual({ badge: "IFA — Awaiting review", constructionUsable: false });
    const snap = await snapshot(db, OWNER_A, { packageId: "pkg_a" });
    expect(snap.counts.pendingFieldRedlines).toBe(1);
    expect(snap.counts.ifcReleased).toBe(0);
    // Reconciling against the SAME revision is refused — the markup
    // is only reconciled when a drafter issues a newer revision.
    await expect(reconcileFieldRedline(db, OWNER_A, {
      fieldRedlineId: field.id, reconciledRevisionId: revision.id,
    })).rejects.toThrow(/WPP7_SAME_REVISION/);
    const revisionB = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "B", sha: SHA_B,
    });
    const reconciled = await reconcileFieldRedline(db, OWNER_A, {
      fieldRedlineId: field.id, reconciledRevisionId: revisionB.id, reason: "Drafter issued rev B.",
    });
    expect(reconciled.record_state).toBe("RECONCILED");
    expect(reconciled.reconciled_revision_id).toBe(revisionB.id);
    const snapAfter = await snapshot(db, OWNER_A, { packageId: "pkg_a" });
    expect(snapAfter.counts.pendingFieldRedlines).toBe(0);
    // Reconciling twice is refused.
    await expect(reconcileFieldRedline(db, OWNER_A, {
      fieldRedlineId: field.id, reconciledRevisionId: revisionB.id,
    })).rejects.toThrow(/WPP7_FIELD_REDLINE_STATE/);
  });

  it60("retire cancels OPEN reviews, retires the ACTIVE release, and freezes the drawing", async () => {
    const revision = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "A", sha: SHA_A,
    });
    const review = await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revision.id,
    });
    await decideReview(db, OWNER_A, {
      reviewId: review.id, expectedVersion: 1, decision: "APPROVE", reason: "Checked.",
    });
    await createIfcRelease(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", reviewId: review.id, code: "C", sha: SHA_C,
    });
    // A fresh round is open when the drawing is retired.
    const revisionD = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "D", sha: SHA_B,
    });
    const round2 = await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revisionD.id,
    });
    const retired = await retireDrawingRpc(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", reason: "Superseded by a re-issue.",
    });
    expect(retired.retired_at).not.toBe(null);
    const { rows: reviewRows } = await db.query(`
      select state from forge_wp_drawing_reviews where id = '${round2.id}';
    `);
    expect(reviewRows[0].state).toBe("CANCELLED");
    const { rows: releaseRows } = await db.query(`
      select retired_at from forge_wp_drawing_ifc_releases where drawing_id = 'dwg_1';
    `);
    expect(releaseRows[0].retired_at).not.toBe(null);
    expect(await badgeFor(db, "pkg_a", "dwg_1")).toEqual({ badge: "Retired", constructionUsable: false });
    // Retired drawings refuse new revisions, reviews, and releases.
    await expect(createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "E", sha: SHA_A,
    })).rejects.toThrow(/WPP7_DRAWING_RETIRED/);
    await expect(retireDrawingRpc(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", reason: "Again.",
    })).rejects.toThrow(/WPP7_DRAWING_RETIRED/);
  });
});

describe("slice 7 migration: delete coordination", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("a drawing WITH slice-7 history is retired, never physically deleted", async () => {
    const revision = await createRevision(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", code: "A", sha: SHA_A,
    });
    const review = await createReview(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1", revisionId: revision.id,
    });
    const deleted = await deleteDrawing(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_1",
    });
    expect(deleted.forge_work_permit_annotation_delete_drawing).toBe(true);
    const { rows: drawingRows } = await db.query(`select retired_at from forge_work_drawings where id = 'dwg_1';`);
    expect(drawingRows).toHaveLength(1);
    expect(drawingRows[0].retired_at).not.toBe(null);
    const { rows: reviewRows } = await db.query(`select state from forge_wp_drawing_reviews where id = '${review.id}';`);
    expect(reviewRows[0].state).toBe("CANCELLED");
    const { rows: revisionRows } = await db.query(`select id from forge_wp_drawing_revisions where drawing_id = 'dwg_1';`);
    expect(revisionRows).toHaveLength(1);
    // Step links and permit annotations are left alone — the row
    // still exists, and the UI shows "Retired drawing".
    const { rows: eventRows } = await db.query(`
      select event_type from forge_wp_drawing_review_events
      where drawing_id = 'dwg_1' and event_type = 'DRAWING_RETIRED';
    `);
    expect(eventRows).toHaveLength(1);
  });

  it60("a drawing WITHOUT slice-7 history keeps exact slice-5 behavior", async () => {
    // dwg_2 has no revisions: physical delete, annotations retired,
    // step links detached. Seed one annotation + one step + link.
    const { rows: stepRows } = await asUser(db, OWNER_A, `
      select * from forge_work_step_create(
        '${OWNER_A}', 'pkg_a', 'Delete-test step', null, null, null, null, null, null, null, null);
    `);
    const step = stepRows[0];
    const { rows: linkRows } = await asUser(db, OWNER_A, `
      select * from forge_work_step_link_drawing_create(
        '${OWNER_A}', 'pkg_a', '${step.id}', 'dwg_2', null, null);
    `);
    const link = linkRows[0];
    const { rows: annRows } = await asUser(db, OWNER_A, `
      select * from forge_work_permit_annotation_create(
        '${OWNER_A}', 'pkg_a', 'drawing', 'dwg_2',
        'Permit D', 'https://example.gov/permits/d', null, null);
    `);
    const ann = annRows[0];
    const deleted = await deleteDrawing(db, OWNER_A, {
      packageId: "pkg_a", drawingId: "dwg_2",
    });
    expect(deleted.forge_work_permit_annotation_delete_drawing).toBe(true);
    const { rows: drawingRows } = await db.query(`select id from forge_work_drawings where id = 'dwg_2';`);
    expect(drawingRows).toHaveLength(0);
    const { rows: linkAfter } = await db.query(`
      select retired_at, drawing_id, original_drawing_id
      from forge_work_step_drawing_links where id = '${link.id}';
    `);
    expect(linkAfter[0].retired_at).not.toBe(null);
    expect(linkAfter[0].drawing_id).toBe(null);
    expect(linkAfter[0].original_drawing_id).toBe("dwg_2");
    const { rows: annAfter } = await db.query(`
      select retired_at, drawing_id from forge_work_permit_annotations where id = '${ann.id}';
    `);
    expect(annAfter[0].retired_at).not.toBe(null);
    expect(annAfter[0].drawing_id).toBe(null);
    const { rows: stepAfter } = await db.query(`select retired_at from forge_work_steps where id = '${step.id}';`);
    expect(stepAfter[0].retired_at).toBe(null);
  });
});

describe("slice 7 migration: effective ACLs and migration text", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  const TABLES = [
    "forge_wp_drawing_revisions", "forge_wp_drawing_reviews",
    "forge_wp_drawing_redlines", "forge_wp_drawing_review_events",
    "forge_wp_drawing_field_redlines", "forge_wp_drawing_ifc_releases",
  ];
  const RPCS = [
    "forge_wp_drawing_revision_create(text, text, text, text, text, text)",
    "forge_wp_drawing_review_create(text, text, text, text, text, text, text)",
    "forge_wp_drawing_redline_create(text, text, text, text, text, text, integer, numeric, numeric, text, text)",
    "forge_wp_drawing_redline_resolve(text, text, integer, text, text, boolean, text)",
    "forge_wp_drawing_review_decide(text, text, integer, text, text)",
    "forge_wp_drawing_ifc_release(text, text, text, text, text, text, text, text)",
    "forge_wp_drawing_field_redline_create(text, text, text, text, text, text, text, text)",
    "forge_wp_drawing_field_redline_reconcile(text, text, text, text)",
    "forge_wp_drawing_retire(text, text, text, text)",
    "forge_wp_drawing_readiness_snapshot(text, text)",
  ];

  it60("authenticated has SELECT only; anon and service_role have nothing on the six tables", async () => {
    for (const table of TABLES) {
      for (const [role, privilege, expected] of [
        ["authenticated", "SELECT", true],
        ["authenticated", "INSERT", false],
        ["authenticated", "UPDATE", false],
        ["authenticated", "DELETE", false],
        ["anon", "SELECT", false],
        ["service_role", "SELECT", false],
      ]) {
        const { rows } = await db.query(
          `select has_table_privilege('${role}', 'public.${table}', '${privilege}') as ok;`,
        );
        expect(rows[0].ok, `${role} ${privilege} on ${table}`).toBe(expected);
      }
    }
  });

  it60("authenticated can EXECUTE the ten RPCs; anon, service_role and PUBLIC cannot", async () => {
    for (const fn of RPCS) {
      const { rows } = await db.query(
        `select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') as ok;`,
      );
      expect(rows[0].ok, `authenticated EXECUTE on ${fn}`).toBe(true);
      for (const role of ["anon", "service_role", "public"]) {
        const { rows: deniedRows } = await db.query(
          `select has_function_privilege('${role}', 'public.${fn}', 'EXECUTE') as ok;`,
        );
        expect(deniedRows[0].ok, `${role} EXECUTE on ${fn}`).toBe(false);
      }
    }
  });

  it60("RLS is enabled and forced on all six tables", async () => {
    for (const table of TABLES) {
      const { rows } = await db.query(`
        select relrowsecurity as rls, relforcerowsecurity as forced
        from pg_class where relname = '${table}' and relnamespace = 'public'::regnamespace;
      `);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ rls: true, forced: true });
    }
  });

  it60("a selective GRANT alone does NOT remove an already-effective broad privilege (negative case)", async () => {
    // A fresh table with the Supabase-style default grants: a
    // selective GRANT leaves the broad privilege effective — the
    // grant does not remove the broad privilege.
    await db.exec(`
      create table scratch_default_privs (id text primary key);
      grant all on table scratch_default_privs to authenticated;
    `);
    await db.exec(`grant select on scratch_default_privs to authenticated;`);
    const { rows } = await db.query(
      `select has_table_privilege('authenticated', 'public.scratch_default_privs', 'INSERT') as ok;`,
    );
    expect(rows[0].ok).toBe(true);
    // The shipped migration's explicit REVOKEs are what remove it:
    // the real tables prove the difference.
    const { rows: realRows } = await db.query(
      `select has_table_privilege('authenticated', 'public.forge_wp_drawing_reviews', 'INSERT') as ok;`,
    );
    expect(realRows[0].ok).toBe(false);
  });

  it60("the shipped migration text carries explicit REVOKEs for all six tables and all ten functions", async () => {
    const sql = loadMigrationSql(SLICE7);
    for (const table of TABLES) {
      expect(sql).toContain(`revoke all on table public.${table} from public, anon, service_role, authenticated`);
      expect(sql).toContain(`grant select on table public.${table} to authenticated`);
    }
    for (const fn of RPCS) {
      expect(sql).toContain(`revoke all on function public.${fn} from public`);
      expect(sql).toContain(`grant execute on function public.${fn} to authenticated`);
      // Fix round 1: explicit anon/service_role revokes, so the
      // posture survives a direct default grant to a named role.
      expect(sql).toContain(`revoke execute on function public.${fn} from anon, service_role`);
    }
    expect(sql).toContain("force row level security");
  });
});

// Real-PostgreSQL subset. PGlite is single-connection, so the
// concurrent-serialization leg can only run here, against a scratch
// PG16 cluster. The suite is gated on the binaries existing AND an
// unprivileged user to run the cluster as (initdb refuses root, and
// this VM's agent runs as root) — and SKIPS LOUDLY, never silently,
// when either is missing.
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

describe.skipIf(!HAS_REAL_PG)("slice 7 migration: real-PostgreSQL subset", () => {
  let pgDir;
  let pgClient;
  let pgClient2;
  // A third connection that stays superuser: pg_stat_activity masks
  // state/wait_event for other roles' backends, so a lock-wait poll
  // issued as `authenticated` can never see the wait (proven by a
  // standalone repro — the wait is real, the view just hides it).
  let pgDiag;
  let pgCfg;

  beforeAll(async () => {
    pgDir = mkdtempSync(join(tmpdir(), "wpp7-realpg-"));
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
    // A second connection: PGlite is single-connection, so every
    // true-concurrency leg (same-key races, cancel/release ordering)
    // needs two live sessions here.
    pgClient2 = new Client(pgCfg);
    await pgClient2.connect();
    pgDiag = new Client(pgCfg);
    await pgDiag.connect();
    await pgClient.query(PREREQ_SQL);
    await pgClient.query(loadMigrationSql(SLICE3));
    await pgClient.query(loadMigrationSql(SLICE4));
    await pgClient.query(loadMigrationSql(SLICE5));
    await pgClient.query(loadMigrationSql(SLICE7));
    await pgClient.query(`
      insert into forge_work_packages (owner_id, id, status) values
        ('${OWNER_A}', 'pkg_real', 'in_progress'),
        ('${OWNER_B}', 'pkg_real_b', 'in_progress');
      insert into forge_work_drawings (owner_id, package_id, id, drawing_number, drawing_type, title, p_id_drawing_id) values
        ('${OWNER_A}', 'pkg_real', 'dwg_r1', 'P-301', 'p_id', 'Real line', null),
        ('${OWNER_A}', 'pkg_real', 'dwg_r2', 'P-302', 'p_id', 'Real line 2', null);
      insert into workspace_members (owner_id, member_user_id, status, role)
        values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
    `);
    const { rows } = await pgClient.query("select version() as v;");
    pgCfg.version = rows[0].v;
  }, 120000);

  afterAll(async () => {
    try { await pgClient?.end(); } catch { /* already closed */ }
    try { await pgClient2?.end(); } catch { /* already closed */ }
    try { await pgDiag?.end(); } catch { /* already closed */ }
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

  async function pgSnapshot(packageId) {
    const { rows } = await pgAsUser(pgClient, OWNER_A, `
      select forge_wp_drawing_readiness_snapshot('${OWNER_A}', '${packageId}');
    `);
    return rows[0].forge_wp_drawing_readiness_snapshot;
  }

  it60("full lifecycle runs on real PostgreSQL", async () => {
    const { rows: revRows } = await pgAsUser(pgClient, OWNER_A, `
      select * from forge_wp_drawing_revision_create(
        '${OWNER_A}', 'pkg_real', 'dwg_r1', 'A', 's3://forge/r1-a.pdf', '${SHA_A}');
    `);
    const revision = revRows[0];
    const { rows: reviewRows } = await pgAsUser(pgClient, OWNER_A, `
      select * from forge_wp_drawing_review_create(
        '${OWNER_A}', 'pkg_real', 'dwg_r1', '${revision.id}', null, 'real-key-1', null);
    `);
    const review = reviewRows[0];
    expect(review.round_no).toBe(1);
    await pgAsUser(pgClient, OWNER_A, `
      select * from forge_wp_drawing_redline_create(
        '${OWNER_A}', '${review.id}', '${revision.id}',
        'Move this nozzle.', 'REQUIRED', null, 2, 0.5, 0.25, null, 'real-rl-1');
    `);
    // Idempotent redline replay returns the same row.
    const { rows: replayRows } = await pgAsUser(pgClient, OWNER_A, `
      select * from forge_wp_drawing_redline_create(
        '${OWNER_A}', '${review.id}', '${revision.id}',
        'Move this nozzle.', 'REQUIRED', null, 2, 0.5, 0.25, null, 'real-rl-1');
    `);
    const { rows: redlineRows } = await pgClient.query(`
      select id from forge_wp_drawing_redlines where review_id = '${review.id}';
    `);
    expect(redlineRows).toHaveLength(1);
    expect(replayRows[0].id).toBe(redlineRows[0].id);
    const redlineId = redlineRows[0].id;
    await pgAsUser(pgClient, OWNER_A, `
      select * from forge_wp_drawing_redline_resolve(
        '${OWNER_A}', '${redlineId}', 1, 'RESOLVED', 'Moved.', false, null);
    `);
    await pgAsUser(pgClient, OWNER_A, `
      select * from forge_wp_drawing_review_decide(
        '${OWNER_A}', '${review.id}', 1, 'APPROVE', 'Checked.');
    `);
    const { rows: releaseRows } = await pgAsUser(pgClient, OWNER_A, `
      select * from forge_wp_drawing_ifc_release(
        '${OWNER_A}', 'pkg_real', 'dwg_r1', '${review.id}', 'C', 's3://forge/r1-c.pdf', '${SHA_C}', null);
    `);
    expect(releaseRows[0].ifc_revision_id).toBeTruthy();
    const snap = await pgSnapshot("pkg_real");
    const row = snap.drawings.find((d) => d.drawing_id === "dwg_r1");
    expect(row.badge).toBe("IFC — Issued for construction");
    expect(row.construction_usable).toBe(true);
    expect(snap.counts.ifcReleased).toBe(1);
    // The second drawing, untouched, stays "No issued revision".
    const row2 = snap.drawings.find((d) => d.drawing_id === "dwg_r2");
    expect(row2.badge).toBe("No issued revision");
  });

  it60("delete coordination retires a drawing with history on real PostgreSQL", async () => {
    const { rows: deleted } = await pgAsUser(pgClient, OWNER_A, `
      select * from forge_work_permit_annotation_delete_drawing(
        '${OWNER_A}', 'pkg_real', 'dwg_r1');
    `);
    expect(deleted[0].forge_work_permit_annotation_delete_drawing).toBe(true);
    const { rows: drawingRows } = await pgClient.query(`select retired_at from forge_work_drawings where id = 'dwg_r1';`);
    expect(drawingRows).toHaveLength(1);
    expect(drawingRows[0].retired_at).not.toBe(null);
    const { rows: releaseRows } = await pgClient.query(`
      select retired_at from forge_wp_drawing_ifc_releases where drawing_id = 'dwg_r1';
    `);
    expect(releaseRows[0].retired_at).not.toBe(null);
    // A drawing without history physically deletes.
    const { rows: deleted2 } = await pgAsUser(pgClient, OWNER_A, `
      select * from forge_work_permit_annotation_delete_drawing(
        '${OWNER_A}', 'pkg_real', 'dwg_r2');
    `);
    expect(deleted2[0].forge_work_permit_annotation_delete_drawing).toBe(true);
    const { rows: gone } = await pgClient.query(`select id from forge_work_drawings where id = 'dwg_r2';`);
    expect(gone).toHaveLength(0);
  });

  it60("effective ACLs hold on real PostgreSQL and the migration reapplies cleanly", async () => {
    const { rows } = await pgClient.query(`
      select has_table_privilege('authenticated', 'public.forge_wp_drawing_reviews', 'INSERT') as insert_ok,
             has_table_privilege('authenticated', 'public.forge_wp_drawing_reviews', 'SELECT') as select_ok,
             has_table_privilege('anon', 'public.forge_wp_drawing_reviews', 'SELECT') as anon_ok,
             has_function_privilege('authenticated', 'public.forge_wp_drawing_review_decide(text, text, integer, text, text)', 'EXECUTE') as exec_ok;
    `);
    expect(rows[0]).toEqual({ insert_ok: false, select_ok: true, anon_ok: false, exec_ok: true });
    await pgClient.query(loadMigrationSql(SLICE7));
    const { rows: afterRows } = await pgClient.query(`
      select count(*)::integer as n from forge_wp_drawing_reviews;
    `);
    expect(afterRows[0].n).toBeGreaterThanOrEqual(0);
    expect(pgCfg.version).toMatch(/PostgreSQL 16/);
  });

  // Fix round 1 (P2): two live sessions racing the same idempotency
  // key, and a package cancellation racing an IFC release. Each leg
  // builds its own package/drawing so it is independent of the
  // earlier legs' accumulated state.
  async function pgApprovedReview(packageId, drawingId) {
    await pgClient.query(`
      insert into forge_work_packages (owner_id, id, status)
        values ('${OWNER_A}', '${packageId}', 'in_progress');
      insert into forge_work_drawings (owner_id, package_id, id, drawing_number, drawing_type, title, p_id_drawing_id)
        values ('${OWNER_A}', '${packageId}', '${drawingId}', 'P-401', 'p_id', 'Concurrent line', null);
    `);
    const { rows: revRows } = await pgAsUser(pgClient, OWNER_A, `
      select * from forge_wp_drawing_revision_create(
        '${OWNER_A}', '${packageId}', '${drawingId}', 'A', 's3://forge/conc-a.pdf', '${SHA_A}');
    `);
    const revision = revRows[0];
    const { rows: reviewRows } = await pgAsUser(pgClient, OWNER_A, `
      select * from forge_wp_drawing_review_create(
        '${OWNER_A}', '${packageId}', '${drawingId}', '${revision.id}', null, 'conc-review-${packageId}', null);
    `);
    return { revision, review: reviewRows[0] };
  }

  async function waitForLockWait() {
    // True concurrency proof: the second session must actually be
    // blocked on a lock (not merely slow). Poll pg_stat_activity
    // for up to 10s; the loop is the assertion's precondition. The
    // poll runs on the superuser diag connection: pg_stat_activity
    // masks state/wait_event for other roles' backends, so a poll
    // issued as `authenticated` would never see the wait.
    // Returns the last observed sample so a failure names what the
    // backends were actually doing instead of just "false".
    let sample = [];
    for (let i = 0; i < 100; i += 1) {
      const { rows } = await pgDiag.query(`
        select pid, usename, state, wait_event_type, wait_event,
               left(query, 80) as query
        from pg_stat_activity
        where pid <> pg_backend_pid() and wait_event_type = 'Lock' and state = 'active';
      `);
      sample = rows;
      if (rows.length > 0) return { seen: true, sample };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const { rows: allRows } = await pgDiag.query(`
      select pid, usename, state, wait_event_type, wait_event,
             left(query, 80) as query
      from pg_stat_activity where pid <> pg_backend_pid();
    `);
    return { seen: false, sample: allRows };
  }

  it60("concurrent same-key redline creation stores one redline and one event", async () => {
    const { revision, review } = await pgApprovedReview("pkg_conc", "dwg_c1");
    const redlineSql = `
      select * from forge_wp_drawing_redline_create(
        '${OWNER_A}', '${review.id}', '${revision.id}',
        'Move this nozzle.', 'REQUIRED', null, 2, 0.5, 0.25, null, 'conc-rl-1');
    `;
    const [first, second] = await Promise.allSettled([
      pgAsUser(pgClient, OWNER_A, redlineSql),
      pgAsUser(pgClient2, OWNER_A, redlineSql),
    ]);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("fulfilled");
    expect(first.value.rows[0].id).toBe(second.value.rows[0].id);
    const { rows: redlineRows } = await pgClient.query(`
      select id from forge_wp_drawing_redlines where review_id = '${review.id}';
    `);
    expect(redlineRows).toHaveLength(1);
    const { rows: eventRows } = await pgClient.query(`
      select count(*)::integer as n from forge_wp_drawing_review_events
      where review_id = '${review.id}' and event_type = 'REDLINE_ADDED';
    `);
    expect(eventRows[0].n).toBe(1);
    // A concurrent same-key request with a different payload conflicts.
    const conflictSql = `
      select * from forge_wp_drawing_redline_create(
        '${OWNER_A}', '${review.id}', '${revision.id}',
        'A different note.', 'REQUIRED', null, 2, 0.5, 0.25, null, 'conc-rl-1');
    `;
    await expect(pgAsUser(pgClient, OWNER_A, conflictSql)).rejects.toThrow(/WPP7_IDEMPOTENCY_CONFLICT/);
  });

  it60("concurrent same-key review creation stores one round", async () => {
    // No OPEN review on this revision yet: the two concurrent opens
    // race the same key, not the one-OPEN-review rule.
    await pgClient.query(`
      insert into forge_work_packages (owner_id, id, status)
        values ('${OWNER_A}', 'pkg_conc2', 'in_progress');
      insert into forge_work_drawings (owner_id, package_id, id, drawing_number, drawing_type, title, p_id_drawing_id)
        values ('${OWNER_A}', 'pkg_conc2', 'dwg_c2', 'P-402', 'p_id', 'Concurrent line 2', null);
    `);
    const { rows: revRows } = await pgAsUser(pgClient, OWNER_A, `
      select * from forge_wp_drawing_revision_create(
        '${OWNER_A}', 'pkg_conc2', 'dwg_c2', 'A', 's3://forge/c2-a.pdf', '${SHA_A}');
    `);
    const revision = revRows[0];
    const reviewSql = `
      select * from forge_wp_drawing_review_create(
        '${OWNER_A}', 'pkg_conc2', 'dwg_c2', '${revision.id}', null, 'conc-review-2', null);
    `;
    const [first, second] = await Promise.allSettled([
      pgAsUser(pgClient, OWNER_A, reviewSql),
      pgAsUser(pgClient2, OWNER_A, reviewSql),
    ]);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("fulfilled");
    expect(first.value.rows[0].id).toBe(second.value.rows[0].id);
    const { rows } = await pgClient.query(`
      select count(*)::integer as n from forge_wp_drawing_reviews
      where drawing_revision_id = '${revision.id}';
    `);
    expect(rows[0].n).toBe(1);
  });

  it60("concurrent cancel and release serialize to a withdrawn drawing", async () => {
    const { revision, review } = await pgApprovedReview("pkg_conc3", "dwg_c3");
    await pgAsUser(pgClient, OWNER_A, `
      select * from forge_wp_drawing_review_decide(
        '${OWNER_A}', '${review.id}', 1, 'APPROVE', 'Checked.');
    `);
    // Direction 1: the release runs inside an open transaction, so
    // it still holds the package row lock; the cancel on the second
    // session blocks, then the trigger retires the just-created
    // release once the release commits.
    await pgClient.query(`set role authenticated; set app.test_uid = '${OWNER_A}'; begin;`);
    await pgClient.query(`
      select * from forge_wp_drawing_ifc_release(
        '${OWNER_A}', 'pkg_conc3', 'dwg_c3', '${review.id}', 'C', 's3://forge/c3-c.pdf', '${SHA_C}', null);
    `);
    const cancelPromise = pgClient2.query(`
      reset role; set app.test_uid = '${OWNER_A}';
      update forge_work_packages set status = 'cancelled'
      where owner_id = '${OWNER_A}' and id = 'pkg_conc3';
    `);
    // Mark the rejection handled at creation: the rejection is
    // observed by the `await cancelPromise` below, but if the
    // lock-wait assertion above it ever throws first, an
    // un-awaited rejection must not surface as an unhandled error.
    cancelPromise.catch(() => {});
    const lockWait1 = await waitForLockWait();
    expect(lockWait1.seen, `no session reached a lock wait; backends: ${JSON.stringify(lockWait1.sample)}`).toBe(true);
    await pgClient.query("commit; reset role;");
    await cancelPromise;
    await pgClient2.query("reset role;");
    const { rows: releaseRows } = await pgClient.query(`
      select retired_at, retired_by from forge_wp_drawing_ifc_releases where drawing_id = 'dwg_c3';
    `);
    expect(releaseRows).toHaveLength(1);
    expect(releaseRows[0].retired_at).not.toBe(null);
    expect(releaseRows[0].retired_by).toBe(OWNER_A);
    const snap = await pgSnapshot("pkg_conc3");
    expect(snap.drawings.find((d) => d.drawing_id === "dwg_c3").badge).toBe("Withdrawn — package cancelled");
    expect(snap.counts.ifcReleased).toBe(0);

    // Direction 2: the cancel holds the lock while the release
    // waits; once the cancel commits, the release sees the terminal
    // package and refuses.
    const second = await pgApprovedReview("pkg_conc4", "dwg_c4");
    await pgAsUser(pgClient, OWNER_A, `
      select * from forge_wp_drawing_review_decide(
        '${OWNER_A}', '${second.review.id}', 1, 'APPROVE', 'Checked.');
    `);
    await pgClient.query(`reset role; set app.test_uid = '${OWNER_A}'; begin;`);
    await pgClient.query(`
      update forge_work_packages set status = 'cancelled'
      where owner_id = '${OWNER_A}' and id = 'pkg_conc4';
    `);
    const releasePromise = pgClient2.query(`
      set role authenticated; set app.test_uid = '${OWNER_A}';
      select * from forge_wp_drawing_ifc_release(
        '${OWNER_A}', 'pkg_conc4', 'dwg_c4', '${second.review.id}', 'C', 's3://forge/c4-c.pdf', '${SHA_C}', null);
    `);
    // Same handled-at-creation guard as the cancel leg: the
    // rejection is observed by the `expect().rejects` below, but a
    // throw from the lock-wait assertion must not orphan it.
    releasePromise.catch(() => {});
    const lockWait2 = await waitForLockWait();
    expect(lockWait2.seen, `no session reached a lock wait; backends: ${JSON.stringify(lockWait2.sample)}`).toBe(true);
    await pgClient.query("commit; reset role;");
    await expect(releasePromise).rejects.toThrow(/WPP7_PACKAGE_TERMINAL/);
    await pgClient2.query("reset role;");
    const snap2 = await pgSnapshot("pkg_conc4");
    expect(snap2.drawings.find((d) => d.drawing_id === "dwg_c4").badge).toBe("Withdrawn — package cancelled");
  });

  // Fix round 2 (P1): review creation locks the package row before
  // checking terminal status, so a cancellation racing a create
  // serializes — whichever commits first, no OPEN review can survive
  // in a terminal package.
  it60("concurrent cancel and review creation serialize to no OPEN review in a terminal package", async () => {
    // Direction 1: the create runs inside an open transaction, so it
    // still holds the package row lock; the cancel on the second
    // session blocks, then the trigger cancels the just-created round
    // once the create commits.
    await pgClient.query(`
      insert into forge_work_packages (owner_id, id, status)
        values ('${OWNER_A}', 'pkg_conc5', 'in_progress');
      insert into forge_work_drawings (owner_id, package_id, id, drawing_number, drawing_type, title, p_id_drawing_id)
        values ('${OWNER_A}', 'pkg_conc5', 'dwg_c5', 'P-501', 'p_id', 'Concurrent line 5', null);
    `);
    const { rows: revRows } = await pgAsUser(pgClient, OWNER_A, `
      select * from forge_wp_drawing_revision_create(
        '${OWNER_A}', 'pkg_conc5', 'dwg_c5', 'A', 's3://forge/c5-a.pdf', '${SHA_A}');
    `);
    const revision5 = revRows[0];
    await pgClient.query(`set role authenticated; set app.test_uid = '${OWNER_A}'; begin;`);
    const { rows: createRows } = await pgClient.query(`
      select * from forge_wp_drawing_review_create(
        '${OWNER_A}', 'pkg_conc5', 'dwg_c5', '${revision5.id}', null, 'conc-create-1', null);
    `);
    const createdReview = createRows[0];
    expect(createdReview.state).toBe("OPEN");
    const cancelPromise = pgClient2.query(`
      reset role; set app.test_uid = '${OWNER_A}';
      update forge_work_packages set status = 'cancelled'
      where owner_id = '${OWNER_A}' and id = 'pkg_conc5';
    `);
    // Mark the rejection handled at creation: the rejection is
    // observed by the `await cancelPromise` below, but if the
    // lock-wait assertion above it ever throws first, an
    // un-awaited rejection must not surface as an unhandled error.
    cancelPromise.catch(() => {});
    const lockWait1 = await waitForLockWait();
    expect(lockWait1.seen, `no session reached a lock wait; backends: ${JSON.stringify(lockWait1.sample)}`).toBe(true);
    await pgClient.query("commit; reset role;");
    await cancelPromise;
    await pgClient2.query("reset role;");
    const { rows: reviewRows } = await pgClient.query(`
      select state, closed_by, decision_reason from forge_wp_drawing_reviews where id = '${createdReview.id}';
    `);
    expect(reviewRows[0].state).toBe("CANCELLED");
    expect(reviewRows[0].closed_by).toBe(OWNER_A);
    expect(reviewRows[0].decision_reason).toBe("Package cancelled.");
    const { rows: cancelEvents } = await pgClient.query(`
      select event_type from forge_wp_drawing_review_events
      where review_id = '${createdReview.id}' and event_type = 'REVIEW_CANCELLED';
    `);
    expect(cancelEvents).toHaveLength(1);
    const { rows: openRows } = await pgClient.query(`
      select count(*)::integer as n from forge_wp_drawing_reviews
      where package_id = 'pkg_conc5' and state = 'OPEN';
    `);
    expect(openRows[0].n).toBe(0);
    const snap = await pgSnapshot("pkg_conc5");
    expect(snap.drawings.find((d) => d.drawing_id === "dwg_c5").badge).toBe("Withdrawn — package cancelled");

    // Direction 2: the cancel holds the lock while the create waits;
    // once the cancel commits, the create sees the terminal package
    // and refuses.
    await pgClient.query(`
      insert into forge_work_packages (owner_id, id, status)
        values ('${OWNER_A}', 'pkg_conc6', 'in_progress');
      insert into forge_work_drawings (owner_id, package_id, id, drawing_number, drawing_type, title, p_id_drawing_id)
        values ('${OWNER_A}', 'pkg_conc6', 'dwg_c6', 'P-502', 'p_id', 'Concurrent line 6', null);
    `);
    const { rows: revRows6 } = await pgAsUser(pgClient, OWNER_A, `
      select * from forge_wp_drawing_revision_create(
        '${OWNER_A}', 'pkg_conc6', 'dwg_c6', 'A', 's3://forge/c6-a.pdf', '${SHA_A}');
    `);
    const revision6 = revRows6[0];
    await pgClient.query(`reset role; set app.test_uid = '${OWNER_A}'; begin;`);
    await pgClient.query(`
      update forge_work_packages set status = 'cancelled'
      where owner_id = '${OWNER_A}' and id = 'pkg_conc6';
    `);
    const createPromise = pgClient2.query(`
      set role authenticated; set app.test_uid = '${OWNER_A}';
      select * from forge_wp_drawing_review_create(
        '${OWNER_A}', 'pkg_conc6', 'dwg_c6', '${revision6.id}', null, 'conc-create-2', null);
    `);
    // Same handled-at-creation guard as the cancel leg: the
    // rejection is observed by the `expect().rejects` below, but a
    // throw from the lock-wait assertion must not orphan it.
    createPromise.catch(() => {});
    const lockWait2 = await waitForLockWait();
    expect(lockWait2.seen, `no session reached a lock wait; backends: ${JSON.stringify(lockWait2.sample)}`).toBe(true);
    await pgClient.query("commit; reset role;");
    await expect(createPromise).rejects.toThrow(/WPP7_PACKAGE_TERMINAL/);
    await pgClient2.query("reset role;");
    const { rows: openRows6 } = await pgClient.query(`
      select count(*)::integer as n from forge_wp_drawing_reviews
      where package_id = 'pkg_conc6' and state = 'OPEN';
    `);
    expect(openRows6[0].n).toBe(0);
    const snap2 = await pgSnapshot("pkg_conc6");
    expect(snap2.drawings.find((d) => d.drawing_id === "dwg_c6").badge).toBe("Withdrawn — package cancelled");
  });
});
