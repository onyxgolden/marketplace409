// Rental Manager admin permissions — slice 1: real-PostgreSQL proof.
//
// Runs against a scratch PostgreSQL 16 cluster (never production, never the
// linked Supabase project). It proves, on REAL Postgres rather than PGlite:
//   A. The migration applies cleanly on top of the REAL prior function
//      definitions (has_workspace_access / has_rental_permission as defined
//      by the R17 NO-GO fix, 20261001070500) and the REAL #753 billing
//      policies (20261108000000) — not stubs.
//   B. The legacy R17 branch is unchanged by the has_rental_permission
//      replacement (role defaults, overrides, team.manage).
//   C. The #753 billing gates still enforce after this migration (owner can
//      insert the cutover audit + billing settings; a same-workspace manager
//      cannot).
//   D. Concurrent role edits with the same expected version: exactly one
//      wins, the other gets the stale-version error, version bumps once.
//   E. Atomicity: if the audit insert fails, the role change rolls back
//      entirely (version + capabilities unchanged, no audit row).
//   F. RLS tenant/maintenance spot checks per role (the full matrix lives
//      in the PGlite migration test).
//   G. Effective ACL / RLS / function EXECUTE receipts (written to
//      proof-receipts.json next to this script). The proof sets
//      Supabase-like default privileges before applying the slice-1
//      migration (PR #766 P1), so G3/G5 assert against the production ACL
//      shape instead of passing vacuously on a defaults-free cluster.
//
// Usage (from the repo root, with a scratch cluster running):
//   PGHOST=/tmp/rental-admin-pg16 PGPORT=54399 PGUSER=postgres PGDATABASE=postgres \
//     node scripts/rental-admin-permissions-proof/proof.mjs
// Start a scratch cluster with:
//   runuser -u postgres -- /usr/lib/postgresql/16/bin/initdb -D /tmp/rental-admin-pg16/data -U postgres --auth=trust
//   runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D /tmp/rental-admin-pg16/data \
//     -o "-p 54399 -k /tmp/rental-admin-pg16" -l /tmp/rental-admin-pg16/server.log start
//
// Exit 0 when every check passes; exit 1 otherwise. Prints one line per check.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const readMigration = (name) => readFileSync(path.join(repoRoot, "supabase", "migrations", name), "utf8");

const OWNER = "11111111-1111-1111-1111-111111111111";
const CO_OWNER = "22222222-2222-2222-2222-222222222222";
const MANAGER = "33333333-3333-3333-3333-333333333333";
const BOOKKEEPER = "44444444-4444-4444-4444-444444444444";
const READ_ONLY = "55555555-5555-5555-5555-555555555555";
const OTHER_OWNER = "77777777-7777-7777-7777-777777777777";
const OUTSIDER = "88888888-8888-8888-8888-888888888888";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function expectRejected(promise, pattern) {
  try {
    await promise;
    return { threw: false, message: "" };
  } catch (error) {
    const message = String(error.message || error);
    return { threw: true, message, matched: pattern.test(message) };
  }
}

const pool = new pg.Pool({
  host: process.env.PGHOST || "/tmp/rental-admin-pg16",
  port: Number(process.env.PGPORT || 54399),
  user: process.env.PGUSER || "postgres",
  database: process.env.PGDATABASE || "postgres",
  // Seven long-lived actor clients + the admin client are held at once;
  // the pool must fit them all or pool.connect() waits forever.
  max: 12,
});

// One client per actor: SET ROLE authenticated + test.actor (the auth.uid()
// stub reads it). The RPCs are SECURITY DEFINER; RLS is evaluated as
// `authenticated`, exactly like the app's client.
async function actorClient(actorUuid) {
  const client = await pool.connect();
  await client.query("set role authenticated");
  await client.query("select set_config('test.actor', $1, false)", [actorUuid]);
  return client;
}

