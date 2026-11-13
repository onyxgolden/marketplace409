// Foundation PR B — Planner vertical proof, migration/integration proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) and proves:
//   - The link column is nullable with the composite FK
//     (owner_id, forge_project_id) -> forge_projects(owner_id, id)
//     ON DELETE RESTRICT; no backfill — a package that exists before
//     the migration applies stays NULL and byte-identical. Re-apply
//     fails loudly on the preflight (FORGE_PRB_COLUMN_EXISTS).
//   - The link/unlink RPC (forge_work_package_set_project): capability
//     conjunction (planner.packages.edit AND forge.hierarchy.manage),
//     actor from auth.uid(), optimistic version CAS (stale = 409),
//     request-id idempotency (same id + same target replays; same id +
//     different target conflicts), target validation (same owner;
//     project + site + client all non-archived), FK + audit in one
//     transaction. A no-op still writes an audit receipt (old = new)
//     so its request id is consumed.
//   - Cross-workspace attachment is impossible: a project or package
//     under another owner reads as not found (non-disclosing); the
//     composite FK is the backstop even if a caller guesses a valid id.
//   - The append-only audit table: RLS + FORCE RLS, SELECT-only ACL
//     for authenticated, no write policies; the RPC keeps the
//     authenticated-only EXECUTE proacl.
//   - A two-session real-PostgreSQL concurrency leg proves concurrent
//     duplicate request ids are idempotent (advisory-lock serialized:
//     one audit row, both callers get the same row) and concurrent
//     same-version links resolve to one winner + one 409.
//
// The forge_work_packages stub below mirrors production's shape for
// the columns this RPC touches (owner_id, id, version with the
// bump-on-update trigger, updated_by) — the full packages table lives
// in its own earlier migrations; the stub exists only so this test
// can run the PR B migration standalone.
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
const MEMBER_F = "66666666-6666-4666-8666-666666666666";

const PLANNER_ADMIN_MIGRATION = "20261110000000_forge_planner_admin_permissions_slice1.sql";
const RENTAL_ADMIN_MIGRATION = "20261110010000_rental_admin_roles_slice1.sql";
const SCHEDULING_ADMIN_MIGRATION = "20261110080000_forge_scheduling_admin_permissions_slice1.sql";
const FOUNDATION_A_MIGRATION = "20261112010000_forge_shared_hierarchy_foundation.sql";
const THIS_MIGRATION = "20261113000000_forge_work_package_project_link.sql";

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
    role text not null,
    permission_overrides jsonb not null default '{}'
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
  create table rental_tenants (
    owner_id text not null, id text not null, primary key (owner_id, id));
  create table rental_maintenance_requests (
    owner_id text not null, id text not null, primary key (owner_id, id));
  create table rental_maintenance_work_orders (
    owner_id text not null, id text not null, primary key (owner_id, id));
`;

const SEED_SQL = `
  insert into workspace_members (owner_id, member_user_id, status, role)
    values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner'),
           ('${OWNER_A}', '${MEMBER_D}', 'active', 'manager'),
           ('${OWNER_A}', '${MEMBER_E}', 'active', 'member');
`;

// Minimal production-shaped forge_work_packages for the columns the
// link RPC touches. Created BEFORE this migration applies (the
// migration adds forge_project_id itself); one legacy row is seeded
// here so the no-backfill leg can prove it stays NULL.
const PACKAGES_STUB_SQL = `
  create table forge_work_packages (
    owner_id text not null,
    id text not null,
    title text,
    status text not null default 'draft',
    version integer not null default 1,
    updated_by text,
    updated_at timestamptz not null default now(),
    primary key (owner_id, id)
  );
  create or replace function test_pkg_version_bump() returns trigger language plpgsql as $$
  begin
    new.version := old.version + 1;
    return new;
  end $$;
  create trigger test_pkg_version_bump before update on forge_work_packages
    for each row execute function test_pkg_version_bump();
  insert into forge_work_packages (owner_id, id, title)
    values ('${OWNER_A}', 'forge_wp_legacy', 'Legacy package (pre-migration)');
