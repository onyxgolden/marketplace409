// Work Package Planner field verification — migration/integration proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) and proves:
//   - Schema: exactly the three new tables (verifications, append-only
//     revisions, validated links) and the thirteen functions (eight
//     application RPCs + four internal helpers + the
//     revisions-immutability trigger function); composite FKs tie
//     every target and every link to its package;
//   - Sources RPC: one statement returns the target, its planned
//     figures, the installed-as-of total with contributing entry ids
//     and the source fingerprint, the drawing + latest revision, and
//     the package status — voided and future-dated entries excluded —
//     and calling it twice writes nothing (read-only detection);
//   - Create RPC: the server takes the source snapshot itself (step
//     version + planned hours, or line planned quantity/unit +
//     installed-as-of total + contributing entry ids + digest),
//     duplicate active is a 409 naming the existing verification,
//     idempotent replay returns the existing verification,
//     idempotency conflict is a 409, and the audit actor is the
//     caller's auth.uid() (there is no caller-supplied actor
//     parameter to forge);
//   - NON-VACUITY (the §10 guard test): a line verification whose
//     progress entry lands after the review, and a step verification
//     whose step version moves after the review, are both refused at
//     submit with SOURCE_CHANGED — the guard fires on a real change,
//     not on a formatting difference. The corrected record is
//     re-based by an update and resubmits cleanly;
//   - State machine: the full legal path in order (DRAFT -> SUBMITTED
//     -> ACCEPTED, RETURNED -> SUBMITTED, REJECTED terminal), every
//     skip refused, RETIRED unreachable through decision, two-person
//     integrity (self-review is a 409), version conflicts refused,
//     submit/accept completeness (line needs its observed quantity,
//     step needs its completion finding, COMPLETE needs checked
//     criteria, submit needs evidence or a substantive note, accept
//     needs a nonempty evidence ref + review statement,
//     UNABLE_TO_VERIFY cannot be accepted);
//   - Update: reasoned correction of DRAFT/RETURNED only, version
//     bump + revision, editing the inspection date re-bases the
//     source snapshot, the target never changes, terminal-package and
//     missing-reason updates refused;
//   - Retire: version-guarded with a reason, retired verifications
//     are immutable, the row and its history stay on file, and retire
//     stays available on a terminal package (the §4 carve-out);
//   - Links: link twice is a 409, a foreign-package bust / change
//     order / progress entry / drawing is refused, unlink is
//     version-guarded and never cascades, links cannot change on an
//     ACCEPTED verification;
//   - Read-only isolation: recording a verification never creates or
//     changes slice-2 progress, never creates/closes/dispositions a
//     bust, never approves a change order, never re-baselines;
//   - Atomic audit: a failed mutation leaves no row and no revision;
//   - RLS: owner isolation, co-owner access, anon sees nothing,
//     direct writes denied (RPC-only write path);
//   - Revision immutability: the trigger refuses UPDATE/DELETE;
//   - Effective ACL matrix for authenticated/anon/service_role, and
//     the internal-helper negative case (no EXECUTE for any app role);
//   - Deletion eligibility: a package that ever held a verification
//     can never be hard-deleted — retired verifications still block;
//   - Source statuses RPC: CURRENT, CHANGED_SINCE_REVIEW after a
//     progress edit, TARGET_RETIRED after the step retires;
//   - Missing prerequisites: a package with no progress entries and
//     no drawing revision still sources cleanly (nulls + empty
//     arrays), and the slice works with no plan-baseline row.
//
// Roles, the auth.uid() stub, workspace_members, and the
// has_workspace_access() copy mirror production; the prerequisite
// tables are the minimal shapes the slice's foreign keys and RPCs
// reference (packages, drawings, takeoff lines with the slice-2
// package_id + unique, progress entries, drawing revisions with the
// slice-7 composite key, steps with the slice-5 composite unique,
// busts, change orders).
//
// A real-PostgreSQL subset (concurrent creates serialized by the
// package row lock, concurrent decisions on the same version, an
// uncommitted write invisible to the sources RPC, ACL matrix,
// same-transaction audit rollback) runs against a scratch PG16 cluster
// when the binaries exist, and SKIPS LOUDLY — never silently — when
// they do not. PGlite is single-connection, so it cannot prove
// concurrent-edit serialization; that leg exists only on real PG.

import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
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
const ANON_UID = "44444444-4444-4444-8444-444444444444";

