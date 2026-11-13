// SaaS Auth PR 1 — migration/integration proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) on top of
// the three admin slices, and proves:
//   - All new tables exist with RLS + FORCE RLS, SELECT-only ACLs for
//     authenticated, and no direct DML path (RPC-only writes).
//   - The backfill creates one ACTIVE workspace + four ACTIVE
//     owner_manual entitlements per distinct live owner, and the
//     designer/capture starter roles for every pre-existing workspace.
//   - The gate (forge_check_app_access): owner / co-owner / active
//     member pass; strangers, pending/suspended workspaces, and
//     revoked entitlements fail with non-disclosing reasons; a
//     platform operator WITHOUT a live support context gets nothing
//     (has_platform_operator never broadens has_workspace_access);
//     WITH a live context the operator passes via support_context.
//   - Provision / invite / membership / entitlement / workspace /
//     operator / programmer / support-context / app-role RPCs:
//     authority (owner / co-owner / workspace_admin ceiling /
//     platform owner), request-id idempotency (same payload replays,
//     different payload conflicts), fail-closed validation, and the
//     audit receipt for every mutation.
//   - forge_security_audit is append-only: no direct INSERT/UPDATE/
//     DELETE even for the owner; forge_audit_event is RPC-only
//     (no EXECUTE grant to authenticated).
//   - forge_is_programmer is a stable-user-ID grant; email is never
//     authority.
//   - Re-apply is idempotent.
//   - A two-session real-PostgreSQL leg proves concurrent duplicate
//     request ids are idempotent (one row, one audit row, both
//     callers get the same result).
//
// Roles, the auth.uid() stub, auth.users, workspace_members, and the
// has_workspace_access() copy mirror production. The extensions.digest
// stub delegates to sha256() (every call site uses sha256).

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
const OWNER_NEW = "66666666-6666-4666-8666-666666666666";
const MEMBER_C = "33333333-3333-4333-8333-333333333333";
const MEMBER_D = "44444444-4444-4444-8444-444444444444";
const MEMBER_E = "55555555-5555-4555-8555-555555555555";
const MEMBER_F = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const STRANGER_S = "77777777-7777-4777-8777-777777777777";
const INVITEE_I = "88888888-8888-4888-8888-888888888888";
const INVITEE_U = "99999999-9999-4999-8999-999999999999";
const PROGRAMMER_P = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPERATOR_O = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPERATOR_O2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const PLANNER_ADMIN_MIGRATION = "20261110000000_forge_planner_admin_permissions_slice1.sql";
const RENTAL_ADMIN_MIGRATION = "20261110010000_rental_admin_roles_slice1.sql";
const SCHEDULING_ADMIN_MIGRATION = "20261110080000_forge_scheduling_admin_permissions_slice1.sql";
const FOUNDATION_A_MIGRATION = "20261112010000_forge_shared_hierarchy_foundation.sql";
const THIS_MIGRATION = "20261113010000_saas_auth_pr1.sql";

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
  create table auth.users (
    id uuid not null primary key,
    email text,
    email_confirmed_at timestamptz
  );
  create schema extensions;
  create or replace function extensions.digest(data bytea, type text)
  returns bytea language sql immutable as $$
    select case when type = 'sha256' then sha256(data) else null end
  $$;
  -- pgcrypto's gen_random_bytes is unavailable in PGlite; the stub
  -- returns 16 random bytes (the token only needs to be a unique
  -- hex string here — production uses the real extensions function).
  create or replace function extensions.gen_random_bytes(n int)
  returns bytea language sql volatile as $$
    select decode(replace(gen_random_uuid()::text, '-', ''), 'hex')
  $$;
  create table workspace_members (
    owner_id text not null,
    id text not null,
    member_user_id uuid not null,
    status text not null,
    role text not null,
    invited_email text,
    invited_by uuid,
    invited_at timestamptz,
    activated_at timestamptz,
    suspended_at timestamptz,
    revoked_by uuid,
    revoked_reason text,
    permission_overrides jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (owner_id, id)
  );
  create unique index workspace_members_owner_member_uq
    on workspace_members (owner_id, member_user_id);
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
  create or replace function public.resolve_effective_owner_id(p_actor uuid default auth.uid())
  returns text language sql stable security definer
  set search_path = public set row_security = off as $$
    select coalesce(
      (select owner_id from workspace_members
       where member_user_id = p_actor and status = 'active'
       order by owner_id limit 1),
      p_actor::text);
  $$;
  -- Minimal shapes for pre-existing production tables the rental admin
  -- migration re-policies (its policies reference only owner_id; the
  -- full tables live in their own earlier migrations).
  create table rental_tenants (
    owner_id text not null, id text not null, primary key (owner_id, id));
  create table rental_maintenance_requests (
    owner_id text not null, id text not null, primary key (owner_id, id));
  create table rental_maintenance_work_orders (
    owner_id text not null, id text not null, primary key (owner_id, id));
  -- Backfill source tables for Auth PR 1 (only owner_id is read).
  -- NOTE: forge_clients / forge_sites / forge_projects are NOT stubbed
  -- here: the real-PG leg applies the Foundation PR A migration, which
  -- creates those tables for real, and a stub would shadow them (CREATE
  -- TABLE IF NOT EXISTS keeps the stub, then later statements fail on
  -- the missing columns). The PGlite setup creates the stubs instead.
  create table forge_work_packages (owner_id text not null, id text not null, primary key (owner_id, id));
  create table capture_library (owner_id text not null, id text not null, primary key (owner_id, id));
  create table designer_projects (owner_id text not null, id text not null, primary key (owner_id, id));
  create table rental_leases (owner_id text not null, id text not null, primary key (owner_id, id));
`;

// Seeded BEFORE the admin + Auth migrations so their backfills run
// against live-shaped data, as in production.
const SEED_SQL = `
  insert into auth.users (id, email, email_confirmed_at) values
    ('${OWNER_A}', 'owner-a@example.test', now()),
    ('${OWNER_B}', 'owner-b@example.test', now()),
    ('${OWNER_NEW}', 'owner-new@example.test', now()),
    ('${MEMBER_C}', 'coowner@example.test', now()),
    ('${MEMBER_D}', 'manager@example.test', now()),
    ('${MEMBER_E}', 'readonly@example.test', now()),
    ('${STRANGER_S}', 'stranger@example.test', now()),
    ('${INVITEE_I}', 'invitee@example.test', now()),
    ('${INVITEE_U}', 'unverified@example.test', null),
    ('${PROGRAMMER_P}', 'programmer@example.test', now()),
    ('${OPERATOR_O}', 'operator@example.test', now()),
    ('${OPERATOR_O2}', 'operator2@example.test', now());
  insert into workspace_members (owner_id, id, member_user_id, status, role)
    values ('${OWNER_A}', 'workspace_member_c', '${MEMBER_C}', 'active', 'co_owner'),
           ('${OWNER_A}', 'workspace_member_d', '${MEMBER_D}', 'active', 'manager'),
           ('${OWNER_A}', 'workspace_member_e', '${MEMBER_E}', 'active', 'read_only');
  insert into forge_work_packages (owner_id, id) values ('${OWNER_A}', 'wp-1');
  insert into capture_library (owner_id, id) values ('${OWNER_A}', 'cap-1');
  insert into designer_projects (owner_id, id) values ('${OWNER_B}', 'des-1');
  insert into rental_leases (owner_id, id) values ('${OWNER_B}', 'lease-1');
