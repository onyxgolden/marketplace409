// Work Package Planner editable grid — migration proof.
//
// Applies the SHIPPED import-tracking migration SQL (read from disk,
// never ad-hoc) in an in-memory PGlite database (real PostgreSQL) and
// proves:
//   - the columns land on both tables;
//   - the pair CHECK: a row carries both source columns or neither;
//   - the unique index (owner_id, source_system, source_record_id):
//     a second import of the same record is refused, the same record
//     under another owner or another system is fine, and rows never
//     imported (both NULL) are unaffected;
//   - the step stamp RPC: it stamps through the trusted RPC for the
//     workspace owner while the DIRECT client UPDATE is denied for
//     authenticated (the slice-5 ACL shape — SELECT only, update
//     revoked — is applied as a fixture, mirroring production), and
//     only authenticated may execute the RPC.
//
// The migration is FILE ONLY in this PR — this test proves the file,
// it does not apply anything to production.
//
// Roles, the auth.uid() stub, workspace_members, and the
// has_workspace_access() copy mirror production (see
// 20260829000100_add_workspace_authorization_helpers.sql and the
// slice-4 migration test); the ACL fixture mirrors slice 5
// (20261107020000), which revoked update on forge_work_steps.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = "20261109000000_work_package_import_source_tracking.sql";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

function loadMigrationSql() {
  return readFileSync(join(HERE, "..", "..", "..", "supabase", "migrations", MIGRATION), "utf8");
}

async function setupDb() {
  const db = new PGlite();
  await db.exec(`
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
      role text not null
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
    create table forge_work_packages (
      owner_id text not null,
      id text not null,
      status text not null default 'draft',
      primary key (owner_id, id)
    );
    create table forge_work_steps (
      owner_id text not null,
      id text not null,
      work_package_id text not null,
      sequence_no integer not null,
      primary key (owner_id, id)
    );
  `);
  await db.exec(loadMigrationSql());
  // Production ACL shape for forge_work_steps, copied from slice 5:
  // authenticated reads, but may not write directly — every step
  // write goes through a SECURITY DEFINER RPC.
  await db.exec(`
    alter table forge_work_steps enable row level security;
    alter table forge_work_steps force row level security;
    create policy forge_work_steps_workspace_select on forge_work_steps
      for select to authenticated using (has_workspace_access(owner_id));
    grant select on forge_work_steps to authenticated;
    revoke insert, update, delete, truncate, references, trigger on forge_work_steps from authenticated;
    revoke all on forge_work_steps from anon;
    revoke all on forge_work_steps from service_role;
  `);
  return db;
}

async function asRole(db, role, uid, sql, params) {
  await db.exec(`set role ${role}; set app.test_uid = '${uid}';`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`reset role;`);
  }
}

let db;
beforeEach(async () => {
  db = await setupDb();
}, 60000);

async function expectError(sql, params, code) {
  let caught = null;
  try {
    await db.query(sql, params);
  } catch (e) {
    caught = e;
  }
  expect(caught).not.toBe(null);
  if (code) expect(`${caught.code || ""} ${caught.message || ""}`).toContain(code);
  return caught;
}

async function expectRoleError(role, uid, sql, params, code) {
  let caught = null;
  try {
    await asRole(db, role, uid, sql, params);
  } catch (e) {
    caught = e;
  }
  expect(caught).not.toBe(null);
  // Raised exceptions carry code P0001 with the WPP5_* token in the
  // message, while constraint/privilege failures carry the token as
  // the code — check both.
  if (code) expect(`${caught.code || ""} ${caught.message || ""}`).toContain(code);
  return caught;
}

