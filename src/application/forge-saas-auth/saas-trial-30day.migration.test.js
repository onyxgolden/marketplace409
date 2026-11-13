// SaaS 30-day trial — migration/integration proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) on top of
// the three admin slices, Foundation PR A, the Planner rung1 + slice5
// migrations, the Capture library migration, the #796 planning-steps
// migration, Foundation PR B, and Auth PR 1 — and proves:
//   - The three new tables exist with RLS + FORCE RLS; grants /
//     availability have NO grant to authenticated at all; the audit
//     table is SELECT-only for authenticated.
//   - Availability seed: Planner enabled, Capture disabled with the
//     PR-4 reason.
//   - Initial Planner grant: one active/owner_trial row, server
//     starts_at, ends_at exactly +30 days (720h / 2,592,000s),
//     grant row + audit receipt + idempotency receipt match.
//   - Boundary: valid just before ends_at, denied at/after, via the
//     live predicate — no worker run.
//   - Gate: an expired trial returns the distinct TRIAL_ENDED reason
//     (worker-run or not); a pending entitlement returns
//     ENTITLEMENT_NOT_ACTIVE.
//   - Expiry worker: idempotent re-run, system audit receipt, never
//     expires a converted owner_manual row or a newer renewal window.
//   - Repeat-initial refusal (after expiry, after conversion).
//   - Renewal chain + serialization: same-request replay,
//     changed-payload conflict, unexpired cannot renew, converted
//     cannot renew, already-renewed cannot renew again.
//   - Conversion (active + expired): one version increment, history
//     + last-trial reference kept, data preserved.
//   - Generic-grant bypass refusal: the generic grant path cannot
//     overwrite an owner_trial row (FORGE_AUTH_TRIAL_MUST_CONVERT).
//   - Eligibility denials: active manual cannot downgrade, pending /
//     suspended workspace denies, invalid app / reason / actor denies,
//     Capture grant refused while disabled.
//   - Owner-only authorization: workspace owner/admin/member/support/
//     programmer/anon denied; the actor is always auth.uid().
//   - App separation: a Planner trial does not entitle Capture;
//     Designer/Scheduler are not trialable.
//   - Cross-workspace denial: a guessed owner_id gets nothing.
//   - App role still required: a member with no planner role is
//     denied the gate even with an active trial; a member WITH the
//     planner role passes while the trial is live and denies after.
//   - Direct data-plane denial: authenticated SELECT/INSERT on
//     Planner + Capture tables and storage.objects deny without an
//     active entitlement and after expiry; allow during the trial.
//   - Write-path triggers: a SECURITY DEFINER write (next package
//     number) raises FORGE_TRIAL_ENTITLEMENT_REQUIRED without an
//     entitlement and succeeds with one.
//   - Read-RPC guards: blocker counts (service_role) and the planning
//     checklist raise without an entitlement.
//   - Audit immutability: no direct INSERT/UPDATE/DELETE even for the
//     owner; SELECT visible to platform owner + support only.
//   - Policy sweep: every policy on the Planner/Capture tables
//     carries the entitlement predicate; reference tables keep
//     using(true); no-policy tables are enumerated.
//   - Trigger sweep: every owner_id table carries its trigger.
//   - Re-apply is idempotent.
//   - Owner-console read RPCs: overview + workspace list, owner-only,
//     non-disclosing.
//   - Fix-round-1 P2: a non-owner replaying a stored trial receipt
//     (grant/renew/convert) is denied PLATFORM_OWNER_ONLY; the
//     platform owner can still replay it (authorized replay
//     unchanged). Real-PG leg repeats the grant replay denial.
//   - Fix-round-1 P1 (real-PG only): deterministic two-session
//     generic-vs-trial races for BOTH lock orderings, with a blocker
//     session holding the shared workspace/app lock until both RPCs
//     are waiting on it — generic-first wins with the trial refusing
//     NOT_PENDING, trial-first wins with the generic refusing
//     TRIAL_MUST_CONVERT; final entitlement + grant/audit/receipt
//     counts consistent in both cases, and the generic grant never
//     overwrites an owner_trial row.
//
// Roles, the auth.uid() stub, auth.users, workspace_members, and the
// has_workspace_access() copy mirror production. The extensions.digest
// stub delegates to sha256() (every call site uses sha256). The
// storage schema is stubbed (buckets/objects + foldername) because
// the Capture library migration only creates policies on it.

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

// Trial workspace (OWNER_A) + control workspaces. MEMBER_C is OWNER_A's
// co-owner; MEMBER_D is OWNER_A's member holding the Planner role.
// OPERATOR_O is the platform owner; SUPPORT_S is platform support;
// PROGRAMMER_P holds the programmer role (never trial-audit readable).
const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const OWNER_C = "33333333-3333-4333-8333-333333333333";
const OWNER_D = "44444444-4444-4444-8444-444444444444";
const OWNER_E = "55555555-5555-4555-8555-555555555555";
// Fix-round-1 race/replay workspaces (real-PG leg only): F and G are
// the two lock-ordering race fixtures, H the non-owner replay fixture.
const OWNER_F = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OWNER_G = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OWNER_H = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const MEMBER_C = "66666666-6666-4666-8666-666666666666";
const MEMBER_D = "77777777-7777-4777-8777-777777777777";
const MEMBER_N = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STRANGER_S = "88888888-8888-4888-8888-888888888888";
const OPERATOR_O = "99999999-9999-4999-8999-999999999999";
const SUPPORT_S = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROGRAMMER_P = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const PLANNER_ADMIN_MIGRATION = "20261110000000_forge_planner_admin_permissions_slice1.sql";
const RENTAL_ADMIN_MIGRATION = "20261110010000_rental_admin_roles_slice1.sql";
const SCHEDULING_ADMIN_MIGRATION = "20261110080000_forge_scheduling_admin_permissions_slice1.sql";
const SCHEDULING_ADMIN_REPAIR_MIGRATION = "20261111010000_scheduling_admin_permissions_authority_strip_repair.sql";
const FOUNDATION_A_MIGRATION = "20261112010000_forge_shared_hierarchy_foundation.sql";
// Work-management chain in production timestamp order (rung1 through
// slice8 + the deletion fixes). The trial migration rewrites policies
// and adds triggers on tables from every one of these, so the test
// chain must create them all for real — no stubs.
const WORK_CHAIN = [
  "20261002120000_forge_work_management_rung1.sql",
  "20261002210000_forge_work_management_rung2.sql",
  "20261003120000_forge_work_management_rung3.sql",
  "20261004010000_forge_work_management_rung4.sql",
  "20261005000000_forge_work_management_rung5.sql",
  "20261005000100_forge_work_management_rung5_fixes.sql",
  "20261005000200_forge_work_management_rung5_revision_guard.sql",
  "20261005000300_forge_work_management_rung5_revision_guard_v2.sql",
  "20261008010000_forge_work_packages_property_id.sql",
  "20261008020000_forge_work_package_planned_cost.sql",
  "20261008030000_forge_work_package_deletions.sql",
  "20261104000000_forge_work_package_takeoff_slice1.sql",
  "20261105000000_forge_work_package_progress_slice2.sql",
  "20261107000000_forge_work_package_permit_annotations_slice3.sql",
  "20261107010000_forge_work_package_craft_assignments_slice4.sql",
  "20261107020000_forge_work_package_work_steps_slice5.sql",
  "20261107030000_forge_work_package_manpower_curve_slice6.sql",
  "20261107040000_forge_work_package_ifa_ifc_slice7.sql",
  "20261109000000_work_package_import_source_tracking.sql",
  "20261109010000_forge_work_package_change_orders_slice8.sql",
  "20261110040000_forge_work_package_deletion_blocker_fix.sql",
  "20261110050000_forge_work_package_mode_selector.sql",
  "20261110070000_forge_work_package_delete_retired_cleanup.sql",
];
const CAPTURE_LIBRARY_MIGRATION = "20260922040007_capture_library.sql";
const PLANNING_STEPS_MIGRATION = "20261112000000_forge_work_planning_process_steps.sql";
const FOUNDATION_B_MIGRATION = "20261113000000_forge_work_package_project_link.sql";
const AUTH_MIGRATION = "20261113010000_saas_auth_pr1.sql";
const THIS_MIGRATION = "20261113030000_saas_trial_30day.sql";

// Full chain in production timestamp order. Shared by the PGlite and
// real-PostgreSQL legs (the real-PG leg is authoritative; PGlite may
// need a documented fallback if a migration uses something it lacks).
async function applyChain(query) {
  for (const name of WORK_CHAIN) await query(loadMigrationSql(name));
  await query(loadMigrationSql(PLANNER_ADMIN_MIGRATION));
  await query(loadMigrationSql(RENTAL_ADMIN_MIGRATION));
  await query(loadMigrationSql(SCHEDULING_ADMIN_MIGRATION));
  await query(loadMigrationSql(SCHEDULING_ADMIN_REPAIR_MIGRATION));
  await query(loadMigrationSql(CAPTURE_LIBRARY_MIGRATION));
  await query(loadMigrationSql(PLANNING_STEPS_MIGRATION));
  await query(loadMigrationSql(FOUNDATION_A_MIGRATION));
  await query(loadMigrationSql(FOUNDATION_B_MIGRATION));
  await query(loadMigrationSql(AUTH_MIGRATION));
  await query(loadMigrationSql(THIS_MIGRATION));
}

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
  -- migration re-policies (its policies reference only owner_id).
  create table rental_tenants (
    owner_id text not null, id text not null, primary key (owner_id, id));
  create table rental_maintenance_requests (
    owner_id text not null, id text not null, primary key (owner_id, id));
  create table rental_maintenance_work_orders (
    owner_id text not null, id text not null, primary key (owner_id, id));
  -- Backfill source tables for Auth PR 1 (only owner_id is read).
  -- forge_work_packages + capture_library are NOT stubbed here: the
  -- rung1 + capture-library migrations create them for real below.
  create table designer_projects (owner_id text not null, id text not null, primary key (owner_id, id));
  create table rental_leases (owner_id text not null, id text not null, primary key (owner_id, id));
  -- Storage schema stub: the Capture library migration inserts into
  -- storage.buckets and creates policies on storage.objects; in
  -- Supabase those tables exist. foldername mirrors the real function.
  create schema storage;
  create table storage.buckets (
    id text not null primary key, name text, public boolean,
    file_size_limit integer, allowed_mime_types text[]);
  create table storage.objects (
    id uuid not null primary key default gen_random_uuid(),
    bucket_id text, name text, owner_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_accessed_at timestamptz, metadata jsonb);
  alter table storage.objects enable row level security;
  -- Mirror Supabase's storage grants: authenticated can use the schema
  -- and read/write objects (policies still gate every row); without
  -- these the stub denies with "permission denied for schema storage"
  -- before RLS is even evaluated.
  grant usage on schema storage to authenticated, service_role;
  grant select, insert, update, delete on storage.objects to authenticated;
  grant select on storage.buckets to authenticated;
  create or replace function storage.foldername(name text)
  returns text[] language sql immutable as $$
    select string_to_array(name, '/')
  $$;
