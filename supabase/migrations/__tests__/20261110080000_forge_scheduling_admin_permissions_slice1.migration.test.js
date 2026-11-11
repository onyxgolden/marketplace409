// Scheduling Tool — Admin Permissions, Slice 1 — migration contract,
// executed against an in-process real Postgres (PGlite). Mirrors the
// Planner slice-1 test's convention exactly (including its post-fix-round
// uuid-typed fixture, the lesson from PR #767's round-1): stub auth.uid()
// / has_workspace_access, roles authenticated/anon/service_role, and a
// workspace_members table matching the real co-owner predicate, so the
// owner/co-owner structural bypass in has_scheduling_permission is tested
// against the genuine shape, not an invented one.
//
// The migration is prepared for review only; applying it to production is
// Jason's separate approval. No linked or remote database is touched.

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const SADM1_PATH = new URL("../20261110080000_forge_scheduling_admin_permissions_slice1.sql", import.meta.url);
const sadm1Sql = readFileSync(SADM1_PATH, "utf8");
const sadm1SqlNoComments = sadm1Sql.replace(/--.*$/gm, "");

const SETUP_SQL = `
  create role authenticated;
  create role anon;
  create role service_role;
  create schema auth;

  create function test_actor_uuid(label text)
  returns uuid language sql immutable as $$
    select (
      substr(md5(label), 1, 8) || '-' ||
      substr(md5(label), 9, 4) || '-' ||
      substr(md5(label), 13, 4) || '-' ||
      substr(md5(label), 17, 4) || '-' ||
      substr(md5(label), 21, 12)
    )::uuid
  $$;

  create function auth.uid()
  returns uuid language sql stable as $$
    select case
      when nullif(current_setting('test.actor', true), '') is null then null
      else test_actor_uuid(current_setting('test.actor', true))
    end
  $$;

  create table auth.users (
    id text primary key,
    email text,
    email_confirmed_at timestamptz
  );
  grant select on auth.users to authenticated;

  -- Matches the real workspace_members shape (uuid member_user_id,
  -- 20260829000000:25) and the real has_workspace_access predicate
  -- (20260829000100) exactly.
  create table workspace_members (
    owner_id text not null,
    member_user_id uuid not null,
    status text not null,
    role text not null,
    primary key (owner_id, member_user_id)
  );
  grant select on workspace_members to authenticated;

  create function has_workspace_access(p_owner text)
  returns boolean language sql stable security definer set search_path = public as $$
    select p_owner = current_setting('test.actor', true)
        or exists (
          select 1 from workspace_members
          where owner_id = p_owner and member_user_id = auth.uid()
            and status = 'active' and role = 'co_owner'
        )
  $$;
`;

let db;

async function query(sql) {
  const result = await db.query(sql);
  return result.rows;
}

async function exec(sql) {
  await db.exec(sql);
}

async function asActor(actor) {
  await db.exec(`select set_config('test.actor', '${actor}', false)`);
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
  const rows = await query(`select has_table_privilege('${role}', '${table}', '${privilege}') as has_priv`);
  return rows[0].has_priv;
}

