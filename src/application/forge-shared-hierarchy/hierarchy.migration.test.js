// FORGE shared hierarchy — foundation (PR A), migration/integration
// proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) and proves:
//   - Tables forge_clients -> forge_sites -> forge_projects (+ the
//     forge_hierarchy_audit receipt log) exist with composite
//     (owner_id, id) PKs, the FK chain, status checks, and unique
//     normalized names/codes. Identity only: no billing/financial
//     column on any hierarchy table, and projects carry NO client_id
//     (the chain resolves it). Re-apply is idempotent.
//   - Mutation RPCs (create/update/delete x client/site/project) with
//     the admin-permissions authorization helper: owner/co-owner pass;
//     staff pass only with forge.hierarchy.read (reads) or
//     forge.hierarchy.manage (mutations); a stranger reaches nothing.
//     The RENTAL TRAP is closed: a legacy workspace manager with NO
//     framework role gets nothing, even though has_rental_permission
//     would grant a forge.* key through its R17 defaults —
//     has_forge_hierarchy_permission queries the rental role tables
//     directly instead.
//   - Request-id idempotency per entity (same change-set replays,
//     different change-set conflicts); a same-request receipt is
//     resolved BEFORE any parent-status decision, so exact
//     create/reparent retries replay even after the parent was
//     later inactivated/archived (first execution still enforces
//     the active-parent rule); mandatory expected_version on
//     update/delete (stale = 409); no-op updates bump nothing and
//     audit nothing; archive/restore/reparent are recorded actions
//     (reparent names the moved-child count); delete is archive-first
//     and names its blockers.
//   - Audit rows name the actor, entity, old/new values, request id,
//     and timestamp on every mutation.
//   - RLS+FORCE: anon cannot select; a stranger sees nothing; direct
//     INSERT/UPDATE/DELETE is denied even for the owner (RPC-only
//     write path).
//   - Effective ACL matrix for authenticated/anon/service_role, and
//     the default-privilege negative case: a selective GRANT alone
//     does NOT revoke an already-effective broad privilege, which is
//     why the migration's explicit REVOKEs are load-bearing.
//   - Capability seeding + backfill: the two hierarchy keys land on
//     every starter role in all three app frameworks (read everywhere,
//     manage on admins only), including roles provisioned BEFORE this
//     migration applies.
//   - A two-session real-PostgreSQL concurrency leg proves concurrent
//     duplicate request ids are idempotent (advisory-lock serialized
//     creates: one row, one audit row, both callers get the same id)
//     and concurrent same-version updates resolve to one winner + one
//     409 with no lost audit/update.
//
// Roles, the auth.uid() stub, workspace_members, and the
// has_workspace_access() copy mirror production (see
// 20260829000100_add_workspace_authorization_helpers.sql).

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

const PLANNER_ADMIN_MIGRATION = "20261110000000_forge_planner_admin_permissions_slice1.sql";
const RENTAL_ADMIN_MIGRATION = "20261110010000_rental_admin_roles_slice1.sql";
const SCHEDULING_ADMIN_MIGRATION = "20261110080000_forge_scheduling_admin_permissions_slice1.sql";
const THIS_MIGRATION = "20261112010000_forge_shared_hierarchy_foundation.sql";
const PROJECT_LINK_MIGRATION = "20261113000000_forge_work_package_project_link.sql";
const ADMIN_INVENTORY_MIGRATION = "20261113050000_forge_hierarchy_admin_inventory.sql";

// Minimal production-shaped forge_work_packages for the columns the
// PR-B link migration and the inventory RPC touch. Created BEFORE the
// link migration applies (the migration adds forge_project_id itself);
// mirrors the stub in projectScope.migration.test.js.
const PACKAGES_STUB_SQL = `
  create table public.forge_work_packages (
    owner_id text not null,
    id text not null,
    title text,
    status text not null default 'draft',
    version integer not null default 1,
    updated_by text,
    updated_at timestamptz not null default now(),
    primary key (owner_id, id)
  );
`;

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
    -- has_rental_permission reads this (R17 granular permissions).
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
  -- Minimal shapes for pre-existing production tables the rental admin
  -- migration re-policies (its policies reference only owner_id; the
  -- full tables live in their own earlier migrations).
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

