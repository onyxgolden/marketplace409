// Work Package Planner slice 2 — migration contract, executed against an
// in-process Postgres (PGlite). Mirrors the slice-1 migration test's
// convention: a bare forge_work_packages shape, stub has_workspace_access
// / auth.uid(), and roles authenticated/anon/service_role.
//
// The test applies the migrations in production order — slice 1 first,
// then slice 2 — with slice-1 fixture rows created BETWEEN them, so the
// takeoff_lines package_id backfill is tested as a real upgrade, not a
// fresh-install assumption.
//
// Hostile-default fixture (the Nov 4 lesson): before either migration,
// default privileges are set to grant ALL on new tables to
// authenticated, simulating Supabase's project defaults. A deliberately
// naive table (selective GRANT only, no REVOKE) proves the fixture
// detects the widening; the slice-2 tables must then show NO widened
// privilege in their effective ACL, proving the migration's explicit
// REVOKEs do the job. PGlite ACL behavior is real Postgres ACL
// behavior; the one thing this test cannot prove is Supabase's own
// default-privilege configuration — that stays a post-apply receipt
// item, per the slice-2 scope brief.
//
// The migration is prepared for review only; applying it to production
// is Jason's separate approval, same as every migration. No linked or
// remote database is touched by this test.

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const SLICE1_PATH = new URL("../20261104000000_forge_work_package_takeoff_slice1.sql", import.meta.url);
const SLICE2_PATH = new URL("../20261105000000_forge_work_package_progress_slice2.sql", import.meta.url);
const slice1Sql = readFileSync(SLICE1_PATH, "utf8");
const slice2Sql = readFileSync(SLICE2_PATH, "utf8");