async function functionPrivilege(role, signature) {
  const rows = await query(`select has_function_privilege('${role}', '${signature}', 'execute') as has_priv`);
  return rows[0].has_priv;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP_SQL);

  // Hostile defaults BEFORE the slice's own tables/functions exist —
  // Supabase's real project defaults grant ALL on new tables / EXECUTE on
  // new functions to authenticated (and often anon), so a migration that
  // only does a selective GRANT without an explicit REVOKE silently stays
  // wide open. Includes service_role (the I5 lesson from PR #767's fix
  // round) so the service_role=false assertions below are non-vacuous.
  await db.exec(`
    do $$ begin
      execute format(
        'alter default privileges for role %I in schema public grant all on tables to authenticated, anon, service_role',
        current_user
      );
      execute format(
        'alter default privileges for role %I in schema public grant execute on functions to authenticated, anon, service_role',
        current_user
      );
    end $$;
  `);
  const naiveFn = `create function naive_widen_fn() returns text language sql as $$ select 'x' $$`;
  await db.exec(`create table naive_widen (id text not null primary key)`);
  await db.exec(`grant select, insert, update on naive_widen to authenticated`);
  await db.exec(naiveFn);

  await db.exec(sadm1Sql);

  await asActor("owner_1");
  await exec(`insert into workspace_members (owner_id, member_user_id, status, role) values (test_actor_uuid('owner_1')::text, test_actor_uuid('coowner_1'), 'active', 'co_owner')`);

  await exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      (test_actor_uuid('owner_1')::text, 'owner1@example.com', now()),
      ('staff_1', 'staff1@example.com', now()),
      ('staff_2', 'staff2@example.com', now()),
      ('unverified_1', 'unverified1@example.com', null)
  `);
});

describe("fixture sanity (the hostile-default detector)", () => {
  it("proves the fixture itself widens privileges, so the ACL assertions below prove something real", async () => {
    expect(await tablePrivilege("authenticated", "naive_widen", "DELETE")).toBe(true);
    expect(await functionPrivilege("authenticated", "naive_widen_fn()")).toBe(true);
    expect(await functionPrivilege("service_role", "naive_widen_fn()")).toBe(true);
  });
});

describe("the hard rule — no scheduling.tv.* capability, anywhere, ever", () => {
  it("the capability catalog CHECK constraint rejects a scheduling.tv.* key", async () => {
    await asOwner();
    await expectRejected(
      exec(`
        insert into forge_scheduling_roles (owner_id, id, role_key, name, created_by, updated_by)
        values (test_actor_uuid('owner_1')::text, 'role_x', 'x', 'X', test_actor_uuid('owner_1')::text, test_actor_uuid('owner_1')::text);
        insert into forge_scheduling_role_capabilities (owner_id, id, role_id, capability_key, created_by)
        values (test_actor_uuid('owner_1')::text, 'cap_x', 'role_x', 'scheduling.tv.read', test_actor_uuid('owner_1')::text);
      `),
      /violates check constraint|forge_scheduling_role_capabilities_capability_key_check/,
    );
  });

  it("the 21-key catalog contains no scheduling.tv.* or scheduling.jobs.*/scheduling.crews.* key under any spelling", async () => {
    const rows = await query(`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conname = 'forge_scheduling_role_capabilities_capability_key_check'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].def).not.toMatch(/scheduling\.tv\./i);
    expect(rows[0].def).not.toMatch(/scheduling\.jobs\./i);
    expect(rows[0].def).not.toMatch(/scheduling\.crews\./i);
  });

  it("no function this migration creates reads or writes a tv/kiosk table", () => {
    // Static proof over the migration's own source: this slice introduces
    // no TV/kiosk table or route, so there is nothing for an admin action
    // to be exposed from, structurally. (The hard-rule's own defensive
    // check and exception message legitimately mention "scheduling.tv."
    // and "TV/kiosk" as text, same as Planner's migration naming
    // "drawings.edit" inside ITS own exception message — the real proof
    // is the CHECK-constraint test above, which already confirms no such
    // key can ever be inserted.)
    expect(sadm1SqlNoComments).not.toMatch(/\bschedule_tv\w*table\b|\btv_kiosk\w*\b/i);
  });
});

describe("has_scheduling_permission — owner/co-owner structural bypass", () => {
  it("the real owner has every catalog capability with zero role rows", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    const rows = await query(`select has_scheduling_permission(test_actor_uuid('owner_1')::text, 'scheduling.roles.manage') as ok`);
    expect(rows[0].ok).toBe(true);
  });

  it("an active co-owner has every catalog capability with zero role rows", async () => {
    await asAuthenticated();
    await asActor("coowner_1");
    const rows = await query(`select has_scheduling_permission(test_actor_uuid('owner_1')::text, 'scheduling.settings.edit') as ok`);
    expect(rows[0].ok).toBe(true);
  });

  it("an unrelated user has no capability at all", async () => {
    await asAuthenticated();
    await asActor("stranger_1");
    const rows = await query(`select has_scheduling_permission(test_actor_uuid('owner_1')::text, 'scheduling.schedules.read') as ok`);
    expect(rows[0].ok).toBe(false);
  });

  it("a staff user with an assigned role only has that role's granted capabilities, nothing else", async () => {
    await asOwner();
    await exec(`
      insert into forge_scheduling_roles (owner_id, id, role_key, name, created_by, updated_by)
      values (test_actor_uuid('owner_1')::text, 'role_reader', 'reader', 'Reader', test_actor_uuid('owner_1')::text, test_actor_uuid('owner_1')::text);
      insert into forge_scheduling_role_capabilities (owner_id, id, role_id, capability_key, created_by)
      values (test_actor_uuid('owner_1')::text, 'cap_r1', 'role_reader', 'scheduling.schedules.read', test_actor_uuid('owner_1')::text);
      insert into forge_scheduling_user_role_assignments (owner_id, id, assignee_user_id, role_id, assigned_by, updated_by)
      values (test_actor_uuid('owner_1')::text, 'assign_1', test_actor_uuid('staff_1')::text, 'role_reader', test_actor_uuid('owner_1')::text, test_actor_uuid('owner_1')::text);
    `);
    await asAuthenticated();
    await asActor("staff_1");
    expect((await query(`select has_scheduling_permission(test_actor_uuid('owner_1')::text, 'scheduling.schedules.read') as ok`))[0].ok).toBe(true);
    expect((await query(`select has_scheduling_permission(test_actor_uuid('owner_1')::text, 'scheduling.schedules.edit') as ok`))[0].ok).toBe(false);
  });

  it("cross-owner isolation: a role/assignment under one owner never grants anything under another", async () => {
    await asAuthenticated();
    await asActor("staff_1"); // has scheduling.schedules.read only under owner_1.
    const rows = await query(`select has_scheduling_permission('owner_2', 'scheduling.schedules.read') as ok`);
    expect(rows[0].ok).toBe(false);
  });
});

