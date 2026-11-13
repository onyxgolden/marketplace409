// Work Package Planner slice-7 PDF blockers — migration/integration proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) on top of
// slices 3/4/5/7, and proves:
//   - Schema: forge_wp_drawing_artifacts (composite FKs, unique
//     (bucket, object_path), partial-unique request id, purpose CHECK),
//     line_number + intake_source on forge_work_drawings, the relaxed
//     parentage CHECK (parentless only via controlled intake), and the
//     controlled-drawings bucket row (private, PDF-only, 25 MB) with
//     its three owner-scoped storage policies (incl. orphan-cleanup);
//   - RLS+FORCE on the artifacts table, the effective ACL matrix for
//     authenticated/anon/service_role (and the default-privilege
//     negative case), and the relacl/proacl contents after the
//     selective grants;
//   - RPCs: the intake resolve-or-create (parentless isometric in a
//     package with no P&ID, line fill-only-if-null, P&ID link
//     fill-only-if-null, type/line/PID mismatch guards), idempotency
//     replay + conflict, owner/co-owner pass and stranger/anon deny,
//     terminal/missing package guards, audit atomicity (a failed
//     intake leaves no artifact and no drawing);
//   - IFC staging (same-digest-as-IFA rejected, no revision created,
//     replay) and the staged-artifact IFC release (staged bytes
//     authoritative, artifact flips to ifc_issued, snapshot badge
//     IFC), the typed-path same-digest guard, and retire retiring the
//     drawing's artifacts;
//   - Reapply: the migration applies cleanly a second time.
// A real-PostgreSQL subset runs the full lifecycle and the concurrent
// duplicate-intake race (one artifact row, both callers the same
// receipt) against a scratch PG16 cluster when the binaries exist,
// and SKIPS LOUDLY — never silently — when they do not. PGlite is
// single-connection, so it cannot prove concurrent serialization.

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { Client } from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const it60 = (name, fn) => it(name, fn, 60000);

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const MEMBER_C = "33333333-3333-4333-8333-333333333333";
const STRANGER = "44444444-4444-4444-8444-444444444444";

const SLICE3 = "20261107000000_forge_work_package_permit_annotations_slice3.sql";
const SLICE4 = "20261107010000_forge_work_package_craft_assignments_slice4.sql";
const SLICE5 = "20261107020000_forge_work_package_work_steps_slice5.sql";
const SLICE7 = "20261107040000_forge_work_package_ifa_ifc_slice7.sql";
const THIS = "20261113020000_forge_work_controlled_drawing_intake.sql";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

function loadMigrationSql(name) {
  return readFileSync(join(HERE, "..", "..", "..", "supabase", "migrations", name), "utf8");
}

// Identical to the slice-7 test's prereq (roles, auth.uid stub,
// workspace_members, has_workspace_access, minimal packages/drawings/
// takeoff-lines shapes with the exact keys the slice-3/4/5 foreign
// keys reference), plus the minimal storage schema the bucket +
// policies need (production Supabase ships storage.buckets,
// storage.objects and storage.foldername; the test mirrors only the
// columns the migration touches, with RLS enabled on objects as in
// production so the policies are enforced, not decorative).
const PREREQ_SQL = `
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
      );
  $$;
  revoke all on function public.has_workspace_access(text) from public;
  grant execute on function public.has_workspace_access(text) to authenticated;
  create table forge_work_packages (
    owner_id text not null,
    id text not null,
    status text not null default 'in_progress',
    primary key (owner_id, id)
  );
  create table forge_work_drawings (
    owner_id text not null,
    package_id text not null,
    id text not null,
    drawing_number text,
    drawing_type text,
    title text,
    p_id_drawing_id text,
    -- The production shape from slice 1 (takeoff): the intake RPC
    -- writes created_by on resolve-or-create and updated_at on the
    -- line/P&ID fill, and slice 7 adds retired_at/retired_by itself.
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, package_id, id)
  );
  create table forge_work_takeoff_lines (
    owner_id text not null,
    id text not null,
    drawing_id text not null,
    line_no integer,
    primary key (owner_id, id)
  );
  grant select on forge_work_packages to authenticated;
  grant select on forge_work_drawings to authenticated;
  grant select on forge_work_takeoff_lines to authenticated;
  create schema storage;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null,
    name text not null,
    owner uuid,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    metadata jsonb
  );
  alter table storage.objects enable row level security;
  -- Production Supabase grants authenticated USAGE on the storage
  -- schema and table privileges on storage.objects; the RLS policies
  -- (not the grants) are what scope access by path owner.
  grant usage on schema storage to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
  grant select on storage.buckets to authenticated;
  create or replace function storage.foldername(name text)
  returns text[] language sql immutable as $$
    select string_to_array(name, '/')
  $$;
`;

const SEED_SQL = `
  insert into forge_work_packages (owner_id, id, status) values
    ('${OWNER_A}', 'pkg_a', 'in_progress'),
    ('${OWNER_A}', 'pkg_cancelled', 'cancelled'),
    ('${OWNER_A}', 'pkg_closed', 'verified_closed'),
    ('${OWNER_B}', 'pkg_b', 'in_progress');
  insert into forge_work_drawings (owner_id, package_id, id, drawing_number, drawing_type, title, p_id_drawing_id) values
    ('${OWNER_A}', 'pkg_a', 'dwg_1', 'P-101', 'p_id', 'Main line', null),
    -- A cut sheet rolls up to its P&ID (slice-1 parentage rule): a
    -- parentless non-P&ID row is not a valid seed under the fixed
    -- CHECK, which is exactly the hole the NULL-unsafe form left.
    ('${OWNER_A}', 'pkg_a', 'dwg_2', 'C-201', 'cut_sheet', 'Spool sheet', 'dwg_1'),
    ('${OWNER_A}', 'pkg_a', 'dwg_3', 'P-102', 'p_id', 'Second line', null),
    ('${OWNER_A}', 'pkg_cancelled', 'dwg_c1', 'P-901', 'p_id', 'Cancelled line', null);
  insert into workspace_members (owner_id, member_user_id, status, role)
    values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
`;