`;

async function setupDb() {
  const db = new PGlite();
  await db.exec(PREREQ_SQL);
  await db.exec(loadMigrationSql(PLANNER_ADMIN_MIGRATION));
  await db.exec(loadMigrationSql(RENTAL_ADMIN_MIGRATION));
  await db.exec(loadMigrationSql(SCHEDULING_ADMIN_MIGRATION));
  await db.exec(loadMigrationSql(FOUNDATION_A_MIGRATION));
  await db.exec(PACKAGES_STUB_SQL);
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

async function createClient(db, uid, ownerId, name) {
  const { rows } = await asUser(db, uid, `
    select forge_hierarchy_client_create(
      '${ownerId}', ${sqlStr(name)}, null, null,
      ${sqlStr(`req_${randomUUID().replace(/-/g, "")}`)}) as v;`);
  return rows[0].v;
}

async function createSite(db, uid, ownerId, clientId, name) {
  const { rows } = await asUser(db, uid, `
    select forge_hierarchy_site_create(
      '${ownerId}', '${clientId}', ${sqlStr(name)}, 'other',
      null, null, null, null, null, null,
      ${sqlStr(`req_${randomUUID().replace(/-/g, "")}`)}) as v;`);
  return rows[0].v;
}

async function createProject(db, uid, ownerId, siteId, name) {
  const { rows } = await asUser(db, uid, `
    select forge_hierarchy_project_create(
      '${ownerId}', '${siteId}', ${sqlStr(name)}, null, null, null, null, null,
      ${sqlStr(`req_${randomUUID().replace(/-/g, "")}`)}) as v;`);
  return rows[0].v;
}

async function archiveProject(db, uid, ownerId, projectId, siteId, expectedVersion) {
  const { rows } = await asUser(db, uid, `
    select forge_hierarchy_project_update(
      '${ownerId}', '${projectId}', '${siteId}', null, null, null, null, null, null,
      'archived', ${sqlInt(expectedVersion)},
      ${sqlStr(`req_${randomUUID().replace(/-/g, "")}`)}) as v;`);
  return rows[0].v;
}

async function archiveSite(db, uid, ownerId, siteId, clientId, expectedVersion) {
  const { rows } = await asUser(db, uid, `
    select forge_hierarchy_site_update(
      '${ownerId}', '${siteId}', '${clientId}', null, null, null, null, null,
      null, null, null, 'archived', ${sqlInt(expectedVersion)},
      ${sqlStr(`req_${randomUUID().replace(/-/g, "")}`)}) as v;`);
  return rows[0].v;
}

async function archiveClient(db, uid, ownerId, clientId, expectedVersion) {
  const { rows } = await asUser(db, uid, `
    select forge_hierarchy_client_update(
      '${ownerId}', '${clientId}', null, null, null, 'archived',
      ${sqlInt(expectedVersion)},
      ${sqlStr(`req_${randomUUID().replace(/-/g, "")}`)}) as v;`);
  return rows[0].v;
}

async function setProject(db, uid, ownerId, packageId, forgeProjectId, expectedVersion, opts = {}) {
  const requestId = opts.requestId ?? `req_${randomUUID().replace(/-/g, "")}`;
  const { rows } = await asUser(db, uid, `
    select forge_work_package_set_project(
      '${ownerId}', '${packageId}', ${sqlStr(forgeProjectId)},
      ${sqlInt(expectedVersion)}, ${sqlStr(requestId)},
      ${sqlStr(opts.reason ?? null)}) as v;`);
  return rows[0].v;
}

async function packageRow(db, ownerId, packageId) {
  const { rows } = await db.query(`
    select owner_id, id, title, status, version, forge_project_id, updated_by
      from forge_work_packages where owner_id = '${ownerId}' and id = '${packageId}';`);
  return rows[0] || null;
}

async function insertPackage(db, ownerId, packageId, title) {
  await db.query(`
    insert into forge_work_packages (owner_id, id, title)
    values ('${ownerId}', '${packageId}', ${sqlStr(title)});`);
}

async function linkAudit(db, ownerId, packageId) {
  const { rows } = await db.query(`
    select old_forge_project_id, new_forge_project_id, actor_id, request_id, reason
      from forge_work_package_links
      where owner_id = '${ownerId}' and package_id = '${packageId}'
      order by recorded_at, id;`);
  return rows;
}

async function makeChain(db, uid, ownerId, label) {
  const client = await createClient(db, uid, ownerId, `${label} Client`);
  const site = await createSite(db, uid, ownerId, client.id, `${label} Site`);
  const project = await createProject(db, uid, ownerId, site.id, `${label} Project`);
  return { client, site, project };
}

async function provisionPlannerAndAssign(db, memberId, roleKey) {
  await asUser(db, OWNER_A, `
    select forge_planner_roles_provision_starter_set('${OWNER_A}', 'test-request-1');`);
  const { rows } = await db.query(`
    select id from forge_planner_roles
    where owner_id = '${OWNER_A}' and role_key = '${roleKey}';`);
  expect(rows).toHaveLength(1);
  await db.query(`
    insert into forge_planner_user_role_assignments
      (owner_id, id, role_id, assignee_user_id, assigned_by, updated_by)
    values ('${OWNER_A}', 'forge_ura_test_planner_${roleKey}', '${rows[0].id}', '${memberId}', '${OWNER_A}', '${OWNER_A}');`);
}

async function provisionSchedulingAndAssign(db, memberId, roleKey) {
  await asUser(db, OWNER_A, `
    select forge_scheduling_roles_provision_starter_set('${OWNER_A}', 'test-request-1');`);
  const { rows } = await db.query(`
    select id from forge_scheduling_roles
    where owner_id = '${OWNER_A}' and role_key = '${roleKey}';`);
  expect(rows).toHaveLength(1);
  await db.query(`
    insert into forge_scheduling_user_role_assignments
      (owner_id, id, role_id, assignee_user_id, assigned_by, updated_by)
    values ('${OWNER_A}', 'forge_ura_test_scheduling_${roleKey}', '${rows[0].id}', '${memberId}', '${OWNER_A}', '${OWNER_A}');`);
}

describe("foundation PR B migration: package -> project link", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); });
  afterEach(async () => { await db.close(); });

  it60("migration applies cleanly: column, FK, audit table, RPC; re-apply fails loudly on the preflight", async () => {
    const { rows: col } = await db.query(`
      select is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'forge_work_packages'
        and column_name = 'forge_project_id';`);
    expect(col).toHaveLength(1);
    expect(col[0].is_nullable).toBe("YES");
    const { rows: fk } = await db.query(`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'forge_work_packages'::regclass and contype = 'f'
        and pg_get_constraintdef(oid) like '%forge_project_id%';`);
    expect(fk).toHaveLength(1);
    expect(fk[0].def).toContain("REFERENCES forge_projects(owner_id, id)");
    expect(fk[0].def).toContain("ON DELETE RESTRICT");
    const { rows: tbl } = await db.query(`
      select relrowsecurity, relforcerowsecurity from pg_class
      where relname = 'forge_work_package_links';`);
    expect(tbl).toHaveLength(1);
    expect(tbl[0].relrowsecurity).toBe(true);
    expect(tbl[0].relforcerowsecurity).toBe(true);
    const { rows: fn } = await db.query(`
      select 1 from pg_proc where proname = 'forge_work_package_set_project';`);
    expect(fn).toHaveLength(1);
    // Re-apply: the preflight refuses instead of redefining anything.
    let caught = null;
    try {
      await db.exec(loadMigrationSql(THIS_MIGRATION));
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeNull();
    expect(String(caught.message)).toContain("FORGE_PRB_COLUMN_EXISTS");
  });

  it60("no backfill: a package that predates the migration stays NULL and byte-identical", async () => {
    const pkg = await packageRow(db, OWNER_A, "forge_wp_legacy");
    expect(pkg).not.toBeNull();
    expect(pkg.forge_project_id).toBeNull();
    expect(pkg.version).toBe(1);
    expect(pkg.title).toBe("Legacy package (pre-migration)");
    const audit = await linkAudit(db, OWNER_A, "forge_wp_legacy");
    expect(audit).toHaveLength(0);
  });

  it60("owner links a package: version bumps, audit receipt names actor/old/new/request/reason", async () => {
    const { project } = await makeChain(db, OWNER_A, OWNER_A, "Alpha");
    const requestId = `req_${randomUUID().replace(/-/g, "")}`;
    const linked = await setProject(db, OWNER_A, OWNER_A, "forge_wp_legacy", project.id, 1, {
      requestId, reason: "Assigned to Alpha",
    });
    expect(linked.forge_project_id).toBe(project.id);
    expect(linked.version).toBe(2);
    const pkg = await packageRow(db, OWNER_A, "forge_wp_legacy");
    expect(pkg.forge_project_id).toBe(project.id);
    expect(pkg.version).toBe(2);
    expect(pkg.updated_by).toBe(OWNER_A);
    const audit = await linkAudit(db, OWNER_A, "forge_wp_legacy");
    expect(audit).toHaveLength(1);
    expect(audit[0].old_forge_project_id).toBeNull();
    expect(audit[0].new_forge_project_id).toBe(project.id);
    expect(audit[0].actor_id).toBe(OWNER_A);
    expect(audit[0].request_id).toBe(requestId);
    expect(audit[0].reason).toBe("Assigned to Alpha");
  });

  it60("unlink returns the package to Unassigned with an audit receipt", async () => {
    const { project } = await makeChain(db, OWNER_A, OWNER_A, "Beta");
    await setProject(db, OWNER_A, OWNER_A, "forge_wp_legacy", project.id, 1);
    const unlinked = await setProject(db, OWNER_A, OWNER_A, "forge_wp_legacy", null, 2);
    expect(unlinked.forge_project_id).toBeNull();
    expect(unlinked.version).toBe(3);
    const audit = await linkAudit(db, OWNER_A, "forge_wp_legacy");
    expect(audit).toHaveLength(2);
    expect(audit[1].old_forge_project_id).toBe(project.id);
    expect(audit[1].new_forge_project_id).toBeNull();
  });

  it60("idempotency: same request id + same target replays (one audit row); same id + different target conflicts", async () => {
    const first = await makeChain(db, OWNER_A, OWNER_A, "Gamma");
    const second = await makeChain(db, OWNER_A, OWNER_A, "Delta");
    const requestId = `req_${randomUUID().replace(/-/g, "")}`;
    const once = await setProject(db, OWNER_A, OWNER_A, "forge_wp_legacy", first.project.id, 1, { requestId });
    const twice = await setProject(db, OWNER_A, OWNER_A, "forge_wp_legacy", first.project.id, 2, { requestId });
    expect(twice.forge_project_id).toBe(first.project.id);
    expect(twice.version).toBe(once.version);
    expect(await linkAudit(db, OWNER_A, "forge_wp_legacy")).toHaveLength(1);
    await expectRpcError(db, OWNER_A, `
      select forge_work_package_set_project(
        '${OWNER_A}', 'forge_wp_legacy', '${second.project.id}', 2,
        '${requestId}', null) as v;`, "FORGE_PRB_REQUEST_ID_CONFLICT");
    expect(await linkAudit(db, OWNER_A, "forge_wp_legacy")).toHaveLength(1);
    const pkg = await packageRow(db, OWNER_A, "forge_wp_legacy");
    expect(pkg.forge_project_id).toBe(first.project.id);
  });

  it60("a no-op link still writes its receipt and consumes the request id", async () => {
    const { project } = await makeChain(db, OWNER_A, OWNER_A, "Epsilon");
    const other = await makeChain(db, OWNER_A, OWNER_A, "Zeta");
    await setProject(db, OWNER_A, OWNER_A, "forge_wp_legacy", project.id, 1);
    const requestId = `req_${randomUUID().replace(/-/g, "")}`;
    const noop = await setProject(db, OWNER_A, OWNER_A, "forge_wp_legacy", project.id, 2, { requestId });
    expect(noop.version).toBe(2);
    const audit = await linkAudit(db, OWNER_A, "forge_wp_legacy");
    expect(audit).toHaveLength(2);
    expect(audit[1].old_forge_project_id).toBe(project.id);
    expect(audit[1].new_forge_project_id).toBe(project.id);
    // Without the receipt, this reuse would have applied instead of
    // conflicting (the #796 fix-round-5 lesson).
    await expectRpcError(db, OWNER_A, `
      select forge_work_package_set_project(
        '${OWNER_A}', 'forge_wp_legacy', '${other.project.id}', 2,
        '${requestId}', null) as v;`, "FORGE_PRB_REQUEST_ID_CONFLICT");
  });

  it60("stale version is a 409 and changes nothing", async () => {
    const { project } = await makeChain(db, OWNER_A, OWNER_A, "Eta");
    await expectRpcError(db, OWNER_A, `
      select forge_work_package_set_project(
        '${OWNER_A}', 'forge_wp_legacy', '${project.id}', 99,
        'req_stale_version', null) as v;`, "FORGE_PRB_STALE_VERSION");
    const pkg = await packageRow(db, OWNER_A, "forge_wp_legacy");
    expect(pkg.forge_project_id).toBeNull();
    expect(pkg.version).toBe(1);
    expect(await linkAudit(db, OWNER_A, "forge_wp_legacy")).toHaveLength(0);
  });

  it60("cross-workspace ids read as not found: another owner's project, another owner's package", async () => {
    const { project } = await makeChain(db, OWNER_B, OWNER_B, "Theta");
    await expectRpcError(db, OWNER_A, `
      select forge_work_package_set_project(
        '${OWNER_A}', 'forge_wp_legacy', '${project.id}', 1,
        'req_cross_project', null) as v;`, "FORGE_PRB_PROJECT_NOT_FOUND");
    await insertPackage(db, OWNER_B, "forge_wp_other_owner", "Other owner's package");
    await expectRpcError(db, OWNER_A, `
      select forge_work_package_set_project(
        '${OWNER_A}', 'forge_wp_other_owner', null, 1,
        'req_cross_package', null) as v;`, "FORGE_PRB_PACKAGE_NOT_FOUND");
    await expectRpcError(db, OWNER_A, `
      select forge_work_package_set_project(
        '${OWNER_A}', 'forge_wp_legacy', 'forge_prj_does_not_exist', 1,
        'req_unknown_project', null) as v;`, "FORGE_PRB_PROJECT_NOT_FOUND");
  });

  it60("an archived project, site, or client is rejected the same way", async () => {
    const archivedProject = await makeChain(db, OWNER_A, OWNER_A, "Iota");
    await archiveProject(db, OWNER_A, OWNER_A, archivedProject.project.id, archivedProject.site.id, archivedProject.project.version);
    await expectRpcError(db, OWNER_A, `
      select forge_work_package_set_project(
        '${OWNER_A}', 'forge_wp_legacy', '${archivedProject.project.id}', 1,
        'req_archived_project', null) as v;`, "FORGE_PRB_PROJECT_ARCHIVED");
    const archivedSite = await makeChain(db, OWNER_A, OWNER_A, "Kappa");
    await archiveSite(db, OWNER_A, OWNER_A, archivedSite.site.id, archivedSite.client.id, archivedSite.site.version);
    await expectRpcError(db, OWNER_A, `
      select forge_work_package_set_project(
        '${OWNER_A}', 'forge_wp_legacy', '${archivedSite.project.id}', 1,
        'req_archived_site', null) as v;`, "FORGE_PRB_PROJECT_ARCHIVED");
    const archivedClient = await makeChain(db, OWNER_A, OWNER_A, "Lambda");
    await archiveClient(db, OWNER_A, OWNER_A, archivedClient.client.id, archivedClient.client.version);
    await expectRpcError(db, OWNER_A, `
      select forge_work_package_set_project(
        '${OWNER_A}', 'forge_wp_legacy', '${archivedClient.project.id}', 1,
        'req_archived_client', null) as v;`, "FORGE_PRB_PROJECT_ARCHIVED");
    const pkg = await packageRow(db, OWNER_A, "forge_wp_legacy");
    expect(pkg.forge_project_id).toBeNull();
  });

  it60("capability conjunction: one key alone is never enough", async () => {
    const { project } = await makeChain(db, OWNER_A, OWNER_A, "Mu");
    // MEMBER_D holds no framework role at all.
    await expectRpcError(db, MEMBER_D, `
      select forge_work_package_set_project(
        '${OWNER_A}', 'forge_wp_legacy', '${project.id}', 1,
        'req_no_role', null) as v;`, "FORGE_PRB_FORBIDDEN");
    // MEMBER_E is a planner read_only: has neither key.
    await provisionPlannerAndAssign(db, MEMBER_E, "read_only");
    await expectRpcError(db, MEMBER_E, `
      select forge_work_package_set_project(
        '${OWNER_A}', 'forge_wp_legacy', '${project.id}', 1,
        'req_read_only', null) as v;`, "FORGE_PRB_FORBIDDEN");
    // MEMBER_D is a scheduling admin: forge.hierarchy.manage through
    // the scheduling framework, but no planner.packages.edit.
    await provisionSchedulingAndAssign(db, MEMBER_D, "admin");
    await expectRpcError(db, MEMBER_D, `
      select forge_work_package_set_project(
        '${OWNER_A}', 'forge_wp_legacy', '${project.id}', 1,
        'req_manage_only', null) as v;`, "FORGE_PRB_FORBIDDEN");
    // A planner admin holds both keys and links fine (a fresh member:
    // MEMBER_E already holds the read_only assignment, and two active
    // planner assignments for one member violate the unique index).
    await provisionPlannerAndAssign(db, MEMBER_F, "planner_admin");
    const linked = await setProject(db, MEMBER_F, OWNER_A, "forge_wp_legacy", project.id, 1);
    expect(linked.forge_project_id).toBe(project.id);
    // And a co-owner passes automatically.
    const second = await makeChain(db, OWNER_A, OWNER_A, "Nu");
    const relinked = await setProject(db, MEMBER_C, OWNER_A, "forge_wp_legacy", second.project.id, 2);
    expect(relinked.forge_project_id).toBe(second.project.id);
  });

  it60("audit ACL: SELECT-only for authenticated; anon sees nothing; no direct write", async () => {
    const { rows: relacl } = await db.query(`
      select relacl::text as relacl from pg_class where relname = 'forge_work_package_links';`);
    expect(String(relacl[0].relacl)).toBe("{postgres=arwdDxtm/postgres,authenticated=r/postgres}");
    const { rows: proacl } = await db.query(`
      select proacl::text as proacl from pg_proc where proname = 'forge_work_package_set_project';`);
    expect(String(proacl[0].proacl)).toBe("{postgres=X/postgres,authenticated=X/postgres}");
    // anon cannot select the audit table (RLS + FORCE RLS).
    let anonCaught = null;
    try {
      await asRole(db, "anon", MEMBER_D, `select count(*) from forge_work_package_links;`);
    } catch (error) {
      anonCaught = error;
    }
    expect(anonCaught).not.toBeNull();
    // authenticated cannot INSERT directly — the RPC is the only writer.
    let insertCaught = null;
    try {
      await asUser(db, OWNER_A, `
        insert into forge_work_package_links
          (owner_id, id, package_id, actor_id, request_id)
        values ('${OWNER_A}', 'forge_wpl_direct', 'forge_wp_legacy', '${OWNER_A}', 'req_direct');`);
    } catch (error) {
      insertCaught = error;
    }
    expect(insertCaught).not.toBeNull();
    expect(String(insertCaught.message)).toMatch(/permission denied|42501/);
  });

  it60("ON DELETE RESTRICT: a project with linked packages cannot be deleted", async () => {
    const { project } = await makeChain(db, OWNER_A, OWNER_A, "Xi");
    await setProject(db, OWNER_A, OWNER_A, "forge_wp_legacy", project.id, 1);
    let caught = null;
    try {
      await db.query(`delete from forge_projects where owner_id = '${OWNER_A}' and id = '${project.id}';`);
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeNull();
    expect(String(caught.message)).toMatch(/violates RESTRICT setting of foreign key constraint/);
  });

  it60("missing request id and missing version are 400s, not silent defaults", async () => {
    const { project } = await makeChain(db, OWNER_A, OWNER_A, "Omicron");
    await expectRpcError(db, OWNER_A, `
      select forge_work_package_set_project(
        '${OWNER_A}', 'forge_wp_legacy', '${project.id}', 1, null, null) as v;`,
      "FORGE_PRB_REQUEST_ID_REQUIRED");
    await expectRpcError(db, OWNER_A, `
      select forge_work_package_set_project(
        '${OWNER_A}', 'forge_wp_legacy', '${project.id}', null,
        'req_no_version', null) as v;`, "FORGE_PRB_EXPECTED_VERSION_REQUIRED");
  });
});

// Two-session concurrency legs can only run here, against a scratch
// PG16 cluster (same gating as the PR A test — loud skip, never
// silent). Port 55437: the PR A test uses 55436 in the same suite run.
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

describe.skipIf(!HAS_REAL_PG)("foundation PR B migration: real-PostgreSQL subset", () => {
  let pgDir;
  let pgClient;
  let pgCfg;

  beforeAll(async () => {
    pgDir = mkdtempSync(join(tmpdir(), "fprb-realpg-"));
    execSync(`chown ${PG_RUN_USER}:${PG_RUN_USER} "${pgDir}"`, { stdio: "pipe" });
    const asPgUser = (cmd) => `runuser -u ${PG_RUN_USER} -- ${cmd}`;
    execSync(asPgUser(`"${PG_BIN}/initdb" -D "${pgDir}" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8`), { stdio: "pipe" });
    execSync(
      asPgUser(`"${PG_BIN}/pg_ctl" -D "${pgDir}" -o "-p 55437 -k ${pgDir} -c listen_addresses=''" -l "${pgDir}/server.log" start`),
      { stdio: "pipe" },
    );
    pgCfg = { host: pgDir, port: 55437, user: "postgres", database: "postgres" };
    pgClient = new Client(pgCfg);
    await pgClient.connect();
    await pgClient.query(PREREQ_SQL);
    await pgClient.query(loadMigrationSql(PLANNER_ADMIN_MIGRATION));
    await pgClient.query(loadMigrationSql(RENTAL_ADMIN_MIGRATION));
    await pgClient.query(loadMigrationSql(SCHEDULING_ADMIN_MIGRATION));
    await pgClient.query(loadMigrationSql(FOUNDATION_A_MIGRATION));
    await pgClient.query(PACKAGES_STUB_SQL);
    await pgClient.query(loadMigrationSql(THIS_MIGRATION));
    await pgClient.query(SEED_SQL);
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

  async function pgMakeChain(suffix) {
    const client = await pgAsUser(pgClient, OWNER_A, `
      select forge_hierarchy_client_create(
        '${OWNER_A}', 'Race ${suffix} Client', null, null, 'req_race_client_${suffix}') as v;`);
    const site = await pgAsUser(pgClient, OWNER_A, `
      select forge_hierarchy_site_create(
        '${OWNER_A}', '${client.rows[0].v.id}', 'Race ${suffix} Site', 'other',
        null, null, null, null, null, null, 'req_race_site_${suffix}') as v;`);
    const project = await pgAsUser(pgClient, OWNER_A, `
      select forge_hierarchy_project_create(
        '${OWNER_A}', '${site.rows[0].v.id}', 'Race ${suffix} Project', null, null, null, null, null,
        'req_race_project_${suffix}') as v;`);
    return project.rows[0].v;
  }

  it60("two sessions linking with the same request id: one audit row, both callers get the same row", async () => {
    const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
    const project = await pgMakeChain(suffix);
    const packageId = `forge_wp_race_${suffix}`;
    await pgClient.query(`
      insert into forge_work_packages (owner_id, id, title)
      values ('${OWNER_A}', '${packageId}', 'Race package');`);
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const link = (client) => pgAsUser(client, OWNER_A, `
        select forge_work_package_set_project(
          '${OWNER_A}', '${packageId}', '${project.id}', 1,
          'req_race_link_${suffix}', null) as v;`);
      const results = await Promise.allSettled([link(clientA), link(clientB)]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled).toHaveLength(2);
      expect(fulfilled[0].value.rows[0].v.forge_project_id).toBe(project.id);
      expect(fulfilled[1].value.rows[0].v.forge_project_id).toBe(project.id);
      const { rows: audit } = await pgClient.query(`
        select count(*)::int as n from forge_work_package_links
        where owner_id = '${OWNER_A}' and package_id = '${packageId}';`);
      expect(audit[0].n).toBe(1);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("two sessions linking different targets at the same version: one winner, one 409, no lost audit", async () => {
    const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
    const projectA = await pgMakeChain(`a${suffix}`);
    const projectB = await pgMakeChain(`b${suffix}`);
    const packageId = `forge_wp_race2_${suffix}`;
    await pgClient.query(`
      insert into forge_work_packages (owner_id, id, title)
      values ('${OWNER_A}', '${packageId}', 'Race package 2');`);
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const linkA = pgAsUser(clientA, OWNER_A, `
        select forge_work_package_set_project(
          '${OWNER_A}', '${packageId}', '${projectA.id}', 1,
          'req_race_a_${suffix}', null) as v;`);
      const linkB = pgAsUser(clientB, OWNER_A, `
        select forge_work_package_set_project(
          '${OWNER_A}', '${packageId}', '${projectB.id}', 1,
          'req_race_b_${suffix}', null) as v;`);
      const results = await Promise.allSettled([linkA, linkB]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0].reason.message)).toContain("FORGE_PRB_STALE_VERSION");
      const { rows: audit } = await pgClient.query(`
        select count(*)::int as n from forge_work_package_links
        where owner_id = '${OWNER_A}' and package_id = '${packageId}';`);
      expect(audit[0].n).toBe(1);
      const { rows: pkg } = await pgClient.query(`
        select forge_project_id from forge_work_packages
        where owner_id = '${OWNER_A}' and id = '${packageId}';`);
      expect([projectA.id, projectB.id]).toContain(pkg[0].forge_project_id);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });
});