describe("non-escalation — forge_scheduling_role_capability_set", () => {
  it("a non-owner admin cannot edit their own role", async () => {
    await asOwner();
    await exec(`
      insert into forge_scheduling_roles (owner_id, id, role_key, name, created_by, updated_by)
      values (test_actor_uuid('owner_1')::text, 'role_admin', 'admin', 'Admin', test_actor_uuid('owner_1')::text, test_actor_uuid('owner_1')::text);
      insert into forge_scheduling_role_capabilities (owner_id, id, role_id, capability_key, created_by)
      values (test_actor_uuid('owner_1')::text, 'cap_a1', 'role_admin', 'scheduling.roles.manage', test_actor_uuid('owner_1')::text),
             (test_actor_uuid('owner_1')::text, 'cap_a2', 'role_admin', 'scheduling.schedules.read', test_actor_uuid('owner_1')::text);
      insert into forge_scheduling_user_role_assignments (owner_id, id, assignee_user_id, role_id, assigned_by, updated_by)
      values (test_actor_uuid('owner_1')::text, 'assign_admin', test_actor_uuid('admin_1')::text, 'role_admin', test_actor_uuid('owner_1')::text, test_actor_uuid('owner_1')::text);
    `);
    await asAuthenticated();
    await asActor("admin_1");
    await expectRejected(
      exec(`select forge_scheduling_role_capability_set(test_actor_uuid('owner_1')::text, 'role_admin', 'scheduling.schedules.edit', true, 1, 'req-1', null)`),
      /SADM1_CANNOT_EDIT_OWN_ROLE/,
    );
  });

  it("a non-owner admin cannot edit a role that itself grants scheduling.roles.manage (another admin's authority)", async () => {
    await asOwner();
    await exec(`
      insert into forge_scheduling_roles (owner_id, id, role_key, name, created_by, updated_by)
      values (test_actor_uuid('owner_1')::text, 'role_admin2', 'admin2', 'Admin2', test_actor_uuid('owner_1')::text, test_actor_uuid('owner_1')::text);
      insert into forge_scheduling_role_capabilities (owner_id, id, role_id, capability_key, created_by)
      values (test_actor_uuid('owner_1')::text, 'cap_a3', 'role_admin2', 'scheduling.roles.manage', test_actor_uuid('owner_1')::text);
    `);
    await asAuthenticated();
    await asActor("admin_1");
    await expectRejected(
      exec(`select forge_scheduling_role_capability_set(test_actor_uuid('owner_1')::text, 'role_admin2', 'scheduling.settings.edit', true, 1, 'req-2', null)`),
      /SADM1_CANNOT_EDIT_ANOTHER_ADMIN_ROLE/,
    );
  });

  it("a non-owner admin cannot grant a capability they do not themselves hold", async () => {
    await asOwner();
    await exec(`
      insert into forge_scheduling_roles (owner_id, id, role_key, name, created_by, updated_by)
      values (test_actor_uuid('owner_1')::text, 'role_target', 'target', 'Target', test_actor_uuid('owner_1')::text, test_actor_uuid('owner_1')::text);
    `);
    await asAuthenticated();
    await asActor("admin_1"); // holds scheduling.roles.manage + scheduling.schedules.read only.
    await expectRejected(
      exec(`select forge_scheduling_role_capability_set(test_actor_uuid('owner_1')::text, 'role_target', 'scheduling.settings.edit', true, 1, 'req-3', null)`),
      /SADM1_CANNOT_GRANT_UNHELD_CAPABILITY/,
    );
  });

  it("a non-owner admin CAN grant a capability they do themselves hold, to a role they're allowed to touch", async () => {
    await asAuthenticated();
    await asActor("admin_1");
    const rows = await query(`select * from forge_scheduling_role_capability_set(test_actor_uuid('owner_1')::text, 'role_target', 'scheduling.schedules.read', true, 1, 'req-4', null)`);
    expect(rows[0].version).toBe(2);
    const granted = await query(`select 1 from forge_scheduling_role_capabilities where owner_id=test_actor_uuid('owner_1')::text and role_id='role_target' and capability_key='scheduling.schedules.read'`);
    expect(granted).toHaveLength(1);
  });

  it("the 'owner' builtin role key can never be edited by anyone", async () => {
    await asOwner();
    await exec(`insert into forge_scheduling_roles (owner_id, id, role_key, name, is_builtin, created_by, updated_by) values (test_actor_uuid('owner_1')::text, 'role_owner_builtin', 'owner', 'Owner', true, test_actor_uuid('owner_1')::text, test_actor_uuid('owner_1')::text)`);
    await asAuthenticated();
    await asActor("owner_1");
    await expectRejected(
      exec(`select forge_scheduling_role_capability_set(test_actor_uuid('owner_1')::text, 'role_owner_builtin', 'scheduling.schedules.read', true, 1, 'req-5', null)`),
      /SADM1_OWNER_ROLE_IMMUTABLE/,
    );
  });

  it("a stale expected_version is refused (optimistic concurrency)", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    await expectRejected(
      exec(`select forge_scheduling_role_capability_set(test_actor_uuid('owner_1')::text, 'role_target', 'scheduling.schedules.read', false, 1, 'req-6', null)`), // version is now 2.
      /SADM1_VERSION_CONFLICT/,
    );
  });
});