`;

// Seeded BEFORE the migrations so their backfills run against
// live-shaped data, as in production. Workspaces + entitlements are
// seeded AFTER the chain (postChainSeed): the Auth backfill reads the
// (empty-at-apply-time) forge_work_packages / capture_library tables,
// so no workspaces exist until the fixture creates them explicitly.
const SEED_SQL = `
  insert into auth.users (id, email, email_confirmed_at) values
    ('${OWNER_A}', 'owner-a@example.test', now()),
    ('${OWNER_B}', 'owner-b@example.test', now()),
    ('${OWNER_C}', 'owner-c@example.test', now()),
    ('${OWNER_D}', 'owner-d@example.test', now()),
    ('${OWNER_E}', 'owner-e@example.test', now()),
    ('${MEMBER_C}', 'coowner@example.test', now()),
    ('${MEMBER_D}', 'planner-member@example.test', now()),
    ('${MEMBER_N}', 'no-role-member@example.test', now()),
    ('${STRANGER_S}', 'stranger@example.test', now()),
    ('${OPERATOR_O}', 'operator@example.test', now()),
    ('${SUPPORT_S}', 'support@example.test', now()),
    ('${PROGRAMMER_P}', 'programmer@example.test', now());
  insert into workspace_members (owner_id, id, member_user_id, status, role)
    values ('${OWNER_A}', 'workspace_member_c', '${MEMBER_C}', 'active', 'co_owner'),
           ('${OWNER_A}', 'workspace_member_d', '${MEMBER_D}', 'active', 'read_only'),
           ('${OWNER_A}', 'workspace_member_n', '${MEMBER_N}', 'active', 'read_only');
`;

async function postChainSeed(db, query) {
  // Workspaces: A = trial workspace (active), B = control (active, all
  // manual), C = pending, D = suspended, E = second trial workspace.
  // NOTE: the Auth migration backfills one ACTIVE workspace + ACTIVE
  // owner_manual entitlements for every pre-existing owner (OWNER_A here,
  // from the seeded workspace_members row), so these inserts UPSERT: the
  // fixture state (pending planner/capture for A, display names) wins.
  await query(db, `
    insert into forge_workspaces (owner_id, display_name, status, created_by, updated_by) values
      ('${OWNER_A}', 'Trial Workspace A', 'active', '${OWNER_A}', '${OWNER_A}'),
      ('${OWNER_B}', 'Control Workspace B', 'active', '${OWNER_B}', '${OWNER_B}'),
      ('${OWNER_C}', 'Pending Workspace C', 'pending', '${OWNER_C}', '${OWNER_C}'),
      ('${OWNER_D}', 'Suspended Workspace D', 'suspended', '${OWNER_D}', '${OWNER_D}'),
      ('${OWNER_E}', 'Trial Workspace E', 'active', '${OWNER_E}', '${OWNER_E}')
    on conflict (owner_id) do update set
      display_name = excluded.display_name, status = excluded.status,
      created_by = excluded.created_by, updated_by = excluded.updated_by;
  `);
  await query(db, `
    insert into forge_app_entitlements (owner_id, app_key, status, source, granted_by) values
      ('${OWNER_A}', 'planner', 'pending', null, null),
      ('${OWNER_A}', 'capture', 'pending', null, null),
      ('${OWNER_A}', 'designer', 'active', 'owner_manual', '${OWNER_A}'),
      ('${OWNER_A}', 'scheduler', 'active', 'owner_manual', '${OWNER_A}'),
      ('${OWNER_B}', 'designer', 'active', 'owner_manual', '${OWNER_B}'),
      ('${OWNER_B}', 'scheduler', 'active', 'owner_manual', '${OWNER_B}'),
      ('${OWNER_B}', 'planner', 'active', 'owner_manual', '${OWNER_B}'),
      ('${OWNER_B}', 'capture', 'active', 'owner_manual', '${OWNER_B}'),
      ('${OWNER_C}', 'planner', 'pending', null, null),
      ('${OWNER_D}', 'planner', 'pending', null, null),
      ('${OWNER_E}', 'planner', 'pending', null, null)
    on conflict (owner_id, app_key) do update set
      status = excluded.status, source = excluded.source, granted_by = excluded.granted_by;
  `);
  await query(db, `
    -- Platform operators + programmer grant are seeded by direct insert
    -- here (the migration seeds them EMPTY by design; bootstrap is a
    -- reviewed migration/controlled operation in production).
    insert into forge_platform_operators (user_id, platform_role, granted_by, verification_method, verification_reference, grant_reason)
      values ('${OPERATOR_O}', 'owner', '${OPERATOR_O}', 'out-of-band-id-confirmation', 'test-seed', 'test seed'),
             ('${SUPPORT_S}', 'support', '${OPERATOR_O}', 'out-of-band-id-confirmation', 'test-seed', 'test seed'),
             ('${PROGRAMMER_P}', 'programmer', '${OPERATOR_O}', 'out-of-band-id-confirmation', 'test-seed', 'test seed');
  `);
  await query(db, `
    insert into forge_programmer_grants (user_id, scope, granted_by, grant_reason)
      values ('${PROGRAMMER_P}', '{"read_only_diagnostics": true}'::jsonb, '${OPERATOR_O}', 'test seed');
  `);
  // Planner starter roles for OWNER_A (post-#796 provision carries
  // planner.planning_steps.read on the planner role), then give
  // MEMBER_D the planner role for the app-role gate legs. The assign
  // RPC takes the provisioned role's id (forge_pr_<uuid>), not the
  // role_key, so look it up first.
  await asUser(db, OWNER_A, `select forge_planner_roles_provision_starter_set('${OWNER_A}', 'seed-planner-${OWNER_A.slice(0, 8)}') as v;`, query);
  const { rows: plannerRoleRows } = await query(db, `select id from forge_planner_roles where owner_id = '${OWNER_A}' and role_key = 'planner' and retired_at is null;`);
  const plannerRoleId = plannerRoleRows[0]?.id;
  if (!plannerRoleId) throw new Error("planner starter role was not provisioned for the trial workspace");
  await asUser(db, OWNER_A, `select forge_planner_role_assign('${OWNER_A}', '${MEMBER_D}', '${plannerRoleId}', 'test seed', 'seed-assign-${MEMBER_D.slice(0, 8)}') as v;`, query);
}

async function setupDb() {
  const db = new PGlite();
  await db.exec(PREREQ_SQL);
  await db.exec(SEED_SQL);
  await applyChain((sql) => db.exec(sql));
  await postChainSeed(db, (target, sql) => target.query(sql));
  return db;
}

async function asRole(db, role, uid, sql, queryFn) {
  const q = queryFn ?? ((target, s) => target.query(s));
  // Two single statements: PGlite's query() rejects multi-statement
  // strings ("cannot insert multiple commands into a prepared
  // statement"); node-postgres accepts both forms.
  await q(db, `set role ${role};`);
  await q(db, `set app.test_uid = '${uid}';`);
  try {
    return await q(db, sql);
  } finally {
    await q(db, `reset role;`);
  }
}

async function asUser(db, uid, sql, queryFn) {
  return asRole(db, "authenticated", uid, sql, queryFn);
}

async function asServiceRole(db, sql, queryFn) {
  const q = queryFn ?? ((target, s) => target.query(s));
  await q(db, `set role service_role;`);
  try {
    return await q(db, sql);
  } finally {
    await q(db, `reset role;`);
  }
}

function sqlStr(value) {
  return value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`;
}

function reqId() {
  return `req_${randomUUID().replace(/-/g, "")}`;
}

async function expectRpcError(db, uid, sql, code, queryFn) {
  let caught = null;
  try {
    await asUser(db, uid, sql, queryFn);
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected RPC to raise ${code}`).not.toBeNull();
  const haystack = `${caught.code ?? ""} ${String(caught.message)}`;
  expect(haystack).toContain(code);
  return caught;
}

async function expectRoleError(db, role, uid, sql, code, queryFn) {
  let caught = null;
  try {
    await asRole(db, role, uid, sql, queryFn);
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected call to raise ${code}`).not.toBeNull();
  const haystack = `${caught.code ?? ""} ${String(caught.message)}`;
  expect(haystack).toContain(code);
  return caught;
}

async function rpc(db, uid, sql, queryFn) {
  const { rows } = await asUser(db, uid, sql, queryFn);
  return rows[0].v;
}

const gate = (db, uid, ownerId, appKey, cap = null, queryFn) =>
  rpc(db, uid, `select forge_check_app_access(${sqlStr(ownerId)}, ${sqlStr(appKey)}, ${sqlStr(cap)}) as v;`, queryFn);
const hasEntitlement = (db, uid, ownerId, appKey, queryFn) =>
  rpc(db, uid, `select forge_has_app_entitlement(${sqlStr(ownerId)}, ${sqlStr(appKey)}) as v;`, queryFn);
const trialGrant = (db, uid, ownerId, appKey, reason, req = reqId(), queryFn) =>
  rpc(db, uid, `select forge_app_trial_grant(${sqlStr(ownerId)}, ${sqlStr(appKey)}, ${sqlStr(reason)}, ${sqlStr(req)}) as v;`, queryFn);
const trialRenew = (db, uid, ownerId, appKey, reason, req = reqId(), queryFn) =>
  rpc(db, uid, `select forge_app_trial_renew(${sqlStr(ownerId)}, ${sqlStr(appKey)}, ${sqlStr(reason)}, ${sqlStr(req)}) as v;`, queryFn);
const trialConvert = (db, uid, ownerId, appKey, reason, req = reqId(), queryFn) =>
  rpc(db, uid, `select forge_app_trial_convert_to_paid(${sqlStr(ownerId)}, ${sqlStr(appKey)}, ${sqlStr(reason)}, ${sqlStr(req)}) as v;`, queryFn);
const trialExpire = (db, queryFn) =>
  asServiceRole(db, `select forge_app_trial_expire_due() as v;`, queryFn).then(({ rows }) => rows[0].v);