const SLICE = "20261120000000_forge_work_field_verifications.sql";

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
    designated_verifier text,
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
  create table forge_wp_drawing_revisions (
    owner_id text not null,
    package_id text not null,
    drawing_id text not null,
    id text not null,
    revision_code text not null,
    document_ref text,
    content_sha256 text,
    issued_as text not null,
    issued_at timestamptz not null default now(),
    retired_at timestamptz,
    primary key (owner_id, package_id, drawing_id, id)
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
  create table forge_work_package_busts (
    owner_id text not null,
    id text not null,
    work_package_id text not null,
    status text not null,
    primary key (owner_id, id)
  );
  create table forge_work_change_orders (
    owner_id text not null,
    id text not null,
    work_package_id text not null,
    change_order_number text not null,
    status text not null,
    retired_at timestamptz,
    primary key (owner_id, id)
  );
  -- Minimal shapes for the tables the deletion-blocker function
  -- counts (this migration CREATE OR REPLACEs the blocker with the
  -- 20261113030000 body verbatim + three branches, so the prereq
  -- must carry every table its branches touch — plpgsql resolves
  -- them at execution, not creation). Empty by default; the
  -- deletion-eligibility test asserts only the field-verification
  -- branches.
  create or replace function public.forge_has_app_entitlement(p_owner_id text, p_app text)
  returns boolean language sql stable as $$ select true $$;
  create table forge_work_gate_attestations (owner_id text not null, package_id text not null);
  create table forge_work_package_budget_revisions (owner_id text not null, package_id text not null);
  create table forge_work_gate_evaluations (owner_id text not null, package_id text not null);
  create table forge_work_gate_overrides (owner_id text not null, package_id text not null);
  create table forge_work_link_confirmations (owner_id text not null, link_id text not null);
  create table forge_work_links (
    owner_id text not null, id text not null,
    source_domain text, source_type text, source_id text,
    target_domain text, target_type text, target_id text
  );
  create table forge_work_manpower_days (owner_id text not null, package_id text not null);
  create table forge_work_inspection_observations (owner_id text not null, package_id text not null);
  create table forge_work_package_baselines (owner_id text not null, package_id text not null);
  create table forge_work_progress_snapshots (owner_id text not null, package_id text not null);
  create table forge_work_scope_baselines (owner_id text not null, package_id text not null);
  create table forge_work_scope_changes (owner_id text not null, package_id text not null);
  create table forge_work_package_transitions (owner_id text not null, package_id text not null);
  create table forge_work_weekly_commitments (owner_id text not null, package_id text not null);
  create table forge_work_permit_annotations (
    owner_id text not null, id text not null, work_package_id text not null, retired_at timestamptz
  );
  create table forge_work_permit_annotation_revisions (owner_id text not null, annotation_id text not null);
  create table forge_work_craft_assignments (
    owner_id text not null, id text not null, work_package_id text not null, retired_at timestamptz
  );
  create table forge_work_craft_assignment_revisions (owner_id text not null, assignment_id text not null);
  create table forge_work_step_revisions (owner_id text not null, step_id text not null);
  create table forge_work_control_estimates (
    owner_id text not null, id text not null, work_package_id text not null, retired_at timestamptz
  );
  create table forge_work_control_estimate_revisions (owner_id text not null, estimate_id text not null);
  create table forge_work_change_order_revisions (owner_id text not null, change_order_id text not null);
  create table forge_work_craft_rates (
    owner_id text not null, id text not null, work_package_id text not null, retired_at timestamptz
  );
  create table forge_work_craft_rate_revisions (owner_id text not null, craft_rate_id text not null);
  grant select on forge_work_packages to authenticated;
  grant select on forge_work_drawings to authenticated;
  grant select on forge_work_takeoff_lines to authenticated;
  grant select on forge_work_progress_entries to authenticated;
  grant select on forge_wp_drawing_revisions to authenticated;
  grant select on forge_work_steps to authenticated;
  grant select on forge_work_package_busts to authenticated;
  grant select on forge_work_change_orders to authenticated;
`;

const SEED_SQL = `
  insert into forge_work_packages (owner_id, id, status, designated_verifier) values
    ('${OWNER_A}', 'pkg_a', 'in_progress', null),
    ('${OWNER_A}', 'pkg_cancelled', 'cancelled', null),
    ('${OWNER_A}', 'pkg_closed', 'verified_closed', null),
    ('${OWNER_A}', 'pkg_noplan', 'in_progress', null),
    ('${OWNER_B}', 'pkg_b', 'in_progress', null);
  insert into forge_work_drawings (owner_id, package_id, id, drawing_number) values
    ('${OWNER_A}', 'pkg_a', 'dwg_1', 'W-0005-1'),
    ('${OWNER_A}', 'pkg_a', 'dwg_2', 'C-201'),
    ('${OWNER_A}', 'pkg_noplan', 'dwg_np', 'N-001'),
    ('${OWNER_B}', 'pkg_b', 'dwg_b', 'B-001');
  insert into forge_work_takeoff_lines (owner_id, id, drawing_id, package_id, quantity, unit) values
    ('${OWNER_A}', 'line_1', 'dwg_1', 'pkg_a', 10, 'EA'),
    ('${OWNER_A}', 'line_2', 'dwg_1', 'pkg_a', 5, 'LF'),
    ('${OWNER_A}', 'line_np', 'dwg_np', 'pkg_noplan', 4, 'EA'),
    ('${OWNER_B}', 'line_b', 'dwg_b', 'pkg_b', 7, 'EA');
  insert into forge_work_progress_entries (owner_id, id, work_package_id, takeoff_line_id, work_date, installed_quantity, voided_at) values
    ('${OWNER_A}', 'entry_1', 'pkg_a', 'line_1', '2026-11-14', 12.5, null),
    ('${OWNER_A}', 'entry_2', 'pkg_a', 'line_1', '2026-11-16', 3, '2026-11-16T10:00:00Z'),
    ('${OWNER_A}', 'entry_3', 'pkg_a', 'line_1', '2026-11-20', 1, null),
    ('${OWNER_A}', 'entry_4', 'pkg_a', 'line_2', '2026-11-14', 4, null);
  insert into forge_wp_drawing_revisions (owner_id, package_id, drawing_id, id, revision_code, document_ref, content_sha256, issued_as, issued_at, retired_at) values
    ('${OWNER_A}', 'pkg_a', 'dwg_1', 'rev_r1', 'R1', 'doc://r1', 'sha256-r1', 'IFA', '2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z'),
    ('${OWNER_A}', 'pkg_a', 'dwg_1', 'rev_r2', 'R2', 'doc://r2', 'sha256-r2', 'IFC', '2026-11-12T00:00:00Z', null),
    ('${OWNER_B}', 'pkg_b', 'dwg_b', 'rev_b1', 'R1', 'doc://b1', 'sha256-b1', 'IFC', '2026-11-01T00:00:00Z', null);
  insert into forge_work_steps (owner_id, id, work_package_id, title, sequence_no, craft_key, craft_label, planned_duration_days, planned_person_hours, version, retired_at) values
    ('${OWNER_A}', 'step_1', 'pkg_a', 'Fabricate spool', 1, 'pipefitters', 'Pipefitters', 4, 40, 1, null),
    ('${OWNER_A}', 'step_2', 'pkg_a', 'Weld spool', 2, 'welders', 'Welders', 2, 20, 1, '2026-11-12T00:00:00Z'),
    ('${OWNER_B}', 'step_b', 'pkg_b', 'Other step', 1, 'pipefitters', 'Pipefitters', 1, 5, 1, null);
  insert into forge_work_package_busts (owner_id, id, work_package_id, status) values
    ('${OWNER_A}', 'bust_1', 'pkg_a', 'OPEN'),
    ('${OWNER_B}', 'bust_b', 'pkg_b', 'OPEN');
  insert into forge_work_change_orders (owner_id, id, work_package_id, change_order_number, status) values
    ('${OWNER_A}', 'co_1', 'pkg_a', 'CO-001', 'estimated'),
    ('${OWNER_A}', 'co_2', 'pkg_a', 'CO-002', 'approved'),
    ('${OWNER_B}', 'co_b', 'pkg_b', 'CO-B1', 'approved');
  insert into workspace_members (owner_id, member_user_id, status, role)
    values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
`;

async function setupDb() {
  const db = new PGlite();
  await db.exec(PREREQ_SQL);
  await db.exec(SEED_SQL);
  await db.exec(loadMigrationSql(SLICE));
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

async function sources(db, uid, packageId, targetType, targetId, asOf = "2026-11-15") {
  const { rows } = await asUser(db, uid, `
    select forge_work_field_verification_sources(
      '${OWNER_A}', '${packageId}', ${sqlStr(targetType)}, ${sqlStr(targetId)}, ${sqlStr(asOf)}) as src;
  `);
  return rows[0].src;
}

async function createVerification(db, uid, overrides = {}) {
  const input = {
    packageId: "pkg_a",
    targetType: "WORK_STEP",
    stepId: "step_1",
    takeoffLineId: null,
    workLocation: "FIELD",
    inspectionDate: "2026-11-15",
    sourceCheckedAt: "2026-11-15T12:00:00Z",
    sourceDrawingRevisionId: null,
    scopeBaselineId: null,
    scopeBaselineVersion: null,
    observedInstalledQuantity: null,
    observedBasis: null,
    physicalCompletion: "PARTIALLY_COMPLETE",
    acceptanceCriteriaChecked: null,
    fieldReportedHours: 42,
    fieldHoursSource: "Foreman daily log, 2026-11-15",
    observationNote: "Spool welded and aligned against IFC revision R2.",
    evidenceRef: "field-photo-2026-11-15-01.jpg",
    evidenceSummary: null,
    sourceFingerprint: null,
    requestId: null,
    supersedesVerificationId: null,
    reason: null,
    ...overrides,
  };
  if (input.sourceFingerprint === null) {
    const src = await sources(db, uid, input.packageId, input.targetType,
      input.targetType === "WORK_STEP" ? input.stepId : input.takeoffLineId, input.inspectionDate);
    input.sourceFingerprint = src.sourceFingerprint;
  }
  const { rows } = await asUser(db, uid, `
    select * from forge_work_field_verification_create(
      '${OWNER_A}', '${input.packageId}', ${sqlStr(input.targetType)},
      ${sqlStr(input.stepId)}, ${sqlStr(input.takeoffLineId)}, ${sqlStr(input.workLocation)},
      ${sqlStr(input.inspectionDate)}, ${sqlStr(input.sourceCheckedAt)},
      ${sqlStr(input.sourceDrawingRevisionId)}, ${sqlStr(input.scopeBaselineId)},
      ${sqlNum(input.scopeBaselineVersion)}, ${sqlNum(input.observedInstalledQuantity)},
      ${sqlStr(input.observedBasis)}, ${sqlStr(input.physicalCompletion)},
      ${sqlStr(input.acceptanceCriteriaChecked)}, ${sqlNum(input.fieldReportedHours)},
      ${sqlStr(input.fieldHoursSource)}, ${sqlStr(input.observationNote)},
      ${sqlStr(input.evidenceRef)}, ${sqlStr(input.evidenceSummary)},
      ${sqlStr(input.sourceFingerprint)}, ${sqlStr(input.requestId)},
      ${sqlStr(input.supersedesVerificationId)}, ${sqlStr(input.reason)});
  `);
  return rows[0];
}

async function decideVerification(db, uid, verificationId, action, version, overrides = {}) {
  const input = {
    sourceFingerprint: null,
    reason: null,
    reviewNote: null,
    requestId: null,
    ...overrides,
  };
  const { rows } = await asUser(db, uid, `
    select * from forge_work_field_verification_decision(
      '${OWNER_A}', ${sqlStr(verificationId)}, ${sqlStr(action)},
      ${sqlNum(version)}, ${sqlStr(input.sourceFingerprint)},
      ${sqlStr(input.reason)}, ${sqlStr(input.reviewNote)}, ${sqlStr(input.requestId)});
  `);
  return rows[0];
}

async function updateVerification(db, uid, verificationId, version, reason, overrides = {}) {
  const input = {
    workLocation: null, setWorkLocation: false,
    inspectionDate: null, setInspectionDate: false,
    sourceCheckedAt: null, setSourceCheckedAt: false,
    sourceDrawingRevisionId: null, setSourceDrawingRevisionId: false,
    observedInstalledQuantity: null, setObservedInstalledQuantity: false,
    observedBasis: null, setObservedBasis: false,
    physicalCompletion: null, setPhysicalCompletion: false,
    acceptanceCriteriaChecked: null, setAcceptanceCriteriaChecked: false,
    fieldReportedHours: null, setFieldReportedHours: false,
    fieldHoursSource: null, setFieldHoursSource: false,
    observationNote: null, setObservationNote: false,
    evidenceRef: null, setEvidenceRef: false,
    evidenceSummary: null, setEvidenceSummary: false,
    ...overrides,
  };
  const { rows } = await asUser(db, uid, `
    select * from forge_work_field_verification_update(
      '${OWNER_A}', ${sqlStr(verificationId)}, ${sqlNum(version)},
      ${sqlStr(input.workLocation)}, ${input.setWorkLocation},
      ${sqlStr(input.inspectionDate)}, ${input.setInspectionDate},
      ${sqlStr(input.sourceCheckedAt)}, ${input.setSourceCheckedAt},
      ${sqlStr(input.sourceDrawingRevisionId)}, ${input.setSourceDrawingRevisionId},
      ${sqlNum(input.observedInstalledQuantity)}, ${input.setObservedInstalledQuantity},
      ${sqlStr(input.observedBasis)}, ${input.setObservedBasis},
      ${sqlStr(input.physicalCompletion)}, ${input.setPhysicalCompletion},
      ${sqlStr(input.acceptanceCriteriaChecked)}, ${input.setAcceptanceCriteriaChecked},
      ${sqlNum(input.fieldReportedHours)}, ${input.setFieldReportedHours},
      ${sqlStr(input.fieldHoursSource)}, ${input.setFieldHoursSource},
      ${sqlStr(input.observationNote)}, ${input.setObservationNote},
      ${sqlStr(input.evidenceRef)}, ${input.setEvidenceRef},
      ${sqlStr(input.evidenceSummary)}, ${input.setEvidenceSummary},
      ${sqlStr(reason)});
  `);
  return rows[0];
}

async function retireVerification(db, uid, verificationId, version, reason) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_field_verification_retire(
      '${OWNER_A}', ${sqlStr(verificationId)}, ${sqlNum(version)}, ${sqlStr(reason)});
  `);
  return rows[0];
}