async function setupDb() {
  const db = new PGlite();
  await db.exec(PREREQ_SQL);
  await db.exec(loadMigrationSql(SLICE3));
  await db.exec(loadMigrationSql(SLICE4));
  await db.exec(loadMigrationSql(SLICE5));
  await db.exec(loadMigrationSql(SLICE7));
  await db.exec(loadMigrationSql(THIS));
  await db.exec(SEED_SQL);
  return db;
}

async function asRole(db, role, uid, sql) {
  await db.exec(`set role ${role}; set app.test_uid = '${uid}';`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec(`reset role;`);
  }
}

async function asUser(db, uid, sql) {
  return asRole(db, "authenticated", uid, sql);
}

function sqlStr(value) {
  return value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNum(value) {
  return value === null || value === undefined ? "null" : String(value);
}

function objectPath(ownerId, packageId, requestId, sha) {
  return `${ownerId}/${packageId}/${requestId}/${sha}.pdf`;
}

async function intakeDrawing(db, uid, {
  ownerId, packageId, number, type, code, sha, length, requestId,
  line, issuedAt, issuerRef, title, pidId, filename,
}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_wp_drawing_controlled_intake(
      '${ownerId ?? OWNER_A}', '${packageId}', '${number}', '${type}', '${code}',
      '${objectPath(ownerId ?? OWNER_A, packageId, requestId, sha)}', '${sha}',
      ${sqlNum(length ?? 1024)}, '${requestId}',
      ${sqlStr(line ?? null)}, ${sqlStr(issuedAt ?? null)}, ${sqlStr(issuerRef ?? null)},
      ${sqlStr(title ?? null)}, ${sqlStr(pidId ?? null)}, ${sqlStr(filename ?? null)});
  `);
  return rows[0];
}

async function stageIfc(db, uid, { ownerId, packageId, drawingId, sha, length, requestId, filename }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_wp_drawing_ifc_stage(
      '${ownerId ?? OWNER_A}', '${packageId}', '${drawingId}',
      '${objectPath(ownerId ?? OWNER_A, packageId, requestId, sha)}', '${sha}',
      ${sqlNum(length ?? 1024)}, '${requestId}', ${sqlStr(filename ?? null)});
  `);
  return rows[0];
}

async function createReview(db, uid, { ownerId, packageId, drawingId, revisionId, key }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_wp_drawing_review_create(
      '${ownerId ?? OWNER_A}', '${packageId}', '${drawingId}', '${revisionId}',
      null, ${sqlStr(key ?? null)}, null);
  `);
  return rows[0];
}

async function decideReview(db, uid, { ownerId, reviewId, expectedVersion, decision }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_wp_drawing_review_decide(
      '${ownerId ?? OWNER_A}', '${reviewId}', ${sqlNum(expectedVersion)},
      '${decision}', 'Checked.');
  `);
  return rows[0];
}

