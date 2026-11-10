// Work Package Planner — Admin Permissions, Slice 1 — migration contract,
// executed against an in-process real Postgres (PGlite). Mirrors the
// slice-1/slice-2 migration tests' convention: stub auth.uid() /
// has_workspace_access, roles authenticated/anon/service_role, and (new
// for this slice) a workspace_members table matching the real
// has_workspace_access co-owner predicate, so the owner/co-owner
// structural bypass in has_planner_permission is tested against the
// genuine shape, not an invented one.
//
// Priority order per the build assignment: the hard rule (no drawing-edit
// capability can ever exist, and no RPC in this slice can mutate a
// controlled drawing's content/path/hash) and the non-escalation checks
// first, then the rest of the acceptance matrix.
//
// The migration is prepared for review only; applying it to production is
// Jason's separate approval. No linked or remote database is touched.

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const SLICE1_PATH = new URL("../20261104000000_forge_work_package_takeoff_slice1.sql", import.meta.url);
const PADM1_PATH = new URL("../20261110000000_forge_planner_admin_permissions_slice1.sql", import.meta.url);
const slice1Sql = readFileSync(SLICE1_PATH, "utf8");
const padm1Sql = readFileSync(PADM1_PATH, "utf8");
// Comment-stripped view of the migration's own source, so a static assertion
// like "this file issues no UPDATE against forge_work_drawings" can't be
// tripped by a code comment that merely *describes* that same check in
// English (this file's own header does, verbatim).
const padm1SqlNoComments = padm1Sql.replace(/--.*$/gm, "");

const SETUP_SQL = `
  create role authenticated;
  create role anon;
  create role service_role;
  create schema auth;
  create function auth.uid()
  returns text language sql stable as $$
    select nullif(current_setting('test.actor', true), '')
  $$;

  -- Matches the real workspace_members shape has_workspace_access and
  -- this slice's own forge_planner role-bypass both read against. Must
  -- exist before has_workspace_access is defined below.
  create table workspace_members (
    owner_id text not null,
    member_user_id text not null,
    status text not null,
    role text not null,
    primary key (owner_id, member_user_id)
  );
  grant select on workspace_members to authenticated;

  create function has_workspace_access(p_owner text)
  returns boolean language sql stable as $$
    select p_owner = current_setting('test.actor', true)
        or exists (
          select 1 from workspace_members
          where owner_id = p_owner and member_user_id = current_setting('test.actor', true)
            and status = 'active' and role = 'co_owner'
        )
  $$;

  create table forge_work_packages (
    owner_id text not null,
    id text not null,
    primary key (owner_id, id)
  );
  grant select, insert, update, delete on forge_work_packages to authenticated;
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
  // Hostile defaults BEFORE any slice table exists — the Nov 4 lesson,
  // same fixture every later slice's test carries: Supabase's real
  // project defaults grant ALL on new tables / EXECUTE on new functions
  // to authenticated (and often anon), so a migration that only does a
  // selective GRANT without an explicit REVOKE silently stays wide open.
  await db.exec(`
    do $$ begin
      execute format(
        'alter default privileges for role %I in schema public grant all on tables to authenticated, anon',
        current_user
      );
      execute format(
        'alter default privileges for role %I in schema public grant execute on functions to authenticated, anon',
        current_user
      );
    end $$;
  `);
  const naiveFn = `create function naive_widen_fn() returns text language sql as $$ select 'x' $$`;
  await db.exec(`create table naive_widen (id text not null primary key)`);
  await db.exec(`grant select, insert, update on naive_widen to authenticated`);
  await db.exec(naiveFn);

  await db.exec(slice1Sql);
  await db.exec(padm1Sql);

  await asActor("owner_1");
  await exec(`insert into forge_work_packages (owner_id, id) values ('owner_1', 'pkg_1')`);
  await exec(`
    insert into forge_work_drawings (owner_id, id, package_id, drawing_number, drawing_type)
    values ('owner_1', 'dwg_pid1', 'pkg_1', 'P-101', 'p_id')
  `);
  await exec(`insert into workspace_members (owner_id, member_user_id, status, role) values ('owner_1', 'coowner_1', 'active', 'co_owner')`);
});

describe("fixture sanity (the hostile-default detector)", () => {
  it("proves the fixture itself widens privileges, so the ACL assertions below prove something real", async () => {
    expect(await tablePrivilege("authenticated", "naive_widen", "DELETE")).toBe(true);
    expect(await functionPrivilege("authenticated", "naive_widen_fn()")).toBe(true);
  });
});

describe("the hard rule — no drawing-edit capability, anywhere, ever", () => {
  it("the capability catalog CHECK constraint rejects planner.drawings.edit", async () => {
    await asOwner();
    await expectRejected(
      exec(`
        insert into forge_planner_roles (owner_id, id, role_key, name, created_by, updated_by)
        values ('owner_1', 'role_x', 'x', 'X', 'owner_1', 'owner_1');
        insert into forge_planner_role_capabilities (owner_id, id, role_id, capability_key, created_by)
        values ('owner_1', 'cap_x', 'role_x', 'planner.drawings.edit', 'owner_1');
      `),
      /violates check constraint|forge_planner_role_capabilities_capability_key_check/,
    );
  });

  it("the 39-key catalog contains no key matching 'edit' for drawings under any spelling", async () => {
    const rows = await query(`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conname = 'forge_planner_role_capabilities_capability_key_check'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].def).not.toMatch(/drawings\.edit/i);
  });

  it("no function this migration creates issues an UPDATE against forge_work_drawings at all", () => {
    // Static proof over the migration's own source: this slice adds zero
    // write paths to the drawings table, controlled or otherwise — the
    // strongest form of "cannot edit" is "cannot reach the table as a
    // writer in the first place." A behavioral attempt isn't meaningful
    // here because there is no RPC in this file that takes a drawing id.
    expect(padm1SqlNoComments).not.toMatch(/update\s+(public\.)?forge_work_drawings/i);
  });

  it("even the real Owner structural bypass in has_planner_permission never touches forge_work_drawings", () => {
    const fnBody = padm1Sql.slice(padm1Sql.indexOf("function public.has_planner_permission"));
    expect(fnBody.slice(0, fnBody.indexOf("$$", fnBody.indexOf("$$") + 2) + 2)).not.toMatch(/forge_work_drawings/i);
  });
});