async function linkVerification(db, uid, verificationId, targetKind, targetId, requestId = null) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_field_verification_link(
      '${OWNER_A}', ${sqlStr(verificationId)}, ${sqlStr(targetKind)},
      ${sqlStr(targetId)}, ${sqlStr(requestId)}, null);
  `);
  return rows[0];
}

async function unlinkVerification(db, uid, linkId, version, reason) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_field_verification_unlink(
      '${OWNER_A}', ${sqlStr(linkId)}, ${sqlNum(version)}, ${sqlStr(reason)});
  `);
  return rows[0];
}

async function countRows(db, sql) {
  const { rows } = await db.query(sql);
  return Number(rows[0].n);
}

describe("field verification migration: PGlite battery", () => {
  let db;
  beforeEach(async () => {
    db = await setupDb();
  }, 60000);

  it60("creates exactly the three new tables and the thirteen functions", async () => {
    const { rows: tables } = await db.query(`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name like 'forge_work_field_verification%'
      order by table_name;
    `);
    expect(tables.map((r) => r.table_name)).toEqual([
      "forge_work_field_verification_links",
      "forge_work_field_verification_revisions",
      "forge_work_field_verifications",
    ]);
    const { rows: functions } = await db.query(`
      select proname from pg_proc
      where proname like 'forge_work_field_verification%'
        and pronamespace = 'public'::regnamespace
      order by proname;
    `);
    expect(functions.map((r) => r.proname)).toEqual([
      "forge_work_field_verification_canonical_number",
      "forge_work_field_verification_check_decimal",
      "forge_work_field_verification_compute_fingerprint",
      "forge_work_field_verification_create",
      "forge_work_field_verification_decision",
      "forge_work_field_verification_idempotency_check",
      "forge_work_field_verification_link",
      "forge_work_field_verification_retire",
      "forge_work_field_verification_revisions_immutable",
      "forge_work_field_verification_source_statuses",
      "forge_work_field_verification_sources",
      "forge_work_field_verification_unlink",
      "forge_work_field_verification_update",
    ]);
  });

  it60("sources RPC: one statement returns the line, its planned figures, installed-as-of, entry ids, fingerprint, drawing + latest revision", async () => {
    const before = await countRows(db, "select count(*)::int as n from forge_work_field_verifications");
    const src = await sources(db, OWNER_A, "pkg_a", "TAKEOFF_LINE", "line_1", "2026-11-15");
    expect(src.packageStatus).toBe("in_progress");
    expect(src.targetType).toBe("TAKEOFF_LINE");
    expect(src.targetId).toBe("line_1");
    // The sources RPC returns jsonb, so numerics arrive as JS
    // numbers here — unlike the rowtype returns below, where the pg
    // driver renders NUMERIC columns as strings ("10.0000").
    expect(src.plannedLineQuantity).toBe(10);
    expect(src.unit).toBe("EA");
    // entry_1 (2026-11-14, 12.5) counts; entry_2 is voided; entry_3
    // (2026-11-20) is after the as-of date.
    expect(src.installedAsOf).toBe(12.5);
    expect(src.progressEntryIds).toEqual(["entry_1"]);
    expect(src.sourceFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(src.sourceProgressDigest).toMatch(/^[a-f0-9]{32}$/);
    expect(src.drawingId).toBe("dwg_1");
    expect(src.drawingNumber).toBe("W-0005-1");
    expect(src.latestRevision.revisionCode).toBe("R2");
    expect(src.latestRevision.issuedAs).toBe("IFC");
    expect(src.latestRevision.retired).toBe(false);
    // Read-only: calling the sources RPC twice writes nothing.
    await sources(db, OWNER_A, "pkg_a", "TAKEOFF_LINE", "line_1", "2026-11-15");
    const after = await countRows(db, "select count(*)::int as n from forge_work_field_verifications");
    expect(after).toBe(before);
  });

  it60("sources RPC: step preview carries the step version and planned hours, no progress figures", async () => {
    const src = await sources(db, OWNER_A, "pkg_a", "WORK_STEP", "step_1", "2026-11-15");
    expect(src.targetType).toBe("WORK_STEP");
    expect(src.targetLabel).toBe("Fabricate spool");
    expect(src.targetRetired).toBe(false);
    expect(src.stepVersion).toBe(1);
    expect(src.plannedStepHours).toBe(40);
    expect(src.craftKey).toBe("pipefitters");
    expect(src.installedAsOf).toBeNull();
    expect(src.progressEntryIds).toBeNull();
    expect(src.sourceFingerprint).toMatch(/^[a-f0-9]{32}$/);
  });

  it60("sources RPC: a retired step still previews (history stays readable) and flags targetRetired", async () => {
    const src = await sources(db, OWNER_A, "pkg_a", "WORK_STEP", "step_2", "2026-11-15");
    expect(src.targetRetired).toBe(true);
    expect(src.stepVersion).toBe(1);
  });

  it60("sources RPC: cross-package target, foreign workspace, and future as-of are refused", async () => {
    await expectRpcError(
      sources(db, OWNER_A, "pkg_a", "WORK_STEP", "step_b", "2026-11-15"),
      "WPPFV_INVALID_TARGET",
    );
    await expectRpcError(
      asUser(db, OWNER_B, `
        select forge_work_field_verification_sources(
          '${OWNER_A}', 'pkg_a', 'WORK_STEP', 'step_1', '2026-11-15');
      `),
      "WPPFV_WORKSPACE_FORBIDDEN",
    );
    await expectRpcError(
      sources(db, OWNER_A, "pkg_a", "WORK_STEP", "step_1", "2999-01-01"),
      "WPPFV_INVALID_VALUE",
    );
  });

  it60("sources RPC: a package with no progress entries and no revision still sources cleanly (no baseline row needed)", async () => {
    const src = await sources(db, OWNER_A, "pkg_noplan", "TAKEOFF_LINE", "line_np", "2026-11-15");
    expect(src.plannedLineQuantity).toBe(4);
    expect(src.installedAsOf).toBe(0);
    expect(src.progressEntryIds).toEqual([]);
    expect(src.latestRevision).toBeNull();
    expect(src.sourceFingerprint).toMatch(/^[a-f0-9]{32}$/);
  });

  it60("create: step verification takes its snapshot server-side (version + planned hours) and the actor is auth.uid()", async () => {
    const src = await sources(db, OWNER_A, "pkg_a", "WORK_STEP", "step_1", "2026-11-15");
    const ver = await createVerification(db, OWNER_A);
    expect(ver.status).toBe("DRAFT");
    expect(ver.version).toBe(1);
    expect(ver.source_step_version).toBe(1);
    expect(ver.planned_step_hours).toBe("40.00");
    expect(ver.source_fingerprint).toBe(src.sourceFingerprint);
    expect(ver.created_by).toBe(OWNER_A);
    expect(ver.updated_by).toBe(OWNER_A);
    expect(ver.source_progress_entry_ids).toBeNull();
    const { rows } = await db.query(`
      select * from forge_work_field_verification_revisions
      where verification_id = '${ver.id}' order by version;
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("create");
    expect(rows[0].actor_id).toBe(OWNER_A);
  });

  it60("create: line verification snapshots planned quantity, installed-as-of, entry ids, and digest server-side", async () => {
    const ver = await createVerification(db, OWNER_A, {
      targetType: "TAKEOFF_LINE", stepId: null, takeoffLineId: "line_1",
      physicalCompletion: null, fieldReportedHours: null, fieldHoursSource: null,
      observedInstalledQuantity: 12.5, observedBasis: "Counted on the rack",
      sourceDrawingRevisionId: "rev_r2",
    });
    expect(ver.status).toBe("DRAFT");
    expect(ver.planned_line_quantity).toBe("10.0000");
    expect(ver.unit).toBe("EA");
    expect(ver.source_progress_total_quantity).toBe("12.5000");
    expect(ver.source_progress_entry_ids).toEqual(["entry_1"]);
    expect(ver.source_drawing_id).toBe("dwg_1");
    expect(ver.source_drawing_revision_id).toBe("rev_r2");
    expect(ver.progress_as_of).toBeDefined();
    expect(new Date(ver.progress_as_of).toISOString()).toBe("2026-11-15T00:00:00.000Z");
  });

  it60("create: a retired drawing revision cannot be the source of a new observation", async () => {
    await expectRpcError(
      createVerification(db, OWNER_A, {
        targetType: "TAKEOFF_LINE", stepId: null, takeoffLineId: "line_1",
        physicalCompletion: null, fieldReportedHours: null, fieldHoursSource: null,
        observedInstalledQuantity: 12.5, sourceDrawingRevisionId: "rev_r1",
      }),
      "WPPFV_INVALID_TARGET",
    );
  });

  it60("create: a stale caller fingerprint is a 409", async () => {
    await expectRpcError(
      createVerification(db, OWNER_A, { sourceFingerprint: "0".repeat(32) }),
      "WPPFV_SOURCE_CHANGED",
    );
  });

  it60("create: duplicate active observation is a 409 naming the existing verification; rejection frees the slot", async () => {
    const ver = await createVerification(db, OWNER_A, { requestId: "req-dup-1" });
    await expectRpcError(
      createVerification(db, OWNER_A, { requestId: "req-dup-2" }),
      "WPPFV_DUPLICATE_ACTIVE",
    );
    // The 409 names the existing verification.
    let caught = null;
    try {
      await createVerification(db, OWNER_A, { requestId: "req-dup-3" });
    } catch (error) {
      caught = error;
    }
    expect(String(caught.message)).toContain(ver.id);
    // Reject the original, then the same observation records cleanly.
    const submitted = await decideVerification(db, OWNER_A, ver.id, "submit", ver.version, {
      sourceFingerprint: ver.source_fingerprint,
    });
    await decideVerification(db, MEMBER_C, ver.id, "reject", submitted.version, {
      reason: "The cited drawing is the wrong revision.",
    });
    const again = await createVerification(db, OWNER_A, { requestId: "req-dup-4" });
    expect(again.status).toBe("DRAFT");
    expect(again.id).not.toBe(ver.id);
  });

  it60("create: idempotent replay returns the existing verification; same request id with different values conflicts", async () => {
    const first = await createVerification(db, OWNER_A, { requestId: "req-idem-1" });
    const replay = await createVerification(db, OWNER_A, { requestId: "req-idem-1" });
    expect(replay.id).toBe(first.id);
    expect(await countRows(db, "select count(*)::int as n from forge_work_field_verifications")).toBe(1);
    await expectRpcError(
      createVerification(db, OWNER_A, {
        requestId: "req-idem-1",
        observationNote: "A different observation under the same request id.",
      }),
      "WPPFV_IDEMPOTENCY_CONFLICT",
    );
  });

  it60("create: cross-package target, retired step, terminal package, foreign workspace, and bad fields are refused", async () => {
    await expectRpcError(
      createVerification(db, OWNER_A, { stepId: "step_b" }),
      "WPPFV_INVALID_TARGET",
    );
    await expectRpcError(
      createVerification(db, OWNER_A, { stepId: "step_2" }),
      "WPPFV_TARGET_RETIRED",
    );
    // The helper fetches the fingerprint via sources() first; an
    // explicit fingerprint skips that call, so the create RPC's own
    // terminal-package gate is what answers (sources would raise
    // INVALID_TARGET for step_1 in the cancelled package instead).
    await expectRpcError(
      createVerification(db, OWNER_A, { packageId: "pkg_cancelled", sourceFingerprint: "0".repeat(32) }),
      "WPPFV_PACKAGE_TERMINAL",
    );
    await expectRpcError(
      createVerification(db, OWNER_A, { packageId: "pkg_closed", sourceFingerprint: "0".repeat(32) }),
      "WPPFV_PACKAGE_TERMINAL",
    );
    await expectRpcError(
      asUser(db, OWNER_B, `
        select * from forge_work_field_verification_create(
          '${OWNER_A}', 'pkg_a', 'WORK_STEP', 'step_1', null, 'FIELD',
          '2026-11-15', '2026-11-15T12:00:00Z', null, null, null,
          null, null, 'PARTIALLY_COMPLETE', null, 42, 'Foreman daily log',
          'Spool welded.', null, null, '${"a".repeat(32)}', null, null, null);
      `),
      "WPPFV_WORKSPACE_FORBIDDEN",
    );
    await expectRpcError(
      createVerification(db, OWNER_A, { inspectionDate: "2999-01-01" }),
      "WPPFV_INVALID_VALUE",
    );
    await expectRpcError(
      createVerification(db, OWNER_A, { observationNote: "" }),
      "WPPFV_INVALID_EVIDENCE",
    );
    await expectRpcError(
      createVerification(db, OWNER_A, { physicalCompletion: "COMPLETE", acceptanceCriteriaChecked: null }),
      "WPPFV_INVALID_VALUE",
    );
    await expectRpcError(
      createVerification(db, OWNER_A, { fieldReportedHours: 6, fieldHoursSource: null }),
      "WPPFV_INVALID_VALUE",
    );
    await expectRpcError(
      createVerification(db, OWNER_A, { observedInstalledQuantity: 3 }),
      "WPPFV_INVALID_TARGET",
    );
  });

  it60("NON-VACUITY (line): a progress entry landing after the review refuses the submit with SOURCE_CHANGED", async () => {
    const ver = await createVerification(db, OWNER_A, {
      targetType: "TAKEOFF_LINE", stepId: null, takeoffLineId: "line_1",
      physicalCompletion: null, fieldReportedHours: null, fieldHoursSource: null,
      observedInstalledQuantity: 12.5, observedBasis: "Counted on the rack",
    });
    // A new non-void entry inside the window moves the live fingerprint.
    await db.query(`
      insert into forge_work_progress_entries (owner_id, id, work_package_id, takeoff_line_id, work_date, installed_quantity, voided_at)
      values ('${OWNER_A}', 'entry_new', 'pkg_a', 'line_1', '2026-11-15', 2, null);
    `);
    await expectRpcError(
      decideVerification(db, OWNER_A, ver.id, "submit", ver.version, {
        sourceFingerprint: ver.source_fingerprint,
      }),
      "WPPFV_SOURCE_CHANGED",
    );
    // The record is NOT silently accepted — and the correction path
    // works: an update re-bases the snapshot, then the resubmit
    // carries the fresh fingerprint.
    const updated = await updateVerification(db, OWNER_A, ver.id, ver.version,
      "Progress landed after the review; re-basing to the current source.",
      { setObservationNote: true, observationNote: "Twelve and a half installed; two more recorded since." });
    expect(updated.source_progress_total_quantity).toBe("14.5000");
    expect(updated.source_progress_entry_ids).toEqual(["entry_1", "entry_new"]);
    expect(updated.source_fingerprint).not.toBe(ver.source_fingerprint);
    const submitted = await decideVerification(db, OWNER_A, ver.id, "submit", updated.version, {
      sourceFingerprint: updated.source_fingerprint,
    });
    expect(submitted.status).toBe("SUBMITTED");
  });

  it60("NON-VACUITY (step): a step version moving after the review refuses the submit with SOURCE_CHANGED", async () => {
    const ver = await createVerification(db, OWNER_A);
    await db.query(`
      update forge_work_steps set version = 2, planned_person_hours = 45
      where owner_id = '${OWNER_A}' and id = 'step_1';
    `);
    await expectRpcError(
      decideVerification(db, OWNER_A, ver.id, "submit", ver.version, {
        sourceFingerprint: ver.source_fingerprint,
      }),
      "WPPFV_SOURCE_CHANGED",
    );
  });

  it60("state machine: the full legal path in order, with two-person review", async () => {
    const ver = await createVerification(db, OWNER_A);
    const submitted = await decideVerification(db, OWNER_A, ver.id, "submit", ver.version, {
      sourceFingerprint: ver.source_fingerprint,
    });
    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.submitted_by).toBe(OWNER_A);
    expect(submitted.submitted_at).not.toBeNull();
    // The submitter cannot review their own work.
    await expectRpcError(
      decideVerification(db, OWNER_A, ver.id, "accept", submitted.version, {
        sourceFingerprint: submitted.source_fingerprint,
        reviewNote: "Looks good.",
      }),
      "WPPFV_SELF_REVIEW",
    );
    // The co-owner accepts with a review statement.
    const accepted = await decideVerification(db, MEMBER_C, ver.id, "accept", submitted.version, {
      sourceFingerprint: submitted.source_fingerprint,
      reviewNote: "Checked the welds against IFC revision R2; matches.",
    });
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.reviewed_by).toBe(MEMBER_C);
    expect(accepted.review_note).toBe("Checked the welds against IFC revision R2; matches.");
    // No way back from ACCEPTED except retire.
    await expectRpcError(
      decideVerification(db, MEMBER_C, ver.id, "submit", accepted.version, {
        sourceFingerprint: accepted.source_fingerprint,
      }),
      "WPPFV_INVALID_TRANSITION",
    );
  });

  it60("state machine: return -> correct -> resubmit, and reject is terminal", async () => {
    const ver = await createVerification(db, OWNER_A);
    const submitted = await decideVerification(db, OWNER_A, ver.id, "submit", ver.version, {
      sourceFingerprint: ver.source_fingerprint,
    });
    const returned = await decideVerification(db, MEMBER_C, ver.id, "return", submitted.version, {
      reason: "The evidence photo is blurry; retake it.",
    });
    expect(returned.status).toBe("RETURNED");
    const resubmitted = await decideVerification(db, OWNER_A, ver.id, "submit", returned.version, {
      sourceFingerprint: returned.source_fingerprint,
    });
    expect(resubmitted.status).toBe("SUBMITTED");
    const rejected = await decideVerification(db, MEMBER_C, ver.id, "reject", resubmitted.version, {
      reason: "The observation contradicts the drawing.",
    });
    expect(rejected.status).toBe("REJECTED");
    await expectRpcError(
      decideVerification(db, OWNER_A, ver.id, "submit", rejected.version, {
        sourceFingerprint: rejected.source_fingerprint,
      }),
      "WPPFV_INVALID_TRANSITION",
    );
  });

  it60("state machine: skips are refused (DRAFT cannot be accepted, RETURNED cannot be accepted)", async () => {
    const ver = await createVerification(db, OWNER_A);
    await expectRpcError(
      decideVerification(db, MEMBER_C, ver.id, "accept", ver.version, {
        sourceFingerprint: ver.source_fingerprint,
        reviewNote: "Skipping review.",
      }),
      "WPPFV_INVALID_TRANSITION",
    );
    const submitted = await decideVerification(db, OWNER_A, ver.id, "submit", ver.version, {
      sourceFingerprint: ver.source_fingerprint,
    });
    const returned = await decideVerification(db, MEMBER_C, ver.id, "return", submitted.version, {
      reason: "Missing proof.",
    });
    await expectRpcError(
      decideVerification(db, MEMBER_C, ver.id, "accept", returned.version, {
        sourceFingerprint: returned.source_fingerprint,
        reviewNote: "Accepting a returned record without a resubmit.",
      }),
      "WPPFV_INVALID_TRANSITION",
    );
  });

  it60("decision completeness: submit needs the target's required fields and evidence; accept needs evidence + a review statement", async () => {
    // A line without an observed quantity cannot be submitted.
    const line = await createVerification(db, OWNER_A, {
      targetType: "TAKEOFF_LINE", stepId: null, takeoffLineId: "line_1",
      physicalCompletion: null, fieldReportedHours: null, fieldHoursSource: null,
      observedInstalledQuantity: null,
    });
    await expectRpcError(
      decideVerification(db, OWNER_A, line.id, "submit", line.version, {
        sourceFingerprint: line.source_fingerprint,
      }),
      "WPPFV_INCOMPLETE_OBSERVATION",
    );
    // A step with a short note and no evidence ref cannot be submitted.
    const short = await createVerification(db, OWNER_A, {
      observationNote: "Checked.", evidenceRef: null, inspectionDate: "2026-11-14",
    });
    await expectRpcError(
      decideVerification(db, OWNER_A, short.id, "submit", short.version, {
        sourceFingerprint: short.source_fingerprint,
      }),
      "WPPFV_INCOMPLETE_OBSERVATION",
    );
    // A step with a substantive note (no evidence ref) submits — but
    // acceptance still needs an evidence ref and a review statement.
    const noted = await createVerification(db, OWNER_A, {
      observationNote: "Spool welded, aligned, and pressure-tested against IFC revision R2.",
      evidenceRef: null, inspectionDate: "2026-11-13",
    });
    const submitted = await decideVerification(db, OWNER_A, noted.id, "submit", noted.version, {
      sourceFingerprint: noted.source_fingerprint,
    });
    expect(submitted.status).toBe("SUBMITTED");
    await expectRpcError(
      decideVerification(db, MEMBER_C, noted.id, "accept", submitted.version, {
        sourceFingerprint: submitted.source_fingerprint,
        reviewNote: "Checked.",
      }),
      "WPPFV_INCOMPLETE_OBSERVATION",
    );
    await expectRpcError(
      decideVerification(db, MEMBER_C, noted.id, "accept", submitted.version, {
        sourceFingerprint: submitted.source_fingerprint,
        reviewNote: "",
      }),
      "WPPFV_REVIEW_NOTE_REQUIRED",
    );
  });

  it60("decision completeness: UNABLE_TO_VERIFY cannot be accepted", async () => {
    const ver = await createVerification(db, OWNER_A, { physicalCompletion: "UNABLE_TO_VERIFY" });
    const submitted = await decideVerification(db, OWNER_A, ver.id, "submit", ver.version, {
      sourceFingerprint: ver.source_fingerprint,
    });
    await expectRpcError(
      decideVerification(db, MEMBER_C, ver.id, "accept", submitted.version, {
        sourceFingerprint: submitted.source_fingerprint,
        reviewNote: "Could not verify.",
      }),
      "WPPFV_INCOMPLETE_OBSERVATION",
    );
    // Returning it is the correct outcome for an unverifiable step.
    const returned = await decideVerification(db, MEMBER_C, ver.id, "return", submitted.version, {
      reason: "Access was blocked; re-inspect when the area opens.",
    });
    expect(returned.status).toBe("RETURNED");
  });

  it60("decision: version conflict and missing reason/review note are refused; decision replay is idempotent", async () => {
    const ver = await createVerification(db, OWNER_A);
    await expectRpcError(
      decideVerification(db, OWNER_A, ver.id, "submit", ver.version + 1, {
        sourceFingerprint: ver.source_fingerprint,
      }),
      "WPPFV_VERSION_CONFLICT",
    );
    const submitted = await decideVerification(db, OWNER_A, ver.id, "submit", ver.version, {
      sourceFingerprint: ver.source_fingerprint,
      requestId: "req-decide-1",
    });
    // The same request id + actor + action replays to the current row.
    const replay = await decideVerification(db, OWNER_A, ver.id, "submit", submitted.version, {
      sourceFingerprint: ver.source_fingerprint,
      requestId: "req-decide-1",
    });
    expect(replay.id).toBe(ver.id);
    expect(replay.status).toBe("SUBMITTED");
    await expectRpcError(
      decideVerification(db, MEMBER_C, ver.id, "return", submitted.version, { reason: "" }),
      "WPPFV_REASON_REQUIRED",
    );
  });

  it60("update: reasoned correction bumps the version, writes a revision, and re-bases the snapshot on a new inspection date", async () => {
    const ver = await createVerification(db, OWNER_A, {
      targetType: "TAKEOFF_LINE", stepId: null, takeoffLineId: "line_1",
      physicalCompletion: null, fieldReportedHours: null, fieldHoursSource: null,
      observedInstalledQuantity: 12.5, observedBasis: "Counted on the rack",
    });
    const updated = await updateVerification(db, OWNER_A, ver.id, ver.version,
      "Inspection date was wrong; it was the 14th.",
      { setInspectionDate: true, inspectionDate: "2026-11-14",
        setObservationNote: true, observationNote: "Counted on the rack on the 14th." });
    expect(updated.version).toBe(2);
    expect(new Date(updated.inspection_date).toISOString()).toBe("2026-11-14T00:00:00.000Z");
    // Re-based: entry_1 (11-14) is the only contributor on the 14th.
    expect(updated.source_progress_total_quantity).toBe("12.5000");
    expect(new Date(updated.progress_as_of).toISOString()).toBe("2026-11-14T00:00:00.000Z");
    const { rows } = await db.query(`
      select * from forge_work_field_verification_revisions
      where verification_id = '${ver.id}' order by version;
    `);
    expect(rows).toHaveLength(2);
    expect(rows[1].action).toBe("update");
    expect(rows[1].reason).toBe("Inspection date was wrong; it was the 14th.");
  });

  it60("update: SUBMITTED verifications, missing reasons, and version conflicts are refused", async () => {
    const ver = await createVerification(db, OWNER_A);
    const submitted = await decideVerification(db, OWNER_A, ver.id, "submit", ver.version, {
      sourceFingerprint: ver.source_fingerprint,
    });
    await expectRpcError(
      updateVerification(db, OWNER_A, ver.id, submitted.version, "Fixing a typo.",
        { setObservationNote: true, observationNote: "Too late." }),
      "WPPFV_INVALID_TRANSITION",
    );
    await expectRpcError(
      updateVerification(db, OWNER_A, ver.id, ver.version, "",
        { setObservationNote: true, observationNote: "No reason given." }),
      "WPPFV_REASON_REQUIRED",
    );
    await expectRpcError(
      updateVerification(db, OWNER_A, ver.id, ver.version + 5, "Wrong version.",
        { setObservationNote: true, observationNote: "Stale." }),
      "WPPFV_VERSION_CONFLICT",
    );
  });

  it60("retire: version-guarded with a reason; retired verifications are immutable and stay on file", async () => {
    const ver = await createVerification(db, OWNER_A);
    await expectRpcError(
      retireVerification(db, OWNER_A, ver.id, ver.version, ""),
      "WPPFV_REASON_REQUIRED",
    );
    const retired = await retireVerification(db, OWNER_A, ver.id, ver.version,
      "Recorded against the wrong step.");
    expect(retired.status).toBe("RETIRED");
    expect(retired.retired_by).toBe(OWNER_A);
    expect(retired.retirement_reason).toBe("Recorded against the wrong step.");
    await expectRpcError(
      updateVerification(db, OWNER_A, ver.id, retired.version, "Too late.",
        { setObservationNote: true, observationNote: "No." }),
      "WPPFV_RETIRED",
    );
    await expectRpcError(
      retireVerification(db, OWNER_A, ver.id, retired.version, "Again."),
      "WPPFV_RETIRED",
    );
    const { rows } = await db.query(`
      select count(*)::int as n from forge_work_field_verifications where id = '${ver.id}';
    `);
    expect(rows[0].n).toBe(1);
  });

  it60("retire: the §4 carve-out — retire stays available after the package closes", async () => {
    const ver = await createVerification(db, OWNER_A);
    await db.query(`
      update forge_work_packages set status = 'cancelled'
      where owner_id = '${OWNER_A}' and id = 'pkg_a';
    `);
    // Decisions are refused on a terminal package…
    await expectRpcError(
      decideVerification(db, OWNER_A, ver.id, "submit", ver.version, {
        sourceFingerprint: ver.source_fingerprint,
      }),
      "WPPFV_PACKAGE_TERMINAL",
    );
    // …but the owner may still retire the open draft for audit.
    const retired = await retireVerification(db, OWNER_A, ver.id, ver.version,
      "Package cancelled; withdrawing the open draft.");
    expect(retired.status).toBe("RETIRED");
  });

  it60("links: bust, change order, progress entry, and drawing links validate their same-package parent chain", async () => {
    const ver = await createVerification(db, OWNER_A);
    const bustLink = await linkVerification(db, OWNER_A, ver.id, "BUST", "bust_1", "req-link-1");
    expect(bustLink.target_kind).toBe("BUST");
    expect(bustLink.bust_id).toBe("bust_1");
    const orderLink = await linkVerification(db, OWNER_A, ver.id, "CHANGE_ORDER", "co_2", "req-link-2");
    expect(orderLink.change_order_id).toBe("co_2");
    const entryLink = await linkVerification(db, OWNER_A, ver.id, "PROGRESS_ENTRY", "entry_1", "req-link-3");
    expect(entryLink.progress_entry_id).toBe("entry_1");
    const drawingLink = await linkVerification(db, OWNER_A, ver.id, "DRAWING", "dwg_1", "req-link-4");
    expect(drawingLink.drawing_id).toBe("dwg_1");
    // Linking a bust never closes it.
    const { rows } = await db.query(`
      select status from forge_work_package_busts where id = 'bust_1';
    `);
    expect(rows[0].status).toBe("OPEN");
  });

  it60("links: twice is a 409, foreign-package targets are refused, unlink is version-guarded and never cascades", async () => {
    const ver = await createVerification(db, OWNER_A);
    const link = await linkVerification(db, OWNER_A, ver.id, "BUST", "bust_1", "req-link-5");
    await expectRpcError(
      linkVerification(db, OWNER_A, ver.id, "BUST", "bust_1", "req-link-6"),
      "WPPFV_LINK_EXISTS",
    );
    await expectRpcError(
      linkVerification(db, OWNER_A, ver.id, "BUST", "bust_b"),
      "WPPFV_INVALID_TARGET",
    );
    await expectRpcError(
      linkVerification(db, OWNER_A, ver.id, "CHANGE_ORDER", "co_b"),
      "WPPFV_INVALID_TARGET",
    );
    await expectRpcError(
      linkVerification(db, OWNER_A, ver.id, "DRAWING", "dwg_b"),
      "WPPFV_INVALID_TARGET",
    );
    await expectRpcError(
      unlinkVerification(db, OWNER_A, link.id, link.version + 1, "Wrong version."),
      "WPPFV_VERSION_CONFLICT",
    );
    const unlinked = await unlinkVerification(db, OWNER_A, link.id, link.version, "Wrong bust.");
    expect(unlinked.retired_at).not.toBeNull();
    // Unlinking never deletes the link row or the bust.
    expect(await countRows(db, `select count(*)::int as n from forge_work_field_verification_links where id = '${link.id}'`)).toBe(1);
    expect(await countRows(db, `select count(*)::int as n from forge_work_package_busts where id = 'bust_1'`)).toBe(1);
    await expectRpcError(
      unlinkVerification(db, OWNER_A, link.id, unlinked.version, "Again."),
      "WPPFV_LINK_RETIRED",
    );
  });

  it60("links: idempotent replay returns the existing link; links cannot change on an ACCEPTED verification", async () => {
    const ver = await createVerification(db, OWNER_A);
    const first = await linkVerification(db, OWNER_A, ver.id, "BUST", "bust_1", "req-link-7");
    const replay = await linkVerification(db, OWNER_A, ver.id, "BUST", "bust_1", "req-link-7");
    expect(replay.id).toBe(first.id);
    // Linking is a versioned edit (v1 -> v2), so the submit must
    // carry the bumped version, not the create-time one.
    const { rows: verRows } = await db.query(`
      select version from forge_work_field_verifications where id = '${ver.id}';
    `);
    const submitted = await decideVerification(db, OWNER_A, ver.id, "submit", verRows[0].version, {
      sourceFingerprint: ver.source_fingerprint,
    });
    const accepted = await decideVerification(db, MEMBER_C, ver.id, "accept", submitted.version, {
      sourceFingerprint: submitted.source_fingerprint,
      reviewNote: "Checked against R2; matches.",
    });
    expect(accepted.status).toBe("ACCEPTED");
    await expectRpcError(
      linkVerification(db, OWNER_A, ver.id, "CHANGE_ORDER", "co_1"),
      "WPPFV_INVALID_TRANSITION",
    );
    await expectRpcError(
      unlinkVerification(db, OWNER_A, first.id, first.version, "Too late."),
      "WPPFV_INVALID_TRANSITION",
    );
  });

  it60("read-only isolation: recording a verification never creates or changes progress, busts, change orders, or baselines", async () => {
    const countsBefore = {
      progress: await countRows(db, "select count(*)::int as n from forge_work_progress_entries"),
      busts: await countRows(db, "select count(*)::int as n from forge_work_package_busts"),
      orders: await countRows(db, "select count(*)::int as n from forge_work_change_orders"),
      steps: await countRows(db, "select count(*)::int as n from forge_work_steps"),
    };
    const ver = await createVerification(db, OWNER_A);
    // The link happens while the verification is still a DRAFT —
    // links cannot change on an ACCEPTED verification. Linking is a
    // versioned edit, so the submit carries the bumped version.
    await linkVerification(db, OWNER_A, ver.id, "BUST", "bust_1", "req-link-8");
    const { rows: verRows } = await db.query(`
      select version from forge_work_field_verifications where id = '${ver.id}';
    `);
    const submitted = await decideVerification(db, OWNER_A, ver.id, "submit", verRows[0].version, {
      sourceFingerprint: ver.source_fingerprint,
    });
    await decideVerification(db, MEMBER_C, ver.id, "accept", submitted.version, {
      sourceFingerprint: submitted.source_fingerprint,
      reviewNote: "Checked against R2; matches.",
    });
    expect(await countRows(db, "select count(*)::int as n from forge_work_progress_entries")).toBe(countsBefore.progress);
    expect(await countRows(db, "select count(*)::int as n from forge_work_package_busts")).toBe(countsBefore.busts);
    expect(await countRows(db, "select count(*)::int as n from forge_work_change_orders")).toBe(countsBefore.orders);
    expect(await countRows(db, "select count(*)::int as n from forge_work_steps")).toBe(countsBefore.steps);
    const { rows } = await db.query(`
      select installed_quantity from forge_work_progress_entries where id = 'entry_1';
    `);
    expect(rows[0].installed_quantity).toBe("12.5000");
    const { rows: bustRows } = await db.query(`
      select status from forge_work_package_busts where id = 'bust_1';
    `);
    expect(bustRows[0].status).toBe("OPEN");
  });

  it60("atomic audit: a failed create leaves no row and no revision", async () => {
    await expectRpcError(
      createVerification(db, OWNER_A, { sourceFingerprint: "0".repeat(32) }),
      "WPPFV_SOURCE_CHANGED",
    );
    expect(await countRows(db, "select count(*)::int as n from forge_work_field_verifications")).toBe(0);
    expect(await countRows(db, "select count(*)::int as n from forge_work_field_verification_revisions")).toBe(0);
  });

  it60("RLS: owner isolation, co-owner access, anon sees nothing, direct writes denied", async () => {
    const ver = await createVerification(db, OWNER_A);
    // The owner reads their own row.
    const { rows: ownerRows } = await asUser(db, OWNER_A, `
      select id from forge_work_field_verifications where owner_id = '${OWNER_A}';
    `);
    expect(ownerRows.map((r) => r.id)).toContain(ver.id);
    // A co-owner reads the owner's rows.
    const { rows: coOwnerRows } = await asUser(db, MEMBER_C, `
      select id from forge_work_field_verifications where owner_id = '${OWNER_A}';
    `);
    expect(coOwnerRows.map((r) => r.id)).toContain(ver.id);
    // Another owner sees nothing.
    const { rows: otherRows } = await asUser(db, OWNER_B, `
      select id from forge_work_field_verifications where owner_id = '${OWNER_A}';
    `);
    expect(otherRows).toHaveLength(0);
    // Anon has no SELECT grant at all.
    let anonError = null;
    try {
      await asRole(db, "anon", ANON_UID, `
        select count(*) from forge_work_field_verifications;
      `);
    } catch (error) {
      anonError = error;
    }
    expect(anonError).not.toBeNull();
    expect(String(anonError.message)).toContain("permission denied");
    // Direct writes are denied for the app role — the RPCs are the only write path.
    for (const sql of [
      `insert into forge_work_field_verifications (owner_id, id, work_package_id, target_type, step_id, work_location, inspection_date, source_checked_at, source_fingerprint, observation_note, created_by, updated_by) values ('${OWNER_A}', 'forge_wpfv_direct', 'pkg_a', 'WORK_STEP', 'step_1', 'FIELD', '2026-11-15', '2026-11-15T12:00:00Z', '${"a".repeat(32)}', 'Direct.', '${OWNER_A}', '${OWNER_A}')`,
      `update forge_work_field_verifications set status = 'ACCEPTED' where id = '${ver.id}'`,
      `delete from forge_work_field_verifications where id = '${ver.id}'`,
    ]) {
      let writeError = null;
      try {
        await asUser(db, OWNER_A, sql);
      } catch (error) {
        writeError = error;
      }
      expect(writeError, sql).not.toBeNull();
      expect(String(writeError.message)).toContain("permission denied");
    }
    expect(await countRows(db, `select count(*)::int as n from forge_work_field_verifications where id = '${ver.id}'`)).toBe(1);
  });

  it60("revisions are immutable: UPDATE and DELETE are refused by the trigger", async () => {
    const ver = await createVerification(db, OWNER_A);
    const { rows } = await db.query(`
      select id from forge_work_field_verification_revisions where verification_id = '${ver.id}';
    `);
    const revisionId = rows[0].id;
    let updateError = null;
    try {
      await db.query(`update forge_work_field_verification_revisions set reason = 'Rewritten.' where id = '${revisionId}'`);
    } catch (error) {
      updateError = error;
    }
    expect(updateError).not.toBeNull();
    expect(String(updateError.message)).toContain("append-only");
    let deleteError = null;
    try {
      await db.query(`delete from forge_work_field_verification_revisions where id = '${revisionId}'`);
    } catch (error) {
      deleteError = error;
    }
    expect(deleteError).not.toBeNull();
    expect(String(deleteError.message)).toContain("append-only");
  });

  it60("effective ACL matrix: SELECT-only tables, EXECUTE only on the intended RPCs, nothing for anon/service_role", async () => {
    const { rows: tablePrivs } = await db.query(`
      select
        has_table_privilege('authenticated', 'public.forge_work_field_verifications', 'SELECT') as auth_select,
        has_table_privilege('authenticated', 'public.forge_work_field_verifications', 'INSERT') as auth_insert,
        has_table_privilege('authenticated', 'public.forge_work_field_verifications', 'UPDATE') as auth_update,
        has_table_privilege('authenticated', 'public.forge_work_field_verifications', 'DELETE') as auth_delete,
        has_table_privilege('anon', 'public.forge_work_field_verifications', 'SELECT') as anon_select,
        has_table_privilege('service_role', 'public.forge_work_field_verifications', 'SELECT') as svc_select,
        has_table_privilege('authenticated', 'public.forge_work_field_verification_revisions', 'SELECT') as rev_select,
        has_table_privilege('authenticated', 'public.forge_work_field_verification_revisions', 'INSERT') as rev_insert,
        has_table_privilege('authenticated', 'public.forge_work_field_verification_links', 'SELECT') as link_select,
        has_table_privilege('authenticated', 'public.forge_work_field_verification_links', 'INSERT') as link_insert;
    `);
    expect(tablePrivs[0]).toEqual({
      auth_select: true, auth_insert: false, auth_update: false, auth_delete: false,
      anon_select: false, svc_select: false,
      rev_select: true, rev_insert: false, link_select: true, link_insert: false,
    });
    const { rows: fnPrivs } = await db.query(`
      select
        has_function_privilege('authenticated', 'public.forge_work_field_verification_sources(text, text, text, text, date)', 'EXECUTE') as auth_sources,
        has_function_privilege('authenticated', 'public.forge_work_field_verification_source_statuses(text, text)', 'EXECUTE') as auth_statuses,
        has_function_privilege('authenticated', 'public.forge_work_field_verification_create(text, text, text, text, text, text, date, timestamptz, text, text, integer, numeric, text, text, text, numeric, text, text, text, text, text, text, text, text)', 'EXECUTE') as auth_create,
        has_function_privilege('authenticated', 'public.forge_work_field_verification_decision(text, text, text, integer, text, text, text, text)', 'EXECUTE') as auth_decision,
        has_function_privilege('anon', 'public.forge_work_field_verification_create(text, text, text, text, text, text, date, timestamptz, text, text, integer, numeric, text, text, text, numeric, text, text, text, text, text, text, text, text)', 'EXECUTE') as anon_create,
        has_function_privilege('service_role', 'public.forge_work_field_verification_create(text, text, text, text, text, text, date, timestamptz, text, text, integer, numeric, text, text, text, numeric, text, text, text, text, text, text, text, text)', 'EXECUTE') as svc_create,
        has_function_privilege('authenticated', 'public.forge_work_field_verification_compute_fingerprint(text, text, text, text, date)', 'EXECUTE') as auth_helper,
        has_function_privilege('authenticated', 'public.forge_work_field_verification_idempotency_check(text, text, text, text, text)', 'EXECUTE') as auth_idem;
    `);
    expect(fnPrivs[0]).toEqual({
      auth_sources: true, auth_statuses: true, auth_create: true, auth_decision: true,
      anon_create: false, svc_create: false,
      auth_helper: false, auth_idem: false,
    });
  });

  it60("deletion eligibility: a package that ever held a verification can never be hard-deleted — retired verifications still block", async () => {
    // The blocker returns a JSON array of {type, count} objects
    // (count > 0 only, ordered by type) — the 20261113030000 shape.
    const blockerCount = (blockers, type) =>
      (blockers ?? []).find((b) => b.type === type)?.count ?? 0;
    const ver = await createVerification(db, OWNER_A);
    const { rows: before } = await db.query(`
      select forge_work_package_deletion_blocker_counts('${OWNER_A}', 'pkg_a') as blockers;
    `);
    expect(blockerCount(before[0].blockers, "field_verifications")).toBe(1);
    expect(blockerCount(before[0].blockers, "field_verification_revisions")).toBe(1);
    // The preserved 20261113030000 branches still count: the package
    // has an active step, a drawing, progress entries, and a change
    // order, and none of those branches was dropped by the rewrite.
    expect(blockerCount(before[0].blockers, "steps")).toBe(1);
    expect(blockerCount(before[0].blockers, "drawings")).toBe(2);
    expect(blockerCount(before[0].blockers, "progress_entries")).toBe(4);
    expect(blockerCount(before[0].blockers, "change_orders")).toBe(2);
    const retired = await retireVerification(db, OWNER_A, ver.id, ver.version,
      "Recorded against the wrong step.");
    expect(retired.status).toBe("RETIRED");
    const { rows: after } = await db.query(`
      select forge_work_package_deletion_blocker_counts('${OWNER_A}', 'pkg_a') as blockers;
    `);
    expect(blockerCount(after[0].blockers, "field_verifications")).toBe(1);
    expect(blockerCount(after[0].blockers, "field_verification_revisions")).toBe(2);
    // A package with no verifications is unblocked on these keys.
    const { rows: clean } = await db.query(`
      select forge_work_package_deletion_blocker_counts('${OWNER_A}', 'pkg_noplan') as blockers;
    `);
    expect(blockerCount(clean[0].blockers, "field_verifications")).toBe(0);
    expect(blockerCount(clean[0].blockers, "field_verification_revisions")).toBe(0);
  });

  it60("source statuses RPC: CURRENT, then CHANGED_SINCE_REVIEW after a progress edit, TARGET_RETIRED after the step retires", async () => {
    const ver = await createVerification(db, OWNER_A);
    const { rows: current } = await asUser(db, OWNER_A, `
      select forge_work_field_verification_source_statuses('${OWNER_A}', 'pkg_a') as statuses;
    `);
    expect(current[0].statuses[ver.id]).toBe("CURRENT");
    await db.query(`
      insert into forge_work_progress_entries (owner_id, id, work_package_id, takeoff_line_id, work_date, installed_quantity, voided_at)
      values ('${OWNER_A}', 'entry_late', 'pkg_a', 'line_1', '2026-11-15', 1, null);
    `);
    const lineVer = await createVerification(db, OWNER_A, {
      targetType: "TAKEOFF_LINE", stepId: null, takeoffLineId: "line_1",
      physicalCompletion: null, fieldReportedHours: null, fieldHoursSource: null,
      observedInstalledQuantity: 13.5,
    });
    // The step verification is unaffected by the line's progress edit.
    const { rows: afterLine } = await asUser(db, OWNER_A, `
      select forge_work_field_verification_source_statuses('${OWNER_A}', 'pkg_a') as statuses;
    `);
    expect(afterLine[0].statuses[ver.id]).toBe("CURRENT");
    expect(afterLine[0].statuses[lineVer.id]).toBe("CURRENT");
    // Voiding the new entry moves the line verification's live fingerprint.
    await db.query(`
      update forge_work_progress_entries set voided_at = '2026-11-15T13:00:00Z' where id = 'entry_late';
    `);
    const { rows: afterVoid } = await asUser(db, OWNER_A, `
      select forge_work_field_verification_source_statuses('${OWNER_A}', 'pkg_a') as statuses;
    `);
    expect(afterVoid[0].statuses[lineVer.id]).toBe("CHANGED_SINCE_REVIEW");
    // Retiring the step moves its verification to TARGET_RETIRED.
    await db.query(`
      update forge_work_steps set retired_at = '2026-11-15T14:00:00Z' where owner_id = '${OWNER_A}' and id = 'step_1';
    `);
    const { rows: afterRetire } = await asUser(db, OWNER_A, `
      select forge_work_field_verification_source_statuses('${OWNER_A}', 'pkg_a') as statuses;
    `);
    expect(afterRetire[0].statuses[ver.id]).toBe("TARGET_RETIRED");
  });

  it60("foreign workspace: a verification from another owner is invisible to reads and refuses writes", async () => {
    const ver = await createVerification(db, OWNER_A);
    const { rows: otherRows } = await asUser(db, OWNER_B, `
      select id from forge_work_field_verifications where id = '${ver.id}';
    `);
    expect(otherRows).toHaveLength(0);
    await expectRpcError(
      decideVerification(db, OWNER_B, ver.id, "submit", ver.version, {
        sourceFingerprint: ver.source_fingerprint,
      }),
      "WPPFV_WORKSPACE_FORBIDDEN",
    );
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

describe.skipIf(!HAS_REAL_PG)("field verification migration: real-PostgreSQL subset", () => {
  let pgDir;
  let pgClient;
  let pgCfg;

  beforeAll(async () => {
    pgDir = mkdtempSync(join(tmpdir(), "wpfv-realpg-"));
    execSync(`chown ${PG_RUN_USER}:${PG_RUN_USER} "${pgDir}"`, { stdio: "pipe" });
    const asPgUser = (cmd) => `runuser -u ${PG_RUN_USER} -- ${cmd}`;
    execSync(asPgUser(`"${PG_BIN}/initdb" -D "${pgDir}" -U postgres --auth=trust`), { stdio: "pipe" });
    execSync(
      asPgUser(`"${PG_BIN}/pg_ctl" -D "${pgDir}" -o "-p 55435 -k ${pgDir} -c listen_addresses=''" -l "${pgDir}/server.log" start`),
      { stdio: "pipe" },
    );
    pgCfg = { host: pgDir, port: 55435, user: "postgres", database: "postgres" };
    pgClient = new Client(pgCfg);
    await pgClient.connect();
    await pgClient.query(PREREQ_SQL);
    await pgClient.query(SEED_SQL);
    await pgClient.query(loadMigrationSql(SLICE));
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

  // Each real-PG test that creates a verification uses its own
  // inspection date: the shared scratch cluster keeps every row,
  // and the active-observation unique index keys on target +
  // inspection date + fingerprint, so two tests creating the same
  // observation on the same date would (correctly) collide with
  // DUPLICATE_ACTIVE.
  async function pgCreateStepVerification(client, uid, requestId = null, inspectionDate = "2026-11-15") {
    const { rows: srcRows } = await pgAsUser(client, uid, `
      select forge_work_field_verification_sources(
        '${OWNER_A}', 'pkg_a', 'WORK_STEP', 'step_1', '${inspectionDate}') as src;
    `);
    const fingerprint = srcRows[0].src.sourceFingerprint;
    const { rows } = await pgAsUser(client, uid, `
      select * from forge_work_field_verification_create(
        '${OWNER_A}', 'pkg_a', 'WORK_STEP', 'step_1', null, 'FIELD',
        '${inspectionDate}', '2026-11-15T12:00:00Z', null, null, null,
        null, null, 'PARTIALLY_COMPLETE', null, 42, 'Foreman daily log',
        'Spool welded and aligned against IFC revision R2.',
        'field-photo-2026-11-15-01.jpg', null, '${fingerprint}',
        ${sqlStr(requestId)}, null, null);
    `);
    return rows[0];
  }

  it60("concurrent creates of the same observation serialize: one wins, the other gets DUPLICATE_ACTIVE", async () => {
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const results = await Promise.allSettled([
        pgCreateStepVerification(clientA, OWNER_A, "req-conc-1"),
        pgCreateStepVerification(clientB, OWNER_A, "req-conc-2"),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toMatch(/WPPFV_DUPLICATE_ACTIVE/);
      const { rows } = await pgClient.query(`
        select count(*)::int as n from forge_work_field_verifications
        where owner_id = '${OWNER_A}' and step_id = 'step_1';
      `);
      expect(rows[0].n).toBe(1);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("concurrent decisions on the same version: one wins, the other gets VERSION_CONFLICT", async () => {
    const ver = await pgCreateStepVerification(pgClient, OWNER_A, "req-conc-3", "2026-11-14");
    const decide = (client, uid) => pgAsUser(client, uid, `
      select * from forge_work_field_verification_decision(
        '${OWNER_A}', '${ver.id}', 'submit', ${ver.version},
        '${ver.source_fingerprint}', null, null, null);
    `);
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const results = await Promise.allSettled([
        decide(clientA, OWNER_A),
        decide(clientB, OWNER_A),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toMatch(/WPPFV_VERSION_CONFLICT/);
      const { rows } = await pgClient.query(`
        select status, version from forge_work_field_verifications where id = '${ver.id}';
      `);
      expect(rows[0].status).toBe("SUBMITTED");
      expect(rows[0].version).toBe(2);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("an uncommitted progress entry is invisible to the sources RPC", async () => {
    const tx = new Client(pgCfg);
    await tx.connect();
    try {
      await tx.query("begin");
      await tx.query(`
        insert into forge_work_progress_entries (owner_id, id, work_package_id, takeoff_line_id, work_date, installed_quantity, voided_at)
        values ('${OWNER_A}', 'entry_tx', 'pkg_a', 'line_1', '2026-11-15', 5, null);
      `);
      const { rows } = await pgAsUser(pgClient, OWNER_A, `
        select forge_work_field_verification_sources(
          '${OWNER_A}', 'pkg_a', 'TAKEOFF_LINE', 'line_1', '2026-11-15') as src;
      `);
      expect(rows[0].src.installedAsOf).toBe(12.5);
      expect(rows[0].src.progressEntryIds).toEqual(["entry_1"]);
      await tx.query("rollback");
    } finally {
      await tx.end().catch(() => {});
    }
  });

  it60("effective ACL matrix holds on real PG: SELECT-only tables, EXECUTE only on the intended RPCs", async () => {
    const { rows } = await pgClient.query(`
      select
        has_table_privilege('authenticated', 'public.forge_work_field_verifications', 'SELECT') as auth_select,
        has_table_privilege('authenticated', 'public.forge_work_field_verifications', 'INSERT') as auth_insert,
        has_table_privilege('anon', 'public.forge_work_field_verifications', 'SELECT') as anon_select,
        has_function_privilege('authenticated', 'public.forge_work_field_verification_create(text, text, text, text, text, text, date, timestamptz, text, text, integer, numeric, text, text, text, numeric, text, text, text, text, text, text, text, text)', 'EXECUTE') as auth_create,
        has_function_privilege('authenticated', 'public.forge_work_field_verification_compute_fingerprint(text, text, text, text, date)', 'EXECUTE') as auth_helper;
    `);
    expect(rows[0]).toEqual({
      auth_select: true, auth_insert: false, anon_select: false,
      auth_create: true, auth_helper: false,
    });
  });

  it60("same-transaction audit rollback: a failed decision leaves no revision", async () => {
    const ver = await pgCreateStepVerification(pgClient, OWNER_A, "req-conc-4", "2026-11-13");
    const before = await pgClient.query(`
      select count(*)::int as n from forge_work_field_verification_revisions
      where verification_id = '${ver.id}';
    `);
    expect(before.rows[0].n).toBe(1);
    let caught = null;
    try {
      await pgAsUser(pgClient, OWNER_A, `
        select * from forge_work_field_verification_decision(
          '${OWNER_A}', '${ver.id}', 'submit', ${ver.version},
          '${"0".repeat(32)}', null, null, null);
      `);
    } catch (error) {
      caught = error;
    }
    expect(String(caught?.message ?? "")).toContain("WPPFV_SOURCE_CHANGED");
    const after = await pgClient.query(`
      select count(*)::int as n from forge_work_field_verification_revisions
      where verification_id = '${ver.id}';
    `);
    expect(after.rows[0].n).toBe(1);
    const { rows } = await pgClient.query(`
      select status, version from forge_work_field_verifications where id = '${ver.id}';
    `);
    expect(rows[0].status).toBe("DRAFT");
    expect(rows[0].version).toBe(1);
  });
});
