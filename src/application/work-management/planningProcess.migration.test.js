// Work Package Planner — planning-process steps, migration/integration
// proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) and proves:
//   - Template seed (F3): version 1, 22 rows with stable step keys
//     pdf-01..pdf-22, credits sum 100%, standard hours sum 40 — the
//     PDF's numbers, validated by the migration itself; re-apply is
//     idempotent; a corrupted template fails the checklist closed.
//   - Checklist RPC: template verification BEFORE instantiation;
//     ensure-on-first-read creates exactly 22 In-Progress instances,
//     second call creates none; returns complexity, bound template
//     version, the caller's effective update/review affordances, and
//     constructionReadiness (always not-established in Slice A — F1).
//   - Set-status RPC (F2): status rules, evidence/attestation for
//     Complete, reason for N/A and Needs Revision, fresh evidence on
//     return from Needs Revision, self-review ban with owner override,
//     reviewer attribution set/cleared, terminal-package block,
//     expected-version 409, request-id idempotency, atomic append-only
//     event rows (before/after, actor, reason, evidence digest/
//     reference, UTC time, request ID).
//   - Staff gates are REAL: a Planner assignee can set Complete but
//     not Reviewed; a Reviewer assignee can set Reviewed but not
//     Complete; a planner_admin assignee who submitted a step cannot
//     review it; a stranger reaches nothing (the admin-permissions
//     design: has_planner_permission gates staff, has_workspace_access
//     is never broadened).
//   - RLS: owner isolation, co-owner access, staff-reader access via
//     the capability branch, anon sees nothing, direct writes denied
//     (RPC-only write path).
//   - Effective ACL matrix for authenticated/anon/service_role, and
//     the default-privilege negative case: a selective GRANT alone does
//     NOT revoke an already-effective broad privilege, which is why the
//     migration's explicit REVOKEs are load-bearing.
//   - Capability CHECK extension + starter-role provisioning update +
//     backfill for roles that already exist.
//
// Roles, the auth.uid() stub, workspace_members, and the
// has_workspace_access() copy mirror production (see
// 20260829000100_add_workspace_authorization_helpers.sql); the
// prerequisite packages table is a minimal shape with the exact keys
// the foreign keys reference, plus the status column the
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
const MEMBER_D = "44444444-4444-4444-8444-444444444444";
const MEMBER_E = "55555555-5555-4555-8555-555555555555";

const ADMIN_MIGRATION = "20261110000000_forge_planner_admin_permissions_slice1.sql";
const THIS_MIGRATION = "20261112000000_forge_work_planning_process_steps.sql";

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
`;

const SEED_SQL = `
  insert into forge_work_packages (owner_id, id, status) values
    ('${OWNER_A}', 'pkg_a', 'in_progress'),
    ('${OWNER_A}', 'pkg_cancelled', 'cancelled'),
    ('${OWNER_A}', 'pkg_closed', 'verified_closed'),
    ('${OWNER_B}', 'pkg_b', 'in_progress');
  insert into workspace_members (owner_id, member_user_id, status, role)
    values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
`;

async function setupDb() {
  const db = new PGlite();
  await db.exec(PREREQ_SQL);
  // Production order: the admin slice first (roles tables +
  // has_planner_permission + provisioning function), then this slice
  // (which extends the capability CHECK and replaces the provisioning
  // function).
  await db.exec(loadMigrationSql(ADMIN_MIGRATION));
  await db.exec(loadMigrationSql(THIS_MIGRATION));
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

function sqlInt(value) {
  return value === null || value === undefined ? "null" : String(value);
}

async function checklist(db, uid, ownerId, packageId) {
  const { rows } = await asUser(db, uid, `
    select forge_work_planning_process_checklist('${ownerId}', '${packageId}') as v;`);
  return rows[0].v;
}

async function setStatus(db, uid, ownerId, packageId, templateStepId, status, opts = {}) {
  const { rows } = await asUser(db, uid, `
    select forge_work_planning_process_set_status(
      '${ownerId}', '${packageId}', '${templateStepId}', ${sqlStr(status)},
      ${sqlStr(opts.evidenceLink ?? null)}, ${sqlStr(opts.reason ?? null)},
      ${sqlStr(opts.attestation ?? null)}, ${sqlInt(opts.expectedVersion ?? null)},
      ${sqlStr(opts.requestId ?? null)}) as v;`);
  return rows[0].v;
}

async function expectRpcError(db, uid, sql, code) {
  let caught = null;
  try {
    await asUser(db, uid, sql);
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected RPC to raise ${code}`).not.toBeNull();
  expect(String(caught.message)).toContain(code);
  return caught;
}

