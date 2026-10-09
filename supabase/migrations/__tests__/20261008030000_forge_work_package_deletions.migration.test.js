// D7 (Stage A) — work-package delete migration contract, executed against
// an in-process Postgres (PGlite). Minimal local fixture: the rung-1
// package/sequence shape, the rung-4 FKs (already in production), minimal
// child tables for every dependent class, and workspace RLS backed by a
// test has_workspace_access stub. No linked/remote database is touched.
//
// The migration is PREPARED for review only; applying it to production is
// Jason's separate Stage B approval. Production deletes additionally
// require Jason's disposable-package authorization.
//
// PGlite is single-connection, so true interleavings cannot be scheduled;
// the race tests below exercise the sequential equivalents (recheck after
// a child lands, second delete, FK backstop). The design's real guarantee
// is structural: the delete RPC locks the package row FOR UPDATE (as do
// all child-writing RPCs), and FK KEY SHARE locks conflict with it, so a
// racing child insert waits and then fails its FK check — never orphans.

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const MIGRATION_PATH = new URL("../20261008030000_forge_work_package_deletions.sql", import.meta.url);
const RUNG1_PATH = new URL("../20261002120000_forge_work_management_rung1.sql", import.meta.url);

function extractFunction(sql, signature, endMarker = "$$;") {
  const start = sql.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(-1);
  return sql.slice(start, end + endMarker.length);
}

const migrationSql = readFileSync(MIGRATION_PATH, "utf8");
const rung1Sql = readFileSync(RUNG1_PATH, "utf8");
const nextNumberSql = extractFunction(
  rung1Sql,
  "create or replace function forge_work_next_package_number(p_owner_id text)",
);

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

  create table forge_work_package_sequences (
    owner_id text primary key,
    last_number integer not null default 0,
    updated_at timestamptz not null default now()
  );

  create table forge_work_packages (
    owner_id text not null,
    id text not null,
    code text not null,
    title text not null,
    status text not null default 'draft',
    designated_verifier text,
    version integer not null default 1,
    updated_by text,
    updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, code)
  );

  -- Dependent classes (minimal shapes; package_id columns shipped without
  -- FKs except the rung-4 four, whose production FKs are mirrored here).
  create table forge_work_package_budget_revisions (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id));
  create table forge_work_package_transitions (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id));
  create table forge_work_gate_attestations (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id));
  create table forge_work_scope_baselines (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id));
  create table forge_work_scope_changes (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id));
  create table forge_work_inspection_observations (
    owner_id text not null, id text not null, package_id text,
    primary key (owner_id, id));
  create table forge_work_gate_evaluations (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id));
  create table forge_work_gate_overrides (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id));
  create table forge_work_links (
    owner_id text not null, id text not null,
    source_domain text not null, source_type text not null, source_id text not null,
    target_domain text not null, target_type text not null, target_id text not null,
    primary key (owner_id, id));
  create table forge_work_link_confirmations (
    owner_id text not null, id text not null, link_id text not null,
    primary key (owner_id, id));
  create table forge_work_package_baselines (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, package_id) references forge_work_packages (owner_id, id));
  create table forge_work_progress_snapshots (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, package_id) references forge_work_packages (owner_id, id));
  create table forge_work_weekly_commitments (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, package_id) references forge_work_packages (owner_id, id));
  create table forge_work_manpower_days (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, package_id) references forge_work_packages (owner_id, id));

  ${nextNumberSql}

  alter table forge_work_packages enable row level security;
  create policy forge_work_packages_workspace_select on forge_work_packages
    for select to authenticated using (has_workspace_access(owner_id));
  create policy forge_work_packages_workspace_insert on forge_work_packages
    for insert to authenticated with check (has_workspace_access(owner_id));
  create policy forge_work_packages_workspace_update on forge_work_packages
    for update to authenticated
    using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
  -- Simulate Supabase default table privileges (incl. DELETE) so the
  -- migration's revoke is exercised, not vacuous.
  grant select, insert, update, delete on forge_work_packages to authenticated;