async function main() {
  const admin = await pool.connect();
  try {
    // ---------------------------------------------------------------- setup
    // Roles are cluster-global and survive a database drop, so create them
    // idempotently (a re-run against a fresh database must not fail here).
    await admin.query(`
      do $$ begin
        create role authenticated nologin;
      exception when duplicate_object then null;
      end $$;
      do $$ begin
        create role anon nologin;
      exception when duplicate_object then null;
      end $$;
      do $$ begin
        create role service_role nologin;
      exception when duplicate_object then null;
      end $$;
      create schema auth;
      create table auth.users (id uuid not null primary key, email text, email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.actor', true), '')::uuid
      $$;
      create table workspace_members (
        owner_id text not null, id text not null, member_user_id uuid not null,
        role text not null, status text not null default 'invited',
        invited_email text not null, invited_by uuid not null,
        invited_at timestamptz not null default now(), activated_at timestamptz,
        permission_overrides jsonb not null default '{}'::jsonb,
        primary key (owner_id, id)
      );
      grant select, insert, update, delete on workspace_members to authenticated;
      create table rental_tenants (
        id text not null primary key, owner_id text not null, email text,
        invited_at timestamptz, status text not null default 'active',
        updated_at timestamptz not null default now()
      );
      alter table rental_tenants enable row level security;
      grant select, insert, update, delete on rental_tenants to authenticated;
      create table rental_maintenance_requests (
        id text not null primary key, owner_id text not null,
        status text not null default 'open', updated_at timestamptz not null default now()
      );
      alter table rental_maintenance_requests enable row level security;
      grant select, insert, update, delete on rental_maintenance_requests to authenticated;
      create table rental_maintenance_work_orders (
        id text not null primary key, owner_id text not null,
        status text not null default 'open', updated_at timestamptz not null default now()
      );
      alter table rental_maintenance_work_orders enable row level security;
      grant select, insert, update, delete on rental_maintenance_work_orders to authenticated;
    `);
    // Billing tables for the #753 gates (minimal columns: the policies only
    // reference owner_id; RLS is enabled exactly as in production).
    for (const table of [
      "rent_schedule_collection_cutover_audit",
      "rental_billing_settings",
      "rental_billing_settings_audit",
      "rental_late_fee_settings_audit",
      "rental_payment_policy_audit",
      "rental_convenience_fee_audit",
    ]) {
      await admin.query(`
        create table ${table} (id text not null primary key, owner_id text not null);
        alter table ${table} enable row level security;
        grant select, insert, update, delete on ${table} to authenticated;
      `);
    }
    // Owner policy for the fixture tables (production shape: FOR ALL with
    // has_workspace_access) — created AFTER the real functions land below.
    await admin.query(`
      insert into auth.users (id, email, email_confirmed_at) values
        ('${OWNER}', 'owner@example.com', now()),
        ('${CO_OWNER}', 'coowner@example.com', now()),
        ('${MANAGER}', 'manager@example.com', now()),
        ('${BOOKKEEPER}', 'bookkeeper@example.com', now()),
        ('${READ_ONLY}', 'readonly@example.com', now()),
        ('${OTHER_OWNER}', 'other@example.com', now()),
        ('${OUTSIDER}', 'outsider@example.com', now());
      insert into workspace_members (owner_id, id, member_user_id, role, status, invited_email, invited_by, activated_at) values
        ('${OWNER}', 'wm_co', '${CO_OWNER}', 'co_owner', 'active', 'coowner@example.com', '${OWNER}', now()),
        ('${OWNER}', 'wm_mgr', '${MANAGER}', 'manager', 'active', 'manager@example.com', '${OWNER}', now()),
        ('${OWNER}', 'wm_bk', '${BOOKKEEPER}', 'bookkeeper', 'active', 'bookkeeper@example.com', '${OWNER}', now()),
        ('${OWNER}', 'wm_ro', '${READ_ONLY}', 'read_only', 'active', 'readonly@example.com', '${OWNER}', now());
      insert into rental_tenants (id, owner_id, email) values ('tenant_1', '${OWNER}', 'tenant@example.com');
      insert into rental_maintenance_requests (id, owner_id) values ('maint_1', '${OWNER}');
      insert into rental_maintenance_work_orders (id, owner_id) values ('wo_1', '${OWNER}');
    `);

    // A. Real prior definitions: extract the three functions from the NO-GO
    // fix migration (has_workspace_access, has_workspace_visibility,
    // has_rental_permission) — the authoritative final state, not a stub.
    const noGo = readMigration("20261001070500_r17_no_go_security_fix.sql");
    const start = noGo.indexOf("create or replace function public.has_workspace_access");
    const end = noGo.indexOf("create or replace function public.update_workspace_member");
    if (start < 0 || end < 0 || end <= start) throw new Error("could not extract the NO-GO fix functions");
    await admin.query(noGo.slice(start, end));
    check("A1 real NO-GO fix functions apply", true);

    // Owner policies for the fixture tables (need has_workspace_access).
    // The billing tables also need a SELECT policy (production has the
    // no-go-fix staff_visibility_select + owner policies): with RLS
    // enabled and no SELECT policy, even the owner reads zero rows.
    await admin.query(`
      create policy "rental_tenants_owner_all" on rental_tenants for all to authenticated
        using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
      create policy "rental_maintenance_owner_all" on rental_maintenance_requests for all to authenticated
        using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
      create policy "rental_work_order_owner_all" on rental_maintenance_work_orders for all to authenticated
        using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
      create policy "billing_owner_select" on rent_schedule_collection_cutover_audit for select to authenticated
        using (has_workspace_access(owner_id));
      create policy "billing_owner_select" on rental_billing_settings for select to authenticated
        using (has_workspace_access(owner_id));
      create policy "billing_owner_select" on rental_billing_settings_audit for select to authenticated
        using (has_workspace_access(owner_id));
      create policy "billing_owner_select" on rental_late_fee_settings_audit for select to authenticated
        using (has_workspace_access(owner_id));
      create policy "billing_owner_select" on rental_payment_policy_audit for select to authenticated
        using (has_workspace_access(owner_id));
      create policy "billing_owner_select" on rental_convenience_fee_audit for select to authenticated
        using (has_workspace_access(owner_id));
    `);

    // Real #753 billing migration, then this slice's migration.
    await admin.query(readMigration("20261108000000_rental_billing_audit_insert_policies.sql"));
    check("A2 real #753 billing migration applies", true);
    // Supabase-like default privileges (the PR #766 P1): production's
    // pg_default_acl grants function EXECUTE to the NAMED roles
    // anon/authenticated/service_role with no PUBLIC entry, so a
    // REVOKE ... FROM public alone is a no-op. Set them here, before the
    // slice-1 migration, so G3/G5 assert against the production ACL shape
    // instead of passing vacuously on a defaults-free cluster. (Set after
    // the NO-GO fix / #753 applies so only the slice-1 objects under test
    // pick the defaults up.)
    await admin.query(`
      do $$ begin
        execute format(
          'alter default privileges for role %I in schema public grant execute on functions to anon, authenticated, service_role',
          current_user
        );
      end $$;
    `);
    check("A2b Supabase-like function defaults set (anon/authenticated/service_role)", true);
    await admin.query(readMigration("20261110010000_rental_admin_roles_slice1.sql"));
    check("A3 slice-1 migration applies on top of the real priors", true);

    // ------------------------------------------------------------ B. legacy
    const asManager = await actorClient(MANAGER);
    const asBookkeeper = await actorClient(BOOKKEEPER);
    const asReadOnly = await actorClient(READ_ONLY);
    const asOwner = await actorClient(OWNER);
    const asCoOwner = await actorClient(CO_OWNER);
    const asOutsider = await actorClient(OUTSIDER);
    const hasKey = async (client, key) => {
      const r = await client.query("select has_rental_permission($1, $2) as has_key", [OWNER, key]);
      return r.rows[0].has_key;
    };
    check("B1 R17 manager keeps payments.record, loses team.manage",
      (await hasKey(asManager, "payments.record")) === true &&
      (await hasKey(asManager, "team.manage")) === false);
    check("B2 R17 bookkeeper keeps reports.view, loses tenants.manage",
      (await hasKey(asBookkeeper, "reports.view")) === true &&
      (await hasKey(asBookkeeper, "tenants.manage")) === false);
    check("B3 R17 read-only keeps nothing; co-owner keeps everything",
      (await hasKey(asReadOnly, "payments.record")) === false &&
      (await hasKey(asCoOwner, "team.manage")) === true);
    check("B4 no new-framework key before any assignment",
      (await hasKey(asManager, "rental.tenants.create")) === false &&
      (await hasKey(asManager, "rental.tenants.read")) === false);

    // ------------------------------------------------------------ C. #753
    const cutoverInsert = "insert into rent_schedule_collection_cutover_audit (id, owner_id) values ('cut_1', $1)";
    const settingsUpsert = "insert into rental_billing_settings (id, owner_id) values ('set_1', $1)";
    const settingsUpdate = "update rental_billing_settings set owner_id = $1 where id = 'set_1'";
    await asOwner.query(cutoverInsert, [OWNER]);
    await asOwner.query(settingsUpsert, [OWNER]);
    await asOwner.query(settingsUpdate, [OWNER]);
    check("C1 #753 owner can insert cutover audit + billing settings, and update settings", true);
    const denied1 = await expectRejected(asManager.query(cutoverInsert, [OWNER]), /row-level security/);
    const denied2 = await expectRejected(asManager.query(settingsUpsert, [OWNER]), /row-level security/);
    // An UPDATE whose USING clause matches no row succeeds silently with 0
    // rows affected (RLS filters the row out) — that IS the denial, not an
    // error. Assert the row is untouched instead.
    const upd = await asManager.query(settingsUpdate, [OWNER]);
    const settingsRow = await asOwner.query("select owner_id from rental_billing_settings where id = 'set_1'");
    check("C2 #753 same-workspace manager is denied all three billing writes",
      denied1.threw && denied2.threw && upd.rowCount === 0 && settingsRow.rows[0].owner_id === OWNER,
      `cutover-insert denied=${denied1.threw} settings-insert denied=${denied2.threw} settings-update rows=${upd.rowCount}`);

    // ------------------------------------------------------- D/E/F. roles
    await asOwner.query("select rental_ensure_starter_roles($1)", [OWNER]);
    const mgrRole = await asOwner.query(
      "select id from rental_roles where owner_id = $1 and name = 'manager'", [OWNER]);
    const managerRoleId = mgrRole.rows[0].id;
    await asOwner.query("select rental_assign_role($1, $2, $3, 'proof-assign-1')",
      [OWNER, MANAGER, managerRoleId]);
    check("F1 manager gains tenants.create after assignment, not tenants.remove",
      (await hasKey(asManager, "rental.tenants.create")) === true &&
      (await hasKey(asManager, "rental.tenants.remove")) === false);
    await asManager.query(
      "insert into rental_tenants (id, owner_id, email) values ('tenant_mgr', $1, 'mgr@example.com')", [OWNER]);
    check("F2 manager can INSERT a tenant via RLS", true);
    const roDenied = await expectRejected(
      asReadOnly.query("insert into rental_tenants (id, owner_id, email) values ('tenant_ro', $1, 'ro@example.com')", [OWNER]),
      /row-level security/);
    check("F3 read-only cannot INSERT a tenant", roDenied.threw);
    const del = await asManager.query("delete from rental_tenants where id = 'tenant_mgr'");
    const stillThere = await asManager.query("select id from rental_tenants where id = 'tenant_mgr'");
    check("F4 staff DELETE affects 0 rows (no DELETE policy in slice 1)",
      del.rowCount === 0 && stillThere.rows.length === 1);
    await asManager.query(
      "insert into rental_maintenance_requests (id, owner_id) values ('maint_mgr', $1)", [OWNER]);
    check("F5 manager can INSERT a maintenance request", true);

    // D. Concurrent role edits, same expected version: exactly one wins.
    // Two SEPARATE owner clients, so the updates are truly concurrent
    // (one pg client serializes its own queries).
    const versionRow = await asOwner.query("select version from rental_roles where id = $1", [managerRoleId]);
    const version = versionRow.rows[0].version;
    const asOwner2 = await actorClient(OWNER);
    const editA = asOwner.query(
      "select rental_update_role($1, $2, array['rental.tenants.invite'], null, $3, 'proof-conc-a')",
      [OWNER, managerRoleId, version]);
    const editB = asOwner2.query(
      "select rental_update_role($1, $2, array['rental.documents.delete'], null, $3, 'proof-conc-b')",
      [OWNER, managerRoleId, version]);
    const [resA, resB] = await Promise.allSettled([editA, editB]);
    asOwner2.release();
    const winners = [resA, resB].filter((r) => r.status === "fulfilled").length;
    const stale = [resA, resB].filter(
      (r) => r.status === "rejected" && /stale version/.test(String(r.reason?.message || r.reason))).length;
    const afterVersion = await asOwner.query("select version from rental_roles where id = $1", [managerRoleId]);
    check("D1 concurrent edits: exactly one wins, one stale, version +1",
      winners === 1 && stale === 1 && afterVersion.rows[0].version === version + 1,
      `winners=${winners} stale=${stale} version ${version}->${afterVersion.rows[0].version}`);
    // Clean up the winner's added key so later checks see the stock role.
    const curVersion = afterVersion.rows[0].version;
    const caps = await asOwner.query(
      "select capability_key from rental_role_capabilities where role_id = $1 and capability_key in ('rental.tenants.invite', 'rental.documents.delete')",
      [managerRoleId]);
    const addedKey = caps.rows[0]?.capability_key;
    if (addedKey) {
      await asOwner.query(
        "select rental_update_role($1, $2, null, array[$3], $4, 'proof-conc-cleanup')",
        [OWNER, managerRoleId, addedKey, curVersion]);
    }

    // E. Atomicity: force the audit insert to fail, verify full rollback.
    const preVersion = await asOwner.query("select version from rental_roles where id = $1", [managerRoleId]);
    const preCaps = await asOwner.query(
      "select count(*)::int as n from rental_role_capabilities where role_id = $1", [managerRoleId]);
    const preAudit = await asOwner.query(
      "select count(*)::int as n from rental_role_audit where owner_id = $1", [OWNER]);
    await admin.query(`
      create or replace function proof_fail_audit() returns trigger language plpgsql as $$
      begin
        if new.detail ->> 'request_id' = 'proof-atomic-fail' then
          raise exception 'proof-induced audit failure';
        end if;
        return new;
      end $$;
      create trigger proof_fail_audit_trigger before insert on rental_role_audit
        for each row execute function proof_fail_audit();
    `);
    const atomic = await expectRejected(
      asOwner.query(
        "select rental_update_role($1, $2, array['rental.tenants.invite'], null, $3, 'proof-atomic-fail')",
        [OWNER, managerRoleId, preVersion.rows[0].version]),
      /proof-induced audit failure/);
    const postVersion = await asOwner.query("select version from rental_roles where id = $1", [managerRoleId]);
    const postCaps = await asOwner.query(
      "select count(*)::int as n from rental_role_capabilities where role_id = $1", [managerRoleId]);
    const postAudit = await asOwner.query(
      "select count(*)::int as n from rental_role_audit where owner_id = $1", [OWNER]);
    await admin.query("drop trigger proof_fail_audit_trigger on rental_role_audit; drop function proof_fail_audit();");
    check("E1 audit failure rolls the role change back entirely",
      atomic.threw &&
      postVersion.rows[0].version === preVersion.rows[0].version &&
      postCaps.rows[0].n === preCaps.rows[0].n &&
      postAudit.rows[0].n === preAudit.rows[0].n,
      `version ${preVersion.rows[0].version}->${postVersion.rows[0].version}, caps ${preCaps.rows[0].n}->${postCaps.rows[0].n}, audit ${preAudit.rows[0].n}->${postAudit.rows[0].n}`);

    // ------------------------------------------------------------ G. receipts
    const receipts = {};
    receipts.role_table_acl = (await admin.query(`
      select c.relname as table_name, c.relacl::text as relacl,
             c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relname in ('rental_roles', 'rental_role_capabilities', 'rental_user_roles', 'rental_role_audit')
      order by c.relname`)).rows;
    receipts.function_acl = (await admin.query(`
      select p.proname, p.proacl::text as proacl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
      where p.proname like 'rental_%' order by p.proname`)).rows;
    receipts.new_policies = (await admin.query(`
      select schemaname, tablename, policyname, cmd, roles::text
      from pg_policies
      where policyname like 'rental_%admin%' or policyname like '%_owner_select'
      order by tablename, policyname`)).rows;
    receipts.billing_753_policies = (await admin.query(`
      select tablename, policyname from pg_policies
      where policyname in ('rent_schedule_cutover_audit_owner_insert',
        'rental_billing_settings_audit_owner_insert', 'late_fee_settings_audit_owner_insert',
        'payment_policy_audit_owner_insert', 'convenience_fee_audit_owner_insert',
        'rental_billing_settings_owner_insert', 'rental_billing_settings_owner_update')
      order by tablename, policyname`)).rows;
    receipts.has_workspace_access_live_shape = (await admin.query(`
      select pg_get_functiondef(oid) as definition from pg_proc
      where proname = 'has_workspace_access' and pg_function_is_visible(oid)`)).rows;
    const receiptsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "proof-receipts.json");
    writeFileSync(receiptsPath, JSON.stringify(receipts, null, 2));
    check("G1 receipts written", true, receiptsPath);
    check("G2 role tables are SELECT-only for authenticated (no INSERT/UPDATE/DELETE, no anon/public)",
      receipts.role_table_acl.length === 4 &&
      receipts.role_table_acl.every((row) => {
        // ACL entries are "role=privileges/grantor"; the owner's own
        // arwdDxt entry is expected. Only the authenticated entry matters.
        const entries = String(row.relacl || "").replace(/^\{|\}$/g, "").split(",");
        const authEntry = entries.find((e) => e.startsWith("authenticated="));
        return authEntry === "authenticated=r/postgres" &&
          !entries.some((e) => e.startsWith("anon=") || e.startsWith("public=") || e.startsWith("= "));
      }),
      JSON.stringify(receipts.role_table_acl.map((r) => `${r.table_name}:${r.relacl}`)));
    check("G3 every rental_* RPC is EXECUTE for authenticated only (no PUBLIC/anon entry)",
      receipts.function_acl.length === 21 &&
      receipts.function_acl.every((row) => {
        const acl = String(row.proacl || "");
        return acl.includes("authenticated=X/") &&
          !acl.includes("anon=") &&
          !/(^|,)(\s*)=X\//.test(acl);
      }),
      `${receipts.function_acl.length} functions`);
    check("G4 all seven #753 billing policies still exist",
      receipts.billing_753_policies.length === 7,
      `${receipts.billing_753_policies.length} found`);
    // G5: the P1 regression — anon must not be able to EXECUTE the
    // disclosure-prone RPC at all (privilege revoked, not just
    // auth-checked inside the body). With the pre-fix migration this
    // call returned a real user's email + roles.
    const asAnon = await pool.connect();
    await asAnon.query("set role anon");
    const anonCall = await expectRejected(
      asAnon.query("select rental_admin_user_role_json($1, $2)", [OWNER, MANAGER]),
      /permission denied for function/);
    check("G5 anon cannot execute rental_admin_user_role_json (EXECUTE revoked)",
      anonCall.threw, anonCall.message);
    asAnon.release();

    for (const client of [asManager, asBookkeeper, asReadOnly, asOwner, asCoOwner, asOutsider]) client.release();
  } finally {
    admin.release();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log("Failures:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    process.exitCode = 1;
  }
  await pool.end();
}

main().catch((error) => {
  console.error("PROOF ERROR:", error);
  process.exitCode = 1;
});