// Move a trial's window into the past WITHOUT breaking the Auth CHECKs:
// the entitlement requires starts_at < ends_at, the grant rows require
// exactly 30 days, and renew/convert require the latest grant window to
// match the entitlement window — so both move together. (A bare
// `ends_at = now() - interval '1 hour'` violates the starts_at < ends_at
// CHECK, since the grant's starts_at is ~now.)
const expireTrialWindow = async (db, ownerId, appKey, queryFn) => {
  const q = queryFn ?? ((target, s) => target.query(s));
  await q(db, `update forge_app_entitlements set starts_at = now() - interval '31 days', ends_at = now() - interval '1 day' where owner_id = '${ownerId}' and app_key = '${appKey}';`);
  // Copy the entitlement's window into the grants (do NOT re-evaluate
  // now(): two statements would get microsecond-different timestamps
  // and renew/convert's latest-grant-matches-entitlement check would
  // raise FORGE_AUTH_TRIAL_STATE_MISMATCH).
  await q(db, `update forge_app_trial_grants g set starts_at = e.starts_at, ends_at = e.ends_at from forge_app_entitlements e where e.owner_id = g.owner_id and e.app_key = g.app_key and g.owner_id = '${ownerId}' and g.app_key = '${appKey}';`);
};
const trialOverview = (db, uid, ownerId, queryFn) =>
  rpc(db, uid, `select forge_platform_trial_overview(${sqlStr(ownerId)}) as v;`, queryFn);
const trialWorkspaceList = (db, uid, search, queryFn) =>
  rpc(db, uid, `select forge_platform_trial_workspace_list(${sqlStr(search)}) as v;`, queryFn);
const genericGrant = (db, uid, ownerId, appKey, source, reason, req = reqId(), queryFn) =>
  rpc(db, uid, `select forge_app_entitlement_grant(${sqlStr(ownerId)}, ${sqlStr(appKey)}, ${sqlStr(source)}, null, null, ${sqlStr(reason)}, ${sqlStr(req)}) as v;`, queryFn);

