// D2b budget allocations — migration/integration proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) and
// proves:
//   - Schema: exactly the three new tables (allocations, lines,
//     revisions); one living allocation per package (partial unique
//     index); lines bound to the allocation's own package by a
//     composite FK; the five fixed categories only;
//   - Replace RPC: create then version-guarded replace, atomic
//     full-set save, exact reconciliation (short and over both
//     refused with no partial rows), stale estimate/allocation
//     versions refused, terminal-package and cross-owner refusal,
//     line validation (category, description, amount, count,
//     duplicate ids, foreign line ids), reason rules;
//   - Retire RPC: version-guarded, lines removed, header retired,
//     retire revision carries the complete old allocation; a fresh
//     create works after a retire;
//   - Revisions: create / replace / line-deletion / retire all
//     proven from the full old/new snapshots;
//   - Snapshot RPCs: single-package allocation snapshot, and the
//     bulk cost-split snapshot (per-package estimate, allocation,
//     category totals, reconciled boolean, missing/stale reasons;
//     500-id bound);
//   - RLS: owner isolation, co-owner access, anon sees nothing,
//     direct writes denied (RPC-only write path);
//   - Atomic audit: a failed mutation leaves no row and no revision;
//   - Effective ACL matrix for authenticated/anon/service_role, and
//     the default-privilege negative case.
// Roles, the auth.uid() stub, workspace_members, and the
// has_workspace_access() copy mirror production; the prerequisite
// packages and control-estimates tables are the minimal shapes the
// D2b foreign keys reference (mirroring the real 20261109010000
// slice-8 migration for the estimates table).
//
// A real-PostgreSQL subset (concurrent replaces serialized by the
// package row lock, ACL matrix, same-transaction audit rollback)
// runs against a scratch PG16 cluster when the binaries exist, and
// SKIPS LOUDLY — never silently — when they do not. PGlite is
// single-connection, so it cannot prove concurrent-edit
// serialization; that leg exists only on real PG.

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

const D2B = "20261121000000_forge_work_budget_allocations.sql";

function loadMigrationSql(name) {
  return readFileSync(join(HERE, "..", "..", "..", "supabase", "migrations", name), "utf8");
}

// Minimal prerequisite shape with the exact keys the D2b foreign keys
// reference, plus the status column the terminal-package rule reads
// and the planned_cost_cents column the no-legacy-write test reads.
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
          and role = 'co_owner'
      );
  $$;
  revoke all on function public.has_workspace_access(text) from public;
  grant execute on function public.has_workspace_access(text) to authenticated;
  create table forge_work_packages (
    owner_id text not null,
    id text not null,
    code text,
    title text,
    status text not null default 'in_progress',
    planned_cost_cents bigint,
    primary key (owner_id, id)
  );
  create table forge_work_control_estimates (
    owner_id text not null,
    id text not null,
    work_package_id text not null,
    original_control_estimate_cents bigint not null,
    current_estimate_cents bigint not null,
    contingency_cents bigint,
    version integer not null default 1,
    retired_at timestamptz,
    retired_by text,
    created_by text not null,
    updated_by text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (owner_id, id)
  );
  grant select on forge_work_packages to authenticated;
  grant select on forge_work_control_estimates to authenticated;
`;

const SEED_SQL = `
  insert into forge_work_packages (owner_id, id, code, title, status, planned_cost_cents) values
    ('${OWNER_A}', 'pkg_a', 'SYN-A', 'Synthetic exchanger [SYNTHETIC]', 'in_progress', 250000),
    ('${OWNER_A}', 'pkg_b', 'SYN-B', 'Synthetic pump [SYNTHETIC]', 'in_progress', 100000),
    ('${OWNER_A}', 'pkg_cancelled', 'SYN-C', 'Synthetic cancelled [SYNTHETIC]', 'cancelled', 100000),
    ('${OWNER_A}', 'pkg_closed', 'SYN-D', 'Synthetic closed [SYNTHETIC]', 'verified_closed', 100000),
    ('${OWNER_A}', 'pkg_noplan', 'SYN-E', 'Synthetic no estimate [SYNTHETIC]', 'in_progress', null),
    ('${OWNER_B}', 'pkg_b_owner', 'SYN-F', 'Synthetic other owner [SYNTHETIC]', 'in_progress', 50000);
  insert into forge_work_control_estimates
    (owner_id, id, work_package_id, original_control_estimate_cents, current_estimate_cents, contingency_cents, version, created_by, updated_by) values
    ('${OWNER_A}', 'est_a', 'pkg_a', 250000, 250000, null, 1, 'seed', 'seed'),
    ('${OWNER_A}', 'est_b', 'pkg_b', 100000, 100000, null, 1, 'seed', 'seed'),
    ('${OWNER_A}', 'est_cancelled', 'pkg_cancelled', 100000, 100000, null, 1, 'seed', 'seed'),
    ('${OWNER_A}', 'est_closed', 'pkg_closed', 100000, 100000, null, 1, 'seed', 'seed'),
    ('${OWNER_B}', 'est_b_owner', 'pkg_b_owner', 50000, 50000, null, 1, 'seed', 'seed');
  insert into workspace_members (owner_id, member_user_id, status, role)
    values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
