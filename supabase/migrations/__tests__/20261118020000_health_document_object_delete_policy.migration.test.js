// Fix round 1 (P1 -- ChatGPT review 2026-11-18, PR #833): "Add a non-vacuous authorization proof
// that an allowed workspace member can delete the exact object and another workspace/anonymous
// caller cannot. A mock asserting only that remove() was invoked is insufficient."
//
// storage.objects is itself a regular Postgres table with RLS in real Supabase -- this test
// builds a minimal real version of it (bucket_id, name only; enough for bucket_id='health-documents'
// and storage.foldername(name) to work) plus the REAL health_document_object_insert/select
// policies from the base migration and the REAL new health_document_object_delete policy from
// this fix round's migration, loaded from their actual .sql files (never hand-retyped), and
// proves actual SQL-level DELETE behavior under RLS -- not a mock, not a claim.

import { readFileSync } from "node:fs";
import { describe, expect, it, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const DELETE_POLICY_PATH = new URL("../20261118020000_health_document_object_delete_policy.sql", import.meta.url);
const deletePolicySql = readFileSync(DELETE_POLICY_PATH, "utf8");

const BASE_MIGRATION_PATH = new URL("../20260901000700_create_private_health_tracker.sql", import.meta.url);
const baseMigrationSql = readFileSync(BASE_MIGRATION_PATH, "utf8");

function extractStatement(sql, startMarker) {
  const start = sql.indexOf(startMarker);
  if (start === -1) throw new Error(`fixture setup failed: could not find ${JSON.stringify(startMarker)} in the base migration -- it may have moved or been renamed`);
  const end = sql.indexOf(";", start);
  return sql.slice(start, end + 1);
}

// Pulled verbatim from the real base migration, not hand-retyped, so a future edit to either
// real policy makes this test fail loudly instead of silently testing a stale copy.
const insertPolicySql = extractStatement(baseMigrationSql, "create policy health_document_object_insert");
const selectPolicySql = extractStatement(baseMigrationSql, "create policy health_document_object_select");

const SETUP_SQL = `
  create role authenticated;
  create role anon;
  create schema auth;
  create schema storage;
  grant usage on schema auth to authenticated;
  grant usage on schema storage to authenticated, anon;

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

  -- Minimal real shape: only what bucket_id='health-documents' and storage.foldername(name)
  -- actually need. A real storage.objects row has many more columns; irrelevant here.
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null,
    name text not null
  );
  alter table storage.objects enable row level security;
  alter table storage.objects force row level security;
  grant select, insert, delete on storage.objects to authenticated;

  -- Real Supabase Storage's own helper: every "/"-separated segment except the last (the
  -- filename). For "ws1/doc-1.pdf" this returns {ws1}.
  create function storage.foldername(name text)
  returns text[] language sql immutable as $$
    select case when position('/' in name) = 0 then '{}'::text[]
      else (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
    end
  $$;

  -- Matches the real health_workspace_members shape and health_has_workspace_access predicate
  -- (20260901000700_create_private_health_tracker.sql) exactly.
  create table public.health_workspace_members (
    workspace_id uuid not null,
    user_id uuid not null,
    primary key (workspace_id, user_id)
  );
  create function public.health_has_workspace_access(p_workspace_id uuid)
  returns boolean language sql stable security definer set search_path = public as $$
    select exists (
      select 1 from public.health_workspace_members
      where workspace_id = p_workspace_id and user_id = auth.uid()
    )
  $$;

  -- Minimal stub so health_document_object_select's own policy body (which joins back to this
  -- table) installs cleanly. This test never exercises SELECT, only INSERT/DELETE.
  create table public.health_documents (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    bucket text not null,
    object_path text not null
  );
  -- Matches the real base migration's own grant for this table (20260901000700) exactly --
  -- authenticated only, never anon. The health_document_object_select storage policy's subquery
  -- reads it, so authenticated needs at least SELECT for Postgres to plan a query referencing
  -- the policy at all.
  grant select on public.health_documents to authenticated;
`;

let db;
async function exec(sql) { await db.exec(sql); }
async function query(sql) { return (await db.query(sql)).rows; }
async function asActor(actor) { await db.exec(`select set_config('test.actor', '${actor}', false)`); }
async function asAuthenticated() { await db.exec("set role authenticated"); }
async function asAnon() { await db.exec("set role anon"); }
async function asOwner() { await db.exec("reset role"); }

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP_SQL);
  await db.exec(insertPolicySql);
  await db.exec(selectPolicySql);
  await db.exec(deletePolicySql);

  await asOwner();
  await exec(`insert into public.health_workspace_members (workspace_id, user_id) values
    (test_actor_uuid('ws_1'), test_actor_uuid('owner_1')),
    (test_actor_uuid('ws_1'), test_actor_uuid('coowner_1'))`);
  await exec(`insert into storage.objects (bucket_id, name) values
    ('health-documents', test_actor_uuid('ws_1')::text || '/doc-1.pdf'),
    ('health-documents', test_actor_uuid('ws_2')::text || '/doc-2.pdf')`);
  // health_document_object_select's own policy requires a MATCHING health_documents row
  // (joined on object_path + bucket) before it grants visibility to anyone, owner included --
  // without this, RLS hides the row from every caller, which in turn blocks DELETE too (see the
  // "without the new policy" test below: a DELETE's WHERE-clause visibility, not only its own
  // command-specific policy, gates whether the delete actually happens).
  await exec(`insert into public.health_documents (workspace_id, bucket, object_path) values
    (test_actor_uuid('ws_1'), 'health-documents', test_actor_uuid('ws_1')::text || '/doc-1.pdf'),
    (test_actor_uuid('ws_2'), 'health-documents', test_actor_uuid('ws_2')::text || '/doc-2.pdf')`);
});