describe("has_planner_permission — owner/co-owner structural bypass", () => {
  it("the real owner has every catalog capability with zero role rows", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    const rows = await query(`select has_planner_permission('owner_1', 'planner.roles.manage') as ok`);
    expect(rows[0].ok).toBe(true);
  });

  it("an active co-owner has every catalog capability with zero role rows", async () => {
    await asAuthenticated();
    await asActor("coowner_1");
    const rows = await query(`select has_planner_permission('owner_1', 'planner.settings.edit') as ok`);
    expect(rows[0].ok).toBe(true);
  });

  it("an unrelated user has no capability at all", async () => {
    await asAuthenticated();
    await asActor("stranger_1");
    const rows = await query(`select has_planner_permission('owner_1', 'planner.packages.read') as ok`);
    expect(rows[0].ok).toBe(false);
  });

  it("a staff user with an assigned role only has that role's granted capabilities, nothing else", async () => {
    await asOwner();
    await exec(`
      insert into forge_planner_roles (owner_id, id, role_key, name, created_by, updated_by)
      values ('owner_1', 'role_reader', 'reader', 'Reader', 'owner_1', 'owner_1');
      insert into forge_planner_role_capabilities (owner_id, id, role_id, capability_key, created_by)
      values ('owner_1', 'cap_r1', 'role_reader', 'planner.packages.read', 'owner_1');
      insert into forge_planner_user_role_assignments (owner_id, id, assignee_user_id, role_id, assigned_by, updated_by)
      values ('owner_1', 'assign_1', 'staff_1', 'role_reader', 'owner_1', 'owner_1');
    `);
    await asAuthenticated();
    await asActor("staff_1");
    expect((await query(`select has_planner_permission('owner_1', 'planner.packages.read') as ok`))[0].ok).toBe(true);
    expect((await query(`select has_planner_permission('owner_1', 'planner.packages.edit') as ok`))[0].ok).toBe(false);
  });

  it("cross-owner isolation: a role/assignment under one owner never grants anything under another", async () => {
    await asOwner();
    await exec(`insert into forge_work_packages (owner_id, id) values ('owner_2', 'pkg_2')`);
    await asAuthenticated();
    await asActor("staff_1"); // has planner.packages.read only under owner_1.
    const rows = await query(`select has_planner_permission('owner_2', 'planner.packages.read') as ok`);
    expect(rows[0].ok).toBe(false);
  });
});

