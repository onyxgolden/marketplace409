// FORGE External Accounts Register — migration/integration proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) — the two workspace-membership prerequisite migrations plus
// the register migration — in an in-memory PGlite database AND on a
// real PostgreSQL 16 scratch cluster, and proves:
//
//   - DB-enforced household isolation: the owner (Jason) and Brandy
//     (active co-owner) can CRUD register rows through the RPCs and
//     see them via direct SELECT; an ordinary member (read_only),
//     an unrelated workspace owner, and anonymous see NONE of them —
//     never a name, never a count — and addressing a known row id
//     directly yields the generic FORGE_EXTERNAL_ACCOUNT_NOT_FOUND.
//     An unrelated owner CAN create rows under their OWN
//     platform_owner_id (multi-tenant scope); they see zero of the
//     owner's rows.
//   - RPC semantics: version-conflict rejection, logical delete /
//     restore / permanent-erase (permanent only after logical),
//     duplicate detection with conflict return + allow_duplicate,
//     owner/seed-key immutability triggers, secret-pattern rejection
//     (RPC + direct), thread add/state, audit rows + append-only.
//   - Seed: preview counts, apply creates, re-apply is a no-op,
//     owner-edited values survive a re-apply, seed_key conflicts
//     surface instead of merging.
//   - Reconcile: create / match / duplicate-on-message-ref; a
//     provider alone never merges two rows.
//   - ACL inventory: anon holds NOTHING on any table or function;
//     authenticated holds SELECT/INSERT/UPDATE/DELETE on accounts +
//     threads (RLS-gated) and SELECT only on audit; the 9 public
//     RPCs grant EXECUTE to authenticated only; the helpers grant
//     EXECUTE to nobody; RLS is enabled AND forced on all three
//     tables.
//   - NON-VACUITY (separate describe, fresh DB): each guard is proven
//     load-bearing by reverting it and watching the leak appear.
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
const MIGDIR = join(HERE, "..");
const it60 = (name, fn) => it(name, fn, 60000);

// Same identities as the planner test-client proof.
const OWNER_A = "11111111-1111-1111-1111-111111111111";
const BRANDY = "22222222-2222-2222-2222-222222222222";
const MEMBER_C = "33333333-3333-3333-3333-333333333333";
const OWNER_X = "44444444-4444-4444-4444-444444444444";
const REVOKED_D = "55555555-5555-5555-5555-555555555555";

const REGISTER_MIGRATION = "20261117140000_forge_external_accounts_register.sql";

const PREREQ_SQL = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select current_setting('app.test_uid', true)::uuid
  $$;
  create table auth.users (id uuid primary key, email text, created_at timestamptz default now());
  insert into auth.users (id, email) values
    ('${OWNER_A}', 'jason@example.test'),
    ('${BRANDY}', 'brandy@example.test'),
    ('${MEMBER_C}', 'member@example.test'),
    ('${OWNER_X}', 'other@example.test'),
    ('${REVOKED_D}', 'revoked@example.test')
    on conflict do nothing;
`;

// Workspace membership the register's household gate reads: Brandy is
// Jason's ACTIVE co-owner; MEMBER_C is read_only staff (inert for the
// household gate); REVOKED_D was a co-owner whose membership is now
// SUSPENDED (revoked — confers nothing); OWNER_X has no membership anywhere.
const SEED_SQL = `
  insert into workspace_members (owner_id, id, member_user_id, role, status, invited_email, invited_by, invited_at, activated_at, suspended_at)
    values ('${OWNER_A}', 'wm-brandy', '${BRANDY}', 'co_owner', 'active', 'brandy@example.test', '${OWNER_A}', now(), now(), null),
           ('${OWNER_A}', 'wm-member', '${MEMBER_C}', 'read_only', 'active', 'member@example.test', '${OWNER_A}', now(), now(), null),
           ('${OWNER_A}', 'wm-revoked', '${REVOKED_D}', 'co_owner', 'suspended', 'revoked@example.test', '${OWNER_A}', now(), now(), now())
    on conflict do nothing;