`;

async function setupDb() {
  const db = new PGlite();
  await db.exec(PREREQ_SQL);
  await db.exec(loadMigrationSql(D2B));
  // Replay: the migration must be idempotent.
  await db.exec(loadMigrationSql(D2B));
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
  return `'${String(value).replace(/'/g, "''")}'`;
}

function linesJson(lines) {
  return sqlStr(JSON.stringify(lines));
}

const BALANCED_A = [
  { category: "labor", description: "Crew", amountCents: 100000 },
  { category: "material", description: "Pipe", amountCents: 80000 },
  { category: "equipment", description: "Crane", amountCents: 40000 },
  { category: "external_services", description: "Vendor", amountCents: 20000 },
  { category: "rental", description: "Scaffold", amountCents: 10000 },
];

async function replaceAlloc(db, uid, {
  ownerId = OWNER_A, packageId = "pkg_a", expectedVersion = 0,
  estimateId = "est_a", estimateVersion = 1, lines = BALANCED_A, reason = "First allocation",
} = {}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_budget_allocation_replace(
      ${sqlStr(ownerId)}, ${sqlStr(packageId)}, ${expectedVersion},
      ${sqlStr(estimateId)}, ${estimateVersion},
      ${linesJson(lines)}::jsonb, ${sqlStr(reason)});
  `);
  return rows[0].forge_work_budget_allocation_replace;
}

async function retireAlloc(db, uid, {
  ownerId = OWNER_A, packageId = "pkg_a", expectedVersion = 1, reason = "Wrong split",
} = {}) {
  const { rows } = await asUser(db, uid, `
    select * from forge_work_budget_allocation_retire(
      ${sqlStr(ownerId)}, ${sqlStr(packageId)}, ${expectedVersion}, ${sqlStr(reason)});
  `);
  return rows[0].forge_work_budget_allocation_retire;
}

async function snapshotAlloc(db, uid, { ownerId = OWNER_A, packageId = "pkg_a" } = {}) {
  const { rows } = await asUser(db, uid, `
    select forge_work_budget_allocation_snapshot(${sqlStr(ownerId)}, ${sqlStr(packageId)}) as snap;
  `);
  return rows[0].snap;
}

async function costSplit(db, uid, { ownerId = OWNER_A, packageIds = ["pkg_a"] } = {}) {
  const ids = packageIds.map((id) => sqlStr(id)).join(", ");
  const { rows } = await asUser(db, uid, `
    select forge_work_cost_split_snapshot(${sqlStr(ownerId)}, array[${ids}]) as row;
  `);
  return rows.map((r) => r.row);
}

async function allocRows(db, packageId, ownerId = OWNER_A) {
  const { rows } = await db.query(`
    select * from forge_work_budget_allocations
    where owner_id = '${ownerId}' and work_package_id = '${packageId}'
    order by created_at, id;
  `);
  return rows;
}

async function lineRows(db, allocationId, ownerId = OWNER_A) {
  const { rows } = await db.query(`
    select * from forge_work_budget_lines
    where owner_id = '${ownerId}' and allocation_id = '${allocationId}'
    order by sort_order, id;
  `);
  return rows;
}

async function revisionRows(db, allocationId, ownerId = OWNER_A) {
  const { rows } = await db.query(`
    select * from forge_work_budget_allocation_revisions
    where owner_id = '${ownerId}' and allocation_id = '${allocationId}'
    order by version, id;
  `);
  return rows;
}

async function packageRow(db, packageId, ownerId = OWNER_A) {
  const { rows } = await db.query(`
    select * from forge_work_packages where owner_id = '${ownerId}' and id = '${packageId}';
  `);
  return rows[0];
}

async function estimateRow(db, estimateId, ownerId = OWNER_A) {
  const { rows } = await db.query(`
    select * from forge_work_control_estimates where owner_id = '${ownerId}' and id = '${estimateId}';
  `);
  return rows[0];
}

describe("D2b migration: schema", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("creates exactly the three new tables and the four callable functions", async () => {
    const { rows } = await db.query(`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name like 'forge_work_budget%'
      order by table_name;
    `);
    expect(rows.map((r) => r.table_name)).toEqual([
      "forge_work_budget_allocation_revisions",
      "forge_work_budget_allocations",
      "forge_work_budget_lines",
    ]);
    const fns = await db.query(`
      select proname from pg_proc
      where proname like '%budget_allocat%' or proname like '%cost_split%'
        and pronamespace = 'public'::regnamespace
      order by proname;
    `);
    expect(fns.rows.map((r) => r.proname)).toEqual([
      "forge_work_budget_allocation_replace",
      "forge_work_budget_allocation_retire",
      "forge_work_budget_allocation_snapshot",
      "forge_work_cost_split_snapshot",
    ]);
  });

  it60("enforces one living allocation per package at the database level", async () => {
    await replaceAlloc(db, OWNER_A, {});
    await expect(db.query(`
      insert into forge_work_budget_allocations
        (owner_id, id, work_package_id, control_estimate_id, control_estimate_version,
         allocated_total_cents, version, created_by, updated_by)
      values ('${OWNER_A}', 'forge_wba_second', 'pkg_a', 'est_a', 1, 250000, 1, 'x', 'x');
    `)).rejects.toThrow(/duplicate key|unique/i);
  });

  it60("rejects a line category outside the five, and a zero or negative amount, at the database level", async () => {
    const saved = await replaceAlloc(db, OWNER_A, {});
    await expect(db.query(`
      insert into forge_work_budget_lines
        (owner_id, id, allocation_id, work_package_id, category, description, amount_cents, sort_order)
      values ('${OWNER_A}', 'forge_wbl_bad', '${saved.allocation.id}', 'pkg_a', 'craft', 'Crew', 100, 0);
    `)).rejects.toThrow(/check constraint/i);
    await expect(db.query(`
      insert into forge_work_budget_lines
        (owner_id, id, allocation_id, work_package_id, category, description, amount_cents, sort_order)
      values ('${OWNER_A}', 'forge_wbl_zero', '${saved.allocation.id}', 'pkg_a', 'labor', 'Crew', 0, 0);
    `)).rejects.toThrow(/check constraint/i);
  });

  it60("rejects a line whose package differs from its allocation's package (composite FK)", async () => {
    const saved = await replaceAlloc(db, OWNER_A, {});
    await expect(db.query(`
      insert into forge_work_budget_lines
        (owner_id, id, allocation_id, work_package_id, category, description, amount_cents, sort_order)
      values ('${OWNER_A}', 'forge_wbl_xpkg', '${saved.allocation.id}', 'pkg_b', 'labor', 'Crew', 100, 0);
    `)).rejects.toThrow(/violates foreign key/i);
  });
});

describe("D2b migration: replace RPC", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("creates a balanced allocation: version 1, lines stored, category totals returned, create revision with the full set", async () => {
    const saved = await replaceAlloc(db, OWNER_A, {});
    expect(saved.allocation.version).toBe(1);
    expect(saved.allocation.allocatedTotalCents).toBe(250000);
    expect(saved.allocation.controlEstimateId).toBe("est_a");
    expect(saved.allocation.controlEstimateVersion).toBe(1);
    expect(saved.categoryTotals).toEqual({
      labor: 100000, material: 80000, equipment: 40000, external_services: 20000, rental: 10000,
    });
    expect(saved.lines).toHaveLength(5);
    const lines = await lineRows(db, saved.allocation.id);
    expect(lines).toHaveLength(5);
    expect(lines.map((l) => l.category)).toEqual(["labor", "material", "equipment", "external_services", "rental"]);
    expect(lines.map((l) => l.sort_order)).toEqual([0, 1, 2, 3, 4]);
    const revisions = await revisionRows(db, saved.allocation.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].action).toBe("create");
    expect(revisions[0].version).toBe(1);
    expect(revisions[0].actor_id).toBe(OWNER_A);
    expect(revisions[0].reason).toBe("First allocation");
    expect(revisions[0].new_values.lines).toHaveLength(5);
    expect(revisions[0].new_values.allocatedTotalCents).toBe(250000);
    // Revision snapshots use the same camelCase line shape.
    expect(revisions[0].new_values.lines[0].amountCents).toBe(100000);
    expect(revisions[0].new_values.lines[0].sortOrder).toBe(0);
  });

  it60("replaces the set atomically: version 2, line deletion proven by the revision old/new snapshots", async () => {
    const created = await replaceAlloc(db, OWNER_A, {});
    const replaced = await replaceAlloc(db, OWNER_A, {
      expectedVersion: 1,
      lines: [
        { category: "labor", description: "Crew", amountCents: 150000 },
        { category: "material", description: "Pipe", amountCents: 100000 },
      ],
      reason: "Drop the small lines",
    });
    expect(replaced.allocation.version).toBe(2);
    expect(replaced.allocation.allocatedTotalCents).toBe(250000);
    expect(replaced.categoryTotals).toEqual({
      labor: 150000, material: 100000, equipment: 0, external_services: 0, rental: 0,
    });
    const lines = await lineRows(db, created.allocation.id);
    expect(lines).toHaveLength(2);
    const revisions = await revisionRows(db, created.allocation.id);
    expect(revisions).toHaveLength(2);
    expect(revisions[1].action).toBe("replace");
    expect(revisions[1].version).toBe(2);
    expect(revisions[1].old_values.lines).toHaveLength(5);
    expect(revisions[1].new_values.lines).toHaveLength(2);
    expect(revisions[1].old_values.allocatedTotalCents).toBe(250000);
  });

  it60("keeps submitted line ids stable across a replace and rejects a foreign line id", async () => {
    const created = await replaceAlloc(db, OWNER_A, {});
    const keptId = created.lines[0].id;
    const replaced = await replaceAlloc(db, OWNER_A, {
      expectedVersion: 1,
      lines: [
        { id: keptId, category: "labor", description: "Crew", amountCents: 150000 },
        { category: "material", description: "Pipe", amountCents: 100000 },
      ],
      reason: "Keep one line",
    });
    expect(replaced.lines.map((l) => l.id)).toContain(keptId);
    await expect(replaceAlloc(db, OWNER_A, {
      expectedVersion: 2,
      lines: [
        { id: "forge_wbl_someone_elses", category: "labor", description: "Crew", amountCents: 250000 },
      ],
      reason: "Foreign id",
    })).rejects.toThrow(/WPP2B_LINE_NOT_FOUND/);
  });

  it60("refuses a short set and an over set with no partial rows and no revision", async () => {
    await expect(replaceAlloc(db, OWNER_A, {
      lines: [{ category: "labor", description: "Crew", amountCents: 249999 }],
    })).rejects.toThrow(/WPP2B_SUM_MISMATCH/);
    await expect(replaceAlloc(db, OWNER_A, {
      lines: [{ category: "labor", description: "Crew", amountCents: 250001 }],
    })).rejects.toThrow(/WPP2B_SUM_MISMATCH/);
    expect(await allocRows(db, "pkg_a")).toHaveLength(0);
    const { rows } = await db.query(`select count(*)::int as n from forge_work_budget_allocation_revisions;`);
    expect(rows[0].n).toBe(0);
  });

  it60("refuses a stale estimate version and a stale allocation version", async () => {
    await expect(replaceAlloc(db, OWNER_A, { estimateVersion: 2 })).rejects.toThrow(/WPP2B_ESTIMATE_CONFLICT/);
    await expect(replaceAlloc(db, OWNER_A, { estimateId: "est_b" })).rejects.toThrow(/WPP2B_ESTIMATE_CONFLICT/);
    await replaceAlloc(db, OWNER_A, {});
    await expect(replaceAlloc(db, OWNER_A, {
      expectedVersion: 99,
      lines: [{ category: "labor", description: "Crew", amountCents: 250000 }],
      reason: "Stale",
    })).rejects.toThrow(/WPP2B_VERSION_CONFLICT/);
    await expect(replaceAlloc(db, OWNER_A, {
      expectedVersion: 0,
      lines: [{ category: "labor", description: "Crew", amountCents: 250000 }],
      reason: "Create over existing",
    })).rejects.toThrow(/WPP2B_VERSION_CONFLICT/);
    const rows = await allocRows(db, "pkg_a");
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(1);
  });

  it60("refuses terminal packages for replace and retire", async () => {
    for (const packageId of ["pkg_cancelled", "pkg_closed"]) {
      await expect(replaceAlloc(db, OWNER_A, {
        packageId,
        estimateId: packageId === "pkg_cancelled" ? "est_cancelled" : "est_closed",
      })).rejects.toThrow(/WPP2B_PACKAGE_TERMINAL/);
      await expect(retireAlloc(db, OWNER_A, { packageId })).rejects.toThrow(/WPP2B_PACKAGE_TERMINAL/);
    }
  });

  it60("refuses a cross-owner write and a missing package, and lets a co-owner replace", async () => {
    await expect(replaceAlloc(db, OWNER_B, {})).rejects.toThrow(/WPP2B_WORKSPACE_FORBIDDEN/);
    await expect(replaceAlloc(db, OWNER_A, { packageId: "pkg_missing" })).rejects.toThrow(/WPP2B_PACKAGE_NOT_FOUND/);
    const saved = await replaceAlloc(db, MEMBER_C, { reason: "Co-owner save" });
    expect(saved.allocation.version).toBe(1);
    const revisions = await revisionRows(db, saved.allocation.id);
    expect(revisions[0].actor_id).toBe(MEMBER_C);
  });

  it60("validates lines: category, description, amount, count, duplicate ids, reason", async () => {
    await expect(replaceAlloc(db, OWNER_A, {
      lines: [{ category: "craft", description: "Crew", amountCents: 250000 }],
    })).rejects.toThrow(/WPP2B_INVALID_CATEGORY/);
    await expect(replaceAlloc(db, OWNER_A, {
      lines: [{ category: "labor", description: "  ", amountCents: 250000 }],
    })).rejects.toThrow(/WPP2B_INVALID_DESCRIPTION/);
    await expect(replaceAlloc(db, OWNER_A, {
      lines: [{ category: "labor", description: "x".repeat(201), amountCents: 250000 }],
    })).rejects.toThrow(/WPP2B_INVALID_DESCRIPTION/);
    await expect(replaceAlloc(db, OWNER_A, {
      lines: [{ category: "labor", description: "<b>Crew</b>", amountCents: 250000 }],
    })).rejects.toThrow(/WPP2B_INVALID_DESCRIPTION/);
    await expect(replaceAlloc(db, OWNER_A, {
      lines: [{ category: "labor", description: "Crew", amountCents: 0 }],
    })).rejects.toThrow(/WPP2B_INVALID_AMOUNT/);
    await expect(replaceAlloc(db, OWNER_A, {
      lines: [{ category: "labor", description: "Crew", amountCents: -5 }],
    })).rejects.toThrow(/WPP2B_INVALID_AMOUNT/);
    await expect(replaceAlloc(db, OWNER_A, {
      lines: [{ category: "labor", description: "Crew", amountCents: 10.5 }],
    })).rejects.toThrow(/WPP2B_INVALID_AMOUNT/);
    const many = Array.from({ length: 101 }, (_, i) => ({ category: "labor", description: `L${i}`, amountCents: 1 }));
    await expect(replaceAlloc(db, OWNER_A, { lines: many })).rejects.toThrow(/WPP2B_TOO_MANY_LINES/);
    await expect(replaceAlloc(db, OWNER_A, {
      lines: [
        { id: "dup", category: "labor", description: "A", amountCents: 125000 },
        { id: "dup", category: "material", description: "B", amountCents: 125000 },
      ],
    })).rejects.toThrow(/WPP2B_DUPLICATE_LINE_ID/);
    await expect(replaceAlloc(db, OWNER_A, { reason: "   " })).rejects.toThrow(/WPP2B_REASON_REQUIRED/);
    await expect(replaceAlloc(db, OWNER_A, { reason: "x".repeat(1001) })).rejects.toThrow(/WPP2B_REASON_TOO_LONG/);
    // A failed validation leaves no allocation and no revision.
    expect(await allocRows(db, "pkg_a")).toHaveLength(0);
  });

  it60("accepts an empty line set only against a zero estimate", async () => {
    await db.query(`
      update forge_work_control_estimates set current_estimate_cents = 0
      where owner_id = '${OWNER_A}' and id = 'est_b';
    `);
    const saved = await replaceAlloc(db, OWNER_A, {
      packageId: "pkg_b", estimateId: "est_b",
      lines: [], reason: "Zero estimate",
    });
    expect(saved.allocation.allocatedTotalCents).toBe(0);
    expect(saved.lines).toHaveLength(0);
  });
});

describe("D2b migration: retire RPC", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("retires the header, removes the lines, and records the complete old allocation", async () => {
    const created = await replaceAlloc(db, OWNER_A, {});
    const retired = await retireAlloc(db, OWNER_A, { expectedVersion: 1 });
    expect(retired.retired).toBe(true);
    expect(retired.version).toBe(2);
    const rows = await allocRows(db, "pkg_a");
    expect(rows).toHaveLength(1);
    expect(rows[0].retired_at).not.toBeNull();
    expect(rows[0].version).toBe(2);
    expect(await lineRows(db, created.allocation.id)).toHaveLength(0);
    const revisions = await revisionRows(db, created.allocation.id);
    expect(revisions).toHaveLength(2);
    expect(revisions[1].action).toBe("retire");
    expect(revisions[1].version).toBe(2);
    expect(revisions[1].old_values.lines).toHaveLength(5);
    expect(revisions[1].new_values).toEqual({ retired: true });
  });

  it60("a fresh create works after a retire, with a new id at version 1", async () => {
    const created = await replaceAlloc(db, OWNER_A, {});
    await retireAlloc(db, OWNER_A, { expectedVersion: 1 });
    const fresh = await replaceAlloc(db, OWNER_A, { reason: "Replacement" });
    expect(fresh.allocation.id).not.toBe(created.allocation.id);
    expect(fresh.allocation.version).toBe(1);
    const rows = await allocRows(db, "pkg_a");
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.retired_at === null)).toHaveLength(1);
  });

  it60("refuses a retire with a stale version, a missing allocation, or no reason", async () => {
    await expect(retireAlloc(db, OWNER_A, {})).rejects.toThrow(/WPP2B_ALLOCATION_NOT_FOUND/);
    await replaceAlloc(db, OWNER_A, {});
    await expect(retireAlloc(db, OWNER_A, { expectedVersion: 99 })).rejects.toThrow(/WPP2B_VERSION_CONFLICT/);
    await expect(retireAlloc(db, OWNER_A, { reason: "" })).rejects.toThrow(/WPP2B_REASON_REQUIRED/);
    expect(await allocRows(db, "pkg_a")).toHaveLength(1);
  });
});

describe("D2b migration: snapshot RPCs", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("single-package snapshot returns the estimate, the allocation, and the lines in order", async () => {
    const created = await replaceAlloc(db, OWNER_A, {});
    const snap = await snapshotAlloc(db, OWNER_A, {});
    expect(snap.packageStatus).toBe("in_progress");
    expect(snap.estimate.id).toBe("est_a");
    expect(snap.estimate.currentEstimateCents).toBe(250000);
    expect(snap.allocation.id).toBe(created.allocation.id);
    expect(snap.allocation.controlEstimateId).toBe("est_a");
    expect(snap.allocation.controlEstimateVersion).toBe(1);
    expect(snap.allocation.allocatedTotalCents).toBe(250000);
    expect(snap.allocation.lines).toHaveLength(5);
    expect(snap.allocation.lines.map((l) => l.category)).toEqual([
      "labor", "material", "equipment", "external_services", "rental",
    ]);
    // The snapshot speaks the application's camelCase shape, never
    // raw snake_case column names.
    expect(snap.allocation.lines[0].amountCents).toBe(100000);
    expect(snap.allocation.lines[0].sortOrder).toBe(0);
    expect(snap.estimate.originalControlEstimateCents).toBe(250000);
  });

  it60("snapshot reads null allocation for an unallocated package and null estimate for a package without one", async () => {
    const unallocated = await snapshotAlloc(db, OWNER_A, {});
    expect(unallocated.estimate.id).toBe("est_a");
    expect(unallocated.allocation).toBeNull();
    const noplan = await snapshotAlloc(db, OWNER_A, { packageId: "pkg_noplan" });
    expect(noplan.estimate).toBeNull();
    expect(noplan.allocation).toBeNull();
  });

  it60("bulk snapshot reports reconciled, missing, stale, and no-estimate per package with category totals", async () => {
    await replaceAlloc(db, OWNER_A, {});
    // pkg_b: allocated, then the estimate moves — stale.
    await replaceAlloc(db, OWNER_A, {
      packageId: "pkg_b", estimateId: "est_b",
      lines: [
        { category: "labor", description: "Crew", amountCents: 60000 },
        { category: "material", description: "Pipe", amountCents: 40000 },
      ],
      reason: "pkg_b allocation",
    });
    await db.query(`
      update forge_work_control_estimates set version = 2
      where owner_id = '${OWNER_A}' and id = 'est_b';
    `);
    const rows = await costSplit(db, OWNER_A, { packageIds: ["pkg_a", "pkg_b", "pkg_noplan", "pkg_missing"] });
    expect(rows).toHaveLength(3);
    const byId = Object.fromEntries(rows.map((r) => [r.packageId, r]));
    expect(byId.pkg_a.reconciled).toBe(true);
    expect(byId.pkg_a.reason).toBeNull();
    expect(byId.pkg_a.estimate.currentEstimateCents).toBe(250000);
    expect(byId.pkg_a.allocation.categoryTotals).toEqual({
      labor: 100000, material: 80000, equipment: 40000, external_services: 20000, rental: 10000,
    });
    expect(byId.pkg_b.reconciled).toBe(false);
    expect(byId.pkg_b.reason).toBe("stale");
    expect(byId.pkg_b.allocation.categoryTotals.labor).toBe(60000);
    expect(byId.pkg_noplan.reconciled).toBe(false);
    expect(byId.pkg_noplan.reason).toBe("no_estimate");
    expect(byId.pkg_noplan.estimate).toBeNull();
    // A package id outside the workspace has no row at all.
    expect(byId.pkg_missing).toBeUndefined();
  });

  it60("bulk snapshot sums multiple lines in one category into that category's total", async () => {
    // pkg_b: two labor lines plus a material line — the category total
    // is the sum of the lines, never the count of them.
    await replaceAlloc(db, OWNER_A, {
      packageId: "pkg_b", estimateId: "est_b",
      lines: [
        { category: "labor", description: "Crew A", amountCents: 40000 },
        { category: "labor", description: "Crew B", amountCents: 20000 },
        { category: "material", description: "Pipe", amountCents: 30000 },
        { category: "equipment", description: "Crane", amountCents: 10000 },
      ],
      reason: "pkg_b multi-line",
    });
    const rows = await costSplit(db, OWNER_A, { packageIds: ["pkg_b"] });
    expect(rows).toHaveLength(1);
    expect(rows[0].reconciled).toBe(true);
    expect(rows[0].allocation.categoryTotals).toEqual({
      labor: 60000, material: 30000, equipment: 10000, external_services: 0, rental: 0,
    });
  });

  it60("bulk snapshot bounds input at 500 ids", async () => {
    const many = Array.from({ length: 501 }, (_, i) => `pkg_${i}`);
    await expect(costSplit(db, OWNER_A, { packageIds: many })).rejects.toThrow(/WPP2B_TOO_MANY_PACKAGES/);
    const exactly = Array.from({ length: 500 }, (_, i) => `pkg_${i}`);
    const rows = await costSplit(db, OWNER_A, { packageIds: exactly });
    expect(rows).toHaveLength(0);
  });

  it60("bulk snapshot refuses a cross-owner caller", async () => {
    await expect(costSplit(db, OWNER_B, { packageIds: ["pkg_a"] })).rejects.toThrow(/WPP2B_WORKSPACE_FORBIDDEN/);
  });
});

describe("D2b migration: RLS, ACL, and no legacy writes", () => {
  let db;
  beforeEach(async () => { db = await setupDb(); }, 60000);
  afterEach(async () => { await db?.close(); }, 60000);

  it60("RLS isolates owners, lets a co-owner read, and hides everything from anon", async () => {
    await replaceAlloc(db, OWNER_A, {});
    const other = await asUser(db, OWNER_B, `
      select count(*)::int as n from forge_work_budget_allocations;
    `);
    expect(other.rows[0].n).toBe(0);
    const coOwner = await asUser(db, MEMBER_C, `
      select count(*)::int as n from forge_work_budget_allocations;
    `);
    expect(coOwner.rows[0].n).toBe(1);
    // Anon holds no grant at all on the tables, so even the query is
    // refused — stronger than an empty result.
    await expect(asRole(db, "anon", OWNER_A, `
      select count(*)::int as n from forge_work_budget_allocations;
    `)).rejects.toThrow(/permission denied/);
    await expect(asRole(db, "anon", OWNER_A, `
      select count(*)::int as n from forge_work_budget_lines;
    `)).rejects.toThrow(/permission denied/);
  });

  it60("direct writes are denied for the app role (RPC-only write path)", async () => {
    await expect(asUser(db, OWNER_A, `
      insert into forge_work_budget_allocations
        (owner_id, id, work_package_id, control_estimate_id, control_estimate_version,
         allocated_total_cents, version, created_by, updated_by)
      values ('${OWNER_A}', 'forge_wba_direct', 'pkg_a', 'est_a', 1, 250000, 1, 'x', 'x');
    `)).rejects.toThrow(/permission denied|not allowed|policy/i);
    await replaceAlloc(db, OWNER_A, {});
    await expect(asUser(db, OWNER_A, `
      update forge_work_budget_allocations set allocated_total_cents = 1
      where owner_id = '${OWNER_A}';
    `)).rejects.toThrow(/permission denied|not allowed|policy/i);
    await expect(asUser(db, OWNER_A, `
      delete from forge_work_budget_allocations where owner_id = '${OWNER_A}';
    `)).rejects.toThrow(/permission denied|not allowed|policy/i);
  });

  it60("ACL matrix: authenticated SELECT-only on tables, EXECUTE-only on the four RPCs; anon and service_role get nothing", async () => {
    for (const table of [
      "forge_work_budget_allocations",
      "forge_work_budget_lines",
      "forge_work_budget_allocation_revisions",
    ]) {
      const { rows } = await db.query(`
        select grantee::regrole::text as role, privilege_type
        from pg_class c, aclexplode(c.relacl)
        where c.relname = '${table}' and c.relnamespace = 'public'::regnamespace;
      `);
      const byRole = {};
      for (const r of rows) (byRole[r.role] ??= []).push(r.privilege_type);
      expect(byRole.authenticated).toEqual(["SELECT"]);
      expect(byRole.anon ?? []).toEqual([]);
      expect(byRole.service_role ?? []).toEqual([]);
      expect(byRole.public ?? []).toEqual([]);
    }
    for (const fn of [
      "forge_work_budget_allocation_snapshot(text, text)",
      "forge_work_cost_split_snapshot(text, text[])",
      "forge_work_budget_allocation_replace(text, text, integer, text, integer, jsonb, text)",
      "forge_work_budget_allocation_retire(text, text, integer, text)",
    ]) {
      // Pronames are unique in this database (no overloads), so a
      // proname-only lookup is exact.
      const { rows } = await db.query(`
        select grantee::regrole::text as role, privilege_type
        from pg_proc p, aclexplode(p.proacl)
        where p.proname = split_part('${fn}', '(', 1)
          and p.pronamespace = 'public'::regnamespace;
      `);
      const byRole = {};
      for (const r of rows) (byRole[r.role] ??= []).push(r.privilege_type);
      expect(byRole.authenticated).toEqual(["EXECUTE"]);
      expect(byRole.anon ?? []).toEqual([]);
      expect(byRole.service_role ?? []).toEqual([]);
      expect(byRole.public ?? []).toEqual([]);
    }
  });

  it60("replace and retire never touch the legacy planned cost or the control estimate", async () => {
    const beforePkg = await packageRow(db, "pkg_a");
    const beforeEst = await estimateRow(db, "est_a");
    const created = await replaceAlloc(db, OWNER_A, {});
    await replaceAlloc(db, OWNER_A, {
      expectedVersion: 1,
      lines: [{ category: "labor", description: "Crew", amountCents: 250000 }],
      reason: "All labor",
    });
    await retireAlloc(db, OWNER_A, { expectedVersion: 2 });
    const afterPkg = await packageRow(db, "pkg_a");
    const afterEst = await estimateRow(db, "est_a");
    expect(afterPkg.planned_cost_cents).toBe(beforePkg.planned_cost_cents);
    expect(afterEst.current_estimate_cents).toBe(beforeEst.current_estimate_cents);
    expect(afterEst.version).toBe(beforeEst.version);
    expect(created.allocation.id).toBeTruthy();
  });

  it60("a failed replace leaves no version bump and no revision", async () => {
    const created = await replaceAlloc(db, OWNER_A, {});
    await expect(replaceAlloc(db, OWNER_A, {
      expectedVersion: 1,
      lines: [{ category: "labor", description: "Crew", amountCents: 1 }],
      reason: "Short",
    })).rejects.toThrow(/WPP2B_SUM_MISMATCH/);
    const rows = await allocRows(db, "pkg_a");
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(1);
    expect(rows[0].allocated_total_cents).toBe(250000);
    expect(await revisionRows(db, created.allocation.id)).toHaveLength(1);
    expect(await lineRows(db, created.allocation.id)).toHaveLength(5);
  });
});

// Real-PostgreSQL subset. PGlite is single-connection, so the
// concurrent-edit serialization leg can only run here, against a
// scratch PG16 cluster. The suite is gated on the binaries existing
// AND an unprivileged user to run the cluster as (initdb refuses
// root, and this VM's agent runs as root) — and SKIPS LOUDLY, never
// silently, when either is missing.
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

describe.skipIf(!HAS_REAL_PG)("D2b migration: real-PostgreSQL subset", () => {
  let pgDir;
  let pgClient;
  let pgCfg;

  beforeAll(async () => {
    pgDir = mkdtempSync(join(tmpdir(), "wpp2b-realpg-"));
    execSync(`chown ${PG_RUN_USER}:${PG_RUN_USER} "${pgDir}"`, { stdio: "pipe" });
    const asPgUser = (cmd) => `runuser -u ${PG_RUN_USER} -- ${cmd}`;
    execSync(asPgUser(`"${PG_BIN}/initdb" -D "${pgDir}" -U postgres --auth=trust`), { stdio: "pipe" });
    execSync(
      asPgUser(`"${PG_BIN}/pg_ctl" -D "${pgDir}" -o "-p 55435 -k ${pgDir} -c listen_addresses=''" -l "${pgDir}/server.log" start`),
      { stdio: "pipe" },
    );
    pgCfg = { host: pgDir, port: 55435, user: "postgres", database: "postgres" };
    pgClient = new Client(pgCfg);
    await pgClient.connect();
    await pgClient.query(PREREQ_SQL);
    await pgClient.query(`
      insert into forge_work_packages (owner_id, id, code, title, status, planned_cost_cents) values
        ('${OWNER_A}', 'pkg_real', 'SYN-R', 'Synthetic real PG [SYNTHETIC]', 'in_progress', 250000);
      insert into forge_work_control_estimates
        (owner_id, id, work_package_id, original_control_estimate_cents, current_estimate_cents, contingency_cents, version, created_by, updated_by) values
        ('${OWNER_A}', 'est_real', 'pkg_real', 250000, 250000, null, 1, 'seed', 'seed');
      insert into workspace_members (owner_id, member_user_id, status, role)
        values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
    `);
    await pgClient.query(loadMigrationSql(D2B));
  }, 120000);

  afterAll(async () => {
    try { await pgClient?.end(); } catch { /* already closed */ }
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

  it60("concurrent replaces on the same version: one wins, the other gets VERSION_CONFLICT", async () => {
    const { rows } = await pgAsUser(pgClient, OWNER_A, `
      select * from forge_work_budget_allocation_replace(
        '${OWNER_A}', 'pkg_real', 0, 'est_real', 1,
        '[{"category":"labor","description":"Crew","amountCents":250000}]'::jsonb, 'First');
    `);
    expect(rows[0].forge_work_budget_allocation_replace.allocation.version).toBe(1);
    const clientA = new Client(pgCfg);
    const clientB = new Client(pgCfg);
    await clientA.connect();
    await clientB.connect();
    try {
      const move = (client) => pgAsUser(client, OWNER_A, `
        select * from forge_work_budget_allocation_replace(
          '${OWNER_A}', 'pkg_real', 1, 'est_real', 1,
          '[{"category":"material","description":"Pipe","amountCents":250000}]'::jsonb, 'Race');
      `);
      const results = await Promise.allSettled([move(clientA), move(clientB)]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0].reason?.message ?? rejected[0].reason)).toMatch(/WPP2B_VERSION_CONFLICT/);
      const { rows: after } = await pgClient.query(`
        select version, allocated_total_cents from forge_work_budget_allocations
        where owner_id = '${OWNER_A}' and work_package_id = 'pkg_real' and retired_at is null;
      `);
      expect(after).toHaveLength(1);
      expect(after[0].version).toBe(2);
      expect(after[0].allocated_total_cents).toBe("250000");
    } finally {
      await clientA.end().catch(() => {});
      await clientB.end().catch(() => {});
    }
  });

  it60("ACL matrix on real PG: authenticated reads and executes, anon and service_role get nothing", async () => {
    for (const table of [
      "forge_work_budget_allocations",
      "forge_work_budget_lines",
      "forge_work_budget_allocation_revisions",
    ]) {
      const { rows } = await pgClient.query(`
        select has_table_privilege('authenticated', 'public.${table}', 'SELECT') as can_select,
               has_table_privilege('authenticated', 'public.${table}', 'INSERT') as can_insert,
               has_table_privilege('anon', 'public.${table}', 'SELECT') as anon_select,
               has_table_privilege('service_role', 'public.${table}', 'SELECT') as sr_select;
      `);
      expect(rows[0]).toEqual({ can_select: true, can_insert: false, anon_select: false, sr_select: false });
    }
    for (const fn of [
      "forge_work_budget_allocation_snapshot(text, text)",
      "forge_work_cost_split_snapshot(text, text[])",
      "forge_work_budget_allocation_replace(text, text, integer, text, integer, jsonb, text)",
      "forge_work_budget_allocation_retire(text, text, integer, text)",
    ]) {
      const { rows } = await pgClient.query(`
        select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') as auth_exec,
               has_function_privilege('anon', 'public.${fn}', 'EXECUTE') as anon_exec,
               has_function_privilege('service_role', 'public.${fn}', 'EXECUTE') as sr_exec;
      `);
      // PUBLIC is covered by the proacl assertion in the PGlite leg
      // (it is not a role, so has_function_privilege cannot take it).
      expect(rows[0]).toEqual({ auth_exec: true, anon_exec: false, sr_exec: false });
    }
  });

  it60("a failed replace on real PG leaves no revision and no version bump", async () => {
    await expect(pgAsUser(pgClient, OWNER_A, `
      select * from forge_work_budget_allocation_replace(
        '${OWNER_A}', 'pkg_real', 2, 'est_real', 1,
        '[{"category":"labor","description":"Crew","amountCents":1}]'::jsonb, 'Short');
    `)).rejects.toThrow(/WPP2B_SUM_MISMATCH/);
    const { rows } = await pgClient.query(`
      select version from forge_work_budget_allocations
      where owner_id = '${OWNER_A}' and work_package_id = 'pkg_real' and retired_at is null;
    `);
    expect(rows[0].version).toBe(2);
    const rev = await pgClient.query(`
      select count(*)::int as n from forge_work_budget_allocation_revisions;
    `);
    expect(rev.rows[0].n).toBe(2);
  });
});
