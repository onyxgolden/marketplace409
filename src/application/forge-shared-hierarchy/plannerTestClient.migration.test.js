// FORGE Planner owner-only test client — migration/integration proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) — the 33-migration planner subset plus the two test-client
// migrations — in an in-memory PGlite database AND on a real
// PostgreSQL 16 scratch cluster, and proves:
//
//   - DB-enforced isolation: the owner sees test rows; Brandy
//     (co-owner), an ordinary member, an unrelated workspace owner,
//     and anonymous see NONE of them — never a name, never a count —
//     while all five keep seeing the real client and its package.
//     Direct SELECTs on forge_clients / forge_sites / forge_projects /
//     forge_work_packages / forge_work_steps / forge_work_package_links /
//     forge_work_planning_process_instances / forge_hierarchy_audit.
//   - Hierarchy definer RPCs apply the same visibility predicate:
//     selector / validate / admin_inventory / test_inventory, the
//     owner-only test-create RPC, regular create (always real), the
//     is_test immutability trigger, replays re-checking visibility.
//   - The sample loader: born linked (no Unassigned state), 6 packages
//     / 31 steps, idempotent on same and different request ids,
//     restore of deleted samples, request-id conflict, non-owner and
//     real-project rejections.
//   - The purge: preview counts + blockers + digest, confirm-name and
//     digest mismatches, non-sample-package and real-link blockers,
//     transactional delete in FK order, receipt outside the subtree,
//     harmless replay, request-id conflict across clients.
//   - The set_project boundary: test package -> real project rejected
//     for everyone; real package -> test project owner-only; cross
//     test-client links rejected; link history is a permanent blocker.
//
// NON-VACUITY (a separate describe, fresh DB): each guard is proven
// load-bearing by reverting it and watching the leak appear, then
// restoring it:
//   1. revert the test-client RLS policy -> Brandy's direct query leaks.
//   2. drop the step guard trigger -> the step-create RPC leaks.
//   3. remove a package-child predicate -> direct step/drawing leaks.
//   4. unfiltered owner aggregate includes the six test packages
//      (the real-mode exclusion is what keeps them out).
//   5. a sample-stamped package left Unassigned IS visible to Brandy
//      (born-linked is what hides samples).
//   6. a naive direct client delete on real PG raises 23503, while the
//      purge succeeds (purge FK handling is load-bearing).
//   7. a deliberately double-called load still yields exactly six
//      packages / 31 steps.
//
// Identities are REAL auth identities (different auth.uid() values) —
// never a co-owner tested as ownerId with a fake JS isOwner flag.
// The five: Jason-owner, Brandy co-owner, ordinary member, unrelated
// workspace owner, anonymous (anon role, no app.test_uid).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { Client } from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGDIR = join(HERE, "..", "..", "..", "supabase", "migrations");
const it60 = (name, fn) => it(name, fn, 60000);

// Same identities as the real-PG16 smoke proof (smoke.sql).
const OWNER_A = "11111111-1111-1111-1111-111111111111";
const BRANDY = "22222222-2222-2222-2222-222222222222";
const MEMBER_C = "33333333-3333-3333-3333-333333333333";
const OWNER_X = "44444444-4444-4444-4444-444444444444";

const TEST_CLIENT_MIGRATION = "20261117120000_forge_planner_owner_test_visibility.sql";
const TEST_CLEANUP_MIGRATION = "20261117130000_forge_planner_test_samples_cleanup.sql";

// The 33-migration planner subset that carries the full work-package
// schema (packages, steps, drawings, busts, planning process, SaaS
// auth, trial entitlements, hierarchy, project link). Proven to apply
// 33/33 on real PG16 and 35/35 (with the two test-client migrations)
// on PGlite.
const SUBSET = [
  "20261002120000_forge_work_management_rung1.sql",
  "20261002210000_forge_work_management_rung2.sql",
  "20261003120000_forge_work_management_rung3.sql",
  "20261004010000_forge_work_management_rung4.sql",
  "20261005000000_forge_work_management_rung5.sql",
  "20261005000100_forge_work_management_rung5_fixes.sql",
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
  "20261110000000_forge_planner_admin_permissions_slice1.sql",
  "20261110010000_rental_admin_roles_slice1.sql",
  "20261110040000_forge_work_package_deletion_blocker_fix.sql",
  "20261110050000_forge_work_package_mode_selector.sql",
  "20261110070000_forge_work_package_delete_retired_cleanup.sql",
  "20261110080000_forge_scheduling_admin_permissions_slice1.sql",
  "20261112000000_forge_work_planning_process_steps.sql",
  "20261112010000_forge_shared_hierarchy_foundation.sql",
  "20261113000000_forge_work_package_project_link.sql",
  "20261113010000_saas_auth_pr1.sql",
  "20261113020000_forge_work_controlled_drawing_intake.sql",
  "20261113030000_saas_trial_30day.sql",
  "20261113050000_forge_hierarchy_admin_inventory.sql",
  "20261115000000_forge_work_package_busts.sql",
  "20261116000000_forge_work_scope_plan_baseline_bridge.sql",
];