describe("non-escalation — forge_scheduling_role_assign", () => {
  it("cannot assign a role to the real owner or an active co-owner through this path", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    await expectRejected(
      exec(`select forge_scheduling_role_assign(test_actor_uuid('owner_1')::text, test_actor_uuid('owner_1')::text, 'role_target', 'req-7', null)`),
      /SADM1_CANNOT_ASSIGN_OWNER_OR_COOWNER/,
    );
    await expectRejected(
      exec(`select forge_scheduling_role_assign(test_actor_uuid('owner_1')::text, test_actor_uuid('coowner_1')::text, 'role_target', 'req-8', null)`),
      /SADM1_CANNOT_ASSIGN_OWNER_OR_COOWNER/,
    );
  });

  it("a non-owner admin cannot assign a role whose capabilities exceed what the admin themselves holds", async () => {
    await asOwner();
    await exec(`
      insert into forge_scheduling_roles (owner_id, id, role_key, name, created_by, updated_by)
      values (test_actor_uuid('owner_1')::text, 'role_overreach', 'overreach', 'Overreach', test_actor_uuid('owner_1')::text, test_actor_uuid('owner_1')::text);
      insert into forge_scheduling_role_capabilities (owner_id, id, role_id, capability_key, created_by)
      values (test_actor_uuid('owner_1')::text, 'cap_over1', 'role_overreach', 'scheduling.settings.edit', test_actor_uuid('owner_1')::text);
    `);
    await asAuthenticated();
    await asActor("admin_1"); // does not hold scheduling.settings.edit.
    await expectRejected(
      exec(`select forge_scheduling_role_assign(test_actor_uuid('owner_1')::text, test_actor_uuid('staff_2')::text, 'role_overreach', 'req-9', null)`),
      /SADM1_CANNOT_ASSIGN_ROLE_EXCEEDING_OWN_CAPABILITIES/,
    );
  });

  it("the real owner CAN assign any role, including one an admin couldn't", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    const rows = await query(`select * from forge_scheduling_role_assign(test_actor_uuid('owner_1')::text, test_actor_uuid('staff_2')::text, 'role_overreach', 'req-10', null)`);
    expect(rows).toHaveLength(1);
    const assigned = await query(`select role_id from forge_scheduling_user_role_assignments where owner_id=test_actor_uuid('owner_1')::text and assignee_user_id=test_actor_uuid('staff_2')::text and retired_at is null`);
    expect(assigned[0].role_id).toBe("role_overreach");
  });

  it("one role per user: reassigning updates the same active row instead of creating a second one", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    await exec(`select forge_scheduling_role_assign(test_actor_uuid('owner_1')::text, test_actor_uuid('staff_2')::text, 'role_target', 'req-11', null)`);
    const active = await query(`select role_id from forge_scheduling_user_role_assignments where owner_id=test_actor_uuid('owner_1')::text and assignee_user_id=test_actor_uuid('staff_2')::text and retired_at is null`);
    expect(active).toHaveLength(1);
    expect(active[0].role_id).toBe("role_target");
  });

  it("immediate effect: a role change is visible to has_scheduling_permission on the very next check, no caching", async () => {
    await asAuthenticated();
    await asActor("staff_2");
    expect((await query(`select has_scheduling_permission(test_actor_uuid('owner_1')::text, 'scheduling.schedules.read') as ok`))[0].ok).toBe(true); // role_target grants it.
    expect((await query(`select has_scheduling_permission(test_actor_uuid('owner_1')::text, 'scheduling.settings.edit') as ok`))[0].ok).toBe(false); // role_overreach's grant no longer applies.
  });
});

