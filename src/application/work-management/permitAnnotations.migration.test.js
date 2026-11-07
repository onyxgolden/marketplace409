// Work Package Planner slice 3 — migration/integration proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) and proves:
//   - CHECKs/FKs: target/provenance discipline, URL backstop, package
//     and drawing parentage, revision uniqueness;
//   - RLS: owner isolation, co-owner access, anon sees nothing, direct
//     writes denied (RPC-only write path);
//   - RPCs: create/update/retire flows, version guards, retired
//     guard, actor derived from auth.uid() (no forgeable actor
//     parameter), drawing delete retires annotations atomically;
//   - Effective ACL matrix for authenticated/anon/service_role, and
//     the default-privilege negative case: a selective GRANT alone
//     does NOT revoke an already-effective broad privilege, which is
//     why the migration's explicit REVOKEs are load-bearing.
// Roles, the auth.uid() stub, workspace_members, and the
// has_workspace_access() copy mirror production (see
// 20260829000100_add_workspace_authorization_helpers.sql); the
// prerequisite package/drawing/line tables are minimal shapes with
// the exact keys the slice-3 foreign keys reference.

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
    join(HERE, "..", "..", "..", "supabase", "migrations", "20261107000000_forge_work_package_permit_annotations_slice3.sql"),
    "utf8",
  );
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
    -- Minimal prerequisite shapes with the exact keys the slice-3
    -- foreign keys reference.
    create table forge_work_packages (
      owner_id text not null,
      id text not null,
      primary key (owner_id, id)
    );
    create table forge_work_drawings (
      owner_id text not null,
      package_id text not null,
      id text not null,
      p_id_drawing_id text,
      unique (owner_id, package_id, id)
    );
    create table forge_work_takeoff_lines (
      owner_id text not null,
      drawing_id text not null,
      id text not null
    );
  `);
  await db.exec(loadMigrationSql());
  // Seed as superuser (bypasses RLS for seeding).
  await db.exec(`
    insert into forge_work_packages (owner_id, id) values ('${OWNER_A}', 'pkg_a'), ('${OWNER_B}', 'pkg_b');
    insert into forge_work_drawings (owner_id, package_id, id, p_id_drawing_id)
      values ('${OWNER_A}', 'pkg_a', 'dwg_a1', null),
             ('${OWNER_A}', 'pkg_a', 'dwg_a2', 'dwg_a1'),
             ('${OWNER_B}', 'pkg_b', 'dwg_b1', null);
    insert into workspace_members (owner_id, member_user_id, status, role)
      values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
  `);
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

async function createAnnotation(db, uid, { ownerId, packageId, targetKind, drawingId, label, url, reference, note }) {
  // uid is the authenticated caller (app.test_uid); ownerId is the
  // p_owner_id argument — they differ only for the foreign-workspace
  // case, where a caller acts on another owner's id.
  const pOwner = ownerId ?? uid;
  const { rows } = await asUser(db, uid, `
    select * from forge_work_permit_annotation_create(
      '${pOwner}', '${packageId}', '${targetKind}',
      ${drawingId ? `'${drawingId}'` : "null"},
      '${label}', '${url}',
      ${reference ? `'${reference}'` : "null"},
      ${note ? `'${note}'` : "null"});
  `);
  return rows[0];
}

describe("slice 3 migration: schema constraints", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("rejects a target kind outside package/drawing", async () => {
    await expect(db.query(`
      insert into forge_work_permit_annotations
        (owner_id, id, work_package_id, target_kind, label, url, version, created_by, updated_by)
        values ('${OWNER_A}', 'x1', 'pkg_a', 'line', 'L', 'https://example.com/x', 1, 'u', 'u');
    `)).rejects.toThrow(/check constraint/i);
  });

  it60("rejects a package target carrying a drawing", async () => {
    await expect(db.query(`
      insert into forge_work_permit_annotations
        (owner_id, id, work_package_id, target_kind, drawing_id, original_drawing_id, label, url, version, created_by, updated_by)
        values ('${OWNER_A}', 'x1', 'pkg_a', 'package', 'dwg_a1', 'dwg_a1', 'L', 'https://example.com/x', 1, 'u', 'u');
    `)).rejects.toThrow(/check constraint/i);
  });

  it60("rejects an active drawing target whose live drawing differs from its original", async () => {
    await expect(db.query(`
      insert into forge_work_permit_annotations
        (owner_id, id, work_package_id, target_kind, drawing_id, original_drawing_id, label, url, version, created_by, updated_by)
        values ('${OWNER_A}', 'x1', 'pkg_a', 'drawing', 'dwg_a2', 'dwg_a1', 'L', 'https://example.com/x', 1, 'u', 'u');
    `)).rejects.toThrow(/check constraint/i);
  });

  it60("rejects a non-HTTPS URL and a URL with a space at the database backstop", async () => {
    await expect(db.query(`
      insert into forge_work_permit_annotations
        (owner_id, id, work_package_id, target_kind, label, url, version, created_by, updated_by)
        values ('${OWNER_A}', 'x1', 'pkg_a', 'package', 'L', 'http://example.com/x', 1, 'u', 'u');
    `)).rejects.toThrow(/check constraint/i);
    await expect(db.query(`
      insert into forge_work_permit_annotations
        (owner_id, id, work_package_id, target_kind, label, url, version, created_by, updated_by)
        values ('${OWNER_A}', 'x2', 'pkg_a', 'package', 'L', 'https://example.com/pa th', 1, 'u', 'u');
    `)).rejects.toThrow(/check constraint/i);
  });

  it60("rejects a drawing from another package and another owner at the foreign key", async () => {
    await expect(db.query(`
      insert into forge_work_permit_annotations
        (owner_id, id, work_package_id, target_kind, drawing_id, original_drawing_id, label, url, version, created_by, updated_by)
        values ('${OWNER_A}', 'x1', 'pkg_a', 'drawing', 'dwg_b1', 'dwg_b1', 'L', 'https://example.com/x', 1, 'u', 'u');
    `)).rejects.toThrow(/foreign key/i);
    await expect(db.query(`
      insert into forge_work_permit_annotations
        (owner_id, id, work_package_id, target_kind, drawing_id, original_drawing_id, label, url, version, created_by, updated_by)
        values ('${OWNER_B}', 'x1', 'pkg_a', 'drawing', 'dwg_a1', 'dwg_a1', 'L', 'https://example.com/x', 1, 'u', 'u');
    `)).rejects.toThrow(/foreign key/i);
  });

  it60("rejects a revision for a nonexistent annotation and a duplicate version", async () => {
    const ann = await createAnnotation(db, OWNER_A, {
      packageId: "pkg_a", targetKind: "package", label: "Portal", url: "https://example.com/x",
    });
    await expect(db.query(`
      insert into forge_work_permit_annotation_revisions
        (owner_id, id, annotation_id, version, actor_id, action)
        values ('${OWNER_A}', 'r-missing', 'no-such-annotation', 1, 'u', 'create');
    `)).rejects.toThrow(/foreign key/i);
    await expect(db.query(`
      insert into forge_work_permit_annotation_revisions
        (owner_id, id, annotation_id, version, actor_id, action)
        values ('${OWNER_A}', 'r-dup', '${ann.id}', 1, 'u', 'create');
    `)).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe("slice 3 migration: RLS isolation", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("owner A selects only owner A annotations; owner B only owner B", async () => {
    await createAnnotation(db, OWNER_A, { packageId: "pkg_a", targetKind: "package", label: "A portal", url: "https://example.com/a" });
    await createAnnotation(db, OWNER_B, { packageId: "pkg_b", targetKind: "package", label: "B portal", url: "https://example.com/b" });
    const { rows: rowsA } = await asUser(db, OWNER_A, `select label from forge_work_permit_annotations;`);
    const { rows: rowsB } = await asUser(db, OWNER_B, `select label from forge_work_permit_annotations;`);
    expect(rowsA.map((r) => r.label)).toEqual(["A portal"]);
    expect(rowsB.map((r) => r.label)).toEqual(["B portal"]);
  });

  it60("an active co-owner membership grants access to the workspace", async () => {
    await createAnnotation(db, OWNER_A, { packageId: "pkg_a", targetKind: "package", label: "A portal", url: "https://example.com/a" });
    const { rows } = await asUser(db, MEMBER_C, `select label from forge_work_permit_annotations;`);
    expect(rows.map((r) => r.label)).toEqual(["A portal"]);
  });

  it60("anon cannot select (no policy, no grant)", async () => {
    await expect(
      asRole(db, "anon", OWNER_A, `select * from forge_work_permit_annotations;`),
    ).rejects.toThrow(/permission denied/i);
  });

  it60("a direct client insert is denied — writes go only through the RPCs", async () => {
    await expect(
      asUser(db, OWNER_A, `
        insert into forge_work_permit_annotations
          (owner_id, id, work_package_id, target_kind, label, url, version, created_by, updated_by)
          values ('${OWNER_A}', 'x-direct', 'pkg_a', 'package', 'Direct', 'https://example.com/x', 1, 'u', 'u');
      `),
    ).rejects.toThrow(/permission denied|violates row-level security/i);
    const { rows } = await db.query(`select count(*) as n from forge_work_permit_annotations;`);
    expect(Number(rows[0].n)).toBe(0);
  });

  it60("a direct client write to revisions is denied", async () => {
    const ann = await createAnnotation(db, OWNER_A, {
      packageId: "pkg_a", targetKind: "package", label: "Portal", url: "https://example.com/x",
    });
    await expect(
      asUser(db, OWNER_A, `
        insert into forge_work_permit_annotation_revisions
          (owner_id, id, annotation_id, version, actor_id, action)
          values ('${OWNER_A}', 'r-direct', '${ann.id}', 99, 'u', 'update');
      `),
    ).rejects.toThrow(/permission denied|violates row-level security/i);
  });
});

describe("slice 3 migration: RPC flows and audit", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("create writes the annotation and a create revision with the caller as actor", async () => {
    const ann = await createAnnotation(db, OWNER_A, {
      packageId: "pkg_a", targetKind: "drawing", drawingId: "dwg_a1",
      label: "Permit", url: "https://example.com/p", reference: "PERMIT-1", note: "See portal",
    });
    expect(ann.version).toBe(1);
    expect(ann.created_by).toBe(OWNER_A);
    expect(ann.target_kind).toBe("drawing");
    expect(ann.original_drawing_id).toBe("dwg_a1");
    const { rows } = await db.query(
      `select * from forge_work_permit_annotation_revisions where annotation_id = '${ann.id}' order by version;`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("create");
    expect(rows[0].actor_id).toBe(OWNER_A);
    expect(rows[0].old_values).toBeNull();
    expect(rows[0].new_values.label).toBe("Permit");
  });

  it60("the RPCs take no actor parameter — audit forgery is impossible by signature", async () => {
    for (const fn of [
      "forge_work_permit_annotation_create(text,text,text,text,text,text,text,text)",
      "forge_work_permit_annotation_update(text,text,integer,text,text,text,text,text)",
      "forge_work_permit_annotation_retire(text,text,integer,text)",
      "forge_work_permit_annotation_delete_drawing(text,text,text)",
    ]) {
      const { rows } = await db.query(`select pg_get_function_arguments('${fn}'::regprocedure) as args;`);
      expect(rows[0].args).not.toMatch(/actor/i);
    }
  });

  it60("a second caller is audited under their own id, not the first caller's", async () => {
    const annA = await createAnnotation(db, OWNER_A, {
      packageId: "pkg_a", targetKind: "package", label: "A", url: "https://example.com/a",
    });
    const annB = await createAnnotation(db, OWNER_B, {
      packageId: "pkg_b", targetKind: "package", label: "B", url: "https://example.com/b",
    });
    const { rows } = await db.query(`select annotation_id, actor_id from forge_work_permit_annotation_revisions order by recorded_at;`);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.annotation_id === annA.id).actor_id).toBe(OWNER_A);
    expect(rows.find((r) => r.annotation_id === annB.id).actor_id).toBe(OWNER_B);
  });

  it60("create rejects a foreign workspace, a missing package, a foreign drawing, and bad URLs", async () => {
    await expect(createAnnotation(db, OWNER_B, {
      ownerId: OWNER_A, packageId: "pkg_a", targetKind: "package", label: "X", url: "https://example.com/x",
    })).rejects.toThrow(/WPP3_WORKSPACE_FORBIDDEN/);
    await expect(createAnnotation(db, OWNER_A, {
      packageId: "pkg_nope", targetKind: "package", label: "X", url: "https://example.com/x",
    })).rejects.toThrow(/WPP3_PACKAGE_NOT_FOUND/);
    await expect(createAnnotation(db, OWNER_A, {
      packageId: "pkg_a", targetKind: "drawing", drawingId: "dwg_b1", label: "X", url: "https://example.com/x",
    })).rejects.toThrow(/WPP3_DRAWING_NOT_FOUND/);
    await expect(createAnnotation(db, OWNER_A, {
      packageId: "pkg_a", targetKind: "package", label: "X", url: "http://example.com/x",
    })).rejects.toThrow(/WPP3_INVALID_URL/);
    await expect(createAnnotation(db, OWNER_A, {
      packageId: "pkg_a", targetKind: "package", label: "X", url: "https://127.0.0.1/x",
    })).rejects.toThrow(/WPP3_INVALID_URL/);
    await expect(createAnnotation(db, OWNER_A, {
      packageId: "pkg_a", targetKind: "package", label: "X", url: "https://user:pass@example.com/x",
    })).rejects.toThrow(/WPP3_INVALID_URL/);
  });

  it60("update bumps the version and records old/new snapshots; a stale version conflicts", async () => {
    const ann = await createAnnotation(db, OWNER_A, {
      packageId: "pkg_a", targetKind: "package", label: "Old", url: "https://example.com/old",
    });
    const { rows } = await asUser(db, OWNER_A, `
      select * from forge_work_permit_annotation_update(
        '${OWNER_A}', '${ann.id}', 1, 'New', 'https://example.com/new', null, 'note', 'renamed');
    `);
    expect(rows[0].version).toBe(2);
    expect(rows[0].label).toBe("New");
    const { rows: revs } = await db.query(
      `select * from forge_work_permit_annotation_revisions where annotation_id = '${ann.id}' order by version;`,
    );
    expect(revs).toHaveLength(2);
    expect(revs[1].action).toBe("update");
    expect(revs[1].old_values.label).toBe("Old");
    expect(revs[1].new_values.label).toBe("New");
    expect(revs[1].reason).toBe("renamed");
    await expect(asUser(db, OWNER_A, `
      select * from forge_work_permit_annotation_update(
        '${OWNER_A}', '${ann.id}', 1, 'Stale', null, null, null, null);
    `)).rejects.toThrow(/WPP3_VERSION_CONFLICT/);
  });

  it60("retire soft-deletes with a revision; a retired annotation cannot be updated or retired again", async () => {
    const ann = await createAnnotation(db, OWNER_A, {
      packageId: "pkg_a", targetKind: "package", label: "Old", url: "https://example.com/x",
    });
    const { rows } = await asUser(db, OWNER_A, `
      select * from forge_work_permit_annotation_retire('${OWNER_A}', '${ann.id}', 1, 'Superseded');
    `);
    expect(rows[0].version).toBe(2);
    expect(rows[0].retired_at).not.toBeNull();
    expect(rows[0].retired_by).toBe(OWNER_A);
    await expect(asUser(db, OWNER_A, `
      select * from forge_work_permit_annotation_update(
        '${OWNER_A}', '${ann.id}', 2, 'Nope', null, null, null, null);
    `)).rejects.toThrow(/WPP3_RETIRED/);
    await expect(asUser(db, OWNER_A, `
      select * from forge_work_permit_annotation_retire('${OWNER_A}', '${ann.id}', 2, null);
    `)).rejects.toThrow(/WPP3_RETIRED/);
    const { rows: revs } = await db.query(
      `select action from forge_work_permit_annotation_revisions where annotation_id = '${ann.id}' order by version;`,
    );
    expect(revs.map((r) => r.action)).toEqual(["create", "retire"]);
  });

  it60("drawing delete retires attached annotations with audit and deletes the drawing in one transaction", async () => {
    const onDrawing = await createAnnotation(db, OWNER_A, {
      packageId: "pkg_a", targetKind: "drawing", drawingId: "dwg_a1", label: "On drawing", url: "https://example.com/d",
    });
    const onPackage = await createAnnotation(db, OWNER_A, {
      packageId: "pkg_a", targetKind: "package", label: "On package", url: "https://example.com/p",
    });
    // dwg_a2 is seeded as a child of dwg_a1; delete the child first so
    // the parent delete is not blocked by the children guard.
    await asUser(db, OWNER_A, `
      select forge_work_permit_annotation_delete_drawing('${OWNER_A}', 'pkg_a', 'dwg_a2');
    `);
    const { rows } = await asUser(db, OWNER_A, `
      select forge_work_permit_annotation_delete_drawing('${OWNER_A}', 'pkg_a', 'dwg_a1');
    `);
    expect(rows[0].forge_work_permit_annotation_delete_drawing).toBe(true);
    const { rows: drawings } = await db.query(`select id from forge_work_drawings where id = 'dwg_a1';`);
    expect(drawings).toHaveLength(0);
    const { rows: anns } = await db.query(
      `select * from forge_work_permit_annotations where id in ('${onDrawing.id}', '${onPackage.id}') order by id;`,
    );
    const retired = anns.find((a) => a.id === onDrawing.id);
    const kept = anns.find((a) => a.id === onPackage.id);
    expect(retired.retired_at).not.toBeNull();
    expect(retired.retired_by).toBe(OWNER_A);
    expect(retired.drawing_id).toBeNull();
    expect(retired.original_drawing_id).toBe("dwg_a1");
    expect(retired.version).toBe(2);
    expect(kept.retired_at).toBeNull();
    const { rows: revs } = await db.query(
      `select action, old_values, new_values from forge_work_permit_annotation_revisions where annotation_id = '${onDrawing.id}' order by version;`,
    );
    expect(revs.map((r) => r.action)).toEqual(["create", "parent_drawing_deleted"]);
    expect(revs[1].old_values.retired_at).toBeNull();
    expect(revs[1].new_values.retired_at).not.toBeNull();
    expect(revs[1].new_values.original_drawing_id).toBe("dwg_a1");
  });

  it60("drawing delete blocked by child drawings or lines leaves annotations active (no partial retire)", async () => {
    const ann = await createAnnotation(db, OWNER_A, {
      packageId: "pkg_a", targetKind: "drawing", drawingId: "dwg_a1", label: "On parent", url: "https://example.com/d",
    });
    // dwg_a2 is a child of dwg_a1 (seeded p_id_drawing_id).
    await expect(asUser(db, OWNER_A, `
      select forge_work_permit_annotation_delete_drawing('${OWNER_A}', 'pkg_a', 'dwg_a1');
    `)).rejects.toThrow(/WPP3_DRAWING_HAS_CHILDREN/);
    await db.query(`update forge_work_drawings set p_id_drawing_id = null where id = 'dwg_a2';`);
    await db.query(`insert into forge_work_takeoff_lines (owner_id, drawing_id, id) values ('${OWNER_A}', 'dwg_a1', 'line_1');`);
    await expect(asUser(db, OWNER_A, `
      select forge_work_permit_annotation_delete_drawing('${OWNER_A}', 'pkg_a', 'dwg_a1');
    `)).rejects.toThrow(/WPP3_DRAWING_HAS_LINES/);
    const { rows } = await db.query(`select retired_at from forge_work_permit_annotations where id = '${ann.id}';`);
    expect(rows[0].retired_at).toBeNull();
    const { rows: revs } = await db.query(
      `select count(*) as n from forge_work_permit_annotation_revisions where annotation_id = '${ann.id}';`,
    );
    expect(Number(revs[0].n)).toBe(1);
  });

  it60("drawing delete of a missing drawing fails without touching annotations", async () => {
    const ann = await createAnnotation(db, OWNER_A, {
      packageId: "pkg_a", targetKind: "package", label: "On package", url: "https://example.com/p",
    });
    await expect(asUser(db, OWNER_A, `
      select forge_work_permit_annotation_delete_drawing('${OWNER_A}', 'pkg_a', 'dwg_nope');
    `)).rejects.toThrow(/WPP3_DRAWING_NOT_FOUND/);
    const { rows } = await db.query(`select retired_at from forge_work_permit_annotations where id = '${ann.id}';`);
    expect(rows[0].retired_at).toBeNull();
  });
});

describe("slice 3 migration: effective ACL matrix and default-privilege negative case", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("authenticated has SELECT only; anon and service_role have nothing on either table", async () => {
    for (const table of ["forge_work_permit_annotations", "forge_work_permit_annotation_revisions"]) {
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        const { rows } = await db.query(
          `select has_table_privilege('authenticated', 'public.${table}', '${priv}') as ok;`,
        );
        expect(rows[0].ok).toBe(priv === "SELECT");
        for (const role of ["anon", "service_role"]) {
          const { rows: roleRows } = await db.query(
            `select has_table_privilege('${role}', 'public.${table}', '${priv}') as ok;`,
          );
          expect(roleRows[0].ok).toBe(false);
        }
      }
    }
  });

  it60("only authenticated may execute the RPCs (and the URL validator)", async () => {
    for (const fn of [
      "forge_work_permit_annotation_create(text,text,text,text,text,text,text,text)",
      "forge_work_permit_annotation_update(text,text,integer,text,text,text,text,text)",
      "forge_work_permit_annotation_retire(text,text,integer,text)",
      "forge_work_permit_annotation_delete_drawing(text,text,text)",
      "forge_work_permit_annotation_url_is_valid(text)",
    ]) {
      const { rows: authRows } = await db.query(
        `select has_function_privilege('authenticated', 'public.${fn}'::regprocedure, 'EXECUTE') as ok;`,
      );
      expect(authRows[0].ok).toBe(true);
      for (const role of ["anon", "service_role"]) {
        const { rows } = await db.query(
          `select has_function_privilege('${role}', 'public.${fn}'::regprocedure, 'EXECUTE') as ok;`,
        );
        expect(rows[0].ok).toBe(false);
      }
    }
  });

  it60("negative case: a selective GRANT alone does NOT revoke an already-effective broad privilege", async () => {
    // Simulate the Supabase default: a fresh table lands with ALL
    // granted to authenticated.
    await db.exec(`
      create table scratch_default_privs (id int);
      grant all on scratch_default_privs to authenticated;
    `);
    // A naive migration that only grants SELECT would leave INSERT
    // effective — the grant does not remove the broad privilege.
    await db.exec(`grant select on scratch_default_privs to authenticated;`);
    const { rows } = await db.query(
      `select has_table_privilege('authenticated', 'public.scratch_default_privs', 'INSERT') as ok;`,
    );
    expect(rows[0].ok).toBe(true);
    // The shipped migration's explicit REVOKEs are what remove it:
    // the real tables prove the difference.
    const { rows: realRows } = await db.query(
      `select has_table_privilege('authenticated', 'public.forge_work_permit_annotations', 'INSERT') as ok;`,
    );
    expect(realRows[0].ok).toBe(false);
  });

  it60("the shipped migration text carries explicit REVOKEs for both tables and the RPCs", async () => {
    const sql = loadMigrationSql();
    expect(sql).toContain("revoke insert, update, delete, truncate, references, trigger on forge_work_permit_annotations from authenticated");
    expect(sql).toContain("revoke insert, update, delete, truncate, references, trigger on forge_work_permit_annotation_revisions from authenticated");
    expect(sql).toContain("revoke all on forge_work_permit_annotations from anon");
    expect(sql).toContain("revoke all on forge_work_permit_annotation_revisions from anon");
    expect(sql).toContain("revoke all on forge_work_permit_annotations from service_role");
    expect(sql).toContain("revoke all on forge_work_permit_annotation_revisions from service_role");
    expect(sql).toContain("revoke all on function public.forge_work_permit_annotation_create(text, text, text, text, text, text, text, text) from public");
    expect(sql).toContain("revoke all on function public.forge_work_permit_annotation_delete_drawing(text, text, text) from public");
    expect(sql).toContain("force row level security");
  });
});