async function releaseIfc(db, uid, { ownerId, packageId, drawingId, reviewId, code, docRef, sha, stagedArtifactId }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_wp_drawing_ifc_release(
      '${ownerId ?? OWNER_A}', '${packageId}', '${drawingId}', '${reviewId}',
      '${code}', ${sqlStr(docRef ?? null)}, ${sqlStr(sha ?? null)}, null,
      ${sqlStr(stagedArtifactId ?? null)});
  `);
  return rows[0];
}

async function retireDrawingRpc(db, uid, { ownerId, packageId, drawingId, reason }) {
  const { rows } = await asUser(db, uid, `
    select * from forge_wp_drawing_retire(
      '${ownerId ?? OWNER_A}', '${packageId}', '${drawingId}', ${sqlStr(reason)});
  `);
  return rows[0];
}

async function snapshot(db, uid, { ownerId, packageId }) {
  const { rows } = await asUser(db, uid, `
    select forge_wp_drawing_readiness_snapshot('${ownerId ?? OWNER_A}', '${packageId}');
  `);
  return rows[0].forge_wp_drawing_readiness_snapshot;
}

async function countRows(db, sql) {
  const { rows } = await db.query(`select count(*)::int as n from (${sql}) s;`);
  return rows[0].n;
}

describe("slice-7 PDF blockers migration: schema, bucket and checks", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("creates the artifacts table with composite FKs, unique object path and partial-unique request id", async () => {
    const { rows: cols } = await db.query(`
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'forge_wp_drawing_artifacts'
      order by ordinal_position;
    `);
    const names = cols.map((c) => c.column_name);
    for (const expected of ["owner_id", "id", "package_id", "drawing_id", "revision_id", "purpose",
      "bucket", "object_path", "original_filename", "content_sha256", "content_length",
      "request_id", "created_by", "created_at", "retired_at", "retired_by"]) {
      expect(names).toContain(expected);
    }
    const { rows: fks } = await db.query(`
      select conname, pg_get_constraintdef(oid) as def
      from pg_constraint where conrelid = 'public.forge_wp_drawing_artifacts'::regclass
        and contype = 'f' order by conname;
    `);
    expect(fks.length).toBeGreaterThanOrEqual(2);
    expect(fks.map((f) => f.def).join(" ")).toContain("forge_work_drawings");
    expect(fks.map((f) => f.def).join(" ")).toContain("forge_wp_drawing_revisions");
    const { rows: uniques } = await db.query(`
      select indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'forge_wp_drawing_artifacts'
        and indexdef ilike '%unique%';
    `);
    const defs = uniques.map((u) => u.indexdef).join(" ");
    expect(defs).toContain("object_path");
    expect(defs).toContain("request_id");
    expect(defs).toContain("(request_id IS NOT NULL)");
    const { rows: checks } = await db.query(`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'public.forge_wp_drawing_artifacts'::regclass and contype = 'c';
    `);
    expect(checks.map((c) => c.def).join(" ")).toContain("ifa_issued");
    expect(checks.map((c) => c.def).join(" ")).toContain("ifc_candidate");
    expect(checks.map((c) => c.def).join(" ")).toContain("ifc_issued");
  });

  it60("adds line_number + intake_source and relaxes the parentage CHECK only for controlled intake", async () => {
    const { rows } = await db.query(`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'public.forge_work_drawings'::regclass
        and conname = 'forge_work_drawings_check';
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toContain("IS DISTINCT FROM 'controlled_pdf'");
    // The pre-existing P&ID rows still satisfy the new CHECK.
    const { rows: bad } = await db.query(`
      select id from forge_work_drawings
      where not ((drawing_type = 'p_id' and p_id_drawing_id is null)
        or (drawing_type <> 'p_id' and (p_id_drawing_id is not null or intake_source = 'controlled_pdf')));
    `);
    expect(bad).toHaveLength(0);
    // A parentless non-P&ID drawing with no intake source is still rejected at the CHECK level.
    await expect(db.query(`
      insert into forge_work_drawings (owner_id, package_id, id, drawing_number, drawing_type, title, p_id_drawing_id)
      values ('${OWNER_A}', 'pkg_a', 'dwg_bad', 'X-1', 'isometric', 'Bad', null);
    `)).rejects.toThrow(/forge_work_drawings_check/);
  });

  it60("creates the private PDF-only 25 MB bucket with the three owner-scoped storage policies", async () => {
    const { rows } = await db.query(`
      select id, public, file_size_limit, allowed_mime_types
      from storage.buckets where id = 'controlled-drawings';
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].public).toBe(false);
    expect(rows[0].file_size_limit).toBe(26214400);
    expect(rows[0].allowed_mime_types).toEqual(["application/pdf"]);
    const { rows: policies } = await db.query(`
      select policyname, cmd, qual, with_check
      from pg_policies where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'controlled_drawing%';
    `);
    expect(policies.map((p) => p.policyname).sort()).toEqual([
      "controlled_drawing_objects_orphan_cleanup",
      "controlled_drawing_objects_workspace_insert",
      "controlled_drawing_objects_workspace_select",
    ]);
    const cleanup = policies.find((p) => p.policyname === "controlled_drawing_objects_orphan_cleanup");
    expect(cleanup.qual).toContain("forge_wp_drawing_artifacts");
    // The storage policies enforce: an owner can insert under their own
    // path, and nobody can insert under someone else's path — the
    // policy scopes by the path's first segment, so a stranger
    // inserting under the OWNER's path is denied even though inserting
    // under their own path would be allowed.
    await asUser(db, OWNER_A, `
      insert into storage.objects (bucket_id, name)
      values ('controlled-drawings', '${OWNER_A}/pkg_a/req-1/${SHA_A}.pdf');
    `);
    await expect(asUser(db, STRANGER, `
      insert into storage.objects (bucket_id, name)
      values ('controlled-drawings', '${OWNER_A}/pkg_a/req-1/${SHA_A}.pdf');
    `)).rejects.toThrow(/row-level security|permission denied|insufficient_privilege/);
    const { rows: visible } = await asUser(db, STRANGER, `
      select count(*)::int as n from storage.objects where bucket_id = 'controlled-drawings';
    `);
    expect(visible[0].n).toBe(0);
  });

  it60("authenticated has SELECT only on artifacts; anon and service_role have nothing", async () => {
    for (const [role, privilege, expected] of [
      ["authenticated", "SELECT", true],
      ["authenticated", "INSERT", false],
      ["authenticated", "UPDATE", false],
      ["authenticated", "DELETE", false],
      ["anon", "SELECT", false],
      ["service_role", "SELECT", false],
    ]) {
      const { rows } = await db.query(
        `select has_table_privilege('${role}', 'public.forge_wp_drawing_artifacts', '${privilege}') as ok;`,
      );
      expect(rows[0].ok, `${role} ${privilege} on forge_wp_drawing_artifacts`).toBe(expected);
    }
    // relacl after the selective grant: no anon/service_role entry, no
    // PUBLIC entry — the revokes are load-bearing, not decorative.
    const { rows } = await db.query(`
      select relacl::text as acl from pg_class
      where relname = 'forge_wp_drawing_artifacts' and relnamespace = 'public'::regnamespace;
    `);
    expect(rows[0].acl).toContain("authenticated=r/");
    expect(rows[0].acl).not.toContain("anon");
    expect(rows[0].acl).not.toContain("service_role");
  });

  it60("authenticated can EXECUTE the intake/stage/release/retire RPCs; anon, service_role and PUBLIC cannot", async () => {
    const fns = [
      "forge_wp_drawing_controlled_intake(text, text, text, text, text, text, text, bigint, text, text, timestamptz, text, text, text, text)",
      "forge_wp_drawing_ifc_stage(text, text, text, text, text, bigint, text, text)",
      "forge_wp_drawing_ifc_release(text, text, text, text, text, text, text, text, text)",
      "forge_wp_drawing_retire(text, text, text, text)",
    ];
    for (const fn of fns) {
      const { rows } = await db.query(
        `select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') as ok;`,
      );
      expect(rows[0].ok, `authenticated EXECUTE on ${fn}`).toBe(true);
      for (const role of ["anon", "service_role", "public"]) {
        const { rows: deniedRows } = await db.query(
          `select has_function_privilege('${role}', 'public.${fn}', 'EXECUTE') as ok;`,
        );
        expect(deniedRows[0].ok, `${role} EXECUTE on ${fn}`).toBe(false);
      }
      // proacl after the selective grants: only authenticated has X.
      const { rows: proaclRows } = await db.query(`
        select proacl::text as acl from pg_proc
        where oid = 'public.${fn}'::regprocedure;
      `);
      const acl = proaclRows.map((r) => r.acl).join(" ");
      expect(acl).toContain("authenticated=X/");
      expect(acl).not.toContain("anon=X");
      expect(acl).not.toContain("service_role=X");
    }
  });

  it60("RLS is enabled and forced on the artifacts table", async () => {
    const { rows } = await db.query(`
      select relrowsecurity as rls, relforcerowsecurity as forced
      from pg_class where relname = 'forge_wp_drawing_artifacts' and relnamespace = 'public'::regnamespace;
    `);
    expect(rows).toEqual([{ rls: true, forced: true }]);
  });

  it60("a selective GRANT alone does NOT remove an already-effective broad privilege (negative case)", async () => {
    await db.exec(`
      create table scratch_default_privs (id text primary key);
      grant all on table scratch_default_privs to authenticated;
    `);
    await db.exec(`grant select on scratch_default_privs to authenticated;`);
    const { rows } = await db.query(
      `select has_table_privilege('authenticated', 'public.scratch_default_privs', 'INSERT') as ok;`,
    );
    expect(rows[0].ok).toBe(true);
    const { rows: realRows } = await db.query(
      `select has_table_privilege('authenticated', 'public.forge_wp_drawing_artifacts', 'INSERT') as ok;`,
    );
    expect(realRows[0].ok).toBe(false);
  });

  it60("the shipped migration text carries explicit REVOKEs for the table and all four functions", async () => {
    const sql = loadMigrationSql(THIS);
    expect(sql).toContain("revoke all on table public.forge_wp_drawing_artifacts from public, anon, service_role, authenticated");
    expect(sql).toContain("grant select on table public.forge_wp_drawing_artifacts to authenticated");
    for (const fn of [
      "forge_wp_drawing_controlled_intake(text, text, text, text, text, text, text, bigint, text, text, timestamptz, text, text, text, text)",
      "forge_wp_drawing_ifc_stage(text, text, text, text, text, bigint, text, text)",
      "forge_wp_drawing_ifc_release(text, text, text, text, text, text, text, text, text)",
      "forge_wp_drawing_retire(text, text, text, text)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${fn} from public`);
      expect(sql).toContain(`revoke execute on function public.${fn} from anon, service_role`);
      expect(sql).toContain(`grant execute on function public.${fn} to authenticated`);
    }
    expect(sql).toContain("force row level security");
  });

  it60("the migration applies cleanly a second time (idempotent DDL)", async () => {
    await db.exec(loadMigrationSql(THIS));
    const { rows } = await db.query(`
      select count(*)::int as n from storage.buckets where id = 'controlled-drawings';
    `);
    expect(rows[0].n).toBe(1);
  });
});