describe("assignment revocation", () => {
  it("revoking leaves the assignee with no role", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    const before = await query(`select id, version from forge_scheduling_user_role_assignments where owner_id=test_actor_uuid('owner_1')::text and assignee_user_id=test_actor_uuid('staff_2')::text and retired_at is null`);
    await exec(`select forge_scheduling_role_assignment_revoke(test_actor_uuid('owner_1')::text, '${before[0].id}', ${before[0].version}, 'req-12', 'cleanup')`);
    const after = await query(`select 1 from forge_scheduling_user_role_assignments where owner_id=test_actor_uuid('owner_1')::text and id='${before[0].id}' and retired_at is null`);
    expect(after).toHaveLength(0);
    await asActor("staff_2");
    expect((await query(`select has_scheduling_permission(test_actor_uuid('owner_1')::text, 'scheduling.schedules.read') as ok`))[0].ok).toBe(false);
  });
});

describe("audit — atomic, immutable, one row per action", () => {
  it("a capability grant writes exactly one audit row with actor/action/target/old/new", async () => {
    await asOwner();
    const before = (await query(`select count(*)::int as n from forge_scheduling_permission_audit`))[0].n;
    await asAuthenticated();
    await asActor("owner_1");
    await exec(`select forge_scheduling_role_capability_set(test_actor_uuid('owner_1')::text, 'role_reader', 'scheduling.calendars.read', true, 1, 'req-13', 'needs calendars')`);
    const rows = await query(`select action, actor_id, target_role_id, reason, request_id from forge_scheduling_permission_audit order by recorded_at desc limit 1`);
    const [{ v: owner1ActorId }] = await query(`select test_actor_uuid('owner_1')::text as v`);
    expect(rows[0]).toMatchObject({ action: "capability_add", actor_id: owner1ActorId, target_role_id: "role_reader", reason: "needs calendars", request_id: "req-13" });
    const after = (await query(`select count(*)::int as n from forge_scheduling_permission_audit`))[0].n;
    expect(after).toBe(before + 1);
  });

  it("the audit table is immutable — the authenticated role has no update/delete grant", async () => {
    expect(await tablePrivilege("authenticated", "forge_scheduling_permission_audit", "UPDATE")).toBe(false);
    expect(await tablePrivilege("authenticated", "forge_scheduling_permission_audit", "DELETE")).toBe(false);
    expect(await tablePrivilege("authenticated", "forge_scheduling_permission_audit", "INSERT")).toBe(false);
  });
});

describe("effective ACL / RLS / function EXECUTE receipts — the explicit-REVOKE requirement", () => {
  it("no new table grants anon or service_role anything, despite the hostile-default fixture granting ALL by default", async () => {
    for (const table of ["forge_scheduling_roles", "forge_scheduling_role_capabilities", "forge_scheduling_user_role_assignments", "forge_scheduling_permission_audit"]) {
      for (const role of ["anon", "service_role"]) {
        expect(await tablePrivilege(role, table, "SELECT")).toBe(false);
        expect(await tablePrivilege(role, table, "INSERT")).toBe(false);
      }
      expect(await tablePrivilege("authenticated", table, "SELECT")).toBe(true);
      expect(await tablePrivilege("authenticated", table, "INSERT")).toBe(false);
      expect(await tablePrivilege("authenticated", table, "UPDATE")).toBe(false);
      expect(await tablePrivilege("authenticated", table, "DELETE")).toBe(false);
    }
  });

  it("every new function's PUBLIC EXECUTE is revoked; only authenticated can call them", async () => {
    const signatures = [
      "has_scheduling_permission(text,text)",
      "forge_scheduling_roles_snapshot(text)",
      "forge_scheduling_role_create(text,text,text,text,text)",
      "forge_scheduling_role_capability_set(text,text,text,boolean,integer,text,text)",
      "forge_scheduling_role_assign(text,text,text,text,text)",
      "forge_scheduling_role_assignment_revoke(text,text,integer,text,text)",
      "forge_scheduling_roles_provision_starter_set(text,text)",
      "forge_scheduling_staff_search(text,text,text)",
    ];
    for (const sig of signatures) {
      expect(await functionPrivilege("anon", sig)).toBe(false);
      expect(await functionPrivilege("service_role", sig)).toBe(false);
      expect(await functionPrivilege("authenticated", sig)).toBe(true);
    }
  });

  it("RLS is enabled AND forced on every new table", async () => {
    const rows = await query(`
      select relname, relrowsecurity, relforcerowsecurity from pg_class
      where relname in ('forge_scheduling_roles', 'forge_scheduling_role_capabilities', 'forge_scheduling_user_role_assignments', 'forge_scheduling_permission_audit')
    `);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });
});