describe("import source tracking migration", () => {
  it("adds the columns and accepts a stamped row", async () => {
    await db.query(
      "insert into forge_work_packages (owner_id, id, source_system, source_record_id) values ($1, $2, 'sap', '1002345')",
      [OWNER_A, "wp_1"],
    );
    const rows = await db.query(
      "select source_system, source_record_id from forge_work_packages where id = 'wp_1'",
    );
    expect(rows.rows[0]).toEqual({ source_system: "sap", source_record_id: "1002345" });
  });

  it("refuses a source record id without its system, and vice versa", async () => {
    await expectError(
      "insert into forge_work_packages (owner_id, id, source_system) values ($1, $2, 'sap')",
      [OWNER_A, "wp_1"],
      "23514",
    );
    await expectError(
      "insert into forge_work_packages (owner_id, id, source_record_id) values ($1, $2, '1002345')",
      [OWNER_A, "wp_2"],
      "23514",
    );
    await expectError(
      "insert into forge_work_steps (owner_id, id, work_package_id, sequence_no, source_record_id) values ($1, $2, 'wp_1', 1, 'WO-88')",
      [OWNER_A, "s_1"],
      "23514",
    );
  });

  it("refuses the same record twice for one owner, allows it for another owner or system", async () => {
    await db.query(
      "insert into forge_work_packages (owner_id, id, source_system, source_record_id) values ($1, $2, 'sap', '1002345')",
      [OWNER_A, "wp_1"],
    );
    await expectError(
      "insert into forge_work_packages (owner_id, id, source_system, source_record_id) values ($1, $2, 'sap', '1002345')",
      [OWNER_A, "wp_2"],
      "23505",
    );
    // Same record, another owner: fine.
    await db.query(
      "insert into forge_work_packages (owner_id, id, source_system, source_record_id) values ($1, $2, 'sap', '1002345')",
      [OWNER_B, "wp_1"],
    );
    // Same record, another system: fine.
    await db.query(
      "insert into forge_work_packages (owner_id, id, source_system, source_record_id) values ($1, $2, 'maximo', '1002345')",
      [OWNER_A, "wp_3"],
    );
    // Rows never imported (both NULL) are unaffected.
    await db.query("insert into forge_work_packages (owner_id, id) values ($1, $2)", [OWNER_A, "wp_4"]);
    await db.query("insert into forge_work_packages (owner_id, id) values ($1, $2)", [OWNER_A, "wp_5"]);
  });

  it("enforces the same uniqueness on steps", async () => {
    await db.query(
      "insert into forge_work_steps (owner_id, id, work_package_id, sequence_no, source_system, source_record_id) values ($1, $2, 'wp_1', 1, 'maximo', 'WO-88')",
      [OWNER_A, "s_1"],
    );
    await expectError(
      "insert into forge_work_steps (owner_id, id, work_package_id, sequence_no, source_system, source_record_id) values ($1, $2, 'wp_1', 2, 'maximo', 'WO-88')",
      [OWNER_A, "s_2"],
      "23505",
    );
    // Another step, another record: fine.
    await db.query(
      "insert into forge_work_steps (owner_id, id, work_package_id, sequence_no, source_system, source_record_id) values ($1, $2, 'wp_1', 2, 'maximo', 'WO-89')",
      [OWNER_A, "s_2"],
    );
  });

  it("stamps through the RPC as authenticated while the direct UPDATE is denied", async () => {
    await db.query(
      "insert into forge_work_steps (owner_id, id, work_package_id, sequence_no) values ($1, $2, 'wp_1', 1)",
      [OWNER_A, "s_1"],
    );
    // Production ACL shape (slice 5): authenticated may SELECT the
    // steps table but may not UPDATE it — the direct write is refused
    // at the ACL layer before RLS even matters. This is the failure
    // the pre-fix apply layer hit on every imported step.
    await expectRoleError(
      "authenticated", OWNER_A,
      "update forge_work_steps set source_system = 'sap', source_record_id = 'X' where id = 's_1'",
      [], "42501",
    );
    // The stamp RPC runs as definer and succeeds for the owner.
    const stamped = await asRole(db, "authenticated", OWNER_A,
      "select * from forge_work_step_stamp_source($1, 'wp_1', 's_1', 'maximo', 'WO-88')",
      [OWNER_A]);
    expect(stamped.rows[0]).toMatchObject({ source_system: "maximo", source_record_id: "WO-88" });
    // Only the two source columns changed — sequence and parentage
    // are untouched, and there is no version/revision side effect
    // to observe on this minimal shape.
    const rows = await db.query(
      "select source_system, source_record_id, sequence_no, work_package_id from forge_work_steps where id = 's_1'",
    );
    expect(rows.rows[0]).toEqual({
      source_system: "maximo", source_record_id: "WO-88", sequence_no: 1, work_package_id: "wp_1",
    });
  });

  it("refuses the stamp for another owner, a missing step, a wrong package, and a blank source", async () => {
    await db.query(
      "insert into forge_work_steps (owner_id, id, work_package_id, sequence_no) values ($1, $2, 'wp_1', 1)",
      [OWNER_A, "s_1"],
    );
    await expectRoleError(
      "authenticated", OWNER_B,
      "select * from forge_work_step_stamp_source($1, 'wp_1', 's_1', 'maximo', 'WO-88')",
      [OWNER_A], "WPP5_WORKSPACE_FORBIDDEN",
    );
    await expectRoleError(
      "authenticated", OWNER_A,
      "select * from forge_work_step_stamp_source($1, 'wp_1', 's_9', 'maximo', 'WO-88')",
      [OWNER_A], "WPP5_STEP_NOT_FOUND",
    );
    await expectRoleError(
      "authenticated", OWNER_A,
      "select * from forge_work_step_stamp_source($1, 'wp_2', 's_1', 'maximo', 'WO-88')",
      [OWNER_A], "WPP5_STEP_NOT_FOUND",
    );
    await expectRoleError(
      "authenticated", OWNER_A,
      "select * from forge_work_step_stamp_source($1, 'wp_1', 's_1', '', 'WO-88')",
      [OWNER_A], "WPP5_INVALID_SOURCE",
    );
  });

  it("refuses a second stamp of the same record on another step", async () => {
    await db.query(
      "insert into forge_work_steps (owner_id, id, work_package_id, sequence_no) values ($1, $2, 'wp_1', 1)",
      [OWNER_A, "s_1"],
    );
    await db.query(
      "insert into forge_work_steps (owner_id, id, work_package_id, sequence_no) values ($1, $2, 'wp_1', 2)",
      [OWNER_A, "s_2"],
    );
    await asRole(db, "authenticated", OWNER_A,
      "select * from forge_work_step_stamp_source($1, 'wp_1', 's_1', 'maximo', 'WO-88')",
      [OWNER_A]);
    await expectRoleError(
      "authenticated", OWNER_A,
      "select * from forge_work_step_stamp_source($1, 'wp_1', 's_2', 'maximo', 'WO-88')",
      [OWNER_A], "23505",
    );
  });

  it("only authenticated may execute the stamp RPC", async () => {
    for (const [role, ok] of [["authenticated", true], ["anon", false], ["service_role", false]]) {
      const rows = await db.query(
        `select has_function_privilege('${role}', 'public.forge_work_step_stamp_source(text, text, text, text, text)', 'EXECUTE') as ok;`,
      );
      expect(rows.rows[0].ok).toBe(ok);
    }
  });
});