describe("slice-7 PDF blockers migration: controlled intake RPC", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("intakes a parentless isometric in a package with no P&ID: drawing + IFA revision + artifact receipt", async () => {
    const artifact = await intakeDrawing(db, OWNER_A, {
      packageId: "pkg_a", number: "W-0005-1", type: "isometric", code: "0",
      sha: SHA_A, requestId: "req-intake-1", line: '2"-PL-101',
      issuerRef: "Drafter A", title: "Test isometric", filename: "W-0005-1.pdf",
    });
    expect(artifact.id).toMatch(/^forge_wpda_/);
    expect(artifact.purpose).toBe("ifa_issued");
    expect(artifact.bucket).toBe("controlled-drawings");
    expect(artifact.object_path).toBe(objectPath(OWNER_A, "pkg_a", "req-intake-1", SHA_A));
    expect(artifact.content_sha256).toBe(SHA_A);
    expect(artifact.request_id).toBe("req-intake-1");
    expect(artifact.created_by).toBe(OWNER_A);
    const { rows: drawings } = await db.query(`
      select * from forge_work_drawings where id = '${artifact.drawing_id}';
    `);
    expect(drawings).toHaveLength(1);
    expect(drawings[0].drawing_number).toBe("W-0005-1");
    expect(drawings[0].drawing_type).toBe("isometric");
    expect(drawings[0].line_number).toBe('2"-PL-101');
    expect(drawings[0].intake_source).toBe("controlled_pdf");
    expect(drawings[0].p_id_drawing_id).toBeNull();
    expect(drawings[0].title).toBe("Test isometric");
    const { rows: revisions } = await db.query(`
      select * from forge_wp_drawing_revisions where id = '${artifact.revision_id}';
    `);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].revision_code).toBe("0");
    expect(revisions[0].issued_as).toBe("IFA");
    expect(revisions[0].document_ref).toBe(`controlled-drawings:${artifact.object_path}`);
    expect(revisions[0].content_sha256).toBe(SHA_A);
  });

  it60("replays the same request id + digest and conflicts on a different digest", async () => {
    const first = await intakeDrawing(db, OWNER_A, {
      packageId: "pkg_a", number: "W-0005-1", type: "isometric", code: "0",
      sha: SHA_A, requestId: "req-replay-1", line: '2"-PL-101',
    });
    const replay = await intakeDrawing(db, OWNER_A, {
      packageId: "pkg_a", number: "W-0005-1", type: "isometric", code: "0",
      sha: SHA_A, requestId: "req-replay-1", line: '2"-PL-101',
    });
    expect(replay.id).toBe(first.id);
    expect(await countRows(db, "select * from forge_wp_drawing_artifacts")).toBe(1);
    expect(await countRows(db, "select * from forge_wp_drawing_revisions")).toBe(1);
    await expect(intakeDrawing(db, OWNER_A, {
      packageId: "pkg_a", number: "W-0005-1", type: "isometric", code: "0",
      sha: SHA_B, requestId: "req-replay-1", line: '2"-PL-101',
    })).rejects.toThrow(/WPP7_IDEMPOTENCY_CONFLICT/);
    expect(await countRows(db, "select * from forge_wp_drawing_artifacts")).toBe(1);
  });

  it60("attaches a second revision to the same drawing; type and line mismatches are refused", async () => {
    const first = await intakeDrawing(db, OWNER_A, {
      packageId: "pkg_a", number: "W-0005-1", type: "isometric", code: "0",
      sha: SHA_A, requestId: "req-rev-1", line: '2"-PL-101',
    });
    const second = await intakeDrawing(db, OWNER_A, {
      packageId: "pkg_a", number: "W-0005-1", type: "isometric", code: "1",
      sha: SHA_B, requestId: "req-rev-2", line: '2"-PL-101',
    });
    expect(second.drawing_id).toBe(first.drawing_id);
    expect(second.revision_id).not.toBe(first.revision_id);
    await expect(intakeDrawing(db, OWNER_A, {
      packageId: "pkg_a", number: "W-0005-1", type: "cut_sheet", code: "2",
      sha: SHA_C, requestId: "req-rev-3", line: '2"-PL-101',
    })).rejects.toThrow(/WPP7_DRAWING_TYPE_MISMATCH/);
    await expect(intakeDrawing(db, OWNER_A, {
      packageId: "pkg_a", number: "W-0005-1", type: "isometric", code: "2",
      sha: SHA_C, requestId: "req-rev-4", line: '2"-PL-999',
    })).rejects.toThrow(/WPP7_LINE_MISMATCH/);
    // Same line again is fine; a missing line on the second upload
    // leaves the recorded line untouched.
    const third = await intakeDrawing(db, OWNER_A, {
      packageId: "pkg_a", number: "W-0005-1", type: "isometric", code: "2",
      sha: SHA_C, requestId: "req-rev-5",
    });
    expect(third.drawing_id).toBe(first.drawing_id);
    const { rows } = await db.query(`select line_number from forge_work_drawings where id = '${first.drawing_id}';`);
    expect(rows[0].line_number).toBe('2"-PL-101');
    // A duplicate revision code is refused and leaves no artifact.
    await expect(intakeDrawing(db, OWNER_A, {
      packageId: "pkg_a", number: "W-0005-1", type: "isometric", code: "0",
      sha: SHA_C, requestId: "req-rev-6", line: '2"-PL-101',
    })).rejects.toThrow(/WPP7_DUPLICATE_REVISION/);
    expect(await countRows(db, "select * from forge_wp_drawing_artifacts")).toBe(3);
  });

  it60("links a P&ID parent fill-only-if-null and validates the parent", async () => {
    // P-101 (dwg_1) is the package's P&ID.
    const withParent = await intakeDrawing(db, OWNER_A, {
      packageId: "pkg_a", number: "W-0005-2", type: "isometric", code: "0",
      sha: SHA_A, requestId: "req-pid-1", line: '2"-PL-101', pidId: "dwg_1",
    });
    const { rows } = await db.query(`select p_id_drawing_id from forge_work_drawings where id = '${withParent.drawing_id}';`);
    expect(rows[0].p_id_drawing_id).toBe("dwg_1");
    // A different parent afterwards is a mismatch, not a re-parent.
    await expect(intakeDrawing(db, OWNER_A, {
      packageId: "pkg_a", number: "W-0005-2", type: "isometric", code: "1",
      sha: SHA_B, requestId: "req-pid-2", line: '2"-PL-101', pidId: "dwg_3",
    })).rejects.toThrow(/WPP7_PID_MISMATCH/);
    // A non-P&ID parent, a missing parent, and a parent on a p_id are refused.
    await expect(intakeDrawing(db, OWNER_A, {
      packageId: "pkg_a", number: "W-0005-3", type: "isometric", code: "0",
      sha: SHA_A, requestId: "req-pid-3", pidId: "dwg_2",
    })).rejects.toThrow(/WPP7_PID_NOT_PID/);
    await expect(intakeDrawing(db, OWNER_A, {
      packageId: "pkg_a", number: "W-0005-3", type: "isometric", code: "0",
      sha: SHA_A, requestId: "req-pid-4", pidId: "dwg_missing",
    })).rejects.toThrow(/WPP7_PID_NOT_FOUND/);
    await expect(intakeDrawing(db, OWNER_A, {
      packageId: "pkg_a", number: "P-103", type: "p_id", code: "0",
      sha: SHA_A, requestId: "req-pid-5", pidId: "dwg_1",
    })).rejects.toThrow(/WPP7_PID_ON_PID/);
  });

  it60("co-owner can intake; a stranger and anon cannot", async () => {
    const artifact = await intakeDrawing(db, MEMBER_C, {
      packageId: "pkg_a", number: "W-0005-1", type: "isometric", code: "0",
      sha: SHA_A, requestId: "req-coowner-1", line: '2"-PL-101',
    });
    expect(artifact.created_by).toBe(MEMBER_C);
    await expect(intakeDrawing(db, STRANGER, {
      packageId: "pkg_a", number: "W-0005-9", type: "isometric", code: "0",
      sha: SHA_A, requestId: "req-stranger-1",
    })).rejects.toThrow(/WPP7_WORKSPACE_FORBIDDEN/);
    await expect(asRole(db, "anon", OWNER_A, `
      select * from forge_wp_drawing_controlled_intake(
        '${OWNER_A}', 'pkg_a', 'W-0005-9', 'isometric', '0',
        '${objectPath(OWNER_A, "pkg_a", "req-anon-1", SHA_A)}', '${SHA_A}',
        1024, 'req-anon-1', null, null, null, null, null, null);
    `)).rejects.toThrow(/permission denied for function/);
    // The stranger's attempt left no drawing behind.
    expect(await countRows(db, `select * from forge_work_drawings where drawing_number = 'W-0005-9'`)).toBe(0);
  });

  it60("missing and terminal packages are refused; a failed intake leaves no drawing and no artifact", async () => {
    await expect(intakeDrawing(db, OWNER_A, {
      packageId: "pkg_missing", number: "W-0005-1", type: "isometric", code: "0",
      sha: SHA_A, requestId: "req-missing-1",
    })).rejects.toThrow(/WPP7_PACKAGE_NOT_FOUND/);
    await expect(intakeDrawing(db, OWNER_A, {
      packageId: "pkg_cancelled", number: "P-901", type: "p_id", code: "0",
      sha: SHA_A, requestId: "req-terminal-1",
    })).rejects.toThrow(/WPP7_PACKAGE_TERMINAL/);
    await expect(intakeDrawing(db, OWNER_A, {
      packageId: "pkg_closed", number: "P-901", type: "p_id", code: "0",
      sha: SHA_A, requestId: "req-terminal-2",
    })).rejects.toThrow(/WPP7_PACKAGE_TERMINAL/);
    await expect(intakeDrawing(db, OWNER_A, {
      packageId: "pkg_a", number: "W-0005-1", type: "isometric", code: "0",
      sha: "not-a-hash", requestId: "req-badsha-1",
    })).rejects.toThrow(/WPP7_INVALID_SHA256/);
    expect(await countRows(db, "select * from forge_work_drawings where drawing_number = 'W-0005-1'")).toBe(0);
    expect(await countRows(db, "select * from forge_wp_drawing_artifacts")).toBe(0);
  });

  it60("RLS: a stranger sees no artifacts and direct writes are denied even for the owner (RPC-only path)", async () => {
    await intakeDrawing(db, OWNER_A, {
      packageId: "pkg_a", number: "W-0005-1", type: "isometric", code: "0",
      sha: SHA_A, requestId: "req-rls-1", line: '2"-PL-101',
    });
    const { rows: ownerRows } = await asUser(db, OWNER_A, `
      select count(*)::int as n from forge_wp_drawing_artifacts;
    `);
    expect(ownerRows[0].n).toBe(1);
    const { rows: strangerRows } = await asUser(db, STRANGER, `
      select count(*)::int as n from forge_wp_drawing_artifacts;
    `);
    expect(strangerRows[0].n).toBe(0);
    // Anon has no grant at all, so even the count is denied — anon
    // sees nothing by privilege, not just by RLS filtering.
    await expect(asRole(db, "anon", OWNER_A, `
      select count(*)::int as n from forge_wp_drawing_artifacts;
    `)).rejects.toThrow(/permission denied for table/);
    await expect(asUser(db, OWNER_A, `
      insert into forge_wp_drawing_artifacts
        (owner_id, id, package_id, drawing_id, purpose, bucket, object_path,
         content_sha256, content_length)
      values ('${OWNER_A}', 'forge_wpda_direct', 'pkg_a', 'dwg_1', 'ifa_issued',
        'controlled-drawings', '${OWNER_A}/pkg_a/req-direct/${SHA_A}.pdf', '${SHA_A}', 1024);
    `)).rejects.toThrow(/row-level security|permission denied|insufficient_privilege/);
    // Composite FKs: an artifact naming a drawing that does not exist
    // is refused even by the superuser path (RLS bypass does not
    // bypass foreign keys).
    await expect(db.query(`
      insert into forge_wp_drawing_artifacts
        (owner_id, id, package_id, drawing_id, purpose, bucket, object_path,
         content_sha256, content_length, created_by)
      values ('${OWNER_A}', 'forge_wpda_fk', 'pkg_a', 'dwg_missing', 'ifa_issued',
        'controlled-drawings', '${OWNER_A}/pkg_a/req-fk/${SHA_A}.pdf', '${SHA_A}', 1024, '${OWNER_A}');
    `)).rejects.toThrow(/violates foreign key constraint/);
  });
});

