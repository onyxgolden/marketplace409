// Rental Manager admin permissions — slice 1 migration contract, executed
// against an in-process Postgres (PGlite). Follows the slice-2 convention:
// a bare fixture of the tables the migration touches, stub auth.uid() /
// has_workspace_access matching the LIVE definitions, and roles
// authenticated/anon/service_role.
//
// Hostile-default fixture (the Nov 4 lesson): before the migration, default
// privileges grant ALL on new tables to authenticated, simulating Supabase's
// project defaults. A deliberately naive table (selective GRANT only, no
// REVOKE) proves the fixture detects the widening; the role tables must
// then show NO widened privilege in their effective ACL, proving the
// migration's explicit REVOKEs do the job.
//
// VERIFIED LIVE BEFORE WRITING (see the build result file): the live
// has_workspace_access admits ONLY the primary owner or an active co_owner.
// The stub below reproduces that exact definition against the
// workspace_members fixture — it does NOT widen to any active member (the
// R17 file's shape, which the NO-GO fix reverted). has_rental_permission
// is created by this migration on top of that stub, so the test exercises
// the real predicate, including its legacy R17 branch.
//
// The migration is prepared for review only; applying it to production is
// Jason's separate approval, same as every migration. No linked or remote
// database is touched by this test.

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const SLICE1_PATH = new URL("../20261110010000_rental_admin_roles_slice1.sql", import.meta.url);
const slice1Sql = readFileSync(SLICE1_PATH, "utf8");

const OWNER = "11111111-1111-1111-1111-111111111111";
const CO_OWNER = "22222222-2222-2222-2222-222222222222";
const MANAGER = "33333333-3333-3333-3333-333333333333";
const BOOKKEEPER = "44444444-4444-4444-4444-444444444444";
const READ_ONLY = "55555555-5555-5555-5555-555555555555";
const INVITED = "66666666-6666-6666-6666-666666666666";
const OTHER_OWNER = "77777777-7777-7777-7777-777777777777";
const OUTSIDER = "88888888-8888-8888-8888-888888888888";
const UNCONFIRMED = "99999999-9999-9999-9999-999999999999";
const MAINTENANCE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const MARKETING = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const SETUP_SQL = `
  create role authenticated;
  create role anon;
  create role service_role;
  create schema auth;
  create table auth.users (
    id uuid not null primary key,
    email text,
    email_confirmed_at timestamptz
  );
  -- auth.uid() returns uuid in Supabase; the stub matches that signature.
  create function auth.uid()
  returns uuid language sql stable as $$
    select nullif(current_setting('test.actor', true), '')::uuid
  $$;

  create table workspace_members (
    owner_id text not null,
    id text not null,
    member_user_id uuid not null,
    role text not null check (role in ('primary_owner', 'co_owner', 'manager', 'property_manager', 'bookkeeper', 'maintenance', 'marketing', 'read_only')),
    status text not null default 'invited' check (status in ('invited', 'active', 'suspended')),
    invited_email text not null,
    invited_by uuid not null,
    invited_at timestamptz not null default now(),
    activated_at timestamptz,
    permission_overrides jsonb not null default '{}'::jsonb,
    primary key (owner_id, id)
  );
  grant select, insert, update, delete on workspace_members to authenticated;

  -- Live has_workspace_access: primary owner OR an active co_owner row.
  -- (Verified against production 2026-11-10; the R17 file's "any active
  -- member" shape was reverted by the NO-GO fix 20261001070500.) The table
  -- above must exist first: a sql-language function body is resolved at
  -- creation time. search_path = public matches the production function:
  -- without it, a caller running under search_path = '' (every SECURITY
  -- DEFINER RPC in this migration) would fail to resolve workspace_members.
  create function has_workspace_access(p_owner text)
  returns boolean language sql stable set search_path = public as $$
    select p_owner = auth.uid()::text
        or exists (
          select 1 from public.workspace_members wm
           where wm.owner_id = p_owner
             and wm.member_user_id = auth.uid()
             and wm.role = 'co_owner'
             and coalesce(wm.status, 'active') = 'active'
        )
  $$;

  -- Fixture shapes for the surfaces slice 1 migrates (production columns
  -- that the policies and tests touch; RLS enabled, not forced — as in
  -- production — so the authenticated-role checks below are the real gate).
  create table rental_tenants (
    id text not null primary key,
    owner_id text not null,
    email text,
    invited_at timestamptz,
    status text not null default 'active',
    updated_at timestamptz not null default now()
  );
  alter table rental_tenants enable row level security;
  grant select, insert, update, delete on rental_tenants to authenticated;
  create policy "rental_tenants_owner_all" on rental_tenants
    for all to authenticated using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

  create table rental_maintenance_requests (
    id text not null primary key,
    owner_id text not null,
    status text not null default 'open',
    updated_at timestamptz not null default now()
  );
  alter table rental_maintenance_requests enable row level security;
  grant select, insert, update, delete on rental_maintenance_requests to authenticated;
  create policy "rental_maintenance_owner_all" on rental_maintenance_requests
    for all to authenticated using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
  create policy "rental_staff_visibility_select" on rental_maintenance_requests
    for select to authenticated using (
      exists (select 1 from workspace_members wm where wm.owner_id = rental_maintenance_requests.owner_id
        and wm.member_user_id = auth.uid() and coalesce(wm.status, 'active') = 'active')
    );

  create table rental_maintenance_work_orders (
    id text not null primary key,
    owner_id text not null,
    status text not null default 'open',
    updated_at timestamptz not null default now()
  );
  alter table rental_maintenance_work_orders enable row level security;
  grant select, insert, update, delete on rental_maintenance_work_orders to authenticated;
  create policy "rental_work_order_owner_all" on rental_maintenance_work_orders
    for all to authenticated using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
  create policy "rental_staff_visibility_select" on rental_maintenance_work_orders
    for select to authenticated using (
      exists (select 1 from workspace_members wm where wm.owner_id = rental_maintenance_work_orders.owner_id
        and wm.member_user_id = auth.uid() and coalesce(wm.status, 'active') = 'active')
    );
`;

