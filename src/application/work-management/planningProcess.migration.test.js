// Work Package Planner — planning-process steps, migration/integration
// proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) and proves:
//   - Template seed (F3): version 1, 22 rows with stable step keys
//     pdf-01..pdf-22, credits sum 100%, standard hours sum 40 — the
//     PDF's numbers, validated by the migration itself; re-apply is
//     idempotent; a corrupted template fails the checklist closed.
//   - Checklist RPC: template verification; READ-ONLY return of the
//     complete 22-row set (created atomically with the package row
//     by a trigger — a GET never mutates); missing/duplicate rows
//     are unavailable, never auto-created. Returns complexity, bound
//     template version, the caller's effective update/review
//     affordances and isOwner, and constructionReadiness (always
//     not-established in Slice A — F1).
//   - F1 (fix round 1): package creation and its 22 checklist rows
//     are one transaction (trigger); a forced checklist-insert
//     failure rolls the package row back; the migration backfills
//     existing packages idempotently.
//   - F2 (fix round 1): expected version and request ID are
//     mandatory; the instance row is locked FOR UPDATE and the
//     update is conditional on the version (stale = 409);
//     request-ID reuse with a different payload is a conflict.
//     A two-session real-PostgreSQL concurrency test proves one of
//     two same-version changes gets 409 with no lost audit/update.
//   - F3 (fix round 1): the transition/authority matrix —
//     In-Progress/Complete need update; N/A, Reviewed and Needs
//     Revision need review (Reviewer CAN record Needs Revision;
//     ordinary Planner must NOT); Reviewed only from a distinct
//     prior submission with an existing qualifying basis and no new
//     evidence in the same decision except an owner/co-owner
//     reasoned override; a Reviewed row may only go back through
//     Needs Revision; returning from Needs Revision is two-step.
//   - F4 (fix round 1): one effective post-update evidence value —
//     omitted preserves, replacement replaces, explicit clear is
//     rejected unless a valid attestation replaces it.
//   - F5 (fix round 1): complexity changes go through a SECURITY
//     DEFINER RPC (expected version + request-id idempotency; the
//     complexity_change event is appended in the same transaction) —
//     rollback, actor derivation, cross-workspace, stale-write,
//     duplicate-request and success legs are all proved here.
//   - Fix round 4 (P1-2): the stub packages table carries the
//     production rung-1 version trigger (fires on EVERY update),
//     so the combined RPC's version contract is proved against
//     the real schema: one logical save advances the version
//     exactly once, even when percent_complete changes — and the
//     success, stale-write, replay, and two-session concurrent
//     legs all run against that trigger-faithful schema.
//   - Fix round 4 (P1-1): the request-ID namespace is package-
//     level, shared by the standalone complexity RPC and the
//     combined update RPC under one canonical payload
//     {complexity, updates}; cross-RPC reuse is proved in both
//     directions, same and different complexity.
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

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Client } from "pg";

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
    version integer not null default 1,
    updated_by text,
    updated_at timestamptz,
    -- Fix round 2 (P1-A): the combined update RPC touches the full
    -- editable field set, so the stub carries every column it can
    -- set (types per createWorkPackage), plus the import-source
    -- unique index the post-write rollback leg needs. The real
    -- table carries the same columns (source index per migration
    -- 20261109000000).
    title text,
    description text,
    package_type text,
    priority text,
    project_id text,
    property_id text,
    responsible_party jsonb,
    planned_start date,
    planned_finish date,
    asset_id text,
    equipment_tag text,
    unit text,
    area text,
    system text,
    location_id text,
    work_order_ref text,
    workscope_code text,
    mode text,
    planned_qty numeric,
    planned_unit text,
    planned_manhours numeric,
    earned_qty numeric,
    earned_manhours numeric,
    actual_manhours numeric,
    progress_basis text,
    percent_complete numeric,
    progress_updated_at timestamptz,
    progress_updated_by text,
    source_system text,
    source_record_id text,
    -- Fix round 3 (P1-1): the combined RPC sets designated_verifier
    -- inside the same transaction; the stub carries the column the
    -- real table has (rung 1).
    designated_verifier text,
    primary key (owner_id, id)
  );
  create unique index uq_forge_work_packages_source
    on forge_work_packages (owner_id, source_system, source_record_id)
    where source_record_id is not null;
  -- Fix round 4 (P1-2): the production rung-1 version trigger
  -- (20261002120000_forge_work_management_rung1.sql,
  -- forge_work_packages_version_bump) — it fires on EVERY update
  -- and sets NEW.version := OLD.version + 1. The stub used to omit
  -- it, which hid the combined RPC's double version advancement
  -- on percent-changing saves; the stub now carries the real
  -- trigger verbatim, so every leg below proves the version
  -- contract against the production schema.
  create or replace function forge_work_packages_version_bump()
  returns trigger language plpgsql as $$
  begin
    NEW.version := OLD.version + 1;
    return NEW;
  end $$;
  drop trigger if exists forge_work_packages_version_bump_trg on forge_work_packages;
  create trigger forge_work_packages_version_bump_trg
    before update on forge_work_packages
    for each row execute function forge_work_packages_version_bump();
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
  // Convenience for the legs that are not testing concurrency: read
  // the instance's current version and generate a fresh request ID,
  // so every call satisfies the mandatory F2 parameters. Legs that
  // DO test concurrency pass expectedVersion/requestId explicitly.
  let expectedVersion = opts.expectedVersion;
  if (expectedVersion === undefined) {
    const { rows } = await db.query(`
      select version from forge_work_planning_process_instances
      where owner_id = '${ownerId}' and work_package_id = '${packageId}' and template_step_id = '${templateStepId}';`);
    expectedVersion = rows[0]?.version ?? 1;
  }
  const requestId = opts.requestId ?? `req_${randomUUID().replace(/-/g, "")}`;
  const { rows } = await asUser(db, uid, `
    select forge_work_planning_process_set_status(
      '${ownerId}', '${packageId}', '${templateStepId}', ${sqlStr(status)},
      ${sqlStr(opts.evidenceLink ?? null)}, ${sqlStr(opts.reason ?? null)},
      ${sqlStr(opts.attestation ?? null)}, ${sqlInt(expectedVersion)},
      ${sqlStr(requestId)}) as v;`);
  return rows[0].v;
}

async function setComplexity(db, uid, ownerId, packageId, complexity, opts = {}) {
  // Same convenience as setStatus: read the package's current
  // version and generate a fresh request ID unless the leg passes
  // them explicitly.
  let expectedVersion = opts.expectedVersion;
  if (expectedVersion === undefined) {
    const { rows } = await db.query(`
      select version from forge_work_packages
      where owner_id = '${ownerId}' and id = '${packageId}';`);
    expectedVersion = rows[0]?.version ?? 1;
  }
  const requestId = opts.requestId ?? `req_${randomUUID().replace(/-/g, "")}`;
  const { rows } = await asUser(db, uid, `
    select forge_work_planning_process_set_complexity(
      '${ownerId}', '${packageId}', ${sqlStr(complexity)},
      ${sqlInt(expectedVersion)}, ${sqlStr(requestId)}) as v;`);
  return rows[0].v;
}