describe("slice-7 PDF blockers migration: IFC stage + staged release", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  async function intakeApprove(db, uid, number = "W-0005-1") {
    const artifact = await intakeDrawing(db, uid, {
      packageId: "pkg_a", number, type: "isometric", code: "0",
      sha: SHA_A, requestId: `req-flow-${number}`, line: '2"-PL-101',
    });
    const review = await createReview(db, uid, {
      packageId: "pkg_a", drawingId: artifact.drawing_id, revisionId: artifact.revision_id,
      key: `key-flow-${number}`,
    });
    await decideReview(db, uid, { reviewId: review.id, expectedVersion: 1, decision: "APPROVE" });
    return { artifact, review };
  }

  it60("staging rejects bytes identical to the latest IFA revision and creates no revision", async () => {
    const { artifact } = await intakeApprove(db, OWNER_A);
    await expect(stageIfc(db, OWNER_A, {
      packageId: "pkg_a", drawingId: artifact.drawing_id,
      sha: SHA_A, requestId: "req-stage-same",
    })).rejects.toThrow(/WPP7_IFC_SAME_AS_IFA/);
    expect(await countRows(db, "select * from forge_wp_drawing_revisions")).toBe(1);
    const staged = await stageIfc(db, OWNER_A, {
      packageId: "pkg_a", drawingId: artifact.drawing_id,
      sha: SHA_B, requestId: "req-stage-1", filename: "W-0005-1-IFC.pdf",
    });
    expect(staged.purpose).toBe("ifc_candidate");
    expect(staged.revision_id).toBeNull();
    expect(staged.content_sha256).toBe(SHA_B);
    expect(await countRows(db, "select * from forge_wp_drawing_revisions")).toBe(1);
    const replay = await stageIfc(db, OWNER_A, {
      packageId: "pkg_a", drawingId: artifact.drawing_id,
      sha: SHA_B, requestId: "req-stage-1", filename: "W-0005-1-IFC.pdf",
    });
    expect(replay.id).toBe(staged.id);
    expect(await countRows(db, "select * from forge_wp_drawing_artifacts where purpose = 'ifc_candidate'")).toBe(1);
  });

  it60("staged release issues an IFC revision from the stored bytes and flips the artifact to ifc_issued", async () => {
    const { artifact, review } = await intakeApprove(db, OWNER_A);
    const staged = await stageIfc(db, OWNER_A, {
      packageId: "pkg_a", drawingId: artifact.drawing_id,
      sha: SHA_B, requestId: "req-stage-2",
    });
    const release = await releaseIfc(db, OWNER_A, {
      packageId: "pkg_a", drawingId: artifact.drawing_id, reviewId: review.id,
      code: "C", stagedArtifactId: staged.id,
    });
    expect(release.ifc_revision_id).toBeTruthy();
    const { rows: revisions } = await db.query(`
      select * from forge_wp_drawing_revisions where id = '${release.ifc_revision_id}';
    `);
    expect(revisions[0].issued_as).toBe("IFC");
    expect(revisions[0].revision_code).toBe("C");
    expect(revisions[0].document_ref).toBe(`controlled-drawings:${staged.object_path}`);
    expect(revisions[0].content_sha256).toBe(SHA_B);
    const { rows: artifacts } = await db.query(`
      select purpose, revision_id from forge_wp_drawing_artifacts where id = '${staged.id}';
    `);
    expect(artifacts[0].purpose).toBe("ifc_issued");
    expect(artifacts[0].revision_id).toBe(release.ifc_revision_id);
    // The same staged artifact cannot be released a second time.
    await expect(releaseIfc(db, OWNER_A, {
      packageId: "pkg_a", drawingId: artifact.drawing_id, reviewId: review.id,
      code: "D", stagedArtifactId: staged.id,
    })).rejects.toThrow(/WPP7_ARTIFACT_NOT_STAGED/);
    const snap = await snapshot(db, OWNER_A, { packageId: "pkg_a" });
    const row = snap.drawings.find((d) => d.drawing_id === artifact.drawing_id);
    expect(row.badge).toBe("IFC — Issued for construction");
    expect(row.construction_usable).toBe(true);
  });

  it60("typed-path release rejects an IFC issue whose digest equals the reviewed IFA revision", async () => {
    const { artifact, review } = await intakeApprove(db, OWNER_A);
    await expect(releaseIfc(db, OWNER_A, {
      packageId: "pkg_a", drawingId: artifact.drawing_id, reviewId: review.id,
      code: "C", docRef: "s3://forge/ifc.pdf", sha: SHA_A,
    })).rejects.toThrow(/WPP7_IFC_SAME_AS_IFA/);
    // A different digest on the typed path still issues (compat path).
    const release = await releaseIfc(db, OWNER_A, {
      packageId: "pkg_a", drawingId: artifact.drawing_id, reviewId: review.id,
      code: "C", docRef: "s3://forge/ifc.pdf", sha: SHA_C,
    });
    expect(release.ifc_revision_id).toBeTruthy();
  });

  it60("retire retires the drawing's artifacts, so a staged candidate can never be released", async () => {
    const { artifact, review } = await intakeApprove(db, OWNER_A);
    const staged = await stageIfc(db, OWNER_A, {
      packageId: "pkg_a", drawingId: artifact.drawing_id,
      sha: SHA_B, requestId: "req-stage-3",
    });
    await retireDrawingRpc(db, OWNER_A, {
      packageId: "pkg_a", drawingId: artifact.drawing_id, reason: "Superseded by re-route.",
    });
    const { rows } = await db.query(`
      select retired_at from forge_wp_drawing_artifacts where drawing_id = '${artifact.drawing_id}';
    `);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.retired_at !== null)).toBe(true);
    await expect(releaseIfc(db, OWNER_A, {
      packageId: "pkg_a", drawingId: artifact.drawing_id, reviewId: review.id,
      code: "C", stagedArtifactId: staged.id,
    })).rejects.toThrow(/WPP7_ARTIFACT_RETIRED/);
  });
});