async function setupDb() {
  const db = new PGlite();
  await db.exec(PREREQ_SQL);
  // Production order: the three admin slices first (role tables +
  // has_*_permission + provisioning functions), then this slice
  // (which extends the capability CHECKs, replaces the provisioning
  // functions, and backfills the hierarchy keys).
  await db.exec(loadMigrationSql(PLANNER_ADMIN_MIGRATION));
  await db.exec(loadMigrationSql(RENTAL_ADMIN_MIGRATION));
  await db.exec(loadMigrationSql(SCHEDULING_ADMIN_MIGRATION));
  await db.exec(loadMigrationSql(THIS_MIGRATION));
  // Production order: PR-B link (adds forge_work_packages.
  // forge_project_id), then the admin-inventory slice (whose preflight
  // requires that column). The inventory slice adds one read RPC and
  // repairs the project delete — no tables, no RLS changes.
  await db.exec(PACKAGES_STUB_SQL);
  await db.exec(loadMigrationSql(PROJECT_LINK_MIGRATION));
  await db.exec(loadMigrationSql(ADMIN_INVENTORY_MIGRATION));
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

// --- RPC call conveniences (fresh request id unless the leg passes one) ---

async function createClient(db, uid, ownerId, name, opts = {}) {
  const requestId = opts.requestId ?? `req_${randomUUID().replace(/-/g, "")}`;
  const { rows } = await asUser(db, uid, `
    select forge_hierarchy_client_create(
      '${ownerId}', ${sqlStr(name)}, ${sqlStr(opts.externalReference ?? null)},
      ${sqlStr(opts.notes ?? null)}, ${sqlStr(requestId)}) as v;`);
  return rows[0].v;
}

async function createSite(db, uid, ownerId, clientId, name, opts = {}) {
  const requestId = opts.requestId ?? `req_${randomUUID().replace(/-/g, "")}`;
  const { rows } = await asUser(db, uid, `
    select forge_hierarchy_site_create(
      '${ownerId}', '${clientId}', ${sqlStr(name)}, ${sqlStr(opts.siteType ?? "other")},
      ${sqlStr(opts.addressLine1 ?? null)}, ${sqlStr(opts.addressLine2 ?? null)},
      ${sqlStr(opts.city ?? null)}, ${sqlStr(opts.region ?? null)},
      ${sqlStr(opts.postalCode ?? null)}, ${sqlStr(opts.countryCode ?? null)},
      ${sqlStr(requestId)}) as v;`);
  return rows[0].v;
}

async function createProject(db, uid, ownerId, siteId, name, opts = {}) {
  const requestId = opts.requestId ?? `req_${randomUUID().replace(/-/g, "")}`;
  const { rows } = await asUser(db, uid, `
    select forge_hierarchy_project_create(
      '${ownerId}', '${siteId}', ${sqlStr(name)}, ${sqlStr(opts.projectCode ?? null)},
      ${sqlStr(opts.description ?? null)}, ${sqlStr(opts.projectType ?? null)},
      ${sqlStr(opts.plannedStart ?? null)}, ${sqlStr(opts.plannedFinish ?? null)},
      ${sqlStr(requestId)}) as v;`);
  return rows[0].v;
}

async function updateClient(db, uid, ownerId, clientId, fields, opts = {}) {
  const requestId = opts.requestId ?? `req_${randomUUID().replace(/-/g, "")}`;
  const { rows } = await asUser(db, uid, `
    select forge_hierarchy_client_update(
      '${ownerId}', '${clientId}', ${sqlStr(fields.name ?? null)},
      ${sqlStr(fields.externalReference ?? null)}, ${sqlStr(fields.notes ?? null)},
      ${sqlStr(fields.status ?? null)}, ${sqlInt(opts.expectedVersion)},
      ${sqlStr(requestId)}) as v;`);
  return rows[0].v;
}

async function updateSite(db, uid, ownerId, siteId, fields, opts = {}) {
  // The migration takes the parent client id as the 3rd parameter.
  const requestId = opts.requestId ?? `req_${randomUUID().replace(/-/g, "")}`;
  const { rows } = await asUser(db, uid, `
    select forge_hierarchy_site_update(
      '${ownerId}', '${siteId}', ${sqlStr(fields.clientId ?? null)},
      ${sqlStr(fields.name ?? null)},
      ${sqlStr(fields.siteType ?? null)}, ${sqlStr(fields.addressLine1 ?? null)},
      ${sqlStr(fields.addressLine2 ?? null)}, ${sqlStr(fields.city ?? null)},
      ${sqlStr(fields.region ?? null)}, ${sqlStr(fields.postalCode ?? null)},
      ${sqlStr(fields.countryCode ?? null)}, ${sqlStr(fields.status ?? null)},
      ${sqlInt(opts.expectedVersion)},
      ${sqlStr(requestId)}) as v;`);
  return rows[0].v;
}

async function updateProject(db, uid, ownerId, projectId, fields, opts = {}) {
  // The migration takes the parent site id as the 3rd parameter.
  const requestId = opts.requestId ?? `req_${randomUUID().replace(/-/g, "")}`;
  const { rows } = await asUser(db, uid, `
    select forge_hierarchy_project_update(
      '${ownerId}', '${projectId}', ${sqlStr(fields.siteId ?? null)},
      ${sqlStr(fields.name ?? null)},
      ${sqlStr(fields.projectCode ?? null)}, ${sqlStr(fields.description ?? null)},
      ${sqlStr(fields.projectType ?? null)}, ${sqlStr(fields.plannedStart ?? null)},
      ${sqlStr(fields.plannedFinish ?? null)}, ${sqlStr(fields.status ?? null)},
      ${sqlInt(opts.expectedVersion)},
      ${sqlStr(requestId)}) as v;`);
  return rows[0].v;
}

async function deleteClient(db, uid, ownerId, clientId, opts = {}) {
  const requestId = opts.requestId ?? `req_${randomUUID().replace(/-/g, "")}`;
  const { rows } = await asUser(db, uid, `
    select forge_hierarchy_client_delete(
      '${ownerId}', '${clientId}', ${sqlInt(opts.expectedVersion)},
      ${sqlStr(requestId)}) as v;`);
  return rows[0].v;
}

async function deleteSite(db, uid, ownerId, siteId, opts = {}) {
  const requestId = opts.requestId ?? `req_${randomUUID().replace(/-/g, "")}`;
  const { rows } = await asUser(db, uid, `
    select forge_hierarchy_site_delete(
      '${ownerId}', '${siteId}', ${sqlInt(opts.expectedVersion)},
      ${sqlStr(requestId)}) as v;`);
  return rows[0].v;
}

async function deleteProject(db, uid, ownerId, projectId, opts = {}) {
  const requestId = opts.requestId ?? `req_${randomUUID().replace(/-/g, "")}`;
  const { rows } = await asUser(db, uid, `
    select forge_hierarchy_project_delete(
      '${ownerId}', '${projectId}', ${sqlInt(opts.expectedVersion)},
      ${sqlStr(requestId)}) as v;`);
  return rows[0].v;
}

async function selector(db, uid, ownerId) {
  const { rows } = await asUser(db, uid, `select forge_hierarchy_selector('${ownerId}') as v;`);
  return rows[0].v;
}

async function validateSelection(db, uid, ownerId, projectId) {
  // The migration's validate is project-anchored: it resolves the
  // chain project -> site -> client from the project id alone.
  const { rows } = await asUser(db, uid, `
    select forge_hierarchy_validate_selection(
      '${ownerId}', ${sqlStr(projectId)}) as v;`);
  return rows[0].v;
}

async function adminInventory(db, uid, ownerId) {
  const { rows } = await asUser(db, uid, `select forge_hierarchy_admin_inventory('${ownerId}') as v;`);
  return rows[0].v;
}

// Direct package link (test-only seeding: production links packages
// only through forge_work_package_set_project). Runs as the table
// owner, bypassing RLS — the FK still enforces a real project.
async function linkPackage(db, ownerId, packageId, projectId, status = "draft") {
  await db.query(`
    insert into forge_work_packages (owner_id, id, title, status, forge_project_id)
    values ('${ownerId}', '${packageId}', 'Package ${packageId}', '${status}', ${sqlStr(projectId)});`);
}

async function auditFor(db, ownerId, entityType, entityId) {
  const { rows } = await db.query(`
    select action, actor_id, entity_type, entity_id, old_values, new_values,
           request_id, recorded_at
      from forge_hierarchy_audit
      where owner_id = '${ownerId}' and entity_type = '${entityType}'
        and entity_id = '${entityId}'
      order by recorded_at, id;`);
  return rows;
}

// Provision the starter roles as the owner, then assign a plain member
// (NOT a co-owner — co-owners short-circuit every capability check)
// to a named starter role by direct assignment insert.
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

async function provisionRentalAndAssign(db, memberId, roleKey) {
  await asUser(db, OWNER_A, `select rental_ensure_starter_roles('${OWNER_A}');`);
  // rental_roles carries the role key in `name`, not `role_key`.
  const { rows } = await db.query(`
    select id from rental_roles where name = '${roleKey}';`);
  expect(rows).toHaveLength(1);
  await db.query(`
    insert into rental_user_roles
      (id, owner_id, user_id, role_id, request_id, assigned_by)
    values ('forge_ura_test_rental_${roleKey}', '${OWNER_A}', '${memberId}',
            '${rows[0].id}', 'test-request-1', '${OWNER_A}');`);
}

async function provisionAll(db) {
  await asUser(db, OWNER_A, `
    select forge_planner_roles_provision_starter_set('${OWNER_A}', 'test-request-1');`);
  await asUser(db, OWNER_A, `select rental_ensure_starter_roles('${OWNER_A}');`);
  await asUser(db, OWNER_A, `
    select forge_scheduling_roles_provision_starter_set('${OWNER_A}', 'test-request-1');`);
}

describe("forge shared hierarchy migration (PR A)", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); });
  afterEach(async () => { await db.close(); });

  it60("tables exist with composite PKs, the FK chain, status checks, and no billing columns; projects carry no client_id", async () => {
    const tables = await db.query(`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('forge_clients', 'forge_sites', 'forge_projects', 'forge_hierarchy_audit');`);
    expect(tables.rows.map((r) => r.table_name).sort()).toEqual(
      ["forge_clients", "forge_hierarchy_audit", "forge_projects", "forge_sites"]);
    // Composite (owner_id, id) primary keys on the three entity tables.
    const pks = await db.query(`
      select c.relname, array_agg(a.attname order by u.ord) as cols
        from pg_constraint k
        join pg_class c on c.oid = k.conrelid
        join lateral unnest(k.conkey) with ordinality as u(attnum, ord) on true
        join pg_attribute a on a.attrelid = c.oid and a.attnum = u.attnum
        where k.contype = 'p' and c.relname in ('forge_clients', 'forge_sites', 'forge_projects')
        group by c.relname;`);
    expect(pks.rows).toHaveLength(3);
    for (const row of pks.rows) {
      expect(row.cols).toEqual(["owner_id", "id"]);
    }
    // The FK chain: site -> client, project -> site.
    const fks = await db.query(`
      select conrelid::regclass::text as child, confrelid::regclass::text as parent
        from pg_constraint where contype = 'f'
        and conrelid::regclass::text in ('forge_sites', 'forge_projects');`);
    expect(fks.rows.map((r) => `${r.child}->${r.parent}`).sort()).toEqual([
      "forge_projects->forge_sites",
      "forge_sites->forge_clients",
    ]);
    // Identity only: no billing/financial column anywhere.
    const billing = await db.query(`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ('forge_clients', 'forge_sites', 'forge_projects')
        and column_name ~* 'billing|payment|price|amount|invoice|subscription|balance|card|bank';`);
    expect(billing.rows).toHaveLength(0);
    // Projects carry NO client_id — the chain resolves it.
    const clientCol = await db.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'forge_projects'
        and column_name = 'client_id';`);
    expect(clientCol.rows).toHaveLength(0);
    // Status CHECKs reject anything outside the brief's enums (direct
    // inserts here run as the table owner, which bypasses RLS — the
    // CHECKs are what this leg proves). Valid parents first, so only
    // the CHECK can fire — a dangling FK would fail first instead.
    await db.query(
      `insert into forge_clients (owner_id, id, name, created_by, updated_by) values ('${OWNER_A}', 'good1', 'Good', '${OWNER_A}', '${OWNER_A}');`);
    await db.query(
      `insert into forge_sites (owner_id, id, client_id, name, created_by, updated_by) values ('${OWNER_A}', 'good2', 'good1', 'Good', '${OWNER_A}', '${OWNER_A}');`);
    await expect(db.query(
      `insert into forge_clients (owner_id, id, name, status, created_by, updated_by) values ('${OWNER_A}', 'bad1', 'Bad', 'deleted', '${OWNER_A}', '${OWNER_A}');`))
      .rejects.toThrow(/check constraint/i);
    await expect(db.query(
      `insert into forge_sites (owner_id, id, client_id, name, site_type, created_by, updated_by) values ('${OWNER_A}', 'bad2', 'good1', 'Bad', 'orbital', '${OWNER_A}', '${OWNER_A}');`))
      .rejects.toThrow(/check constraint/i);
    await expect(db.query(
      `insert into forge_projects (owner_id, id, site_id, name, status, created_by, updated_by) values ('${OWNER_A}', 'bad3', 'good2', 'Bad', 'shipped', '${OWNER_A}', '${OWNER_A}');`))
      .rejects.toThrow(/check constraint/i);
  });

  it60("re-applying the migration is idempotent (tables, RPCs, backfill)", async () => {
    await provisionAll(db);
    const before = await db.query(`
      select count(*)::int as n from forge_planner_role_capabilities
      where capability_key like 'forge.hierarchy.%';`);
    await db.exec(loadMigrationSql(THIS_MIGRATION));
    const after = await db.query(`
      select count(*)::int as n from forge_planner_role_capabilities
      where capability_key like 'forge.hierarchy.%';`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect(after.rows[0].n).toBe(6);
    const tables = await db.query(`
      select count(*)::int as n from information_schema.tables
      where table_schema = 'public'
        and table_name in ('forge_clients', 'forge_sites', 'forge_projects', 'forge_hierarchy_audit');`);
    expect(tables.rows[0].n).toBe(4);
  });

  it60("client create: owner creates, audit names actor/entity/old/new/request/timestamp, selector returns the tree", async () => {
    const created = await createClient(db, OWNER_A, OWNER_A, "Acme Industrial",
      { externalReference: "ERP-1001", notes: "First client.", requestId: "req_create_1" });
    expect(created.id).toMatch(/^forge_client_/);
    expect(created.name).toBe("Acme Industrial");
    expect(created.name_normalized).toBe("acme industrial");
    expect(created.status).toBe("active");
    expect(created.version).toBe(1);
    expect(created.external_reference).toBe("ERP-1001");
    const audit = await auditFor(db, OWNER_A, "client", created.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("create");
    expect(audit[0].actor_id).toBe(OWNER_A);
    expect(audit[0].entity_type).toBe("client");
    expect(audit[0].entity_id).toBe(created.id);
    expect(audit[0].old_values).toBeNull();
    // new_values carries {'changed': <change-set>, 'row': <full row>}.
    expect(audit[0].new_values.changed.name).toBe("Acme Industrial");
    expect(audit[0].new_values.row.name).toBe("Acme Industrial");
    expect(audit[0].new_values.row.external_reference).toBe("ERP-1001");
    expect(audit[0].request_id).toBe("req_create_1");
    expect(audit[0].recorded_at).not.toBeNull();
    const tree = await selector(db, OWNER_A, OWNER_A);
    expect(tree.clients).toHaveLength(1);
    expect(tree.clients[0].id).toBe(created.id);
    expect(tree.clients[0].sites).toEqual([]);
    // A co-owner creates too (owner boundary, not a role row).
    const byCoOwner = await createClient(db, MEMBER_C, OWNER_A, "Beta Holdings");
    expect(byCoOwner.name).toBe("Beta Holdings");
    expect((await auditFor(db, OWNER_A, "client", byCoOwner.id))[0].actor_id).toBe(MEMBER_C);
  });

  it60("site and project create: FK chain, selector nests, validate_selection returns the chain", async () => {
    const client = await createClient(db, OWNER_A, OWNER_A, "Acme Industrial");
    const site = await createSite(db, OWNER_A, OWNER_A, client.id, "La Porte Yard",
      { siteType: "industrial", city: "La Porte", region: "TX", countryCode: "US" });
    expect(site.client_id).toBe(client.id);
    expect(site.site_type).toBe("industrial");
    expect(site.version).toBe(1);
    const project = await createProject(db, OWNER_A, OWNER_A, site.id, "Turnaround 2027",
      { projectCode: "TA-2027", description: "Spring turnaround.", plannedStart: "2027-03-01", plannedFinish: "2027-04-15" });
    expect(project.site_id).toBe(site.id);
    expect(project.project_code).toBe("TA-2027");
    expect(project.status).toBe("planned");
    // A freshly created project is 'planned' — and the selector
    // lists every non-archived state, so it appears immediately
    // with its status explicit (fix round 1: the old active-only
    // filter hid it until activation).
    const tree = await selector(db, OWNER_A, OWNER_A);
    expect(tree.clients[0].sites).toHaveLength(1);
    expect(tree.clients[0].sites[0].projects).toHaveLength(1);
    expect(tree.clients[0].sites[0].projects[0].id).toBe(project.id);
    expect(tree.clients[0].sites[0].projects[0].status).toBe("planned");
    // On-hold and complete projects stay selectable, with the status
    // carried in the read model.
    await updateProject(db, OWNER_A, OWNER_A, project.id,
      { status: "on_hold" }, { expectedVersion: 1, requestId: "req_hold_1" });
    const onHold = await selector(db, OWNER_A, OWNER_A);
    expect(onHold.clients[0].sites[0].projects[0].status).toBe("on_hold");
    await updateProject(db, OWNER_A, OWNER_A, project.id,
      { status: "complete" }, { expectedVersion: 2, requestId: "req_complete_1" });
    const done = await selector(db, OWNER_A, OWNER_A);
    expect(done.clients[0].sites[0].projects[0].status).toBe("complete");
    const validated = await validateSelection(db, OWNER_A, OWNER_A, project.id);
    expect(validated.client.id).toBe(client.id);
    expect(validated.site.id).toBe(site.id);
    expect(validated.project.id).toBe(project.id);
    // Only archived projects leave the selector — and validate
    // reports ARCHIVED for them.
    await updateProject(db, OWNER_A, OWNER_A, project.id,
      { status: "archived" }, { expectedVersion: 3, requestId: "req_archive_1" });
    const archived = await selector(db, OWNER_A, OWNER_A);
    expect(archived.clients[0].sites[0].projects).toHaveLength(0);
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_validate_selection('${OWNER_A}', '${project.id}');`,
      "FORGE_HIERARCHY_ARCHIVED");
    // A missing project id and an unknown project id are NOT_FOUND.
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_validate_selection('${OWNER_A}', null);`,
      "FORGE_HIERARCHY_NOT_FOUND");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_validate_selection('${OWNER_A}', 'forge_project_nope');`,
      "FORGE_HIERARCHY_NOT_FOUND");
  });

  it60("duplicate normalized names and codes are rejected; the same name under a different parent is fine", async () => {
    const client = await createClient(db, OWNER_A, OWNER_A, "Acme Industrial");
    // name_normalized is lower(btrim(name)) — no whitespace collapse —
    // so the duplicate check is a case-only difference.
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_client_create('${OWNER_A}', 'ACME INDUSTRIAL', null, null, 'req_dup_1');`,
      "FORGE_HIERARCHY_DUPLICATE_NAME");
    const other = await createClient(db, OWNER_A, OWNER_A, "Beta Holdings");
    await createSite(db, OWNER_A, OWNER_A, client.id, "La Porte Yard");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_create('${OWNER_A}', '${client.id}', 'LA PORTE YARD', 'other', null, null, null, null, null, null, 'req_dup_2');`,
      "FORGE_HIERARCHY_DUPLICATE_NAME");
    // Same site name under a DIFFERENT client is fine.
    await createSite(db, OWNER_A, OWNER_A, other.id, "La Porte Yard");
    const site = (await selector(db, OWNER_A, OWNER_A)).clients[0].sites[0];
    await createProject(db, OWNER_A, OWNER_A, site.id, "Turnaround 2027", { projectCode: "TA-2027" });
    // Project codes compare case-sensitively, so the duplicate is the
    // exact same code.
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_create('${OWNER_A}', '${site.id}', 'Other Job', 'TA-2027', null, null, null, null, 'req_dup_3');`,
      "FORGE_HIERARCHY_DUPLICATE_CODE");
    // Same code under a DIFFERENT owner is fine.
    await createClient(db, OWNER_B, OWNER_B, "Other Owner Co");
    const otherSite = await createSite(db, OWNER_B, OWNER_B,
      (await selector(db, OWNER_B, OWNER_B)).clients[0].id, "Yard");
    await createProject(db, OWNER_B, OWNER_B, otherSite.id, "Job", { projectCode: "TA-2027" });
  });

  it60("cross-workspace and cross-client FK mismatches are rejected", async () => {
    const clientA = await createClient(db, OWNER_A, OWNER_A, "Acme Industrial");
    const clientB = await createClient(db, OWNER_B, OWNER_B, "Beta Holdings");
    // OWNER_A cannot attach a site to OWNER_B's client.
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_create('${OWNER_A}', '${clientB.id}', 'Sneaky Site', 'other', null, null, null, null, null, null, 'req_xws_1');`,
      "FORGE_HIERARCHY_CLIENT_NOT_FOUND");
    // OWNER_B cannot attach a site to OWNER_A's client either.
    await expectRpcError(db, OWNER_B,
      `select forge_hierarchy_site_create('${OWNER_B}', '${clientA.id}', 'Sneaky Site', 'other', null, null, null, null, null, null, 'req_xws_2');`,
      "FORGE_HIERARCHY_CLIENT_NOT_FOUND");
    // A site under a nonexistent client, and a project under a
    // nonexistent site, are the same closed failure.
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_create('${OWNER_A}', 'forge_client_nope', 'Ghost Site', 'other', null, null, null, null, null, null, 'req_xws_3');`,
      "FORGE_HIERARCHY_CLIENT_NOT_FOUND");
    const siteA = await createSite(db, OWNER_A, OWNER_A, clientA.id, "La Porte Yard");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_create('${OWNER_A}', 'forge_site_nope', 'Ghost Job', null, null, null, null, null, 'req_xws_4');`,
      "FORGE_HIERARCHY_SITE_NOT_FOUND");
    // A project under OWNER_B's site, from OWNER_A's workspace.
    const siteB = await createSite(db, OWNER_B, OWNER_B, clientB.id, "Beta Yard");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_create('${OWNER_A}', '${siteB.id}', 'Sneaky Job', null, null, null, null, null, 'req_xws_5');`,
      "FORGE_HIERARCHY_SITE_NOT_FOUND");
    // validate_selection is project-anchored: a project from another
    // workspace is NOT_FOUND, never leaked.
    const projectB = await createProject(db, OWNER_B, OWNER_B, siteB.id, "Beta Job");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_validate_selection('${OWNER_A}', '${projectB.id}');`,
      "FORGE_HIERARCHY_NOT_FOUND");
    expect(siteA.name).toBe("La Porte Yard");
  });

  it60("a stranger reaches nothing; a planner read_only assignee reads but cannot mutate; a planner_admin assignee can mutate", async () => {
    const client = await createClient(db, OWNER_A, OWNER_A, "Acme Industrial");
    await expectRpcError(db, OWNER_B,
      `select forge_hierarchy_selector('${OWNER_A}');`,
      "FORGE_HIERARCHY_FORBIDDEN");
    await expectRpcError(db, OWNER_B,
      `select forge_hierarchy_client_create('${OWNER_A}', 'Sneaky', null, null, 'req_str_1');`,
      "FORGE_HIERARCHY_FORBIDDEN");
    await provisionPlannerAndAssign(db, MEMBER_D, "read_only");
    const tree = await selector(db, MEMBER_D, OWNER_A);
    expect(tree.clients).toHaveLength(1);
    expect(tree.clients[0].id).toBe(client.id);
    await expectRpcError(db, MEMBER_D,
      `select forge_hierarchy_client_create('${OWNER_A}', 'Staff Client', null, null, 'req_str_2');`,
      "FORGE_HIERARCHY_FORBIDDEN");
    await provisionPlannerAndAssign(db, MEMBER_E, "planner_admin");
    const created = await createClient(db, MEMBER_E, OWNER_A, "Staff Client");
    expect(created.name).toBe("Staff Client");
    expect((await auditFor(db, OWNER_A, "client", created.id))[0].actor_id).toBe(MEMBER_E);
  });

  it60("scheduling staff: a viewer reads, an admin manages", async () => {
    await createClient(db, OWNER_A, OWNER_A, "Acme Industrial");
    await provisionSchedulingAndAssign(db, MEMBER_D, "viewer");
    const tree = await selector(db, MEMBER_D, OWNER_A);
    expect(tree.clients).toHaveLength(1);
    await expectRpcError(db, MEMBER_D,
      `select forge_hierarchy_client_create('${OWNER_A}', 'Viewer Client', null, null, 'req_sch_1');`,
      "FORGE_HIERARCHY_FORBIDDEN");
    await provisionSchedulingAndAssign(db, MEMBER_E, "admin");
    const created = await createClient(db, MEMBER_E, OWNER_A, "Admin Client");
    expect(created.name).toBe("Admin Client");
  });

  it60("rental staff: a manager reads but cannot manage; a rental_admin manages; the R17 legacy trap is closed", async () => {
    await createClient(db, OWNER_A, OWNER_A, "Acme Industrial");
    // MEMBER_D is a legacy workspace 'manager' (seeded) with NO
    // framework role yet: has_rental_permission would grant a forge.*
    // key through its R17 defaults — the trap this leg proves closed.
    const trap = await asUser(db, MEMBER_D, `
      select has_rental_permission('${OWNER_A}', 'forge.hierarchy.manage') as legacy,
             has_forge_hierarchy_permission('${OWNER_A}', 'forge.hierarchy.manage') as helper;`);
    expect(trap.rows[0].legacy).toBe(true);
    expect(trap.rows[0].helper).toBe(false);
    await expectRpcError(db, MEMBER_D,
      `select forge_hierarchy_client_create('${OWNER_A}', 'Trap Client', null, null, 'req_rent_1');`,
      "FORGE_HIERARCHY_FORBIDDEN");
    // With the framework 'manager' role, MEMBER_D reads (the role
    // carries forge.hierarchy.read) but still cannot manage.
    await provisionRentalAndAssign(db, MEMBER_D, "manager");
    const tree = await selector(db, MEMBER_D, OWNER_A);
    expect(tree.clients).toHaveLength(1);
    const afterRole = await asUser(db, MEMBER_D, `
      select has_forge_hierarchy_permission('${OWNER_A}', 'forge.hierarchy.read') as can_read,
             has_forge_hierarchy_permission('${OWNER_A}', 'forge.hierarchy.manage') as can_manage;`);
    expect(afterRole.rows[0].can_read).toBe(true);
    expect(afterRole.rows[0].can_manage).toBe(false);
    await expectRpcError(db, MEMBER_D,
      `select forge_hierarchy_client_create('${OWNER_A}', 'Manager Client', null, null, 'req_rent_2');`,
      "FORGE_HIERARCHY_FORBIDDEN");
    // A rental_admin assignee CAN manage.
    await provisionRentalAndAssign(db, MEMBER_E, "rental_admin");
    const created = await createClient(db, MEMBER_E, OWNER_A, "Admin Client");
    expect(created.name).toBe("Admin Client");
  });

  it60("has_forge_hierarchy_permission: owner and co-owner pass, a stranger and an unknown key fail", async () => {
    const checks = await db.query(`
      select has_forge_hierarchy_permission('${OWNER_A}', 'forge.hierarchy.read') as owner_read;`);
    expect(checks.rows[0].owner_read).toBe(false); // no auth.uid() set as superuser: no caller
    for (const [uid, key, expected] of [
      [OWNER_A, "forge.hierarchy.read", true],
      [OWNER_A, "forge.hierarchy.manage", true],
      [MEMBER_C, "forge.hierarchy.read", true],
      [MEMBER_C, "forge.hierarchy.manage", true],
      [OWNER_B, "forge.hierarchy.read", false],
      [MEMBER_D, "forge.hierarchy.read", false],
      [OWNER_A, "forge.hierarchy.delete", false],
      [OWNER_A, "planner.packages.read", false],
    ]) {
      const { rows } = await asUser(db, uid, `
        select has_forge_hierarchy_permission('${OWNER_A}', '${key}') as v;`);
      expect(rows[0].v, `${uid} ${key}`).toBe(expected);
    }
  });

  it60("update: happy path bumps the version and audits old/new; stale version is 409; replay is idempotent; a different payload conflicts; a no-op bumps nothing", async () => {
    const client = await createClient(db, OWNER_A, OWNER_A, "Acme Industrial",
      { externalReference: "ERP-1001", requestId: "req_upd_0" });
    const updated = await updateClient(db, OWNER_A, OWNER_A, client.id,
      { name: "Acme Industrial LLC", notes: "Renamed." },
      { expectedVersion: 1, requestId: "req_upd_1" });
    expect(updated.name).toBe("Acme Industrial LLC");
    expect(updated.version).toBe(2);
    expect(updated.external_reference).toBe("ERP-1001"); // omitted fields preserve
    const audit = await auditFor(db, OWNER_A, "client", client.id);
    expect(audit).toHaveLength(2);
    expect(audit[1].action).toBe("update");
    expect(audit[1].old_values.name).toBe("Acme Industrial");
    expect(audit[1].new_values.changed.name).toBe("Acme Industrial LLC");
    expect(audit[1].new_values.row.name).toBe("Acme Industrial LLC");
    expect(audit[1].request_id).toBe("req_upd_1");
    // Stale version is a 409.
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_client_update('${OWNER_A}', '${client.id}', 'Stale Name', null, null, null, 1, 'req_upd_2');`,
      "FORGE_HIERARCHY_STALE_VERSION");
    // Replay: same request id + same payload returns the row, no second audit.
    const replay = await updateClient(db, OWNER_A, OWNER_A, client.id,
      { name: "Acme Industrial LLC", notes: "Renamed." },
      { expectedVersion: 1, requestId: "req_upd_1" });
    expect(replay.version).toBe(2);
    expect((await auditFor(db, OWNER_A, "client", client.id))).toHaveLength(2);
    // Same request id, different payload is a conflict.
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_client_update('${OWNER_A}', '${client.id}', 'Different Name', null, null, null, 2, 'req_upd_1');`,
      "FORGE_HIERARCHY_REQUEST_ID_CONFLICT");
    // A no-op (no field changes) returns the row with no bump, no audit.
    const noop = await updateClient(db, OWNER_A, OWNER_A, client.id, {},
      { expectedVersion: 2, requestId: "req_upd_3" });
    expect(noop.version).toBe(2);
    expect((await auditFor(db, OWNER_A, "client", client.id))).toHaveLength(2);
  });

  it60("stale same-value writes are 409 for client, site, and project; a fresh no-op still returns the row", async () => {
    const client = await createClient(db, OWNER_A, OWNER_A, "Acme Industrial");
    const site = await createSite(db, OWNER_A, OWNER_A, client.id, "La Porte Yard");
    const project = await createProject(db, OWNER_A, OWNER_A, site.id, "Turnaround 2027");
    // A real change moves each row to version 2.
    await updateClient(db, OWNER_A, OWNER_A, client.id,
      { name: "Acme Industrial LLC" }, { expectedVersion: 1, requestId: "req_sv_1" });
    await updateSite(db, OWNER_A, OWNER_A, site.id,
      { name: "La Porte Yard East" }, { expectedVersion: 1, requestId: "req_sv_2" });
    await updateProject(db, OWNER_A, OWNER_A, project.id,
      { name: "Turnaround 2027 Revised" }, { expectedVersion: 1, requestId: "req_sv_3" });
    // A caller holding the OLD version re-submits the CURRENT values
    // with a FRESH request id: that is a stale write, not a replay,
    // and it must 409 even though nothing would change.
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_client_update('${OWNER_A}', '${client.id}', 'Acme Industrial LLC', null, null, null, 1, 'req_sv_4');`,
      "FORGE_HIERARCHY_STALE_VERSION");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_update('${OWNER_A}', '${site.id}', null, 'La Porte Yard East', null, null, null, null, null, null, null, null, 1, 'req_sv_5');`,
      "FORGE_HIERARCHY_STALE_VERSION");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_update('${OWNER_A}', '${project.id}', null, 'Turnaround 2027 Revised', null, null, null, null, null, null, 1, 'req_sv_6');`,
      "FORGE_HIERARCHY_STALE_VERSION");
    // The same request id with the same payload IS a replay: it
    // returns the current row even though the expected version it
    // carries is now stale. Only replay bypasses the version check.
    const replay = await updateClient(db, OWNER_A, OWNER_A, client.id,
      { name: "Acme Industrial LLC" }, { expectedVersion: 1, requestId: "req_sv_1" });
    expect(replay.version).toBe(2);
    // And a no-op at the CURRENT version still returns the row with
    // no bump and no audit row.
    const noop = await updateClient(db, OWNER_A, OWNER_A, client.id, {},
      { expectedVersion: 2, requestId: "req_sv_7" });
    expect(noop.version).toBe(2);
    expect((await auditFor(db, OWNER_A, "client", client.id))).toHaveLength(2);
  });

  it60("create and reparent reject archived and inactive parents; an active parent still works", async () => {
    const active = await createClient(db, OWNER_A, OWNER_A, "Active Co");
    const archived = await createClient(db, OWNER_A, OWNER_A, "Archived Co");
    const inactive = await createClient(db, OWNER_A, OWNER_A, "Inactive Co");
    await updateClient(db, OWNER_A, OWNER_A, archived.id,
      { status: "archived" }, { expectedVersion: 1, requestId: "req_par_1" });
    await updateClient(db, OWNER_A, OWNER_A, inactive.id,
      { status: "inactive" }, { expectedVersion: 1, requestId: "req_par_2" });
    // Site create under an archived or inactive client.
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_create('${OWNER_A}', '${archived.id}', 'Dead Yard', 'other', null, null, null, null, null, null, 'req_par_3');`,
      "FORGE_HIERARCHY_ARCHIVED");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_create('${OWNER_A}', '${inactive.id}', 'Quiet Yard', 'other', null, null, null, null, null, null, 'req_par_4');`,
      "FORGE_HIERARCHY_PARENT_INACTIVE");
    // Project create under an archived or inactive site, and under an
    // active site whose client is archived or inactive.
    const goodSite = await createSite(db, OWNER_A, OWNER_A, active.id, "Good Yard");
    const archivedSite = await createSite(db, OWNER_A, OWNER_A, active.id, "Archived Yard");
    const inactiveSite = await createSite(db, OWNER_A, OWNER_A, active.id, "Inactive Yard");
    await updateSite(db, OWNER_A, OWNER_A, archivedSite.id,
      { status: "archived" }, { expectedVersion: 1, requestId: "req_par_5" });
    await updateSite(db, OWNER_A, OWNER_A, inactiveSite.id,
      { status: "inactive" }, { expectedVersion: 1, requestId: "req_par_6" });
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_create('${OWNER_A}', '${archivedSite.id}', 'Dead Job', null, null, null, null, null, 'req_par_7');`,
      "FORGE_HIERARCHY_ARCHIVED");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_create('${OWNER_A}', '${inactiveSite.id}', 'Quiet Job', null, null, null, null, null, 'req_par_8');`,
      "FORGE_HIERARCHY_PARENT_INACTIVE");
    const doomedClient = await createClient(db, OWNER_A, OWNER_A, "Doomed Co");
    const doomedSite = await createSite(db, OWNER_A, OWNER_A, doomedClient.id, "Doomed Yard");
    await updateClient(db, OWNER_A, OWNER_A, doomedClient.id,
      { status: "archived" }, { expectedVersion: 1, requestId: "req_par_9" });
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_create('${OWNER_A}', '${doomedSite.id}', 'Hidden Job', null, null, null, null, null, 'req_par_10');`,
      "FORGE_HIERARCHY_ARCHIVED");
    const quietClient = await createClient(db, OWNER_A, OWNER_A, "Quiet Co");
    const quietSite = await createSite(db, OWNER_A, OWNER_A, quietClient.id, "Quiet Yard");
    await updateClient(db, OWNER_A, OWNER_A, quietClient.id,
      { status: "inactive" }, { expectedVersion: 1, requestId: "req_par_11" });
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_create('${OWNER_A}', '${quietSite.id}', 'Hidden Job', null, null, null, null, null, 'req_par_12');`,
      "FORGE_HIERARCHY_PARENT_INACTIVE");
    // Reparent: a site move to an archived/inactive client, and a
    // project move to an archived/inactive site — both rejected, and
    // a move to an active parent still succeeds.
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_update('${OWNER_A}', '${goodSite.id}', '${archived.id}', null, null, null, null, null, null, null, null, null, 1, 'req_par_13');`,
      "FORGE_HIERARCHY_ARCHIVED");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_update('${OWNER_A}', '${goodSite.id}', '${inactive.id}', null, null, null, null, null, null, null, null, null, 1, 'req_par_14');`,
      "FORGE_HIERARCHY_PARENT_INACTIVE");
    const project = await createProject(db, OWNER_A, OWNER_A, goodSite.id, "Live Job");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_update('${OWNER_A}', '${project.id}', '${archivedSite.id}', null, null, null, null, null, null, null, 1, 'req_par_15');`,
      "FORGE_HIERARCHY_ARCHIVED");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_update('${OWNER_A}', '${project.id}', '${inactiveSite.id}', null, null, null, null, null, null, null, 1, 'req_par_16');`,
      "FORGE_HIERARCHY_PARENT_INACTIVE");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_update('${OWNER_A}', '${project.id}', '${doomedSite.id}', null, null, null, null, null, null, null, 1, 'req_par_17');`,
      "FORGE_HIERARCHY_ARCHIVED");
    const otherSite = await createSite(db, OWNER_A, OWNER_A, active.id, "Other Yard");
    const moved = await updateProject(db, OWNER_A, OWNER_A, project.id, { siteId: otherSite.id },
      { expectedVersion: 1, requestId: "req_par_18" });
    expect(moved.site_id).toBe(otherSite.id);
  });

  it60("create replays survive a later parent inactive/archive; a different payload still conflicts", async () => {
    // Fix round 2: the same-request receipt is resolved BEFORE the
    // parent-status decision, so an exact retry replays the committed
    // row even after the parent was inactivated or archived. The
    // parent checks still apply to first execution.
    const client = await createClient(db, OWNER_A, OWNER_A, "Replay Co");
    const site = await createSite(db, OWNER_A, OWNER_A, client.id, "Replay Yard",
      { requestId: "req_rpl_1" });
    // Archive the parent, then retry the EXACT create: it replays.
    await updateClient(db, OWNER_A, OWNER_A, client.id,
      { status: "archived" }, { expectedVersion: 1, requestId: "req_rpl_2" });
    const replayedSite = await createSite(db, OWNER_A, OWNER_A, client.id, "Replay Yard",
      { requestId: "req_rpl_1" });
    expect(replayedSite.id).toBe(site.id);
    expect((await auditFor(db, OWNER_A, "site", site.id))).toHaveLength(1);
    // Same request id, different payload: conflict, not ARCHIVED.
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_create('${OWNER_A}', '${client.id}', 'Other Yard', 'other', null, null, null, null, null, null, 'req_rpl_1');`,
      "FORGE_HIERARCHY_REQUEST_ID_CONFLICT");
    // Inactive parent: same shape — exact retry replays, a first
    // execution under it still rejects.
    const quiet = await createClient(db, OWNER_A, OWNER_A, "Quiet Co");
    const quietSite = await createSite(db, OWNER_A, OWNER_A, quiet.id, "Quiet Yard",
      { requestId: "req_rpl_3" });
    await updateClient(db, OWNER_A, OWNER_A, quiet.id,
      { status: "inactive" }, { expectedVersion: 1, requestId: "req_rpl_4" });
    const replayedQuiet = await createSite(db, OWNER_A, OWNER_A, quiet.id, "Quiet Yard",
      { requestId: "req_rpl_3" });
    expect(replayedQuiet.id).toBe(quietSite.id);
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_create('${OWNER_A}', '${quiet.id}', 'New Yard', 'other', null, null, null, null, null, null, 'req_rpl_5');`,
      "FORGE_HIERARCHY_PARENT_INACTIVE");
    // Project create: exact replay after the SITE is archived, and
    // after the grandparent CLIENT is archived.
    const live = await createClient(db, OWNER_A, OWNER_A, "Live Co");
    const liveSite = await createSite(db, OWNER_A, OWNER_A, live.id, "Live Yard");
    const project = await createProject(db, OWNER_A, OWNER_A, liveSite.id, "Live Job",
      { projectCode: "RPL-1", requestId: "req_rpl_6" });
    await updateSite(db, OWNER_A, OWNER_A, liveSite.id,
      { status: "archived" }, { expectedVersion: 1, requestId: "req_rpl_7" });
    const replayedProject = await createProject(db, OWNER_A, OWNER_A, liveSite.id, "Live Job",
      { projectCode: "RPL-1", requestId: "req_rpl_6" });
    expect(replayedProject.id).toBe(project.id);
    expect((await auditFor(db, OWNER_A, "project", project.id))).toHaveLength(1);
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_create('${OWNER_A}', '${liveSite.id}', 'Other Job', 'RPL-1', null, null, null, null, 'req_rpl_6');`,
      "FORGE_HIERARCHY_REQUEST_ID_CONFLICT");
    const live2 = await createClient(db, OWNER_A, OWNER_A, "Live2 Co");
    const live2Site = await createSite(db, OWNER_A, OWNER_A, live2.id, "Live2 Yard");
    const project2 = await createProject(db, OWNER_A, OWNER_A, live2Site.id, "Live2 Job",
      { requestId: "req_rpl_8" });
    await updateClient(db, OWNER_A, OWNER_A, live2.id,
      { status: "archived" }, { expectedVersion: 1, requestId: "req_rpl_9" });
    const replayed2 = await createProject(db, OWNER_A, OWNER_A, live2Site.id, "Live2 Job",
      { requestId: "req_rpl_8" });
    expect(replayed2.id).toBe(project2.id);
  });

  it60("reparent replays survive a later move plus target-parent state change", async () => {
    // Fix round 2: the reparent target check runs AFTER the replay
    // lookup, so an exact reparent retry replays the committed row
    // even if the entity moved again and the original target was
    // inactivated/archived since.
    const clientA = await createClient(db, OWNER_A, OWNER_A, "Move Co A");
    const clientB = await createClient(db, OWNER_A, OWNER_A, "Move Co B");
    const clientC = await createClient(db, OWNER_A, OWNER_A, "Move Co C");
    const site = await createSite(db, OWNER_A, OWNER_A, clientA.id, "Moving Yard");
    // Reparent to B with req_rpm_1 (version 1 -> 2).
    const moved = await updateSite(db, OWNER_A, OWNER_A, site.id, { clientId: clientB.id },
      { expectedVersion: 1, requestId: "req_rpm_1" });
    expect(moved.client_id).toBe(clientB.id);
    expect(moved.version).toBe(2);
    // Move again to C (version 2 -> 3), then archive the original target B.
    await updateSite(db, OWNER_A, OWNER_A, site.id, { clientId: clientC.id },
      { expectedVersion: 2, requestId: "req_rpm_2" });
    await updateClient(db, OWNER_A, OWNER_A, clientB.id,
      { status: "archived" }, { expectedVersion: 1, requestId: "req_rpm_3" });
    // Retry the ORIGINAL reparent (to B) with its original request id
    // and version: it replays the committed row — now under C — with
    // no new audit row.
    const replayed = await updateSite(db, OWNER_A, OWNER_A, site.id, { clientId: clientB.id },
      { expectedVersion: 1, requestId: "req_rpm_1" });
    expect(replayed.client_id).toBe(clientC.id);
    expect(replayed.version).toBe(3);
    expect((await auditFor(db, OWNER_A, "site", site.id))).toHaveLength(3);
    // Same request id, different target: conflict, not ARCHIVED.
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_update('${OWNER_A}', '${site.id}', '${clientA.id}', null, null, null, null, null, null, null, null, null, 1, 'req_rpm_1');`,
      "FORGE_HIERARCHY_REQUEST_ID_CONFLICT");
    // A fresh reparent to the archived B still rejects.
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_update('${OWNER_A}', '${site.id}', '${clientB.id}', null, null, null, null, null, null, null, null, null, 3, 'req_rpm_4');`,
      "FORGE_HIERARCHY_ARCHIVED");
    // Project reparent: same shape through the site chain.
    const site1 = await createSite(db, OWNER_A, OWNER_A, clientA.id, "First Yard");
    const site2 = await createSite(db, OWNER_A, OWNER_A, clientA.id, "Second Yard");
    const site3 = await createSite(db, OWNER_A, OWNER_A, clientA.id, "Third Yard");
    const project = await createProject(db, OWNER_A, OWNER_A, site1.id, "Moving Job");
    const movedProject = await updateProject(db, OWNER_A, OWNER_A, project.id, { siteId: site2.id },
      { expectedVersion: 1, requestId: "req_rpm_5" });
    expect(movedProject.site_id).toBe(site2.id);
    await updateProject(db, OWNER_A, OWNER_A, project.id, { siteId: site3.id },
      { expectedVersion: 2, requestId: "req_rpm_6" });
    await updateSite(db, OWNER_A, OWNER_A, site2.id,
      { status: "archived" }, { expectedVersion: 1, requestId: "req_rpm_7" });
    const replayedProject = await updateProject(db, OWNER_A, OWNER_A, project.id, { siteId: site2.id },
      { expectedVersion: 1, requestId: "req_rpm_5" });
    expect(replayedProject.site_id).toBe(site3.id);
    expect(replayedProject.version).toBe(3);
    expect((await auditFor(db, OWNER_A, "project", project.id))).toHaveLength(3);
  });

  it60("delete: a request id used by an update, archive, or reparent conflicts; an exact delete replay returns deleted", async () => {
    // Client: update with req_delx_1, archive with req_delx_2 — both
    // ids are spent; only a fresh id deletes.
    const client = await createClient(db, OWNER_A, OWNER_A, "Acme Industrial");
    await updateClient(db, OWNER_A, OWNER_A, client.id,
      { name: "Acme Industrial LLC" }, { expectedVersion: 1, requestId: "req_delx_1" });
    await updateClient(db, OWNER_A, OWNER_A, client.id,
      { status: "archived" }, { expectedVersion: 2, requestId: "req_delx_2" });
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_client_delete('${OWNER_A}', '${client.id}', 3, 'req_delx_1');`,
      "FORGE_HIERARCHY_REQUEST_ID_CONFLICT");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_client_delete('${OWNER_A}', '${client.id}', 3, 'req_delx_2');`,
      "FORGE_HIERARCHY_REQUEST_ID_CONFLICT");
    const deletedClient = await deleteClient(db, OWNER_A, OWNER_A, client.id,
      { expectedVersion: 3, requestId: "req_delx_3" });
    expect(deletedClient.deleted).toBe(true);
    const replayedClient = await deleteClient(db, OWNER_A, OWNER_A, client.id,
      { expectedVersion: 3, requestId: "req_delx_3" });
    expect(replayedClient.deleted).toBe(true);
    expect((await auditFor(db, OWNER_A, "client", client.id))).toHaveLength(4);
    // Site: reparent with req_dely_1, archive with req_dely_2.
    const client2 = await createClient(db, OWNER_A, OWNER_A, "Beta Holdings");
    const client3 = await createClient(db, OWNER_A, OWNER_A, "Gamma Group");
    const site = await createSite(db, OWNER_A, OWNER_A, client2.id, "La Porte Yard");
    await updateSite(db, OWNER_A, OWNER_A, site.id, { clientId: client3.id },
      { expectedVersion: 1, requestId: "req_dely_1" });
    await updateSite(db, OWNER_A, OWNER_A, site.id,
      { status: "archived" }, { expectedVersion: 2, requestId: "req_dely_2" });
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_delete('${OWNER_A}', '${site.id}', 3, 'req_dely_1');`,
      "FORGE_HIERARCHY_REQUEST_ID_CONFLICT");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_delete('${OWNER_A}', '${site.id}', 3, 'req_dely_2');`,
      "FORGE_HIERARCHY_REQUEST_ID_CONFLICT");
    const deletedSite = await deleteSite(db, OWNER_A, OWNER_A, site.id,
      { expectedVersion: 3, requestId: "req_dely_3" });
    expect(deletedSite.deleted).toBe(true);
    const replayedSite = await deleteSite(db, OWNER_A, OWNER_A, site.id,
      { expectedVersion: 3, requestId: "req_dely_3" });
    expect(replayedSite.deleted).toBe(true);
    expect((await auditFor(db, OWNER_A, "site", site.id))).toHaveLength(4);
    // Project: update with req_delz_1, archive with req_delz_2.
    const projectSite = await createSite(db, OWNER_A, OWNER_A, client2.id, "Second Yard");
    const project = await createProject(db, OWNER_A, OWNER_A, projectSite.id, "Turnaround 2027");
    await updateProject(db, OWNER_A, OWNER_A, project.id,
      { name: "Turnaround 2027 Revised" }, { expectedVersion: 1, requestId: "req_delz_1" });
    await updateProject(db, OWNER_A, OWNER_A, project.id,
      { status: "archived" }, { expectedVersion: 2, requestId: "req_delz_2" });
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_delete('${OWNER_A}', '${project.id}', 3, 'req_delz_1');`,
      "FORGE_HIERARCHY_REQUEST_ID_CONFLICT");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_delete('${OWNER_A}', '${project.id}', 3, 'req_delz_2');`,
      "FORGE_HIERARCHY_REQUEST_ID_CONFLICT");
    const deletedProject = await deleteProject(db, OWNER_A, OWNER_A, project.id,
      { expectedVersion: 3, requestId: "req_delz_3" });
    expect(deletedProject.deleted).toBe(true);
    const replayedProject = await deleteProject(db, OWNER_A, OWNER_A, project.id,
      { expectedVersion: 3, requestId: "req_delz_3" });
    expect(replayedProject.deleted).toBe(true);
    expect((await auditFor(db, OWNER_A, "project", project.id))).toHaveLength(4);
  });

  it60("archive/restore are recorded actions; archived rows leave the selector; validate_selection reports ARCHIVED", async () => {
    const client = await createClient(db, OWNER_A, OWNER_A, "Acme Industrial");
    const site = await createSite(db, OWNER_A, OWNER_A, client.id, "La Porte Yard");
    const project = await createProject(db, OWNER_A, OWNER_A, site.id, "Turnaround 2027");
    const archived = await updateClient(db, OWNER_A, OWNER_A, client.id,
      { status: "archived" }, { expectedVersion: 1, requestId: "req_arc_1" });
    expect(archived.status).toBe("archived");
    expect(archived.version).toBe(2);
    expect((await auditFor(db, OWNER_A, "client", client.id))[1].action).toBe("archive");
    const tree = await selector(db, OWNER_A, OWNER_A);
    expect(tree.clients).toHaveLength(0);
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_validate_selection('${OWNER_A}', '${project.id}');`,
      "FORGE_HIERARCHY_ARCHIVED");
    const restored = await updateClient(db, OWNER_A, OWNER_A, client.id,
      { status: "active" }, { expectedVersion: 2, requestId: "req_arc_2" });
    expect(restored.status).toBe("active");
    expect((await auditFor(db, OWNER_A, "client", client.id))[2].action).toBe("restore");
    expect((await selector(db, OWNER_A, OWNER_A)).clients).toHaveLength(1);
    // Archiving the site hides its project from validate too.
    await updateSite(db, OWNER_A, OWNER_A, site.id, { status: "archived" },
      { expectedVersion: 1, requestId: "req_arc_3" });
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_validate_selection('${OWNER_A}', '${project.id}');`,
      "FORGE_HIERARCHY_ARCHIVED");
  });

  it60("reparent: a site move carries its projects and records the count; a project move changes its site", async () => {
    const clientA = await createClient(db, OWNER_A, OWNER_A, "Acme Industrial");
    const clientB = await createClient(db, OWNER_A, OWNER_A, "Beta Holdings");
    const site = await createSite(db, OWNER_A, OWNER_A, clientA.id, "La Porte Yard");
    const project = await createProject(db, OWNER_A, OWNER_A, site.id, "Turnaround 2027");
    // No activation step: the selector lists every non-archived
    // project state, so the planned project is visible already.
    const moved = await updateSite(db, OWNER_A, OWNER_A, site.id, { clientId: clientB.id },
      { expectedVersion: 1, requestId: "req_rep_1" });
    expect(moved.client_id).toBe(clientB.id);
    expect(moved.version).toBe(2);
    const siteAudit = await auditFor(db, OWNER_A, "site", site.id);
    expect(siteAudit[1].action).toBe("reparent");
    expect(siteAudit[1].old_values.client_id).toBe(clientA.id);
    expect(siteAudit[1].new_values.changed.client_id).toBe(clientB.id);
    expect(siteAudit[1].new_values.row.client_id).toBe(clientB.id);
    expect(siteAudit[1].new_values.movedProjectCount).toBe(1);
    const tree = await selector(db, OWNER_A, OWNER_A);
    expect(tree.clients.find((c) => c.id === clientB.id).sites[0].projects[0].id).toBe(project.id);
    expect(tree.clients.find((c) => c.id === clientA.id).sites).toEqual([]);
    // A project reparent moves it to another site. (The project is
    // still version 1 — creating it did not bump anything, and the
    // site move did not bump the project's version.)
    const site2 = await createSite(db, OWNER_A, OWNER_A, clientB.id, "Second Yard");
    const movedProject = await updateProject(db, OWNER_A, OWNER_A, project.id, { siteId: site2.id },
      { expectedVersion: 1, requestId: "req_rep_2" });
    expect(movedProject.site_id).toBe(site2.id);
    // Audit trail: create, reparent.
    const projectAudit = await auditFor(db, OWNER_A, "project", project.id);
    expect(projectAudit).toHaveLength(2);
    expect(projectAudit[1].action).toBe("reparent");
    expect(projectAudit[1].new_values.changed.site_id).toBe(site2.id);
    expect(projectAudit[1].new_values.row.site_id).toBe(site2.id);
    // Reparenting to a parent in another workspace is rejected.
    const clientC = await createClient(db, OWNER_B, OWNER_B, "Other Owner Co");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_update('${OWNER_A}', '${site.id}', '${clientC.id}', null, null, null, null, null, null, null, null, null, 2, 'req_rep_3');`,
      "FORGE_HIERARCHY_CLIENT_NOT_FOUND");
  });

  it60("delete: not-archived is rejected; children block with their count; an archived childless delete succeeds and audits; replay returns deleted", async () => {
    const client = await createClient(db, OWNER_A, OWNER_A, "Acme Industrial");
    const site = await createSite(db, OWNER_A, OWNER_A, client.id, "La Porte Yard");
    const project = await createProject(db, OWNER_A, OWNER_A, site.id, "Turnaround 2027");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_delete('${OWNER_A}', '${project.id}', 1, 'req_del_1');`,
      "FORGE_HIERARCHY_NOT_ARCHIVED");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_delete('${OWNER_A}', '${site.id}', 1, 'req_del_2');`,
      "FORGE_HIERARCHY_NOT_ARCHIVED");
    // Archive the project, delete it; archive the site, delete it;
    // the client is still blocked by nothing but its own archive.
    await updateProject(db, OWNER_A, OWNER_A, project.id, { status: "archived" },
      { expectedVersion: 1, requestId: "req_del_3" });
    const deletedProject = await deleteProject(db, OWNER_A, OWNER_A, project.id,
      { expectedVersion: 2, requestId: "req_del_4" });
    expect(deletedProject.deleted).toBe(true);
    expect(deletedProject.id).toBe(project.id);
    const projectAudit = await auditFor(db, OWNER_A, "project", project.id);
    expect(projectAudit[projectAudit.length - 1].action).toBe("delete");
    // Replay returns the deleted row again, no second audit row.
    const replay = await deleteProject(db, OWNER_A, OWNER_A, project.id,
      { expectedVersion: 2, requestId: "req_del_4" });
    expect(replay.deleted).toBe(true);
    expect((await auditFor(db, OWNER_A, "project", project.id))).toHaveLength(projectAudit.length);
    // A fresh delete of an already-deleted row is NOT FOUND.
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_delete('${OWNER_A}', '${project.id}', 2, 'req_del_5');`,
      "FORGE_HIERARCHY_NOT_FOUND");
    // The site still has no children now, but it is not archived.
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_delete('${OWNER_A}', '${site.id}', 1, 'req_del_6');`,
      "FORGE_HIERARCHY_NOT_ARCHIVED");
    // Children block: rebuild a project, archive the site only, and
    // the delete names the blocker count.
    const project2 = await createProject(db, OWNER_A, OWNER_A, site.id, "Second Job");
    await updateSite(db, OWNER_A, OWNER_A, site.id, { status: "archived" },
      { expectedVersion: 1, requestId: "req_del_7" });
    const blocked = await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_delete('${OWNER_A}', '${site.id}', 2, 'req_del_8');`,
      "FORGE_HIERARCHY_HAS_CHILDREN");
    expect(String(blocked.message)).toMatch(/1 project/);
    // The client is blocked by its site the same way.
    await updateClient(db, OWNER_A, OWNER_A, client.id, { status: "archived" },
      { expectedVersion: 1, requestId: "req_del_9" });
    const blockedClient = await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_client_delete('${OWNER_A}', '${client.id}', 2, 'req_del_10');`,
      "FORGE_HIERARCHY_HAS_CHILDREN");
    expect(String(blockedClient.message)).toMatch(/1 site/);
    expect(project2.name).toBe("Second Job");
  });

  it60("validation: bad names, codes, types, countries, dates, versions, and request ids are rejected", async () => {
    const client = await createClient(db, OWNER_A, OWNER_A, "Acme Industrial");
    const site = await createSite(db, OWNER_A, OWNER_A, client.id, "La Porte Yard");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_client_create('${OWNER_A}', '   ', null, null, 'req_val_1');`,
      "FORGE_HIERARCHY_INVALID_NAME");
    // Names cap at 200 characters.
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_client_create('${OWNER_A}', '${"x".repeat(201)}', null, null, 'req_val_2');`,
      "FORGE_HIERARCHY_INVALID_NAME");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_create('${OWNER_A}', '${client.id}', 'Bad Site', 'orbital', null, null, null, null, null, null, 'req_val_3');`,
      "FORGE_HIERARCHY_INVALID_SITE_TYPE");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_site_create('${OWNER_A}', '${client.id}', 'Bad Site', 'other', null, null, null, null, null, 'USA', 'req_val_4');`,
      "FORGE_HIERARCHY_INVALID_COUNTRY_CODE");
    // Project codes cap at 64 characters (spaces and punctuation are fine).
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_create('${OWNER_A}', '${site.id}', 'Bad Job', '${"C".repeat(65)}', null, null, null, null, 'req_val_5');`,
      "FORGE_HIERARCHY_INVALID_PROJECT_CODE");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_create('${OWNER_A}', '${site.id}', 'Bad Job', null, null, null, '2027-04-15', '2027-03-01', 'req_val_6');`,
      "FORGE_HIERARCHY_INVALID_DATES");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_client_update('${OWNER_A}', '${client.id}', null, null, null, 'deleted', 1, 'req_val_7');`,
      "FORGE_HIERARCHY_INVALID_STATUS");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_client_update('${OWNER_A}', '${client.id}', null, null, null, null, null, 'req_val_8');`,
      "FORGE_HIERARCHY_EXPECTED_VERSION_REQUIRED");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_client_create('${OWNER_A}', 'No Request', null, null, null);`,
      "FORGE_HIERARCHY_REQUEST_ID_REQUIRED");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_client_create('${OWNER_A}', 'Long Request', null, null, '${"x".repeat(129)}');`,
      "FORGE_HIERARCHY_INVALID_REQUEST_ID");
    // Updating a row that does not exist is NOT FOUND, not a 500.
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_client_update('${OWNER_A}', 'forge_client_nope', 'Ghost', null, null, null, 1, 'req_val_9');`,
      "FORGE_HIERARCHY_NOT_FOUND");
  });

  it60("RLS: anon cannot select; a stranger sees nothing; direct writes are denied even for the owner", async () => {
    const client = await createClient(db, OWNER_A, OWNER_A, "Acme Industrial");
    await createSite(db, OWNER_A, OWNER_A, client.id, "La Porte Yard");
    await expect(asRole(db, "anon", OWNER_A, `select count(*)::int as n from forge_clients;`))
      .rejects.toThrow(/permission denied/);
    await expect(asRole(db, "anon", OWNER_A, `select count(*)::int as n from forge_hierarchy_audit;`))
      .rejects.toThrow(/permission denied/);
    const stranger = await asUser(db, OWNER_B, `select count(*)::int as n from forge_clients where owner_id = '${OWNER_A}';`);
    expect(stranger.rows[0].n).toBe(0);
    const strangerSites = await asUser(db, OWNER_B, `select count(*)::int as n from forge_sites where owner_id = '${OWNER_A}';`);
    expect(strangerSites.rows[0].n).toBe(0);
    // The owner themself cannot write directly — the write path is
    // the RPCs only (no INSERT/UPDATE/DELETE policy, no grant).
    // (name_normalized is a generated column and cannot be inserted
    // at all — it is left out so the privilege error is what fires.)
    await expect(asUser(db, OWNER_A, `insert into forge_clients (owner_id, id, name, created_by, updated_by) values ('${OWNER_A}', 'forge_client_x', 'Direct', '${OWNER_A}', '${OWNER_A}');`))
      .rejects.toThrow(/permission denied|not allowed|policy/i);
    await expect(asUser(db, OWNER_A, `update forge_clients set name = 'Direct Edit' where id = '${client.id}';`))
      .rejects.toThrow(/permission denied|not allowed|policy/i);
    await expect(asUser(db, OWNER_A, `delete from forge_clients where id = '${client.id}';`))
      .rejects.toThrow(/permission denied|not allowed|policy/i);
    await expect(asUser(db, OWNER_A, `insert into forge_hierarchy_audit (owner_id, action, actor_id, entity_type, entity_id, request_id) values ('${OWNER_A}', 'create', '${OWNER_A}', 'client', 'x', 'req_direct');`))
      .rejects.toThrow(/permission denied|not allowed|policy/i);
  });

  it60("effective ACLs: tables authenticated SELECT-only; functions authenticated EXECUTE-only; security-definer with an empty search_path", async () => {
    const { rows } = await db.query(`
      select relname, relacl from pg_class
      where relname in ('forge_clients', 'forge_sites', 'forge_projects', 'forge_hierarchy_audit');`);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      const acl = String(row.relacl || "");
      expect(acl).toContain("authenticated=r");
      expect(acl).not.toContain("anon=");
      expect(acl).not.toContain("service_role=");
      expect(acl).not.toContain("authenticated=arwd");
    }
    // There is no sequence to guard: audit ids are text
    // ('forge_ha_' + uuid), so no forge_hierarchy% sequence exists.
    const seqs = await db.query(`
      select relname from pg_class
      where relkind = 'S' and relname like 'forge_hierarchy%';`);
    expect(seqs.rows).toHaveLength(0);
    const fns = await db.query(`
      select p.proname, p.proacl, p.prosecdef, p.proconfig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (p.proname like 'forge_hierarchy_%' or p.proname = 'has_forge_hierarchy_permission');`);
    // 12 RPCs (11 foundation + the admin-inventory read RPC) +
    // has_forge_hierarchy_permission. The inventory slice adds no
    // tables, so the table half of this leg is unchanged.
    expect(fns.rows).toHaveLength(13);
    for (const fn of fns.rows) {
      const acl = String(fn.proacl || "");
      expect(acl, fn.proname).toContain("authenticated=X");
      expect(acl, fn.proname).not.toContain("anon=");
      expect(acl, fn.proname).not.toContain("service_role=");
      expect(acl, fn.proname).not.toContain("public=");
      expect(fn.prosecdef, fn.proname).toBe(true);
      expect(String(fn.proconfig || ""), fn.proname).toContain("search_path=");
    }
  });

  it60("default-privilege negative case: a selective GRANT alone does NOT narrow an already-broad ACL", async () => {
    // Mimic the Supabase default that makes a bare GRANT dangerous:
    // new tables in public land with ALL for anon/authenticated.
    // (db.exec, not db.query: PGlite's query() rejects multi-statement
    // strings as a prepared statement.)
    await db.exec(`
      alter default privileges in schema public grant all on tables to authenticated, anon;
      create table forge_hierarchy_acl_probe (id integer primary key);
    `);
    const broad = await db.query(`
      select relacl from pg_class where relname = 'forge_hierarchy_acl_probe';`);
    expect(String(broad.rows[0].relacl)).toContain("authenticated=arwdDxt");
    expect(String(broad.rows[0].relacl)).toContain("anon=arwdDxt");
    // A selective GRANT SELECT alone leaves the broad privileges in
    // place — this is exactly why the migration's explicit REVOKEs
    // are load-bearing, not decorative.
    await db.exec(`grant select on forge_hierarchy_acl_probe to authenticated;`);
    const stillBroad = await db.query(`
      select relacl from pg_class where relname = 'forge_hierarchy_acl_probe';`);
    expect(String(stillBroad.rows[0].relacl)).toContain("authenticated=arwdDxt");
    // The migration's pattern — REVOKE ALL first, then the narrow
    // grant — is what actually narrows it.
    await db.exec(`
      revoke all on forge_hierarchy_acl_probe from public, anon, authenticated, service_role;
      grant select on forge_hierarchy_acl_probe to authenticated;
    `);
    const narrow = await db.query(`
      select relacl from pg_class where relname = 'forge_hierarchy_acl_probe';`);
    expect(String(narrow.rows[0].relacl)).toContain("authenticated=r");
    expect(String(narrow.rows[0].relacl)).not.toContain("authenticated=arwd");
    expect(String(narrow.rows[0].relacl)).not.toContain("anon=");
    await db.exec(`drop table forge_hierarchy_acl_probe;`);
  });

  it60("capability seeding: every starter role carries the hierarchy keys (read everywhere, manage on admins only)", async () => {
    await provisionAll(db);
    const planner = await db.query(`
      select r.role_key, c.capability_key
        from forge_planner_role_capabilities c
        join forge_planner_roles r on r.owner_id = c.owner_id and r.id = c.role_id
        where c.owner_id = '${OWNER_A}' and c.capability_key like 'forge.hierarchy.%'
        order by r.role_key, c.capability_key;`);
    expect(planner.rows.map((r) => `${r.role_key}:${r.capability_key}`)).toEqual([
      "planner:forge.hierarchy.read",
      "planner_admin:forge.hierarchy.manage",
      "planner_admin:forge.hierarchy.read",
      "read_only:forge.hierarchy.read",
      "reviewer:forge.hierarchy.read",
      "scheduler:forge.hierarchy.read",
    ]);
    const rental = await db.query(`
      select r.name as role_key, c.capability_key
        from rental_role_capabilities c
        join rental_roles r on r.id = c.role_id
        where c.capability_key like 'forge.hierarchy.%'
        order by r.name, c.capability_key;`);
    expect(rental.rows.map((r) => `${r.role_key}:${r.capability_key}`)).toEqual([
      "bookkeeper:forge.hierarchy.read",
      "manager:forge.hierarchy.read",
      "read_only:forge.hierarchy.read",
      "rental_admin:forge.hierarchy.manage",
      "rental_admin:forge.hierarchy.read",
    ]);
    const scheduling = await db.query(`
      select r.role_key, c.capability_key
        from forge_scheduling_role_capabilities c
        join forge_scheduling_roles r on r.owner_id = c.owner_id and r.id = c.role_id
        where c.owner_id = '${OWNER_A}' and c.capability_key like 'forge.hierarchy.%'
        order by r.role_key, c.capability_key;`);
    expect(scheduling.rows.map((r) => `${r.role_key}:${r.capability_key}`)).toEqual([
      "admin:forge.hierarchy.manage",
      "admin:forge.hierarchy.read",
      "crew_lead:forge.hierarchy.read",
      "scheduler:forge.hierarchy.read",
      "viewer:forge.hierarchy.read",
    ]);
  });

  it60("backfill grants the hierarchy keys to roles provisioned BEFORE this migration applies", async () => {
    const fresh = new PGlite();
    try {
      await fresh.exec(PREREQ_SQL);
      await fresh.exec(loadMigrationSql(PLANNER_ADMIN_MIGRATION));
      await fresh.exec(loadMigrationSql(RENTAL_ADMIN_MIGRATION));
      await fresh.exec(loadMigrationSql(SCHEDULING_ADMIN_MIGRATION));
      // Provision with the OLD functions (no hierarchy keys exist yet).
      await fresh.exec(`set role authenticated; set app.test_uid = '${OWNER_A}';`);
      await fresh.query(`select forge_planner_roles_provision_starter_set('${OWNER_A}', 'test-request-1');`);
      await fresh.query(`select rental_ensure_starter_roles('${OWNER_A}');`);
      await fresh.query(`select forge_scheduling_roles_provision_starter_set('${OWNER_A}', 'test-request-1');`);
      await fresh.exec(`reset role;`);
      const before = await fresh.query(`
        select count(*)::int as n from forge_planner_role_capabilities
        where capability_key like 'forge.hierarchy.%';`);
      expect(before.rows[0].n).toBe(0);
      // Now this migration applies: the backfill must grant the keys.
      await fresh.exec(loadMigrationSql(THIS_MIGRATION));
      const planner = await fresh.query(`
        select count(*)::int as n from forge_planner_role_capabilities
        where capability_key like 'forge.hierarchy.%';`);
      expect(planner.rows[0].n).toBe(6);
      const rental = await fresh.query(`
        select count(*)::int as n from rental_role_capabilities
        where capability_key like 'forge.hierarchy.%';`);
      expect(rental.rows[0].n).toBe(5);
      const scheduling = await fresh.query(`
        select count(*)::int as n from forge_scheduling_role_capabilities
        where capability_key like 'forge.hierarchy.%';`);
      expect(scheduling.rows[0].n).toBe(5);
      // And a re-apply adds no duplicates.
      await fresh.exec(loadMigrationSql(THIS_MIGRATION));
      const again = await fresh.query(`
        select count(*)::int as n from forge_planner_role_capabilities
        where capability_key like 'forge.hierarchy.%';`);
      expect(again.rows[0].n).toBe(6);
    } finally {
      await fresh.close();
    }
  });
});

// Admin inventory slice (20261113050000): the read-only management
// inventory RPC + the project-delete package-block repair. Runs on the
// same fixture as PR A (foundation + PR-B link), extended above.
describe("forge hierarchy admin inventory migration", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); });
  afterEach(async () => { await db.close(); });

  it60("inventory returns the full tree in any status with complete identity fields, versions, and canManage for the owner", async () => {
    const client = await createClient(db, OWNER_A, OWNER_A, "Acme Industrial",
      { externalReference: "ERP-1001", notes: "First client." });
    const site = await createSite(db, OWNER_A, OWNER_A, client.id, "Plant 1",
      { siteType: "industrial", addressLine1: "100 Refinery Rd", city: "Beaumont", region: "TX", postalCode: "77701", countryCode: "US" });
    const project = await createProject(db, OWNER_A, OWNER_A, site.id, "Turnaround",
      { projectCode: "TA-27", description: "Spring turnaround", projectType: "turnaround", plannedStart: "2027-03-01", plannedFinish: "2027-04-15" });
    const archivedProject = await createProject(db, OWNER_A, OWNER_A, site.id, "Revamp");
    await updateProject(db, OWNER_A, OWNER_A, archivedProject.id, { status: "archived" }, { expectedVersion: 1 });
    const archivedClient = await createClient(db, OWNER_A, OWNER_A, "Beta Holdings");
    await updateClient(db, OWNER_A, OWNER_A, archivedClient.id, { status: "archived" }, { expectedVersion: 1 });

    const inventory = await adminInventory(db, OWNER_A, OWNER_A);
    expect(inventory.ownerId).toBe(OWNER_A);
    expect(inventory.canManage).toBe(true);
    expect(inventory.clients).toHaveLength(2);
    // Archived rows are present — the selector omits them.
    const beta = inventory.clients.find((c) => c.name === "Beta Holdings");
    expect(beta.status).toBe("archived");
    expect(beta.version).toBe(2);
    const acme = inventory.clients.find((c) => c.name === "Acme Industrial");
    // The RPC returns snake_case record fields (the application
    // service camelCases them — see hierarchy.test.js); the envelope
    // keys ownerId/canManage are camelCase.
    expect(acme.external_reference).toBe("ERP-1001");
    expect(acme.notes).toBe("First client.");
    expect(acme.version).toBe(1);
    expect(acme.sites).toHaveLength(1);
    const plant = acme.sites[0];
    expect(plant.name).toBe("Plant 1");
    expect(plant.site_type).toBe("industrial");
    expect(plant.address_line1).toBe("100 Refinery Rd");
    expect(plant.city).toBe("Beaumont");
    expect(plant.region).toBe("TX");
    expect(plant.postal_code).toBe("77701");
    expect(plant.country_code).toBe("US");
    expect(plant.client_id).toBe(client.id);
    expect(plant.version).toBe(1);
    expect(plant.projects).toHaveLength(2);
    const turnaround = plant.projects.find((p) => p.name === "Turnaround");
    expect(turnaround.project_code).toBe("TA-27");
    expect(turnaround.description).toBe("Spring turnaround");
    expect(turnaround.project_type).toBe("turnaround");
    expect(turnaround.planned_start).toBe("2027-03-01");
    expect(turnaround.planned_finish).toBe("2027-04-15");
    expect(turnaround.status).toBe("planned"); // create defaults to planned
    expect(turnaround.version).toBe(1);
    expect(turnaround.site_id).toBe(site.id);
    expect(turnaround.package_count).toBe(0);
    const revamp = plant.projects.find((p) => p.name === "Revamp");
    expect(revamp.status).toBe("archived");
    expect(revamp.version).toBe(2);
    // The selector, by contrast, hides archived rows entirely.
    const tree = await selector(db, OWNER_A, OWNER_A);
    expect(tree.clients).toHaveLength(1);
    expect(tree.clients[0].sites[0].projects).toHaveLength(1);
    expect(tree.clients[0].sites[0].projects[0].name).toBe("Turnaround");
  });

  it60("package_count counts assigned packages in any status, including cancelled", async () => {
    const client = await createClient(db, OWNER_A, OWNER_A, "Acme Industrial");
    const site = await createSite(db, OWNER_A, OWNER_A, client.id, "Plant 1");
    const project = await createProject(db, OWNER_A, OWNER_A, site.id, "Turnaround");
    const other = await createProject(db, OWNER_A, OWNER_A, site.id, "Revamp");
    await linkPackage(db, OWNER_A, "forge_wp_1", project.id, "draft");
    await linkPackage(db, OWNER_A, "forge_wp_2", project.id, "cancelled");
    await linkPackage(db, OWNER_A, "forge_wp_3", other.id, "draft");
    await linkPackage(db, OWNER_A, "forge_wp_4", null, "draft");

    const inventory = await adminInventory(db, OWNER_A, OWNER_A);
    const projects = inventory.clients[0].sites[0].projects;
    expect(projects.find((p) => p.name === "Turnaround").package_count).toBe(2);
    expect(projects.find((p) => p.name === "Revamp").package_count).toBe(1);
  });

  it60("a read-only staff reader sees the inventory with canManage false; a stranger and a cross-owner caller are forbidden", async () => {
    const client = await createClient(db, OWNER_A, OWNER_A, "Acme Industrial");
    await provisionPlannerAndAssign(db, MEMBER_D, "read_only");
    const asReader = await adminInventory(db, MEMBER_D, OWNER_A);
    expect(asReader.canManage).toBe(false);
    expect(asReader.clients).toHaveLength(1);
    expect(asReader.clients[0].id).toBe(client.id);
    // A stranger (no workspace access at all) reaches nothing.
    const stranger = "99999999-9999-4999-8999-999999999999";
    await expectRpcError(db, stranger,
      `select forge_hierarchy_admin_inventory('${OWNER_A}');`,
      "FORGE_HIERARCHY_FORBIDDEN");
    // OWNER_B cannot read OWNER_A's inventory, and sees only his own.
    await expectRpcError(db, OWNER_B,
      `select forge_hierarchy_admin_inventory('${OWNER_A}');`,
      "FORGE_HIERARCHY_FORBIDDEN");
    const own = await adminInventory(db, OWNER_B, OWNER_B);
    expect(own.canManage).toBe(true);
    expect(own.clients).toHaveLength(0);
  });

  it60("project delete with assigned packages raises HAS_CHILDREN naming the count — cancelled counts too; unlinking unblocks", async () => {
    const client = await createClient(db, OWNER_A, OWNER_A, "Acme Industrial");
    const site = await createSite(db, OWNER_A, OWNER_A, client.id, "Plant 1");
    const project = await createProject(db, OWNER_A, OWNER_A, site.id, "Turnaround");
    await updateProject(db, OWNER_A, OWNER_A, project.id, { status: "archived" }, { expectedVersion: 1 });
    await linkPackage(db, OWNER_A, "forge_wp_1", project.id, "draft");
    await linkPackage(db, OWNER_A, "forge_wp_2", project.id, "cancelled");
    const caught = await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_delete('${OWNER_A}', '${project.id}', 2, 'req_del_blocked');`,
      "FORGE_HIERARCHY_HAS_CHILDREN");
    expect(String(caught.message)).toContain("2 assigned package");
    // Unlinking both packages unblocks the delete (never silently
    // cleared by the RPC itself — the test unlinks explicitly).
    await db.query(`update forge_work_packages set forge_project_id = null where owner_id = '${OWNER_A}';`);
    const deleted = await deleteProject(db, OWNER_A, OWNER_A, project.id, { expectedVersion: 2, requestId: "req_del_ok" });
    expect(deleted.deleted).toBe(true);
    expect(deleted.id).toBe(project.id);
    const audit = await auditFor(db, OWNER_A, "project", project.id);
    expect(audit.map((a) => a.action)).toContain("delete");
  });

  it60("an active project with packages raises NOT_ARCHIVED before the package check", async () => {
    const client = await createClient(db, OWNER_A, OWNER_A, "Acme Industrial");
    const site = await createSite(db, OWNER_A, OWNER_A, client.id, "Plant 1");
    const project = await createProject(db, OWNER_A, OWNER_A, site.id, "Turnaround");
    await linkPackage(db, OWNER_A, "forge_wp_1", project.id, "draft");
    await expectRpcError(db, OWNER_A,
      `select forge_hierarchy_project_delete('${OWNER_A}', '${project.id}', 1, 'req_del_active');`,
      "FORGE_HIERARCHY_NOT_ARCHIVED");
  });

  it60("ACL receipt: the inventory RPC executes for authenticated only; anon and direct DML are denied", async () => {
    const acl = await db.query(`
      select proacl::text as acl, prosecdef as secdef
        from pg_proc where proname = 'forge_hierarchy_admin_inventory';`);
    expect(acl.rows).toHaveLength(1);
    expect(acl.rows[0].acl).toBe("{postgres=X/postgres,authenticated=X/postgres}");
    expect(acl.rows[0].secdef).toBe(true);
    const privs = await db.query(`
      select has_function_privilege('authenticated', 'public.forge_hierarchy_admin_inventory(text)', 'EXECUTE') as auth,
             has_function_privilege('anon', 'public.forge_hierarchy_admin_inventory(text)', 'EXECUTE') as anon,
             has_function_privilege('service_role', 'public.forge_hierarchy_admin_inventory(text)', 'EXECUTE') as svc;`);
    expect(privs.rows[0]).toEqual({ auth: true, anon: false, svc: false });
    // The delete repair keeps the same narrow ACL.
    const delAcl = await db.query(`
      select proacl::text as acl from pg_proc
       where proname = 'forge_hierarchy_project_delete';`);
    expect(delAcl.rows[0].acl).toBe("{postgres=X/postgres,authenticated=X/postgres}");
    // Anon cannot call the RPC at all.
    let anonCaught = null;
    try {
      await asRole(db, "anon", OWNER_A, `select forge_hierarchy_admin_inventory('${OWNER_A}');`);
    } catch (error) {
      anonCaught = error;
    }
    expect(anonCaught).not.toBeNull();
    expect(String(anonCaught.message)).toMatch(/permission denied for function/i);
    // Direct DML is denied even for the owner (RPC-only write path).
    await expect(asUser(db, OWNER_A,
      `insert into forge_clients (owner_id, id, name, created_by, updated_by) values ('${OWNER_A}', 'direct1', 'Direct', '${OWNER_A}', '${OWNER_A}');`))
      .rejects.toThrow(/permission denied|not allowed|policy/i);
  });

  it60("re-applying the inventory migration fails loudly on the function-exists preflight", async () => {
    await expect(db.exec(loadMigrationSql(ADMIN_INVENTORY_MIGRATION)))
      .rejects.toThrow(/FORGE_HMI_FUNCTION_EXISTS/);
  });
});

