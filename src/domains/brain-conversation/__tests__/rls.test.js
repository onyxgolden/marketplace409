// Brain conversation harness — RLS isolation proof (A1, database layer).
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc grants)
// in an in-memory PGlite database and proves:
//   - owner A sees only owner A rows, owner B only owner B rows;
//   - a cross-owner insert is denied by policy;
//   - an active co-owner membership grants access to the workspace.
// Roles, the auth.uid() stub, workspace_members, and the
// has_workspace_access() copy mirror production (see
// 20260829000100_add_workspace_authorization_helpers.sql); only the
// harness tables themselves come from the shipped migration file.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const HERE = dirname(fileURLToPath(import.meta.url));
const it60 = (name, fn) => it(name, fn, 60000);

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const MEMBER_C = "33333333-3333-4333-8333-333333333333";

function loadMigrationSql() {
  return readFileSync(
    join(HERE, "..", "..", "..", "..", "supabase", "migrations", "20261102000000_brain_conversation_harness.sql"),
    "utf8",
  );
}

async function setupDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
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
  `);
  await db.exec(loadMigrationSql());
  // Seed as superuser (bypasses RLS for seeding).
  await db.exec(`
    insert into brain_semantic_entries (owner_id, content, salience)
      values ('${OWNER_A}', 'Owner A note', 'owner_stated');
    insert into brain_semantic_entries (owner_id, content, salience)
      values ('${OWNER_B}', 'Owner B note', 'owner_stated');
    insert into workspace_members (owner_id, member_user_id, status, role)
      values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
  `);
  return db;
}

async function asUser(db, uid, sql) {
  await db.exec(`set role authenticated; set app.test_uid = '${uid}';`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec(`reset role;`);
  }
}

describe("brain harness RLS (A1)", () => {
  let db;
  beforeEach(async () => {
    db = await setupDb();
  }, 60000);
  afterEach(async () => {
    await db?.close();
  }, 60000);

  it60("owner A selects only owner A rows", async () => {
    const { rows } = await asUser(db, OWNER_A, `select content from brain_semantic_entries;`);
    expect(rows.map((r) => r.content)).toEqual(["Owner A note"]);
  });

  it60("owner B selects only owner B rows", async () => {
    const { rows } = await asUser(db, OWNER_B, `select content from brain_semantic_entries;`);
    expect(rows.map((r) => r.content)).toEqual(["Owner B note"]);
  });

  it60("a cross-owner insert is denied by policy", async () => {
    await expect(
      asUser(
        db,
        OWNER_A,
        `insert into brain_semantic_entries (owner_id, content) values ('${OWNER_B}', 'forged');`,
      ),
    ).rejects.toThrow(/permission denied|violates row-level security/i);
    const { rows } = await db.query(`select count(*) as n from brain_semantic_entries;`);
    expect(Number(rows[0].n)).toBe(2);
  });

  it60("an active co-owner membership grants access to the workspace", async () => {
    const { rows } = await asUser(db, MEMBER_C, `select content from brain_semantic_entries;`);
    expect(rows.map((r) => r.content)).toEqual(["Owner A note"]);
  });

  it60("an owner can insert into their own workspace", async () => {
    await asUser(
      db,
      OWNER_A,
      `insert into brain_semantic_entries (owner_id, content) values ('${OWNER_A}', 'A second note');`,
    );
    const { rows } = await asUser(db, OWNER_A, `select content from brain_semantic_entries order by content;`);
    expect(rows.map((r) => r.content)).toEqual(["A second note", "Owner A note"]);
  });
});