let db;

async function query(sql) {
  const result = await db.query(sql);
  return result.rows;
}

async function exec(sql) {
  await db.exec(sql);
}

async function asActor(actorUuid) {
  await db.exec(`select set_config('test.actor', '${actorUuid}', false)`);
}

async function asAuthenticated() {
  await db.exec("set role authenticated");
}

async function asOwner() {
  await db.exec("reset role");
}

async function expectRejected(promise, pattern) {
  let threw = false;
  try {
    await promise;
  } catch (error) {
    threw = true;
    expect(String(error.message || error)).toMatch(pattern);
  }
  expect(threw).toBe(true);
}

async function tablePrivilege(role, table, privilege) {
  const rows = await query(
    `select has_table_privilege('${role}', '${table}', '${privilege}') as has_priv`,
  );
  return rows[0].has_priv;
}

async function hasKey(ownerId, key) {
  const rows = await query(
    `select has_rental_permission('${ownerId}', '${key}') as has_key`,
  );
  return rows[0].has_key;
}

async function roleIdByName(ownerId, name) {
  const rows = await query(
    `select id from rental_roles where owner_id = '${ownerId}' and name = '${name}'`,
  );
  return rows[0]?.id;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP_SQL);
  // Hostile defaults BEFORE the migration: every table created from here
  // on by the test owner also carries ALL for authenticated, exactly the
  // Supabase project-default shape that widened slice 1 / P8.
  await db.exec(`
    do $$ begin
      execute format(
        'alter default privileges for role %I in schema public grant all on tables to authenticated, anon',
        current_user
      );
    end $$;
  `);
  // Naive table: selective GRANT only, no REVOKE — the widening detector.
  await db.exec(`create table naive_widen (id text not null primary key)`);
  await db.exec(`grant select, insert, update on naive_widen to authenticated`);

  // Fixture accounts + team. The owner has no workspace_members row
  // (implicit); the co-owner is active; one member is invited only.
  await exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${OWNER}', 'owner@example.com', now()),
      ('${CO_OWNER}', 'coowner@example.com', now()),
      ('${MANAGER}', 'manager@example.com', now()),
      ('${BOOKKEEPER}', 'bookkeeper@example.com', now()),
      ('${READ_ONLY}', 'readonly@example.com', now()),
      ('${INVITED}', 'invited@example.com', now()),
      ('${OTHER_OWNER}', 'other@example.com', now()),
      ('${OUTSIDER}', 'outsider@example.com', now()),
      ('${UNCONFIRMED}', 'unconfirmed@example.com', null),
      ('${MAINTENANCE}', 'maintenance@example.com', now()),
      ('${MARKETING}', 'marketing@example.com', now())
  `);
  await exec(`
    insert into workspace_members (owner_id, id, member_user_id, role, status, invited_email, invited_by, activated_at) values
      ('${OWNER}', 'wm_co', '${CO_OWNER}', 'co_owner', 'active', 'coowner@example.com', '${OWNER}', now()),
      ('${OWNER}', 'wm_mgr', '${MANAGER}', 'manager', 'active', 'manager@example.com', '${OWNER}', now()),
      ('${OWNER}', 'wm_bk', '${BOOKKEEPER}', 'bookkeeper', 'active', 'bookkeeper@example.com', '${OWNER}', now()),
      ('${OWNER}', 'wm_ro', '${READ_ONLY}', 'read_only', 'active', 'readonly@example.com', '${OWNER}', now()),
      ('${OWNER}', 'wm_inv', '${INVITED}', 'manager', 'invited', 'invited@example.com', '${OWNER}', null),
      ('${OWNER}', 'wm_maint', '${MAINTENANCE}', 'maintenance', 'active', 'maintenance@example.com', '${OWNER}', now()),
      ('${OWNER}', 'wm_mkt', '${MARKETING}', 'marketing', 'active', 'marketing@example.com', '${OWNER}', now()),
      ('${OTHER_OWNER}', 'wm_other', '${OTHER_OWNER}', 'co_owner', 'active', 'other@example.com', '${OTHER_OWNER}', now())
  `);
  // One tenant + one maintenance request in the workspace, owned by OWNER.
  await exec(`
    insert into rental_tenants (id, owner_id, email) values ('tenant_1', '${OWNER}', 'tenant@example.com');
    insert into rental_maintenance_requests (id, owner_id) values ('maint_1', '${OWNER}');
    insert into rental_maintenance_work_orders (id, owner_id) values ('wo_1', '${OWNER}');
  `);

  // The migration under test.
  await db.exec(slice1Sql);
  await asAuthenticated();
}, 60000);

describe("rental admin roles slice 1 migration", () => {
  it("creates the four role framework tables with RLS + FORCE", async () => {
    const tables = await query(`
      select c.relname as table_name, c.relrowsecurity as row_security_active, c.relforcerowsecurity as force_row_security
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relname in ('rental_roles', 'rental_role_capabilities', 'rental_user_roles', 'rental_role_audit')
      order by c.relname
    `);
    expect(tables.map((t) => t.table_name)).toEqual([
      "rental_role_audit",
      "rental_role_capabilities",
      "rental_roles",
      "rental_user_roles",
    ]);
    for (const table of tables) {
      expect(table.row_security_active).toBe(true);
      expect(table.force_row_security).toBe(true);
    }
  });

  it("the naive fixture proves the hostile defaults widen a selective GRANT", async () => {
    expect(await tablePrivilege("authenticated", "naive_widen", "DELETE")).toBe(true);
    expect(await tablePrivilege("anon", "naive_widen", "SELECT")).toBe(true);
  });

  it("effective ACL: role tables are SELECT-only for authenticated; anon nothing", async () => {
    for (const table of ["rental_roles", "rental_role_capabilities", "rental_user_roles", "rental_role_audit"]) {
      expect(await tablePrivilege("authenticated", table, "SELECT")).toBe(true);
      expect(await tablePrivilege("authenticated", table, "INSERT")).toBe(false);
      expect(await tablePrivilege("authenticated", table, "UPDATE")).toBe(false);
      expect(await tablePrivilege("authenticated", table, "DELETE")).toBe(false);
      expect(await tablePrivilege("authenticated", table, "TRUNCATE")).toBe(false);
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        expect(await tablePrivilege("anon", table, privilege)).toBe(false);
        expect(await tablePrivilege("service_role", table, privilege)).toBe(false);
      }
    }
  });

  it("RPCs are executable by authenticated only, not by PUBLIC", async () => {
    const rows = await query(`
      select proname, proacl from pg_proc
      where proname like 'rental_%'
      order by proname
    `);
    expect(rows.length).toBeGreaterThan(15);
    for (const row of rows) {
      const acl = Array.isArray(row.proacl) ? row.proacl : [String(row.proacl)];
      expect(acl).toContain("authenticated=X/postgres");
      expect(acl.some((entry) => entry === "=X/postgres" || entry.startsWith("public="))).toBe(false);
    }
  });

  it("the migration does not touch the PR #753 billing gates", async () => {
    // Guard: this slice must not modify the billing audit/settings tables
    // or their policies. The header comments document the #753 gates by
    // name, so strip comment lines before matching — only CODE is checked.
    // The only billing-adjacent mentions allowed in code are the
    // owner-only finance keys in the predicate/RPC validation (key names),
    // never a table, policy, or function definition.
    const code = slice1Sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/rental_billing_settings/);
    expect(code).not.toMatch(/rental_billing_cutover_audit/);
    expect(code).not.toMatch(/billing_settings_audit|late_fee_settings_audit|payment_policy_audit|convenience_fee_audit/);
    // The only has_workspace_access reference in code is the RLS policy
    // USING clause (a read, not a redefinition) — and the file must not
    // redefine it.
    expect(code).not.toMatch(/create or replace function public\.has_workspace_access/);
  });

  it("legacy R17 branch is unchanged: role defaults + overrides + team.manage", async () => {
    // R17 manager: everything except team.manage.
    await asActor(MANAGER);
    expect(await hasKey(OWNER, "payments.record")).toBe(true);
    expect(await hasKey(OWNER, "tenants.manage")).toBe(true);
    expect(await hasKey(OWNER, "team.manage")).toBe(false);
    // Bookkeeper: the five keys only.
    await asActor(BOOKKEEPER);
    expect(await hasKey(OWNER, "payments.record")).toBe(true);
    expect(await hasKey(OWNER, "reports.view")).toBe(true);
    expect(await hasKey(OWNER, "tenants.manage")).toBe(false);
    expect(await hasKey(OWNER, "team.manage")).toBe(false);
    // Maintenance / marketing defaults.
    await asActor(MAINTENANCE);
    expect(await hasKey(OWNER, "maintenance.manage")).toBe(true);
    expect(await hasKey(OWNER, "messages.send")).toBe(true);
    expect(await hasKey(OWNER, "payments.record")).toBe(false);
    await asActor(MARKETING);
    expect(await hasKey(OWNER, "properties.manage")).toBe(true);
    expect(await hasKey(OWNER, "maintenance.manage")).toBe(false);
    // Read-only: nothing.
    await asActor(READ_ONLY);
    expect(await hasKey(OWNER, "payments.record")).toBe(false);
    expect(await hasKey(OWNER, "reports.view")).toBe(false);
    // Invited (not active): nothing, even though the role is manager.
    await asActor(INVITED);
    expect(await hasKey(OWNER, "payments.record")).toBe(false);
    // Outsider: nothing.
    await asActor(OUTSIDER);
    expect(await hasKey(OWNER, "payments.record")).toBe(false);
    // Co-owner and owner: everything.
    await asActor(CO_OWNER);
    expect(await hasKey(OWNER, "team.manage")).toBe(true);
    await asActor(OWNER);
    expect(await hasKey(OWNER, "team.manage")).toBe(true);
  });

  it("no user gains a new-framework permission from the migration alone", async () => {
    for (const actor of [MANAGER, BOOKKEEPER, READ_ONLY, MAINTENANCE, MARKETING]) {
      await asActor(actor);
      expect(await hasKey(OWNER, "rental.tenants.read")).toBe(false);
      expect(await hasKey(OWNER, "rental.tenants.create")).toBe(false);
      expect(await hasKey(OWNER, "rental.maintenance.read")).toBe(false);
      expect(await hasKey(OWNER, "rental.roles.manage")).toBe(false);
    }
    // Unknown new keys fail closed for staff (no assignment can list a key
    // the catalog does not know). The owner short-circuits to true before
    // the key branch — implicit full access, by design.
    await asActor(MANAGER);
    expect(await hasKey(OWNER, "rental.not_a_real_key")).toBe(false);
  });

  it("ensure starter roles creates the four roles once, idempotently", async () => {
    await asActor(OWNER);
    const first = await query(`select rental_ensure_starter_roles('${OWNER}') as roles`);
    const roles = first[0].roles;
    expect(roles).toHaveLength(4);
    expect(roles.map((r) => r.name).sort()).toEqual(["bookkeeper", "manager", "read_only", "rental_admin"]);
    const byName = Object.fromEntries(roles.map((r) => [r.name, r]));
    expect(byName.rental_admin.capabilities).toHaveLength(42);
    expect(byName.manager.capabilities).toHaveLength(23);
    expect(byName.bookkeeper.capabilities).toHaveLength(13);
    expect(byName.read_only.capabilities).toHaveLength(6);
    expect(byName.rental_admin.capabilities).not.toContain("rental.billing.activate");
    expect(byName.rental_admin.capabilities).not.toContain("rental.payments.refund");
    expect(byName.rental_admin.capabilities).not.toContain("rental.roles.manage");
    expect(byName.read_only.capabilities).not.toContain("rental.billing.read");
    // Second call: same four roles, no duplicates, versions unchanged.
    const second = await query(`select rental_ensure_starter_roles('${OWNER}') as roles`);
    expect(second[0].roles).toHaveLength(4);
    const count = await query(`select count(*)::int as n from rental_roles where owner_id = '${OWNER}'`);
    expect(count[0].n).toBe(4);
    // A staff member cannot seed roles.
    await asActor(MANAGER);
    await expectRejected(
      exec(`select rental_ensure_starter_roles('${OWNER}')`),
      /Only the owner or co-owner can set up roles/,
    );
    await asActor(OWNER);
  });

  it("lookup by exact id/email works; partial and unconfirmed do not enumerate", async () => {
    await asActor(OWNER);
    const byId = await query(`select rental_lookup_user('${OWNER}', '${MANAGER}') as user`);
    expect(byId[0].user.user_id).toBe(MANAGER);
    expect(byId[0].user.email).toBe("manager@example.com");
    expect(byId[0].user.r17_role).toBe("manager");
    expect(byId[0].user.r17_status).toBe("active");
    expect(byId[0].user.current_role).toBeNull();
    const byEmail = await query(`select rental_lookup_user('${OWNER}', 'BOOKKEEPER@EXAMPLE.COM') as user`);
    expect(byEmail[0].user.user_id).toBe(BOOKKEEPER);
    // Partial email, unknown email, unknown id, and unconfirmed email all fail.
    await expectRejected(
      exec(`select rental_lookup_user('${OWNER}', 'manager@')`),
      /No account was found/,
    );
    await expectRejected(
      exec(`select rental_lookup_user('${OWNER}', 'nobody@example.com')`),
      /No account was found/,
    );
    await expectRejected(
      exec(`select rental_lookup_user('${OWNER}', '00000000-0000-0000-0000-000000000000')`),
      /No account was found/,
    );
    await expectRejected(
      exec(`select rental_lookup_user('${OWNER}', 'unconfirmed@example.com')`),
      /No account was found/,
    );
    // A staff member without roles.read cannot look up.
    await asActor(MANAGER);
    await expectRejected(
      exec(`select rental_lookup_user('${OWNER}', '${BOOKKEEPER}')`),
      /does not allow this/,
    );
    await asActor(OWNER);
  });

  it("assign grants the new keys immediately; revoke takes them away", async () => {
    await asActor(OWNER);
    const managerRoleId = await roleIdByName(OWNER, "manager");
    const assigned = await query(
      `select rental_assign_role('${OWNER}', '${MANAGER}', '${managerRoleId}', 'req-assign-1') as user`,
    );
    expect(assigned[0].user.current_role.name).toBe("manager");
    expect(assigned[0].user.effective_keys).toContain("rental.tenants.create");
    expect(assigned[0].user.effective_keys).not.toContain("rental.tenants.remove");
    // The predicate reflects the assignment right away.
    await asActor(MANAGER);
    expect(await hasKey(OWNER, "rental.tenants.create")).toBe(true);
    expect(await hasKey(OWNER, "rental.tenants.edit")).toBe(true);
    expect(await hasKey(OWNER, "rental.tenants.remove")).toBe(false);
    expect(await hasKey(OWNER, "rental.billing.activate")).toBe(false);
    // Idempotent replay: same request id returns the same assignment.
    await asActor(OWNER);
    await query(
      `select rental_assign_role('${OWNER}', '${MANAGER}', '${managerRoleId}', 'req-assign-1')`,
    );
    const assignments = await query(
      `select count(*)::int as n from rental_user_roles where owner_id = '${OWNER}' and user_id = '${MANAGER}'`,
    );
    expect(assignments[0].n).toBe(1);
    // Reassigning to a different role with a new request revokes the old one.
    const bookkeeperRoleId = await roleIdByName(OWNER, "bookkeeper");
    await query(
      `select rental_assign_role('${OWNER}', '${MANAGER}', '${bookkeeperRoleId}', 'req-assign-2')`,
    );
    await asActor(MANAGER);
    expect(await hasKey(OWNER, "rental.tenants.create")).toBe(false);
    expect(await hasKey(OWNER, "rental.payments.record_offline")).toBe(true);
    // The assignment table is owner/co-owner-only for DIRECT reads (staff
    // read assignments through the RPCs), so query as the owner.
    await asActor(OWNER);
    const rows = await query(
      `select status from rental_user_roles where owner_id = '${OWNER}' and user_id = '${MANAGER}' order by assigned_at`,
    );
    expect(rows.map((r) => r.status)).toEqual(["revoked", "active"]);
    // Revoke.
    await asActor(OWNER);
    await query(`select rental_revoke_role('${OWNER}', '${MANAGER}', 'req-revoke-1')`);
    await asActor(MANAGER);
    expect(await hasKey(OWNER, "rental.payments.record_offline")).toBe(false);
    // Revoking again fails (no active role).
    await asActor(OWNER);
    await expectRejected(
      exec(`select rental_revoke_role('${OWNER}', '${MANAGER}', 'req-revoke-2')`),
      /does not have an active role/,
    );
  });

  it("assign rejects co-owner, invited users, and the owner", async () => {
    await asActor(OWNER);
    const managerRoleId = await roleIdByName(OWNER, "manager");
    await expectRejected(
      exec(`select rental_assign_role('${OWNER}', '${CO_OWNER}', '${managerRoleId}', 'req-co')`),
      /co-owner already has full access/,
    );
    await expectRejected(
      exec(`select rental_assign_role('${OWNER}', '${INVITED}', '${managerRoleId}', 'req-inv')`),
      /does not have an active team membership/,
    );
    await expectRejected(
      exec(`select rental_assign_role('${OWNER}', '${OUTSIDER}', '${managerRoleId}', 'req-out')`),
      /does not have an active team membership/,
    );
    await expectRejected(
      exec(`select rental_assign_role('${OWNER}', '${OWNER}', '${managerRoleId}', 'req-owner')`),
      /does not have an active team membership/,
    );
  });

  it("role edit affects all assignees immediately; stale versions conflict", async () => {
    await asActor(OWNER);
    const managerRoleId = await roleIdByName(OWNER, "manager");
    const bookkeeperRoleId = await roleIdByName(OWNER, "bookkeeper");
    await query(`select rental_assign_role('${OWNER}', '${MANAGER}', '${managerRoleId}', 'req-cas-1')`);
    await query(`select rental_assign_role('${OWNER}', '${BOOKKEEPER}', '${managerRoleId}', 'req-cas-2')`);
    // Both hold the Manager role: neither can remove tenants yet.
    await asActor(BOOKKEEPER);
    expect(await hasKey(OWNER, "rental.tenants.remove")).toBe(false);
    // Edit the role (version 1 -> 2): add tenants.remove.
    await asActor(OWNER);
    const edited = await query(
      `select rental_update_role('${OWNER}', '${managerRoleId}', array['rental.tenants.remove'], null, 1, 'req-edit-1') as result`,
    );
    expect(edited[0].result.version).toBe(2);
    expect(edited[0].result.affected_user_count).toBe(2);
    expect(edited[0].result.added).toContain("rental.tenants.remove");
    // Both assignees gain the key immediately (read live, no re-assignment).
    await asActor(BOOKKEEPER);
    expect(await hasKey(OWNER, "rental.tenants.remove")).toBe(true);
    await asActor(MANAGER);
    expect(await hasKey(OWNER, "rental.tenants.remove")).toBe(true);
    // Stale version: rejected, no side effects.
    await asActor(OWNER);
    await expectRejected(
      exec(`select rental_update_role('${OWNER}', '${managerRoleId}', array['rental.tenants.invite'], null, 1, 'req-edit-2')`),
      /stale version/,
    );
    const after = await query(`select version from rental_roles where id = '${managerRoleId}'`);
    expect(after[0].version).toBe(2);
    const caps = await query(`select count(*)::int as n from rental_role_capabilities where role_id = '${managerRoleId}'`);
    expect(caps[0].n).toBe(24);
    // Idempotent replay of the first edit returns the current role.
    const replay = await query(
      `select rental_update_role('${OWNER}', '${managerRoleId}', array['rental.tenants.remove'], null, 1, 'req-edit-1') as result`,
    );
    expect(replay[0].result.version).toBe(2);
    // Remove the key again (version 2 -> 3) so later tests see the stock role.
    await query(
      `select rental_update_role('${OWNER}', '${managerRoleId}', null, array['rental.tenants.remove'], 2, 'req-edit-3')`,
    );
    await asActor(MANAGER);
    expect(await hasKey(OWNER, "rental.tenants.remove")).toBe(false);
    await asActor(OWNER);
  });

  it("owner-only finance keys can never be put on a role, or take effect", async () => {
    await asActor(OWNER);
    // The RPC refuses to create a role carrying a finance key.
    await expectRejected(
      exec(`select rental_create_role('${OWNER}', 'sneaky', 'Sneaky', array['rental.billing.activate'], 'req-sneaky')`),
      /owner\/co-owner only/,
    );
    await expectRejected(
      exec(`select rental_create_role('${OWNER}', 'sneaky', 'Sneaky', array['rental.not_a_real_key'], 'req-sneaky-2')`),
      /Unknown permission key/,
    );
    // Defense in depth: even if a capability row is written directly
    // (bypassing the RPC), the predicate still denies the finance key.
    const managerRoleId = await roleIdByName(OWNER, "manager");
    await asOwner();
    await exec(
      `insert into rental_role_capabilities (role_id, capability_key) values ('${managerRoleId}', 'rental.billing.activate') on conflict do nothing`,
    );
    await asActor(MANAGER);
    expect(await hasKey(OWNER, "rental.billing.activate")).toBe(false);
    await asOwner();
    await exec(
      `delete from rental_role_capabilities where role_id = '${managerRoleId}' and capability_key = 'rental.billing.activate'`,
    );
    await asActor(OWNER);
  });

  it("create/retire: custom roles, retire refusal, and reassignment", async () => {
    await asActor(OWNER);
    const created = await query(
      `select rental_create_role('${OWNER}', 'scheduler', 'Scheduler', array['rental.maintenance.read', 'rental.maintenance.create'], 'req-create-1') as result`,
    );
    const schedulerId = created[0].result.role.id;
    expect(created[0].result.role.is_system).toBe(false);
    // Duplicate name fails.
    await expectRejected(
      exec(`select rental_create_role('${OWNER}', 'scheduler', 'Scheduler 2', array['rental.maintenance.read'], 'req-create-2')`),
      /already exists/,
    );
    // Assign the bookkeeper to it, then retire without reassignment: refused.
    await query(`select rental_assign_role('${OWNER}', '${BOOKKEEPER}', '${schedulerId}', 'req-retire-1')`);
    await expectRejected(
      exec(`select rental_retire_role('${OWNER}', '${schedulerId}', null, 'req-retire-2')`),
      /still has 1 active member/,
    );
    // Retire with reassignment to the Manager role: the assignee moves.
    const managerRoleId = await roleIdByName(OWNER, "manager");
    const retired = await query(
      `select rental_retire_role('${OWNER}', '${schedulerId}', '${managerRoleId}', 'req-retire-3') as result`,
    );
    expect(retired[0].result.reassigned_count).toBe(1);
    await asActor(BOOKKEEPER);
    expect(await hasKey(OWNER, "rental.tenants.create")).toBe(true);
    // A starter role cannot be retired.
    await asActor(OWNER);
    await expectRejected(
      exec(`select rental_retire_role('${OWNER}', '${managerRoleId}', null, 'req-retire-4')`),
      /starter role cannot be retired/,
    );
    // Revoke the bookkeeper's manager role so later tests start clean.
    await query(`select rental_revoke_role('${OWNER}', '${BOOKKEEPER}', 'req-retire-5')`);
    await query(`select rental_revoke_role('${OWNER}', '${MANAGER}', 'req-retire-6')`);
  });

  it("audit is append-only and records every change; direct writes are denied", async () => {
    await asActor(OWNER);
    const audit = await query(`select rental_get_role_audit('${OWNER}', 100) as entries`);
    const actions = audit[0].entries.map((e) => e.action);
    for (const action of ["role.seeded", "role.created", "role.assigned", "role.revoked", "role.updated", "role.retired"]) {
      expect(actions).toContain(action);
    }
    // Direct writes to the role/audit tables are denied for authenticated.
    await asAuthenticated();
    await expectRejected(
      exec(`insert into rental_roles (id, owner_id, name, display_name) values ('x', '${OWNER}', 'x', 'X')`),
      /permission denied|insufficient_privilege/,
    );
    await expectRejected(
      exec(`insert into rental_role_audit (owner_id, actor_user_id, action) values ('${OWNER}', '${OWNER}', 'fake')`),
      /permission denied|insufficient_privilege/,
    );
    await expectRejected(
      exec(`delete from rental_role_audit where owner_id = '${OWNER}'`),
      /permission denied|insufficient_privilege/,
    );
    // A staff member without audit.read cannot read the audit.
    await asActor(MANAGER);
    await expectRejected(
      exec(`select rental_get_role_audit('${OWNER}', 10)`),
      /does not allow this/,
    );
    await asActor(OWNER);
  });

  it("RLS tenant surface: role assignees write, others do not; deletes stay owner-only", async () => {
    await asActor(OWNER);
    const managerRoleId = await roleIdByName(OWNER, "manager");
    const readOnlyRoleId = await roleIdByName(OWNER, "read_only");
    await query(`select rental_assign_role('${OWNER}', '${MANAGER}', '${managerRoleId}', 'req-rls-1')`);
    await query(`select rental_assign_role('${OWNER}', '${READ_ONLY}', '${readOnlyRoleId}', 'req-rls-2')`);
    await asAuthenticated();
    // Manager (tenants.create/edit): INSERT + UPDATE succeed.
    await asActor(MANAGER);
    await exec(`insert into rental_tenants (id, owner_id, email) values ('tenant_mgr', '${OWNER}', 'mgr@example.com')`);
    await exec(`update rental_tenants set email = 'mgr2@example.com' where id = 'tenant_mgr'`);
    // Read-only (tenants.read only): SELECT succeeds, INSERT fails, and
    // UPDATE/DELETE silently affect zero rows (RLS filters the row out of
    // the USING clause — that IS the denial, not an error).
    await asActor(READ_ONLY);
    const visible = await query(`select id from rental_tenants where owner_id = '${OWNER}'`);
    expect(visible.map((r) => r.id)).toContain("tenant_1");
    await expectRejected(
      exec(`insert into rental_tenants (id, owner_id, email) values ('tenant_ro', '${OWNER}', 'ro@example.com')`),
      /new row violates row-level security/,
    );
    await exec(`update rental_tenants set email = 'x@example.com' where id = 'tenant_1'`);
    const unchanged = await query(`select email from rental_tenants where id = 'tenant_1'`);
    expect(unchanged[0].email).toBe("tenant@example.com");
    // A manager with NO assignment cannot write.
    await asActor(BOOKKEEPER);
    await expectRejected(
      exec(`insert into rental_tenants (id, owner_id, email) values ('tenant_bk', '${OWNER}', 'bk@example.com')`),
      /new row violates row-level security/,
    );
    // DELETE is denied for every staff role (no DELETE policy in slice 1):
    // the row survives the attempt.
    await asActor(MANAGER);
    await exec(`delete from rental_tenants where id = 'tenant_mgr'`);
    const stillThere = await query(`select id from rental_tenants where id = 'tenant_mgr'`);
    expect(stillThere).toHaveLength(1);
    // Cross-workspace: the other owner cannot see or write these tenants.
    await asActor(OTHER_OWNER);
    const otherVisible = await query(`select id from rental_tenants where owner_id = '${OWNER}'`);
    expect(otherVisible).toEqual([]);
    await expectRejected(
      exec(`insert into rental_tenants (id, owner_id, email) values ('tenant_x', '${OWNER}', 'x@example.com')`),
      /new row violates row-level security/,
    );
    // The owner can still delete (existing owner_all policy, untouched).
    await asActor(OWNER);
    await exec(`delete from rental_tenants where id = 'tenant_mgr'`);
    // Clean up the role assignments for later tests.
    await query(`select rental_revoke_role('${OWNER}', '${MANAGER}', 'req-rls-3')`);
    await query(`select rental_revoke_role('${OWNER}', '${READ_ONLY}', 'req-rls-4')`);
  });

  it("RLS invite key: an invite-only user can stamp the invite, but cannot insert", async () => {
    // PostgreSQL has no column-scoped UPDATE policies, so the tenant UPDATE
    // policy permits edit OR invite at the DB layer; the invite key's
    // separation is enforced at the invite action (see the API/action
    // tests). Known slice-1 gap (direct DB call with only the invite key
    // could update other tenant columns) is recorded in the enforcement
    // manifest; column-level enforcement is a follow-on.
    await asActor(OWNER);
    const created = await query(
      `select rental_create_role('${OWNER}', 'inviter', 'Inviter', array['rental.tenants.invite'], 'req-inv-role') as result`,
    );
    const inviterId = created[0].result.role.id;
    await query(`select rental_assign_role('${OWNER}', '${MANAGER}', '${inviterId}', 'req-inv-assign')`);
    await asAuthenticated();
    await asActor(MANAGER);
    // The invite update (invited_at/status/updated_at) succeeds.
    await exec(
      `update rental_tenants set invited_at = now(), status = 'invited', updated_at = now() where id = 'tenant_1'`,
    );
    // But the invite key alone grants no insert (and no read of other
    // surfaces): it is not a general tenant-write key.
    await expectRejected(
      exec(`insert into rental_tenants (id, owner_id, email) values ('tenant_inv', '${OWNER}', 'inv@example.com')`),
      /new row violates row-level security/,
    );
    await asActor(OWNER);
    await query(`select rental_revoke_role('${OWNER}', '${MANAGER}', 'req-inv-revoke')`);
    await query(`select rental_retire_role('${OWNER}', '${inviterId}', null, 'req-inv-retire')`);
  });

  it("RLS maintenance surface: role assignees write requests and work orders", async () => {
    await asActor(OWNER);
    const managerRoleId = await roleIdByName(OWNER, "manager");
    await query(`select rental_assign_role('${OWNER}', '${MANAGER}', '${managerRoleId}', 'req-maint-1')`);
    await asAuthenticated();
    await asActor(MANAGER);
    await exec(`insert into rental_maintenance_requests (id, owner_id) values ('maint_mgr', '${OWNER}')`);
    await exec(`update rental_maintenance_requests set status = 'assigned' where id = 'maint_mgr'`);
    await exec(`insert into rental_maintenance_work_orders (id, owner_id) values ('wo_mgr', '${OWNER}')`);
    await exec(`update rental_maintenance_work_orders set status = 'closed' where id = 'wo_mgr'`);
    // Read-only cannot write maintenance.
    await asActor(READ_ONLY);
    await expectRejected(
      exec(`insert into rental_maintenance_requests (id, owner_id) values ('maint_ro', '${OWNER}')`),
      /new row violates row-level security/,
    );
    await asActor(OWNER);
    await exec(`delete from rental_maintenance_requests where id = 'maint_mgr'`);
    await exec(`delete from rental_maintenance_work_orders where id = 'wo_mgr'`);
    await query(`select rental_revoke_role('${OWNER}', '${MANAGER}', 'req-maint-2')`);
  });

  it("staff admin ceiling: can assign only what they hold, never admin or finance", async () => {
    await asActor(OWNER);
    // A custom admin role: roles.manage + a subset (tenants read/create/edit).
    const created = await query(
      `select rental_create_role('${OWNER}', 'tenant_admin', 'Tenant Admin',
        array['rental.roles.manage', 'rental.roles.read', 'rental.tenants.read', 'rental.tenants.create', 'rental.tenants.edit'],
        'req-ceil-1') as result`,
    );
    const adminRoleId = created[0].result.role.id;
    const managerRoleId = await roleIdByName(OWNER, "manager");
    await query(`select rental_assign_role('${OWNER}', '${MANAGER}', '${adminRoleId}', 'req-ceil-2')`);
    // As the staff admin: assigning the Manager role (keys they lack) fails.
    // (The role id is fetched above as the owner: staff cannot read the
    // role tables directly — RLS is owner/co-owner-only, staff read roles
    // through the RPCs.)
    await asActor(MANAGER);
    await expectRejected(
      exec(`select rental_assign_role('${OWNER}', '${BOOKKEEPER}', '${managerRoleId}', 'req-ceil-3')`),
      /cannot assign a role with permissions you do not hold/,
    );
    // Assigning the admin role itself (contains roles.manage) fails.
    await expectRejected(
      exec(`select rental_assign_role('${OWNER}', '${BOOKKEEPER}', '${adminRoleId}', 'req-ceil-4')`),
      /cannot assign a role with permissions you do not hold/,
    );
    // Editing their own role fails.
    await expectRejected(
      exec(`select rental_update_role('${OWNER}', '${adminRoleId}', array['rental.tenants.remove'], null, 1, 'req-ceil-5')`),
      /Only the owner or co-owner can edit an admin role/,
    );
    // Creating a role with a finance key fails.
    await expectRejected(
      exec(`select rental_create_role('${OWNER}', 'bad', 'Bad', array['rental.credits.issue'], 'req-ceil-6')`),
      /owner\/co-owner only/,
    );
    // Creating a role within their ceiling succeeds, and assigning it works.
    const small = await query(
      `select rental_create_role('${OWNER}', 'tenant_editor', 'Tenant Editor',
        array['rental.tenants.read', 'rental.tenants.edit'], 'req-ceil-7') as result`,
    );
    const smallId = small[0].result.role.id;
    await query(`select rental_assign_role('${OWNER}', '${BOOKKEEPER}', '${smallId}', 'req-ceil-8')`);
    await asActor(BOOKKEEPER);
    expect(await hasKey(OWNER, "rental.tenants.edit")).toBe(true);
    expect(await hasKey(OWNER, "rental.tenants.create")).toBe(false);
    // The staff admin cannot revoke their own assignment.
    await asActor(MANAGER);
    await expectRejected(
      exec(`select rental_revoke_role('${OWNER}', '${MANAGER}', 'req-ceil-9')`),
      /cannot change your own role/,
    );
    // Cleanup (as owner).
    await asActor(OWNER);
    await query(`select rental_revoke_role('${OWNER}', '${BOOKKEEPER}', 'req-ceil-10')`);
    await query(`select rental_revoke_role('${OWNER}', '${MANAGER}', 'req-ceil-11')`);
    await query(`select rental_retire_role('${OWNER}', '${smallId}', null, 'req-ceil-12')`);
    await query(`select rental_retire_role('${OWNER}', '${adminRoleId}', null, 'req-ceil-13')`);
  });

  it("cross-workspace and forged-owner calls are denied", async () => {
    // The other owner (privileged in THEIR workspace) cannot manage roles
    // in OWNER's workspace, and cannot even list them.
    await asActor(OTHER_OWNER);
    await expectRejected(
      exec(`select rental_list_roles('${OWNER}')`),
      /does not allow this/,
    );
    await expectRejected(
      exec(`select rental_assign_role('${OWNER}', '${MANAGER}', 'x', 'req-x-1')`),
      /does not allow this|Only the owner, co-owner, or a designated admin/,
    );
    // The effective-permissions RPC returns an empty set (not an error)
    // for a caller with no standing in this workspace.
    const keys = await query(`select rental_get_my_effective_permissions('${OWNER}') as keys`);
    expect(keys[0].keys).toEqual([]);
    // The outsider (no membership anywhere) gets nothing either.
    await asActor(OUTSIDER);
    const outsiderKeys = await query(`select rental_get_my_effective_permissions('${OWNER}') as keys`);
    expect(outsiderKeys[0].keys).toEqual([]);
    // Forged owner id: the manager cannot act in a workspace they are not
    // a member of.
    await asActor(MANAGER);
    const forgedKeys = await query(`select rental_get_my_effective_permissions('${OTHER_OWNER}') as keys`);
    expect(forgedKeys[0].keys).toEqual([]);
    await asActor(OWNER);
  });

  it("effective permissions RPC returns the catalog for privileged callers", async () => {
    await asActor(OWNER);
    const ownerKeys = await query(`select rental_get_my_effective_permissions('${OWNER}') as keys`);
    expect(ownerKeys[0].keys).toHaveLength(51);
    await asActor(CO_OWNER);
    const coKeys = await query(`select rental_get_my_effective_permissions('${OWNER}') as keys`);
    expect(coKeys[0].keys).toHaveLength(51);
    await asActor(MANAGER);
    const mgrKeys = await query(`select rental_get_my_effective_permissions('${OWNER}') as keys`);
    expect(mgrKeys[0].keys).toEqual([]);
    await asActor(OWNER);
  });
});