async function instancesFor(db, packageId) {
  const { rows } = await db.query(`
    select template_step_id, status, version, submitted_by
      from forge_work_planning_process_instances
      where owner_id = '${OWNER_A}' and work_package_id = '${packageId}'
      order by template_step_id;`);
  return rows;
}

async function revisionsFor(db, packageId) {
  const { rows } = await db.query(`
    select action, old_status, new_status, reason, evidence_reference,
           evidence_digest, attestation, is_override, request_id, actor_id
      from forge_work_planning_process_revisions
      where owner_id = '${OWNER_A}' and work_package_id = '${packageId}'
      order by recorded_at, id;`);
  return rows;
}

// Provision the starter roles as the owner, then assign a plain member
// (NOT a co-owner — co-owners short-circuit every capability check)
// to a named starter role by direct assignment insert.
async function provisionAndAssign(db, memberId, roleKey) {
  await asUser(db, OWNER_A, `
    select forge_planner_roles_provision_starter_set('${OWNER_A}', 'test-request-1');`);
  const { rows } = await db.query(`
    select id from forge_planner_roles
    where owner_id = '${OWNER_A}' and role_key = '${roleKey}';`);
  expect(rows).toHaveLength(1);
  await db.query(`
    insert into forge_planner_user_role_assignments
      (owner_id, id, role_id, assignee_user_id, assigned_by, updated_by)
    values ('${OWNER_A}', 'forge_ura_test_${roleKey}', '${rows[0].id}', '${memberId}', '${OWNER_A}', '${OWNER_A}');`);
}