const SETUP_SQL = `
  create role authenticated;
  create role anon;
  create role service_role;
  create schema auth;
  create function auth.uid()
  returns text language sql stable as $$
    select nullif(current_setting('test.actor', true), '')
  $$;
  create function has_workspace_access(p_owner text)
  returns boolean language sql stable as $$
    select p_owner = any (string_to_array(coalesce(current_setting('test.owners', true), 'owner_1'), ','))
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

async function asActor(actor, owners) {
  await db.exec(`select set_config('test.actor', '${actor}', false)`);
  await db.exec(`select set_config('test.owners', '${owners}', false)`);
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


function isoDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function tablePrivilege(role, table, privilege) {
  const rows = await query(
    `select has_table_privilege('${role}', '${table}', '${privilege}') as has_priv`,
  );
  return rows[0].has_priv;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP_SQL);
  // Hostile defaults BEFORE any slice table exists: every table created
  // from here on by the test owner also carries ALL for authenticated,
  // exactly the Supabase project-default shape that widened slice 1.
  await db.exec(`
    do $$ begin
      execute format(
        'alter default privileges for role %I in schema public grant all on tables to authenticated, anon',
        current_user
      );
    end $$;
  `);
  // Naive table: selective GRANT only, no REVOKE — the widening
  // detector. If this table does NOT show DELETE for authenticated,
  // the fixture is broken and the ACL assertions below prove nothing.
  await db.exec(`create table naive_widen (id text not null primary key)`);
  await db.exec(`grant select, insert, update on naive_widen to authenticated`);

  // Slice 1, then pre-slice-2 fixtures in slice-1 shape (lines WITHOUT
  // package_id — the column does not exist yet).
  await db.exec(slice1Sql);
  await asActor("owner_1", "owner_1");
  await exec(`insert into forge_work_packages (owner_id, id) values ('owner_1', 'pkg_1'), ('owner_1', 'pkg_2')`);
  await exec(`
    insert into forge_work_drawings (owner_id, id, package_id, drawing_number, drawing_type)
    values ('owner_1', 'dwg_pid1', 'pkg_1', 'P-101', 'p_id'),
           ('owner_1', 'dwg_pid2', 'pkg_2', 'P-201', 'p_id')
  `);
  await exec(`
    insert into forge_work_drawings (owner_id, id, package_id, drawing_number, drawing_type, p_id_drawing_id)
    values ('owner_1', 'dwg_iso1', 'pkg_1', 'ISO-001', 'isometric', 'dwg_pid1')
  `);
  await exec(`
    insert into forge_work_takeoff_lines
      (owner_id, id, drawing_id, line_no, description, quantity, unit, category, fab_location)
    values
      ('owner_1', 'line_1', 'dwg_pid1', 1, '6in pipe', 40, 'ft', 'pipe', 'shop'),
      ('owner_1', 'line_2', 'dwg_iso1', 1, '6in elbow', 10, 'ft', 'fitting', 'field'),
      ('owner_1', 'line_3', 'dwg_pid2', 1, '8in pipe', 25, 'ft', 'pipe', 'shop')
  `);

  // Slice 2 on top of the live slice-1 shape.
  await db.exec(slice2Sql);
  await asAuthenticated();
}, 60000);

describe("forge_work_package_progress_slice2 migration", () => {
  it("creates forge_work_progress_entries and forge_work_progress_revisions", async () => {
    const tables = await query(`
      select table_name from information_schema.tables
      where table_name in ('forge_work_progress_entries', 'forge_work_progress_revisions')
      order by table_name
    `);
    expect(tables.map((t) => t.table_name)).toEqual([
      "forge_work_progress_entries",
      "forge_work_progress_revisions",
    ]);
  });

  it("backfills takeoff_lines.package_id from the parent drawing and enforces same-package keys", async () => {
    const lines = await query(`
      select id, package_id from forge_work_takeoff_lines where owner_id = 'owner_1' order by id
    `);
    expect(lines).toEqual([
      { id: "line_1", package_id: "pkg_1" },
      { id: "line_2", package_id: "pkg_1" },
      { id: "line_3", package_id: "pkg_2" },
    ]);
    const uniqueKeys = await query(`
      select conname from pg_constraint
      where conrelid = 'forge_work_takeoff_lines'::regclass and contype = 'u'
    `);
    expect(uniqueKeys.map((c) => c.conname)).toContain("forge_work_takeoff_lines_owner_package_id_key");
    const fks = await query(`
      select conname from pg_constraint
      where conrelid = 'forge_work_takeoff_lines'::regclass and contype = 'f'
    `);
    expect(fks.map((c) => c.conname)).toContain("forge_work_takeoff_lines_owner_package_drawing_fk");
  });

  it("the naive fixture proves the hostile defaults widen a selective GRANT", async () => {
    // This assertion failing means the fixture is broken, not that the
    // migration is good: without widening here, the REVOKE assertions
    // below would pass vacuously.
    expect(await tablePrivilege("authenticated", "naive_widen", "DELETE")).toBe(true);
    expect(await tablePrivilege("anon", "naive_widen", "SELECT")).toBe(true);
  });

  it("effective ACL: entries keep select/insert/update only; revisions select only; anon nothing", async () => {
    expect(await tablePrivilege("authenticated", "forge_work_progress_entries", "SELECT")).toBe(true);
    expect(await tablePrivilege("authenticated", "forge_work_progress_entries", "INSERT")).toBe(true);
    expect(await tablePrivilege("authenticated", "forge_work_progress_entries", "UPDATE")).toBe(true);
    expect(await tablePrivilege("authenticated", "forge_work_progress_entries", "DELETE")).toBe(false);
    expect(await tablePrivilege("authenticated", "forge_work_progress_entries", "TRUNCATE")).toBe(false);
    expect(await tablePrivilege("authenticated", "forge_work_progress_revisions", "SELECT")).toBe(true);
    expect(await tablePrivilege("authenticated", "forge_work_progress_revisions", "INSERT")).toBe(false);
    expect(await tablePrivilege("authenticated", "forge_work_progress_revisions", "UPDATE")).toBe(false);
    expect(await tablePrivilege("authenticated", "forge_work_progress_revisions", "DELETE")).toBe(false);
    expect(await tablePrivilege("authenticated", "forge_work_progress_revisions", "TRUNCATE")).toBe(false);
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(await tablePrivilege("anon", "forge_work_progress_entries", privilege)).toBe(false);
      expect(await tablePrivilege("anon", "forge_work_progress_revisions", privilege)).toBe(false);
    }
  });

  it("RPCs are executable by authenticated only, not by PUBLIC", async () => {
    const rows = await query(`
      select proname, proacl from pg_proc
      where proname in ('forge_work_progress_create', 'forge_work_progress_correct', 'forge_work_progress_void')
      order by proname
    `);
    expect(rows.map((r) => r.proname)).toEqual([
      "forge_work_progress_correct",
      "forge_work_progress_create",
      "forge_work_progress_void",
    ]);
    for (const row of rows) {
      // PGlite returns proacl as an array; real Postgres returns the
      // same ACL as a string. Either way, the assertions that matter:
      // authenticated can execute, and no PUBLIC (bare "=X") entry
      // remains after the migration's REVOKE FROM PUBLIC.
      const acl = Array.isArray(row.proacl) ? row.proacl : [String(row.proacl)];
      expect(acl).toContain("authenticated=X/postgres");
      expect(acl.some((entry) => entry === "=X/postgres" || entry.startsWith("public="))).toBe(false);
    }
  });

  it("RLS: a different owner cannot see or write another owner's progress", async () => {
    await asActor("owner_2", "owner_2");
    const rows = await query(`select id from forge_work_progress_entries where owner_id = 'owner_1'`);
    expect(rows).toEqual([]);
    await expectRejected(
      exec(`
        select * from forge_work_progress_create('owner_1', 'pkg_1', 'line_1', '2026-11-01', 5, null)
      `),
      /WPP2_WORKSPACE_FORBIDDEN/,
    );
    await asActor("owner_1", "owner_1");
  });

  it("RPC create writes the entry and its create revision in one transaction", async () => {
    const created = await query(`
      select * from forge_work_progress_create('owner_1', 'pkg_1', 'line_1', '2026-11-01', 10, 'first day')
    `);
    expect(created).toHaveLength(1);
    const entry = created[0];
    expect(entry.id).toMatch(/^forge_wprg_/);
    expect(entry.version).toBe(1);
    expect(entry.voided_at).toBeNull();
    expect(Number(entry.installed_quantity)).toBe(10);
    // The actor is the authenticated caller (test.actor), not a parameter.
    expect(entry.created_by).toBe("owner_1");
    expect(entry.updated_by).toBe("owner_1");

    const revisions = await query(`
      select action, version, actor_id, old_quantity, new_quantity, old_work_date, new_work_date, reason
      from forge_work_progress_revisions where entry_id = '${entry.id}' order by version
    `);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      action: "create",
      version: 1,
      actor_id: "owner_1",
      old_quantity: null,
      reason: null,
    });
    expect(Number(revisions[0].new_quantity)).toBe(10);
    expect(isoDate(revisions[0].new_work_date)).toBe("2026-11-01");

    // Stash the entry id for the later RPC tests via a temp marker row
    // in the naive table (test-local bookkeeping, not product data).
    await exec(`insert into naive_widen (id) values ('${entry.id}')`);
  });

  it("RPC create rejects cross-package lines, future dates, and bad quantities", async () => {
    // line_3 lives in pkg_2; addressing it through pkg_1 must fail.
    await expectRejected(
      exec(`select * from forge_work_progress_create('owner_1', 'pkg_1', 'line_3', '2026-11-01', 5, null)`),
      /WPP2_LINE_NOT_IN_PACKAGE/,
    );
    await expectRejected(
      exec(`select * from forge_work_progress_create('owner_1', 'pkg_1', 'line_1', '2999-01-01', 5, null)`),
      /WPP2_FUTURE_DATE/,
    );
    await expectRejected(
      exec(`select * from forge_work_progress_create('owner_1', 'pkg_1', 'line_1', '2026-11-01', -5, null)`),
      /WPP2_INVALID_QUANTITY/,
    );
    await expectRejected(
      exec(`select * from forge_work_progress_create('owner_1', 'pkg_1', 'line_1', '2026-11-01', 1.23456, null)`),
      /WPP2_INVALID_QUANTITY/,
    );
  });

  it("RPC correct bumps the version with an update revision; stale versions conflict without side effects", async () => {
    const marker = await query(`select id from naive_widen where id like 'forge_wprg_%'`);
    const entryId = marker[0].id;

    const corrected = await query(`
      select * from forge_work_progress_correct('owner_1', '${entryId}', 1, 15, '2026-11-02', 'recount', 'field recount')
    `);
    expect(corrected[0].version).toBe(2);
    expect(Number(corrected[0].installed_quantity)).toBe(15);

    // Stale version: the entry must be untouched and no revision added.
    await expectRejected(
      exec(`select * from forge_work_progress_correct('owner_1', '${entryId}', 1, 99, null, null, 'stale')`),
      /WPP2_VERSION_CONFLICT/,
    );
    const after = await query(`select version, installed_quantity from forge_work_progress_entries where id = '${entryId}'`);
    expect(after[0].version).toBe(2);
    expect(Number(after[0].installed_quantity)).toBe(15);
    const revisions = await query(`
      select action, version, old_quantity, new_quantity, old_work_date, new_work_date, reason
      from forge_work_progress_revisions where entry_id = '${entryId}' order by version
    `);
    expect(revisions).toHaveLength(2);
    expect(revisions[1]).toMatchObject({ action: "update", version: 2, reason: "field recount" });
    expect(Number(revisions[1].old_quantity)).toBe(10);
    expect(Number(revisions[1].new_quantity)).toBe(15);
    expect(isoDate(revisions[1].old_work_date)).toBe("2026-11-01");
    expect(isoDate(revisions[1].new_work_date)).toBe("2026-11-02");
  });

  it("RPC void excludes the entry and blocks further correction; void is terminal", async () => {
    const marker = await query(`select id from naive_widen where id like 'forge_wprg_%'`);
    const entryId = marker[0].id;

    const voided = await query(`
      select * from forge_work_progress_void('owner_1', '${entryId}', 2, 'duplicate day')
    `);
    expect(voided[0].version).toBe(3);
    expect(voided[0].voided_at).not.toBeNull();

    await expectRejected(
      exec(`select * from forge_work_progress_correct('owner_1', '${entryId}', 3, 20, null, null, 'too late')`),
      /WPP2_VOIDED/,
    );
    await expectRejected(
      exec(`select * from forge_work_progress_void('owner_1', '${entryId}', 3, 'again')`),
      /WPP2_VOIDED/,
    );
    const revisions = await query(`
      select action, version, reason from forge_work_progress_revisions
      where entry_id = '${entryId}' order by version
    `);
    expect(revisions).toHaveLength(3);
    expect(revisions[2]).toMatchObject({ action: "void", version: 3, reason: "duplicate day" });
  });

  it("direct revision tampering and entry deletion are rejected for the application role", async () => {
    const marker = await query(`select id from naive_widen where id like 'forge_wprg_%'`);
    const entryId = marker[0].id;
    await expectRejected(
      exec(`insert into forge_work_progress_revisions (owner_id, id, entry_id, version, actor_id, action)
            values ('owner_1', 'forge_wprv_forged', '${entryId}', 99, 'user_1', 'update')`),
      /permission denied|policy/i,
    );
    await expectRejected(
      exec(`update forge_work_progress_revisions set reason = 'forged' where entry_id = '${entryId}'`),
      /permission denied|policy/i,
    );
    await expectRejected(
      exec(`delete from forge_work_progress_entries where id = '${entryId}'`),
      /permission denied|policy/i,
    );
  });

  it("revision (owner, entry, version) is unique, and progress blocks line deletion", async () => {
    const marker = await query(`select id from naive_widen where id like 'forge_wprg_%'`);
    const entryId = marker[0].id;
    await asOwner();
    await expectRejected(
      exec(`insert into forge_work_progress_revisions (owner_id, id, entry_id, version, actor_id, action)
            values ('owner_1', 'forge_wprv_dup', '${entryId}', 1, 'user_1', 'create')`),
      /duplicate key|unique/i,
    );
    await asAuthenticated();
    // line_1 still has progress history (even voided) — RESTRICT blocks
    // the delete instead of silently orphaning the ledger.
    await expectRejected(
      exec(`delete from forge_work_takeoff_lines where id = 'line_1'`),
      /foreign key|restrict|violates/i,
    );
  });

  it("progress operations never mutate the controlled drawing", async () => {
    const before = await query(`
      select drawing_number, title, updated_at from forge_work_drawings where id = 'dwg_pid1'
    `);
    await exec(`select * from forge_work_progress_create('owner_1', 'pkg_1', 'line_2', '2026-11-03', 4, null)`);
    const after = await query(`
      select drawing_number, title, updated_at from forge_work_drawings where id = 'dwg_pid1'
    `);
    expect(after).toEqual(before);
  });

  it("RPCs derive the actor from auth.uid(): no caller-supplied actor exists to forge", async () => {
    // The three RPC signatures carry no p_actor parameter at all, so a
    // direct caller cannot record another actor's audit history — the
    // recorded actor is always the authenticated caller.
    for (const [name, expected] of [
      ["forge_work_progress_create", ["p_owner_id", "p_package_id", "p_line_id", "p_work_date", "p_quantity", "p_note"]],
      ["forge_work_progress_correct", ["p_owner_id", "p_entry_id", "p_expected_version", "p_quantity", "p_work_date", "p_note", "p_reason"]],
      ["forge_work_progress_void", ["p_owner_id", "p_entry_id", "p_expected_version", "p_reason"]],
    ]) {
      const rows = await query(`
        select parameter_name from information_schema.parameters
        where specific_schema = 'public' and specific_name = (
          select specific_name from information_schema.routines
          where routine_schema = 'public' and routine_name = '${name}'
        ) order by ordinal_position
      `);
      expect(rows.map((r) => r.parameter_name)).toEqual(expected);
    }

    await asActor("user_1", "owner_1");
    const created = await query(`
      select * from forge_work_progress_create('owner_1', 'pkg_1', 'line_2', '2026-11-03', 6, 'actor proof')
    `);
    expect(created).toHaveLength(1);
    expect(created[0].created_by).toBe("user_1");
    expect(created[0].updated_by).toBe("user_1");
    const entryId = created[0].id;
    const createRev = await query(`
      select actor_id from forge_work_progress_revisions where entry_id = '${entryId}' and action = 'create'
    `);
    expect(createRev).toHaveLength(1);
    expect(createRev[0].actor_id).toBe("user_1");

    const corrected = await query(`
      select * from forge_work_progress_correct('owner_1', '${entryId}', 1, 7, null, null, 'recount')
    `);
    expect(corrected[0].updated_by).toBe("user_1");
    const updateRev = await query(`
      select actor_id from forge_work_progress_revisions where entry_id = '${entryId}' and action = 'update'
    `);
    expect(updateRev).toHaveLength(1);
    expect(updateRev[0].actor_id).toBe("user_1");

    const voided = await query(`
      select * from forge_work_progress_void('owner_1', '${entryId}', 2, 'actor proof void')
    `);
    expect(voided[0].updated_by).toBe("user_1");
    const voidRev = await query(`
      select actor_id from forge_work_progress_revisions where entry_id = '${entryId}' and action = 'void'
    `);
    expect(voidRev).toHaveLength(1);
    expect(voidRev[0].actor_id).toBe("user_1");
    await asActor("owner_1", "owner_1");
  });

  it("RPCs reject a missing auth identity instead of recording a blank actor", async () => {
    await asActor("", "owner_1");
    await expectRejected(
      exec(`select * from forge_work_progress_create('owner_1', 'pkg_1', 'line_1', '2026-11-01', 5, null)`),
      /WPP2_INVALID_ACTOR/,
    );
    await asActor("owner_1", "owner_1");
  });
});