// Real-PostgreSQL subset. PGlite is single-connection, so the
// two-session concurrency legs can only run here, against a scratch
// PG16 cluster. The suite is gated on the binaries existing AND an
// unprivileged user to run the cluster as (initdb refuses root, and
// this VM's agent runs as root) — and SKIPS LOUDLY, never silently,
// when either is missing.
//
// The cluster MUST be UTF8 (C.UTF-8): the default initdb under a POSIX
// locale creates a SQL_ASCII cluster, and in SQL_ASCII non-ASCII bytes
// in migration text (the em-dash in the admin migrations' comments)
// can trip the migrations' control-character checks. In UTF8 (what
// Supabase production uses, and what PGlite uses) the em-dash is one
// proper U+2014 character and the checks pass. A SQL_ASCII failure here
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

describe.skipIf(!HAS_REAL_PG)("forge shared hierarchy migration: real-PostgreSQL subset", () => {
  let pgDir;
  let pgClient;
  let pgCfg;

  beforeAll(async () => {
    pgDir = mkdtempSync(join(tmpdir(), "fh-realpg-"));
    execSync(`chown ${PG_RUN_USER}:${PG_RUN_USER} "${pgDir}"`, { stdio: "pipe" });
    const asPgUser = (cmd) => `runuser -u ${PG_RUN_USER} -- ${cmd}`;
    execSync(asPgUser(`"${PG_BIN}/initdb" -D "${pgDir}" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8`), { stdio: "pipe" });
    execSync(
      asPgUser(`"${PG_BIN}/pg_ctl" -D "${pgDir}" -o "-p 55436 -k ${pgDir} -c listen_addresses=''" -l "${pgDir}/server.log" start`),
      { stdio: "pipe" },
    );
    pgCfg = { host: pgDir, port: 55436, user: "postgres", database: "postgres" };
    pgClient = new Client(pgCfg);
    await pgClient.connect();
    await pgClient.query(PREREQ_SQL);
    await pgClient.query(loadMigrationSql(PLANNER_ADMIN_MIGRATION));
    await pgClient.query(loadMigrationSql(RENTAL_ADMIN_MIGRATION));
    await pgClient.query(loadMigrationSql(SCHEDULING_ADMIN_MIGRATION));
    await pgClient.query(`
      insert into workspace_members (owner_id, member_user_id, status, role)
        values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
    `);
    await pgClient.query(loadMigrationSql(THIS_MIGRATION));
    await pgClient.query(PACKAGES_STUB_SQL);
    await pgClient.query(loadMigrationSql(PROJECT_LINK_MIGRATION));
    await pgClient.query(loadMigrationSql(ADMIN_INVENTORY_MIGRATION));
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

  it60("two sessions creating the same client with the same request id: exactly one client, one audit row, both callers get the same id", async () => {
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const create = (client) => pgAsUser(client, OWNER_A, `
        select forge_hierarchy_client_create(
          '${OWNER_A}', 'Race Client', null, null, 'req_race_create') as v;`);
      const results = await Promise.allSettled([create(clientA), create(clientB)]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled).toHaveLength(2);
      expect(fulfilled[0].value.rows[0].v.id).toBe(fulfilled[1].value.rows[0].v.id);
      const { rows: clients } = await pgClient.query(`
        select count(*)::int as n from forge_clients where owner_id = '${OWNER_A}' and name = 'Race Client';`);
      expect(clients[0].n).toBe(1);
      const { rows: audit } = await pgClient.query(`
        select count(*)::int as n from forge_hierarchy_audit
        where owner_id = '${OWNER_A}' and entity_type = 'client' and request_id = 'req_race_create';`);
      expect(audit[0].n).toBe(1);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("two sessions updating the same client at the same version: one wins, the other gets 409, no lost audit/update pair", async () => {
    // NOTE: the two racers request DIFFERENT changes here. Two
    // sessions requesting the IDENTICAL change are covered by the
    // next test: distinct request ids are different commands, so the
    // loser 409s even on an identical payload — convergence is
    // rejected; only a same-request-ID replay returns the row.
    const { rows: created } = await pgAsUser(pgClient, OWNER_A, `
      select forge_hierarchy_client_create('${OWNER_A}', 'Race Update Client', null, null, 'req_race_upd_0') as v;`);
    const clientId = created[0].v.id;
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const change = (client, requestId, name) => pgAsUser(client, OWNER_A, `
        select forge_hierarchy_client_update(
          '${OWNER_A}', '${clientId}', '${name}', null, null, null, 1, '${requestId}') as v;`);
      const results = await Promise.allSettled([
        change(clientA, "req_race_upd_a", "Race Winner A"),
        change(clientB, "req_race_upd_b", "Race Winner B"),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toMatch(/FORGE_HIERARCHY_STALE_VERSION/);
      const { rows: client } = await pgClient.query(`
        select name, version from forge_clients where owner_id = '${OWNER_A}' and id = '${clientId}';`);
      expect(client).toHaveLength(1);
      expect(["Race Winner A", "Race Winner B"]).toContain(client[0].name);
      expect(client[0].version).toBe(2);
      const { rows: audit } = await pgClient.query(`
        select count(*)::int as n from forge_hierarchy_audit
        where owner_id = '${OWNER_A}' and entity_type = 'client' and entity_id = '${clientId}' and action = 'update';`);
      expect(audit[0].n).toBe(1);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("two sessions updating with the identical change-set and distinct request ids: one wins, the other gets 409 (client, site, project)", async () => {
    // Distinct request ids are different commands: the loser 409s
    // even when its payload is identical to the winner's. Only a
    // same-request-ID replay returns the applied row.
    const { rows: createdClient } = await pgAsUser(pgClient, OWNER_A, `
      select forge_hierarchy_client_create('${OWNER_A}', 'Race Same Client', null, null, 'req_race_same_0') as v;`);
    const clientId = createdClient[0].v.id;
    const { rows: createdSite } = await pgAsUser(pgClient, OWNER_A, `
      select forge_hierarchy_site_create('${OWNER_A}', '${clientId}', 'Race Same Yard', 'other', null, null, null, null, null, null, 'req_race_same_1') as v;`);
    const siteId = createdSite[0].v.id;
    const { rows: createdProject } = await pgAsUser(pgClient, OWNER_A, `
      select forge_hierarchy_project_create('${OWNER_A}', '${siteId}', 'Race Same Job', null, null, null, null, null, 'req_race_same_2') as v;`);
    const projectId = createdProject[0].v.id;
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const race = async (sqlA, sqlB) => {
        const results = await Promise.allSettled([
          pgAsUser(clientA, OWNER_A, sqlA),
          pgAsUser(clientB, OWNER_A, sqlB),
        ]);
        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toMatch(/FORGE_HIERARCHY_STALE_VERSION/);
      };
      await race(
        `select forge_hierarchy_client_update('${OWNER_A}', '${clientId}', 'Race Same Winner', null, null, null, 1, 'req_race_same_a') as v;`,
        `select forge_hierarchy_client_update('${OWNER_A}', '${clientId}', 'Race Same Winner', null, null, null, 1, 'req_race_same_b') as v;`);
      await race(
        `select forge_hierarchy_site_update('${OWNER_A}', '${siteId}', null, 'Race Same Yard East', null, null, null, null, null, null, null, null, 1, 'req_race_same_c') as v;`,
        `select forge_hierarchy_site_update('${OWNER_A}', '${siteId}', null, 'Race Same Yard East', null, null, null, null, null, null, null, null, 1, 'req_race_same_d') as v;`);
      await race(
        `select forge_hierarchy_project_update('${OWNER_A}', '${projectId}', null, 'Race Same Job East', null, null, null, null, null, null, 1, 'req_race_same_e') as v;`,
        `select forge_hierarchy_project_update('${OWNER_A}', '${projectId}', null, 'Race Same Job East', null, null, null, null, null, null, 1, 'req_race_same_f') as v;`);
      const { rows: client } = await pgClient.query(`
        select name, version from forge_clients where owner_id = '${OWNER_A}' and id = '${clientId}';`);
      expect(client[0].name).toBe("Race Same Winner");
      expect(client[0].version).toBe(2);
      const { rows: site } = await pgClient.query(`
        select name, version from forge_sites where owner_id = '${OWNER_A}' and id = '${siteId}';`);
      expect(site[0].name).toBe("Race Same Yard East");
      expect(site[0].version).toBe(2);
      const { rows: project } = await pgClient.query(`
        select name, version from forge_projects where owner_id = '${OWNER_A}' and id = '${projectId}';`);
      expect(project[0].name).toBe("Race Same Job East");
      expect(project[0].version).toBe(2);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("two sessions creating projects with the same code: one wins, the other gets DUPLICATE_CODE", async () => {
    const { rows: createdClient } = await pgAsUser(pgClient, OWNER_A, `
      select forge_hierarchy_client_create('${OWNER_A}', 'Race Code Client', null, null, 'req_race_code_0') as v;`);
    const { rows: createdSite } = await pgAsUser(pgClient, OWNER_A, `
      select forge_hierarchy_site_create('${OWNER_A}', '${createdClient[0].v.id}', 'Race Code Yard', 'other', null, null, null, null, null, null, 'req_race_code_1') as v;`);
    const siteId = createdSite[0].v.id;
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const create = (client, requestId) => pgAsUser(client, OWNER_A, `
        select forge_hierarchy_project_create(
          '${OWNER_A}', '${siteId}', 'Race Code Job', 'RACE-CODE', null, null, null, null, '${requestId}') as v;`);
      const results = await Promise.allSettled([
        create(clientA, "req_race_code_a"),
        create(clientB, "req_race_code_b"),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toMatch(/FORGE_HIERARCHY_DUPLICATE_CODE/);
      const { rows: projects } = await pgClient.query(`
        select count(*)::int as n from forge_projects
        where owner_id = '${OWNER_A}' and project_code = 'RACE-CODE';`);
      expect(projects[0].n).toBe(1);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("a site create blocks while its parent client is locked, then proceeds once the lock releases", async () => {
    const { rows: created } = await pgAsUser(pgClient, OWNER_A, `
      select forge_hierarchy_client_create('${OWNER_A}', 'Race Lock Client', null, null, 'req_race_lock_0') as v;`);
    const clientId = created[0].v.id;
    const locker = new Client(pgCfg);
    const creator = new Client(pgCfg);
    await locker.connect();
    await creator.connect();
    try {
      // Session A holds the parent row FOR UPDATE: a concurrent
      // archive/reparent cannot slip in while the create waits.
      await locker.query("begin");
      await locker.query(`select * from forge_clients where owner_id = '${OWNER_A}' and id = '${clientId}' for update;`);
      // Session B's create takes the parent FOR SHARE and must time
      // out on the lock rather than slipping past it.
      await creator.query("set lock_timeout = '500ms'");
      let caught = null;
      try {
        await pgAsUser(creator, OWNER_A, `
          select forge_hierarchy_site_create(
            '${OWNER_A}', '${clientId}', 'Locked Yard', 'other', null, null, null, null, null, null, 'req_race_lock_1') as v;`);
      } catch (error) {
        caught = error;
      }
      expect(caught, "expected the create to time out on the parent lock").not.toBeNull();
      expect(String(caught.message)).toMatch(/lock timeout/i);
      expect(caught.code).toBe("55P03");
      // Once the lock releases, the same create succeeds.
      await locker.query("rollback");
      await creator.query("set lock_timeout = '0'");
      const { rows: site } = await pgAsUser(creator, OWNER_A, `
        select forge_hierarchy_site_create(
          '${OWNER_A}', '${clientId}', 'Locked Yard', 'other', null, null, null, null, null, null, 'req_race_lock_1') as v;`);
      expect(site[0].v.name).toBe("Locked Yard");
      const { rows: sites } = await pgClient.query(`
        select count(*)::int as n from forge_sites where owner_id = '${OWNER_A}' and name = 'Locked Yard';`);
      expect(sites[0].n).toBe(1);
    } finally {
      await locker.query("rollback").catch(() => {});
      await locker.end().catch(() => {});
      await creator.end().catch(() => {});
    }
  });

  it60("real PostgreSQL 16: inventory RPC returns the full tree with package_count, and the ACL receipt holds", async () => {
    // Shared cluster: other legs in this describe create their own
    // clients, so find by name — never assert a total count here.
    const client = new Client(pgCfg);
    await client.connect();
    try {
      const { rows: created } = await pgAsUser(client, OWNER_A, `
        select forge_hierarchy_client_create('${OWNER_A}', 'RealPG Inventory Client', 'RPG-1', null, 'req_realpg_inv_1') as v;`);
      const clientId = created[0].v.id;
      const { rows: siteRows } = await pgAsUser(client, OWNER_A, `
        select forge_hierarchy_site_create('${OWNER_A}', '${clientId}', 'RealPG Yard', 'industrial', null, null, null, null, null, null, 'req_realpg_inv_2') as v;`);
      const siteId = siteRows[0].v.id;
      const { rows: projRows } = await pgAsUser(client, OWNER_A, `
        select forge_hierarchy_project_create('${OWNER_A}', '${siteId}', 'RealPG Job', 'RPG-01', null, null, null, null, 'req_realpg_inv_3') as v;`);
      const projectId = projRows[0].v.id;
      await pgClient.query(`
        insert into forge_work_packages (owner_id, id, title, status, forge_project_id)
        values ('${OWNER_A}', 'forge_wp_realpg_1', 'RealPG package', 'cancelled', '${projectId}');`);
      const { rows: invRows } = await pgAsUser(client, OWNER_A, `
        select forge_hierarchy_admin_inventory('${OWNER_A}') as v;`);
      const inventory = invRows[0].v;
      expect(inventory.canManage).toBe(true);
      const mine = inventory.clients.find((c) => c.id === clientId);
      expect(mine).toBeDefined();
      expect(mine.external_reference).toBe("RPG-1");
      expect(mine.version).toBe(1);
      expect(mine.sites).toHaveLength(1);
      expect(mine.sites[0].site_type).toBe("industrial");
      const job = mine.sites[0].projects.find((p) => p.id === projectId);
      expect(job.project_code).toBe("RPG-01");
      expect(job.version).toBe(1);
      // A cancelled package still counts.
      expect(job.package_count).toBe(1);
    } finally {
      await client.end().catch(() => {});
    }
    const acl = await pgClient.query(`
      select proacl::text as acl from pg_proc where proname = 'forge_hierarchy_admin_inventory';`);
    expect(acl.rows[0].acl).toBe("{postgres=X/postgres,authenticated=X/postgres}");
    const privs = await pgClient.query(`
      select has_function_privilege('authenticated', 'public.forge_hierarchy_admin_inventory(text)', 'EXECUTE') as auth,
             has_function_privilege('anon', 'public.forge_hierarchy_admin_inventory(text)', 'EXECUTE') as anon,
             has_function_privilege('service_role', 'public.forge_hierarchy_admin_inventory(text)', 'EXECUTE') as svc;`);
    expect(privs.rows[0]).toEqual({ auth: true, anon: false, svc: false });
  });

  it60("real PostgreSQL 16: project delete with assigned packages raises HAS_CHILDREN; unlinking unblocks", async () => {
    const client = new Client(pgCfg);
    await client.connect();
    try {
      const { rows: created } = await pgAsUser(client, OWNER_A, `
        select forge_hierarchy_client_create('${OWNER_A}', 'RealPG Delete Client', null, null, 'req_realpg_del_1') as v;`);
      const clientId = created[0].v.id;
      const { rows: siteRows } = await pgAsUser(client, OWNER_A, `
        select forge_hierarchy_site_create('${OWNER_A}', '${clientId}', 'RealPG Delete Yard', 'other', null, null, null, null, null, null, 'req_realpg_del_2') as v;`);
      const siteId = siteRows[0].v.id;
      const { rows: projRows } = await pgAsUser(client, OWNER_A, `
        select forge_hierarchy_project_create('${OWNER_A}', '${siteId}', 'RealPG Delete Job', null, null, null, null, null, 'req_realpg_del_3') as v;`);
      const projectId = projRows[0].v.id;
      await pgAsUser(client, OWNER_A, `
        select forge_hierarchy_project_update('${OWNER_A}', '${projectId}', null, null, null, null, null, null, null, 'archived', 1, 'req_realpg_del_4') as v;`);
      await pgClient.query(`
        insert into forge_work_packages (owner_id, id, title, status, forge_project_id)
        values ('${OWNER_A}', 'forge_wp_realpg_2', 'RealPG delete package', 'draft', '${projectId}');`);
      await expect(pgAsUser(client, OWNER_A, `
        select forge_hierarchy_project_delete('${OWNER_A}', '${projectId}', 2, 'req_realpg_del_5') as v;`))
        .rejects.toThrow(/FORGE_HIERARCHY_HAS_CHILDREN: project .* still has 1 assigned package/);
      await pgClient.query(`
        update forge_work_packages set forge_project_id = null
        where owner_id = '${OWNER_A}' and id = 'forge_wp_realpg_2';`);
      const { rows: deleted } = await pgAsUser(client, OWNER_A, `
        select forge_hierarchy_project_delete('${OWNER_A}', '${projectId}', 2, 'req_realpg_del_6') as v;`);
      expect(deleted[0].v.deleted).toBe(true);
    } finally {
      await client.end().catch(() => {});
    }
  });
});