async function updatePackage(db, uid, ownerId, packageId, complexity, updates, opts = {}) {
  // Same convenience as setComplexity, for the combined update RPC
  // (fix round 2, P1-A): read the package's current version and
  // generate a fresh request ID unless the leg passes them
  // explicitly. p_updates is passed as a JSON literal.
  let expectedVersion = opts.expectedVersion;
  if (expectedVersion === undefined) {
    const { rows } = await db.query(`
      select version from forge_work_packages
      where owner_id = '${ownerId}' and id = '${packageId}';`);
    expectedVersion = rows[0]?.version ?? 1;
  }
  const requestId = opts.requestId ?? `req_${randomUUID().replace(/-/g, "")}`;
  const { rows } = await asUser(db, uid, `
    select forge_work_planning_process_update_package(
      '${ownerId}', '${packageId}', ${sqlInt(expectedVersion)},
      ${sqlStr(requestId)}, ${sqlStr(complexity)},
      '${JSON.stringify(updates ?? {}).replace(/'/g, "''")}'::jsonb) as v;`);
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
           evidence_digest, attestation, is_override, request_id, actor_id,
           template_step_id
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

  it60("package creation atomically creates exactly 22 In-Progress instances; the checklist GET is read-only (F1)", async () => {
    // The trigger created the rows at seed time — before any
    // checklist call. A GET must never create rows.
    expect(await instancesFor(db, "pkg_a")).toHaveLength(22);
    const first = await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    expect(first.complexity).toBe("standard");
    expect(first.templateVersion).toBe(1);
    expect(first.canUpdate).toBe(true);
    expect(first.canReview).toBe(true);
    expect(first.isOwner).toBe(true);
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
    // A package whose rows are gone is UNAVAILABLE, never
    // auto-created by the GET. (pkg_b belongs to OWNER_B.)
    await db.query(`delete from forge_work_planning_process_instances where owner_id = '${OWNER_B}' and work_package_id = 'pkg_b';`);
    await expectRpcError(db, OWNER_B,
      `select forge_work_planning_process_checklist('${OWNER_B}', 'pkg_b');`,
      "WPP10_CHECKLIST_INCOMPLETE");
  });

  it60("package creation rolls back when checklist initialization fails (F1)", async () => {
    // Break the template inside a transaction, attempt a package
    // insert, prove it fails AND no package row survives, then roll
    // back so the template is whole again. The insert runs as a plain
    // query (not asUser): asUser's `reset role` in its finally would
    // mask the trigger's error once the transaction aborts. A
    // savepoint lets the assertions run after the expected failure.
    await db.exec("begin;");
    try {
      // Instances reference the template (RESTRICT), so clear the
      // referencing rows first, then break the template.
      await db.query(`delete from forge_work_planning_process_instances where template_step_id = 'pdf-22';`);
      await db.query(`delete from forge_work_planning_process_template where step_key = 'pdf-22';`);
      await db.exec("savepoint sp_rollback;");
      await expect(db.query(
        `insert into forge_work_packages (owner_id, id, status) values ('${OWNER_A}', 'pkg_rollback', 'in_progress');`))
        .rejects.toThrow(/WPP10_TEMPLATE_INVALID/);
      await db.exec("rollback to savepoint sp_rollback;");
      const { rows } = await db.query(`select count(*)::int as n from forge_work_packages where id = 'pkg_rollback';`);
      expect(rows[0].n).toBe(0);
      const inst = await db.query(`select count(*)::int as n from forge_work_planning_process_instances where work_package_id = 'pkg_rollback';`);
      expect(inst.rows[0].n).toBe(0);
    } finally {
      await db.exec("rollback;");
    }
    const { rows } = await db.query(`select count(*)::int as n from forge_work_planning_process_template;`);
    expect(rows[0].n).toBe(22);
  });

  it60("migration backfills existing packages idempotently (F1)", async () => {
    // A package that exists BEFORE this migration applies gets its 22
    // rows from the backfill — and a re-apply adds none.
    const fresh = new PGlite();
    try {
      await fresh.exec(PREREQ_SQL);
      await fresh.exec(loadMigrationSql(ADMIN_MIGRATION));
      await fresh.exec(`insert into forge_work_packages (owner_id, id, status) values ('${OWNER_A}', 'pkg_pre', 'in_progress');`);
      await fresh.exec(loadMigrationSql(THIS_MIGRATION));
      const { rows } = await fresh.query(`select count(*)::int as n, count(distinct template_step_id)::int as keys from forge_work_planning_process_instances where work_package_id = 'pkg_pre';`);
      expect(rows[0].n).toBe(22);
      expect(rows[0].keys).toBe(22);
      await fresh.exec(loadMigrationSql(THIS_MIGRATION));
      const again = await fresh.query(`select count(*)::int as n from forge_work_planning_process_instances where work_package_id = 'pkg_pre';`);
      expect(again.rows[0].n).toBe(22);
    } finally {
      await fresh.close();
    }
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
    // Instances reference the template (RESTRICT), so clear the
    // referencing rows first, then break the template.
    await db.query(`delete from forge_work_planning_process_instances where template_step_id = 'pdf-22';`);
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

  it60("Reviewed records the reviewer; leaving Reviewed clears reviewer attribution (F3)", async () => {
    // Reviewed from In-Progress has no prior submission to judge.
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-15', 'Reviewed', null, null, null, 1, 'req_rev_basis_1');`,
      "WPP10_REVIEW_BASIS_REQUIRED");
    // MEMBER_D (planner_admin) submits pdf-15; the owner (a different
    // reviewer) marks it Reviewed.
    await provisionAndAssign(db, MEMBER_D, "planner_admin");
    await setStatus(db, MEMBER_D, OWNER_A, "pkg_a", "pdf-15", "Complete",
      { evidenceLink: "https://example.com/job-plan.pdf" });
    const reviewed = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-15", "Reviewed");
    expect(reviewed.status).toBe("Reviewed");
    expect(reviewed.reviewed_by).toBe(OWNER_A);
    expect(reviewed.reviewed_at).not.toBeNull();
    // A Reviewed row may only go back through Needs Revision.
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-15', 'Complete', 'https://example.com/job-plan.pdf', null, null, 3, 'req_rev_lock_1');`,
      "WPP10_REVIEWED_LOCKED");
    const sentBack = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-15", "Needs Revision",
      { reason: "Job plan misses the night-shift crew." });
    expect(sentBack.status).toBe("Needs Revision");
    expect(sentBack.reviewed_by).toBeNull();
    expect(sentBack.reviewed_at).toBeNull();
  });

  it60("Complete needs an evidence link or an attestation", async () => {
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Complete', null, null, null, 1, 'req_ev_1');`,
      "WPP10_EVIDENCE_REQUIRED");
    const byLink = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete",
      { evidenceLink: "https://example.com/p-id.pdf" });
    expect(byLink.status).toBe("Complete");
    const byAttestation = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-02", "Complete",
      { attestation: "I walked the plot plan and it matches the scope." });
    expect(byAttestation.status).toBe("Complete");
  });

  it60("N/A and Needs Revision need a nonempty reason", async () => {
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-06', 'N/A', null, null, null, 1, 'req_na_1');`,
      "WPP10_REASON_REQUIRED");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Needs Revision', null, null, null, 1, 'req_nr_1');`,
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
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-15', 'Complete', null, null, null, 3, 'req_fresh_1');`,
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
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Reviewed', null, null, null, 2, 'req_self_1');`,
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
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-02', 'Reviewed', null, null, null, 2, 'req_self_2');`,
      "WPP10_REASON_REQUIRED");
    const overridden = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-02", "Reviewed",
      { reason: "Owner override: I completed this step and I am reviewing it." });
    expect(overridden.status).toBe("Reviewed");
    const events = await revisionsFor(db, "pkg_a");
    const overrideEvent = events.find((e) => e.new_status === "Reviewed" && e.is_override);
    expect(overrideEvent).toBeDefined();
    expect(overrideEvent.reason).toMatch(/Owner override/);
  });

  it60("a Planner assignee can set Complete but not Reviewed, N/A, or Needs Revision (F3)", async () => {
    await provisionAndAssign(db, MEMBER_D, "planner");
    const updated = await setStatus(db, MEMBER_D, OWNER_A, "pkg_a", "pdf-01", "Complete",
      { evidenceLink: "https://example.com/p-id.pdf" });
    expect(updated.status).toBe("Complete");
    await expectRpcError(db, MEMBER_D,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-02', 'Reviewed', null, null, null, 1, 'req_pl_1');`,
      "WPP10_REVIEW_FORBIDDEN");
    // N/A and Needs Revision need the REVIEW capability, not update.
    await expectRpcError(db, MEMBER_D,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-03', 'N/A', null, 'Not needed here.', null, 1, 'req_pl_2');`,
      "WPP10_REVIEW_CAPABILITY_REQUIRED");
    await expectRpcError(db, MEMBER_D,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-03', 'Needs Revision', null, 'Fix the markup.', null, 1, 'req_pl_3');`,
      "WPP10_REVIEW_CAPABILITY_REQUIRED");
  });

  it60("a Reviewer assignee can set Reviewed, N/A, and Needs Revision but not ordinary statuses (F3)", async () => {
    await provisionAndAssign(db, MEMBER_E, "reviewer");
    // The owner submits pdf-01; the reviewer (a different actor) can
    // mark it Reviewed.
    await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete",
      { evidenceLink: "https://example.com/p-id.pdf" });
    const reviewed = await setStatus(db, MEMBER_E, OWNER_A, "pkg_a", "pdf-01", "Reviewed");
    expect(reviewed.status).toBe("Reviewed");
    expect(reviewed.reviewed_by).toBe(MEMBER_E);
    // A Reviewer CAN record N/A (with a reason) and Needs Revision
    // (with a reason) — the review capability covers both.
    const na = await setStatus(db, MEMBER_E, OWNER_A, "pkg_a", "pdf-06", "N/A",
      { reason: "No engineering request needed on this package." });
    expect(na.status).toBe("N/A");
    const nr = await setStatus(db, MEMBER_E, OWNER_A, "pkg_a", "pdf-02", "Needs Revision",
      { reason: "Plot plan misses the new tie-in." });
    expect(nr.status).toBe("Needs Revision");
    // But a Reviewer cannot set ordinary statuses.
    await expectRpcError(db, MEMBER_E,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-03', 'Complete', 'https://example.com/x.pdf', null, null, 1, 'req_rv_1');`,
      "WPP10_UPDATE_FORBIDDEN");
    await expectRpcError(db, MEMBER_E,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-04', 'In-Progress', null, null, null, 1, 'req_rv_2');`,
      "WPP10_UPDATE_FORBIDDEN");
  });

  it60("a staff reader with only .read can open the checklist but cannot change a status", async () => {
    await provisionAndAssign(db, MEMBER_D, "read_only");
    const result = await checklist(db, MEMBER_D, OWNER_A, "pkg_a");
    expect(result.instances).toHaveLength(22);
    expect(result.canUpdate).toBe(false);
    expect(result.canReview).toBe(false);
    await expectRpcError(db, MEMBER_D,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Complete', 'https://example.com/x.pdf', null, null, 1, 'req_ro_1');`,
      "WPP10_UPDATE_FORBIDDEN");
  });

  it60("stale expected version returns 409; the matching version succeeds", async () => {
    await checklist(db, OWNER_A, OWNER_A, "pkg_a");
    await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete",
      { evidenceLink: "https://example.com/p-id.pdf", expectedVersion: 1 });
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'In-Progress', null, null, null, 1, 'req_stale_1');`,
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

  it60("missing/invalid expected version and request ID are rejected (F2)", async () => {
    // A missing expected version is a 400, never an optional guard.
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Complete', 'https://example.com/x.pdf', null, null, null, 'req_mv_1');`,
      "WPP10_EXPECTED_VERSION_REQUIRED");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Complete', 'https://example.com/x.pdf', null, null, 0, 'req_mv_2');`,
      "WPP10_EXPECTED_VERSION_REQUIRED");
    // A missing request ID is a 400; an over-long one is a 400.
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Complete', 'https://example.com/x.pdf', null, null, 1, null);`,
      "WPP10_REQUEST_ID_REQUIRED");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Complete', 'https://example.com/x.pdf', null, null, 1, '${"x".repeat(129)}');`,
      "WPP10_INVALID_REQUEST_ID");
  });

  it60("request-ID reuse with a different payload is a conflict (F2)", async () => {
    const first = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete",
      { evidenceLink: "https://example.com/p-id.pdf", requestId: "req_conflict_1" });
    expect(first.version).toBe(2);
    // Same request ID, different status -> conflict.
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'In-Progress', null, null, null, 2, 'req_conflict_1');`,
      "WPP10_REQUEST_ID_CONFLICT");
    // Same request ID, same status but different evidence -> conflict.
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Complete', 'https://example.com/other.pdf', null, null, 2, 'req_conflict_1');`,
      "WPP10_REQUEST_ID_CONFLICT");
    // Same request ID, same payload -> replay, no second event.
    const replay = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete",
      { evidenceLink: "https://example.com/p-id.pdf", requestId: "req_conflict_1" });
    expect(replay.version).toBe(2);
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(1);
  });

  it60("omitted-evidence replay survives an intervening evidence change (fix round 2, P1-B)", async () => {
    // Original call: Complete with an attestation and NO evidence
    // link (evidence omitted). The canonical payload records that
    // omission explicitly.
    const first = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete",
      { attestation: "Walked the plot plan; it matches the scope.", requestId: "req_omit_1" });
    expect(first.version).toBe(2);
    expect(first.evidence_link).toBeNull();
    // An intervening change (different request ID) replaces the
    // evidence link on the same step.
    const changed = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete",
      { evidenceLink: "https://example.com/plot-v2.pdf", expectedVersion: 2, requestId: "req_omit_2" });
    expect(changed.version).toBe(3);
    expect(changed.evidence_link).toBe("https://example.com/plot-v2.pdf");
    // Replaying the ORIGINAL call (same request ID, evidence still
    // omitted) must replay — not conflict — even though the row's
    // stored evidence changed in between.
    const replay = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete",
      { attestation: "Walked the plot plan; it matches the scope.", requestId: "req_omit_1" });
    expect(replay.version).toBe(3);
    expect(replay.evidence_link).toBe("https://example.com/plot-v2.pdf");
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(2);
    // Controls: the same request ID with a supplied evidence link,
    // or with the evidence explicitly cleared, is a DIFFERENT raw
    // payload — a conflict, not a replay.
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Complete', 'https://example.com/plot-v2.pdf', null, 'Walked the plot plan; it matches the scope.', 3, 'req_omit_1');`,
      "WPP10_REQUEST_ID_CONFLICT");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Complete', '', null, 'Walked the plot plan; it matches the scope.', 3, 'req_omit_1');`,
      "WPP10_REQUEST_ID_CONFLICT");
  });

  it60("Reviewed needs a distinct prior submission with an existing basis, and no new evidence in the same decision (F3)", async () => {
    await provisionAndAssign(db, MEMBER_D, "planner_admin");
    // In-Progress has no submission to review.
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Reviewed', null, null, null, 1, 'req_basis_1');`,
      "WPP10_REVIEW_BASIS_REQUIRED");
    // Complete via attestation only: the attestation in the latest
    // revision IS a qualifying basis.
    await setStatus(db, MEMBER_D, OWNER_A, "pkg_a", "pdf-02", "Complete",
      { attestation: "I walked the plot plan and it matches the scope." });
    const byAttestation = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-02", "Reviewed");
    expect(byAttestation.status).toBe("Reviewed");
    // N/A: the confirmation reason in the latest revision is the basis.
    await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-06", "N/A",
      { reason: "No engineering request needed on this package." });
    const naReviewed = await setStatus(db, MEMBER_D, OWNER_A, "pkg_a", "pdf-06", "Reviewed");
    expect(naReviewed.status).toBe("Reviewed");
    // A review cannot add new evidence in the same decision (the
    // reviewer is not the owner and supplies no reason).
    await setStatus(db, MEMBER_D, OWNER_A, "pkg_a", "pdf-03", "Complete",
      { evidenceLink: "https://example.com/plot.pdf" });
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-03', 'Reviewed', 'https://example.com/fresh.pdf', null, null, 2, 'req_basis_2');`,
      "WPP10_REVIEW_EVIDENCE_SAME_REQUEST");
    // An owner/co-owner reasoned override CAN supply new evidence —
    // recorded as an override. (The owner submitted pdf-04, so the
    // reason does double duty: self-review override + evidence
    // override.)
    await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-04", "Complete",
      { evidenceLink: "https://example.com/equip.pdf" });
    const overridden = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-04", "Reviewed",
      { evidenceLink: "https://example.com/equip-v2.pdf", reason: "Owner override: re-checked the equipment details against the new cut sheet." });
    expect(overridden.status).toBe("Reviewed");
    expect(overridden.evidence_link).toBe("https://example.com/equip-v2.pdf");
    const events = await revisionsFor(db, "pkg_a");
    const overrideEvent = events.find((e) => e.new_status === "Reviewed" && e.is_override && e.evidence_reference === "https://example.com/equip-v2.pdf");
    expect(overrideEvent).toBeDefined();
  });

  it60("returning from Needs Revision is two-step: resubmit Complete, then a different reviewer marks Reviewed (F3)", async () => {
    await provisionAndAssign(db, MEMBER_D, "planner_admin");
    await setStatus(db, MEMBER_D, OWNER_A, "pkg_a", "pdf-15", "Complete",
      { evidenceLink: "https://example.com/job-plan-v1.pdf" });
    await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-15", "Needs Revision",
      { reason: "Job plan misses the night-shift crew." });
    // Reviewed directly from Needs Revision is rejected.
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-15', 'Reviewed', null, null, null, 3, 'req_two_1');`,
      "WPP10_TWO_STEP_REQUIRED");
    // Resubmit as Complete with fresh evidence, then a different
    // reviewer (the owner did not submit the resubmission) marks
    // Reviewed.
    const resubmitted = await setStatus(db, MEMBER_D, OWNER_A, "pkg_a", "pdf-15", "Complete",
      { evidenceLink: "https://example.com/job-plan-v2.pdf" });
    expect(resubmitted.status).toBe("Complete");
    const reviewed = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-15", "Reviewed");
    expect(reviewed.status).toBe("Reviewed");
    expect(reviewed.reviewed_by).toBe(OWNER_A);
  });

  it60("terminal packages cannot change planning status", async () => {
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_cancelled', 'pdf-01', 'Complete', 'https://example.com/x.pdf', null, null, 1, 'req_term_1');`,
      "WPP10_PACKAGE_TERMINAL");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_closed', 'pdf-01', 'Complete', 'https://example.com/x.pdf', null, null, 1, 'req_term_2');`,
      "WPP10_PACKAGE_TERMINAL");
  });

  it60("evidence link: omitted preserves, replacement replaces, explicit clear is rejected unless a valid attestation replaces it (F4)", async () => {
    const withLink = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete", { evidenceLink: "https://example.com/p-id.pdf" });
    expect(withLink.evidence_link).toBe("https://example.com/p-id.pdf");
    // Omitted link preserves the stored link.
    const preserved = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete", { evidenceLink: null });
    expect(preserved.evidence_link).toBe("https://example.com/p-id.pdf");
    // Replacement link.
    const replaced = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete", { evidenceLink: "https://example.com/p-id-v2.pdf" });
    expect(replaced.evidence_link).toBe("https://example.com/p-id-v2.pdf");
    // Explicit clear with no replacement basis is NOT evidence.
    await expect(setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete", { evidenceLink: "" }))
      .rejects.toThrow(/WPP10_EVIDENCE_REQUIRED/);
    // Explicit clear WITH a valid attestation is allowed.
    const cleared = await setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete",
      { evidenceLink: "", attestation: "I verified the P&ID by hand against the field walk." });
    expect(cleared.evidence_link).toBeNull();
    // An over-long link is rejected.
    await expect(setStatus(db, OWNER_A, OWNER_A, "pkg_a", "pdf-01", "Complete", { evidenceLink: "x".repeat(2001) }))
      .rejects.toThrow(/WPP10_INVALID_EVIDENCE_LINK/);
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
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-01', 'Pending', null, null, null, 1, 'req_inv_1');`,
      "WPP10_INVALID_STATUS");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-99', 'Complete', null, null, null, 1, 'req_inv_2');`,
      "WPP10_STEP_NOT_FOUND");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_status('${OWNER_A}', 'pkg_a', 'pdf-06', 'N/A', null, '${"x".repeat(501)}', null, 1, 'req_inv_3');`,
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

  it60("complexity RPC: success updates the package and appends one complexity_change event in the same transaction (F5)", async () => {
    const updated = await setComplexity(db, OWNER_A, OWNER_A, "pkg_a", "high");
    expect(updated.planning_complexity).toBe("high");
    expect(updated.version).toBe(2);
    expect(updated.updated_by).toBe(OWNER_A);
    const { rows: pkgRows } = await db.query(`select planning_complexity, version from forge_work_packages where id = 'pkg_a';`);
    expect(pkgRows[0].planning_complexity).toBe("high");
    expect(pkgRows[0].version).toBe(2);
    const events = await revisionsFor(db, "pkg_a");
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("complexity_change");
    expect(events[0].actor_id).toBe(OWNER_A);
    expect(events[0].template_step_id).toBeNull();
    expect(events[0].old_status).toBeNull();
    expect(events[0].new_status).toBeNull();
    expect(events[0].request_id).toBeDefined();
    const { rows: raw } = await db.query(`select old_values, new_values from forge_work_planning_process_revisions where work_package_id = 'pkg_a';`);
    expect(raw[0].old_values).toEqual({ complexity: "standard" });
    expect(raw[0].new_values).toEqual({ complexity: "high" });
  });

  it60("complexity RPC: a stale version rolls everything back — no package change, no event (F5)", async () => {
    await setComplexity(db, OWNER_A, OWNER_A, "pkg_a", "high");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_complexity('${OWNER_A}', 'pkg_a', 'low', 1, 'req_cx_stale_1');`,
      "WPP10_STALE_VERSION");
    const { rows } = await db.query(`select planning_complexity, version from forge_work_packages where id = 'pkg_a';`);
    expect(rows[0].planning_complexity).toBe("high");
    expect(rows[0].version).toBe(2);
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(1);
  });

  it60("complexity RPC: the event records the caller from auth.uid() — there is no actor parameter to forge (F5)", async () => {
    await setComplexity(db, OWNER_A, OWNER_A, "pkg_a", "mid");
    const events = await revisionsFor(db, "pkg_a");
    expect(events).toHaveLength(1);
    expect(events[0].actor_id).toBe(OWNER_A);
    // A co-owner's change is attributed to the co-owner.
    await setComplexity(db, MEMBER_C, OWNER_A, "pkg_a", "low");
    const after = await revisionsFor(db, "pkg_a");
    expect(after).toHaveLength(2);
    expect(after[1].actor_id).toBe(MEMBER_C);
  });

  it60("complexity RPC: cross-workspace and capability failures (F5)", async () => {
    // A stranger (another owner) reaches nothing.
    await expectRpcError(db, OWNER_B,
      `select forge_work_planning_process_set_complexity('${OWNER_A}', 'pkg_a', 'high', 1, 'req_cx_xws_1');`,
      "WPP10_WORKSPACE_FORBIDDEN");
    // A Reviewer assignee has no planner.packages.edit.
    await provisionAndAssign(db, MEMBER_E, "reviewer");
    await expectRpcError(db, MEMBER_E,
      `select forge_work_planning_process_set_complexity('${OWNER_A}', 'pkg_a', 'high', 1, 'req_cx_xws_2');`,
      "WPP10_COMPLEXITY_FORBIDDEN");
    // A Planner assignee HAS planner.packages.edit and can change it.
    await provisionAndAssign(db, MEMBER_D, "planner");
    const updated = await setComplexity(db, MEMBER_D, OWNER_A, "pkg_a", "high");
    expect(updated.planning_complexity).toBe("high");
  });

  it60("complexity RPC: duplicate request with a different payload is a conflict; same payload replays (F5)", async () => {
    const first = await setComplexity(db, OWNER_A, OWNER_A, "pkg_a", "high", { requestId: "req_cx_dup_1" });
    expect(first.planning_complexity).toBe("high");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_complexity('${OWNER_A}', 'pkg_a', 'low', 2, 'req_cx_dup_1');`,
      "WPP10_REQUEST_ID_CONFLICT");
    const replay = await setComplexity(db, OWNER_A, OWNER_A, "pkg_a", "high", { requestId: "req_cx_dup_1" });
    expect(replay.planning_complexity).toBe("high");
    expect(replay.version).toBe(2);
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(1);
  });

  it60("complexity RPC: invalid complexity, missing version, missing request ID, and terminal package are rejected (F5)", async () => {
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_complexity('${OWNER_A}', 'pkg_a', 'extreme', 1, 'req_cx_inv_1');`,
      "WPP10_INVALID_COMPLEXITY");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_complexity('${OWNER_A}', 'pkg_a', 'high', null, 'req_cx_inv_2');`,
      "WPP10_EXPECTED_VERSION_REQUIRED");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_complexity('${OWNER_A}', 'pkg_a', 'high', 1, null);`,
      "WPP10_REQUEST_ID_REQUIRED");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_complexity('${OWNER_A}', 'pkg_cancelled', 'high', 1, 'req_cx_inv_3');`,
      "WPP10_PACKAGE_TERMINAL");
    // A no-op (same value) returns the row with no event and no bump.
    const noop = await setComplexity(db, OWNER_A, OWNER_A, "pkg_a", "standard");
    expect(noop.planning_complexity).toBe("standard");
    expect(noop.version).toBe(1);
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(0);
  });

  it60("combined update RPC: fields + complexity + one event commit together, version bumps once (fix round 2, P1-A)", async () => {
    // Quantity basis with earned/planned set: percent derives to 50.
    const updated = await updatePackage(db, OWNER_A, OWNER_A, "pkg_a", "high",
      { title: "Turnaround — north rack", priority: "high", progress_basis: "quantity",
        planned_qty: 10, planned_unit: "each", earned_qty: 5,
        planned_start: "2026-11-02", planned_finish: "2026-11-20" });
    expect(updated.planning_complexity).toBe("high");
    expect(updated.title).toBe("Turnaround — north rack");
    expect(updated.priority).toBe("high");
    expect(updated.version).toBe(2);
    expect(Number(updated.percent_complete)).toBe(50);
    expect(updated.updated_by).toBe(OWNER_A);
    const events = await revisionsFor(db, "pkg_a");
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("complexity_change");
    expect(events[0].actor_id).toBe(OWNER_A);
    expect(events[0].template_step_id).toBeNull();
    const { rows: raw } = await db.query(`select old_values, new_values from forge_work_planning_process_revisions where work_package_id = 'pkg_a';`);
    expect(raw[0].old_values).toEqual({ complexity: "standard" });
    expect(raw[0].new_values).toEqual({ complexity: "high" });
  });

  it60("combined update RPC: a post-write failure rolls back fields, complexity and event together (fix round 2, P1-A)", async () => {
    // A same-owner package already holds the source key: this
    // save violates the import-source unique index AFTER the
    // complexity change would have applied — the whole save must
    // roll back, leaving no half-applied package or event.
    await db.query(`update forge_work_packages set source_system = 'rentec', source_record_id = 'SRC-1' where id = 'pkg_cancelled';`);
    let caught = null;
    try {
      await updatePackage(db, OWNER_A, OWNER_A, "pkg_a", "high",
        { title: "Should not land", source_system: "rentec", source_record_id: "SRC-1" },
        { requestId: "req_comb_rollback_1" });
    } catch (error) {
      caught = error;
    }
    expect(caught, "expected the source conflict to raise").not.toBeNull();
    expect(String(caught.code || caught.message)).toMatch(/23505|uq_forge_work_packages_source/);
    const { rows } = await db.query(`select title, planning_complexity, version, source_system from forge_work_packages where id = 'pkg_a';`);
    expect(rows[0].title).toBeNull();
    expect(rows[0].planning_complexity).toBe("standard");
    expect(rows[0].version).toBe(1);
    expect(rows[0].source_system).toBeNull();
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(0);
  });

  it60("combined update RPC: stale version and invalid field payload roll everything back (fix round 2, P1-A)", async () => {
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_update_package('${OWNER_A}', 'pkg_a', 99, 'req_comb_stale_1', 'high', '{"title": "Stale"}'::jsonb);`,
      "WPP10_STALE_VERSION");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_update_package('${OWNER_A}', 'pkg_a', 1, 'req_comb_inv_1', 'high', '{"mode": "orbital"}'::jsonb);`,
      "WPP10_INVALID_PACKAGE_UPDATE");
    // A merged-candidate violation (finish before start) is caught
    // on the updated row before the event insert — same rollback.
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_update_package('${OWNER_A}', 'pkg_a', 1, 'req_comb_inv_2', 'high', '{"planned_start": "2026-11-20", "planned_finish": "2026-11-02"}'::jsonb);`,
      "WPP10_INVALID_PACKAGE_UPDATE");
    const { rows } = await db.query(`select title, planning_complexity, version from forge_work_packages where id = 'pkg_a';`);
    expect(rows[0].title).toBeNull();
    expect(rows[0].planning_complexity).toBe("standard");
    expect(rows[0].version).toBe(1);
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(0);
  });

  it60("combined update RPC: capability and terminal gates (fix round 2, P1-A)", async () => {
    // A Reviewer assignee has no planner.packages.edit.
    await provisionAndAssign(db, MEMBER_E, "reviewer");
    await expectRpcError(db, MEMBER_E,
      `select forge_work_planning_process_update_package('${OWNER_A}', 'pkg_a', 1, 'req_comb_cap_1', 'high', '{"title": "No"}'::jsonb);`,
      "WPP10_COMPLEXITY_FORBIDDEN");
    // A Planner assignee HAS planner.packages.edit and can use it.
    await provisionAndAssign(db, MEMBER_D, "planner");
    const updated = await updatePackage(db, MEMBER_D, OWNER_A, "pkg_a", "high", { title: "Planner save" });
    expect(updated.planning_complexity).toBe("high");
    expect(updated.title).toBe("Planner save");
    // A terminal package rejects the combined save outright.
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_update_package('${OWNER_A}', 'pkg_cancelled', 1, 'req_comb_cap_2', 'high', '{"title": "No"}'::jsonb);`,
      "WPP10_PACKAGE_TERMINAL");
  });

  it60("combined update RPC: no-op complexity still applies fields and records a package_update receipt; request-ID replay/conflict compare the full payload (fix round 3, P1-2)", async () => {
    // Same complexity value as the current row: fields still apply
    // and the version still bumps once, and the save records a
    // package_update receipt carrying the canonical full payload —
    // the request ID is recorded and replayable (fix round 3, P1-2:
    // a no-op-complexity call no longer leaves its request ID
    // unrecorded).
    const noop = await updatePackage(db, OWNER_A, OWNER_A, "pkg_a", "standard", { title: "Renamed" },
      { requestId: "req_comb_noop_1" });
    expect(noop.planning_complexity).toBe("standard");
    expect(noop.title).toBe("Renamed");
    expect(noop.version).toBe(2);
    const noopEvents = await revisionsFor(db, "pkg_a");
    expect(noopEvents).toHaveLength(1);
    expect(noopEvents[0].action).toBe("package_update");
    expect(noopEvents[0].request_id).toBe("req_comb_noop_1");
    const { rows: noopRaw } = await db.query(`select request_payload, new_values from forge_work_planning_process_revisions where work_package_id = 'pkg_a';`);
    expect(noopRaw[0].request_payload).toEqual({ complexity: "standard", updates: { title: "Renamed" } });
    expect(noopRaw[0].new_values).toEqual({ complexity: "standard", updates: { title: "Renamed" } });
    // A no-op-complexity retry with the same full payload replays;
    // the same request ID with different fields is a conflict.
    const noopReplay = await updatePackage(db, OWNER_A, OWNER_A, "pkg_a", "standard", { title: "Renamed" },
      { requestId: "req_comb_noop_1" });
    expect(noopReplay.version).toBe(2);
    expect(noopReplay.title).toBe("Renamed");
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(1);
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_update_package('${OWNER_A}', 'pkg_a', 2, 'req_comb_noop_1', 'standard', '{"title": "Other"}'::jsonb);`,
      "WPP10_REQUEST_ID_CONFLICT");
    // A real change with a request ID: replay returns the current
    // row with no second event; reuse with a different complexity
    // is a conflict.
    const first = await updatePackage(db, OWNER_A, OWNER_A, "pkg_a", "high", { priority: "critical" },
      { requestId: "req_comb_dup_1" });
    expect(first.planning_complexity).toBe("high");
    expect(first.version).toBe(3);
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_update_package('${OWNER_A}', 'pkg_a', 3, 'req_comb_dup_1', 'low', '{"priority": "low"}'::jsonb);`,
      "WPP10_REQUEST_ID_CONFLICT");
    const replay = await updatePackage(db, OWNER_A, OWNER_A, "pkg_a", "high", { priority: "critical" },
      { requestId: "req_comb_dup_1" });
    expect(replay.planning_complexity).toBe("high");
    expect(replay.version).toBe(3);
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(2);
  });

  it60("combined update RPC: same request ID with the same complexity but different fields is a conflict, not a silent replay (fix round 3, P1-2)", async () => {
    // The verdict's counterexample: R commits high + {priority:
    // critical}; reusing R with high + {priority: low} must raise
    // WPP10_REQUEST_ID_CONFLICT, not return the current row as a
    // successful replay.
    const first = await updatePackage(db, OWNER_A, OWNER_A, "pkg_a", "high", { priority: "critical" },
      { requestId: "req_comb_full_1" });
    expect(first.planning_complexity).toBe("high");
    expect(first.priority).toBe("critical");
    expect(first.version).toBe(2);
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_update_package('${OWNER_A}', 'pkg_a', 2, 'req_comb_full_1', 'high', '{"priority": "low"}'::jsonb);`,
      "WPP10_REQUEST_ID_CONFLICT");
    // The failed reuse applied nothing: priority is still critical,
    // version unmoved, still one event.
    const { rows } = await db.query(`select priority, planning_complexity, version from forge_work_packages where id = 'pkg_a';`);
    expect(rows[0].priority).toBe("critical");
    expect(rows[0].planning_complexity).toBe("high");
    expect(rows[0].version).toBe(2);
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(1);
    // The exact same full payload replays.
    const replay = await updatePackage(db, OWNER_A, OWNER_A, "pkg_a", "high", { priority: "critical" },
      { requestId: "req_comb_full_1" });
    expect(replay.version).toBe(2);
    expect(replay.priority).toBe("critical");
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(1);
  });

  it60("combined update RPC: a request ID first used by the standalone complexity RPC conflicts on a different payload (fix round 3, P1-2; fix round 4, P1-1)", async () => {
    // The standalone complexity RPC stores the canonical payload
    // {complexity, updates: {}}; a combined call reusing its
    // request ID with a different payload cannot prove the payload
    // matches: it must conflict, never silently replay. (The
    // same-payload replay in the other direction is proved by the
    // cross-RPC leg below.)
    const first = await setComplexity(db, OWNER_A, OWNER_A, "pkg_a", "high", { requestId: "req_comb_xrpc_1" });
    expect(first.planning_complexity).toBe("high");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_update_package('${OWNER_A}', 'pkg_a', 2, 'req_comb_xrpc_1', 'high', '{"title": "No"}'::jsonb);`,
      "WPP10_REQUEST_ID_CONFLICT");
    const { rows } = await db.query(`select title, planning_complexity, version from forge_work_packages where id = 'pkg_a';`);
    expect(rows[0].title).toBeNull();
    expect(rows[0].planning_complexity).toBe("high");
    expect(rows[0].version).toBe(2);
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(1);
  });

  it60("cross-RPC request-ID reuse: a combined receipt with field updates conflicts in the standalone RPC, same and different complexity (fix round 4, P1-1)", async () => {
    // The verdict's counterexample, reverse direction: R commits
    // high + {priority: critical} through the combined RPC. A later
    // standalone complexity call reusing R with the SAME complexity
    // must NOT replay — the combined receipt carries field updates
    // the standalone call does not — and neither must a reuse with a
    // different complexity.
    const first = await updatePackage(db, OWNER_A, OWNER_A, "pkg_a", "high", { priority: "critical" },
      { requestId: "req_xrpc_c2s_1" });
    expect(first.planning_complexity).toBe("high");
    expect(first.priority).toBe("critical");
    expect(first.version).toBe(2);
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_complexity('${OWNER_A}', 'pkg_a', 'high', 2, 'req_xrpc_c2s_1');`,
      "WPP10_REQUEST_ID_CONFLICT");
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_set_complexity('${OWNER_A}', 'pkg_a', 'low', 2, 'req_xrpc_c2s_1');`,
      "WPP10_REQUEST_ID_CONFLICT");
    // Neither failed reuse applied anything: priority still
    // critical, complexity still high, version unmoved, one event.
    const { rows } = await db.query(`select priority, planning_complexity, version from forge_work_packages where id = 'pkg_a';`);
    expect(rows[0].priority).toBe("critical");
    expect(rows[0].planning_complexity).toBe("high");
    expect(rows[0].version).toBe(2);
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(1);
  });

  it60("cross-RPC request-ID reuse: the same canonical payload replays in both directions (fix round 4, P1-1)", async () => {
    // Standalone first, then combined with the same logical
    // operation: complexity high, no field updates. The combined
    // call's canonical payload {complexity: high, updates: {}} is
    // identical to the standalone receipt's, so it replays —
    // no second event, version unmoved.
    const first = await setComplexity(db, OWNER_A, OWNER_A, "pkg_a", "high", { requestId: "req_xrpc_both_1" });
    expect(first.planning_complexity).toBe("high");
    expect(first.version).toBe(2);
    const replay = await updatePackage(db, OWNER_A, OWNER_A, "pkg_a", "high", {},
      { requestId: "req_xrpc_both_1" });
    expect(replay.planning_complexity).toBe("high");
    expect(replay.version).toBe(2);
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(1);
    // Combined first, then standalone with the same logical
    // operation: the combined receipt's payload is {complexity:
    // high, updates: {}} (empty updates), so the standalone call
    // replays it — no second event, version unmoved. (The combined
    // save itself still applies and bumps once, 2 → 3, as every
    // applied combined save does.)
    const second = await updatePackage(db, OWNER_A, OWNER_A, "pkg_a", "high", {},
      { requestId: "req_xrpc_both_2" });
    expect(second.version).toBe(3);
    const { rows: raw2 } = await db.query(`select request_payload from forge_work_planning_process_revisions where work_package_id = 'pkg_a' and request_id = 'req_xrpc_both_2';`);
    expect(raw2[0].request_payload).toEqual({ complexity: "high", updates: {} });
    const replay2 = await setComplexity(db, OWNER_A, OWNER_A, "pkg_a", "high", { requestId: "req_xrpc_both_2" });
    expect(replay2.planning_complexity).toBe("high");
    expect(replay2.version).toBe(3);
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(2);
  });

  it60("combined update RPC: successive percent-changing saves advance the version exactly once each under the production version trigger (fix round 4, P1-2)", async () => {
    // The verdict's schema-faithfulness leg: the stub now carries
    // the production rung-1 version trigger (fires on EVERY
    // update), so a percent-changing save must still land at
    // exactly +1 — the old two-statement save advanced it by two
    // here (one explicit +1, one trigger firing on the second
    // UPDATE). Successive saves pin the exact version each time,
    // and a stale write at the superseded version still 409s.
    const first = await updatePackage(db, OWNER_A, OWNER_A, "pkg_a", "high",
      { progress_basis: "quantity", planned_qty: 10, planned_unit: "each", earned_qty: 5 },
      { requestId: "req_pct_trg_1" });
    expect(first.version).toBe(2);
    expect(Number(first.percent_complete)).toBe(50);
    const second = await updatePackage(db, OWNER_A, OWNER_A, "pkg_a", null,
      { earned_qty: 10 }, { requestId: "req_pct_trg_2" });
    expect(second.version).toBe(3);
    expect(Number(second.percent_complete)).toBe(100);
    const third = await updatePackage(db, OWNER_A, OWNER_A, "pkg_a", null,
      { earned_qty: 0 }, { requestId: "req_pct_trg_3" });
    expect(third.version).toBe(4);
    expect(Number(third.percent_complete)).toBe(0);
    // Stale write at the version before the last save: 409, and
    // nothing lands.
    await expectRpcError(db, OWNER_A,
      `select forge_work_planning_process_update_package('${OWNER_A}', 'pkg_a', 3, 'req_pct_trg_stale', 'high', '{"title": "Stale"}'::jsonb);`,
      "WPP10_STALE_VERSION");
    const { rows } = await db.query(`select version, percent_complete, planning_complexity from forge_work_packages where id = 'pkg_a';`);
    expect(rows[0].version).toBe(4);
    expect(Number(rows[0].percent_complete)).toBe(0);
    expect(rows[0].planning_complexity).toBe("high");
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(3);
  });

  it60("combined update RPC: a verifier change rides in the same transaction as fields and complexity (fix round 3, P1-1)", async () => {
    // The owner designates a verifier in the same save that changes
    // complexity and fields: all three land together, version bumps
    // once, one complexity_change event carries the full payload
    // (the verifier inside updates).
    const updated = await updatePackage(db, OWNER_A, OWNER_A, "pkg_a", "high",
      { title: "Turnaround — north rack", designated_verifier: MEMBER_D });
    expect(updated.planning_complexity).toBe("high");
    expect(updated.title).toBe("Turnaround — north rack");
    expect(updated.designated_verifier).toBe(MEMBER_D);
    expect(updated.version).toBe(2);
    const events = await revisionsFor(db, "pkg_a");
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("complexity_change");
    const { rows: raw } = await db.query(`select request_payload from forge_work_planning_process_revisions where work_package_id = 'pkg_a';`);
    expect(raw[0].request_payload).toEqual({ complexity: "high", updates: { title: "Turnaround — north rack", designated_verifier: MEMBER_D } });
    // A verifier-only save (complexity already high) takes the same
    // path: the verifier lands with the fields, version bumps once,
    // and the save records a package_update receipt.
    const second = await updatePackage(db, OWNER_A, OWNER_A, "pkg_a", "high",
      { title: "Turnaround — south rack", designated_verifier: MEMBER_E });
    expect(second.planning_complexity).toBe("high");
    expect(second.title).toBe("Turnaround — south rack");
    expect(second.designated_verifier).toBe(MEMBER_E);
    expect(second.version).toBe(3);
    const after = await revisionsFor(db, "pkg_a");
    expect(after).toHaveLength(2);
    expect(after[1].action).toBe("package_update");
    // Clearing the verifier (explicit JSON null) lands in the same
    // transaction as the fields it rides with.
    const cleared = await updatePackage(db, OWNER_A, OWNER_A, "pkg_a", "high",
      { title: "Turnaround — final", designated_verifier: null });
    expect(cleared.designated_verifier).toBeNull();
    expect(cleared.title).toBe("Turnaround — final");
    expect(cleared.version).toBe(4);
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(3);
  });

  it60("combined update RPC: a forbidden verifier change fails the whole save — no field, complexity, version, event, or verifier change survives (fix round 3, P1-1)", async () => {
    // A co-owner passes has_workspace_access but is NOT the owner:
    // designating a verifier is forbidden, and the failure must
    // roll the entire save back — fields, complexity, version,
    // audit event, and verifier all untouched.
    await expectRpcError(db, MEMBER_C,
      `select forge_work_planning_process_update_package('${OWNER_A}', 'pkg_a', 1, 'req_comb_ver_1', 'high', '{"title": "Should not land", "designated_verifier": "${MEMBER_D}"}'::jsonb);`,
      "WPP10_VERIFIER_FORBIDDEN");
    const { rows } = await db.query(`select title, planning_complexity, version, designated_verifier from forge_work_packages where id = 'pkg_a';`);
    expect(rows[0].title).toBeNull();
    expect(rows[0].planning_complexity).toBe("standard");
    expect(rows[0].version).toBe(1);
    expect(rows[0].designated_verifier).toBeNull();
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(0);
    // A Planner assignee HAS planner.packages.edit but still may
    // not designate a verifier: same forbidden failure, same
    // nothing-survives.
    await provisionAndAssign(db, MEMBER_D, "planner");
    await expectRpcError(db, MEMBER_D,
      `select forge_work_planning_process_update_package('${OWNER_A}', 'pkg_a', 1, 'req_comb_ver_2', 'high', '{"title": "Should not land", "designated_verifier": "${MEMBER_E}"}'::jsonb);`,
      "WPP10_VERIFIER_FORBIDDEN");
    const { rows: after } = await db.query(`select title, planning_complexity, version, designated_verifier from forge_work_packages where id = 'pkg_a';`);
    expect(after[0].title).toBeNull();
    expect(after[0].planning_complexity).toBe("standard");
    expect(after[0].version).toBe(1);
    expect(after[0].designated_verifier).toBeNull();
    expect((await revisionsFor(db, "pkg_a"))).toHaveLength(0);
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
        and p.proname in ('forge_work_planning_process_checklist', 'forge_work_planning_process_set_status', 'forge_work_planning_process_set_complexity', 'forge_work_planning_process_update_package');`);
    expect(fns.rows).toHaveLength(4);
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