`;

async function setupDb({ withFoundationA = false } = {}) {
  const db = new PGlite();
  await db.exec(PREREQ_SQL);
  await db.exec(SEED_SQL);
  if (!withFoundationA) {
    // PGlite-only: the hierarchy tables are stubbed (only owner_id is
    // read by the Auth backfill). The real-PG leg applies the real
    // Foundation PR A migration instead — see the note in PREREQ_SQL.
    await db.exec(`
      create table forge_clients (owner_id text not null, id text not null, primary key (owner_id, id));
      create table forge_sites (owner_id text not null, id text not null, primary key (owner_id, id));
      create table forge_projects (owner_id text not null, id text not null, primary key (owner_id, id));
    `);
  }
  // Production order: the three admin slices first (role tables +
  // has_*_permission + provisioning functions), then this slice.
  await db.exec(loadMigrationSql(PLANNER_ADMIN_MIGRATION));
  await db.exec(loadMigrationSql(RENTAL_ADMIN_MIGRATION));
  await db.exec(loadMigrationSql(SCHEDULING_ADMIN_MIGRATION));
  if (withFoundationA) await db.exec(loadMigrationSql(FOUNDATION_A_MIGRATION));
  await db.exec(loadMigrationSql(THIS_MIGRATION));
  // Planner/scheduler starter roles for the seeded owners: in
  // production the admin slices backfilled them at apply time; here
  // the provision RPCs do the same work.
  for (const owner of [OWNER_A, OWNER_B]) {
    await asUser(db, owner, `select forge_planner_roles_provision_starter_set('${owner}', 'seed-planner-${owner.slice(0, 8)}') as v;`);
    await asUser(db, owner, `select forge_scheduling_roles_provision_starter_set('${owner}', 'seed-scheduling-${owner.slice(0, 8)}') as v;`);
  }
  // Platform operators + programmer grant are seeded by direct insert
  // here (the migration seeds them EMPTY by design; bootstrap is a
  // reviewed migration/controlled operation in production). The
  // programmer holds BOTH rows: the operator-registry row (identity,
  // role 'programmer', verified out-of-band) and the grant row
  // (authorization scope). A support context can only be granted to
  // someone holding the operator row.
  await db.exec(`
    insert into forge_platform_operators (user_id, platform_role, granted_by, verification_method, verification_reference, grant_reason)
      values ('${OPERATOR_O}', 'owner', '${OPERATOR_O}', 'out-of-band-id-confirmation', 'test-seed', 'test seed'),
             ('${OPERATOR_O2}', 'owner', '${OPERATOR_O}', 'out-of-band-id-confirmation', 'test-seed', 'test seed'),
             ('${PROGRAMMER_P}', 'programmer', '${OPERATOR_O}', 'out-of-band-id-confirmation', 'test-seed', 'test seed');
    insert into forge_programmer_grants (user_id, scope, granted_by, grant_reason)
      values ('${PROGRAMMER_P}', '{"read_only_diagnostics": true}'::jsonb, '${OPERATOR_O}', 'test seed');
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

function sqlStr(value) {
  return value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return value === null || value === undefined ? "null" : `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
}

function sqlArr(values) {
  if (!values) return "null";
  return `ARRAY[${values.map((v) => `'${v}'`).join(",")}]`;
}

function reqId() {
  return `req_${randomUUID().replace(/-/g, "")}`;
}

async function expectRpcError(db, uid, sql, code) {
  let caught = null;
  try {
    await asUser(db, uid, sql);
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected RPC to raise ${code}`).not.toBeNull();
  const haystack = `${caught.code ?? ""} ${String(caught.message)}`;
  expect(haystack).toContain(code);
  return caught;
}

async function rpc(db, uid, sql) {
  const { rows } = await asUser(db, uid, sql);
  return rows[0].v;
}

const gate = (db, uid, ownerId, appKey, cap = null) =>
  rpc(db, uid, `select forge_check_app_access(${sqlStr(ownerId)}, ${sqlStr(appKey)}, ${sqlStr(cap)}) as v;`);
const hasCap = (db, uid, ownerId, appKey, cap) =>
  rpc(db, uid, `select forge_has_app_capability(${sqlStr(ownerId)}, ${sqlStr(appKey)}, ${sqlStr(cap)}) as v;`);
const isProgrammer = (db, uid) => rpc(db, uid, `select forge_is_programmer() as v;`);
const provision = (db, uid, name, req = reqId()) =>
  rpc(db, uid, `select forge_provision_workspace(${sqlStr(name)}, ${sqlStr(req)}) as v;`);
const inviteCreate = (db, uid, ownerId, email, appKey, roleKey, req = reqId()) =>
  rpc(db, uid, `select forge_workspace_invite_create(${sqlStr(ownerId)}, ${sqlStr(email)}, ${sqlStr(appKey)}, ${sqlStr(roleKey)}, ${sqlStr(req)}) as v;`);
const inviteAccept = (db, uid, token, req = reqId()) =>
  rpc(db, uid, `select forge_workspace_invite_accept(${sqlStr(token)}, ${sqlStr(req)}) as v;`);
const inviteRevoke = (db, uid, invId, req = reqId()) =>
  rpc(db, uid, `select forge_workspace_invite_revoke(${sqlStr(invId)}, ${sqlStr(req)}) as v;`);
const membershipRevoke = (db, uid, ownerId, userId, reason, req = reqId()) =>
  rpc(db, uid, `select forge_workspace_membership_revoke(${sqlStr(ownerId)}, ${sqlStr(userId)}, ${sqlStr(reason)}, ${sqlStr(req)}) as v;`);
const membershipRoleSet = (db, uid, ownerId, userId, role, req = reqId()) =>
  rpc(db, uid, `select forge_workspace_membership_role_set(${sqlStr(ownerId)}, ${sqlStr(userId)}, ${sqlStr(role)}, ${sqlStr(req)}) as v;`);
const entitlementGrant = (db, uid, ownerId, appKey, source, reason, req = reqId()) =>
  rpc(db, uid, `select forge_app_entitlement_grant(${sqlStr(ownerId)}, ${sqlStr(appKey)}, ${sqlStr(source)}, null, null, ${sqlStr(reason)}, ${sqlStr(req)}) as v;`);
const entitlementRevoke = (db, uid, ownerId, appKey, reason, req = reqId()) =>
  rpc(db, uid, `select forge_app_entitlement_revoke(${sqlStr(ownerId)}, ${sqlStr(appKey)}, ${sqlStr(reason)}, ${sqlStr(req)}) as v;`);
const workspaceStatusSet = (db, uid, ownerId, status, reason, req = reqId()) =>
  rpc(db, uid, `select forge_workspace_status_set(${sqlStr(ownerId)}, ${sqlStr(status)}, ${sqlStr(reason)}, ${sqlStr(req)}) as v;`);
const operatorGrant = (db, uid, userId, role, method, ref, reason, req = reqId()) =>
  rpc(db, uid, `select forge_platform_operator_grant(${sqlStr(userId)}, ${sqlStr(role)}, ${sqlStr(method)}, ${sqlStr(ref)}, ${sqlStr(reason)}, ${sqlStr(req)}) as v;`);
const operatorRevoke = (db, uid, userId, reason, req = reqId()) =>
  rpc(db, uid, `select forge_platform_operator_revoke(${sqlStr(userId)}, ${sqlStr(reason)}, ${sqlStr(req)}) as v;`);
const programmerGrant = (db, uid, userId, scope, reason, req = reqId()) =>
  rpc(db, uid, `select forge_programmer_grant(${sqlStr(userId)}, ${sqlJson(scope)}, ${sqlStr(reason)}, ${sqlStr(req)}) as v;`);
const programmerRevoke = (db, uid, userId, reason, req = reqId()) =>
  rpc(db, uid, `select forge_programmer_revoke(${sqlStr(userId)}, ${sqlStr(reason)}, ${sqlStr(req)}) as v;`);
const contextCreate = (db, uid, ownerId, grantee, purpose, reason, apps, actions, expires, req = reqId()) =>
  rpc(db, uid, `select forge_support_context_create(${sqlStr(ownerId)}, ${sqlStr(grantee)}, ${sqlStr(purpose)}, ${sqlStr(reason)}, ${sqlArr(apps)}, ${sqlJson(actions)}, ${expires ? sqlStr(expires) : "null"}, ${sqlStr(req)}) as v;`);
const contextRevoke = (db, uid, ctxId, reason, req = reqId()) =>
  rpc(db, uid, `select forge_support_context_revoke(${sqlStr(ctxId)}, ${sqlStr(reason)}, ${sqlStr(req)}) as v;`);
const contextUse = (db, uid, ctxId, summary, req = reqId()) =>
  rpc(db, uid, `select forge_support_context_use(${sqlStr(ctxId)}, ${sqlStr(summary)}, ${sqlStr(req)}) as v;`);
const appRoleAssign = (db, uid, ownerId, appKey, userId, roleKey, reason, req = reqId()) =>
  rpc(db, uid, `select forge_app_role_assign(${sqlStr(ownerId)}, ${sqlStr(appKey)}, ${sqlStr(userId)}, ${sqlStr(roleKey)}, ${sqlStr(reason)}, ${sqlStr(req)}) as v;`);
