// Lock down owner_cash_movement_edits — enable RLS + owner-only policies.
// Migration contract, executed against an in-process real Postgres
// (PGlite), mirroring the Scheduling Admin Permissions slice-1 test's
// convention (hostile-default fixture proving the REVOKE is load-bearing,
// has_table_privilege receipts, pg_class RLS flags, reapply idempotency).
//
// The migration is prepared for review only; applying it to production is
// Jason's separate approval. No linked or remote database is touched.

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const BASE_TABLE_PATH = new URL("../20261101020000_rental_owner_movement_edit.sql", import.meta.url);
const RLS_PATH = new URL("../20261118000000_rls_owner_cash_movement_edits.sql", import.meta.url);
const baseTableSql = readFileSync(BASE_TABLE_PATH, "utf8");
const rlsSql = readFileSync(RLS_PATH, "utf8");

// The base migration's own update_owner_movement() references
// owner_cash_movements and financial_events, neither of which this test
// calls — it tests the RLS/ACL lockdown directly against
// owner_cash_movement_edits, not that RPC's business logic (out of scope
// for a pure lockdown migration). Both tables are stubbed minimally so
// the base migration's CREATE FUNCTION body parses and installs cleanly.
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

  -- Matches the real workspace_members shape (20260829000000) and the
  -- real has_workspace_access predicate (20260829000100) exactly.
  create table workspace_members (
    owner_id text not null,
    member_user_id uuid not null,
    status text not null,
    role text not null,
    primary key (owner_id, member_user_id)
  );
  grant select on workspace_members to authenticated;

  -- Matches the REAL has_workspace_access(text) exactly (20260829000100):
  -- p_owner_id = auth.uid()::text (self-match), or an active co_owner
  -- membership row. NOT a comparison against the raw test.actor label.
  create function has_workspace_access(p_owner_id text)
  returns boolean language sql stable security definer set search_path = public as $$
    select p_owner_id = auth.uid()::text
        or exists (
          select 1 from workspace_members
          where owner_id = p_owner_id and member_user_id = auth.uid()
            and status = 'active' and role = 'co_owner'
        )
  $$;
  revoke all on function has_workspace_access(text) from public;
  grant execute on function has_workspace_access(text) to authenticated;

  -- Minimal stubs so update_owner_movement()'s body installs cleanly;
  -- this test never calls that RPC.
  create table owner_cash_movements (
    id text primary key, owner_id text not null, kind text not null,
    amount numeric not null, movement_date date not null, method text not null,
    memo text not null default '', status text not null default 'active'
  );
  create table financial_events (
    owner_id text not null, transaction_kind text not null, amount numeric not null,
    is_deleted boolean not null default false, status text
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

async function asActor(actor) {
  await db.exec(`select set_config('test.actor', '${actor}', false)`);
}

async function asAuthenticated() {
  await db.exec("set role authenticated");
}

async function asAnon() {
  await db.exec("set role anon");
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
    if (pattern) expect(String(error.message || error)).toMatch(pattern);
  }
  expect(threw).toBe(true);
}

async function tablePrivilege(role, table, privilege) {
  const rows = await query(`select has_table_privilege('${role}', '${table}', '${privilege}') as has_priv`);
  return rows[0].has_priv;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP_SQL);

  // Hostile defaults BEFORE the table exists — Supabase's real project
  // defaults grant ALL on new tables to authenticated (and often anon);
  // a migration that only does a selective GRANT without an explicit
  // REVOKE first would silently stay wide open. This fixture proves the
  // REVOKE in the migration under test is load-bearing, not decorative.
  await db.exec(`
    do $$ begin
      execute format(
        'alter default privileges for role %I in schema public grant all on tables to authenticated, anon, service_role',
        current_user
      );
    end $$;
  `);

  await db.exec(baseTableSql);

  // Fixture sanity: confirm the hostile default actually took effect on
  // the base table BEFORE the lockdown migration runs, so the "after"
  // assertions below prove the migration did the work, not that the
  // table never had the exposure to begin with.
  const before = await query(
    `select has_table_privilege('anon', 'owner_cash_movement_edits', 'SELECT') as anon_select,
            has_table_privilege('anon', 'owner_cash_movement_edits', 'INSERT') as anon_insert,
            has_table_privilege('authenticated', 'owner_cash_movement_edits', 'UPDATE') as auth_update`,
  );
  if (!before[0].anon_select || !before[0].anon_insert || !before[0].auth_update) {
    throw new Error("fixture sanity failed: the hostile-default fixture did not actually widen owner_cash_movement_edits before the lockdown migration ran");
  }

  await db.exec(rlsSql);

  await exec(`insert into workspace_members (owner_id, member_user_id, status, role) values (test_actor_uuid('owner_1')::text, test_actor_uuid('coowner_1'), 'active', 'co_owner')`);
});