// Real-PostgreSQL subset (F2, fix round 1). PGlite is single-connection,
// so the two-session concurrency leg can only run here, against a
// scratch PG16 cluster. The suite is gated on the binaries existing AND
// an unprivileged user to run the cluster as (initdb refuses root, and
// this VM's agent runs as root) — and SKIPS LOUDLY, never silently,
// when either is missing.
//
// The cluster MUST be UTF8 (C.UTF-8): the default initdb under a POSIX
// locale creates a SQL_ASCII cluster, and in SQL_ASCII the em-dash in
// pdf-07's description is stored as raw bytes E2 80 94 — whose 0x80/0x94
// bytes are C1 control characters, so the migration's
// `description !~ '[[:cntrl:]]'` check rejects the seed. In UTF8 (what
// Supabase production uses, and what PGlite uses) the em-dash is one
// proper U+2014 character and the check passes. A SQL_ASCII failure here
// is a test-cluster artifact, not a migration defect.
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

describe.skipIf(!HAS_REAL_PG)("planning-process migration: real-PostgreSQL subset", () => {
  let pgDir;
  let pgClient;
  let pgCfg;

  beforeAll(async () => {
    pgDir = mkdtempSync(join(tmpdir(), "wpp-pp-realpg-"));
    execSync(`chown ${PG_RUN_USER}:${PG_RUN_USER} "${pgDir}"`, { stdio: "pipe" });
    const asPgUser = (cmd) => `runuser -u ${PG_RUN_USER} -- ${cmd}`;
    execSync(asPgUser(`"${PG_BIN}/initdb" -D "${pgDir}" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8`), { stdio: "pipe" });
    execSync(
      asPgUser(`"${PG_BIN}/pg_ctl" -D "${pgDir}" -o "-p 55435 -k ${pgDir} -c listen_addresses=''" -l "${pgDir}/server.log" start`),
      { stdio: "pipe" },
    );
    pgCfg = { host: pgDir, port: 55435, user: "postgres", database: "postgres" };
    pgClient = new Client(pgCfg);
    await pgClient.connect();
    await pgClient.query(PREREQ_SQL);
    await pgClient.query(loadMigrationSql(ADMIN_MIGRATION));
    // The package must exist BEFORE this migration applies: the
    // trigger creates its 22 rows at insert time.
    await pgClient.query(`
      insert into forge_work_packages (owner_id, id, status) values
        ('${OWNER_A}', 'pkg_real', 'in_progress');
      insert into workspace_members (owner_id, member_user_id, status, role)
        values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
    `);
    await pgClient.query(loadMigrationSql(THIS_MIGRATION));
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

  it60("two sessions changing the same step at the same version: one wins, the other gets 409, no lost audit/update pair", async () => {
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      // Both sessions read version 1 and both attempt the same change
      // at that version, with different request IDs.
      const change = (client, requestId) => pgAsUser(client, OWNER_A, `
        select forge_work_planning_process_set_status(
          '${OWNER_A}', 'pkg_real', 'pdf-01', 'Complete',
          'https://example.com/p-id.pdf', null, null, 1, '${requestId}');
      `);
      const results = await Promise.allSettled([
        change(clientA, "req_race_a"),
        change(clientB, "req_race_b"),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toMatch(/WPP10_STALE_VERSION/);
      // Exactly one audit row and one version bump: the loser's change
      // (and its event) never landed.
      const { rows: inst } = await pgClient.query(`
        select status, version from forge_work_planning_process_instances
        where owner_id = '${OWNER_A}' and work_package_id = 'pkg_real' and template_step_id = 'pdf-01';
      `);
      expect(inst).toHaveLength(1);
      expect(inst[0].status).toBe("Complete");
      expect(inst[0].version).toBe(2);
      const { rows: revs } = await pgClient.query(`
        select count(*)::int as n from forge_work_planning_process_revisions
        where owner_id = '${OWNER_A}' and work_package_id = 'pkg_real' and template_step_id = 'pdf-01';
      `);
      expect(revs[0].n).toBe(1);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("two sessions calling the combined update at the same version: one wins, the other gets 409, exactly one version bump under the production trigger (fix round 4, P1-2)", async () => {
    // The concurrent-writer leg for the combined RPC, against the
    // trigger-faithful schema: both sessions read version 1 and
    // attempt percent-changing combined saves at that version with
    // different request IDs. Exactly one applies (version 2,
    // percent 50, one receipt); the loser gets 409 and lands
    // nothing — and the winner's version is exactly 2, not 3, so
    // the trigger fired once for the one logical save.
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const change = (client, requestId) => pgAsUser(client, OWNER_A, `
        select forge_work_planning_process_update_package(
          '${OWNER_A}', 'pkg_real', 1, '${requestId}', 'high',
          '{"progress_basis": "quantity", "planned_qty": 10, "planned_unit": "each", "earned_qty": 5}'::jsonb);
      `);
      const results = await Promise.allSettled([
        change(clientA, "req_comb_race_a"),
        change(clientB, "req_comb_race_b"),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toMatch(/WPP10_STALE_VERSION/);
      const { rows: pkg } = await pgClient.query(`
        select planning_complexity, percent_complete, version from forge_work_packages
        where owner_id = '${OWNER_A}' and id = 'pkg_real';
      `);
      expect(pkg).toHaveLength(1);
      expect(pkg[0].planning_complexity).toBe("high");
      expect(Number(pkg[0].percent_complete)).toBe(50);
      expect(pkg[0].version).toBe(2);
      const { rows: revs } = await pgClient.query(`
        select count(*)::int as n from forge_work_planning_process_revisions
        where owner_id = '${OWNER_A}' and work_package_id = 'pkg_real' and template_step_id is null;
      `);
      expect(revs[0].n).toBe(1);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });
});