const appRoleRevoke = (db, uid, ownerId, appKey, userId, reason, req = reqId()) =>
  rpc(db, uid, `select forge_app_role_revoke(${sqlStr(ownerId)}, ${sqlStr(appKey)}, ${sqlStr(userId)}, ${sqlStr(reason)}, ${sqlStr(req)}) as v;`);

async function auditCount(db, ownerId, action) {
  const ownerFilter = ownerId === null
    ? "target_owner_id is null"
    : `target_owner_id = '${ownerId}'`;
  const { rows } = await db.query(`
    select count(*)::int as n from forge_security_audit
    where ${ownerFilter} and action = '${action}';`);
  return rows[0].n;
}

describe("saas auth pr1 migration (PGlite)", () => {
  let db;
  beforeEach(async () => {
    db = await setupDb();
  });
  afterEach(async () => {
    await db?.close();
  });

  it60("new tables exist with RLS + FORCE RLS and SELECT-only ACLs for authenticated", async () => {
    const tables = [
      "forge_workspaces", "forge_app_entitlements", "forge_platform_operators",
      "forge_programmer_grants", "forge_support_contexts", "forge_security_audit",
      "forge_workspace_invitations",
      "forge_app_roles", "forge_app_role_capabilities", "forge_app_user_role_assignments",
    ];
    const { rows } = await db.query(`
      select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force,
             coalesce(c.relacl::text, '') as acl
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1::text[])
       order by c.relname;`, [tables]);
    expect(rows.map((r) => r.name).sort()).toEqual([...tables].sort());
    for (const row of rows) {
      expect(row.rls, `${row.name} RLS`).toBe(true);
      expect(row.force, `${row.name} FORCE RLS`).toBe(true);
      // SELECT-only for authenticated: no w/a/d/x on the authenticated entry.
      expect(row.acl, `${row.name} acl ${row.acl}`).toContain("authenticated=r/");
    }
    // The idempotency receipts are internal (SECURITY DEFINER RPCs read
    // them): no grant to authenticated at all, not even SELECT.
    const { rows: receiptRows } = await db.query(`
      select coalesce(relacl::text, '') as acl from pg_class
       where relname = 'forge_auth_idempotency_receipts' and relnamespace = 'public'::regnamespace;`);
    expect(receiptRows).toHaveLength(1);
    expect(receiptRows[0].acl).not.toContain("authenticated");
  });

  it60("the new RPCs are EXECUTE-granted to authenticated only (postgres + authenticated)", async () => {
    const expected = [
      "forge_check_app_access", "forge_has_app_capability", "forge_has_app_entitlement",
      "forge_has_app_role",
      "forge_has_platform_role", "forge_is_programmer", "has_platform_operator",
      "forge_app_roles_provision_starter_set", "forge_provision_workspace",
      "forge_workspace_invite_create", "forge_workspace_invite_accept", "forge_workspace_invite_revoke",
      "forge_workspace_membership_revoke", "forge_workspace_membership_role_set",
      "forge_app_entitlement_grant", "forge_app_entitlement_revoke", "forge_workspace_status_set",
      "forge_platform_operator_grant", "forge_platform_operator_revoke",
      "forge_programmer_grant", "forge_programmer_revoke",
      "forge_support_context_create", "forge_support_context_revoke", "forge_support_context_use",
      "forge_app_role_assign", "forge_app_role_revoke",
    ];
    const { rows } = await db.query(`
      select p.proname as name, p.proacl::text as acl
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any($1::text[])
       order by p.proname;`, [expected]);
    expect(rows.map((r) => r.name).sort()).toEqual([...expected].sort());
    for (const row of rows) {
      expect(row.acl, `${row.name} proacl`).toBe("{postgres=X/postgres,authenticated=X/postgres}");
    }
    // forge_audit_event is RPC-only: no EXECUTE grant to authenticated.
    const { rows: auditRows } = await db.query(`
      select proacl::text as acl from pg_proc
       where proname = 'forge_audit_event' and pronamespace = 'public'::regnamespace;`);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].acl ?? "").not.toContain("authenticated=X");
  });

  it60("backfill: one ACTIVE workspace + four ACTIVE owner_manual entitlements per live owner", async () => {
    const { rows: ws } = await db.query(`select owner_id, status from forge_workspaces order by owner_id;`);
    expect(ws).toEqual([
      { owner_id: OWNER_A, status: "active" },
      { owner_id: OWNER_B, status: "active" },
    ]);
    const { rows: ent } = await db.query(`
      select owner_id, app_key, status, source from forge_app_entitlements order by owner_id, app_key;`);
    expect(ent).toHaveLength(8);
    for (const row of ent) {
      expect(row.status).toBe("active");
      expect(row.source).toBe("owner_manual");
    }
    expect(new Set(ent.map((r) => r.app_key))).toEqual(
      new Set(["designer", "scheduler", "planner", "capture"]));
  });

  it60("backfill: designer + capture starter roles exist for every pre-existing workspace", async () => {
    const { rows } = await db.query(`
      select owner_id, app_key, role_key from forge_app_roles
      where retired_at is null order by owner_id, app_key, role_key;`);
    expect(rows).toEqual([
      { owner_id: OWNER_A, app_key: "capture", role_key: "capture_admin" },
      { owner_id: OWNER_A, app_key: "capture", role_key: "capture_read_only" },
      { owner_id: OWNER_A, app_key: "capture", role_key: "capture_user" },
      { owner_id: OWNER_A, app_key: "designer", role_key: "designer_admin" },
      { owner_id: OWNER_A, app_key: "designer", role_key: "designer_read_only" },
      { owner_id: OWNER_A, app_key: "designer", role_key: "designer_user" },
      { owner_id: OWNER_B, app_key: "capture", role_key: "capture_admin" },
      { owner_id: OWNER_B, app_key: "capture", role_key: "capture_read_only" },
      { owner_id: OWNER_B, app_key: "capture", role_key: "capture_user" },
      { owner_id: OWNER_B, app_key: "designer", role_key: "designer_admin" },
      { owner_id: OWNER_B, app_key: "designer", role_key: "designer_read_only" },
      { owner_id: OWNER_B, app_key: "designer", role_key: "designer_user" },
    ]);
    // No drawing-edit key anywhere in the designer catalog.
    const { rows: caps } = await db.query(`
      select distinct capability_key from forge_app_role_capabilities;`);
    expect(caps.map((r) => r.capability_key)).not.toContain("designer.drawings.edit");
  });

  it60("operator + programmer registries are seeded EMPTY by the migration (bootstrap only)", async () => {
    // setupDb seeds them AFTER the migration for the other legs; prove
    // the migration itself leaves them empty by re-checking a fresh db
    // built without the seed step.
    const fresh = new PGlite();
    try {
      await fresh.exec(PREREQ_SQL);
      await fresh.exec(SEED_SQL);
      await fresh.exec(`
        create table forge_clients (owner_id text not null, id text not null, primary key (owner_id, id));
        create table forge_sites (owner_id text not null, id text not null, primary key (owner_id, id));
        create table forge_projects (owner_id text not null, id text not null, primary key (owner_id, id));
      `);
      await fresh.exec(loadMigrationSql(PLANNER_ADMIN_MIGRATION));
      await fresh.exec(loadMigrationSql(RENTAL_ADMIN_MIGRATION));
      await fresh.exec(loadMigrationSql(SCHEDULING_ADMIN_MIGRATION));
      await fresh.exec(loadMigrationSql(THIS_MIGRATION));
      const { rows: ops } = await fresh.query(`select count(*)::int as n from forge_platform_operators;`);
      const { rows: prog } = await fresh.query(`select count(*)::int as n from forge_programmer_grants;`);
      expect(ops[0].n).toBe(0);
      expect(prog[0].n).toBe(0);
    } finally {
      await fresh.close();
    }
  });

  it60("re-apply is idempotent", async () => {
    await db.exec(loadMigrationSql(THIS_MIGRATION));
    const { rows } = await db.query(`select count(*)::int as n from forge_workspaces;`);
    expect(rows[0].n).toBe(2);
  });

  it60("gate: owner, co-owner, and active member pass; stranger and unknown app fail", async () => {
    expect(await gate(db, OWNER_A, OWNER_A, "planner")).toMatchObject({ allowed: true, via: "owner" });
    expect(await gate(db, MEMBER_C, OWNER_A, "planner")).toMatchObject({ allowed: true, via: "membership" });
    // MEMBER_D is a manager with NO app role: fix round 1 (P1) denies
    // the no-capability entry with APP_ROLE_REQUIRED instead of passing.
    expect(await gate(db, MEMBER_D, OWNER_A, "capture")).toMatchObject({ allowed: false, reason: "APP_ROLE_REQUIRED" });
    expect(await gate(db, STRANGER_S, OWNER_A, "planner")).toMatchObject({ allowed: false, reason: "NO_MEMBERSHIP" });
    expect(await gate(db, OWNER_A, OWNER_A, "rental")).toMatchObject({ allowed: false, reason: "UNKNOWN_APP" });
    expect(await gate(db, OWNER_A, OWNER_B, "planner")).toMatchObject({ allowed: false, reason: "NO_MEMBERSHIP" });
  });

  it60("gate (P1 fix round 1): no-capability entry requires an app role — a Designer-only member is denied Planner/Scheduler/Capture", async () => {
    // MEMBER_D holds a workspace membership but no app role at all.
    for (const app of ["planner", "scheduler", "designer", "capture"]) {
      expect(await gate(db, MEMBER_D, OWNER_A, app)).toMatchObject({ allowed: false, reason: "APP_ROLE_REQUIRED" });
    }
    // Owner and co-owner keep their structural bypass on the
    // no-capability entry (entitlement still applies — see the
    // suspended/revoked leg in the gate test below).
    expect(await gate(db, OWNER_A, OWNER_A, "planner")).toMatchObject({ allowed: true, via: "owner" });
    expect(await gate(db, MEMBER_C, OWNER_A, "scheduler")).toMatchObject({ allowed: true, via: "membership" });
    // Invite the invitee to Designer only and accept: the Designer
    // entry passes, the other three still deny.
    const created = await inviteCreate(db, OWNER_A, OWNER_A, "invitee@example.test", "designer", "designer_user");
    await inviteAccept(db, INVITEE_I, created.token);
    expect(await gate(db, INVITEE_I, OWNER_A, "designer")).toMatchObject({ allowed: true });
    expect(await gate(db, INVITEE_I, OWNER_A, "planner")).toMatchObject({ allowed: false, reason: "APP_ROLE_REQUIRED" });
    expect(await gate(db, INVITEE_I, OWNER_A, "scheduler")).toMatchObject({ allowed: false, reason: "APP_ROLE_REQUIRED" });
    expect(await gate(db, INVITEE_I, OWNER_A, "capture")).toMatchObject({ allowed: false, reason: "APP_ROLE_REQUIRED" });
    // The explicit-capability path is unchanged: the invited
    // capability passes, a capability from another app denies.
    expect(await hasCap(db, INVITEE_I, OWNER_A, "designer", "designer.designs.create")).toBe(true);
    expect(await hasCap(db, INVITEE_I, OWNER_A, "planner", "planner.packages.read")).toBe(false);
    // Revoking the assignment denies on the NEXT request.
    await appRoleRevoke(db, OWNER_A, OWNER_A, "designer", INVITEE_I, "offboarded");
    expect(await gate(db, INVITEE_I, OWNER_A, "designer")).toMatchObject({ allowed: false, reason: "APP_ROLE_REQUIRED" });
    // Retiring the ROLE itself (not just the assignment) also denies:
    // re-assign, retire the role row, re-check.
    await appRoleAssign(db, OWNER_A, OWNER_A, "designer", INVITEE_I, "designer_user", "re-onboarded");
    expect(await gate(db, INVITEE_I, OWNER_A, "designer")).toMatchObject({ allowed: true });
    await db.query(`update forge_app_roles set retired_at = now(), retired_by = '${OWNER_A}' where owner_id = '${OWNER_A}' and app_key = 'designer' and role_key = 'designer_user';`);
    expect(await gate(db, INVITEE_I, OWNER_A, "designer")).toMatchObject({ allowed: false, reason: "APP_ROLE_REQUIRED" });
  });

  it60("resolve_effective_owner_id (P2 fix round 1): a caller-supplied actor that is not the authenticated user is refused", async () => {
    // MEMBER_D is an active member of OWNER_A's workspace.
    expect(await rpc(db, MEMBER_D, `select resolve_effective_owner_id() as v;`)).toBe(OWNER_A);
    // Passing their own id explicitly still resolves (the only
    // legitimate explicit-argument callers, log_team_audit, pass
    // actor := auth.uid() verbatim).
    expect(await rpc(db, MEMBER_D, `select resolve_effective_owner_id('${MEMBER_D}') as v;`)).toBe(OWNER_A);
    // Passing ANOTHER user's id is refused — B's workspace is never revealed.
    await expectRpcError(db, MEMBER_D,
      `select resolve_effective_owner_id('${OWNER_A}') as v;`, "42501");
    await expectRpcError(db, MEMBER_D,
      `select resolve_effective_owner_id('${OWNER_B}') as v;`, "42501");
    // The grant is explicit in this migration: EXECUTE to authenticated only.
    const { rows } = await db.query(`
      select proacl::text as acl from pg_proc
       where proname = 'resolve_effective_owner_id' and pronamespace = 'public'::regnamespace;`);
    expect(rows).toHaveLength(1);
    expect(rows[0].acl).toBe("{postgres=X/postgres,authenticated=X/postgres}");
  });

  it60("gate: a platform operator WITHOUT a live support context gets nothing", async () => {
    expect(await gate(db, OPERATOR_O, OWNER_A, "planner")).toMatchObject({ allowed: false, reason: "NO_MEMBERSHIP" });
    expect(await hasCap(db, OPERATOR_O, OWNER_A, "planner", "planner.work_packages.read")).toBe(false);
  });

  it60("gate: a platform operator WITH a live support context passes via support_context, and the use is audited", async () => {
    const ctx = await contextCreate(db, OPERATOR_O, OWNER_A, PROGRAMMER_P, "debug billing", "investigate failed charge", ["planner"], ["*"], null);
    expect(ctx.context_id).toMatch(/^forge_ctx_/);
    // The context was granted to the programmer, not the operator who created it.
    expect(await gate(db, PROGRAMMER_P, OWNER_A, "planner")).toMatchObject({ allowed: true, via: "support_context" });
    expect(await auditCount(db, OWNER_A, "support_context.used")).toBe(1);
    // The operator themself still has no context of their own.
    expect(await gate(db, OPERATOR_O, OWNER_A, "planner")).toMatchObject({ allowed: false });
  });

  it60("gate: suspended workspace and revoked entitlement deny; capability denial is separate", async () => {
    await workspaceStatusSet(db, OPERATOR_O, OWNER_A, "suspended", "billing dispute");
    expect(await gate(db, OWNER_A, OWNER_A, "planner")).toMatchObject({ allowed: false, reason: "WORKSPACE_NOT_ACTIVE" });
    await workspaceStatusSet(db, OPERATOR_O, OWNER_A, "active", "dispute resolved");
    expect(await gate(db, OWNER_A, OWNER_A, "planner")).toMatchObject({ allowed: true });
    await entitlementRevoke(db, OPERATOR_O, OWNER_A, "planner", "pilot ended");
    expect(await gate(db, OWNER_A, OWNER_A, "planner")).toMatchObject({ allowed: false, reason: "ENTITLEMENT_NOT_ACTIVE" });
    expect(await gate(db, OWNER_A, OWNER_A, "capture")).toMatchObject({ allowed: true });
    expect(await gate(db, OWNER_A, OWNER_A, "planner", "planner.work_packages.read")).toMatchObject({ allowed: false, reason: "ENTITLEMENT_NOT_ACTIVE" });
  });

  it60("provision: new workspace starts pending with four pending entitlements + starter roles; replay is idempotent", async () => {
    const req = reqId();
    const first = await provision(db, OWNER_NEW, "New Workspace", req);
    expect(first).toMatchObject({ owner_id: OWNER_NEW, status: "pending" });
    const replay = await provision(db, OWNER_NEW, "New Workspace", req);
    expect(replay).toEqual(first);
    const { rows: ws } = await db.query(`select status from forge_workspaces where owner_id = '${OWNER_NEW}';`);
    expect(ws).toEqual([{ status: "pending" }]);
    const { rows: ent } = await db.query(`select status from forge_app_entitlements where owner_id = '${OWNER_NEW}';`);
    expect(ent).toHaveLength(4);
    expect(ent.every((r) => r.status === "pending")).toBe(true);
    const { rows: roles } = await db.query(`select count(*)::int as n from forge_app_roles where owner_id = '${OWNER_NEW}';`);
    expect(roles[0].n).toBe(6);
    expect(await auditCount(db, OWNER_NEW, "workspace.created")).toBe(1);
    // A different name under the same request id conflicts.
    await expectRpcError(db, OWNER_NEW,
      `select forge_provision_workspace('Other Name', '${req}') as v;`, "FORGE_AUTH_REQUEST_ID_CONFLICT");
    // Provisioning twice (fresh request id) conflicts on the workspace.
    await expectRpcError(db, OWNER_NEW,
      `select forge_provision_workspace('New Workspace', '${reqId()}') as v;`, "FORGE_AUTH_WORKSPACE_EXISTS");
    // The pending workspace denies app access (D7: no automatic trial).
    expect(await gate(db, OWNER_NEW, OWNER_NEW, "planner")).toMatchObject({ allowed: false, reason: "WORKSPACE_NOT_ACTIVE" });
  });

  it60("invite create: owner creates, token returned once, hash stored, duplicate pending conflicts", async () => {
    const createReq = reqId();
    const created = await inviteCreate(db, OWNER_A, OWNER_A, "invitee@example.test", "planner", "planner", createReq);
    expect(created.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(created.invitation_id).toMatch(/^forge_inv_/);
    const { rows } = await db.query(`select token_hash, invited_email, status from forge_workspace_invitations where id = '${created.invitation_id}';`);
    expect(rows).toHaveLength(1);
    expect(rows[0].invited_email).toBe("invitee@example.test");
    expect(rows[0].status).toBe("pending");
    // The stored value is a sha256 hex digest, never the token itself.
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].token_hash).not.toContain(created.token.slice(0, 8));
    // The same request id replays the same invitation — but the token
    // is returned ONCE ONLY by design: the stored receipt redacts it
    // (the invitations table holds only the sha256 hash), so a replay
    // carries the invitation id and expiry but no token. An inviter
    // who lost the token revokes and re-invites.
    const replay = await inviteCreate(db, OWNER_A, OWNER_A, "invitee@example.test", "planner", "planner", createReq);
    expect(replay.invitation_id).toBe(created.invitation_id);
    expect(replay.expires_at).toBe(created.expires_at);
    expect(replay.token).toBeUndefined();
    await expectRpcError(db, OWNER_A,
      `select forge_workspace_invite_create('${OWNER_A}', 'invitee@example.test', 'planner', 'planner_admin', '${createReq}') as v;`,
      "FORGE_AUTH_REQUEST_ID_CONFLICT");
    await expectRpcError(db, OWNER_A,
      `select forge_workspace_invite_create('${OWNER_A}', 'invitee@example.test', 'planner', 'planner', '${reqId()}') as v;`,
      "FORGE_AUTH_INVITE_EXISTS");
    await expectRpcError(db, OWNER_A,
      `select forge_workspace_invite_create('${OWNER_A}', 'owner-a@example.test', 'planner', 'planner', '${reqId()}') as v;`,
      "FORGE_AUTH_SELF_INVITE");
    // Verification is an ACCEPT-time check (brief §5): create
    // succeeds for an address with no account yet and for an
    // unverified address — the invitation waits until the invitee
    // signs up and verifies. Accept rejects both (see below).
    const noAccount = await inviteCreate(db, OWNER_A, OWNER_A, "nobody@example.test", "planner", "planner");
    expect(noAccount.invitation_id).toMatch(/^forge_inv_/);
    const unverified = await inviteCreate(db, OWNER_A, OWNER_A, "unverified@example.test", "planner", "planner");
    expect(unverified.invitation_id).toMatch(/^forge_inv_/);
    await expectRpcError(db, STRANGER_S,
      `select forge_workspace_invite_create('${OWNER_A}', 'invitee@example.test', 'planner', 'planner', '${reqId()}') as v;`,
      "FORGE_AUTH_INVITE_FORBIDDEN");
  });

  it60("invite create: workspace_admin cannot invite a roles.manage role (ceiling)", async () => {
    // MEMBER_D is a manager, not workspace_admin; promote them first.
    await membershipRoleSet(db, OWNER_A, OWNER_A, MEMBER_D, "workspace_admin");
    // The ceiling fires on the TARGET role holding <app>.roles.manage.
    // The planner starter catalog gives roles.manage to no role but
    // 'owner' (already refused as ROLE_STALE), so the ceiling is
    // exercised through designer 'designer_admin', which holds
    // designer.roles.manage in the starter set.
    await expectRpcError(db, MEMBER_D,
      `select forge_workspace_invite_create('${OWNER_A}', 'invitee@example.test', 'designer', 'designer_admin', '${reqId()}') as v;`,
      "FORGE_AUTH_CEILING_EXCEEDED");
    // A non-manage role is fine for the admin.
    const created = await inviteCreate(db, MEMBER_D, OWNER_A, "invitee@example.test", "planner", "planner");
    expect(created.invitation_id).toMatch(/^forge_inv_/);
  });

  it60("invite accept: matching verified email activates a read_only membership + the invited app role", async () => {
    const created = await inviteCreate(db, OWNER_A, OWNER_A, "invitee@example.test", "designer", "designer_user");
    const accepted = await inviteAccept(db, INVITEE_I, created.token);
    expect(accepted).toMatchObject({ owner_id: OWNER_A, app_key: "designer", role_key: "designer_user", membership: "active" });
    const { rows: members } = await db.query(`
      select role, status from workspace_members where owner_id = '${OWNER_A}' and member_user_id = '${INVITEE_I}';`);
    expect(members).toEqual([{ role: "read_only", status: "active" }]);
    const { rows: inv } = await db.query(`select status from forge_workspace_invitations where id = '${created.invitation_id}';`);
    expect(inv).toEqual([{ status: "accepted" }]);
    expect(await auditCount(db, OWNER_A, "invitation.accepted")).toBe(1);
    // The membership now passes the gate.
    expect(await gate(db, INVITEE_I, OWNER_A, "designer")).toMatchObject({ allowed: true });
    // And holds the invited designer capability.
    expect(await hasCap(db, INVITEE_I, OWNER_A, "designer", "designer.designs.create")).toBe(true);
    expect(await hasCap(db, INVITEE_I, OWNER_A, "designer", "designer.designs.delete")).toBe(false);
  });

  it60("invite accept: wrong email, stranger, and expired tokens all fail with the same generic error", async () => {
    const created = await inviteCreate(db, OWNER_A, OWNER_A, "invitee@example.test", "planner", "planner");
    await expectRpcError(db, STRANGER_S,
      `select forge_workspace_invite_accept(${sqlStr(created.token)}, '${reqId()}') as v;`, "FORGE_AUTH_INVITE_INVALID");
    await expectRpcError(db, MEMBER_D,
      `select forge_workspace_invite_accept(${sqlStr(created.token)}, '${reqId()}') as v;`, "FORGE_AUTH_INVITE_INVALID");
    // Revoked invites cannot be accepted.
    await inviteRevoke(db, OWNER_A, created.invitation_id);
    await expectRpcError(db, INVITEE_I,
      `select forge_workspace_invite_accept(${sqlStr(created.token)}, '${reqId()}') as v;`, "FORGE_AUTH_INVITE_INVALID");
  });

  it60("membership revoke: owner revokes, assignments retire, self-revoke and admin revoke are refused", async () => {
    const created = await inviteCreate(db, OWNER_A, OWNER_A, "invitee@example.test", "designer", "designer_user");
    await inviteAccept(db, INVITEE_I, created.token);
    await expectRpcError(db, MEMBER_D,
      `select forge_workspace_membership_revoke('${OWNER_A}', '${INVITEE_I}', 'no', '${reqId()}') as v;`,
      "FORGE_AUTH_OWNER_ONLY");
    await expectRpcError(db, OWNER_A,
      `select forge_workspace_membership_revoke('${OWNER_A}', '${OWNER_A}', 'no', '${reqId()}') as v;`,
      "FORGE_AUTH_SELF_REVOKE");
    const revoked = await membershipRevoke(db, OWNER_A, OWNER_A, INVITEE_I, "left the project");
    expect(revoked).toMatchObject({ status: "revoked" });
    const { rows } = await db.query(`
      select status from workspace_members where owner_id = '${OWNER_A}' and member_user_id = '${INVITEE_I}';`);
    expect(rows).toEqual([{ status: "revoked" }]);
    const { rows: assignments } = await db.query(`
      select count(*)::int as n from forge_app_user_role_assignments
      where owner_id = '${OWNER_A}' and user_id = '${INVITEE_I}' and retired_at is null;`);
    expect(assignments[0].n).toBe(0);
    expect(await gate(db, INVITEE_I, OWNER_A, "designer")).toMatchObject({ allowed: false, reason: "NO_MEMBERSHIP" });
    expect(await auditCount(db, OWNER_A, "member.revoked")).toBe(1);
    await expectRpcError(db, OWNER_A,
      `select forge_workspace_membership_revoke('${OWNER_A}', '${INVITEE_I}', 'again', '${reqId()}') as v;`,
      "FORGE_AUTH_ALREADY_REVOKED");
  });

  it60("membership role set: owner sets roles, admin cannot grant co_owner or workspace_admin", async () => {
    const changed = await membershipRoleSet(db, OWNER_A, OWNER_A, MEMBER_D, "bookkeeper");
    expect(changed).toMatchObject({ role: "bookkeeper" });
    await membershipRoleSet(db, OWNER_A, OWNER_A, MEMBER_D, "workspace_admin");
    await expectRpcError(db, MEMBER_D,
      `select forge_workspace_membership_role_set('${OWNER_A}', '${MEMBER_E}', 'co_owner', '${reqId()}') as v;`,
      "FORGE_AUTH_CEILING_EXCEEDED");
    await expectRpcError(db, MEMBER_D,
      `select forge_workspace_membership_role_set('${OWNER_A}', '${MEMBER_E}', 'workspace_admin', '${reqId()}') as v;`,
      "FORGE_AUTH_CEILING_EXCEEDED");
    const ok = await membershipRoleSet(db, MEMBER_D, OWNER_A, MEMBER_E, "manager");
    expect(ok).toMatchObject({ role: "manager" });
  });

  it60("entitlement grant/revoke: platform owner only; trial and webhook sources are rejected until decided", async () => {
    await expectRpcError(db, OWNER_A,
      `select forge_app_entitlement_grant('${OWNER_B}', 'planner', 'owner_manual', null, null, 'x', '${reqId()}') as v;`,
      "FORGE_AUTH_PLATFORM_OWNER_ONLY");
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_entitlement_grant('${OWNER_B}', 'planner', 'owner_trial', null, null, 'x', '${reqId()}') as v;`,
      "FORGE_AUTH_TRIAL_UNDECIDED");
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_entitlement_grant('${OWNER_B}', 'planner', 'verified_billing_webhook', null, null, 'x', '${reqId()}') as v;`,
      "FORGE_AUTH_BILLING_WEBHOOK_UNAVAILABLE");
    const granted = await entitlementGrant(db, OPERATOR_O, OWNER_B, "planner", "owner_manual", "pilot grant");
    expect(granted).toMatchObject({ status: "active", source: "owner_manual" });
    expect(await auditCount(db, OWNER_B, "entitlement.granted")).toBe(1);
    const revoked = await entitlementRevoke(db, OPERATOR_O, OWNER_B, "planner", "pilot ended");
    expect(revoked).toMatchObject({ status: "revoked" });
  });

  it60("workspace status set: platform owner only; owner cannot self-activate", async () => {
    await expectRpcError(db, OWNER_A,
      `select forge_workspace_status_set('${OWNER_A}', 'active', 'x', '${reqId()}') as v;`,
      "FORGE_AUTH_PLATFORM_OWNER_ONLY");
    const set = await workspaceStatusSet(db, OPERATOR_O, OWNER_B, "suspended", "billing dispute");
    expect(set).toMatchObject({ status: "suspended" });
    expect(await auditCount(db, OWNER_B, "workspace.status_changed")).toBe(1);
  });

  it60("operator grant/revoke: platform owner only; the last owner cannot be revoked", async () => {
    await expectRpcError(db, OWNER_A,
      `select forge_platform_operator_grant('${PROGRAMMER_P}', 'support', 'x', null, 'x', '${reqId()}') as v;`,
      "FORGE_AUTH_PLATFORM_OWNER_ONLY");
    const granted = await operatorGrant(db, OPERATOR_O, PROGRAMMER_P, "support", "out-of-band-id-confirmation", "test", "support onboarding");
    expect(granted).toMatchObject({ platform_role: "support", is_active: true });
    // Two owners exist (seeded); revoking one works, revoking the last
    // one fails — and the last-owner check fires before self-revoke,
    // so the last remaining owner cannot remove themself either.
    const revoked = await operatorRevoke(db, OPERATOR_O, OPERATOR_O2, "offboarded");
    expect(revoked).toMatchObject({ is_active: false });
    await expectRpcError(db, OPERATOR_O,
      `select forge_platform_operator_revoke('${OPERATOR_O}', 'last', '${reqId()}') as v;`,
      "FORGE_AUTH_LAST_OWNER");
    // With a second owner restored, self-revoke is refused on its own.
    await operatorGrant(db, OPERATOR_O, OPERATOR_O2, "owner", "out-of-band-id-confirmation", "test", "reinstated");
    await expectRpcError(db, OPERATOR_O,
      `select forge_platform_operator_revoke('${OPERATOR_O}', 'self', '${reqId()}') as v;`,
      "FORGE_AUTH_SELF_REVOKE");
  });

  it60("programmer grant/revoke: forge_is_programmer follows the grant, never the email", async () => {
    expect(await isProgrammer(db, PROGRAMMER_P)).toBe(true);
    expect(await isProgrammer(db, STRANGER_S)).toBe(false);
    // Jason's email alone grants nothing: OWNER_A has no grant row.
    expect(await isProgrammer(db, OWNER_A)).toBe(false);
    const revoked = await programmerRevoke(db, OPERATOR_O, PROGRAMMER_P, "offboarded");
    expect(revoked).toMatchObject({ is_active: false });
    expect(await isProgrammer(db, PROGRAMMER_P)).toBe(false);
    const granted = await programmerGrant(db, OPERATOR_O, PROGRAMMER_P, { read_only_diagnostics: true }, "rehired");
    expect(granted).toMatchObject({ is_active: true });
    expect(await isProgrammer(db, PROGRAMMER_P)).toBe(true);
    expect(await auditCount(db, null, "programmer.granted")).toBe(1);
  });

  it60("support context: create validates purpose/apps/expiry; use is grantee-only and audited; revoke ends it", async () => {
    await expectRpcError(db, OPERATOR_O,
      `select forge_support_context_create('${OWNER_A}', '${PROGRAMMER_P}', '', 'x', ARRAY['planner'], '[]'::jsonb, null, '${reqId()}') as v;`,
      "FORGE_AUTH_PURPOSE_REQUIRED");
    await expectRpcError(db, OPERATOR_O,
      `select forge_support_context_create('${OWNER_A}', '${PROGRAMMER_P}', 'x', 'x', ARRAY['rental'], '[]'::jsonb, null, '${reqId()}') as v;`,
      "FORGE_AUTH_UNKNOWN_APP");
    await expectRpcError(db, OPERATOR_O,
      `select forge_support_context_create('${OWNER_A}', '${STRANGER_S}', 'x', 'x', ARRAY['planner'], '[]'::jsonb, null, '${reqId()}') as v;`,
      "FORGE_AUTH_CONTEXT_GRANTEE");
    const ctx = await contextCreate(db, OPERATOR_O, OWNER_A, PROGRAMMER_P, "debug", "investigate", ["planner"], ["*"], null);
    expect(ctx.context_id).toMatch(/^forge_ctx_/);
    await expectRpcError(db, OPERATOR_O,
      `select forge_support_context_use('${ctx.context_id}', 'peek', '${reqId()}') as v;`,
      "FORGE_AUTH_CONTEXT_NOT_YOURS");
    const used = await contextUse(db, PROGRAMMER_P, ctx.context_id, "read the planner checklist");
    expect(used).toMatchObject({ allowed: true });
    await contextRevoke(db, OPERATOR_O, ctx.context_id, "done");
    await expectRpcError(db, PROGRAMMER_P,
      `select forge_support_context_use('${ctx.context_id}', 'again', '${reqId()}') as v;`,
      "FORGE_AUTH_CONTEXT_REVOKED");
  });

  it60("support context: longer than 8 hours is refused", async () => {
    const far = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
    await expectRpcError(db, OPERATOR_O,
      `select forge_support_context_create('${OWNER_A}', '${PROGRAMMER_P}', 'x', 'x', ARRAY['planner'], '[]'::jsonb, '${far}', '${reqId()}') as v;`,
      "FORGE_AUTH_CONTEXT_TOO_LONG");
  });

  it60("app role assign/revoke: owner assigns, admin cannot assign roles.manage roles, non-member fails", async () => {
    const assigned = await appRoleAssign(db, OWNER_A, OWNER_A, "designer", MEMBER_D, "designer_user", "onboarding");
    expect(assigned).toMatchObject({ role_key: "designer_user" });
    expect(await hasCap(db, MEMBER_D, OWNER_A, "designer", "designer.designs.create")).toBe(true);
    expect(await hasCap(db, MEMBER_D, OWNER_A, "designer", "designer.designs.delete")).toBe(false);
    await membershipRoleSet(db, OWNER_A, OWNER_A, MEMBER_D, "workspace_admin");
    await expectRpcError(db, MEMBER_D,
      `select forge_app_role_assign('${OWNER_A}', 'designer', '${MEMBER_E}', 'designer_admin', 'x', '${reqId()}') as v;`,
      "FORGE_AUTH_CEILING_EXCEEDED");
    await expectRpcError(db, OWNER_A,
      `select forge_app_role_assign('${OWNER_A}', 'designer', '${STRANGER_S}', 'designer_user', 'x', '${reqId()}') as v;`,
      "FORGE_AUTH_MEMBER_NOT_FOUND");
    await expectRpcError(db, OWNER_A,
      `select forge_app_role_assign('${OWNER_A}', 'planner', '${MEMBER_E}', 'planner', 'x', '${reqId()}') as v;`,
      "FORGE_AUTH_APP_NOT_CANONICAL");
    const revoked = await appRoleRevoke(db, OWNER_A, OWNER_A, "designer", MEMBER_D, "offboarded");
    expect(revoked).toMatchObject({ revoked: true });
    expect(await hasCap(db, MEMBER_D, OWNER_A, "designer", "designer.designs.create")).toBe(false);
  });

  it60("audit: append-only — direct INSERT/UPDATE/DELETE denied even for the owner; forge_audit_event is RPC-only", async () => {
    await expectRpcError(db, OWNER_A,
      `insert into forge_security_audit (actor_user_id, actor_class, action, entity_type, entity_id) values ('${OWNER_A}', 'owner', 'test', 'x', 'y');`,
      "42501");
    // Owner's own row, written by an RPC, still cannot be updated directly.
    await provision(db, OWNER_NEW, "Audit Workspace");
    await expectRpcError(db, OWNER_A,
      `update forge_security_audit set action = 'tampered' where action = 'workspace.created';`,
      "42501");
    await expectRpcError(db, OWNER_A,
      `delete from forge_security_audit where action = 'workspace.created';`,
      "42501");
    await expectRpcError(db, OWNER_A,
      `select forge_audit_event('${OWNER_A}', 'owner', '${OWNER_A}', null, 'test', 'x', 'y', null, null, 'x', '${reqId()}') as v;`,
      "42501");
    // RLS + ACL: anon has no table privilege at all (the SELECT
    // errors 42501); an authenticated stranger holds the SELECT
    // grant but the policy admits no rows.
    let anonCaught = null;
    try {
      await asRole(db, "anon", "00000000-0000-0000-0000-000000000000", `select count(*)::int as n from forge_security_audit;`);
    } catch (error) {
      anonCaught = error;
    }
    expect(anonCaught, "anon SELECT must be denied").not.toBeNull();
    expect(`${anonCaught.code ?? ""} ${String(anonCaught.message)}`).toContain("42501");
    const stranger = await asUser(db, STRANGER_S, `select count(*)::int as n from forge_security_audit;`);
    expect(stranger.rows[0].n).toBe(0);
  });

  it60("capability: owner bypass, co-owner bypass, member needs the role capability, entitlement gates everything", async () => {
    expect(await hasCap(db, OWNER_A, OWNER_A, "planner", "planner.work_packages.read")).toBe(true);
    expect(await hasCap(db, MEMBER_C, OWNER_A, "planner", "planner.work_packages.read")).toBe(true);
    // MEMBER_D (manager) holds no planner role yet.
    expect(await hasCap(db, MEMBER_D, OWNER_A, "planner", "planner.work_packages.read")).toBe(false);
    // After revoking the planner entitlement, even the owner loses the capability.
    await entitlementRevoke(db, OPERATOR_O, OWNER_A, "planner", "pilot ended");
    expect(await hasCap(db, OWNER_A, OWNER_A, "planner", "planner.work_packages.read")).toBe(false);
    expect(await hasCap(db, OWNER_A, OWNER_A, "designer", "designer.designs.read")).toBe(true);
  });

  it60("memberships view mirrors workspace_members; direct writes to new tables are denied", async () => {
    const { rows } = await db.query(`
      select user_id, role, status from forge_workspace_memberships
      where owner_id = '${OWNER_A}' order by user_id;`);
    expect(rows.map((r) => r.role).sort()).toEqual(["co_owner", "manager", "read_only"]);
    await expectRpcError(db, OWNER_A,
      `insert into forge_workspaces (owner_id, display_name, status, created_by, updated_by) values ('x', 'y', 'active', 'x', 'x');`,
      "42501");
    await expectRpcError(db, OWNER_A,
      `insert into forge_app_entitlements (owner_id, app_key, status) values ('${OWNER_A}', 'planner', 'active');`,
      "42501");
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
// in migration text can trip the migrations' control-character checks.
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

describe.skipIf(!HAS_REAL_PG)("saas auth pr1 migration: real-PostgreSQL subset", () => {
  let pgDir;
  let pgClient;
  let pgCfg;

  beforeAll(async () => {
    pgDir = mkdtempSync(join(tmpdir(), "auth1-realpg-"));
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
    // Production order, with the real Foundation PR A migration in the
    // chain (its tables are backfill sources for Auth PR 1).
    await pgClient.query(PREREQ_SQL);
    await pgClient.query(SEED_SQL);
    await pgClient.query(loadMigrationSql(PLANNER_ADMIN_MIGRATION));
    await pgClient.query(loadMigrationSql(RENTAL_ADMIN_MIGRATION));
    await pgClient.query(loadMigrationSql(SCHEDULING_ADMIN_MIGRATION));
    await pgClient.query(loadMigrationSql(FOUNDATION_A_MIGRATION));
    await pgClient.query(loadMigrationSql(THIS_MIGRATION));
    // The admin slices backfill planner/scheduler roles for owners
    // known at THEIR apply time; the Auth backfill creates the
    // forge_workspaces rows afterwards, so provision the starter
    // sets for the seeded owners here — mirroring the PGlite
    // setupDb. In production these rows already exist from the
    // admin slices' backfills over workspace_members.
    for (const owner of [OWNER_A, OWNER_B]) {
      await pgAsUser(pgClient, owner, `select forge_planner_roles_provision_starter_set('${owner}', 'seed-planner-${owner.slice(0, 8)}') as v;`);
      await pgAsUser(pgClient, owner, `select forge_scheduling_roles_provision_starter_set('${owner}', 'seed-scheduling-${owner.slice(0, 8)}') as v;`);
    }
    // Mirror setupDb: the migration seeds operator/programmer
    // registries EMPTY; the test fixture seeds them afterwards so
    // the platform-owner legs can run.
    await pgClient.query(`
      insert into forge_platform_operators (user_id, platform_role, granted_by, verification_method, verification_reference, grant_reason)
        values ('${OPERATOR_O}', 'owner', '${OPERATOR_O}', 'out-of-band-id-confirmation', 'test-seed', 'test seed'),
               ('${OPERATOR_O2}', 'owner', '${OPERATOR_O}', 'out-of-band-id-confirmation', 'test-seed', 'test seed'),
               ('${PROGRAMMER_P}', 'programmer', '${OPERATOR_O}', 'out-of-band-id-confirmation', 'test-seed', 'test seed');
      insert into forge_programmer_grants (user_id, scope, granted_by, grant_reason)
        values ('${PROGRAMMER_P}', '{"read_only_diagnostics": true}'::jsonb, '${OPERATOR_O}', 'test seed');
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

  it60("the full chain applies on real PG16: workspaces + entitlements backfilled for both owners", async () => {
    const { rows } = await pgClient.query(`
      select owner_id, status from forge_workspaces order by owner_id;`);
    expect(rows).toEqual([
      { owner_id: OWNER_A, status: "active" },
      { owner_id: OWNER_B, status: "active" },
    ]);
    const { rows: ent } = await pgClient.query(`
      select count(*)::int as n from forge_app_entitlements where status = 'active';`);
    expect(ent[0].n).toBe(8);
  });

  it60("two sessions provisioning the same workspace with the same request id: one row, one audit row, both get the same result", async () => {
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const provisionCall = (client) => pgAsUser(client, OWNER_NEW, `
        select forge_provision_workspace('Race Workspace', 'req_race_provision') as v;`);
      const results = await Promise.allSettled([provisionCall(clientA), provisionCall(clientB)]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled).toHaveLength(2);
      expect(fulfilled[0].value.rows[0].v).toEqual(fulfilled[1].value.rows[0].v);
      const { rows: ws } = await pgClient.query(`
        select count(*)::int as n from forge_workspaces where owner_id = '${OWNER_NEW}';`);
      expect(ws[0].n).toBe(1);
      const { rows: audit } = await pgClient.query(`
        select count(*)::int as n from forge_security_audit
        where target_owner_id = '${OWNER_NEW}' and action = 'workspace.created' and request_id = 'req_race_provision';`);
      expect(audit[0].n).toBe(1);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("two sessions inviting the same person with the same request id: one invitation, both get the same invitation id", async () => {
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const inviteCall = (client) => pgAsUser(client, OWNER_A, `
        select forge_workspace_invite_create('${OWNER_A}', 'invitee@example.test', 'planner', 'planner', 'req_race_invite') as v;`);
      const results = await Promise.allSettled([inviteCall(clientA), inviteCall(clientB)]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(
        fulfilled,
        `both invite calls must succeed; rejections: ${JSON.stringify(results.filter((r) => r.status === "rejected").map((r) => String(r.reason?.message ?? r.reason)))}`,
      ).toHaveLength(2);
      // Same invitation id on both sides; the token is returned once
      // only (see the PGlite replay leg), so it is not compared here.
      expect(fulfilled[0].value.rows[0].v.invitation_id).toBe(fulfilled[1].value.rows[0].v.invitation_id);
      const { rows: inv } = await pgClient.query(`
        select count(*)::int as n from forge_workspace_invitations
        where owner_id = '${OWNER_A}' and invited_email = 'invitee@example.test' and status = 'pending';`);
      expect(inv[0].n).toBe(1);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  // Fix round 1 regression legs — direct real-PostgreSQL proof, as the
  // verdict requires. Helpers mirror the PGlite rpc()/gate()/hasCap()
  // helpers but run through the real-PG client.
  async function pgRpc(client, uid, sql) {
    const { rows } = await pgAsUser(client, uid, sql);
    return rows[0].v;
  }
  const pgGate = (client, uid, ownerId, appKey, cap = null) =>
    pgRpc(client, uid, `select forge_check_app_access(${sqlStr(ownerId)}, ${sqlStr(appKey)}, ${sqlStr(cap)}) as v;`);
  async function expectPgError(client, uid, sql, code) {
    let caught = null;
    try {
      await pgAsUser(client, uid, sql);
    } catch (error) {
      caught = error;
    }
    expect(caught, `expected RPC to raise ${code}`).not.toBeNull();
    expect(`${caught.code ?? ""} ${String(caught.message)}`).toContain(code);
    return caught;
  }

  it60("gate (P1 fix round 1, real PG): a Designer-only invited member is denied Planner/Scheduler/Capture entry, passes Designer; revocation denies on the next request", async () => {
    // A fresh invitee, so this leg never collides with the invite
    // race leg above (different email, different user).
    await pgClient.query(`
      insert into auth.users (id, email, email_confirmed_at)
      values ('${MEMBER_F}', 'designer-only@example.test', now());`);
    const created = await pgRpc(pgClient, OWNER_A,
      `select forge_workspace_invite_create('${OWNER_A}', 'designer-only@example.test', 'designer', 'designer_user', '${reqId()}') as v;`);
    expect(created.invitation_id).toMatch(/^forge_inv_/);
    const accepted = await pgRpc(pgClient, MEMBER_F,
      `select forge_workspace_invite_accept(${sqlStr(created.token)}, '${reqId()}') as v;`);
    expect(accepted).toMatchObject({ owner_id: OWNER_A, app_key: "designer", role_key: "designer_user", membership: "active" });
    // The Designer entry passes; the other three deny.
    expect(await pgGate(pgClient, MEMBER_F, OWNER_A, "designer")).toMatchObject({ allowed: true });
    for (const app of ["planner", "scheduler", "capture"]) {
      expect(await pgGate(pgClient, MEMBER_F, OWNER_A, app)).toMatchObject({ allowed: false, reason: "APP_ROLE_REQUIRED" });
    }
    // Owner / co-owner still pass the no-capability entry.
    expect(await pgGate(pgClient, OWNER_A, OWNER_A, "planner")).toMatchObject({ allowed: true, via: "owner" });
    expect(await pgGate(pgClient, MEMBER_C, OWNER_A, "planner")).toMatchObject({ allowed: true, via: "membership" });
    // Revoking the assignment denies on the next request.
    const revoked = await pgRpc(pgClient, OWNER_A,
      `select forge_app_role_revoke('${OWNER_A}', 'designer', '${MEMBER_F}', 'offboarded', '${reqId()}') as v;`);
    expect(revoked).toMatchObject({ revoked: true });
    expect(await pgGate(pgClient, MEMBER_F, OWNER_A, "designer")).toMatchObject({ allowed: false, reason: "APP_ROLE_REQUIRED" });
    // Retiring the role row itself also denies: re-assign, retire the
    // role, re-check, then restore the role row.
    await pgRpc(pgClient, OWNER_A,
      `select forge_app_role_assign('${OWNER_A}', 'designer', '${MEMBER_F}', 'designer_user', 're-onboarded', '${reqId()}') as v;`);
    expect(await pgGate(pgClient, MEMBER_F, OWNER_A, "designer")).toMatchObject({ allowed: true });
    await pgClient.query(`
      update forge_app_roles set retired_at = now(), retired_by = '${OWNER_A}'
      where owner_id = '${OWNER_A}' and app_key = 'designer' and role_key = 'designer_user';`);
    expect(await pgGate(pgClient, MEMBER_F, OWNER_A, "designer")).toMatchObject({ allowed: false, reason: "APP_ROLE_REQUIRED" });
    await pgClient.query(`
      update forge_app_roles set retired_at = null, retired_by = null
      where owner_id = '${OWNER_A}' and app_key = 'designer' and role_key = 'designer_user';`);
    // Entitlement still gates the owner on the no-capability entry.
    await pgRpc(pgClient, OPERATOR_O,
      `select forge_app_entitlement_revoke('${OWNER_A}', 'planner', 'pilot ended', '${reqId()}') as v;`);
    expect(await pgGate(pgClient, OWNER_A, OWNER_A, "planner")).toMatchObject({ allowed: false, reason: "ENTITLEMENT_NOT_ACTIVE" });
    await pgRpc(pgClient, OPERATOR_O,
      `select forge_app_entitlement_grant('${OWNER_A}', 'planner', 'owner_manual', null, null, 'pilot restored', '${reqId()}') as v;`);
    expect(await pgGate(pgClient, OWNER_A, OWNER_A, "planner")).toMatchObject({ allowed: true });
  });

  it60("resolve_effective_owner_id (P2 fix round 1, real PG): a caller-supplied actor that is not the authenticated user is refused", async () => {
    // MEMBER_D is seeded with an active membership in OWNER_A's
    // workspace, so this leg depends on no earlier test.
    expect(await pgRpc(pgClient, MEMBER_D, `select resolve_effective_owner_id() as v;`)).toBe(OWNER_A);
    expect(await pgRpc(pgClient, MEMBER_D, `select resolve_effective_owner_id('${MEMBER_D}') as v;`)).toBe(OWNER_A);
    await expectPgError(pgClient, MEMBER_D, `select resolve_effective_owner_id('${OWNER_A}') as v;`, "42501");
    await expectPgError(pgClient, MEMBER_D, `select resolve_effective_owner_id('${OWNER_B}') as v;`, "42501");
  });
});
