// Scheduling admin permissions — authority-strip repair (2026-11-11).
//
// Applies the original slice-1 migration (20261110080000) and then this
// repair (20261111010000, a `create or replace function` correction with
// identical signatures) in sequence against an in-process real Postgres
// (PGlite), same fixture convention as the original slice-1 test.
//
// Proves the repair non-vacuously: every EXPLOIT test below is run TWICE —
// once against the original migration alone (must SUCCEED, proving the
// vulnerability is real and this fixture reproduces it) and once with the
// repair applied on top (must be REJECTED). A fixture that can't demonstrate
// the pre-fix exploit succeeding is not proof the fix does anything.
//
// The migration is prepared for review only; applying it to the live
// database is Jason's separate approval. No linked or remote database is
// touched.

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const SADM1_PATH = new URL("../20261110080000_forge_scheduling_admin_permissions_slice1.sql", import.meta.url);
const REPAIR_PATH = new URL("../20261111010000_scheduling_admin_permissions_authority_strip_repair.sql", import.meta.url);
const sadm1Sql = readFileSync(SADM1_PATH, "utf8");
const repairSql = readFileSync(REPAIR_PATH, "utf8");

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

async function freshDb(applyRepair) {
  const dbi = new PGlite();
  await dbi.exec(SETUP_SQL);
  await dbi.exec(sadm1Sql);
  if (applyRepair) await dbi.exec(repairSql);

  await dbi.query(`select set_config('test.actor', 'owner_1', false)`);
  await dbi.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      (test_actor_uuid('owner_1')::text, 'owner1@example.com', now()),
      ('admin_1', 'admin1@example.com', now()),
      ('admin_victim', 'adminvictim@example.com', now()),
      ('staff_2', 'staff2@example.com', now());

    insert into forge_scheduling_roles (owner_id, id, role_key, name, created_by, updated_by) values
      (test_actor_uuid('owner_1')::text, 'role_admin', 'admin', 'Admin', test_actor_uuid('owner_1')::text, test_actor_uuid('owner_1')::text),
      (test_actor_uuid('owner_1')::text, 'role_admin2', 'admin2', 'Admin2', test_actor_uuid('owner_1')::text, test_actor_uuid('owner_1')::text),
      (test_actor_uuid('owner_1')::text, 'role_target', 'target', 'Target', test_actor_uuid('owner_1')::text, test_actor_uuid('owner_1')::text);

    insert into forge_scheduling_role_capabilities (owner_id, id, role_id, capability_key, created_by) values
      (test_actor_uuid('owner_1')::text, 'cap_a1', 'role_admin', 'scheduling.roles.manage', test_actor_uuid('owner_1')::text),
      (test_actor_uuid('owner_1')::text, 'cap_a2', 'role_admin', 'scheduling.schedules.read', test_actor_uuid('owner_1')::text),
      (test_actor_uuid('owner_1')::text, 'cap_a3', 'role_admin2', 'scheduling.roles.manage', test_actor_uuid('owner_1')::text);

    insert into forge_scheduling_user_role_assignments (owner_id, id, assignee_user_id, role_id, assigned_by, updated_by) values
      (test_actor_uuid('owner_1')::text, 'assign_admin1', test_actor_uuid('admin_1')::text, 'role_admin', test_actor_uuid('owner_1')::text, test_actor_uuid('owner_1')::text),
      (test_actor_uuid('owner_1')::text, 'assign_victim', test_actor_uuid('admin_victim')::text, 'role_admin2', test_actor_uuid('owner_1')::text, test_actor_uuid('owner_1')::text);
  `);
  return dbi;
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

describe("pre-fix: the exploit is real (fixture reproduces it against the original migration alone)", () => {
  let db;
  beforeAll(async () => {
    db = await freshDb(false);
    await db.exec("set role authenticated");
    await db.query(`select set_config('test.actor', 'admin_1', false)`);
  });

  it("EXPLOIT SUCCEEDS pre-fix: a non-owner admin CAN demote a peer admin's current role", async () => {
    const rows = (await db.query(
      `select * from forge_scheduling_role_assign(test_actor_uuid('owner_1')::text, test_actor_uuid('admin_victim')::text, 'role_target', 'req-exploit-1', null)`,
    )).rows;
    expect(rows).toHaveLength(1);
    const after = (await db.query(
      `select role_id from forge_scheduling_user_role_assignments where owner_id=test_actor_uuid('owner_1')::text and assignee_user_id=test_actor_uuid('admin_victim')::text and retired_at is null`,
    )).rows;
    expect(after[0].role_id).toBe("role_target"); // demoted — the vulnerability is real.
  });

  it("EXPLOIT SUCCEEDS pre-fix: a non-owner admin CAN revoke a peer admin's assignment outright", async () => {
    // Re-provision admin_victim as an admin again (previous test demoted them).
    await db.query(`select set_config('test.actor', 'owner_1', false)`);
    await db.exec("reset role");
    await db.exec(
      `select forge_scheduling_role_assign(test_actor_uuid('owner_1')::text, test_actor_uuid('admin_victim')::text, 'role_admin2', 'req-exploit-2a', null)`,
    );
    const before = (await db.query(
      `select id, version from forge_scheduling_user_role_assignments where owner_id=test_actor_uuid('owner_1')::text and assignee_user_id=test_actor_uuid('admin_victim')::text and retired_at is null`,
    )).rows;

    await db.exec("set role authenticated");
    await db.query(`select set_config('test.actor', 'admin_1', false)`);
    const rows = (await db.query(
      `select * from forge_scheduling_role_assignment_revoke(test_actor_uuid('owner_1')::text, '${before[0].id}', ${before[0].version}, 'req-exploit-2b', null)`,
    )).rows;
    expect(rows).toHaveLength(1);
    const after = (await db.query(
      `select 1 from forge_scheduling_user_role_assignments where owner_id=test_actor_uuid('owner_1')::text and id='${before[0].id}' and retired_at is null`,
    )).rows;
    expect(after).toHaveLength(0); // revoked — the vulnerability is real.
  });
});

describe("post-fix: the repair blocks both exploit paths", () => {
  let db;
  beforeAll(async () => {
    db = await freshDb(true);
  });

  it("BLOCKED post-fix: a non-owner admin cannot reassign a peer admin's CURRENT role to a lower-privilege one", async () => {
    await db.exec("set role authenticated");
    await db.query(`select set_config('test.actor', 'admin_1', false)`);
    await expectRejected(
      db.exec(`select forge_scheduling_role_assign(test_actor_uuid('owner_1')::text, test_actor_uuid('admin_victim')::text, 'role_target', 'req-fix-1', null)`),
      /SADM1_CANNOT_EDIT_ANOTHER_ADMIN_ROLE/,
    );
    const stillAdmin = (await db.query(
      `select role_id from forge_scheduling_user_role_assignments where owner_id=test_actor_uuid('owner_1')::text and assignee_user_id=test_actor_uuid('admin_victim')::text and retired_at is null`,
    )).rows;
    expect(stillAdmin[0].role_id).toBe("role_admin2"); // the demotion did not happen.
  });

  it("BLOCKED post-fix: a non-owner admin cannot revoke a peer admin's CURRENT assignment", async () => {
    await db.exec("reset role");
    await db.query(`select set_config('test.actor', 'owner_1', false)`);
    const before = (await db.query(
      `select id, version from forge_scheduling_user_role_assignments where owner_id=test_actor_uuid('owner_1')::text and assignee_user_id=test_actor_uuid('admin_victim')::text and retired_at is null`,
    )).rows;

    await db.exec("set role authenticated");
    await db.query(`select set_config('test.actor', 'admin_1', false)`);
    await expectRejected(
      db.exec(`select forge_scheduling_role_assignment_revoke(test_actor_uuid('owner_1')::text, '${before[0].id}', ${before[0].version}, 'req-fix-2', null)`),
      /SADM1_CANNOT_EDIT_ANOTHER_ADMIN_ROLE/,
    );
    const stillActive = (await db.query(
      `select 1 from forge_scheduling_user_role_assignments where owner_id=test_actor_uuid('owner_1')::text and id='${before[0].id}' and retired_at is null`,
    )).rows;
    expect(stillActive).toHaveLength(1); // the revoke did not happen.
  });

  it("control (over-blocking check): a non-owner admin CAN still reassign a NON-admin target to a non-admin role", async () => {
    await db.exec("reset role");
    await db.query(`select set_config('test.actor', 'owner_1', false)`);
    await db.exec(`select forge_scheduling_role_assign(test_actor_uuid('owner_1')::text, test_actor_uuid('staff_2')::text, 'role_target', 'req-fix-3a', null)`);

    await db.exec("set role authenticated");
    await db.query(`select set_config('test.actor', 'admin_1', false)`);
    // role_target grants nothing (no capabilities inserted for it), well within admin_1's own
    // capabilities, and staff_2 is not currently an admin — the new guard checks the TARGET's
    // EXISTING authority, not the proposed role, so a plain reassignment to the same non-admin
    // role must still succeed (proves the fix didn't block ordinary non-admin reassignment).
    const rows = (await db.query(
      `select * from forge_scheduling_role_assign(test_actor_uuid('owner_1')::text, test_actor_uuid('staff_2')::text, 'role_target', 'req-fix-3b', null)`,
    )).rows;
    expect(rows).toHaveLength(1);
    const assigned = (await db.query(
      `select role_id from forge_scheduling_user_role_assignments where owner_id=test_actor_uuid('owner_1')::text and assignee_user_id=test_actor_uuid('staff_2')::text and retired_at is null`,
    )).rows;
    expect(assigned[0].role_id).toBe("role_target");
  });

  it("control (over-blocking check): a non-owner admin CAN still revoke a NON-admin target's assignment", async () => {
    await db.exec("reset role");
    await db.query(`select set_config('test.actor', 'owner_1', false)`);
    await db.exec(`select forge_scheduling_role_assign(test_actor_uuid('owner_1')::text, test_actor_uuid('staff_2')::text, 'role_target', 'req-fix-4a', null)`);
    const before = (await db.query(
      `select id, version from forge_scheduling_user_role_assignments where owner_id=test_actor_uuid('owner_1')::text and assignee_user_id=test_actor_uuid('staff_2')::text and retired_at is null`,
    )).rows;

    await db.exec("set role authenticated");
    await db.query(`select set_config('test.actor', 'admin_1', false)`);
    const rows = (await db.query(
      `select * from forge_scheduling_role_assignment_revoke(test_actor_uuid('owner_1')::text, '${before[0].id}', ${before[0].version}, 'req-fix-4b', null)`,
    )).rows;
    expect(rows).toHaveLength(1);
    const after = (await db.query(
      `select 1 from forge_scheduling_user_role_assignments where owner_id=test_actor_uuid('owner_1')::text and id='${before[0].id}' and retired_at is null`,
    )).rows;
    expect(after).toHaveLength(0); // non-admin target: revoke still works normally.
  });

  it("owner bypass preserved: the real owner CAN demote a peer admin despite the new guard", async () => {
    await db.exec("reset role");
    await db.query(`select set_config('test.actor', 'owner_1', false)`);
    const rows = (await db.query(
      `select * from forge_scheduling_role_assign(test_actor_uuid('owner_1')::text, test_actor_uuid('admin_victim')::text, 'role_target', 'req-fix-5', null)`,
    )).rows;
    expect(rows).toHaveLength(1);
    const assigned = (await db.query(
      `select role_id from forge_scheduling_user_role_assignments where owner_id=test_actor_uuid('owner_1')::text and assignee_user_id=test_actor_uuid('admin_victim')::text and retired_at is null`,
    )).rows;
    expect(assigned[0].role_id).toBe("role_target");
  });

  it("owner bypass preserved: the real owner CAN revoke an admin's assignment outright", async () => {
    await db.exec("reset role");
    await db.query(`select set_config('test.actor', 'owner_1', false)`);
    await db.exec(`select forge_scheduling_role_assign(test_actor_uuid('owner_1')::text, test_actor_uuid('admin_victim')::text, 'role_admin2', 'req-fix-6a', null)`);
    const before = (await db.query(
      `select id, version from forge_scheduling_user_role_assignments where owner_id=test_actor_uuid('owner_1')::text and assignee_user_id=test_actor_uuid('admin_victim')::text and retired_at is null`,
    )).rows;
    const rows = (await db.query(
      `select * from forge_scheduling_role_assignment_revoke(test_actor_uuid('owner_1')::text, '${before[0].id}', ${before[0].version}, 'req-fix-6b', null)`,
    )).rows;
    expect(rows).toHaveLength(1);
    const after = (await db.query(
      `select 1 from forge_scheduling_user_role_assignments where owner_id=test_actor_uuid('owner_1')::text and id='${before[0].id}' and retired_at is null`,
    )).rows;
    expect(after).toHaveLength(0);
  });
});

describe("reapply", () => {
  it("the repair migration can be applied a second time with no error (idempotent create-or-replace)", async () => {
    const db = await freshDb(true);
    await expect(db.exec(repairSql)).resolves.not.toThrow();
  });
});