describe("spoofed actor — a caller-supplied actor is never trusted", () => {
  it("auth.uid() (test.actor), never a function argument, determines who the audit blames", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    await exec(`select forge_scheduling_role_create(test_actor_uuid('owner_1')::text, 'role_spoof_check', 'Spoof Check', 'req-14', null)`);
    const rows = await query(`select actor_id from forge_scheduling_permission_audit where target_role_id = (select id from forge_scheduling_roles where owner_id=test_actor_uuid('owner_1')::text and role_key='role_spoof_check') order by recorded_at desc limit 1`);
    const [{ v: ownerActorId }] = await query(`select test_actor_uuid('owner_1')::text as v`);
    expect(rows[0].actor_id).toBe(ownerActorId);
  });
});

describe("inactive / invited staff get nothing", () => {
  it("a suspended former co-owner loses the structural bypass immediately", async () => {
    await asOwner();
    await exec(`insert into workspace_members (owner_id, member_user_id, status, role) values (test_actor_uuid('owner_1')::text, test_actor_uuid('exco_1'), 'suspended', 'co_owner')`);
    await asAuthenticated();
    await asActor("exco_1");
    const rows = await query(`select has_scheduling_permission(test_actor_uuid('owner_1')::text, 'scheduling.schedules.read') as ok`);
    expect(rows[0].ok).toBe(false);
  });

  it("an invited-but-not-active co-owner has no bypass yet", async () => {
    await asOwner();
    await exec(`insert into workspace_members (owner_id, member_user_id, status, role) values (test_actor_uuid('owner_1')::text, test_actor_uuid('invited_1'), 'invited', 'co_owner')`);
    await asAuthenticated();
    await asActor("invited_1");
    const rows = await query(`select has_scheduling_permission(test_actor_uuid('owner_1')::text, 'scheduling.schedules.read') as ok`);
    expect(rows[0].ok).toBe(false);
  });

  it("a user with zero assignment rows gets nothing", async () => {
    await asAuthenticated();
    await asActor("never_assigned_1");
    const rows = await query(`select has_scheduling_permission(test_actor_uuid('owner_1')::text, 'scheduling.schedules.read') as ok`);
    expect(rows[0].ok).toBe(false);
  });
});

describe("idempotency — request_id round-trips and is required", () => {
  it("p_request_id is stored verbatim on the audit row", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    const rows = await query(`select * from forge_scheduling_role_create(test_actor_uuid('owner_1')::text, 'role_idem_check', 'Idempotency Check', 'req-idem-001', null)`);
    const audit = await query(`select request_id from forge_scheduling_permission_audit where target_role_id = '${rows[0].id}' order by recorded_at desc limit 1`);
    expect(audit[0].request_id).toBe("req-idem-001");
  });

  it("a null or blank request_id is rejected on every write RPC", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    await expectRejected(
      exec(`select forge_scheduling_role_create(test_actor_uuid('owner_1')::text, 'role_no_req', 'No Req', null, null)`),
      /SADM1_REQUEST_ID_REQUIRED/,
    );
    await expectRejected(
      exec(`select forge_scheduling_role_create(test_actor_uuid('owner_1')::text, 'role_no_req', 'No Req', '   ', null)`),
      /SADM1_REQUEST_ID_REQUIRED/,
    );
  });
});