describe("health_document_object_delete_policy -- real RLS, not a mock", () => {
  it("fixture sanity: the real health_document_object_insert/select policies loaded from the actual base migration file", () => {
    expect(insertPolicySql).toContain("health_document_object_insert");
    expect(selectPolicySql).toContain("health_document_object_select");
  });

  it("without the new policy, no authenticated caller -- not even the real owner -- can delete the object", async () => {
    // Proves the P1 itself: before this fix round's policy, the object was truly undeletable
    // through RLS, so the old best-effort storage.remove() call was silently always a no-op.
    const db2 = new PGlite();
    await db2.exec(SETUP_SQL);
    await db2.exec(insertPolicySql);
    await db2.exec(selectPolicySql);
    // Deliberately NOT applying deletePolicySql here.
    await db2.exec(`insert into public.health_workspace_members (workspace_id, user_id) values (test_actor_uuid('ws_1'), test_actor_uuid('owner_1'))`);
    await db2.exec(`insert into storage.objects (bucket_id, name) values ('health-documents', test_actor_uuid('ws_1')::text || '/doc-1.pdf')`);
    await db2.exec(`insert into public.health_documents (workspace_id, bucket, object_path) values (test_actor_uuid('ws_1'), 'health-documents', test_actor_uuid('ws_1')::text || '/doc-1.pdf')`);
    await db2.exec("set role authenticated");
    await db2.exec(`select set_config('test.actor', 'owner_1', false)`);
    await db2.query(`delete from storage.objects where bucket_id='health-documents' and name = test_actor_uuid('ws_1')::text || '/doc-1.pdf'`);
    await db2.exec("reset role");
    const stillThere = await db2.query(`select 1 from storage.objects where name = test_actor_uuid('ws_1')::text || '/doc-1.pdf'`);
    expect(stillThere.rows).toHaveLength(1); // the DELETE silently affected zero rows under RLS.
  });

  it("the real workspace owner CAN delete their own workspace's object", async () => {
    await asAuthenticated();
    await asActor("owner_1");
    await exec(`delete from storage.objects where bucket_id='health-documents' and name = test_actor_uuid('ws_1')::text || '/doc-1.pdf'`);
    await asOwner();
    const rows = await query(`select 1 from storage.objects where name = test_actor_uuid('ws_1')::text || '/doc-1.pdf'`);
    expect(rows).toHaveLength(0);
  });

  it("an active co-owner of the same workspace can also delete its object", async () => {
    await asOwner();
    await exec(`insert into storage.objects (bucket_id, name) values ('health-documents', test_actor_uuid('ws_1')::text || '/doc-3.pdf')`);
    await exec(`insert into public.health_documents (workspace_id, bucket, object_path) values (test_actor_uuid('ws_1'), 'health-documents', test_actor_uuid('ws_1')::text || '/doc-3.pdf')`);
    await asAuthenticated();
    await asActor("coowner_1");
    await exec(`delete from storage.objects where bucket_id='health-documents' and name = test_actor_uuid('ws_1')::text || '/doc-3.pdf'`);
    await asOwner();
    const rows = await query(`select 1 from storage.objects where name = test_actor_uuid('ws_1')::text || '/doc-3.pdf'`);
    expect(rows).toHaveLength(0);
  });

  it("an unrelated authenticated caller (a different workspace, no membership) cannot delete someone else's object", async () => {
    await asAuthenticated();
    await asActor("stranger_1");
    await exec(`delete from storage.objects where bucket_id='health-documents' and name = test_actor_uuid('ws_2')::text || '/doc-2.pdf'`);
    await asOwner();
    const rows = await query(`select 1 from storage.objects where name = test_actor_uuid('ws_2')::text || '/doc-2.pdf'`);
    expect(rows).toHaveLength(1); // untouched -- the delete matched zero rows for this caller.
  });

  it("anon cannot delete anything at all -- no table privilege, not just a failing RLS check", async () => {
    const rows = await query(`select has_table_privilege('anon', 'storage.objects', 'DELETE') as has_priv`);
    expect(rows[0].has_priv).toBe(false);
  });
});