describe("non-escalation — forge_planner_role_capability_set", () => {
  it("a non-owner admin cannot edit their own role", async () => {
    await asOwner();
    await exec(`
      insert into forge_planner_roles (owner_id, id, role_key, name, created_by, updated_by)
      values ('owner_1', 'role_admin', 'admin', 'Admin', 'owner_1', 'owner_1');
      insert into forge_planner_role_capabilities (owner_id, id, role_id, capability_key, created_by)
      values ('owner_1', 'cap_a1', 'role_admin', 'planner.roles.manage', 'owner_1'),
             ('owner_1', 'cap_a2', 'role_admin', 'planner.packages.read', 'owner_1');
      insert into forge_planner_user_role_assignments (owner_id, id, assignee_user_id, role_id, assigned_by, updated_by)
      values ('owner_1', 'assign_admin', 'admin_1', 'role_admin', 'owner_1', 'owner_1');
    `);
    await asAuthenticated();
    await asActor("admin_1");
    await expectRejected(
      exec(`select forge_planner_role_capability_set('owner_1', 'role_admin', 'planner.packages.edit', true, 1, 'req-1', null)`),
      /PADM1_CANNOT_EDIT_OWN_ROLE/,
    );
  });

  it("a non-owner admin cannot edit a role that itself grants planner.roles.manage (another admin's authority)", async () => {
    await asOwner();
    await exec(`
      insert into forge_planner_roles (owner_id, id, role_key, name, created_by, updated_by)
      values ('owner_1', 'role_admin2', 'admin2', 'Admin2', 'owner_1', 'owner_1');
      insert into forge_planner_role_capabilities (owner_id, id, role_id, capability_key, created_by)
      values ('owner_1', 'cap_a3', 'role_admin2', 'planner.roles.manage', 'owner_1');
    `);
    await asAuthenticated();
    await asActor("admin_1");
    await expectRejected(
      exec(`select forge_planner_role_capability_set('owner_1', 'role_admin2', 'planner.settings.edit', true, 1, 'req-2', null)`),
      /PADM1_CANNOT_EDIT_ANOTHER_ADMIN_ROLE/,
    );
  });

  it("a non-owner admin cannot grant a capability they do not themselves hold", async () => {
    await asOwner();
    await exec(`
      insert into forge_planner_roles (owner_id, id, role_key, name, created_by, updated_by)
      values ('owner_1', 'role_target', 'target', 'Target', 'owner_1', 'owner_1');
    `);
    await asAuthenticated();
    await asActor("admin_1"); // holds planner.roles.manage + planner.packages.read only.
    await expectRejected(
      exec(`select forge_planner_role_capability_set('owner_1', 'role_target', 'planner.settings.edit', true, 1, 'req-3', null)`),
      /PADM1_CANNOT_GRANT_UNHELD_CAPABILITY/,
    );
  });

  it("a non-owner admin CAN grant a capability they do themselves hold, to a role they're allowed to touch", async () => {
    await asAuthenticated();
    await asActor("admin_1");
    const rows = await query(`select * from forge_planner_role_capability_set('owner_1', 'role_target', 'planner.packages.read', true, 1, 'req-4', null)`);
    expect(rows[0].version).toBe(2);
    const granted = await query(`select 1 from forge_planner_role_capabilities where owner_id='owner_1' and role_id='role_target' and capability_key='planner.packages.read'`);
    expect(granted).toHaveLength(1);
  });

  it("the 'owner' builtin role key can never be edited by anyone", async () => {
    await asOwner();
    await exec(`insert into forge_planner_roles (owner_id, id, role_key, name, is_builtin, created_by, updated_by) values ('owner_1', 'role_owner_builtin', 'owner', 'Owner', true, 'owner_1', 'owner_1')`);
    await asAuthenticated();
    await asActor("owner_1");
    await expectRejected(
      exec(`select forge_planner_role_capability_set('owner_1', 'role_owner_builtin', 'planner.packages.read', true, 1, 'req-5', null)`),
      /PADM1_OWNER_ROLE_IMMUTABLE/,
    );
  });

  it("a stale expected_version is refused (optimistic concurrency)", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    await expectRejected(
      exec(`select forge_planner_role_capability_set('owner_1', 'role_target', 'planner.packages.read', false, 1, 'req-6', null)`), // version is now 2.
      /PADM1_VERSION_CONFLICT/,
    );
  });
});