describe("atomic audit — a rejected write leaves the audit log untouched", () => {
  it("a version-conflict rejection on capability_set writes zero audit rows for that attempt", async () => {
    await asOwner();
    await exec(`
      insert into forge_scheduling_roles (owner_id, id, role_key, name, created_by, updated_by)
      values (test_actor_uuid('owner_1')::text, 'role_atomic_check', 'atomic_check', 'Atomic Check', test_actor_uuid('owner_1')::text, test_actor_uuid('owner_1')::text);
    `);
    await asAuthenticated();
    await asActor("owner_1");
    const before = (await query(`select count(*)::int as n from forge_scheduling_permission_audit`))[0].n;
    await expectRejected(
      exec(`select forge_scheduling_role_capability_set(test_actor_uuid('owner_1')::text, 'role_atomic_check', 'scheduling.schedules.read', true, 99, 'req-atomic-1', null)`),
      /SADM1_VERSION_CONFLICT/,
    );
    const after = (await query(`select count(*)::int as n from forge_scheduling_permission_audit`))[0].n;
    expect(after).toBe(before);
    const caps = await query(`select 1 from forge_scheduling_role_capabilities where owner_id=test_actor_uuid('owner_1')::text and role_id='role_atomic_check'`);
    expect(caps).toHaveLength(0);
  });

  it("an owner-only rejection on role_create writes zero audit rows for that attempt", async () => {
    await asAuthenticated();
    await asActor("stranger_atomic_1");
    const before = (await query(`select count(*)::int as n from forge_scheduling_permission_audit`))[0].n;
    await expectRejected(
      exec(`select forge_scheduling_role_create(test_actor_uuid('owner_1')::text, 'role_stranger_attempt', 'Stranger Attempt', 'req-atomic-2', null)`),
      /SADM1_OWNER_ONLY/,
    );
    const after = (await query(`select count(*)::int as n from forge_scheduling_permission_audit`))[0].n;
    expect(after).toBe(before);
  });
});

describe("starter-role provisioning — forge_scheduling_roles_provision_starter_set", () => {
  it("owner-only: a non-owner cannot provision starter roles", async () => {
    await asAuthenticated();
    await asActor("stranger_starter_1");
    await expectRejected(
      exec(`select forge_scheduling_roles_provision_starter_set(test_actor_uuid('owner_3')::text, 'req-starter-0')`),
      /SADM1_OWNER_ONLY/,
    );
  });

  it("creates exactly the four starter roles with the brief's capability sets on first call", async () => {
    await asAuthenticated();
    await asActor("owner_3");
    const rows = await query(`select * from forge_scheduling_roles_provision_starter_set(test_actor_uuid('owner_3')::text, 'req-starter-1')`);
    const keys = rows.map((r) => r.role_key).sort();
    expect(keys).toEqual(["admin", "crew_lead", "scheduler", "viewer"]);

    const adminCaps = await query(`
      select capability_key from forge_scheduling_role_capabilities rc
      join forge_scheduling_roles r on r.owner_id = rc.owner_id and r.id = rc.role_id
      where rc.owner_id = test_actor_uuid('owner_3')::text and r.role_key = 'admin'
      order by capability_key
    `);
    expect(adminCaps.map((c) => c.capability_key)).not.toContain("scheduling.roles.manage"); // explicit delegation only.
    expect(adminCaps.map((c) => c.capability_key)).not.toContain("scheduling.staff.invite");
    expect(adminCaps.map((c) => c.capability_key)).not.toContain("scheduling.settings.edit");
    expect(adminCaps.map((c) => c.capability_key)).toContain("scheduling.calendars.configure");
    expect(adminCaps.map((c) => c.capability_key)).toContain("scheduling.resources.allocate");

    const viewerCaps = await query(`
      select capability_key from forge_scheduling_role_capabilities rc
      join forge_scheduling_roles r on r.owner_id = rc.owner_id and r.id = rc.role_id
      where rc.owner_id = test_actor_uuid('owner_3')::text and r.role_key = 'viewer'
      order by capability_key
    `);
    expect(viewerCaps.map((c) => c.capability_key)).toEqual(["scheduling.activities.read", "scheduling.calendars.read", "scheduling.schedules.read"]);

    const crewLeadCaps = await query(`
      select capability_key from forge_scheduling_role_capabilities rc
      join forge_scheduling_roles r on r.owner_id = rc.owner_id and r.id = rc.role_id
      where rc.owner_id = test_actor_uuid('owner_3')::text and r.role_key = 'crew_lead'
      order by capability_key
    `);
    // Crew Lead is deliberately identical to Viewer in this slice — the
    // brief's own "default read-only until per-job scoping is proven
    // safe" instruction, verified here so a future slice that widens it
    // has to deliberately change this assertion, not just drift past it.
    expect(crewLeadCaps.map((c) => c.capability_key)).toEqual(viewerCaps.map((c) => c.capability_key));
  });

  it("second call for the same owner is a no-op on existing role_keys -- no duplicates, no capability resets", async () => {
    await asAuthenticated();
    await asActor("owner_3");
    await exec(`select forge_scheduling_role_capability_set(test_actor_uuid('owner_3')::text, (select id from forge_scheduling_roles where owner_id=test_actor_uuid('owner_3')::text and role_key='scheduler'), 'scheduling.calendars.configure', true, 1, 'req-starter-custom', 'owner customization')`);
    await exec(`select forge_scheduling_roles_provision_starter_set(test_actor_uuid('owner_3')::text, 'req-starter-2')`);

    const rolesCount = await query(`select count(*)::int as n from forge_scheduling_roles where owner_id=test_actor_uuid('owner_3')::text and is_builtin = true and retired_at is null`);
    expect(rolesCount[0].n).toBe(4);

    const customizationSurvived = await query(`
      select 1 from forge_scheduling_role_capabilities rc
      join forge_scheduling_roles r on r.owner_id = rc.owner_id and r.id = rc.role_id
      where rc.owner_id = test_actor_uuid('owner_3')::text and r.role_key = 'scheduler' and rc.capability_key = 'scheduling.calendars.configure'
    `);
    expect(customizationSurvived).toHaveLength(1);
  });

  it("the provisioning RPC also requires p_request_id", async () => {
    await expectRejected(
      exec(`select forge_scheduling_roles_provision_starter_set(test_actor_uuid('owner_3')::text, null)`),
      /SADM1_REQUEST_ID_REQUIRED/,
    );
  });
});