const PREREQ_SQL = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select current_setting('app.test_uid', true)::uuid
  $$;
  create schema if not exists storage;
  create table if not exists storage.buckets (id text primary key, name text not null, owner uuid, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
  create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid, owner_id text, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now(), metadata jsonb, version text, unique (bucket_id, name));
  create or replace function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
  create or replace function storage.filename(text) returns text language sql immutable as $$ select split_part($1, '/', -1) $$;
  create or replace function storage.extension(text) returns text language sql immutable as $$ select split_part($1, '.', -1) $$;
  alter table storage.buckets enable row level security;
  alter table storage.objects enable row level security;
  create table workspace_members (
    owner_id text not null, member_user_id uuid not null, status text not null, role text not null,
    permission_overrides jsonb not null default '{}',
    invited_email text, invited_by text, invited_at timestamptz, activated_at timestamptz,
    suspended_at timestamptz, revoked_by text, revoked_reason text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
  create table auth.users (id uuid primary key, email text, created_at timestamptz default now());
  create table rental_tenants (owner_id text not null, id text not null, primary key (owner_id, id));
  create table rental_maintenance_requests (owner_id text not null, id text not null, primary key (owner_id, id));
  create table rental_maintenance_work_orders (owner_id text not null, id text not null, primary key (owner_id, id));
  create table if not exists capture_library (owner_id text not null, id text not null, primary key (owner_id, id));
  create table if not exists capture_library_audit_log (owner_id text not null, id text not null, primary key (owner_id, id));
  create table if not exists designer_projects (owner_id text not null, id text not null, primary key (owner_id, id));
  create table if not exists rental_leases (owner_id text not null, id text not null, primary key (owner_id, id));
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
`;

// Workspace membership + planner entitlement the seed needs. The
// entitlement is what the trial migration's forge_has_app_entitlement
// checks before any package-child row is visible.
const SEED_SQL = `
  insert into workspace_members (owner_id, member_user_id, status, role, permission_overrides)
    values ('${OWNER_A}', '${BRANDY}', 'active', 'co_owner', '{}'),
           ('${OWNER_A}', '${MEMBER_C}', 'active', 'read_only', '{}')
    on conflict do nothing;
  insert into forge_workspaces (owner_id, display_name, status, created_by, updated_by)
    values ('${OWNER_A}', 'Owner Workspace', 'active', '${OWNER_A}', '${OWNER_A}')
    on conflict do nothing;
  insert into forge_app_entitlements (owner_id, app_key, status, source, granted_by)
    values ('${OWNER_A}', 'planner', 'active', 'owner_manual', '${OWNER_A}')
    on conflict do nothing;
`;

function loadMigrationSql(name) {
  return readFileSync(join(MIGDIR, name), "utf8");
}

// PGlite has .exec (multi-statement); node-pg's Client only has
// .query. One helper so the same setup code drives both legs.
async function execSql(db, sql) {
  return typeof db.exec === "function" ? db.exec(sql) : db.query(sql);
}

// Run a query as an identity. uid === null means anonymous: the anon
// role with app.test_uid reset, so auth.uid() is NULL.
async function asUser(db, uid, sql) {
  if (uid) {
    await execSql(db, `set role authenticated; set app.test_uid = '${uid}';`);
  } else {
    await execSql(db, `set role anon; reset app.test_uid;`);
  }
  try {
    return await db.query(sql);
  } finally {
    await execSql(db, `reset role;`);
  }
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

function sqlStr(value) {
  return value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`;
}

// Fixture: test client A (+ site/project, samples loaded), real client
// (+ site/project, one control package), and test client B (+
// site/project, empty — the loader/purge tests own it). Created
// through the RPCs / loader as the owner, exactly as the app does;
// the real control package is a direct insert by the setup user
// (RLS bypass), which is fixture setup, not a code path under test.
async function createFixtures(db, asUserFn) {
  const call = async (uid, sql) => (await asUserFn(db, uid, sql)).rows[0].v;
  const testClientA = await call(OWNER_A, `select forge_hierarchy_client_create_test('${OWNER_A}', 'Fictional Test Client', null, null, 'req-tc-a') as v;`);
  const testSiteA = await call(OWNER_A, `select forge_hierarchy_site_create('${OWNER_A}', '${testClientA.id}', 'Fictional Test Site', 'industrial', null, null, null, null, null, null, 'req-ts-a') as v;`);
  const testProjectA = await call(OWNER_A, `select forge_hierarchy_project_create('${OWNER_A}', '${testSiteA.id}', 'Fictional Test Project', null, null, null, null, null, 'req-tp-a') as v;`);
  const realClient = await call(OWNER_A, `select forge_hierarchy_client_create('${OWNER_A}', 'Real Client', null, null, 'req-rc-1') as v;`);
  const realSite = await call(OWNER_A, `select forge_hierarchy_site_create('${OWNER_A}', '${realClient.id}', 'Real Site', 'industrial', null, null, null, null, null, null, 'req-rs-1') as v;`);
  const realProject = await call(OWNER_A, `select forge_hierarchy_project_create('${OWNER_A}', '${realSite.id}', 'Real Project', null, null, null, null, null, 'req-rp-1') as v;`);
  const testClientB = await call(OWNER_A, `select forge_hierarchy_client_create_test('${OWNER_A}', 'Purge Test Client', null, null, 'req-tc-b') as v;`);
  const testSiteB = await call(OWNER_A, `select forge_hierarchy_site_create('${OWNER_A}', '${testClientB.id}', 'Purge Test Site', 'industrial', null, null, null, null, null, null, 'req-ts-b') as v;`);
  const testProjectB = await call(OWNER_A, `select forge_hierarchy_project_create('${OWNER_A}', '${testSiteB.id}', 'Purge Test Project', null, null, null, null, null, 'req-tp-b') as v;`);
  await execSql(db, `
    insert into forge_work_packages (owner_id, id, code, title, package_type, priority, mode, planning_complexity, forge_project_id, created_by, updated_by)
      values ('${OWNER_A}', 'forge_wp_realcontrol1', 'WP-REAL-1', 'Real control package', 'industrial', 'normal', 'industrial', 'standard', '${realProject.id}', '${OWNER_A}', '${OWNER_A}');
  `);
  const loaded = await call(OWNER_A, `select forge_planner_test_load_samples('${OWNER_A}', '${testProjectA.id}', 'req-load-a') as v;`);
  expect(loaded.packages).toBe(6);
  expect(loaded.steps).toBe(31);
  return { testClientA, testSiteA, testProjectA, realClient, realSite, realProject, testClientB, testSiteB, testProjectB };
}

async function setupPGlite() {
  const db = new PGlite();
  await execSql(db, PREREQ_SQL);
  for (const name of SUBSET) await execSql(db, loadMigrationSql(name));
  await execSql(db, loadMigrationSql(TEST_CLIENT_MIGRATION));
  await execSql(db, loadMigrationSql(TEST_CLEANUP_MIGRATION));
  await execSql(db, SEED_SQL);
  const fx = await createFixtures(db, asUser);
  return { db, fx };
}