`;

function loadMigrationSql(name) {
  return readFileSync(join(MIGDIR, name), "utf8");
}

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

function createPayload(provider, app = "FORGE", extra = {}) {
  return JSON.stringify({
    provider_name: provider,
    purpose: `${provider} for FORGE work`,
    associated_app: app,
    ...extra,
  });
}

async function setupDb(db) {
  await execSql(db, PREREQ_SQL);
  await execSql(db, loadMigrationSql("20260829000000_create_workspace_members.sql"));
  await execSql(db, loadMigrationSql("20260829000100_add_workspace_authorization_helpers.sql"));
  await execSql(db, loadMigrationSql(REGISTER_MIGRATION));
  await execSql(db, SEED_SQL);
}

// Direct-SELECT counts per identity, scoped to OWNER_A's household.
async function isolationCounts(db, uid) {
  const q = async (sql) => (await asUser(db, uid, sql)).rows[0].n;
  const w = `platform_owner_id = '${OWNER_A}'`;
  return {
    accounts: Number(await q(`select count(*)::int as n from forge_external_accounts where ${w}`)),
    activeAccounts: Number(await q(`select count(*)::int as n from forge_external_accounts where ${w} and deleted_at is null`)),
    threads: Number(await q(`select count(*)::int as n from forge_external_account_threads where ${w}`)),
    audit: Number(await q(`select count(*)::int as n from forge_external_account_audit where ${w}`)),
  };
}

async function aclInventory(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  const relacl = await q(`
    select c.relname, c.relacl::text as acl from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('forge_external_accounts', 'forge_external_account_threads', 'forge_external_account_audit');
  `);
  const rls = await q(`
    select relname, relrowsecurity as enabled, relforcerowsecurity as forced from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and relname in ('forge_external_accounts', 'forge_external_account_threads', 'forge_external_account_audit');
  `);
  const proacl = await q(`
    select proname, proacl::text as acl from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and proname like 'forge_external%';
  `);
  return { relacl, rls, proacl };
}

describe("external accounts register: PGlite leg", () => {
  let db;

  beforeAll(async () => {
    db = new PGlite();
    await setupDb(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it60("household CRUD: owner + Brandy create/read/update; member/unrelated/anon get NOT_FOUND", async () => {
    const created = (await asUser(db, OWNER_A,
      `select forge_external_account_create('${createPayload("GitHub")}'::jsonb) as v;`)).rows[0].v;
    expect(created.conflict).toBe(false);
    const githubId = created.id;
    expect(typeof githubId).toBe("string");

    // Brandy's create lands under Jason's platform_owner_id, never her own.
    const brandyCreated = (await asUser(db, BRANDY,
      `select forge_external_account_create('${createPayload("Vercel")}'::jsonb) as v;`)).rows[0].v;
    expect(brandyCreated.conflict).toBe(false);
    const ownerOfBrandyRow = (await asUser(db, OWNER_A,
      `select platform_owner_id as v from forge_external_accounts where id = '${brandyCreated.id}';`)).rows[0].v;
    expect(ownerOfBrandyRow).toBe(OWNER_A);

    // Owner + Brandy see both rows; member / unrelated / revoked / anon see none.
    expect((await isolationCounts(db, OWNER_A)).accounts).toBe(2);
    expect((await isolationCounts(db, BRANDY)).accounts).toBe(2);
    expect((await isolationCounts(db, MEMBER_C)).accounts).toBe(0);
    expect((await isolationCounts(db, OWNER_X)).accounts).toBe(0);
    expect((await isolationCounts(db, REVOKED_D)).accounts).toBe(0);

    // Known-id direct read by a non-household actor yields NOT_FOUND, never the row.
    await expectRpcError(db, MEMBER_C,
      `select forge_external_account_update('${githubId}'::uuid, '{"notes":"x"}'::jsonb, 1) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_NOT_FOUND");
    await expectRpcError(db, OWNER_X,
      `select forge_external_account_update('${githubId}'::uuid, '{"notes":"x"}'::jsonb, 1) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_NOT_FOUND");
    await expectRpcError(db, REVOKED_D,
      `select forge_external_account_update('${githubId}'::uuid, '{"notes":"x"}'::jsonb, 1) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_NOT_FOUND");
    // Anon holds no EXECUTE on the RPC at all, so the call dies with a
    // generic permission denial before the function body runs — still no
    // row, no count, no name, no presence signal.
    await expectRpcError(db, null,
      `select forge_external_account_update('${githubId}'::uuid, '{"notes":"x"}'::jsonb, 1) as v;`,
      "permission denied");

    // Owner update with the right version succeeds and bumps the version.
    const updated = (await asUser(db, OWNER_A,
      `select forge_external_account_update('${githubId}'::uuid, '{"notes":"Primary source control","setup_status":"ready"}'::jsonb, 1) as v;`)).rows[0].v;
    expect(updated.version).toBe(2);
    const row = (await asUser(db, BRANDY,
      `select notes as notes, setup_status as setup, version as v from forge_external_accounts where id = '${githubId}';`)).rows[0];
    expect(row.notes).toBe("Primary source control");
    expect(row.setup).toBe("ready");
    expect(row.v).toBe(2);

    // Stale version is a conflict and writes nothing.
    await expectRpcError(db, BRANDY,
      `select forge_external_account_update('${githubId}'::uuid, '{"notes":"stale"}'::jsonb, 1) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_VERSION_CONFLICT");
    const still = (await asUser(db, OWNER_A,
      `select notes as v from forge_external_accounts where id = '${githubId}';`)).rows[0].v;
    expect(still).toBe("Primary source control");
  });

  it60("unrelated owner has their own household scope and sees zero of the owner's rows", async () => {
    const created = (await asUser(db, OWNER_X,
      `select forge_external_account_create('${createPayload("GitHub")}'::jsonb) as v;`)).rows[0].v;
    expect(created.conflict).toBe(false);
    const ownCounts = await isolationCounts(db, OWNER_X);
    expect(ownCounts.accounts).toBe(0); // scoped to OWNER_A: zero
    const ownRows = (await asUser(db, OWNER_X,
      `select count(*)::int as n from forge_external_accounts where platform_owner_id = '${OWNER_X}';`)).rows[0].n;
    expect(ownRows).toBe(1);
  });

  it60("staff and revoked members cannot write anywhere — RPC gate, RLS gate, seed, reconcile", async () => {
    // RPC gate: staff / revoked get NOT_FOUND on every write entry point,
    // including scope-creating ones (seed / reconcile) that have no row lookup.
    await expectRpcError(db, MEMBER_C,
      `select forge_external_account_create('${createPayload("StaffCo")}'::jsonb) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_NOT_FOUND");
    await expectRpcError(db, REVOKED_D,
      `select forge_external_account_create('${createPayload("RevokedCo")}'::jsonb) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_NOT_FOUND");
    await expectRpcError(db, MEMBER_C,
      `select forge_external_accounts_seed_preview('v', '[]'::jsonb) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_NOT_FOUND");
    await expectRpcError(db, MEMBER_C,
      `select forge_external_accounts_seed_apply('v', '[]'::jsonb, 'req-staff') as v;`,
      "FORGE_EXTERNAL_ACCOUNT_NOT_FOUND");
    await expectRpcError(db, REVOKED_D,
      `select forge_external_accounts_seed_preview('v', '[]'::jsonb) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_NOT_FOUND");
    await expectRpcError(db, MEMBER_C,
      `select forge_external_accounts_reconcile_lead('{"provider":"Bitwarden","account_email":"m@example.test","subject":"Welcome","date":"2026-08-14","message_ref":"msg-staff","evidence_strength":"welcome","candidate_stage":"unverified_lead"}'::jsonb) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_NOT_FOUND");
    // RLS gate: a staff member cannot even write into a scope of their own
    // id via direct SQL (the may_act predicate in every policy).
    await expectRpcError(db, MEMBER_C,
      `insert into forge_external_accounts (platform_owner_id, provider_name, purpose, associated_app, created_by, updated_by)
        values ('${MEMBER_C}', 'OwnScopeCo', 'x', 'FORGE', '${MEMBER_C}', '${MEMBER_C}');`,
      "violates row-level security policy");
    await expectRpcError(db, REVOKED_D,
      `insert into forge_external_accounts (platform_owner_id, provider_name, purpose, associated_app, created_by, updated_by)
        values ('${REVOKED_D}', 'OwnScopeCo', 'x', 'FORGE', '${REVOKED_D}', '${REVOKED_D}');`,
      "violates row-level security policy");
    // No orphan rows were created in either scope.
    expect((await asUser(db, OWNER_A,
      `select count(*)::int as n from forge_external_accounts where provider_name = 'OwnScopeCo';`)).rows[0].n).toBe(0);
  });

  it60("anonymous direct SELECT is denied at the ACL layer, not just by RLS", async () => {
    await expectRpcError(db, null,
      `select count(*)::int as n from forge_external_accounts;`,
      "permission denied");
    await expectRpcError(db, null,
      `select count(*)::int as n from forge_external_account_audit;`,
      "permission denied");
  });

  it60("delete / restore / permanent erase, with the permanent-after-delete gate", async () => {
    const created = (await asUser(db, OWNER_A,
      `select forge_external_account_create('${createPayload("ToDelete")}'::jsonb) as v;`)).rows[0].v;
    const id = created.id;
    // Permanent erase before logical delete is refused.
    await expectRpcError(db, OWNER_A,
      `select forge_external_account_delete('${id}'::uuid, true) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_NOT_DELETED");
    // Logical delete sets deleted_at; restore clears it.
    const deleted = (await asUser(db, OWNER_A,
      `select forge_external_account_delete('${id}'::uuid, false) as v;`)).rows[0].v;
    expect(deleted.deleted).toBe(true);
    const afterDelete = (await asUser(db, OWNER_A,
      `select deleted_at is not null as v from forge_external_accounts where id = '${id}';`)).rows[0].v;
    expect(afterDelete).toBe(true);
    const restored = (await asUser(db, BRANDY,
      `select forge_external_account_restore('${id}'::uuid) as v;`)).rows[0].v;
    expect(restored.restored).toBe(true);
    // Delete again, then permanent erase removes the row.
    await asUser(db, OWNER_A, `select forge_external_account_delete('${id}'::uuid, false) as v;`);
    const erased = (await asUser(db, OWNER_A,
      `select forge_external_account_delete('${id}'::uuid, true) as v;`)).rows[0].v;
    expect(erased.permanent).toBe(true);
    const gone = (await asUser(db, OWNER_A,
      `select count(*)::int as n from forge_external_accounts where id = '${id}';`)).rows[0].n;
    expect(gone).toBe(0);
    // A member cannot delete or restore the owner's rows.
    await expectRpcError(db, MEMBER_C,
      `select forge_external_account_delete('${id}'::uuid, false) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_NOT_FOUND");
  });

  it60("owner and seed_key are immutable; audit is append-only and RPC-written", async () => {
    const created = (await asUser(db, OWNER_A,
      `select forge_external_account_create('${createPayload("ImmutableCo")}'::jsonb) as v;`)).rows[0].v;
    const id = created.id;
    await expectRpcError(db, OWNER_A,
      `update forge_external_accounts set platform_owner_id = '${OWNER_X}' where id = '${id}';`,
      "FORGE_EXTERNAL_ACCOUNT_OWNER_IMMUTABLE");
    // Audit rows exist for the creates above. Authenticated holds only
    // SELECT on the audit table, so a direct UPDATE dies at the ACL layer
    // before the trigger; the trigger itself is proven below as the table
    // owner (superuser), which bypasses RLS and holds every privilege.
    const auditCount = (await asUser(db, OWNER_A,
      `select count(*)::int as n from forge_external_account_audit where platform_owner_id = '${OWNER_A}';`)).rows[0].n;
    expect(auditCount).toBeGreaterThan(0);
    const auditId = (await asUser(db, OWNER_A,
      `select id as v from forge_external_account_audit where platform_owner_id = '${OWNER_A}' limit 1;`)).rows[0].v;
    await expectRpcError(db, OWNER_A,
      `update forge_external_account_audit set action = 'update' where id = '${auditId}';`,
      "permission denied");
    await expectRpcError(db, OWNER_A,
      `insert into forge_external_account_audit (platform_owner_id, actor_user_id, action) values ('${OWNER_A}', '${OWNER_A}', 'create');`,
      "permission denied");
    // Table owner: only the append-only trigger stands in the way.
    let ownerErr = null;
    try {
      await execSql(db, `update forge_external_account_audit set action = 'update' where id = '${auditId}';`);
    } catch (e) { ownerErr = e; }
    expect(ownerErr).not.toBeNull();
    expect(String(ownerErr.message)).toContain("FORGE_EXTERNAL_ACCOUNT_AUDIT_APPEND_ONLY");
    // A member sees zero audit rows.
    expect((await isolationCounts(db, MEMBER_C)).audit).toBe(0);
  });

  it60("secret patterns are rejected by trigger (direct + RPC); a locator is accepted", async () => {
    await expectRpcError(db, OWNER_A,
      `insert into forge_external_accounts (platform_owner_id, provider_name, purpose, associated_app, credential_location, created_by, updated_by)
        values ('${OWNER_A}', 'BadCo', 'x', 'FORGE', 'sk-abcdefghijklmnop1234', '${OWNER_A}', '${OWNER_A}');`,
      "FORGE_EXTERNAL_ACCOUNT_SECRET_REJECTED");
    await expectRpcError(db, OWNER_A,
      `select forge_external_account_create('${createPayload("BadCo2", "FORGE", { credential_location: "https://user:hunter2@example.test/x" })}'::jsonb) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_SECRET_REJECTED");
    await expectRpcError(db, OWNER_A,
      `select forge_external_account_create('${createPayload("BadCo3", "FORGE", { notes: "-----BEGIN PRIVATE KEY-----" })}'::jsonb) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_SECRET_REJECTED");
    const ok = (await asUser(db, OWNER_A,
      `select forge_external_account_create('${createPayload("GoodCo", "FORGE", { credential_location: "1Password → FORGE" })}'::jsonb) as v;`)).rows[0].v;
    expect(ok.conflict).toBe(false);
  });

  it60("duplicate detection: conflict returned, allow_duplicate creates a second row", async () => {
    const first = (await asUser(db, OWNER_A,
      `select forge_external_account_create('${createPayload("Stripe", "Rental Manager", { account_email: "jasonmorgan99@gmail.com" })}'::jsonb) as v;`)).rows[0].v;
    expect(first.conflict).toBe(false);
    const dup = (await asUser(db, OWNER_A,
      `select forge_external_account_create('${createPayload("Stripe", "Rental Manager", { account_email: "jasonmorgan99@gmail.com" })}'::jsonb) as v;`)).rows[0].v;
    expect(dup.conflict).toBe(true);
    expect(dup.existing_id).toBe(first.id);
    // Same provider, different email: a different real account, no conflict.
    const other = (await asUser(db, OWNER_A,
      `select forge_external_account_create('${createPayload("Stripe", "Rental Manager", { account_email: "other@example.test" })}'::jsonb) as v;`)).rows[0].v;
    expect(other.conflict).toBe(false);
    // Explicit allow_duplicate creates the second row.
    const allowed = (await asUser(db, OWNER_A,
      `select forge_external_account_create('${createPayload("Stripe", "Rental Manager", { account_email: "jasonmorgan99@gmail.com", allow_duplicate: true })}'::jsonb) as v;`)).rows[0].v;
    expect(allowed.conflict).toBe(false);
    expect(allowed.id).not.toBe(first.id);
  });

  it60("threads: add + state, household-scoped, blocked on deleted accounts", async () => {
    const created = (await asUser(db, OWNER_A,
      `select forge_external_account_create('${createPayload("ThreadCo")}'::jsonb) as v;`)).rows[0].v;
    const id = created.id;
    const thread = (await asUser(db, BRANDY,
      `select forge_external_account_thread_add('${id}'::uuid, '{"title":"Property Risk Radar — scope GO Oct 16, build not started","reference":"briefs/property-risk-radar/","state":"open","next_action":"Start R0 source/rights records"}'::jsonb) as v;`)).rows[0].v;
    const threadOwner = (await asUser(db, OWNER_A,
      `select platform_owner_id as v from forge_external_account_threads where id = '${thread.id}';`)).rows[0].v;
    expect(threadOwner).toBe(OWNER_A);
    const state = (await asUser(db, OWNER_A,
      `select forge_external_account_thread_set_state('${thread.id}'::uuid, 'blocked', 'Waiting on camera-rights confirmation') as v;`)).rows[0].v;
    expect(state.state).toBe("blocked");
    await expectRpcError(db, MEMBER_C,
      `select forge_external_account_thread_add('${id}'::uuid, '{"title":"nope"}'::jsonb) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_NOT_FOUND");
    await asUser(db, OWNER_A, `select forge_external_account_delete('${id}'::uuid, false) as v;`);
    await expectRpcError(db, OWNER_A,
      `select forge_external_account_thread_add('${id}'::uuid, '{"title":"too late"}'::jsonb) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_NOT_FOUND");
  });

  it60("seed: preview, apply, re-apply is a no-op, owner edits survive, conflicts surface", async () => {
    const candidates = [
      { seed_key: "external_accounts_seed_v1:github", provider_name: "GitHub", purpose: "Development / source control", associated_app: "FORGE", record_status: "confirmed_account", setup_status: "ready", source_kind: "reconstructed_inventory", source_reference: "spreadsheet row: GitHub — Confirmed active" },
      { seed_key: "external_accounts_seed_v1:vercel", provider_name: "Vercel", purpose: "Hosting and deployments", associated_app: "FORGE", record_status: "confirmed_account", setup_status: "ready", source_kind: "reconstructed_inventory", source_reference: "spreadsheet row: Vercel — Confirmed active" },
      { seed_key: "external_accounts_seed_v1:resend", provider_name: "Resend", purpose: "Transactional email", associated_app: "Rental Manager", account_email: "jasonmorgan99@gmail.com", record_status: "confirmed_account", setup_status: "in_progress", source_kind: "email_crosscheck", source_reference: "gmail-crosscheck: Welcome to Resend! (2026-08-14)" },
    ];
    const preview = (await asUser(db, OWNER_A,
      `select forge_external_accounts_seed_preview('external_accounts_seed_v1', '${JSON.stringify(candidates)}'::jsonb) as v;`)).rows[0].v;
    expect(preview.creates).toBe(3);
    expect(preview.matches).toBe(0);
    expect(preview.conflicts).toBe(0);
    const applied = (await asUser(db, OWNER_A,
      `select forge_external_accounts_seed_apply('external_accounts_seed_v1', '${JSON.stringify(candidates)}'::jsonb, 'req-seed-1') as v;`)).rows[0].v;
    expect(applied.created).toBe(3);
    // Re-run: preview matches everything, apply creates nothing.
    const preview2 = (await asUser(db, OWNER_A,
      `select forge_external_accounts_seed_preview('external_accounts_seed_v1', '${JSON.stringify(candidates)}'::jsonb) as v;`)).rows[0].v;
    expect(preview2.creates).toBe(0);
    expect(preview2.matches).toBe(3);
    const applied2 = (await asUser(db, OWNER_A,
      `select forge_external_accounts_seed_apply('external_accounts_seed_v1', '${JSON.stringify(candidates)}'::jsonb, 'req-seed-2') as v;`)).rows[0].v;
    expect(applied2.created).toBe(0);
    // Owner edits a seeded row; a re-apply must not overwrite it.
    const seededId = (await asUser(db, OWNER_A,
      `select id as v from forge_external_accounts where seed_key = 'external_accounts_seed_v1:resend';`)).rows[0].v;
    const version = (await asUser(db, OWNER_A,
      `select version as v from forge_external_accounts where id = '${seededId}';`)).rows[0].v;
    await asUser(db, OWNER_A,
      `select forge_external_account_update('${seededId}'::uuid, '{"notes":"Owner note — do not overwrite"}'::jsonb, ${version}) as v;`);
    await asUser(db, OWNER_A,
      `select forge_external_accounts_seed_apply('external_accounts_seed_v1', '${JSON.stringify(candidates)}'::jsonb, 'req-seed-3') as v;`);
    const notes = (await asUser(db, OWNER_A,
      `select notes as v from forge_external_accounts where id = '${seededId}';`)).rows[0].v;
    expect(notes).toBe("Owner note — do not overwrite");
    // Same seed_key with a different identity is a conflict, never a silent merge.
    const conflictCandidates = [{ ...candidates[0], provider_name: "Not GitHub" }];
    const preview3 = (await asUser(db, OWNER_A,
      `select forge_external_accounts_seed_preview('external_accounts_seed_v1', '${JSON.stringify(conflictCandidates)}'::jsonb) as v;`)).rows[0].v;
    expect(preview3.conflicts).toBe(1);
    expect(preview3.creates).toBe(0);
    // A member cannot preview or apply the seed.
    await expectRpcError(db, MEMBER_C,
      `select forge_external_accounts_seed_preview('external_accounts_seed_v1', '[]'::jsonb) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_NOT_FOUND");
  });

  it60("reconcile: create / match / duplicate-on-message-ref; provider alone never merges", async () => {
    const lead = (provider, email, ref) => JSON.stringify({
      provider, account_email: email, subject: `Welcome to ${provider}`,
      date: "2026-08-14", message_ref: ref, evidence_strength: "welcome",
      candidate_stage: "unverified_lead",
    });
    const first = (await asUser(db, OWNER_A,
      `select forge_external_accounts_reconcile_lead('${lead("Bitwarden", "jasonmorgan99@gmail.com", "gmail-msg-1")}'::jsonb) as v;`)).rows[0].v;
    expect(first.decision).toBe("created");
    const row = (await asUser(db, OWNER_A,
      `select record_status as r, source_kind as s from forge_external_accounts where id = '${first.account_id}';`)).rows[0];
    expect(row.r).toBe("unverified_lead");
    expect(row.s).toBe("email_crosscheck");
    // Same message ref again: duplicate, same account, no second row.
    const dup = (await asUser(db, OWNER_A,
      `select forge_external_accounts_reconcile_lead('${lead("Bitwarden", "jasonmorgan99@gmail.com", "gmail-msg-1")}'::jsonb) as v;`)).rows[0].v;
    expect(dup.decision).toBe("duplicate");
    expect(dup.account_id).toBe(first.account_id);
    // Same provider + email, new message ref: match (confirm-link), no new row.
    const match = (await asUser(db, OWNER_A,
      `select forge_external_accounts_reconcile_lead('${lead("Bitwarden", "jasonmorgan99@gmail.com", "gmail-msg-2")}'::jsonb) as v;`)).rows[0].v;
    expect(match.decision).toBe("match");
    expect(match.account_id).toBe(first.account_id);
    // Same provider, different email: a different account — created, never merged.
    const other = (await asUser(db, OWNER_A,
      `select forge_external_accounts_reconcile_lead('${lead("Bitwarden", "other@example.test", "gmail-msg-3")}'::jsonb) as v;`)).rows[0].v;
    expect(other.decision).toBe("created");
    expect(other.account_id).not.toBe(first.account_id);
    await expectRpcError(db, MEMBER_C,
      `select forge_external_accounts_reconcile_lead('${lead("Nope", null, "gmail-msg-9")}'::jsonb) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_NOT_FOUND");
  });

  it60("ACL inventory: anon holds nothing; authenticated is RLS-gated; RPC-only helpers grant EXECUTE to nobody (may_act excepted — the RLS policies call it)", async () => {
    const { relacl, rls, proacl } = await aclInventory(db);
    expect(rls).toHaveLength(3);
    for (const table of rls) {
      expect(table.enabled, `${table.relname} RLS`).toBe(true);
      expect(table.forced, `${table.relname} FORCE RLS`).toBe(true);
    }
    for (const table of relacl) {
      expect(table.acl, `${table.relname} relacl`).not.toContain("anon=");
      // The table OWNER (postgres) legitimately holds full rights; the
      // check below is about every OTHER grantee, so strip that entry first.
      const othersAcl = table.acl.replace(/postgres=[^,}]*/g, "");
      expect(othersAcl, `${table.relname} relacl`).not.toContain("=arwdDxt");
    }
    const accountsAcl = relacl.find((t) => t.relname === "forge_external_accounts").acl;
    expect(accountsAcl).toContain("authenticated=arwd");
    expect(accountsAcl).not.toContain("authenticated=arwdDxt");
    const auditAcl = relacl.find((t) => t.relname === "forge_external_account_audit").acl;
    expect(auditAcl).toContain("authenticated=r");
    expect(auditAcl).not.toContain("authenticated=arwd");
    const publicRpcs = [
      "forge_external_account_create", "forge_external_account_update",
      "forge_external_account_delete", "forge_external_account_restore",
      "forge_external_account_thread_add", "forge_external_account_thread_set_state",
      "forge_external_accounts_seed_preview", "forge_external_accounts_seed_apply",
      "forge_external_accounts_reconcile_lead",
    ];
    for (const name of publicRpcs) {
      const row = proacl.find((p) => p.proname === name);
      expect(row, `${name} proacl`).toBeDefined();
      expect(row.acl, `${name} proacl`).toContain("authenticated=X");
      expect(row.acl, `${name} proacl`).not.toContain("anon=X");
      expect(row.acl, `${name} proacl`).not.toContain("service_role=X");
      expect(row.acl, `${name} proacl`).not.toMatch(/(^|[,{])=X\//); // no PUBLIC execute
    }
    const helper = proacl.find((p) => p.proname === "forge_external_account_require_household");
    expect(helper.acl, "household helper proacl").not.toContain("authenticated=X");
    expect(helper.acl, "household helper proacl").not.toContain("anon=X");
    const auditHelper = proacl.find((p) => p.proname === "forge_external_account_audit_insert");
    expect(auditHelper.acl, "audit helper proacl").not.toContain("authenticated=X");
    expect(auditHelper.acl, "audit helper proacl").not.toContain("anon=X");
    // may_act is the ONE helper authenticated may execute: the RLS policies
    // call it directly, and a policy expression runs as the querying user.
    // It is a boolean predicate about the caller's own membership only.
    const mayAct = proacl.find((p) => p.proname === "forge_external_account_actor_may_act");
    expect(mayAct, "may_act proacl").toBeDefined();
    expect(mayAct.acl, "may_act proacl").toContain("authenticated=X");
    expect(mayAct.acl, "may_act proacl").not.toContain("anon=X");
    expect(mayAct.acl, "may_act proacl").not.toContain("service_role=X");
    expect(mayAct.acl, "may_act proacl").not.toMatch(/(^|[,{])=X\//); // no PUBLIC execute
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

describe.skipIf(!HAS_REAL_PG)("external accounts register: real-PostgreSQL 16 leg", () => {
  let pgDir;
  let pgClient;
  let pgCfg;

  beforeAll(async () => {
    pgDir = mkdtempSync(join(tmpdir(), "ear-realpg-"));
    execSync(`chown ${PG_RUN_USER}:${PG_RUN_USER} "${pgDir}"`, { stdio: "pipe" });
    const asPgUser = (cmd) => `runuser -u ${PG_RUN_USER} -- ${cmd}`;
    execSync(asPgUser(`"${PG_BIN}/initdb" -D "${pgDir}" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8`), { stdio: "pipe" });
    execSync(
      asPgUser(`"${PG_BIN}/pg_ctl" -D "${pgDir}" -o "-p 55438 -k ${pgDir} -c listen_addresses=''" -l "${pgDir}/server.log" start`),
      { stdio: "pipe" },
    );
    pgCfg = { host: pgDir, port: 55438, user: "postgres", database: "postgres" };
    pgClient = new Client(pgCfg);
    await pgClient.connect();
    await setupDb(pgClient);
  }, 180000);

  afterAll(async () => {
    try { await pgClient?.end(); } catch { /* already closed */ }
    if (pgDir) {
      try { execSync(`runuser -u ${PG_RUN_USER} -- "${PG_BIN}/pg_ctl" -D "${pgDir}" stop -m fast`, { stdio: "pipe" }); } catch { /* already stopped */ }
      rmSync(pgDir, { recursive: true, force: true });
    }
  }, 120000);

  it60("real PG16: the six-identity isolation matrix holds on the real server", async () => {
    const github = (await asUser(pgClient, OWNER_A,
      `select forge_external_account_create('${createPayload("GitHub")}'::jsonb) as v;`)).rows[0].v;
    expect(github.conflict).toBe(false);
    const brandy = (await asUser(pgClient, BRANDY,
      `select forge_external_account_create('${createPayload("Vercel")}'::jsonb) as v;`)).rows[0].v;
    expect(brandy.conflict).toBe(false);
    expect((await isolationCounts(pgClient, OWNER_A)).accounts).toBe(2);
    expect((await isolationCounts(pgClient, BRANDY)).accounts).toBe(2);
    expect((await isolationCounts(pgClient, MEMBER_C)).accounts).toBe(0);
    expect((await isolationCounts(pgClient, OWNER_X)).accounts).toBe(0);
    expect((await isolationCounts(pgClient, REVOKED_D)).accounts).toBe(0);
    await expectRpcError(pgClient, MEMBER_C,
      `select forge_external_account_update('${github.id}'::uuid, '{"notes":"x"}'::jsonb, 1) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_NOT_FOUND");
    await expectRpcError(pgClient, REVOKED_D,
      `select forge_external_account_update('${github.id}'::uuid, '{"notes":"x"}'::jsonb, 1) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_NOT_FOUND");
    await expectRpcError(pgClient, MEMBER_C,
      `select forge_external_accounts_seed_preview('v', '[]'::jsonb) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_NOT_FOUND");
    await expectRpcError(pgClient, null,
      `select count(*)::int as n from forge_external_accounts;`,
      "permission denied");
  });

  it60("real PG16: seed apply + reconcile + ACL inventory match the PGlite leg", async () => {
    const candidates = [
      { seed_key: "external_accounts_seed_v1:github", provider_name: "GitHub", purpose: "Development / source control", associated_app: "FORGE", record_status: "confirmed_account", setup_status: "ready", source_kind: "reconstructed_inventory", source_reference: "spreadsheet row: GitHub — Confirmed active" },
      { seed_key: "external_accounts_seed_v1:resend", provider_name: "Resend", purpose: "Transactional email", associated_app: "Rental Manager", account_email: "jasonmorgan99@gmail.com", record_status: "confirmed_account", setup_status: "in_progress", source_kind: "email_crosscheck", source_reference: "gmail-crosscheck: Welcome to Resend! (2026-08-14)" },
    ];
    const applied = (await asUser(pgClient, OWNER_A,
      `select forge_external_accounts_seed_apply('external_accounts_seed_v1', '${JSON.stringify(candidates)}'::jsonb, 'req-seed-realpg') as v;`)).rows[0].v;
    expect(applied.created).toBe(2);
    const applied2 = (await asUser(pgClient, OWNER_A,
      `select forge_external_accounts_seed_apply('external_accounts_seed_v1', '${JSON.stringify(candidates)}'::jsonb, 'req-seed-realpg-2') as v;`)).rows[0].v;
    expect(applied2.created).toBe(0);
    const lead = JSON.stringify({ provider: "Bitwarden", account_email: "jasonmorgan99@gmail.com", subject: "Welcome to Bitwarden!", date: "2026-08-27", message_ref: "gmail-msg-bw-1", evidence_strength: "welcome", candidate_stage: "unverified_lead" });
    const reconciled = (await asUser(pgClient, OWNER_A,
      `select forge_external_accounts_reconcile_lead('${lead}'::jsonb) as v;`)).rows[0].v;
    expect(reconciled.decision).toBe("created");
    const { relacl, rls, proacl } = await aclInventory(pgClient);
    expect(rls).toHaveLength(3);
    for (const table of rls) {
      expect(table.enabled).toBe(true);
      expect(table.forced).toBe(true);
    }
    for (const table of relacl) {
      expect(table.acl).not.toContain("anon=");
    }
    const createAcl = proacl.find((p) => p.proname === "forge_external_account_create").acl;
    expect(createAcl).toContain("authenticated=X");
    expect(createAcl).not.toContain("anon=X");
  });
});

describe("external accounts register: NON-VACUITY (each guard proven load-bearing)", () => {
  let db;

  beforeAll(async () => {
    db = new PGlite();
    await setupDb(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it60("reverting the household select policy leaks rows to a member", async () => {
    await asUser(db, OWNER_A,
      `select forge_external_account_create('${createPayload("LeakCo")}'::jsonb) as v;`);
    expect((await isolationCounts(db, MEMBER_C)).accounts).toBe(0);
    // Dropping the only SELECT policy denies everyone (deny-by-default), so
    // it cannot leak — the load-bearing probe is to REPLACE it with a
    // permissive one, watch the member see the row, then restore.
    const restore = `create policy forge_external_accounts_household_select on public.forge_external_accounts for select to authenticated using (public.forge_external_account_actor_may_act() and public.has_workspace_access(platform_owner_id));`;
    try {
      await execSql(db, `drop policy forge_external_accounts_household_select on public.forge_external_accounts;`);
      await execSql(db, `create policy forge_external_accounts_household_select on public.forge_external_accounts for select to authenticated using (true);`);
      expect((await isolationCounts(db, MEMBER_C)).accounts).toBe(1);
    } finally {
      await execSql(db, `drop policy if exists forge_external_accounts_household_select on public.forge_external_accounts;`);
      await execSql(db, restore);
    }
    expect((await isolationCounts(db, MEMBER_C)).accounts).toBe(0);
  });

  it60("dropping the secret trigger lets a credential through", async () => {
    // Probe via the RPC (SECURITY DEFINER, bypasses RLS): with the trigger
    // gone the secret must land; with it restored the same call must fail.
    await execSql(db, `drop trigger forge_external_accounts_reject_secrets on public.forge_external_accounts;`);
    try {
      const created = (await asUser(db, OWNER_A,
        `select forge_external_account_create('${createPayload("LeakSecret", "FORGE", { credential_location: "sk-abcdefghijklmnop1234" })}'::jsonb) as v;`)).rows[0].v;
      expect(created.conflict).toBe(false);
    } finally {
      await execSql(db, `create trigger forge_external_accounts_reject_secrets before insert or update on public.forge_external_accounts for each row execute function public.forge_external_accounts_reject_secrets();`);
    }
    await expectRpcError(db, OWNER_A,
      `select forge_external_account_create('${createPayload("LeakSecret2", "FORGE", { credential_location: "sk-abcdefghijklmnop1234" })}'::jsonb) as v;`,
      "FORGE_EXTERNAL_ACCOUNT_SECRET_REJECTED");
  });

  it60("dropping the audit append-only trigger lets an audit row be changed", async () => {
    await asUser(db, OWNER_A,
      `select forge_external_account_create('${createPayload("AuditCo")}'::jsonb) as v;`);
    const auditId = (await asUser(db, OWNER_A,
      `select id as v from forge_external_account_audit limit 1;`)).rows[0].v;
    // Authenticated holds only SELECT on audit, so the probe runs as the
    // table owner (superuser): RLS and ACL both pass, only the trigger
    // stands in the way.
    await execSql(db, `drop trigger forge_external_account_audit_append_only on public.forge_external_account_audit;`);
    try {
      await execSql(db, `update forge_external_account_audit set action = 'update' where id = '${auditId}';`);
      const changed = (await asUser(db, OWNER_A,
        `select action as v from forge_external_account_audit where id = '${auditId}';`)).rows[0].v;
      expect(changed).toBe("update");
    } finally {
      await execSql(db, `create trigger forge_external_account_audit_append_only before update or delete on public.forge_external_account_audit for each row execute function public.forge_external_account_audit_append_only();`);
    }
  });
});