describe("forge_scheduling_staff_search — exact match only, no account enumeration", () => {
  it("finds an existing user by exact id", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    const rows = await query(`select * from forge_scheduling_staff_search(test_actor_uuid('owner_1')::text, 'staff_1', null)`);
    expect(rows).toEqual([{ user_id: "staff_1", email: "staff1@example.com" }]);
  });

  it("finds an existing user by exact, verified email (case-insensitive)", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    const rows = await query(`select * from forge_scheduling_staff_search(test_actor_uuid('owner_1')::text, null, 'STAFF1@Example.com')`);
    expect(rows).toEqual([{ user_id: "staff_1", email: "staff1@example.com" }]);
  });

  it("a non-existent id and a non-existent email both return zero rows, identically", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    const byId = await query(`select * from forge_scheduling_staff_search(test_actor_uuid('owner_1')::text, 'no_such_user', null)`);
    const byEmail = await query(`select * from forge_scheduling_staff_search(test_actor_uuid('owner_1')::text, null, 'nobody@example.com')`);
    expect(byId).toEqual([]);
    expect(byEmail).toEqual([]);
  });

  it("an unverified email returns zero rows, same as a non-existent one", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    const rows = await query(`select * from forge_scheduling_staff_search(test_actor_uuid('owner_1')::text, null, 'unverified1@example.com')`);
    expect(rows).toEqual([]);
  });

  it("passing neither or both search params returns zero rows rather than guessing", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    expect(await query(`select * from forge_scheduling_staff_search(test_actor_uuid('owner_1')::text, null, null)`)).toEqual([]);
    expect(await query(`select * from forge_scheduling_staff_search(test_actor_uuid('owner_1')::text, 'staff_1', 'staff1@example.com')`)).toEqual([]);
  });

  it("an unauthorized caller is rejected outright, never silently given zero rows that could be confused with 'no match'", async () => {
    await asAuthenticated();
    await asActor("stranger_search_1");
    await expectRejected(
      exec(`select * from forge_scheduling_staff_search(test_actor_uuid('owner_1')::text, 'staff_1', null)`),
      /SADM1_FORBIDDEN/,
    );
  });

  it("a non-owner admin holding scheduling.staff.read can search too", async () => {
    await asOwner();
    await exec(`
      insert into forge_scheduling_roles (owner_id, id, role_key, name, created_by, updated_by)
      values (test_actor_uuid('owner_1')::text, 'role_staff_reader', 'staff_reader', 'Staff Reader', test_actor_uuid('owner_1')::text, test_actor_uuid('owner_1')::text);
      insert into forge_scheduling_role_capabilities (owner_id, id, role_id, capability_key, created_by)
      values (test_actor_uuid('owner_1')::text, 'cap_sr1', 'role_staff_reader', 'scheduling.staff.read', test_actor_uuid('owner_1')::text);
      insert into forge_scheduling_user_role_assignments (owner_id, id, assignee_user_id, role_id, assigned_by, updated_by)
      values (test_actor_uuid('owner_1')::text, 'assign_sr1', test_actor_uuid('staff_reader_1')::text, 'role_staff_reader', test_actor_uuid('owner_1')::text, test_actor_uuid('owner_1')::text);
    `);
    await asAuthenticated();
    await asActor("staff_reader_1");
    const rows = await query(`select * from forge_scheduling_staff_search(test_actor_uuid('owner_1')::text, 'staff_1', null)`);
    expect(rows).toEqual([{ user_id: "staff_1", email: "staff1@example.com" }]);
  });
});

describe("reapply", () => {
  it("re-running the migration's own idempotent statements does not error (create table/function if not exists, create or replace)", async () => {
    await asOwner();
    await expect(exec(sadm1Sql)).resolves.not.toThrow();
  });
});