// Direct-SELECT counts per identity, on every table that can expose a
// test row. `where` scopes the query to OWNER_A's workspace.
async function isolationCounts(db, uid, fx) {
  const q = async (sql) => (await asUser(db, uid, sql)).rows[0].n;
  const w = `owner_id = '${OWNER_A}'`;
  return {
    clients: Number(await q(`select count(*)::int as n from forge_clients where ${w}`)),
    testClients: Number(await q(`select count(*)::int as n from forge_clients where ${w} and is_test`)),
    sites: Number(await q(`select count(*)::int as n from forge_sites where ${w}`)),
    testSites: Number(await q(`select count(*)::int as n from forge_sites where ${w} and id in (select s.id from forge_sites s join forge_clients c on c.owner_id = s.owner_id and c.id = s.client_id where c.is_test)`)),
    projects: Number(await q(`select count(*)::int as n from forge_projects where ${w}`)),
    packages: Number(await q(`select count(*)::int as n from forge_work_packages where ${w}`)),
    samplePackages: Number(await q(`select count(*)::int as n from forge_work_packages where ${w} and forge_project_id = '${fx.testProjectA.id}'`)),
    steps: Number(await q(`select count(*)::int as n from forge_work_steps s join forge_work_packages w on w.owner_id = s.owner_id and w.id = s.work_package_id where w.${w}`)),
    sampleSteps: Number(await q(`select count(*)::int as n from forge_work_steps s join forge_work_packages w on w.owner_id = s.owner_id and w.id = s.work_package_id where w.forge_project_id = '${fx.testProjectA.id}'`)),
    links: Number(await q(`select count(*)::int as n from forge_work_package_links where ${w}`)),
    sampleLinks: Number(await q(`select count(*)::int as n from forge_work_package_links where ${w} and package_id in (select id from forge_work_packages where forge_project_id = '${fx.testProjectA.id}')`)),
    checklist: Number(await q(`select count(*)::int as n from forge_work_planning_process_instances where ${w}`)),
    sampleChecklist: Number(await q(`select count(*)::int as n from forge_work_planning_process_instances where ${w} and work_package_id in (select id from forge_work_packages where forge_project_id = '${fx.testProjectA.id}')`)),
    audit: Number(await q(`select count(*)::int as n from forge_hierarchy_audit where ${w}`)),
    testAudit: Number(await q(`select count(*)::int as n from forge_hierarchy_audit where ${w} and is_test`)),
  };
}