describe("saas trial 30day migration (PGlite)", () => {
  let db;
  beforeEach(async () => {
    db = await setupDb();
  });
  afterEach(async () => {
    await db?.close();
  });

  it60("new tables exist with RLS + FORCE RLS; grants/availability have no authenticated grant; audit is SELECT-only", async () => {
    const tables = ["forge_app_trial_grants", "forge_app_trial_audit", "forge_app_trial_availability"];
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
    }
    // Grants + availability are internal (SECURITY DEFINER RPCs read
    // them): no grant to authenticated at all, not even SELECT.
    const noAuth = rows.filter((r) => r.name !== "forge_app_trial_audit");
    for (const row of noAuth) {
      expect(row.acl, `${row.name} acl ${row.acl}`).not.toContain("authenticated");
    }
    // Audit is SELECT-only for authenticated.
    const audit = rows.find((r) => r.name === "forge_app_trial_audit");
    expect(audit.acl, `audit acl ${audit.acl}`).toContain("authenticated=r/");
    // last_trial_grant_id exists on the entitlements table.
    const { rows: colRows } = await db.query(`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'forge_app_entitlements'
         and column_name = 'last_trial_grant_id';`);
    expect(colRows).toHaveLength(1);
  });

  it60("trial RPCs are EXECUTE-granted to authenticated only; expire worker to service_role only", async () => {
    const expected = [
      "forge_app_trial_grant", "forge_app_trial_renew", "forge_app_trial_convert_to_paid",
      "forge_platform_trial_overview", "forge_platform_trial_workspace_list",
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
    const { rows: workerRows } = await db.query(`
      select proacl::text as acl from pg_proc
       where proname = 'forge_app_trial_expire_due' and pronamespace = 'public'::regnamespace;`);
    expect(workerRows).toHaveLength(1);
    expect(workerRows[0].acl).toBe("{postgres=X/postgres,service_role=X/postgres}");
    // The worker is NOT callable by authenticated.
    await expectRoleError(db, "authenticated", OPERATOR_O,
      `select forge_app_trial_expire_due() as v;`, "42501");
    // The trigger functions exist (default proacl, like the existing
    // trigger functions — revoking EXECUTE would break the triggers).
    const { rows: trigRows } = await db.query(`
      select proname from pg_proc where proname in
        ('forge_trial_require_planner_entitlement', 'forge_trial_require_capture_entitlement');`);
    expect(trigRows).toHaveLength(2);
  });

  it60("availability seed: Planner enabled, Capture disabled with the PR-4 reason", async () => {
    const { rows } = await db.query(`select app_key, enabled, reason from forge_app_trial_availability order by app_key;`);
    expect(rows).toEqual([
      { app_key: "capture", enabled: false, reason: expect.stringContaining("PR 4") },
      { app_key: "planner", enabled: true, reason: expect.stringContaining("Planner trials enabled") },
    ]);
  });

  it60("initial Planner grant: active/owner_trial, server window exactly 30 days, grant + audit + receipt match", async () => {
    const before = Date.now();
    const result = await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "pilot for workspace A");
    const after = Date.now();
    expect(result).toMatchObject({ owner_id: OWNER_A, app_key: "planner", status: "active", source: "owner_trial" });
    expect(result.grant_id).toMatch(/^[0-9a-f-]{36}$/);
    const starts = new Date(result.starts_at).getTime();
    const ends = new Date(result.ends_at).getTime();
    expect(starts).toBeGreaterThanOrEqual(before - 5000);
    expect(starts).toBeLessThanOrEqual(after + 5000);
    expect(ends - starts).toBe(30 * 24 * 60 * 60 * 1000);
    // The entitlement row: active/owner_trial, version bumped once.
    const { rows: ent } = await db.query(`
      select status, source, version, granted_by, grant_reason, last_trial_grant_id
        from forge_app_entitlements where owner_id = '${OWNER_A}' and app_key = 'planner';`);
    expect(ent).toHaveLength(1);
    expect(ent[0]).toMatchObject({ status: "active", source: "owner_trial", version: 2, granted_by: OPERATOR_O, grant_reason: "pilot for workspace A" });
    expect(ent[0].last_trial_grant_id).toBe(result.grant_id);
    // The grant row: exactly 30 days by the DB clock (epoch 2,592,000s).
    const { rows: grants } = await db.query(`
      select grant_kind, extract(epoch from (ends_at - starts_at))::int as seconds,
             granted_by, grant_reason, renewal_of, request_id
        from forge_app_trial_grants where owner_id = '${OWNER_A}' and app_key = 'planner';`);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ grant_kind: "initial", seconds: 2592000, granted_by: OPERATOR_O, grant_reason: "pilot for workspace A", renewal_of: null });
    expect(grants[0].request_id).toMatch(/^req_/);
    // The audit receipt: one 'granted' row, platform_owner actor,
    // before pending / after active + owner_trial.
    const { rows: audit } = await db.query(`
      select event, actor_id, actor_class, reason, before_state, after_state
        from forge_app_trial_audit where owner_id = '${OWNER_A}' and app_key = 'planner';`);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ event: "granted", actor_id: OPERATOR_O, actor_class: "platform_owner", reason: "pilot for workspace A" });
    expect(audit[0].before_state).toMatchObject({ status: "pending" });
    expect(audit[0].after_state).toMatchObject({ status: "active", source: "owner_trial", version: 2 });
    // The idempotency receipt exists with action trial_grant.
    const { rows: receipts } = await db.query(`
      select action from forge_auth_idempotency_receipts where request_id = '${grants[0].request_id}';`);
    expect(receipts).toEqual([{ action: "trial_grant" }]);
  });

  it60("boundary: valid just before ends_at, denied at and after ends_at — no worker run", async () => {
    await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "boundary check");
    expect(await hasEntitlement(db, OWNER_A, OWNER_A, "planner")).toBe(true);
    // Just before the end: still valid.
    await db.query(`update forge_app_entitlements set ends_at = now() + interval '1 hour' where owner_id = '${OWNER_A}' and app_key = 'planner';`);
    expect(await hasEntitlement(db, OWNER_A, OWNER_A, "planner")).toBe(true);
    // At the end: denied (the check's now() is after the set's now()).
    await db.query(`update forge_app_entitlements set ends_at = now() where owner_id = '${OWNER_A}' and app_key = 'planner';`);
    expect(await hasEntitlement(db, OWNER_A, OWNER_A, "planner")).toBe(false);
    // After the end: denied.
    await expireTrialWindow(db, OWNER_A, "planner");
    expect(await hasEntitlement(db, OWNER_A, OWNER_A, "planner")).toBe(false);
    // The stored status is still 'active' — the worker has not run —
    // yet the gate already denies. That is the live predicate.
    const { rows } = await db.query(`select status from forge_app_entitlements where owner_id = '${OWNER_A}' and app_key = 'planner';`);
    expect(rows[0].status).toBe("active");
  });

  it60("gate: expired trial returns TRIAL_ENDED (worker-run or not); pending returns ENTITLEMENT_NOT_ACTIVE", async () => {
    // Pending (never granted): generic reason.
    expect(await gate(db, OWNER_A, OWNER_A, "planner")).toMatchObject({ allowed: false, reason: "ENTITLEMENT_NOT_ACTIVE" });
    await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "gate check");
    expect(await gate(db, OWNER_A, OWNER_A, "planner")).toMatchObject({ allowed: true });
    // Expire the window without running the worker: TRIAL_ENDED.
    await expireTrialWindow(db, OWNER_A, "planner");
    expect(await gate(db, OWNER_A, OWNER_A, "planner")).toMatchObject({ allowed: false, reason: "TRIAL_ENDED" });
    // After the worker flips the stored status: still TRIAL_ENDED.
    const expired = await trialExpire(db);
    expect(expired.expired_count).toBe(1);
    expect(await gate(db, OWNER_A, OWNER_A, "planner")).toMatchObject({ allowed: false, reason: "TRIAL_ENDED" });
    // A different app that was never trialed keeps the generic reason.
    expect(await gate(db, OWNER_A, OWNER_A, "capture")).toMatchObject({ allowed: false, reason: "ENTITLEMENT_NOT_ACTIVE" });
  });

  it60("expiry worker: idempotent re-run, system audit receipt, never expires converted or renewed rows", async () => {
    await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "worker check");
    await trialGrant(db, OPERATOR_O, OWNER_E, "planner", "worker check E");
    // Nothing due yet.
    expect(await trialExpire(db)).toMatchObject({ expired_count: 0 });
    // Make A's window due; E stays live.
    await expireTrialWindow(db, OWNER_A, "planner");
    const first = await trialExpire(db);
    expect(first).toMatchObject({ expired_count: 1 });
    expect(first.expired[0]).toMatchObject({ owner_id: OWNER_A, app_key: "planner" });
    const { rows: entA } = await db.query(`select status, version from forge_app_entitlements where owner_id = '${OWNER_A}' and app_key = 'planner';`);
    expect(entA[0]).toMatchObject({ status: "expired", version: 3 });
    // Idempotent: the second run finds nothing due.
    expect(await trialExpire(db)).toMatchObject({ expired_count: 0 });
    // One system audit receipt, actor null / class system.
    const { rows: audit } = await db.query(`
      select event, actor_id, actor_class from forge_app_trial_audit
       where owner_id = '${OWNER_A}' and app_key = 'planner' and event = 'expired';`);
    expect(audit).toEqual([{ event: "expired", actor_id: null, actor_class: "system" }]);
    // A converted row is never expired: convert E, force its ends_at
    // into the past, run the worker — E stays active owner_manual.
    await trialConvert(db, OPERATOR_O, OWNER_E, "planner", "convert E before worker");
    await expireTrialWindow(db, OWNER_E, "planner");
    expect(await trialExpire(db)).toMatchObject({ expired_count: 0 });
    const { rows: entE } = await db.query(`select status, source from forge_app_entitlements where owner_id = '${OWNER_E}' and app_key = 'planner';`);
    expect(entE[0]).toEqual({ status: "active", source: "owner_manual" });
  });

  it60("repeat-initial refusal: after expiry and after conversion", async () => {
    await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "first trial");
    await expireTrialWindow(db, OWNER_A, "planner");
    await trialExpire(db);
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_trial_grant('${OWNER_A}', 'planner', 'second trial', '${reqId()}') as v;`,
      "FORGE_AUTH_TRIAL_ALREADY_GRANTED");
    // After conversion: still refused (a converted trial is paid
    // access, not a new free trial).
    await trialConvert(db, OPERATOR_O, OWNER_A, "planner", "convert then re-grant");
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_trial_grant('${OWNER_A}', 'planner', 'third trial', '${reqId()}') as v;`,
      "FORGE_AUTH_TRIAL_ALREADY_GRANTED");
    // Renewal is the only path to a further window — and conversion
    // closes even that: a converted row cannot be renewed as a trial.
    await expireTrialWindow(db, OWNER_A, "planner");
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_trial_renew('${OWNER_A}', 'planner', 'renew after convert', '${reqId()}') as v;`,
      "FORGE_AUTH_TRIAL_NOT_ACTIVE");
  });

  it60("renewal chain: only after expiry, chained, replay + conflict, unexpired/converted/already-renewed refuse", async () => {
    const first = await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "renewal chain");
    // Unexpired cannot renew.
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_trial_renew('${OWNER_A}', 'planner', 'too early', '${reqId()}') as v;`,
      "FORGE_AUTH_TRIAL_NOT_EXPIRED");
    // Expire, then renew with a fixed request id.
    await expireTrialWindow(db, OWNER_A, "planner");
    const req = reqId();
    const renewed = await trialRenew(db, OPERATOR_O, OWNER_A, "planner", "renewal one", req);
    expect(renewed).toMatchObject({ owner_id: OWNER_A, app_key: "planner", status: "active", source: "owner_trial", renewal_of: first.grant_id });
    expect(new Date(renewed.ends_at).getTime() - new Date(renewed.starts_at).getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    // Same request id + same payload replays the same result.
    const replay = await trialRenew(db, OPERATOR_O, OWNER_A, "planner", "renewal one", req);
    expect(replay).toEqual(renewed);
    // Same request id + changed payload conflicts.
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_trial_renew('${OWNER_A}', 'planner', 'different reason', '${req}') as v;`,
      "FORGE_AUTH_REQUEST_ID_CONFLICT");
    // The latest grant is now the renewal; the chain links.
    const { rows: grants } = await db.query(`
      select id, grant_kind, renewal_of from forge_app_trial_grants
       where owner_id = '${OWNER_A}' and app_key = 'planner' order by created_at;`);
    expect(grants).toHaveLength(2);
    expect(grants[1]).toMatchObject({ grant_kind: "renewal", renewal_of: first.grant_id });
    const { rows: ent } = await db.query(`select last_trial_grant_id from forge_app_entitlements where owner_id = '${OWNER_A}' and app_key = 'planner';`);
    expect(ent[0].last_trial_grant_id).toBe(grants[1].id);
    // Already-renewed cannot renew again (the new window is unexpired
    // anyway — this also proves the renewal_of uniqueness guard).
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_trial_renew('${OWNER_A}', 'planner', 'again', '${reqId()}') as v;`,
      "FORGE_AUTH_TRIAL_NOT_EXPIRED");
    // Expire the renewal, renew again — the chain extends.
    await expireTrialWindow(db, OWNER_A, "planner");
    const second = await trialRenew(db, OPERATOR_O, OWNER_A, "planner", "renewal two");
    expect(second.renewal_of).toBe(grants[1].id);
    // Converted cannot renew.
    await trialConvert(db, OPERATOR_O, OWNER_A, "planner", "convert after renewals");
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_trial_renew('${OWNER_A}', 'planner', 'after convert', '${reqId()}') as v;`,
      "FORGE_AUTH_TRIAL_NOT_ACTIVE");
  });

  it60("conversion (active + expired): one version increment, history + last-trial ref kept, data preserved", async () => {
    // Active conversion.
    const granted = await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "convert active");
    // Create Planner data during the trial.
    await asUser(db, OWNER_A, `insert into forge_work_packages (owner_id, id, code, title) values ('${OWNER_A}', 'forge_wp_trial1', 'WP-TRIAL-1', 'Trial package');`);
    const converted = await trialConvert(db, OPERATOR_O, OWNER_A, "planner", "convert to paid");
    expect(converted).toMatchObject({ owner_id: OWNER_A, app_key: "planner", status: "active", source: "owner_manual", ends_at: null, last_trial_grant_id: granted.grant_id });
    const { rows: ent } = await db.query(`select status, source, starts_at, ends_at, version from forge_app_entitlements where owner_id = '${OWNER_A}' and app_key = 'planner';`);
    expect(ent[0]).toMatchObject({ status: "active", source: "owner_manual", ends_at: null, version: 3 });
    // The trial data is still there after conversion.
    const { rows: pkgs } = await asUser(db, OWNER_A, `select id from forge_work_packages where owner_id = '${OWNER_A}';`);
    expect(pkgs.map((r) => r.id)).toContain("forge_wp_trial1");
    // The grant history survives conversion.
    const { rows: grants } = await db.query(`select count(*)::int as n from forge_app_trial_grants where owner_id = '${OWNER_A}' and app_key = 'planner';`);
    expect(grants[0].n).toBe(1);
    const { rows: audit } = await db.query(`select event from forge_app_trial_audit where owner_id = '${OWNER_A}' and app_key = 'planner' order by created_at;`);
    expect(audit.map((r) => r.event)).toEqual(["granted", "converted_to_paid"]);
    // Expired conversion: a second workspace, expired first.
    await trialGrant(db, OPERATOR_O, OWNER_E, "planner", "convert expired");
    await expireTrialWindow(db, OWNER_E, "planner");
    await trialExpire(db);
    const convertedExpired = await trialConvert(db, OPERATOR_O, OWNER_E, "planner", "convert expired trial");
    expect(convertedExpired).toMatchObject({ status: "active", source: "owner_manual" });
  });

  it60("generic-grant bypass refusal: the generic path cannot overwrite an owner_trial row", async () => {
    await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "bypass check");
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_entitlement_grant('${OWNER_A}', 'planner', 'owner_manual', null, null, 'silent overwrite', '${reqId()}') as v;`,
      "FORGE_AUTH_TRIAL_MUST_CONVERT");
    // The entitlement is unchanged by the refused call.
    const { rows } = await db.query(`select status, source from forge_app_entitlements where owner_id = '${OWNER_A}' and app_key = 'planner';`);
    expect(rows[0]).toEqual({ status: "active", source: "owner_trial" });
    // The generic path still works for a non-trial row.
    const granted = await genericGrant(db, OPERATOR_O, OWNER_B, "planner", "owner_manual", "manual grant still works");
    expect(granted).toMatchObject({ owner_id: OWNER_B, app_key: "planner", status: "active", source: "owner_manual" });
    // And it still refuses owner_trial as a requested source.
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_entitlement_grant('${OWNER_B}', 'planner', 'owner_trial', null, null, 'trial via generic', '${reqId()}') as v;`,
      "FORGE_AUTH_TRIAL_UNDECIDED");
  });

  it60("eligibility denials: active manual, pending/suspended workspace, invalid app/reason/actor", async () => {
    // Active manual cannot be downgraded to a trial.
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_trial_grant('${OWNER_B}', 'planner', 'downgrade', '${reqId()}') as v;`,
      "FORGE_AUTH_TRIAL_NOT_PENDING");
    // Pending workspace denies.
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_trial_grant('${OWNER_C}', 'planner', 'pending ws', '${reqId()}') as v;`,
      "FORGE_AUTH_WORKSPACE_NOT_ACTIVE");
    // Suspended workspace denies.
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_trial_grant('${OWNER_D}', 'planner', 'suspended ws', '${reqId()}') as v;`,
      "FORGE_AUTH_WORKSPACE_NOT_ACTIVE");
    // Unknown workspace denies without disclosing.
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_trial_grant('00000000-0000-4000-8000-000000000000', 'planner', 'ghost', '${reqId()}') as v;`,
      "FORGE_AUTH_WORKSPACE_NOT_FOUND");
    // Designer / Scheduler are not trialable.
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_trial_grant('${OWNER_A}', 'designer', 'designer trial', '${reqId()}') as v;`,
      "FORGE_AUTH_TRIAL_UNAVAILABLE");
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_trial_grant('${OWNER_A}', 'scheduler', 'scheduler trial', '${reqId()}') as v;`,
      "FORGE_AUTH_TRIAL_UNAVAILABLE");
    // Garbage app key.
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_trial_grant('${OWNER_A}', 'nope', 'garbage', '${reqId()}') as v;`,
      "FORGE_AUTH_UNKNOWN_APP");
    // Empty reason denies.
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_trial_grant('${OWNER_A}', 'planner', '   ', '${reqId()}') as v;`,
      "FORGE_AUTH_REASON_REQUIRED");
    // Missing request id denies.
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_trial_grant('${OWNER_A}', 'planner', 'no request id', '') as v;`,
      "FORGE_AUTH_REQUEST_ID_REQUIRED");
  });

  it60("Capture grant refused while disabled (PR-4 reason); Planner grant unaffected", async () => {
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_trial_grant('${OWNER_A}', 'capture', 'capture trial', '${reqId()}') as v;`,
      "FORGE_AUTH_TRIAL_UNAVAILABLE");
    // No Capture clock started: no grant row, entitlement still pending.
    const { rows: grants } = await db.query(`select count(*)::int as n from forge_app_trial_grants where app_key = 'capture';`);
    expect(grants[0].n).toBe(0);
    const { rows: ent } = await db.query(`select status, source from forge_app_entitlements where owner_id = '${OWNER_A}' and app_key = 'capture';`);
    expect(ent[0]).toEqual({ status: "pending", source: null });
    // Planner still grants.
    const granted = await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "planner while capture disabled");
    expect(granted).toMatchObject({ app_key: "planner", status: "active" });
  });

  it60("owner-only authorization: workspace owner/admin/member/support/programmer/anon denied; actor is auth.uid()", async () => {
    const denied = [OWNER_A, MEMBER_C, MEMBER_D, SUPPORT_S, PROGRAMMER_P, STRANGER_S];
    for (const uid of denied) {
      await expectRpcError(db, uid,
        `select forge_app_trial_grant('${OWNER_A}', 'planner', 'not the owner', '${reqId()}') as v;`,
        "FORGE_AUTH_PLATFORM_OWNER_ONLY");
    }
    // Anonymous has no EXECUTE at all.
    await expectRoleError(db, "anon", null,
      `select forge_app_trial_grant('${OWNER_A}', 'planner', 'anon', '${reqId()}') as v;`, "42501");
    // The granted_by is always the authenticated caller, never a
    // caller-supplied id: the RPC takes no actor argument at all.
    const granted = await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "actor check");
    const { rows } = await db.query(`select granted_by from forge_app_trial_grants where id = '${granted.grant_id}';`);
    expect(rows[0].granted_by).toBe(OPERATOR_O);
    // The same denial holds for renew/convert/overview/list.
    await expectRpcError(db, OWNER_A,
      `select forge_app_trial_renew('${OWNER_A}', 'planner', 'x', '${reqId()}') as v;`,
      "FORGE_AUTH_PLATFORM_OWNER_ONLY");
    await expectRpcError(db, OWNER_A,
      `select forge_app_trial_convert_to_paid('${OWNER_A}', 'planner', 'x', '${reqId()}') as v;`,
      "FORGE_AUTH_PLATFORM_OWNER_ONLY");
    await expectRpcError(db, OWNER_A,
      `select forge_platform_trial_overview('${OWNER_A}') as v;`,
      "FORGE_AUTH_PLATFORM_OWNER_ONLY");
    await expectRpcError(db, STRANGER_S,
      `select forge_platform_trial_workspace_list('') as v;`,
      "FORGE_AUTH_PLATFORM_OWNER_ONLY");
  });

  it60("app separation: a Planner trial does not entitle Capture; cross-workspace guessed IDs deny", async () => {
    await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "separation");
    expect(await hasEntitlement(db, OWNER_A, OWNER_A, "planner")).toBe(true);
    expect(await hasEntitlement(db, OWNER_A, OWNER_A, "capture")).toBe(false);
    expect(await gate(db, OWNER_A, OWNER_A, "capture")).toMatchObject({ allowed: false, reason: "ENTITLEMENT_NOT_ACTIVE" });
    // A member of A guessing E's workspace id gets nothing.
    expect(await gate(db, MEMBER_D, OWNER_E, "planner")).toMatchObject({ allowed: false, reason: "NO_MEMBERSHIP" });
    expect(await hasEntitlement(db, MEMBER_D, OWNER_E, "planner")).toBe(false);
    // Granting E does not touch A.
    await trialGrant(db, OPERATOR_O, OWNER_E, "planner", "second workspace");
    expect(await hasEntitlement(db, OWNER_A, OWNER_A, "planner")).toBe(true);
    expect(await hasEntitlement(db, OWNER_E, OWNER_E, "planner")).toBe(true);
  });

  it60("app role still required: no-role member denied even with an active trial; planner-role member passes live, denies expired", async () => {
    await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "role gate");
    // MEMBER_N is a workspace member with no app role. The gate with
    // no capability requires an app role for a plain member — the
    // owner/co-owner bypass does not extend to members.
    expect(await gate(db, MEMBER_N, OWNER_A, "planner")).toMatchObject({ allowed: false, reason: "APP_ROLE_REQUIRED" });
    // MEMBER_D holds the planner role, so the no-capability entry
    // admits him while the trial is live.
    expect(await gate(db, MEMBER_D, OWNER_A, "planner")).toMatchObject({ allowed: true });
    // With the planning_steps.read capability the member passes while
    // the trial is live.
    expect(await gate(db, MEMBER_D, OWNER_A, "planner", "planner.planning_steps.read")).toMatchObject({ allowed: true });
    // After expiry the same member denies on entitlement, not role.
    await expireTrialWindow(db, OWNER_A, "planner");
    expect(await gate(db, MEMBER_D, OWNER_A, "planner", "planner.planning_steps.read")).toMatchObject({ allowed: false, reason: "TRIAL_ENDED" });
    // The owner still passes the no-capability entry while live, and
    // denies on TRIAL_ENDED after expiry (no role involved).
    await db.query(`update forge_app_entitlements set ends_at = now() + interval '1 hour' where owner_id = '${OWNER_A}' and app_key = 'planner';`);
    expect(await gate(db, OWNER_A, OWNER_A, "planner")).toMatchObject({ allowed: true, via: "owner" });
  });

  it60("direct data-plane denial: Planner tables deny without an entitlement and after expiry; allow during the trial", async () => {
    // Before any grant: direct SELECT sees nothing, direct INSERT is denied.
    const { rows: before } = await asUser(db, OWNER_A, `select id from forge_work_packages where owner_id = '${OWNER_A}';`);
    expect(before).toHaveLength(0);
    await expectRoleError(db, "authenticated", OWNER_A,
      `insert into forge_work_packages (owner_id, id, code, title) values ('${OWNER_A}', 'forge_wp_denied', 'WP-DENIED', 'Denied package');`,
      "42501");
    // During the trial: SELECT + INSERT work.
    await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "data plane");
    await asUser(db, OWNER_A, `insert into forge_work_packages (owner_id, id, code, title) values ('${OWNER_A}', 'forge_wp_trial1', 'WP-TRIAL-1', 'Trial package');`);
    const { rows: during } = await asUser(db, OWNER_A, `select id from forge_work_packages where owner_id = '${OWNER_A}';`);
    expect(during.map((r) => r.id)).toContain("forge_wp_trial1");
    // After expiry: the row is still stored, but direct access denies again.
    await expireTrialWindow(db, OWNER_A, "planner");
    const { rows: after } = await asUser(db, OWNER_A, `select id from forge_work_packages where owner_id = '${OWNER_A}';`);
    expect(after).toHaveLength(0);
    await expectRoleError(db, "authenticated", OWNER_A,
      `insert into forge_work_packages (owner_id, id, code, title) values ('${OWNER_A}', 'forge_wp_denied2', 'WP-DENIED-2', 'Denied package 2');`,
      "42501");
    // The data itself is preserved (superuser read-back).
    const { rows: stored } = await db.query(`select id from forge_work_packages where owner_id = '${OWNER_A}';`);
    expect(stored.map((r) => r.id)).toContain("forge_wp_trial1");
  });

  it60("direct data-plane denial: Capture tables + storage.objects deny without a Capture trial", async () => {
    // Seed one capture row + one storage object as the table owner.
    // The capture write trigger enforces the entitlement even for the
    // table owner (superuser), so the fixture insert disables it around
    // the seed and re-enables it immediately — the trigger itself is
    // what the deny legs below prove.
    await db.query(`alter table capture_library disable trigger forge_trial_capture_entitlement;`);
    await db.query(`
      insert into capture_library (id, owner_id, kind, storage_path)
        values (gen_random_uuid(), '${OWNER_A}', 'recording', '${OWNER_A}/capture/test.webm');`);
    await db.query(`alter table capture_library enable trigger forge_trial_capture_entitlement;`);
    await db.query(`
      insert into storage.objects (bucket_id, name, owner_id)
        values ('capture-library', '${OWNER_A}/capture/test.webm', '${OPERATOR_O}');`);
    // No Capture trial exists (and none can be granted while disabled):
    // direct reads deny.
    const { rows: lib } = await asUser(db, OWNER_A, `select id from capture_library where owner_id = '${OWNER_A}';`);
    expect(lib).toHaveLength(0);
    const { rows: objs } = await asUser(db, OWNER_A, `select name from storage.objects where bucket_id = 'capture-library';`);
    expect(objs).toHaveLength(0);
    await expectRoleError(db, "authenticated", OWNER_A,
      `insert into capture_library (id, owner_id, kind, storage_path) values (gen_random_uuid(), '${OWNER_A}', 'recording', '${OWNER_A}/capture/nope.webm');`,
      "42501");
    // Flip availability in-test ONLY (the migration seeds it disabled;
    // production flips only via the reviewed PR-4 operation), grant a
    // Capture trial, and the same reads now allow.
    await db.query(`update forge_app_trial_availability set enabled = true where app_key = 'capture';`);
    await trialGrant(db, OPERATOR_O, OWNER_A, "capture", "capture data plane (in-test availability flip)");
    const { rows: libAfter } = await asUser(db, OWNER_A, `select id from capture_library where owner_id = '${OWNER_A}';`);
    expect(libAfter).toHaveLength(1);
    const { rows: objsAfter } = await asUser(db, OWNER_A, `select name from storage.objects where bucket_id = 'capture-library';`);
    expect(objsAfter.map((r) => r.name)).toContain(`${OWNER_A}/capture/test.webm`);
    await asUser(db, OWNER_A, `insert into capture_library (id, owner_id, kind, storage_path) values (gen_random_uuid(), '${OWNER_A}', 'screenshot', '${OWNER_A}/capture/shot.png');`);
  });

  it60("write-path triggers: a SECURITY DEFINER write raises without an entitlement and succeeds with one", async () => {
    // forge_work_next_package_number is SECURITY DEFINER (bypasses RLS
    // by design) and inserts into forge_work_package_sequences — the
    // trigger is the only enforcement on that path.
    await expectRpcError(db, OWNER_A,
      `select forge_work_next_package_number('${OWNER_A}') as v;`,
      "FORGE_TRIAL_ENTITLEMENT_REQUIRED");
    await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "trigger check");
    const { rows } = await asUser(db, OWNER_A, `select forge_work_next_package_number('${OWNER_A}') as v;`);
    expect(rows[0].v).toBe(1);
    // After expiry the same call denies again.
    await expireTrialWindow(db, OWNER_A, "planner");
    await expectRpcError(db, OWNER_A,
      `select forge_work_next_package_number('${OWNER_A}') as v;`,
      "FORGE_TRIAL_ENTITLEMENT_REQUIRED");
  });

  it60("read-RPC guards: blocker counts and the planning checklist raise without an entitlement", async () => {
    // Blocker counts is service_role-only; it delegates from the
    // authenticated-callable deletion_blockers. Without an entitlement
    // it raises instead of counting.
    await expectRoleError(db, "service_role", OPERATOR_O,
      `select forge_work_package_deletion_blocker_counts('${OWNER_A}', 'forge_wp_x') as v;`,
      "FORGE_TRIAL_ENTITLEMENT_REQUIRED");
    // The planning checklist: MEMBER_D holds planning_steps.read, but
    // without an entitlement the checklist raises. (This leg must run
    // BEFORE any grant — once a trial is active the guard passes and
    // the missing package raises WPP10_PACKAGE_NOT_FOUND instead.)
    await expectRpcError(db, MEMBER_D,
      `select forge_work_planning_process_checklist('${OWNER_A}', 'forge_wp_nope') as v;`,
      "FORGE_TRIAL_ENTITLEMENT_REQUIRED");
    await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "read rpc check");
    const { rows } = await asServiceRole(db, `select forge_work_package_deletion_blocker_counts('${OWNER_A}', 'forge_wp_x') as v;`);
    expect(rows[0].v).toEqual([]);
  });

  it60("audit immutability: no direct DML even for the owner; SELECT only for platform owner + support", async () => {
    await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "audit check");
    // Direct INSERT/UPDATE/DELETE deny for authenticated (no policy,
    // no grant) — even for the workspace owner.
    await expectRoleError(db, "authenticated", OWNER_A,
      `insert into forge_app_trial_audit (owner_id, app_key, event, actor_class, reason, request_id) values ('${OWNER_A}', 'planner', 'granted', 'platform_owner', 'forged', 'x');`,
      "42501");
    await expectRoleError(db, "authenticated", OWNER_A,
      `update forge_app_trial_audit set reason = 'tampered' where owner_id = '${OWNER_A}';`,
      "42501");
    await expectRoleError(db, "authenticated", OWNER_A,
      `delete from forge_app_trial_audit where owner_id = '${OWNER_A}';`,
      "42501");
    // SELECT: platform owner sees it, support sees it, the workspace
    // owner and the programmer do not.
    const { rows: ownerRows } = await asUser(db, OPERATOR_O, `select id from forge_app_trial_audit where owner_id = '${OWNER_A}';`);
    expect(ownerRows).toHaveLength(1);
    const { rows: supportRows } = await asUser(db, SUPPORT_S, `select id from forge_app_trial_audit where owner_id = '${OWNER_A}';`);
    expect(supportRows).toHaveLength(1);
    const { rows: wsRows } = await asUser(db, OWNER_A, `select id from forge_app_trial_audit where owner_id = '${OWNER_A}';`);
    expect(wsRows).toHaveLength(0);
    const { rows: progRows } = await asUser(db, PROGRAMMER_P, `select id from forge_app_trial_audit where owner_id = '${OWNER_A}';`);
    expect(progRows).toHaveLength(0);
    // Direct reads of the grants table deny for everyone authenticated
    // (no grant at all on the table, not even SELECT — the denial is a
    // 42501 permission error, not an empty result).
    await expectRoleError(db, "authenticated", OPERATOR_O,
      `select id from forge_app_trial_grants where owner_id = '${OWNER_A}';`,
      "42501");
  });

  it60("policy sweep: every policy on the Planner/Capture tables carries the entitlement predicate", async () => {
    const tables = [
      "forge_work_packages", "forge_work_package_transitions", "forge_work_assets",
      "forge_work_asset_components", "forge_work_inspection_observations", "forge_work_locations",
      "forge_work_scope_baselines", "forge_work_scope_changes", "forge_work_gate_attestations",
      "forge_work_gate_evaluations", "forge_work_gate_overrides", "forge_work_package_sequences",
      "forge_work_manpower_days", "forge_work_package_baselines", "forge_work_progress_snapshots",
      "forge_work_weekly_commitments", "forge_work_document_library", "forge_work_package_budget_revisions",
      "forge_work_package_deletions", "forge_work_drawings", "forge_work_takeoff_lines",
      "forge_work_progress_entries", "forge_work_progress_revisions", "forge_work_permit_annotation_revisions",
      "forge_work_permit_annotations", "forge_work_craft_assignment_revisions", "forge_work_craft_assignments",
      "forge_work_step_drawing_link_revisions", "forge_work_step_drawing_links", "forge_work_step_order",
      "forge_work_step_revisions", "forge_work_steps", "forge_work_step_curve_placement_revisions",
      "forge_work_step_curve_placements", "forge_wp_drawing_field_redlines", "forge_wp_drawing_ifc_releases",
      "forge_wp_drawing_redlines", "forge_wp_drawing_review_events", "forge_wp_drawing_reviews",
      "forge_wp_drawing_revisions", "forge_work_change_order_revisions", "forge_work_change_orders",
      "forge_work_control_estimate_revisions", "forge_work_control_estimates",
      "forge_work_craft_rate_revisions", "forge_work_craft_rates", "forge_work_planning_process_instances",
      "forge_work_planning_process_revisions", "forge_work_package_links",
      "forge_work_links", "forge_work_link_confirmations",
      "capture_library", "capture_library_audit_log",
    ];
    const { rows } = await db.query(`
      select schemaname, tablename, policyname, cmd, qual, with_check
        from pg_policies
       where schemaname = 'public' and tablename = any($1::text[])
       order by tablename, policyname;`, [tables]);
    expect(rows.length).toBeGreaterThan(70);
    for (const row of rows) {
      // INSERT policies carry no USING (qual is null); the predicate
      // lives in with_check. Check the combined expression.
      const combined = `${row.qual ?? ""} ${row.with_check ?? ""}`;
      expect(combined, `${row.tablename}.${row.policyname} predicate`).toContain("forge_has_app_entitlement");
      // Planner tables stay workspace-scoped. Capture tables are
      // user-scoped instead (owner_id = auth.uid()), per the Capture
      // data model — the entitlement predicate is what gates them.
      const scope = row.tablename === "capture_library" || row.tablename === "capture_library_audit_log"
        ? "auth.uid()"
        : "has_workspace_access";
      expect(combined, `${row.tablename}.${row.policyname} still scoped`).toContain(scope);
    }
    // Storage policies (capture-library bucket) carry it too.
    const { rows: storRows } = await db.query(`
      select policyname, qual, with_check from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname like 'capture_library_objects_owner_%';`);
    expect(storRows).toHaveLength(3);
    for (const row of storRows) {
      const combined = `${row.qual ?? ""} ${row.with_check ?? ""}`;
      expect(combined, `${row.policyname} predicate`).toContain("forge_has_app_entitlement");
    }
    // Reference tables keep using(true) — shared reference data, no
    // predicate can apply.
    const { rows: refRows } = await db.query(`
      select tablename, qual from pg_policies
       where schemaname = 'public' and tablename in
        ('forge_work_lifecycle_transitions', 'forge_work_package_type_gates', 'forge_work_planning_process_template');`);
    for (const row of refRows) {
      expect(row.qual).toBe("true");
    }
    // forge_work_links / forge_work_link_confirmations DO have policies
    // (FOR ALL *_workspace_all) — rewritten with the predicate above,
    // so the loop already covered them; they are not deny-all tables.
    // In-flight PR tables are absent in this chain: the guards skipped
    // them cleanly (no policies, no triggers, no error).
    const { rows: absent } = await db.query(`
      select count(*)::int as n from pg_policies
       where tablename in ('forge_wp_drawing_artifacts', 'forge_work_milestones');`);
    expect(absent[0].n).toBe(0);
  });

  it60("trigger sweep: every owner_id table carries its entitlement trigger", async () => {
    const { rows } = await db.query(`
      select c.relname as table_name, t.tgname as trigger_name
        from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where t.tgname like 'forge_trial_%_entitlement'
       order by c.relname;`);
    const byTable = new Map(rows.map((r) => [r.table_name, r.trigger_name]));
    // 51 Planner tables + 2 Capture tables on main (53 owner_id tables).
    expect(rows).toHaveLength(53);
    expect(byTable.get("forge_work_packages")).toBe("forge_trial_planner_entitlement");
    expect(byTable.get("capture_library")).toBe("forge_trial_capture_entitlement");
    expect(byTable.get("forge_work_links")).toBe("forge_trial_planner_entitlement");
    expect(byTable.get("forge_work_package_sequences")).toBe("forge_trial_planner_entitlement");
    // Reference tables (no owner_id) take no trigger.
    for (const ref of ["forge_work_lifecycle_transitions", "forge_work_package_type_gates", "forge_work_planning_process_template"]) {
      expect(byTable.has(ref), `${ref} must have no trigger`).toBe(false);
    }
    // In-flight PR tables absent: no trigger (guard skipped cleanly).
    for (const t of ["forge_wp_drawing_artifacts", "forge_work_milestones"]) {
      expect(byTable.has(t), `${t} must have no trigger in this chain`).toBe(false);
    }
  });

  it60("re-apply is idempotent", async () => {
    await db.exec(loadMigrationSql(THIS_MIGRATION));
    const { rows } = await db.query(`select count(*)::int as n from forge_app_trial_availability;`);
    expect(rows[0].n).toBe(2);
    const granted = await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "after re-apply");
    expect(granted).toMatchObject({ status: "active", source: "owner_trial" });
  });

  it60("owner-console read RPCs: overview + workspace list, owner-only, non-disclosing", async () => {
    await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "overview check");
    const overview = await trialOverview(db, OPERATOR_O, OWNER_A);
    expect(overview).toMatchObject({ owner_id: OWNER_A, display_name: "Trial Workspace A", status: "active" });
    expect(overview.entitlements.find((e) => e.app_key === "planner")).toMatchObject({ status: "active", source: "owner_trial" });
    expect(overview.trials).toHaveLength(1);
    expect(overview.trials[0]).toMatchObject({ app_key: "planner", grant_kind: "initial" });
    expect(overview.availability.find((a) => a.app_key === "capture")).toMatchObject({ enabled: false });
    expect(overview.audit).toHaveLength(1);
    expect(overview.audit[0]).toMatchObject({ event: "granted" });
    // The list finds workspaces by name and returns all five when blank.
    const all = await trialWorkspaceList(db, OPERATOR_O, "");
    expect(all).toHaveLength(5);
    const filtered = await trialWorkspaceList(db, OPERATOR_O, "Trial Workspace");
    expect(filtered.map((w) => w.owner_id).sort()).toEqual([OWNER_A, OWNER_E].sort());
    // A LIKE wildcard in the search term is escaped, not a pattern.
    const escaped = await trialWorkspaceList(db, OPERATOR_O, "%");
    expect(escaped).toHaveLength(0);
    // Non-owners get the same denial whether the workspace exists or not.
    await expectRpcError(db, OWNER_A, `select forge_platform_trial_overview('${OWNER_A}') as v;`, "FORGE_AUTH_PLATFORM_OWNER_ONLY");
    await expectRpcError(db, STRANGER_S, `select forge_platform_trial_overview('00000000-0000-4000-8000-000000000000') as v;`, "FORGE_AUTH_PLATFORM_OWNER_ONLY");
  });

  it60("grant idempotency: same request replays, changed payload conflicts", async () => {
    const req = reqId();
    const first = await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "idempotent grant", req);
    const replay = await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "idempotent grant", req);
    expect(replay).toEqual(first);
    await expectRpcError(db, OPERATOR_O,
      `select forge_app_trial_grant('${OWNER_A}', 'planner', 'different reason', '${req}') as v;`,
      "FORGE_AUTH_REQUEST_ID_CONFLICT");
    const { rows } = await db.query(`select count(*)::int as n from forge_app_trial_grants where owner_id = '${OWNER_A}';`);
    expect(rows[0].n).toBe(1);
  });

  it60("non-owner replay of a stored trial receipt is denied (grant/renew/convert)", async () => {
    // Fix-round-1 P2: the platform-owner check now precedes the
    // idempotency replay in all three trial mutation RPCs, so a caller
    // who is not (or no longer) a platform owner can never receive a
    // stored result by replaying a known request id. Authorized replay
    // by the platform owner is unchanged.
    const grantReq = reqId();
    const granted = await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "replay grant", grantReq);
    await expectRpcError(db, OWNER_A,
      `select forge_app_trial_grant('${OWNER_A}', 'planner', 'replay grant', '${grantReq}') as v;`,
      "FORGE_AUTH_PLATFORM_OWNER_ONLY");
    await expectRpcError(db, STRANGER_S,
      `select forge_app_trial_grant('${OWNER_A}', 'planner', 'replay grant', '${grantReq}') as v;`,
      "FORGE_AUTH_PLATFORM_OWNER_ONLY");
    const replayedGrant = await trialGrant(db, OPERATOR_O, OWNER_A, "planner", "replay grant", grantReq);
    expect(replayedGrant).toEqual(granted);

    // Renew leg: expire the window, renew as the owner, replay as a non-owner.
    await expireTrialWindow(db, OWNER_A, "planner");
    const renewReq = reqId();
    const renewed = await trialRenew(db, OPERATOR_O, OWNER_A, "planner", "replay renew", renewReq);
    await expectRpcError(db, OWNER_A,
      `select forge_app_trial_renew('${OWNER_A}', 'planner', 'replay renew', '${renewReq}') as v;`,
      "FORGE_AUTH_PLATFORM_OWNER_ONLY");
    const replayedRenew = await trialRenew(db, OPERATOR_O, OWNER_A, "planner", "replay renew", renewReq);
    expect(replayedRenew).toEqual(renewed);

    // Convert leg.
    const convertReq = reqId();
    const converted = await trialConvert(db, OPERATOR_O, OWNER_A, "planner", "replay convert", convertReq);
    expect(converted).toMatchObject({ status: "active", source: "owner_manual" });
    await expectRpcError(db, OWNER_A,
      `select forge_app_trial_convert_to_paid('${OWNER_A}', 'planner', 'replay convert', '${convertReq}') as v;`,
      "FORGE_AUTH_PLATFORM_OWNER_ONLY");
    const replayedConvert = await trialConvert(db, OPERATOR_O, OWNER_A, "planner", "replay convert", convertReq);
    expect(replayedConvert).toEqual(converted);

    // No denied replay created a second row anywhere.
    const { rows: grants } = await db.query(`select count(*)::int as n from forge_app_trial_grants where owner_id = '${OWNER_A}';`);
    expect(grants[0].n).toBe(2); // 1 initial + 1 renewal; conversion writes no grant row.
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
//
// Port 55438 (the Auth PR 1 file uses 55437): the two files must not
// bind the same port when vitest runs them in parallel workers.
const PG_BIN = "/usr/lib/postgresql/16/bin";
const PG_PORT = 55438;
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

describe.skipIf(!HAS_REAL_PG)("saas trial 30day migration: real-PostgreSQL subset", () => {
  let pgDir;
  let pgClient;
  let pgCfg;

  const pgQuery = (target, sql) => target.query(sql);

  async function pgAsUser(client, uid, sql) {
    return asUser(client, uid, sql, pgQuery);
  }
  async function pgExpectRpcError(client, uid, sql, code) {
    return expectRpcError(client, uid, sql, code, pgQuery);
  }
  async function pgRpc(client, uid, sql) {
    return rpc(client, uid, sql, pgQuery);
  }

  beforeAll(async () => {
    pgDir = mkdtempSync(join(tmpdir(), "trial-realpg-"));
    execSync(`chown ${PG_RUN_USER}:${PG_RUN_USER} "${pgDir}"`, { stdio: "pipe" });
    const asPgUser = (cmd) => `runuser -u ${PG_RUN_USER} -- ${cmd}`;
    execSync(asPgUser(`"${PG_BIN}/initdb" -D "${pgDir}" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8`), { stdio: "pipe" });
    execSync(
      asPgUser(`"${PG_BIN}/pg_ctl" -D "${pgDir}" -o "-p ${PG_PORT} -k ${pgDir} -c listen_addresses=''" -l "${pgDir}/server.log" start`),
      { stdio: "pipe" },
    );
    pgCfg = { host: pgDir, port: PG_PORT, user: "postgres", database: "postgres" };
    pgClient = new Client(pgCfg);
    await pgClient.connect();
    await pgClient.query(PREREQ_SQL);
    await pgClient.query(SEED_SQL);
    await applyChain((sql) => pgClient.query(sql));
    await postChainSeed(pgClient, pgQuery);
  }, 180000);

  afterAll(async () => {
    try { await pgClient?.end(); } catch { /* already closed */ }
    if (pgDir) {
      try { execSync(`runuser -u ${PG_RUN_USER} -- "${PG_BIN}/pg_ctl" -D "${pgDir}" stop -m fast`, { stdio: "pipe" }); } catch { /* already stopped */ }
      rmSync(pgDir, { recursive: true, force: true });
    }
  }, 120000);

  it60("the full chain applies on real PG16: workspaces + entitlements seeded as expected", async () => {
    const { rows: ws } = await pgClient.query(`select owner_id, status from forge_workspaces order by owner_id;`);
    expect(ws).toEqual([
      { owner_id: OWNER_A, status: "active" },
      { owner_id: OWNER_B, status: "active" },
      { owner_id: OWNER_C, status: "pending" },
      { owner_id: OWNER_D, status: "suspended" },
      { owner_id: OWNER_E, status: "active" },
    ]);
    const { rows: avail } = await pgClient.query(`select app_key, enabled from forge_app_trial_availability order by app_key;`);
    expect(avail).toEqual([
      { app_key: "capture", enabled: false },
      { app_key: "planner", enabled: true },
    ]);
  });

  it60("boundary on real PG: grant, valid before ends_at, denied at/after — no worker run", async () => {
    const granted = await pgRpc(pgClient, OPERATOR_O,
      `select forge_app_trial_grant('${OWNER_A}', 'planner', 'real-pg boundary', '${reqId()}') as v;`);
    expect(granted).toMatchObject({ status: "active", source: "owner_trial" });
    const { rows: g } = await pgClient.query(`
      select extract(epoch from (ends_at - starts_at))::int as seconds
        from forge_app_trial_grants where id = '${granted.grant_id}';`);
    expect(g[0].seconds).toBe(2592000);
    expect(await hasEntitlement(pgClient, OPERATOR_O, OWNER_A, "planner", pgQuery)).toBe(true);
    await expireTrialWindow(pgClient, OWNER_A, "planner", pgQuery);
    expect(await hasEntitlement(pgClient, OPERATOR_O, OWNER_A, "planner", pgQuery)).toBe(false);
  });

  it60("two sessions granting with the same request id: one grant row, both get the same result", async () => {
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const grantCall = (client) => pgAsUser(client, OPERATOR_O,
        `select forge_app_trial_grant('${OWNER_E}', 'planner', 'race grant', 'req_race_trial_grant') as v;`);
      const results = await Promise.allSettled([grantCall(clientA), grantCall(clientB)]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(
        fulfilled,
        `both grant calls must succeed; rejections: ${JSON.stringify(results.filter((r) => r.status === "rejected").map((r) => String(r.reason?.message ?? r.reason)))}`,
      ).toHaveLength(2);
      expect(fulfilled[0].value.rows[0].v).toEqual(fulfilled[1].value.rows[0].v);
      const { rows } = await pgClient.query(`
        select count(*)::int as n from forge_app_trial_grants
         where owner_id = '${OWNER_E}' and app_key = 'planner' and grant_kind = 'initial';`);
      expect(rows[0].n).toBe(1);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("two sessions renewing the same expired trial with different request ids: one renewal, one conflict", async () => {
    // OWNER_A's trial was expired by the boundary leg above (ends_at in
    // the past, status still active — the worker has not run).
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const renewCall = (client, req) => pgAsUser(client, OPERATOR_O,
        `select forge_app_trial_renew('${OWNER_A}', 'planner', 'race renewal', '${req}') as v;`);
      const results = await Promise.allSettled([
        renewCall(clientA, reqId()),
        renewCall(clientB, reqId()),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      // The loser runs after the winner commits (the per-workspace/app
      // advisory lock serializes the two calls), so by the time it runs
      // the window is fresh and the honest refusal is NOT_EXPIRED — not
      // a raw unique violation and not a second renewal. ALREADY_RENEWED
      // is the RPC's defensive check for a latest grant that already
      // has a renewal pointing at it; through the RPCs the pointer
      // always advances, so the serialized loser never reaches it.
      expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toContain("FORGE_AUTH_TRIAL_NOT_EXPIRED");
      const { rows } = await pgClient.query(`
        select count(*)::int as n from forge_app_trial_grants
         where owner_id = '${OWNER_A}' and app_key = 'planner' and grant_kind = 'renewal';`);
      expect(rows[0].n).toBe(1);
      const { rows: audit } = await pgClient.query(`
        select count(*)::int as n from forge_app_trial_audit
         where owner_id = '${OWNER_A}' and app_key = 'planner' and event = 'renewed';`);
      expect(audit[0].n).toBe(1);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("direct data-plane denial on real PG: SELECT/INSERT deny without an entitlement", async () => {
    // OWNER_B has an active owner_manual planner entitlement: its rows
    // are visible. OWNER_C is pending: nothing is visible.
    await pgAsUser(pgClient, OWNER_B, `insert into forge_work_packages (owner_id, id, code, title) values ('${OWNER_B}', 'forge_wp_realpg', 'WP-REALPG', 'Real PG package');`);
    const { rows: visible } = await pgAsUser(pgClient, OWNER_B, `select id from forge_work_packages where owner_id = '${OWNER_B}';`);
    expect(visible.map((r) => r.id)).toContain("forge_wp_realpg");
    const { rows: hidden } = await pgAsUser(pgClient, OWNER_C, `select id from forge_work_packages where owner_id = '${OWNER_C}';`);
    expect(hidden).toHaveLength(0);
    let caught = null;
    try {
      await pgAsUser(pgClient, OWNER_C, `insert into forge_work_packages (owner_id, id, code, title) values ('${OWNER_C}', 'forge_wp_denied', 'WP-DENIED', 'Denied');`);
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe("42501");
  });

  it60("read-RPC guards on real PG: blocker counts (service_role) and checklist raise without an entitlement", async () => {
    // OWNER_C has no planner entitlement: the service_role blocker
    // count raises instead of counting.
    let caught = null;
    try {
      await pgClient.query(`set role service_role;`);
      await pgClient.query(`select forge_work_package_deletion_blocker_counts('${OWNER_C}', 'forge_wp_x') as v;`);
    } catch (error) {
      caught = error;
    } finally {
      await pgClient.query(`reset role;`);
    }
    expect(caught).not.toBeNull();
    expect(String(caught.message)).toContain("FORGE_TRIAL_ENTITLEMENT_REQUIRED");
    // MEMBER_D holds planning_steps.read for OWNER_A, but OWNER_A's
    // trial (renewed by the race leg) is live — so the checklist
    // proceeds past the entitlement guard and then fails on the
    // missing package, proving the guard did NOT trip.
    await pgExpectRpcError(pgClient, MEMBER_D,
      `select forge_work_planning_process_checklist('${OWNER_A}', 'forge_wp_nope') as v;`,
      "WPP10_PACKAGE_NOT_FOUND");
  });

  // Fix-round-1 P1 helpers. seedPendingWorkspace creates a fresh ACTIVE
  // workspace with a PENDING planner entitlement — the starting state
  // both race legs need. waitForUngrantedAdvisoryLocks polls pg_locks
  // until the expected number of sessions are blocked on an advisory
  // lock, so the barrier release below is deterministic (both RPCs are
  // inside their functions, past validation, waiting on the shared
  // workspace/app lock) instead of a Promise.all scheduling race.
  async function seedPendingWorkspace(ownerId, displayName) {
    await pgClient.query(`insert into auth.users (id, email, email_confirmed_at) values ('${ownerId}', 'race-${ownerId.slice(0, 8)}@example.test', now()) on conflict (id) do nothing;`);
    await pgClient.query(`insert into forge_workspaces (owner_id, display_name, status, created_by, updated_by) values ('${ownerId}', '${displayName}', 'active', '${OPERATOR_O}', '${OPERATOR_O}');`);
    await pgClient.query(`insert into forge_app_entitlements (owner_id, app_key, status, source, granted_by) values ('${ownerId}', 'planner', 'pending', null, null);`);
  }

  async function waitForUngrantedAdvisoryLocks(n, timeoutMs = 15000) {
    const started = Date.now();
    for (;;) {
      const { rows } = await pgClient.query(
        `select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted;`);
      if (rows[0].n >= n) return;
      if (Date.now() - started > timeoutMs) {
        throw new Error(`timed out waiting for ${n} ungranted advisory locks (saw ${rows[0].n})`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it60("generic-vs-trial race, generic started first: generic wins, trial refuses, no overwrite", async () => {
    // Fix-round-1 P1, ordering 1. The blocker session holds the shared
    // workspace/app lock (trial_serialize); both RPCs start and block
    // on it before either reads the entitlement. Releasing the blocker
    // grants the lock to the first waiter (the generic grant, started
    // first); the trial grant then re-reads post-lock and must refuse
    // with NOT_PENDING — it must not replace the manual entitlement,
    // and no trial grant/audit/receipt row may exist for the loser.
    await seedPendingWorkspace(OWNER_F, "Race Workspace F");
    const reqGeneric = reqId();
    const reqTrial = reqId();
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    const clientC = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    await clientC.connect();
    try {
      await clientC.query("begin;");
      await clientC.query(`select pg_advisory_xact_lock(hashtext('${OWNER_F}|planner'), hashtext('trial_serialize'));`);
      const pGeneric = pgAsUser(clientA, OPERATOR_O,
        `select forge_app_entitlement_grant('${OWNER_F}', 'planner', 'owner_manual', null, null, 'race generic first', '${reqGeneric}') as v;`);
      await waitForUngrantedAdvisoryLocks(1);
      const pTrial = pgAsUser(clientB, OPERATOR_O,
        `select forge_app_trial_grant('${OWNER_F}', 'planner', 'race trial second', '${reqTrial}') as v;`);
      await waitForUngrantedAdvisoryLocks(2);
      await clientC.query("commit;");
      const results = await Promise.allSettled([pGeneric, pTrial]);
      expect(results[0].status, `generic grant must win; trial result: ${JSON.stringify(results[1])}`).toBe("fulfilled");
      expect(results[0].value.rows[0].v).toMatchObject({ status: "active", source: "owner_manual" });
      expect(results[1].status).toBe("rejected");
      expect(String(results[1].reason?.message ?? results[1].reason)).toContain("FORGE_AUTH_TRIAL_NOT_PENDING");
      const { rows: ent } = await pgClient.query(`select status, source from forge_app_entitlements where owner_id = '${OWNER_F}' and app_key = 'planner';`);
      expect(ent[0]).toEqual({ status: "active", source: "owner_manual" });
      const { rows: grants } = await pgClient.query(`select count(*)::int as n from forge_app_trial_grants where owner_id = '${OWNER_F}';`);
      expect(grants[0].n).toBe(0);
      const { rows: audit } = await pgClient.query(`select count(*)::int as n from forge_app_trial_audit where owner_id = '${OWNER_F}';`);
      expect(audit[0].n).toBe(0);
      const { rows: receipts } = await pgClient.query(`select count(*)::int as n from forge_auth_idempotency_receipts where request_id in ('${reqGeneric}', '${reqTrial}');`);
      expect(receipts[0].n).toBe(1); // only the winner wrote a receipt
      const { rows: winnerReceipt } = await pgClient.query(`select action from forge_auth_idempotency_receipts where request_id = '${reqGeneric}';`);
      expect(winnerReceipt[0].action).toBe("entitlement_grant");
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
      await clientC.query("rollback;").catch(() => {});
      await clientC.end().catch(() => {});
    }
  });

  it60("generic-vs-trial race, trial started first: trial wins, generic refuses, no overwrite", async () => {
    // Fix-round-1 P1, ordering 2. Same barrier, opposite start order:
    // the trial grant is the first waiter, so it wins; the generic
    // grant then re-reads post-lock, sees owner_trial, and must refuse
    // with TRIAL_MUST_CONVERT — it must never overwrite the trial row.
    await seedPendingWorkspace(OWNER_G, "Race Workspace G");
    const reqTrial = reqId();
    const reqGeneric = reqId();
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    const clientC = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    await clientC.connect();
    try {
      await clientC.query("begin;");
      await clientC.query(`select pg_advisory_xact_lock(hashtext('${OWNER_G}|planner'), hashtext('trial_serialize'));`);
      const pTrial = pgAsUser(clientA, OPERATOR_O,
        `select forge_app_trial_grant('${OWNER_G}', 'planner', 'race trial first', '${reqTrial}') as v;`);
      await waitForUngrantedAdvisoryLocks(1);
      const pGeneric = pgAsUser(clientB, OPERATOR_O,
        `select forge_app_entitlement_grant('${OWNER_G}', 'planner', 'owner_manual', null, null, 'race generic second', '${reqGeneric}') as v;`);
      await waitForUngrantedAdvisoryLocks(2);
      await clientC.query("commit;");
      const results = await Promise.allSettled([pTrial, pGeneric]);
      expect(results[0].status, `trial grant must win; generic result: ${JSON.stringify(results[1])}`).toBe("fulfilled");
      expect(results[0].value.rows[0].v).toMatchObject({ status: "active", source: "owner_trial" });
      expect(results[1].status).toBe("rejected");
      expect(String(results[1].reason?.message ?? results[1].reason)).toContain("FORGE_AUTH_TRIAL_MUST_CONVERT");
      const { rows: ent } = await pgClient.query(`select status, source from forge_app_entitlements where owner_id = '${OWNER_G}' and app_key = 'planner';`);
      expect(ent[0]).toEqual({ status: "active", source: "owner_trial" });
      const { rows: grants } = await pgClient.query(`select count(*)::int as n from forge_app_trial_grants where owner_id = '${OWNER_G}' and grant_kind = 'initial';`);
      expect(grants[0].n).toBe(1);
      const { rows: audit } = await pgClient.query(`select count(*)::int as n from forge_app_trial_audit where owner_id = '${OWNER_G}' and event = 'granted';`);
      expect(audit[0].n).toBe(1);
      const { rows: g } = await pgClient.query(`select extract(epoch from (ends_at - starts_at))::int as seconds from forge_app_trial_grants where owner_id = '${OWNER_G}';`);
      expect(g[0].seconds).toBe(2592000);
      const { rows: receipts } = await pgClient.query(`select count(*)::int as n from forge_auth_idempotency_receipts where request_id in ('${reqTrial}', '${reqGeneric}');`);
      expect(receipts[0].n).toBe(1); // only the winner wrote a receipt
      const { rows: winnerReceipt } = await pgClient.query(`select action from forge_auth_idempotency_receipts where request_id = '${reqTrial}';`);
      expect(winnerReceipt[0].action).toBe("trial_grant");
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
      await clientC.query("rollback;").catch(() => {});
      await clientC.end().catch(() => {});
    }
  });

  it60("non-owner replay of a stored trial receipt is denied on real PG", async () => {
    // Fix-round-1 P2 (real-PG leg): create a successful trial grant as
    // the platform owner, then replay the EXACT request as a second
    // authenticated non-owner (the workspace owner, who holds no
    // platform role). The replay must raise PLATFORM_OWNER_ONLY rather
    // than return the stored result; the receipt survives and the
    // platform owner can still replay it.
    await seedPendingWorkspace(OWNER_H, "Replay Workspace H");
    const req = reqId();
    const granted = await pgRpc(pgClient, OPERATOR_O,
      `select forge_app_trial_grant('${OWNER_H}', 'planner', 'replay check', '${req}') as v;`);
    expect(granted).toMatchObject({ status: "active", source: "owner_trial" });
    await pgExpectRpcError(pgClient, OWNER_A,
      `select forge_app_trial_grant('${OWNER_H}', 'planner', 'replay check', '${req}') as v;`,
      "FORGE_AUTH_PLATFORM_OWNER_ONLY");
    const replayed = await pgRpc(pgClient, OPERATOR_O,
      `select forge_app_trial_grant('${OWNER_H}', 'planner', 'replay check', '${req}') as v;`);
    expect(replayed).toEqual(granted);
    const { rows } = await pgClient.query(`select count(*)::int as n from forge_app_trial_grants where owner_id = '${OWNER_H}';`);
    expect(rows[0].n).toBe(1);
  });
});