// Real-PostgreSQL subset. PGlite is single-connection, so the
// concurrent-serialization leg can only run here, against a scratch
// PG16 cluster. Gated on the binaries existing AND an unprivileged
// user to run the cluster as (initdb refuses root, and this VM's
// agent runs as root) — and SKIPS LOUDLY, never silently, when
// either is missing.
const PG_BIN = "/usr/lib/postgresql/16/bin";
function detectRealPgUser() {
  try {
    execSync(`ls ${PG_BIN}/initdb ${PG_BIN}/pg_ctl`, { stdio: "ignore" });
    execSync("which runuser", { stdio: "ignore" });
  } catch {
    return null;
  }
  for (const user of ["postgres", "nobody"]) {
    try {
      execSync(`id ${user}`, { stdio: "ignore" });
      return user;
    } catch { /* try the next user */ }
  }
  return null;
}
const PG_RUN_USER = detectRealPgUser();
const HAS_REAL_PG = PG_RUN_USER !== null;
if (!HAS_REAL_PG) {
  console.warn(
    "⚠️ LOUD SKIP: real-PostgreSQL subset SKIPPED — PG16 binaries or an unprivileged "
    + "user to run them as (initdb refuses root) were not found. "
    + "The PGlite battery still runs; run the real-PG leg where PG16 exists.",
  );
}