describe("planner test client: PGlite leg (full subset + both migrations)", () => {
  let db;
  let fx;

  beforeAll(async () => {
    ({ db, fx } = await setupPGlite());
  }, 180000);

  afterAll(async () => {
    await db?.close();
  });

  it60("isolation matrix: owner sees everything; Brandy, member, unrelated owner, anon see zero test rows and keep the real ones", async () => {
    const owner = await isolationCounts(db, OWNER_A, fx);
    expect(owner.clients).toBe(3);
    expect(owner.testClients).toBe(2);
    expect(owner.sites).toBe(3);
    expect(owner.testSites).toBe(2);
    expect(owner.projects).toBe(3);
    expect(owner.packages).toBe(7);
    expect(owner.samplePackages).toBe(6);
    expect(owner.steps).toBe(31);
    expect(owner.sampleSteps).toBe(31);
    expect(owner.sampleLinks).toBe(6);
    expect(owner.sampleChecklist).toBe(132);
    expect(owner.testAudit).toBeGreaterThan(0);

    for (const [label, uid] of [["Brandy co-owner", BRANDY], ["ordinary member", MEMBER_C], ["unrelated owner", OWNER_X]]) {
      const seen = await isolationCounts(db, uid, fx);
      expect(seen.testClients, `${label}: test clients`).toBe(0);
      expect(seen.testSites, `${label}: test sites`).toBe(0);
      expect(seen.samplePackages, `${label}: sample packages`).toBe(0);
      expect(seen.sampleSteps, `${label}: sample steps`).toBe(0);
      expect(seen.sampleLinks, `${label}: sample links`).toBe(0);
      expect(seen.sampleChecklist, `${label}: sample checklist`).toBe(0);
      expect(seen.testAudit, `${label}: test audit`).toBe(0);
    }
    // Positive controls: the co-owner still sees the real client tree
    // and the real control package — the filter hides test rows, not
    // the workspace.
    const brandy = await isolationCounts(db, BRANDY, fx);
    expect(brandy.clients).toBe(1);
    expect(brandy.sites).toBe(1);
    expect(brandy.projects).toBe(1);
    expect(brandy.packages).toBe(1);
    // The ordinary read_only member sees NOTHING by direct SELECT —
    // has_workspace_access admits owner + active co-owner only, so
    // staff reads go through the capability-checked definer RPCs, not
    // the tables. (The selector RPC also refuses this member: it holds
    // no forge.hierarchy.read grant in this fixture — asserted in the
    // RPC test below.)
    const member = await isolationCounts(db, MEMBER_C, fx);
    expect(member.clients).toBe(0);
    expect(member.sites).toBe(0);
    expect(member.projects).toBe(0);
    expect(member.packages).toBe(0);
    // Anonymous has no SELECT grant at all — the query is refused, not
    // answered with zero rows.
    await expectRpcError(db, null,
      `select count(*)::int as n from forge_clients where owner_id = '${OWNER_A}';`,
      "permission denied");
  });

  it60("hierarchy RPCs: selector/validate/inventory hide test rows from non-owners and flag them for the owner", async () => {
    const ownerSel = (await asUser(db, OWNER_A, `select forge_hierarchy_selector('${OWNER_A}') as v;`)).rows[0].v;
    expect(ownerSel.clients.map((c) => c.name)).toContain("Fictional Test Client");
    const testEntry = ownerSel.clients.find((c) => c.name === "Fictional Test Client");
    expect(testEntry.is_test).toBe(true);
    expect(ownerSel.clients.find((c) => c.name === "Real Client").is_test).toBe(false);

    const brandySel = (await asUser(db, BRANDY, `select forge_hierarchy_selector('${OWNER_A}') as v;`)).rows[0].v;
    expect(brandySel.clients.map((c) => c.name)).toEqual(["Real Client"]);

    // The ordinary read_only member holds no forge.hierarchy.read grant
    // in this fixture, so even the capability-checked selector refuses
    // it — it sees neither test nor real rows through this path.
    await expectRpcError(db, MEMBER_C,
      `select forge_hierarchy_selector('${OWNER_A}') as v;`,
      "FORGE_HIERARCHY_FORBIDDEN");

    // Validate: non-disclosing 404 for a hidden test project.
    await expectRpcError(db, BRANDY,
      `select forge_hierarchy_validate_selection('${OWNER_A}', '${fx.testProjectA.id}') as v;`,
      "FORGE_HIERARCHY_NOT_FOUND");
    const ownerVal = (await asUser(db, OWNER_A, `select forge_hierarchy_validate_selection('${OWNER_A}', '${fx.testProjectA.id}') as v;`)).rows[0].v;
    expect(ownerVal.client.is_test).toBe(true);

    const brandyInv = (await asUser(db, BRANDY, `select forge_hierarchy_admin_inventory('${OWNER_A}') as v;`)).rows[0].v;
    expect(brandyInv.canUseOwnerTestData).toBe(false);
    expect(brandyInv.clients.map((c) => c.name)).toEqual(["Real Client"]);
    const ownerInv = (await asUser(db, OWNER_A, `select forge_hierarchy_admin_inventory('${OWNER_A}') as v;`)).rows[0].v;
    expect(ownerInv.canUseOwnerTestData).toBe(true);
    expect(ownerInv.clients.map((c) => c.name)).toContain("Fictional Test Client");

    const brandyTestInv = (await asUser(db, BRANDY, `select forge_hierarchy_test_inventory('${OWNER_A}') as v;`)).rows[0].v;
    expect(brandyTestInv.canUseOwnerTestData).toBe(false);
    expect(brandyTestInv.clients).toEqual([]);
    const ownerTestInv = (await asUser(db, OWNER_A, `select forge_hierarchy_test_inventory('${OWNER_A}') as v;`)).rows[0].v;
    expect(ownerTestInv.canUseOwnerTestData).toBe(true);
    expect(ownerTestInv.clients.map((c) => c.name).sort()).toEqual(["Fictional Test Client", "Purge Test Client"]);
  });

  it60("test-create RPC: owner-only; regular create is always real; the marker is immutable", async () => {
    await expectRpcError(db, BRANDY,
      `select forge_hierarchy_client_create_test('${OWNER_A}', 'Brandy Test Client', null, null, 'req-brandytc') as v;`,
      "FORGE_HIERARCHY_FORBIDDEN");
    await expectRpcError(db, OWNER_X,
      `select forge_hierarchy_client_create_test('${OWNER_A}', 'Stranger Test Client', null, null, 'req-strangertc') as v;`,
      "FORGE_HIERARCHY_FORBIDDEN");

    const created = (await asUser(db, OWNER_A, `select forge_hierarchy_client_create_test('${OWNER_A}', 'Replay Test Client', null, null, 'req-replay-tc') as v;`)).rows[0].v;
    expect(created.is_test).toBe(true);
    // Replay: the same request id returns the same client, no duplicate.
    const replayed = (await asUser(db, OWNER_A, `select forge_hierarchy_client_create_test('${OWNER_A}', 'Replay Test Client', null, null, 'req-replay-tc') as v;`)).rows[0].v;
    expect(replayed.id).toBe(created.id);
    const count = (await asUser(db, OWNER_A, `select count(*)::int as n from forge_clients where owner_id = '${OWNER_A}' and name = 'Replay Test Client';`)).rows[0].n;
    expect(count).toBe(1);
    // Cleanup: archive-then-delete (delete is archive-first) so later
    // counts stay exact.
    await asUser(db, OWNER_A, `select forge_hierarchy_client_update('${OWNER_A}', '${created.id}', null, null, null, 'archived', 1, 'req-replay-tc-arch') as v;`);
    await asUser(db, OWNER_A, `select forge_hierarchy_client_delete('${OWNER_A}', '${created.id}', 2, 'req-replay-tc-del') as v;`);

    const real = (await asUser(db, OWNER_A, `select forge_hierarchy_client_create('${OWNER_A}', 'Always Real Client', null, null, 'req-always-real') as v;`)).rows[0].v;
    expect(real.is_test).toBe(false);
    await asUser(db, OWNER_A, `select forge_hierarchy_client_update('${OWNER_A}', '${real.id}', null, null, null, 'archived', 1, 'req-always-real-arch') as v;`);
    await asUser(db, OWNER_A, `select forge_hierarchy_client_delete('${OWNER_A}', '${real.id}', 2, 'req-always-real-del') as v;`);

    // Immutability: even the setup superuser cannot flip is_test via a
    // direct UPDATE — the trigger raises before RLS is even consulted.
    let caught = null;
    try {
      await db.exec(`update forge_clients set is_test = false where owner_id = '${OWNER_A}' and id = '${fx.testClientA.id}';`);
    } catch (error) { caught = error; }
    expect(caught).not.toBeNull();
    expect(String(caught.message)).toContain("FORGE_HIERARCHY_TEST_MARKER_IMMUTABLE");
  });

  it60("loader: non-owner and real-project rejections; born linked; double-load is a no-op", async () => {
    await expectRpcError(db, BRANDY,
      `select forge_planner_test_load_samples('${OWNER_A}', '${fx.testProjectB.id}', 'req-load-brandy') as v;`,
      "FORGE_PLANNER_TEST_NOT_FOUND");
    await expectRpcError(db, OWNER_A,
      `select forge_planner_test_load_samples('${OWNER_A}', '${fx.realProject.id}', 'req-load-real') as v;`,
      "FORGE_PLANNER_TEST_NOT_A_TEST_PROJECT");

    const first = (await asUser(db, OWNER_A, `select forge_planner_test_load_samples('${OWNER_A}', '${fx.testProjectB.id}', 'req-load-b1') as v;`)).rows[0].v;
    expect(first.packages).toBe(6);
    expect(first.steps).toBe(31);
    expect(first.alreadyLoaded).toBe(false);
    expect(first.message).toContain("Loaded 6 sample packages / 31 steps");

    // Born linked: no sample package ever sits Unassigned.
    const unassigned = (await asUser(db, OWNER_A, `select count(*)::int as n from forge_work_packages where owner_id = '${OWNER_A}' and source_system = 'forge_planner_test_seed_v1' and forge_project_id is null;`)).rows[0].n;
    expect(unassigned).toBe(0);
    const stamped = (await asUser(db, OWNER_A, `select count(distinct source_record_id)::int as n from forge_work_packages where owner_id = '${OWNER_A}' and source_system = 'forge_planner_test_seed_v1';`)).rows[0].n;
    expect(stamped).toBe(12);

    // Double-load, same request id and a fresh one: still exactly six.
    const replay = (await asUser(db, OWNER_A, `select forge_planner_test_load_samples('${OWNER_A}', '${fx.testProjectB.id}', 'req-load-b1') as v;`)).rows[0].v;
    expect(replay.alreadyLoaded).toBe(true);
    const again = (await asUser(db, OWNER_A, `select forge_planner_test_load_samples('${OWNER_A}', '${fx.testProjectB.id}', 'req-load-b2') as v;`)).rows[0].v;
    expect(again.alreadyLoaded).toBe(true);
    expect(again.message).toContain("Already loaded");
    const pkgs = (await asUser(db, OWNER_A, `select count(*)::int as n from forge_work_packages where forge_project_id = '${fx.testProjectB.id}';`)).rows[0].n;
    expect(pkgs).toBe(6);
  });

  it60("loader: deleted samples restore without touching Jason's edits", async () => {
    // Delete two steps of one sample package (setup user, direct SQL —
    // fixture surgery, not a code path under test).
    await db.exec(`
      delete from forge_work_steps
      where owner_id = '${OWNER_A}' and work_package_id in (
        select id from forge_work_packages where forge_project_id = '${fx.testProjectB.id}' limit 1
      ) and sequence_no in (1, 2);
    `);
    const before = (await asUser(db, OWNER_A, `select count(*)::int as n from forge_work_steps s join forge_work_packages w on w.owner_id = s.owner_id and w.id = s.work_package_id where w.forge_project_id = '${fx.testProjectB.id}';`)).rows[0].n;
    expect(before).toBe(29);
    const restored = (await asUser(db, OWNER_A, `select forge_planner_test_load_samples('${OWNER_A}', '${fx.testProjectB.id}', 'req-load-b3') as v;`)).rows[0].v;
    expect(restored.steps).toBe(31);
    expect(restored.loaded).toBe(true);
    // A full restore reports as loaded — the two deleted steps came
    // back, and the load receipt records the outcome.
    expect(restored.message).toContain("Loaded 6 sample packages / 31 steps");
  });

  it60("purge: preview counts + digest, blockers, mismatches, transactional delete, receipt, replay", async () => {
    await expectRpcError(db, BRANDY,
      `select forge_planner_test_purge_preview('${OWNER_A}', '${fx.testClientB.id}') as v;`,
      "FORGE_PLANNER_TEST_NOT_FOUND");
    const preview = (await asUser(db, OWNER_A, `select forge_planner_test_purge_preview('${OWNER_A}', '${fx.testClientB.id}') as v;`)).rows[0].v;
    expect(preview.canPurge).toBe(true);
    expect(preview.blockers).toEqual([]);
    expect(preview.counts.forge_work_packages).toBe(6);
    expect(preview.counts.forge_work_steps).toBe(31);
    expect(preview.counts.forge_clients).toBe(1);
    expect(preview.counts.forge_work_package_links).toBe(6);
    expect(preview.digest).toMatch(/^[0-9a-f]{64}$/);

    // Blocker: a non-sample package attached to the test project.
    await db.exec(`
      insert into forge_work_packages (owner_id, id, code, title, package_type, priority, mode, planning_complexity, forge_project_id, created_by, updated_by)
        values ('${OWNER_A}', 'forge_wp_blocker1', 'WP-BLOCK-1', 'Hand-attached real package', 'industrial', 'normal', 'industrial', 'standard', '${fx.testProjectB.id}', '${OWNER_A}', '${OWNER_A}');
    `);
    const blocked = (await asUser(db, OWNER_A, `select forge_planner_test_purge_preview('${OWNER_A}', '${fx.testClientB.id}') as v;`)).rows[0].v;
    expect(blocked.canPurge).toBe(false);
    expect(blocked.blockers.length).toBeGreaterThan(0);
    await expectRpcError(db, OWNER_A,
      `select forge_planner_test_purge('${OWNER_A}', '${fx.testClientB.id}', ${sqlStr(blocked.digest)}, 'req-purge-b1', 'Purge Test Client') as v;`,
      "FORGE_PLANNER_TEST_PURGE_BLOCKED");
    // The blocker insert fired the planning-process trigger, so its
    // checklist rows go first (FK RESTRICT), then the package.
    await db.exec(`delete from forge_work_planning_process_instances where owner_id = '${OWNER_A}' and work_package_id = 'forge_wp_blocker1';`);
    await db.exec(`delete from forge_work_packages where owner_id = '${OWNER_A}' and id = 'forge_wp_blocker1';`);

    const clean = (await asUser(db, OWNER_A, `select forge_planner_test_purge_preview('${OWNER_A}', '${fx.testClientB.id}') as v;`)).rows[0].v;
    expect(clean.canPurge).toBe(true);
    await expectRpcError(db, OWNER_A,
      `select forge_planner_test_purge('${OWNER_A}', '${fx.testClientB.id}', ${sqlStr(clean.digest)}, 'req-purge-b1', 'Wrong Name') as v;`,
      "FORGE_PLANNER_TEST_CONFIRM_NAME_MISMATCH");
    await expectRpcError(db, OWNER_A,
      `select forge_planner_test_purge('${OWNER_A}', '${fx.testClientB.id}', '0000000000000000000000000000000000000000000000000000000000000000', 'req-purge-b1', 'Purge Test Client') as v;`,
      "FORGE_PLANNER_TEST_DIGEST_MISMATCH");

    const purged = (await asUser(db, OWNER_A, `select forge_planner_test_purge('${OWNER_A}', '${fx.testClientB.id}', ${sqlStr(clean.digest)}, 'req-purge-b1', 'Purge Test Client') as v;`)).rows[0].v;
    expect(purged.purged).toBe(true);
    expect(purged.alreadyPurged).toBe(false);
    expect(purged.deletedCounts.forge_work_packages).toBe(6);
    expect(purged.deletedCounts.forge_work_steps).toBe(31);

    // Test client B is gone; real data and client A survive; the purge
    // receipt lives outside the deleted subtree.
    const gone = (await asUser(db, OWNER_A, `select count(*)::int as n from forge_clients where owner_id = '${OWNER_A}' and id = '${fx.testClientB.id}';`)).rows[0].n;
    expect(gone).toBe(0);
    const realSurvives = (await asUser(db, OWNER_A, `select count(*)::int as n from forge_work_packages where owner_id = '${OWNER_A}' and id = 'forge_wp_realcontrol1';`)).rows[0].n;
    expect(realSurvives).toBe(1);
    const aSurvives = (await asUser(db, OWNER_A, `select count(*)::int as n from forge_work_packages where forge_project_id = '${fx.testProjectA.id}';`)).rows[0].n;
    expect(aSurvives).toBe(6);
    const receipts = (await asUser(db, OWNER_A, `select count(*)::int as n from forge_planner_test_purge_receipts where owner_id = '${OWNER_A}';`)).rows[0].n;
    expect(receipts).toBe(1);
    const loadReceipts = (await asUser(db, OWNER_A, `select count(*)::int as n from forge_planner_test_load_receipts where owner_id = '${OWNER_A}';`)).rows[0].n;
    expect(loadReceipts).toBeGreaterThan(0);

    // Replay: the identical request is harmless.
    const replay = (await asUser(db, OWNER_A, `select forge_planner_test_purge('${OWNER_A}', '${fx.testClientB.id}', ${sqlStr(clean.digest)}, 'req-purge-b1', 'Purge Test Client') as v;`)).rows[0].v;
    expect(replay.alreadyPurged).toBe(true);
    // Same request id, different client: conflict, and client A survives.
    await expectRpcError(db, OWNER_A,
      `select forge_planner_test_purge('${OWNER_A}', '${fx.testClientA.id}', ${sqlStr(clean.digest)}, 'req-purge-b1', 'Fictional Test Client') as v;`,
      "FORGE_PLANNER_TEST_REQUEST_ID_CONFLICT");
    const aStillThere = (await asUser(db, OWNER_A, `select count(*)::int as n from forge_clients where owner_id = '${OWNER_A}' and id = '${fx.testClientA.id}';`)).rows[0].n;
    expect(aStillThere).toBe(1);
  });

  it60("set_project boundary: test package -> real project rejected; real -> test owner-only; cross-test-client rejected", async () => {
    const samplePkg = (await asUser(db, OWNER_A, `select id from forge_work_packages where forge_project_id = '${fx.testProjectA.id}' limit 1;`)).rows[0].id;
    const sampleVersion = (await asUser(db, OWNER_A, `select version from forge_work_packages where owner_id = '${OWNER_A}' and id = '${samplePkg}';`)).rows[0].version;
    await expectRpcError(db, OWNER_A,
      `select forge_work_package_set_project('${OWNER_A}', '${samplePkg}', '${fx.realProject.id}', ${sampleVersion}, 'req-setp-boundary') as v;`,
      "FORGE_PRB_TEST_BOUNDARY");
    await expectRpcError(db, BRANDY,
      `select forge_work_package_set_project('${OWNER_A}', '${samplePkg}', '${fx.realProject.id}', ${sampleVersion}, 'req-setp-brandy') as v;`,
      "FORGE_PRB_PACKAGE_NOT_FOUND");

    // Real package -> test project: allowed for the owner (and it
    // creates a purge blocker — the link history is permanent).
    const realVersion = (await asUser(db, OWNER_A, `select version from forge_work_packages where owner_id = '${OWNER_A}' and id = 'forge_wp_realcontrol1';`)).rows[0].version;
    const moved = (await asUser(db, OWNER_A, `select forge_work_package_set_project('${OWNER_A}', 'forge_wp_realcontrol1', '${fx.testProjectA.id}', ${realVersion}, 'req-setp-real-to-test') as v;`)).rows[0].v;
    expect(moved.forge_project_id).toBe(fx.testProjectA.id);
    const preview = (await asUser(db, OWNER_A, `select forge_planner_test_purge_preview('${OWNER_A}', '${fx.testClientA.id}') as v;`)).rows[0].v;
    expect(preview.canPurge).toBe(false);
    expect(preview.blockers.length).toBeGreaterThan(0);

    // Real package -> test project as Brandy: she cannot see the
    // destination (or the test package), so it fails non-disclosing.
    const realVersion2 = (await asUser(db, OWNER_A, `select version from forge_work_packages where owner_id = '${OWNER_A}' and id = 'forge_wp_realcontrol1';`)).rows[0].version;
    await expectRpcError(db, BRANDY,
      `select forge_work_package_set_project('${OWNER_A}', 'forge_wp_realcontrol1', '${fx.testProjectA.id}', ${realVersion2}, 'req-setp-brandy2') as v;`,
      "FORGE_PRB_PACKAGE_NOT_FOUND");

    // Cross-test-client: a second test client + project, then move a
    // test-A package to it — rejected.
    const clientC = (await asUser(db, OWNER_A, `select forge_hierarchy_client_create_test('${OWNER_A}', 'Second Test Client', null, null, 'req-tc-c') as v;`)).rows[0].v;
    const siteC = (await asUser(db, OWNER_A, `select forge_hierarchy_site_create('${OWNER_A}', '${clientC.id}', 'Second Test Site', 'industrial', null, null, null, null, null, null, 'req-ts-c') as v;`)).rows[0].v;
    const projectC = (await asUser(db, OWNER_A, `select forge_hierarchy_project_create('${OWNER_A}', '${siteC.id}', 'Second Test Project', null, null, null, null, null, 'req-tp-c') as v;`)).rows[0].v;
    const sampleVersion2 = (await asUser(db, OWNER_A, `select version from forge_work_packages where owner_id = '${OWNER_A}' and id = '${samplePkg}';`)).rows[0].version;
    await expectRpcError(db, OWNER_A,
      `select forge_work_package_set_project('${OWNER_A}', '${samplePkg}', '${projectC.id}', ${sampleVersion2}, 'req-setp-cross') as v;`,
      "FORGE_PRB_TEST_CLIENT_MISMATCH");
  });
});