`;

let db;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP_SQL);
  await db.exec(migrationSql);
  await asActor("owner_1", "owner_1");
}, 60000);

async function query(sql) {
  const result = await db.query(sql);
  return result.rows;
}

async function asActor(actor, owners) {
  await db.exec(`select set_config('test.actor', '${actor}', false)`);
  await db.exec(`select set_config('test.owners', '${owners}', false)`);
}

let seedCounter = 1000;
async function seedPackage(ownerId, overrides = {}) {
  seedCounter += 1;
  const id = overrides.id || `forge_wp_del_${seedCounter}`;
  const code = overrides.code || `WP-${seedCounter}`;
  const status = overrides.status || "draft";
  const version = overrides.version ?? 1;
  const verifier = overrides.designated_verifier || null;
  await db.exec(`
    insert into forge_work_packages (owner_id, id, code, title, status, version, designated_verifier)
    values ('${ownerId}', '${id}', '${code}', 'Delete test ${seedCounter}', '${status}', ${version},
            ${verifier ? `'${verifier}'` : "null"})
  `);
  return { id, code, version, status };
}

async function callDelete(ownerId, packageId, version, code) {
  const v = version === null ? "null" : String(version);
  const c = code === null ? "null" : `'${code}'`;
  const rows = await query(`
    select forge_work_delete_empty_draft_package('${ownerId}', '${packageId}', ${v}, ${c}) as result
  `);
  return rows[0].result;
}

async function callBlockers(ownerId, packageId) {
  const rows = await query(`
    select forge_work_package_deletion_blockers('${ownerId}', '${packageId}') as result
  `);
  return rows[0].result;
}

async function packageCount(id) {
  const rows = await query(`
    select count(*)::int as count from forge_work_packages where id = '${id}'
  `);
  return rows[0].count;
}

async function tombstoneCount(packageId) {
  const rows = await query(`
    select count(*)::int as count from forge_work_package_deletions where package_id = '${packageId}'
  `);
  return rows[0].count;
}

describe("migration: work-package deletions (D7, Stage A)", () => {
  it("creates an owner-scoped tombstone table, unique per package", async () => {
    const columns = await query(`
      select column_name from information_schema.columns
      where table_name = 'forge_work_package_deletions' order by column_name
    `);
    expect(columns.map((r) => r.column_name)).toEqual([
      "code", "deleted_at", "deleted_by", "id", "owner_id", "package_id",
      "package_version", "prior_status", "title",
    ]);
    await db.exec(`
      insert into forge_work_package_deletions
        (owner_id, package_id, code, title, prior_status, deleted_by)
      values ('owner_1', 'forge_wp_tomb_dup', 'WP-9001', 'Dup', 'draft', 'owner_1')
    `);
    await expect(db.exec(`
      insert into forge_work_package_deletions
        (owner_id, package_id, code, title, prior_status, deleted_by)
      values ('owner_1', 'forge_wp_tomb_dup', 'WP-9002', 'Dup again', 'draft', 'owner_1')
    `)).rejects.toThrow(/forge_work_package_deletions_package_unique/);
    await db.exec(`delete from forge_work_package_deletions where package_id = 'forge_wp_tomb_dup'`)
      .catch(() => {});
  });

  it("deletes an empty draft for the primary owner and writes the tombstone atomically", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    const result = await callDelete("owner_1", pkg.id, 1, pkg.code);
    expect(result.ok).toBe(true);
    expect(result.deletion).toMatchObject({
      package_id: pkg.id, code: pkg.code, prior_status: "draft",
    });
    expect(result.deletion.deleted_at).toBeTruthy();
    expect(await packageCount(pkg.id)).toBe(0);

    const tombstones = await query(`
      select code, title, prior_status, package_version, deleted_by
      from forge_work_package_deletions where package_id = '${pkg.id}'
    `);
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]).toMatchObject({
      code: pkg.code, prior_status: "draft", package_version: 1,
      deleted_by: "owner_1",
    });

    // Idempotency semantics: a second DELETE is 404, never false success.
    const second = await callDelete("owner_1", pkg.id, 1, pkg.code);
    expect(second).toEqual({ ok: false, error: "not_found" });
    expect(await tombstoneCount(pkg.id)).toBe(1);
  });

  it("never reuses a package code after deletion", async () => {
    await asActor("owner_seq", "owner_seq");
    const first = await query(`select forge_work_next_package_number('owner_seq') as code`);
    const code = first[0].code;
    const pkg = await seedPackage("owner_seq", { id: "forge_wp_seq", code });
    const result = await callDelete("owner_seq", pkg.id, 1, code);
    expect(result.ok).toBe(true);
    // The per-owner sequence only moves forward; the deleted code is gone.
    const second = await query(`select forge_work_next_package_number('owner_seq') as code`);
    expect(second[0].code).not.toBe(code);
    await asActor("owner_1", "owner_1");
  });

  it("denies direct DELETE on packages to authenticated clients", async () => {
    const pkg = await seedPackage("owner_1");
    await db.exec("set role authenticated");
    try {
      await asActor("owner_1", "owner_1");
      await expect(db.exec(`
        delete from forge_work_packages where owner_id = 'owner_1' and id = '${pkg.id}'
      `)).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
    expect(await packageCount(pkg.id)).toBe(1);
  });

  it("authorizes only the primary owner: member, verifier, outsider, anonymous", async () => {
    const pkg = await seedPackage("owner_1", { designated_verifier: "verifier_1" });

    await asActor("member_1", "owner_1");
    expect(await callDelete("owner_1", pkg.id, 1, pkg.code))
      .toEqual({ ok: false, error: "forbidden" });

    await asActor("verifier_1", "owner_1");
    expect(await callDelete("owner_1", pkg.id, 1, pkg.code))
      .toEqual({ ok: false, error: "forbidden" });

    // No workspace access: the package's existence is not revealed.
    await asActor("owner_9", "owner_9");
    expect(await callDelete("owner_1", pkg.id, 1, pkg.code))
      .toEqual({ ok: false, error: "not_found" });

    await asActor("", "owner_1");
    expect(await callDelete("owner_1", pkg.id, 1, pkg.code))
      .toEqual({ ok: false, error: "forbidden" });

    await asActor("owner_1", "owner_1");
    expect(await packageCount(pkg.id)).toBe(1);
    expect(await tombstoneCount(pkg.id)).toBe(0);
  });

  it("rejects non-draft packages with 409 semantics and keeps them", async () => {
    await asActor("owner_1", "owner_1");
    for (const status of ["planned", "readiness_review", "in_progress", "blocked", "cancelled", "verified_closed"]) {
      const pkg = await seedPackage("owner_1", { status });
      const result = await callDelete("owner_1", pkg.id, 1, pkg.code);
      expect(result).toEqual({ ok: false, error: "not_draft", status });
      expect(await packageCount(pkg.id)).toBe(1);
      expect(await tombstoneCount(pkg.id)).toBe(0);
    }
  });

  it("rejects stale version and mismatched/null confirmation code", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1", { version: 3 });
    expect(await callDelete("owner_1", pkg.id, 2, pkg.code))
      .toEqual({ ok: false, error: "version_conflict" });
    expect(await callDelete("owner_1", pkg.id, null, pkg.code))
      .toEqual({ ok: false, error: "version_conflict" });
    expect(await callDelete("owner_1", pkg.id, 3, "WP-9999"))
      .toEqual({ ok: false, error: "code_mismatch" });
    expect(await callDelete("owner_1", pkg.id, 3, null))
      .toEqual({ ok: false, error: "code_mismatch" });
    expect(await packageCount(pkg.id)).toBe(1);
    expect(await tombstoneCount(pkg.id)).toBe(0);
  });

  // Every dependency class blocks, with exact type + count, and the delete
  // RPC rechecks (the blocker list is never trusted from preflight alone).
  const BLOCKER_CASES = [
    ["budget_revisions", (id) => `insert into forge_work_package_budget_revisions (owner_id, id, package_id) values ('owner_1', 'forge_wpbr_${id}', '${id}')`],
    ["transitions", (id) => `insert into forge_work_package_transitions (owner_id, id, package_id) values ('owner_1', 'forge_wtr_${id}', '${id}')`],
    ["attestations", (id) => `insert into forge_work_gate_attestations (owner_id, id, package_id) values ('owner_1', 'forge_wga_${id}', '${id}')`],
    ["scope_baselines", (id) => `insert into forge_work_scope_baselines (owner_id, id, package_id) values ('owner_1', 'forge_wsb_${id}', '${id}')`],
    ["scope_changes", (id) => `insert into forge_work_scope_changes (owner_id, id, package_id) values ('owner_1', 'forge_wsc_${id}', '${id}')`],
    ["observations", (id) => `insert into forge_work_inspection_observations (owner_id, id, package_id) values ('owner_1', 'forge_wob_${id}', '${id}')`],
    ["gate_evaluations", (id) => `insert into forge_work_gate_evaluations (owner_id, id, package_id) values ('owner_1', 'forge_wge_${id}', '${id}')`],
    ["gate_overrides", (id) => `insert into forge_work_gate_overrides (owner_id, id, package_id) values ('owner_1', 'forge_wgo_${id}', '${id}')`],
    ["package_baselines", (id) => `insert into forge_work_package_baselines (owner_id, id, package_id) values ('owner_1', 'forge_wpb_${id}', '${id}')`],
    ["progress_snapshots", (id) => `insert into forge_work_progress_snapshots (owner_id, id, package_id) values ('owner_1', 'forge_wps_${id}', '${id}')`],
    ["weekly_commitments", (id) => `insert into forge_work_weekly_commitments (owner_id, id, package_id) values ('owner_1', 'forge_wwc_${id}', '${id}')`],
    ["manpower_days", (id) => `insert into forge_work_manpower_days (owner_id, id, package_id) values ('owner_1', 'forge_wmd_${id}', '${id}')`],
    ["links", (id) => `insert into forge_work_links (owner_id, id, source_domain, source_type, source_id, target_domain, target_type, target_id) values ('owner_1', 'forge_wlink_${id}', 'workmgmt', 'work_package', '${id}', 'designer', 'drawing', 'dwg_1')`],
    ["links", (id) => `insert into forge_work_links (owner_id, id, source_domain, source_type, source_id, target_domain, target_type, target_id) values ('owner_1', 'forge_wlink_${id}', 'rental', 'financial_event', 'evt_1', 'workmgmt', 'work_package', '${id}')`],
  ];

  for (const [type, insertSql] of BLOCKER_CASES) {
    it(`blocks deletion when a ${type} record exists`, async () => {
      await asActor("owner_1", "owner_1");
      const pkg = await seedPackage("owner_1");
      await db.exec(insertSql(pkg.id));

      const preflight = await callBlockers("owner_1", pkg.id);
      expect(preflight).toEqual([{ type, count: 1 }]);

      const result = await callDelete("owner_1", pkg.id, 1, pkg.code);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("blocked");
      expect(result.blockers).toEqual([{ type, count: 1 }]);
      expect(await packageCount(pkg.id)).toBe(1);
      expect(await tombstoneCount(pkg.id)).toBe(0);
    });
  }

  it("blocks on link confirmation history attached to the package's links", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    await db.exec(`
      insert into forge_work_links (owner_id, id, source_domain, source_type, source_id, target_domain, target_type, target_id)
      values ('owner_1', 'forge_wlink_conf', 'workmgmt', 'work_package', '${pkg.id}', 'designer', 'drawing', 'dwg_1');
      insert into forge_work_link_confirmations (owner_id, id, link_id)
      values ('owner_1', 'forge_wlconf_1', 'forge_wlink_conf');
    `);
    const result = await callDelete("owner_1", pkg.id, 1, pkg.code);
    expect(result.error).toBe("blocked");
    expect(result.blockers).toEqual(expect.arrayContaining([
      { type: "links", count: 1 },
      { type: "link_confirmations", count: 1 },
    ]));
    expect(await packageCount(pkg.id)).toBe(1);
  });

  it("rechecks at mutation time: a dependency landing after preflight blocks the delete", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    expect(await callBlockers("owner_1", pkg.id)).toEqual([]);
    // A concurrent writer's record lands between preflight and delete.
    await db.exec(`
      insert into forge_work_package_transitions (owner_id, id, package_id)
      values ('owner_1', 'forge_wtr_race', '${pkg.id}')
    `);
    const result = await callDelete("owner_1", pkg.id, 1, pkg.code);
    expect(result.error).toBe("blocked");
    expect(result.blockers).toEqual([{ type: "transitions", count: 1 }]);
    expect(await packageCount(pkg.id)).toBe(1);

    // Removing the record (the unlink-flow equivalent) unblocks it.
    await db.exec(`delete from forge_work_package_transitions where id = 'forge_wtr_race'`);
    const retry = await callDelete("owner_1", pkg.id, 1, pkg.code);
    expect(retry.ok).toBe(true);
    expect(await packageCount(pkg.id)).toBe(0);
  });

  it("preflight reveals blockers only to workspace members", async () => {
    const pkg = await seedPackage("owner_1");
    await db.exec(`
      insert into forge_work_package_budget_revisions (owner_id, id, package_id)
      values ('owner_1', 'forge_wpbr_pre', '${pkg.id}')
    `);
    await asActor("member_1", "owner_1");
    expect(await callBlockers("owner_1", pkg.id)).toEqual([{ type: "budget_revisions", count: 1 }]);
    await asActor("owner_9", "owner_9");
    expect(await callBlockers("owner_1", pkg.id)).toEqual([]);
    await asActor("", "owner_1");
    expect(await callBlockers("owner_1", pkg.id)).toEqual([]);
    await asActor("owner_1", "owner_1");
  });

  it("rolls back the tombstone when the package delete fails", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    await db.exec(`
      create function fail_package_delete()
      returns trigger language plpgsql as $$
      begin raise exception 'forced delete failure'; end
      $$;
      create trigger fail_package_delete_trg
        before delete on forge_work_packages
        for each row execute function fail_package_delete();
    `);
    try {
      await expect(callDelete("owner_1", pkg.id, 1, pkg.code))
        .rejects.toThrow(/forced delete failure/);
      expect(await packageCount(pkg.id)).toBe(1);
      expect(await tombstoneCount(pkg.id)).toBe(0);
    } finally {
      await db.exec(`
        drop trigger fail_package_delete_trg on forge_work_packages;
        drop function fail_package_delete();
      `);
    }
  });

  it("rolls back the package delete when the tombstone insert fails", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    await db.exec(`
      create function fail_tombstone_insert()
      returns trigger language plpgsql as $$
      begin raise exception 'forced tombstone failure'; end
      $$;
      create trigger fail_tombstone_insert_trg
        before insert on forge_work_package_deletions
        for each row execute function fail_tombstone_insert();
    `);
    try {
      await expect(callDelete("owner_1", pkg.id, 1, pkg.code))
        .rejects.toThrow(/forced tombstone failure/);
      expect(await packageCount(pkg.id)).toBe(1);
      expect(await tombstoneCount(pkg.id)).toBe(0);
    } finally {
      await db.exec(`
        drop trigger fail_tombstone_insert_trg on forge_work_package_deletions;
        drop function fail_tombstone_insert();
      `);
    }
  });

  it("enforces referential integrity: no orphans, no cascade", async () => {
    await asActor("owner_1", "owner_1");
    // Fabricated child rows for a nonexistent package are rejected.
    await expect(db.exec(`
      insert into forge_work_package_transitions (owner_id, id, package_id)
      values ('owner_1', 'forge_wtr_ghost', 'forge_wp_ghost')
    `)).rejects.toThrow(/forge_work_package_transitions_package_fk/);

    // A direct (non-RPC) delete of a package with history fails at the FK;
    // the row is never cascaded away.
    const pkg = await seedPackage("owner_1");
    await db.exec(`
      insert into forge_work_scope_baselines (owner_id, id, package_id)
      values ('owner_1', 'forge_wsb_block', '${pkg.id}');
      insert into forge_work_manpower_days (owner_id, id, package_id)
      values ('owner_1', 'forge_wmd_block', '${pkg.id}');
    `);
    await expect(db.exec(`
      delete from forge_work_packages where owner_id = 'owner_1' and id = '${pkg.id}'
    `)).rejects.toThrow(/foreign key|forge_work_.*_package_fk/);
    expect(await packageCount(pkg.id)).toBe(1);

    // After a package is deleted, new children referencing it are rejected.
    const empty = await seedPackage("owner_1");
    const gone = await callDelete("owner_1", empty.id, 1, empty.code);
    expect(gone.ok).toBe(true);
    await expect(db.exec(`
      insert into forge_work_gate_attestations (owner_id, id, package_id)
      values ('owner_1', 'forge_wga_late', '${empty.id}')
    `)).rejects.toThrow(/forge_work_gate_attestations_package_fk/);
  });

  it("fences the delete on the checked version: a mutation landing between validation and delete fails closed", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1", { version: 2 });
    // Test-only hook simulating a concurrent package mutation landing after
    // the RPC validated the row: when the tombstone insert fires (mutation
    // claim already in flight), the package version moves. The fenced
    // DELETE must then match 0 rows -> version_conflict, tombstone rolled
    // back, package untouched.
    await db.exec(`
      create function bump_version_at_tombstone()
      returns trigger language plpgsql as $$
      begin
        update forge_work_packages set version = version + 100
        where owner_id = NEW.owner_id and id = NEW.package_id;
        return NEW;
      end
      $$;
      create trigger bump_version_at_tombstone_trg
        before insert on forge_work_package_deletions
        for each row execute function bump_version_at_tombstone();
    `);
    try {
      const result = await callDelete("owner_1", pkg.id, 2, pkg.code);
      expect(result).toEqual({ ok: false, error: "version_conflict" });
      expect(await packageCount(pkg.id)).toBe(1);
      expect(await tombstoneCount(pkg.id)).toBe(0);
    } finally {
      await db.exec(`
        drop trigger bump_version_at_tombstone_trg on forge_work_package_deletions;
        drop function bump_version_at_tombstone();
      `);
    }
  });

  it("keeps tombstones owner-scoped and append-only for authenticated users", async () => {
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    const result = await callDelete("owner_1", pkg.id, 1, pkg.code);
    expect(result.ok).toBe(true);

    await db.exec("set role authenticated");
    try {
      await asActor("member_1", "owner_1");
      const visible = await query(`select count(*)::int as count from forge_work_package_deletions`);
      expect(visible[0].count).toBeGreaterThanOrEqual(1);

      await asActor("owner_9", "owner_9");
      expect(await query(`select count(*)::int as count from forge_work_package_deletions`))
        .toEqual([{ count: 0 }]);

      await asActor("owner_1", "owner_1");
      await expect(db.exec(`
        insert into forge_work_package_deletions
          (owner_id, package_id, code, title, prior_status, deleted_by)
        values ('owner_1', 'forge_wp_forged', 'WP-0001', 'Forged', 'draft', 'owner_1')
      `)).rejects.toThrow(/permission denied|row-level security/);
      await expect(db.exec(`
        update forge_work_package_deletions set title = 'rewritten'
        where package_id = '${pkg.id}'
      `)).rejects.toThrow(/permission denied|row-level security|append-only/);
      await expect(db.exec(`
        delete from forge_work_package_deletions where package_id = '${pkg.id}'
      `)).rejects.toThrow(/permission denied|row-level security|append-only/);
    } finally {
      await db.exec("reset role");
      await asActor("owner_1", "owner_1");
    }

    // Even the table owner cannot rewrite a tombstone (trigger-enforced).
    await expect(db.exec(`
      update forge_work_package_deletions set title = 'rewritten'
      where package_id = '${pkg.id}'
    `)).rejects.toThrow(/append-only/);
  });

  it("contains no cascading delete and re-applies idempotently", async () => {
    expect(migrationSql.toLowerCase()).not.toContain("on delete cascade");
    expect(migrationSql).toContain("revoke delete on forge_work_packages");
    await expect(db.exec(migrationSql)).resolves.toBeDefined();
    await asActor("owner_1", "owner_1");
    const pkg = await seedPackage("owner_1");
    const result = await callDelete("owner_1", pkg.id, 1, pkg.code);
    expect(result.ok).toBe(true);
  });
});