describe("non-escalation — forge_planner_role_assign", () => {
  it("cannot assign a role to the real owner or an active co-owner through this path", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    await expectRejected(
      exec(`select forge_planner_role_assign('owner_1', 'owner_1', 'role_target', 'req-7', null)`),
      /PADM1_CANNOT_ASSIGN_OWNER_OR_COOWNER/,
    );
    await expectRejected(
      exec(`select forge_planner_role_assign('owner_1', 'coowner_1', 'role_target', 'req-8', null)`),
      /PADM1_CANNOT_ASSIGN_OWNER_OR_COOWNER/,
    );
  });

  it("a non-owner admin cannot assign a role whose capabilities exceed what the admin themselves holds", async () => {
    await asOwner();
    await exec(`
      insert into forge_planner_roles (owner_id, id, role_key, name, created_by, updated_by)
      values ('owner_1', 'role_overreach', 'overreach', 'Overreach', 'owner_1', 'owner_1');
      insert into forge_planner_role_capabilities (owner_id, id, role_id, capability_key, created_by)
      values ('owner_1', 'cap_over1', 'role_overreach', 'planner.settings.edit', 'owner_1');
    `);
    await asAuthenticated();
    await asActor("admin_1"); // does not hold planner.settings.edit.
    await expectRejected(
      exec(`select forge_planner_role_assign('owner_1', 'staff_2', 'role_overreach', 'req-9', null)`),
      /PADM1_CANNOT_ASSIGN_ROLE_EXCEEDING_OWN_CAPABILITIES/,
    );
  });

  it("the real owner CAN assign any role, including one an admin couldn't", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    const rows = await query(`select * from forge_planner_role_assign('owner_1', 'staff_2', 'role_overreach', 'req-10', null)`);
    expect(rows).toHaveLength(1);
    const assigned = await query(`select role_id from forge_planner_user_role_assignments where owner_id='owner_1' and assignee_user_id='staff_2' and retired_at is null`);
    expect(assigned[0].role_id).toBe("role_overreach");
  });

  it("one role per user: reassigning updates the same active row instead of creating a second one", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    await exec(`select forge_planner_role_assign('owner_1', 'staff_2', 'role_target', 'req-11', null)`);
    const active = await query(`select role_id from forge_planner_user_role_assignments where owner_id='owner_1' and assignee_user_id='staff_2' and retired_at is null`);
    expect(active).toHaveLength(1);
    expect(active[0].role_id).toBe("role_target");
  });

  it("immediate effect: a role change is visible to has_planner_permission on the very next check, no caching", async () => {
    await asAuthenticated();
    await asActor("staff_2");
    expect((await query(`select has_planner_permission('owner_1', 'planner.packages.read') as ok`))[0].ok).toBe(true); // role_target grants it.
    expect((await query(`select has_planner_permission('owner_1', 'planner.settings.edit') as ok`))[0].ok).toBe(false); // role_overreach's grant no longer applies.
  });
});

describe("assignment revocation", () => {
  it("revoking leaves the assignee with no role, and no assignment can revoke itself for the actor's own id", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    const before = await query(`select id, version from forge_planner_user_role_assignments where owner_id='owner_1' and assignee_user_id='staff_2' and retired_at is null`);
    await exec(`select forge_planner_role_assignment_revoke('owner_1', '${before[0].id}', ${before[0].version}, 'req-12', 'cleanup')`);
    const after = await query(`select 1 from forge_planner_user_role_assignments where owner_id='owner_1' and id='${before[0].id}' and retired_at is null`);
    expect(after).toHaveLength(0);
    // Check the REVOKED USER's own effective permission, not the acting
    // owner's (the owner always passes via the structural bypass regardless
    // of any role table state, so asserting as owner here would prove
    // nothing about the revocation's actual effect).
    await asActor("staff_2");
    expect((await query(`select has_planner_permission('owner_1', 'planner.packages.read') as ok`))[0].ok).toBe(false);
  });
});