const PG_BIN = "/usr/lib/postgresql/16/bin";
const PG_RUN_USER = "postgres";
const HAS_REAL_PG = (() => {
  try {
    execSync(`test -x "${PG_BIN}/initdb"`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!HAS_REAL_PG)("planner test client: real-PostgreSQL 16 leg", () => {
  let pgDir;
  let pgClient;
  let pgCfg;
  let fx;

  beforeAll(async () => {
    pgDir = mkdtempSync(join(tmpdir(), "ptc-realpg-"));
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
    await execSql(pgClient, PREREQ_SQL);
    for (const name of SUBSET) await execSql(pgClient, loadMigrationSql(name));
    await execSql(pgClient, loadMigrationSql(TEST_CLIENT_MIGRATION));
    await execSql(pgClient, loadMigrationSql(TEST_CLEANUP_MIGRATION));
    await execSql(pgClient, SEED_SQL);
    fx = await createFixtures(pgClient, asUser);
  }, 180000);

  afterAll(async () => {
    try { await pgClient?.end(); } catch { /* already closed */ }
    if (pgDir) {
      try { execSync(`runuser -u ${PG_RUN_USER} -- "${PG_BIN}/pg_ctl" -D "${pgDir}" stop -m fast`, { stdio: "pipe" }); } catch { /* already stopped */ }
      rmSync(pgDir, { recursive: true, force: true });
    }
  }, 120000);

  it60("real PG16: the five-identity isolation matrix holds on the real server", async () => {
    const owner = await isolationCounts(pgClient, OWNER_A, fx);
    expect(owner.testClients).toBe(2);
    expect(owner.samplePackages).toBe(6);
    expect(owner.sampleSteps).toBe(31);
    expect(owner.sampleChecklist).toBe(132);
    for (const [label, uid] of [["Brandy co-owner", BRANDY], ["ordinary member", MEMBER_C], ["unrelated owner", OWNER_X]]) {
      const seen = await isolationCounts(pgClient, uid, fx);
      expect(seen.testClients, `${label}: test clients`).toBe(0);
      expect(seen.samplePackages, `${label}: sample packages`).toBe(0);
      expect(seen.sampleSteps, `${label}: sample steps`).toBe(0);
      expect(seen.testAudit, `${label}: test audit`).toBe(0);
    }
    const brandy = await isolationCounts(pgClient, BRANDY, fx);
    expect(brandy.clients).toBe(1);
    expect(brandy.packages).toBe(1);
    await expectRpcError(pgClient, null,
      `select count(*)::int as n from forge_clients where owner_id = '${OWNER_A}';`,
      "permission denied");
  });

  it60("real PG16: concurrent loads with the same request id yield exactly six packages, not twelve", async () => {
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const load = (client) => asUser(client, OWNER_A,
        `select forge_planner_test_load_samples('${OWNER_A}', '${fx.testProjectB.id}', 'req-load-race') as v;`);
      const results = await Promise.allSettled([load(clientA), load(clientB)]);
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const pkgs = (await asUser(pgClient, OWNER_A, `select count(*)::int as n from forge_work_packages where forge_project_id = '${fx.testProjectB.id}';`)).rows[0].n;
      expect(pkgs).toBe(6);
      const steps = (await asUser(pgClient, OWNER_A, `select count(*)::int as n from forge_work_steps s join forge_work_packages w on w.owner_id = s.owner_id and w.id = s.work_package_id where w.forge_project_id = '${fx.testProjectB.id}';`)).rows[0].n;
      expect(steps).toBe(31);
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("real PG16: a naive direct client delete raises 23503 (FK graph is real); the purge then succeeds", async () => {
    let caught = null;
    try {
      await execSql(pgClient, `delete from forge_clients where owner_id = '${OWNER_A}' and id = '${fx.testClientB.id}';`);
    } catch (error) { caught = error; }
    expect(caught).not.toBeNull();
    expect(caught.code === "23503" || String(caught.message).includes("violates foreign key constraint")).toBe(true);

    const preview = (await asUser(pgClient, OWNER_A, `select forge_planner_test_purge_preview('${OWNER_A}', '${fx.testClientB.id}') as v;`)).rows[0].v;
    expect(preview.canPurge).toBe(true);
    const purged = (await asUser(pgClient, OWNER_A, `select forge_planner_test_purge('${OWNER_A}', '${fx.testClientB.id}', '${preview.digest}', 'req-purge-realpg', 'Purge Test Client') as v;`)).rows[0].v;
    expect(purged.purged).toBe(true);
    const gone = (await asUser(pgClient, OWNER_A, `select count(*)::int as n from forge_clients where owner_id = '${OWNER_A}' and id = '${fx.testClientB.id}';`)).rows[0].n;
    expect(gone).toBe(0);
  });
});

describe("planner test client: NON-VACUITY (each guard proven load-bearing)", () => {
  let db;
  let fx;

  beforeAll(async () => {
    ({ db, fx } = await setupPGlite());
  }, 180000);

  afterAll(async () => {
    await db?.close();
  });

  it60("1. reverting the test-client RLS policy makes Brandy's direct query leak — then the policy is restored", async () => {
    const policyRow = (await db.query(`
      select policyname, cmd, qual, with_check from pg_policies
      where schemaname = 'public' and tablename = 'forge_clients' and cmd = 'SELECT';
    `)).rows[0];
    expect(policyRow).toBeDefined();
    try {
      await execSql(db, `drop policy ${policyRow.policyname} on public.forge_clients;`);
      await execSql(db, `create policy ${policyRow.policyname} on public.forge_clients for select to authenticated using (has_workspace_access(owner_id));`);
      const leaked = (await asUser(db, BRANDY, `select count(*)::int as n from forge_clients where owner_id = '${OWNER_A}' and is_test;`)).rows[0].n;
      expect(leaked).toBe(2);
    } finally {
      await execSql(db, `drop policy if exists ${policyRow.policyname} on public.forge_clients;`);
      await execSql(db, `create policy ${policyRow.policyname} on public.forge_clients for select to authenticated using (${policyRow.qual});`);
    }
    const sealed = (await asUser(db, BRANDY, `select count(*)::int as n from forge_clients where owner_id = '${OWNER_A}' and is_test;`)).rows[0].n;
    expect(sealed).toBe(0);
  });

  it60("2. dropping the step guard triggers lets the step-create RPC leak — then the triggers are restored", async () => {
    const samplePkg = (await asUser(db, OWNER_A, `select id from forge_work_packages where forge_project_id = '${fx.testProjectA.id}' limit 1;`)).rows[0].id;
    // With the guards: Brandy's step-create on a test package raises.
    await expectRpcError(db, BRANDY,
      `select forge_work_step_create('${OWNER_A}', '${samplePkg}', 'Leak step', null, null, 1, 2, null, null, null, 'non-vacuity') as v;`,
      "FORGE_PLANNER_TEST_NOT_FOUND");
    // The RPC writes through three guarded tables (steps, step order,
    // step revisions), so all three guard triggers must go for the
    // leak to appear — the guard is a set, not a single trigger.
    const guarded = [
      ["forge_work_steps", "work_package_id"],
      ["forge_work_step_order", "work_package_id"],
      ["forge_work_step_revisions", "step_id"],
    ];
    for (const [table] of guarded) {
      const found = (await db.query(`
        select distinct trigger_name from information_schema.triggers
        where event_object_schema = 'public' and event_object_table = '${table}'
          and trigger_name = 'forge_test_guard_mutation';
      `)).rows;
      expect(found.length, `guard trigger on ${table}`).toBe(1);
    }
    let leakedId = null;
    try {
      for (const [table] of guarded) {
        await execSql(db, `drop trigger forge_test_guard_mutation on public.${table};`);
      }
      const callResult = await asUser(db, BRANDY, `select forge_work_step_create('${OWNER_A}', '${samplePkg}', 'Leak step', null, null, 1, 2, null, null, null, 'non-vacuity') as v;`);
      expect(callResult.rows[0]).toBeDefined();
      // The RPC returns the row type, not jsonb — read the leaked row
      // back directly as the setup user (RLS bypass) instead of
      // relying on the composite's client-side shape.
      const leakedRow = (await db.query(`select id, title from forge_work_steps where owner_id = '${OWNER_A}' and title = 'Leak step'`)).rows[0];
      expect(leakedRow).toBeDefined();
      expect(leakedRow.title).toBe("Leak step");
      leakedId = leakedRow.id;
    } finally {
      // Clean up the leaked rows as the setup user (revisions first —
      // they FK to the step), then restore every guard trigger exactly
      // as migration 1 defines it.
      if (leakedId) {
        await execSql(db, `delete from forge_work_step_revisions where owner_id = '${OWNER_A}' and step_id = '${leakedId}';`);
        await execSql(db, `delete from forge_work_steps where owner_id = '${OWNER_A}' and id = '${leakedId}';`);
      }
      for (const [table, arg] of guarded) {
        await execSql(db, `
          create trigger forge_test_guard_mutation before insert or update or delete
          on public.${table}
          for each row execute function public.forge_test_guard_mutation('${arg}');
        `);
      }
    }
    await expectRpcError(db, BRANDY,
      `select forge_work_step_create('${OWNER_A}', '${samplePkg}', 'Leak step 2', null, null, 1, 2, null, null, null, 'non-vacuity') as v;`,
      "FORGE_PLANNER_TEST_NOT_FOUND");
  });

  it60("3. removing a package-child predicate makes direct step/drawing reads leak — then it is restored", async () => {
    const policyRow = (await db.query(`
      select policyname, cmd, qual, with_check from pg_policies
      where schemaname = 'public' and tablename = 'forge_work_steps' and cmd = 'SELECT';
    `)).rows[0];
    expect(policyRow).toBeDefined();
    try {
      await execSql(db, `drop policy ${policyRow.policyname} on public.forge_work_steps;`);
      await execSql(db, `create policy ${policyRow.policyname} on public.forge_work_steps for select to authenticated using (has_workspace_access(owner_id) and forge_has_app_entitlement(owner_id, 'planner'));`);
      // Read the steps table directly — no join through packages, so
      // only this table's own predicate stands between Brandy and the
      // sample steps.
      const leaked = (await asUser(db, BRANDY, `select count(*)::int as n from forge_work_steps where owner_id = '${OWNER_A}';`)).rows[0].n;
      expect(leaked).toBe(31);
    } finally {
      await execSql(db, `drop policy if exists ${policyRow.policyname} on public.forge_work_steps;`);
      await execSql(db, `create policy ${policyRow.policyname} on public.forge_work_steps for select to authenticated using (${policyRow.qual});`);
    }
    const sealed = (await asUser(db, BRANDY, `select count(*)::int as n from forge_work_steps where owner_id = '${OWNER_A}';`)).rows[0].n;
    expect(sealed).toBe(0);
  });

  it60("4. the unfiltered owner aggregate includes the six test packages — the real-mode exclusion is what keeps them out", async () => {
    const unfiltered = (await asUser(db, OWNER_A, `select count(*)::int as n from forge_work_packages where owner_id = '${OWNER_A}';`)).rows[0].n;
    expect(unfiltered).toBe(7);
    // The real-mode view: packages whose project chain is real (or
    // Unassigned real packages) — exactly the one control package.
    const realMode = (await asUser(db, OWNER_A, `
      select count(*)::int as n from forge_work_packages w
      where w.owner_id = '${OWNER_A}'
        and not exists (
          select 1 from forge_projects p
          join forge_sites s on s.owner_id = p.owner_id and s.id = p.site_id
          join forge_clients c on c.owner_id = s.owner_id and c.id = s.client_id
          where p.owner_id = w.owner_id and p.id = w.forge_project_id and c.is_test
        );
    `)).rows[0].n;
    expect(realMode).toBe(1);
    expect(unfiltered - realMode).toBe(6);
  });

  it60("5. a sample-stamped package left Unassigned IS visible to Brandy — born-linked is what hides samples", async () => {
    await execSql(db, `
      insert into forge_work_packages (owner_id, id, code, title, package_type, priority, mode, planning_complexity, forge_project_id, source_system, source_record_id, created_by, updated_by)
        values ('${OWNER_A}', 'forge_wp_unassigned_leak', 'WP-LEAK-1', 'Unassigned sample [SAMPLE]', 'industrial', 'normal', 'industrial', 'standard', null, 'forge_planner_test_seed_v1', 'forge_planner_test_seed_v1:leak:pkg1', '${OWNER_A}', '${OWNER_A}');
    `);
    try {
      const leaked = (await asUser(db, BRANDY, `select count(*)::int as n from forge_work_packages where owner_id = '${OWNER_A}' and id = 'forge_wp_unassigned_leak';`)).rows[0].n;
      expect(leaked).toBe(1);
    } finally {
      // The package insert fired the planning-process trigger, so its
      // 22 checklist rows must go first (FK RESTRICT), then the package.
      await execSql(db, `delete from forge_work_planning_process_instances where owner_id = '${OWNER_A}' and work_package_id = 'forge_wp_unassigned_leak';`);
      await execSql(db, `delete from forge_work_packages where owner_id = '${OWNER_A}' and id = 'forge_wp_unassigned_leak';`);
    }
    // And the loader itself never leaves a sample Unassigned.
    const unassigned = (await asUser(db, OWNER_A, `select count(*)::int as n from forge_work_packages where owner_id = '${OWNER_A}' and source_system = 'forge_planner_test_seed_v1' and forge_project_id is null;`)).rows[0].n;
    expect(unassigned).toBe(0);
  });

  it60("7. a deliberately double-called load still yields exactly six packages / 31 steps", async () => {
    const first = (await asUser(db, OWNER_A, `select forge_planner_test_load_samples('${OWNER_A}', '${fx.testProjectB.id}', 'req-load-nv-1') as v;`)).rows[0].v;
    expect(first.packages).toBe(6);
    const second = (await asUser(db, OWNER_A, `select forge_planner_test_load_samples('${OWNER_A}', '${fx.testProjectB.id}', 'req-load-nv-2') as v;`)).rows[0].v;
    expect(second.alreadyLoaded).toBe(true);
    const pkgs = (await asUser(db, OWNER_A, `select count(*)::int as n from forge_work_packages where forge_project_id = '${fx.testProjectB.id}';`)).rows[0].n;
    const steps = (await asUser(db, OWNER_A, `select count(*)::int as n from forge_work_steps s join forge_work_packages w on w.owner_id = s.owner_id and w.id = s.work_package_id where w.forge_project_id = '${fx.testProjectB.id}';`)).rows[0].n;
    expect(pkgs).toBe(6);
    expect(steps).toBe(31);
  });
});