describe("ACL — explicit REVOKE is load-bearing", () => {
  it("anon has no privilege at all on owner_cash_movement_edits", async () => {
    for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(await tablePrivilege("anon", "owner_cash_movement_edits", priv)).toBe(false);
    }
  });

  it("service_role has no privilege at all on owner_cash_movement_edits", async () => {
    for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(await tablePrivilege("service_role", "owner_cash_movement_edits", priv)).toBe(false);
    }
  });

  it("authenticated has exactly SELECT and INSERT — no UPDATE, no DELETE (append-only)", async () => {
    expect(await tablePrivilege("authenticated", "owner_cash_movement_edits", "SELECT")).toBe(true);
    expect(await tablePrivilege("authenticated", "owner_cash_movement_edits", "INSERT")).toBe(true);
    expect(await tablePrivilege("authenticated", "owner_cash_movement_edits", "UPDATE")).toBe(false);
    expect(await tablePrivilege("authenticated", "owner_cash_movement_edits", "DELETE")).toBe(false);
  });
});

describe("RLS — enabled and forced", () => {
  it("relrowsecurity and relforcerowsecurity are both true", async () => {
    const rows = await query(`
      select relrowsecurity, relforcerowsecurity from pg_class where relname = 'owner_cash_movement_edits'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].relrowsecurity).toBe(true);
    expect(rows[0].relforcerowsecurity).toBe(true);
  });
});

describe("owner-only policies — real behavior, not just the flag", () => {
  it("anon's grant-less ACL means a read attempt is rejected outright (permission denied), before RLS is even reached", async () => {
    await asAnon();
    await expectRejected(query(`select * from owner_cash_movement_edits`), /permission denied/i);
  });

  it("an unrelated authenticated stranger sees zero rows, not an error", async () => {
    await asAuthenticated();
    await asActor("stranger_1");
    const rows = await query(`select * from owner_cash_movement_edits where owner_id = test_actor_uuid('owner_1')::text`);
    expect(rows).toHaveLength(0);
  });

  it("the real owner can insert an edit-audit row directly (owner path works)", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    await exec(`
      insert into owner_cash_movement_edits (owner_id, movement_id, old_amount, new_amount, old_movement_date, new_movement_date, old_method, new_method)
      values (test_actor_uuid('owner_1')::text, 'mv_1', 100, 150, '2026-01-01', '2026-01-02', 'check', 'ach')
    `);
    const rows = await query(`select * from owner_cash_movement_edits where owner_id = test_actor_uuid('owner_1')::text`);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].new_amount)).toBe(150);
  });

  it("an active co-owner can also insert and read, same as the owner", async () => {
    await asAuthenticated();
    await asActor("coowner_1");
    await exec(`
      insert into owner_cash_movement_edits (owner_id, movement_id, old_amount, new_amount, old_movement_date, new_movement_date, old_method, new_method)
      values (test_actor_uuid('owner_1')::text, 'mv_2', 200, 250, '2026-02-01', '2026-02-02', 'wire', 'cash')
    `);
    const rows = await query(`select * from owner_cash_movement_edits where owner_id = test_actor_uuid('owner_1')::text order by edited_at`);
    expect(rows).toHaveLength(2);
  });

  it("an unrelated authenticated stranger cannot insert a row for someone else's owner_id", async () => {
    await asAuthenticated();
    await asActor("stranger_1");
    await expectRejected(exec(`
      insert into owner_cash_movement_edits (owner_id, movement_id, old_amount, new_amount, old_movement_date, new_movement_date, old_method, new_method)
      values (test_actor_uuid('owner_1')::text, 'mv_3', 10, 20, '2026-03-01', '2026-03-02', 'check', 'check')
    `));
    // Verify as the owner (not the stranger) — the stranger's own SELECT
    // policy would return zero rows regardless of whether the insert
    // above was actually rejected, which would make this assertion pass
    // for the wrong reason.
    await asOwner();
    const rows = await query(`select * from owner_cash_movement_edits where owner_id = test_actor_uuid('owner_1')::text`);
    expect(rows).toHaveLength(2); // unchanged from the previous test.
  });

  it("a suspended former co-owner loses access immediately", async () => {
    await asOwner();
    await exec(`insert into workspace_members (owner_id, member_user_id, status, role) values (test_actor_uuid('owner_1')::text, test_actor_uuid('exco_1'), 'suspended', 'co_owner')`);
    await asAuthenticated();
    await asActor("exco_1");
    const rows = await query(`select * from owner_cash_movement_edits where owner_id = test_actor_uuid('owner_1')::text`);
    expect(rows).toHaveLength(0);
  });

  it("the owner cannot update or delete an existing edit-audit row (append-only, no policy exists for either)", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    await expectRejected(exec(`update owner_cash_movement_edits set new_amount = 999 where movement_id = 'mv_1'`));
    await expectRejected(exec(`delete from owner_cash_movement_edits where movement_id = 'mv_1'`));
    const rows = await query(`select new_amount from owner_cash_movement_edits where movement_id = 'mv_1'`);
    expect(Number(rows[0].new_amount)).toBe(150);
  });
});

describe("reapply", () => {
  it("re-running the lockdown migration's own idempotent statements does not error", async () => {
    await asOwner();
    await expect(exec(rlsSql)).resolves.not.toThrow();
  });
});