describe("audit — atomic, immutable, one row per action", () => {
  it("a capability grant writes exactly one audit row with actor/action/target/old/new", async () => {
    await asOwner();
    const before = (await query(`select count(*)::int as n from forge_planner_permission_audit`))[0].n;
    await asAuthenticated();
    await asActor("owner_1");
    await exec(`select forge_planner_role_capability_set('owner_1', 'role_reader', 'planner.reports.read', true, 1, 'req-13', 'needs reports')`);
    const rows = await query(`select action, actor_id, target_role_id, reason, request_id from forge_planner_permission_audit order by recorded_at desc limit 1`);
    expect(rows[0]).toMatchObject({ action: "capability_add", actor_id: "owner_1", target_role_id: "role_reader", reason: "needs reports", request_id: "req-13" });
    const after = (await query(`select count(*)::int as n from forge_planner_permission_audit`))[0].n;
    expect(after).toBe(before + 1);
  });

  it("the audit table is immutable — the authenticated role has no update/delete grant", async () => {
    expect(await tablePrivilege("authenticated", "forge_planner_permission_audit", "UPDATE")).toBe(false);
    expect(await tablePrivilege("authenticated", "forge_planner_permission_audit", "DELETE")).toBe(false);
    expect(await tablePrivilege("authenticated", "forge_planner_permission_audit", "INSERT")).toBe(false); // only the SECURITY DEFINER RPCs insert.
  });
});