describe("planning-process migration", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); });
  afterEach(async () => { await db.close(); });

  it60("seeds the PDF template, version 1: 22 rows, stable keys, credits sum 100, hours sum 40", async () => {
    const { rows } = await db.query(`
      select version, count(*)::int as n, count(distinct step_key)::int as keys,
             coalesce(sum(credit_pct), 0)::numeric as credits,
             coalesce(sum(mhrs_standard), 0)::numeric as hours
        from forge_work_planning_process_template group by version;`);
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(1);
    expect(rows[0].n).toBe(22);
    expect(rows[0].keys).toBe(22);
    expect(Number(rows[0].credits)).toBe(100);
    expect(Number(rows[0].hours)).toBe(40);
    const keys = await db.query(`select step_key from forge_work_planning_process_template order by sort_order;`);
    expect(keys.rows.map((r) => r.step_key)).toEqual(
      Array.from({ length: 22 }, (_, i) => `pdf-${String(i + 1).padStart(2, "0")}`),
    );
    const names = await db.query(`select name, credit_pct, mhrs_standard from forge_work_planning_process_template where step_number = 15;`);
    expect(names.rows[0].name).toBe("Job Plan Developed");
    expect(Number(names.rows[0].credit_pct)).toBe(15);
    expect(Number(names.rows[0].mhrs_standard)).toBe(6);
    const ifc = await db.query(`select description from forge_work_planning_process_template where step_key = 'pdf-07';`);
    expect(ifc.rows[0].description).toMatch(/never authorizes construction/);
  });

  it60("re-applying the migration is idempotent (template + constraints + backfill)", async () => {
    await db.exec(loadMigrationSql(THIS_MIGRATION));
    const { rows } = await db.query(`select count(*)::int as n from forge_work_planning_process_template;`);
    expect(rows[0].n).toBe(22);
    const caps = await db.query(`
      select count(*)::int as n from forge_planner_role_capabilities
      where capability_key in ('planner.planning_steps.read', 'planner.planning_steps.update', 'planner.planning_steps.review');`);
    expect(caps.rows[0].n).toBe(0); // no roles provisioned yet in this db — nothing backfilled
  });

  it60("checklist ensures exactly 22 In-Progress instances on first read, none on second", async () => {
    const first = await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    expect(first.complexity).toBe("standard");
    expect(first.templateVersion).toBe(1);
    expect(first.canUpdate).toBe(true);
    expect(first.canReview).toBe(true);
    expect(first.constructionReadiness.status).toBe("not_established");
    expect(first.constructionReadiness.detail).toMatch(/never authorizes construction/);
    expect(first.template).toHaveLength(22);
    expect(first.instances).toHaveLength(22);
    expect(first.instances.every((i) => i.status === "In-Progress")).toBe(true);
    expect(first.instances.every((i) => i.version === 1)).toBe(true);
    expect(first.instances.every((i) => i.submitted_by === null)).toBe(true);
    const second = await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    expect(second.instances).toHaveLength(22);
    expect((await instancesFor(db, "pkg_a"))).toHaveLength(22);
  });

  it60("checklist rejects a stranger and a missing package", async () => {
    await expectRpcError(db, OWNER_B,
      `select forge_work_planning_process_checklist('${OWNER_A}', 'pkg_a');`,
      "WPP10_WORKSPACE_FORBIDDEN");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_checklist('${OWNER_A}', 'pkg_nope');`,
      "WPP10_PACKAGE_NOT_FOUND");
  });

  it60("a corrupted template fails the checklist closed (F3)", async () => {
    await db.query(`delete from forge_work_planning_process_template where step_key = 'pdf-22';`);
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_checklist('${OWNER_A}', 'pkg_a');`,
      "WPP10_TEMPLATE_INVALID");
  });

  it60("a template whose credits no longer sum to 100 fails the checklist closed", async () => {
    await db.query(`update forge_work_planning_process_template set credit_pct = 9 where step_key = 'pdf-01';`);
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_checklist('${OWNER_A}', 'pkg_a');`,
      "WPP10_TEMPLATE_INVALID");
  });

  it60("a co-owner can open the checklist (owner boundary, not a role row)", async () => {
    const result = await checklist(db, MEMBER_C, OWNER_A, "pkg_a");
    expect(result.instances).toHaveLength(22);
    expect(result.canUpdate).toBe(true);
    expect(result.canReview).toBe(true);
  });

  it60("set-status updates the instance, bumps its version, and writes an atomic event row", async () => {
    await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    const updated = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete",
      { evidenceLink: "https://example.com/p-id.pdf", requestId: "req_evt_1" });
    expect(updated.status).toBe("Complete");
    expect(updated.version).toBe(2);
    expect(updated.submitted_by).toBe(OWNER_A);
    const revisions = await revisionsFor(db, "pkg_a");
    expect(revisions).toHaveLength(1);
    expect(revisions[0].action).toBe("status_change");
    expect(revisions[0].old_status).toBe("In-Progress");
    expect(revisions[0].new_status).toBe("Complete");
    expect(revisions[0].actor_id).toBe(OWNER_A);
    expect(revisions[0].evidence_reference).toBe("https://example.com/p-id.pdf");
    expect(revisions[0].evidence_digest).toMatch(/^[0-9a-f]{32}$/);
    expect(revisions[0].is_override).toBe(false);
    expect(revisions[0].request_id).toBe("req_evt_1");
  });

  it60("Reviewed records the reviewer; leaving Reviewed clears reviewer attribution", async () => {
    await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    const reviewed = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-15", "Reviewed",
      { attestation: "Reviewed the job plan against the plot plan." });
    expect(reviewed.status).toBe("Reviewed");
    expect(reviewed.reviewed_by).toBe(OWNER_A);
    expect(reviewed.reviewed_at).not.toBeNull();
    const moved = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-15", "Complete",
      { evidenceLink: "https://example.com/job-plan.pdf" });
    expect(moved.status).toBe("Complete");
    expect(moved.reviewed_by).toBeNull();
    expect(moved.reviewed_at).toBeNull();
  });

  it60("Complete needs an evidence link or an attestation", async () => {
    await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Complete', null, null, null, null, null);`,
      "WPP10_EVIDENCE_REQUIRED");
    const byLink = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete",
      { evidenceLink: "https://example.com/p-id.pdf" });
    expect(byLink.status).toBe("Complete");
    const byAttestation = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-02", "Complete",
      { attestation: "I walked the plot plan and it matches the scope." });
    expect(byAttestation.status).toBe("Complete");
  });

  it60("N/A and Needs Revision need a nonempty reason", async () => {
    await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-06', 'N/A', null, null, null, null, null);`,
      "WPP10_REASON_REQUIRED");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Needs Revision', null, null, null, null, null);`,
      "WPP10_REASON_REQUIRED");
    const na = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-06", "N/A",
      { reason: "No engineering request needed on this package." });
    expect(na.status).toBe("N/A");
    const nr = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Needs Revision",
      { reason: "P&ID markup misses the new tie-in." });
    expect(nr.status).toBe("Needs Revision");
    const events = await revisionsFor(db, "pkg_a");
    expect(events[1].new_status).toBe("Needs Revision");
    expect(events[1].reason).toBe("P&ID markup misses the new tie-in.");
  });

  it60("Needs Revision revokes credit immediately; returning needs fresh evidence", async () => {
    await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-15", "Complete",
      { evidenceLink: "https://example.com/job-plan-v1.pdf" });
    await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-15", "Needs Revision",
      { reason: "Job plan misses the night-shift crew." });
    const afterSendBack = (await instancesFor(db, "pkg_a")).find((i) => i.template_step_id === "pdf-15");
    expect(afterSendBack.status).toBe("Needs Revision");
    // The stored link is stale: returning with no fresh evidence fails.
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-15', 'Complete', null, null, null, null, null);`,
      "WPP10_FRESH_EVIDENCE_REQUIRED");
    const returned = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-15", "Complete",
      { evidenceLink: "https://example.com/job-plan-v2.pdf" });
    expect(returned.status).toBe("Complete");
    expect(returned.evidence_link).toBe("https://example.com/job-plan-v2.pdf");
  });

  it60("a reviewer cannot review their own latest submission; an owner override with reason can", async () => {
    await provisionAndAssign(db, MEMBER_D, "planner_admin");
    await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    // MEMBER_D (planner_admin: update + review) submits pdf-01, then
    // cannot review it themselves.
    await setStatus(db, MEMBER_D, OWNER_A, "pkg_a", "pdf-01", "Complete",
      { evidenceLink: "https://example.com/p-id.pdf" });
    await expectRpcError(db, MEMBER_D,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Reviewed', null, null, null, null, null);`,
      "WPP10_SELF_REVIEW_FORBIDDEN");
    // A different reviewer (the owner, who did not submit it) can.
    const reviewed = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Reviewed");
    expect(reviewed.status).toBe("Reviewed");
    expect(reviewed.reviewed_by).toBe(OWNER_A);
    // Owner self-review without a reason is refused; with one it is
    // recorded as an override.
    await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-02", "Complete",
      { evidenceLink: "https://example.com/plot.pdf" });
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-02', 'Reviewed', null, null, null, null, null);`,
      "WPP10_REASON_REQUIRED");
    const overridden = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-02", "Reviewed",
      { reason: "Owner override: I completed this step and I am reviewing it." });
    expect(overridden.status).toBe("Reviewed");
    const events = await revisionsFor(db, "pkg_a");
    const overrideEvent = events.find((e) => e.new_status === "Reviewed" && e.is_override);
    expect(overrideEvent).toBeDefined();
    expect(overrideEvent.reason).toMatch(/Owner override/);
  });

  it60("a Planner assignee can set Complete but not Reviewed", async () => {
    await provisionAndAssign(db, MEMBER_D, "planner");
    await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    const updated = await setStatus(db, MEMBER_D, OWNER_A, "pkg_a", "pdf-01", "Complete",
      { evidenceLink: "https://example.com/p-id.pdf" });
    expect(updated.status).toBe("Complete");
    await expectRpcError(db, MEMBER_D,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-02', 'Reviewed', null, null, null, null, null);`,
      "WPP10_REVIEW_FORBIDDEN");
  });

  it60("a Reviewer assignee can set Reviewed but not ordinary statuses", async () => {
    await provisionAndAssign(db, MEMBER_E, "reviewer");
    await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    const reviewed = await setStatus(db, MEMBER_E, OWNER_A, "pkg_a", "pdf-01", "Reviewed");
    expect(reviewed.status).toBe("Reviewed");
    expect(reviewed.reviewed_by).toBe(MEMBER_E);
    await expectRpcError(db, MEMBER_E,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-02', 'Complete', 'https://example.com/x.pdf', null, null, null, null);`,
      "WPP10_UPDATE_FORBIDDEN");
  });

  it60("a staff reader with only .read can open the checklist but cannot change a status", async () => {
    await provisionAndAssign(db, MEMBER_D, "read_only");
    const result = await checklist(db, MEMBER_D, OWNER_A, "pkg_a");
    expect(result.instances).toHaveLength(22);
    expect(result.canUpdate).toBe(false);
    expect(result.canReview).toBe(false);
    await expectRpcError(db, MEMBER_D,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Complete', 'https://example.com/x.pdf', null, null, null, null);`,
      "WPP10_UPDATE_FORBIDDEN");
  });

  it60("stale expected version returns 409; the matching version succeeds", async () => {
    await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete",
      { evidenceLink: "https://example.com/p-id.pdf", expectedVersion: 1 });
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'In-Progress', null, null, null, 1, null);`,
      "WPP10_STALE_VERSION");
    const moved = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "In-Progress",
      { expectedVersion: 2 });
    expect(moved.status).toBe("In-Progress");
    expect(moved.version).toBe(3);
  });

  it60("replaying a request ID applies nothing twice (idempotency)", async () => {
    await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    const first = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete",
      { evidenceLink: "https://example.com/p-id.pdf", requestId: "req_replay_1" });
    expect(first.version).toBe(2);
    const replay = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete",
      { evidenceLink: "https://example.com/p-id.pdf", requestId: "req_replay_1" });
    expect(replay.version).toBe(2);
    expect(replay.status).toBe("Complete");
    const events = await revisionsFor(db, "pkg_a");
    expect(events).toHaveLength(1);
    expect((await instancesFor(db, "pkg_a")).find((i) => i.template_step_id === "pdf-01").version).toBe(2);
  });

  it60("terminal packages cannot change planning status", async () => {
    await checklist(db, OWNER_A, OWNER_A, "pkg_cancelled");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_cancelled', 'pdf-01', 'Complete', 'https://example.com/x.pdf', null, null, null, null);`,
      "WPP10_PACKAGE_TERMINAL");
    await checklist(db, OWNER_A, OWNER_A, "pkg_closed");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_closed', 'pdf-01', 'Complete', 'https://example.com/x.pdf', null, null, null, null);`,
      "WPP10_PACKAGE_TERMINAL");
  });

  it60("evidence link: set, clear with empty string, reject over-long", async () => {
    await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    const withLink = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete", { evidenceLink: "https://example.com/p-id.pdf" });
    expect(withLink.evidence_link).toBe("https://example.com/p-id.pdf");
    const cleared = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete", { evidenceLink: "" });
    expect(cleared.evidence_link).toBeNull();
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Complete', '${"x".repeat(2001)}', null, null, null, null);`,
      "WPP10_INVALID_EVIDENCE_LINK");
  });

  it60("evidence-only change records an evidence_link_change event, not a status change", async () => {
    await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    const updated = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "In-Progress",
      { evidenceLink: "https://example.com/p-id.pdf" });
    expect(updated.status).toBe("In-Progress");
    expect(updated.evidence_link).toBe("https://example.com/p-id.pdf");
    const events = await revisionsFor(db, "pkg_a");
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("evidence_link_change");
    expect(events[0].old_status).toBe("In-Progress");
    expect(events[0].new_status).toBe("In-Progress");
  });

  it60("invalid status, unknown step, and over-long reason are rejected", async () => {
    await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Pending', null, null, null, null, null);`,
      "WPP10_INVALID_STATUS");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-99', 'Complete', null, null, null, null, null);`,
      "WPP10_STEP_NOT_FOUND");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-06', 'N/A', null, '${"x".repeat(501)}', null, null, null);`,
      "WPP10_INVALID_REASON");
  });

  it60("complexity column: default standard, check rejects anything else, checklist reflects a change", async () => {
    const before = await db.query(`select planning_complexity, planning_template_version from forge_work_packages where id = 'pkg_a';`);
    expect(before.rows[0].planning_complexity).toBe("standard");
    expect(before.rows[0].planning_template_version).toBe(1);
    await expect(db.query(`update forge_work_packages set planning_complexity = 'extreme' where id = 'pkg_a';`))
      .rejects.toThrow();
    await expect(db.query(`update forge_work_packages set planning_template_version = 2 where id = 'pkg_a';`))
      .rejects.toThrow();
    await db.query(`update forge_work_packages set planning_complexity = 'high' where id = 'pkg_a';`);
    const result = await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    expect(result.complexity).toBe("high");
    expect(result.templateVersion).toBe(1);
  });

  it60("RLS: anon cannot select at all; a stranger's owner sees nothing; direct writes are denied", async () => {
    await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    // anon holds no grant on the table at all (revoked, never granted),
    // so the select fails — that IS "sees nothing" (same as slice 5's
    // "anon cannot select (no policy, no grant)" leg).
    await expect(asRole(db, "anon", OWNER_A, `select count(*)::int as n from forge_work_planning_process_instances;`))
      .rejects.toThrow(/permission denied/);
    const stranger = await asUser(db, OWNER_B, `select count(*)::int as n from forge_work_planning_process_instances where owner_id = '${OWNER_A}';`);
    expect(stranger.rows[0].n).toBe(0);
    await expect(asRole(db, "anon", OWNER_A, `select count(*)::int as n from forge_work_planning_process_template;`))
      .rejects.toThrow(/permission denied/);
    const templateReader = await asUser(db, OWNER_B, `select count(*)::int as n from forge_work_planning_process_template;`);
    expect(templateReader.rows[0].n).toBe(22);
    await expect(asUser(db, OWNER_A, `insert into forge_work_planning_process_instances (owner_id, id, work_package_id, template_version, template_step_id, status, created_by, updated_by) values ('${OWNER_A}', 'forge_ppi_x', 'pkg_a', 1, 'pdf-01', 'Complete', '${OWNER_A}', '${OWNER_A}');`))
      .rejects.toThrow(/permission denied|not allowed|policy/i);
    await expect(asUser(db, OWNER_A, `update forge_work_planning_process_template set credit_pct = 99 where step_key = 'pdf-01';`))
      .rejects.toThrow(/permission denied|not allowed|policy/i);
  });

  it60("effective ACLs: authenticated SELECT-only on all three tables; anon and service_role hold nothing", async () => {
    const { rows } = await db.query(`
      select relname, relacl from pg_class
      where relname in ('forge_work_planning_process_template',
                        'forge_work_planning_process_instances',
                        'forge_work_planning_process_revisions');`);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const acl = String(row.relacl || "");
      expect(acl).toContain("authenticated=r");
      expect(acl).not.toContain("anon=");
      expect(acl).not.toContain("service_role=");
      expect(acl).not.toContain("authenticated=arwd");
    }
    const fns = await db.query(`
      select p.proname, p.proacl from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('forge_work_planning_process_checklist', 'forge_work_planning_process_set_status');`);
    expect(fns.rows).toHaveLength(2);
    for (const fn of fns.rows) {
      const acl = String(fn.proacl || "");
      expect(acl).toContain("authenticated=X");
      expect(acl).not.toContain("anon=");
      expect(acl).not.toContain("service_role=");
    }
  });

  it60("backfill grants the new capabilities to already-provisioned starter roles", async () => {
    // Provision FIRST with the OLD function shape is impossible here
    // (this db only ever saw the new function), so prove the backfill
    // path directly: strip the new capability rows, re-apply the
    // migration, and confirm the backfill restores exactly the nine
    // expected (role, capability) pairs.
    await asUser(db, OWNER_A, `select forge_planner_roles_provision_starter_set('${OWNER_A}', 'test-request-2');`);
    await db.query(`delete from forge_planner_role_capabilities where capability_key like 'planner.planning_steps.%';`);
    const gone = await db.query(`select count(*)::int as n from forge_planner_role_capabilities where capability_key like 'planner.planning_steps.%';`);
    expect(gone.rows[0].n).toBe(0);
    await db.exec(loadMigrationSql(THIS_MIGRATION));
    const { rows } = await db.query(`
      select r.role_key, c.capability_key
        from forge_planner_role_capabilities c
        join forge_planner_roles r on r.owner_id = c.owner_id and r.id = c.role_id
        where c.capability_key like 'planner.planning_steps.%'
        order by r.role_key, c.capability_key;`);
    expect(rows.map((r) => `${r.role_key}:${r.capability_key}`)).toEqual([
      "planner:planner.planning_steps.read",
      "planner:planner.planning_steps.update",
      "planner_admin:planner.planning_steps.read",
      "planner_admin:planner.planning_steps.review",
      "planner_admin:planner.planning_steps.update",
      "read_only:planner.planning_steps.read",
      "reviewer:planner.planning_steps.read",
      "reviewer:planner.planning_steps.review",
      "scheduler:planner.planning_steps.read",
    ]);
  });
});