describe.skipIf(!HAS_REAL_PG)("slice-7 PDF blockers migration: real-PostgreSQL subset", () => {
  let pgDir;
  let pgClient;
  let pgClient2;
  let pgCfg;

  beforeAll(async () => {
    pgDir = mkdtempSync(join(tmpdir(), "wpp7-intake-realpg-"));
    execSync(`chown ${PG_RUN_USER}:${PG_RUN_USER} "${pgDir}"`, { stdio: "pipe" });
    const asPgUser = (cmd) => `runuser -u ${PG_RUN_USER} -- ${cmd}`;
    execSync(asPgUser(`"${PG_BIN}/initdb" -D "${pgDir}" -U postgres --auth=trust`), { stdio: "pipe" });
    execSync(
      asPgUser(`"${PG_BIN}/pg_ctl" -D "${pgDir}" -o "-p 55433 -k ${pgDir} -c listen_addresses=''" -l "${pgDir}/server.log" start`),
      { stdio: "pipe" },
    );
    pgCfg = { host: pgDir, port: 55433, user: "postgres", database: "postgres" };
    pgClient = new Client(pgCfg);
    await pgClient.connect();
    pgClient2 = new Client(pgCfg);
    await pgClient2.connect();
    await pgClient.query(PREREQ_SQL);
    await pgClient.query(loadMigrationSql(SLICE3));
    await pgClient.query(loadMigrationSql(SLICE4));
    await pgClient.query(loadMigrationSql(SLICE5));
    await pgClient.query(loadMigrationSql(SLICE7));
    await pgClient.query(loadMigrationSql(THIS));
    await pgClient.query(`
      insert into forge_work_packages (owner_id, id, status) values
        ('${OWNER_A}', 'pkg_real', 'in_progress');
      insert into workspace_members (owner_id, member_user_id, status, role)
        values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
    `);
    const { rows } = await pgClient.query("select version() as v;");
    pgCfg.version = rows[0].v;
  }, 120000);

  afterAll(async () => {
    try { await pgClient?.end(); } catch { /* already closed */ }
    try { await pgClient2?.end(); } catch { /* already closed */ }
    if (pgDir) {
      try { execSync(`runuser -u ${PG_RUN_USER} -- "${PG_BIN}/pg_ctl" -D "${pgDir}" stop -m fast`, { stdio: "pipe" }); } catch { /* already stopped */ }
      rmSync(pgDir, { recursive: true, force: true });
    }
  }, 120000);

  async function pgAsUser(client, uid, sql) {
    await client.query(`set role authenticated; set app.test_uid = '${uid}';`);
    try {
      return await client.query(sql);
    } finally {
      await client.query(`reset role;`);
    }
  }

  it60("runs on PostgreSQL 16 and intakes end to end", async () => {
    expect(pgCfg.version).toMatch(/PostgreSQL 16/);
    const { rows } = await pgAsUser(pgClient, OWNER_A, `
      select * from forge_wp_drawing_controlled_intake(
        '${OWNER_A}', 'pkg_real', 'W-0005-1', 'isometric', '0',
        '${objectPath(OWNER_A, "pkg_real", "req-real-1", SHA_A)}', '${SHA_A}',
        1024, 'req-real-1', '2"-PL-101', null, 'Drafter A', 'Test isometric', null, 'W-0005-1.pdf');
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].purpose).toBe("ifa_issued");
    expect(rows[0].id).toMatch(/^forge_wpda_/);
  });

  it60("concurrent duplicate intakes serialize to one artifact row and one receipt", async () => {
    const sql = `
      select * from forge_wp_drawing_controlled_intake(
        '${OWNER_A}', 'pkg_real', 'W-0005-2', 'isometric', '0',
        '${objectPath(OWNER_A, "pkg_real", "req-real-race", SHA_B)}', '${SHA_B}',
        1024, 'req-real-race', '2"-PL-102', null, null, null, null, null);
    `;
    const [first, second] = await Promise.all([
      pgAsUser(pgClient, OWNER_A, sql),
      pgAsUser(pgClient2, OWNER_A, sql),
    ]);
    expect(first.rows[0].id).toBe(second.rows[0].id);
    const { rows } = await pgClient.query(`
      select count(*)::int as n from forge_wp_drawing_artifacts where request_id = 'req-real-race';
    `);
    expect(rows[0].n).toBe(1);
    const { rows: revRows } = await pgClient.query(`
      select count(*)::int as n from forge_wp_drawing_revisions
      where drawing_id = '${first.rows[0].drawing_id}';
    `);
    expect(revRows[0].n).toBe(1);
  });
});