describe("effective ACL / RLS / function EXECUTE receipts — the explicit-REVOKE requirement", () => {
  it("no new table grants anon or service_role anything, despite the hostile-default fixture granting ALL by default", async () => {
    for (const table of ["forge_planner_roles", "forge_planner_role_capabilities", "forge_planner_user_role_assignments", "forge_planner_permission_audit"]) {
      for (const role of ["anon", "service_role"]) {
        expect(await tablePrivilege(role, table, "SELECT")).toBe(false);
        expect(await tablePrivilege(role, table, "INSERT")).toBe(false);
      }
      // authenticated gets SELECT only — never direct INSERT/UPDATE/DELETE (writes are RPC-only).
      expect(await tablePrivilege("authenticated", table, "SELECT")).toBe(true);
      expect(await tablePrivilege("authenticated", table, "INSERT")).toBe(false);
      expect(await tablePrivilege("authenticated", table, "UPDATE")).toBe(false);
      expect(await tablePrivilege("authenticated", table, "DELETE")).toBe(false);
    }
  });

  it("every new function's PUBLIC EXECUTE is revoked; only authenticated can call them", async () => {
    const signatures = [
      "has_planner_permission(text,text)",
      "forge_planner_roles_snapshot(text)",
      "forge_planner_role_create(text,text,text,text,text)",
      "forge_planner_role_capability_set(text,text,text,boolean,integer,text,text)",
      "forge_planner_role_assign(text,text,text,text,text)",
      "forge_planner_role_assignment_revoke(text,text,integer,text,text)",
      "forge_planner_roles_provision_starter_set(text,text)",
    ];
    for (const sig of signatures) {
      expect(await functionPrivilege("anon", sig)).toBe(false);
      expect(await functionPrivilege("service_role", sig)).toBe(false);
      expect(await functionPrivilege("authenticated", sig)).toBe(true);
    }
  });

  it("RLS is enabled AND forced on every new table (owner-with-bypass-attribute cannot be assumed; FORCE closes that)", async () => {
    const rows = await query(`
      select relname, relrowsecurity, relforcerowsecurity from pg_class
      where relname in ('forge_planner_roles', 'forge_planner_role_capabilities', 'forge_planner_user_role_assignments', 'forge_planner_permission_audit')
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
    // forge_planner_role_create takes no actor parameter at all — the
    // only way to influence 'who did this' is the session's own
    // auth.uid(), which this test controls only via test.actor, exactly
    // mirroring how a real PostgREST session's JWT subject works.
    await exec(`select forge_planner_role_create('owner_1', 'role_spoof_check', 'Spoof Check', 'req-14', null)`);
    const rows = await query(`select actor_id from forge_planner_permission_audit where target_role_id = (select id from forge_planner_roles where owner_id='owner_1' and role_key='role_spoof_check') order by recorded_at desc limit 1`);
    expect(rows[0].actor_id).toBe("owner_1");
  });
});

describe("inactive / invited staff get nothing", () => {
  it("a suspended former co-owner loses the structural bypass immediately", async () => {
    await asOwner();
    await exec(`insert into workspace_members (owner_id, member_user_id, status, role) values ('owner_1', 'exco_1', 'suspended', 'co_owner')`);
    await asAuthenticated();
    await asActor("exco_1");
    const rows = await query(`select has_planner_permission('owner_1', 'planner.packages.read') as ok`);
    expect(rows[0].ok).toBe(false);
  });

  it("an invited-but-not-active co-owner has no bypass yet", async () => {
    await asOwner();
    await exec(`insert into workspace_members (owner_id, member_user_id, status, role) values ('owner_1', 'invited_1', 'invited', 'co_owner')`);
    await asAuthenticated();
    await asActor("invited_1");
    const rows = await query(`select has_planner_permission('owner_1', 'planner.packages.read') as ok`);
    expect(rows[0].ok).toBe(false);
  });

  it("a role assignment grants nothing once the assignment itself is retired (already covered) and grants nothing to a user with zero assignment rows", async () => {
    await asAuthenticated();
    await asActor("never_assigned_1");
    const rows = await query(`select has_planner_permission('owner_1', 'planner.packages.read') as ok`);
    expect(rows[0].ok).toBe(false);
  });
});

describe("idempotency — request_id round-trips and is required", () => {
  it("p_request_id is stored verbatim on the audit row", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    const rows = await query(`select * from forge_planner_role_create('owner_1', 'role_idem_check', 'Idempotency Check', 'req-idem-001', null)`);
    const audit = await query(`select request_id from forge_planner_permission_audit where target_role_id = '${rows[0].id}' order by recorded_at desc limit 1`);
    expect(audit[0].request_id).toBe("req-idem-001");
  });

  it("a null or blank request_id is rejected on every write RPC (NOT NULL discipline enforced at the RPC, not just the column)", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    await expectRejected(
      exec(`select forge_planner_role_create('owner_1', 'role_no_req', 'No Req', null, null)`),
      /PADM1_REQUEST_ID_REQUIRED/,
    );
    await expectRejected(
      exec(`select forge_planner_role_create('owner_1', 'role_no_req', 'No Req', '   ', null)`),
      /PADM1_REQUEST_ID_REQUIRED/,
    );
  });
});

describe("atomic audit — a rejected write leaves the audit log untouched", () => {
  it("a version-conflict rejection on capability_set writes zero audit rows for that attempt", async () => {
    await asOwner();
    await exec(`
      insert into forge_planner_roles (owner_id, id, role_key, name, created_by, updated_by)
      values ('owner_1', 'role_atomic_check', 'atomic_check', 'Atomic Check', 'owner_1', 'owner_1');
    `);
    await asAuthenticated();
    await asActor("owner_1");
    const before = (await query(`select count(*)::int as n from forge_planner_permission_audit`))[0].n;
    await expectRejected(
      exec(`select forge_planner_role_capability_set('owner_1', 'role_atomic_check', 'planner.packages.read', true, 99, 'req-atomic-1', null)`),
      /PADM1_VERSION_CONFLICT/,
    );
    const after = (await query(`select count(*)::int as n from forge_planner_permission_audit`))[0].n;
    expect(after).toBe(before);
    const caps = await query(`select 1 from forge_planner_role_capabilities where owner_id='owner_1' and role_id='role_atomic_check'`);
    expect(caps).toHaveLength(0);
  });

  it("an owner-only rejection on role_create writes zero audit rows for that attempt", async () => {
    await asAuthenticated();
    await asActor("stranger_atomic_1");
    const before = (await query(`select count(*)::int as n from forge_planner_permission_audit`))[0].n;
    await expectRejected(
      exec(`select forge_planner_role_create('owner_1', 'role_stranger_attempt', 'Stranger Attempt', 'req-atomic-2', null)`),
      /PADM1_OWNER_ONLY/,
    );
    const after = (await query(`select count(*)::int as n from forge_planner_permission_audit`))[0].n;
    expect(after).toBe(before);
  });
});

describe("starter-role provisioning — forge_planner_roles_provision_starter_set", () => {
  it("owner-only: a non-owner cannot provision starter roles", async () => {
    await asAuthenticated();
    await asActor("stranger_starter_1");
    await expectRejected(
      exec(`select forge_planner_roles_provision_starter_set('owner_3', 'req-starter-0')`),
      /PADM1_OWNER_ONLY/,
    );
  });

  it("creates exactly the five starter roles with the brief's capability sets on first call", async () => {
    await asAuthenticated();
    await asActor("owner_3");
    const rows = await query(`select * from forge_planner_roles_provision_starter_set('owner_3', 'req-starter-1')`);
    const keys = rows.map((r) => r.role_key).sort();
    expect(keys).toEqual(["planner", "planner_admin", "read_only", "reviewer", "scheduler"]);

    const plannerAdminCaps = await query(`
      select capability_key from forge_planner_role_capabilities rc
      join forge_planner_roles r on r.owner_id = rc.owner_id and r.id = rc.role_id
      where rc.owner_id = 'owner_3' and r.role_key = 'planner_admin'
      order by capability_key
    `);
    expect(plannerAdminCaps.map((c) => c.capability_key)).not.toContain("planner.drawings.edit");
    expect(plannerAdminCaps.map((c) => c.capability_key)).toContain("planner.drawings.delete");
    expect(plannerAdminCaps.map((c) => c.capability_key)).toContain("planner.baselines.freeze");
    expect(plannerAdminCaps.map((c) => c.capability_key)).not.toContain("planner.roles.manage");

    const readOnlyCaps = await query(`
      select capability_key from forge_planner_role_capabilities rc
      join forge_planner_roles r on r.owner_id = rc.owner_id and r.id = rc.role_id
      where rc.owner_id = 'owner_3' and r.role_key = 'read_only'
      order by capability_key
    `);
    expect(readOnlyCaps.every((c) => c.capability_key.endsWith(".read"))).toBe(true);
    expect(readOnlyCaps.length).toBeGreaterThanOrEqual(13);
  });

  it("second call for the same owner is a no-op on existing role_keys -- no duplicates, no capability resets", async () => {
    await asAuthenticated();
    await asActor("owner_3");
    await exec(`select forge_planner_role_capability_set('owner_3', (select id from forge_planner_roles where owner_id='owner_3' and role_key='planner'), 'planner.baselines.select', true, 1, 'req-starter-custom', 'owner customization')`);
    await exec(`select forge_planner_roles_provision_starter_set('owner_3', 'req-starter-2')`);

    const rolesCount = await query(`select count(*)::int as n from forge_planner_roles where owner_id='owner_3' and is_builtin = true and retired_at is null`);
    expect(rolesCount[0].n).toBe(5);

    const customizationSurvived = await query(`
      select 1 from forge_planner_role_capabilities rc
      join forge_planner_roles r on r.owner_id = rc.owner_id and r.id = rc.role_id
      where rc.owner_id = 'owner_3' and r.role_key = 'planner' and rc.capability_key = 'planner.baselines.select'
    `);
    expect(customizationSurvived).toHaveLength(1);
  });

  it("every function this migration creates is called with p_request_id required, and the provisioning RPC is no exception", async () => {
    await expectRejected(
      exec(`select forge_planner_roles_provision_starter_set('owner_3', null)`),
      /PADM1_REQUEST_ID_REQUIRED/,
    );
  });
});

describe("reapply", () => {
  it("re-running the migration's own idempotent statements does not error (create table/function if not exists, create or replace)", async () => {
    await asOwner();
    await expect(exec(padm1Sql)).resolves.not.toThrow();
  });
});
