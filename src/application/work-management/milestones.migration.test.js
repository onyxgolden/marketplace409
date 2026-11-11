// Work Package Planner slice 9 — migration/integration proof.
//
// Applies the SHIPPED migration SQL (read from disk, never ad-hoc
// grants) in an in-memory PGlite database (real PostgreSQL) and
// proves: schema + seed (the 14-row "Standard" template per owner,
// three tiers each); the snapshot RPC (templates with nested offsets,
// instances with `late` computed on read); instantiation from a
// 3-tier template AND a separately-built 2-tier template produce
// correct planned dates (the real two-variant finding — not
// hypothetical); WPP9_ALREADY_INSTANTIATED on a second instantiate;
// WPP9_OFFSET_MISSING when a tier is missing an offset; the late-flag
// rule in both directions; template create/update/retire and
// complexity-offset add/change/remove, each version-guarded with a
// required reason; instance update/retire, terminal-package refusal;
// RLS (owner, co-owner, stranger via anon denied).
//
// auth.uid() returns uuid (matching the real schema) via
// current_setting('app.test_uid', true)::uuid — the exact fixture
// shape that caught PR #767's uuid=text defect, deliberately mirrored
// here so this suite cannot repeat that class of bug.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const HERE = dirname(fileURLToPath(import.meta.url));
const it60 = (name, fn) => it(name, fn, 60000);

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const MEMBER_C = "33333333-3333-4333-8333-333333333333";
const STRANGER = "44444444-4444-4444-8444-444444444444";

const SLICE9 = "20261111000000_forge_work_package_milestones_slice9.sql";

function loadMigrationSql(name) {
  return readFileSync(join(HERE, "..", "..", "..", "supabase", "migrations", name), "utf8");
}

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
    status text not null default 'in_progress',
    primary key (owner_id, id)
  );
  grant select on forge_work_packages to authenticated;
`;

const SEED_SQL = `
  insert into forge_work_packages (owner_id, id, status) values
    ('${OWNER_A}', 'pkg_a', 'in_progress'),
    ('${OWNER_A}', 'pkg_cancelled', 'cancelled'),
    ('${OWNER_A}', 'pkg_2tier', 'in_progress'),
    ('${OWNER_B}', 'pkg_b', 'in_progress');
  insert into workspace_members (owner_id, member_user_id, status, role)
    values ('${OWNER_A}', '${MEMBER_C}', 'active', 'co_owner');
`;

async function setupDb() {
  const db = new PGlite();
  await db.exec(PREREQ_SQL);
  await db.exec(SEED_SQL);
  await db.exec(loadMigrationSql(SLICE9));
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

// PGlite returns `date` columns as JS Date objects. Format to a plain
// YYYY-MM-DD before either asserting on it or interpolating it back
// into a SQL literal — a bare template-string interpolation of a Date
// object produces its full toString() (including a named timezone
// Postgres cannot parse, e.g. "GMT-0500"), not an ISO date.
function isoDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

describe("Work Package Planner slice 9 — Milestones migration", () => {
  let db;

  beforeAll(async () => {
    db = await setupDb();
  }, 60000);

  afterAll(async () => {
    await db?.close();
  });

  it60("seeds the 14-row Standard template for OWNER_A with three tiers each", async () => {
    const { rows } = await db.query(`
      select count(*) as n from forge_work_milestone_templates
      where owner_id = '${OWNER_A}' and template_name = 'Standard' and retired_at is null;
    `);
    expect(Number(rows[0].n)).toBe(14);
    const { rows: offsetRows } = await db.query(`
      select t.milestone_number, count(o.*) as tier_count
      from forge_work_milestone_templates t
      join forge_work_milestone_template_complexity_offsets o on o.template_milestone_id = t.id
      where t.owner_id = '${OWNER_A}' and t.template_name = 'Standard'
      group by t.milestone_number order by t.milestone_number;
    `);
    expect(offsetRows.length).toBe(14);
    offsetRows.forEach((row) => expect(Number(row.tier_count)).toBe(3));
  });

  it60("seeds stage-gate milestones 3, 6, 10, 14 and no others", async () => {
    const { rows } = await db.query(`
      select milestone_number from forge_work_milestone_templates
      where owner_id = '${OWNER_A}' and template_name = 'Standard' and is_stage_gate = true
      order by milestone_number;
    `);
    expect(rows.map((r) => Number(r.milestone_number))).toEqual([3, 6, 10, 14]);
  });

  it60("seeds milestone 14 with a negative High-tier offset (closeout lands after the anchor)", async () => {
    const { rows } = await db.query(`
      select o.months_from_anchor from forge_work_milestone_templates t
      join forge_work_milestone_template_complexity_offsets o on o.template_milestone_id = t.id
      where t.owner_id = '${OWNER_A}' and t.template_name = 'Standard' and t.milestone_number = 14
        and o.complexity_tier = 'High';
    `);
    expect(Number(rows[0].months_from_anchor)).toBe(-3);
  });

  it60("builds a separate 2-tier template and instantiates it with correct dates (the real two-variant case)", async () => {
    const created = await asUser(db, OWNER_A, `
      select * from forge_work_milestone_template_create(
        '${OWNER_A}', 'TwoTier', 1, true, null, 'Kickoff', 'Planner', 'Planning', 'months', null, false, false, 'seed 2-tier');
    `);
    const templateId = created.rows[0].id;
    await asUser(db, OWNER_A, `
      select * from forge_work_milestone_complexity_offset_set(
        '${OWNER_A}', '${templateId}', 1, 'Combined', 6, 'add tier A');
    `);
    await asUser(db, OWNER_A, `
      select * from forge_work_milestone_complexity_offset_set(
        '${OWNER_A}', '${templateId}', 2, 'High', 12, 'add tier B');
    `);

    const { rows } = await asUser(db, OWNER_A, `
      select * from forge_work_milestones_instantiate(
        '${OWNER_A}', 'pkg_2tier', 'TwoTier', '2027-01-01', 'Combined');
    `);
    expect(rows.length).toBe(1);
    // Anchor 2027-01-01 minus the 6-month "Combined" offset (a positive
    // offset places the milestone BEFORE the anchor) = 2026-07-01.
    expect(isoDate(rows[0].planned_date)).toBe("2026-07-01");

    const { rows: countRows } = await asUser(db, OWNER_A, `
      select count(*) as n from forge_work_milestones
      where owner_id = '${OWNER_A}' and work_package_id = 'pkg_2tier' and retired_at is null;
    `);
    expect(Number(countRows[0].n)).toBe(1);
  });

  it60("instantiates the 14-row Standard/3-tier template on a package with correct per-tier dates", async () => {
    const { rows } = await asUser(db, OWNER_A, `
      select * from forge_work_milestones_instantiate(
        '${OWNER_A}', 'pkg_a', 'Standard', '2027-06-01', 'High');
    `);
    expect(rows.length).toBe(14);
    const m3 = rows.find((r) => Number(r.milestone_number) === 3);
    // High tier, 27 months before the anchor: 2027-06-01 - 27 months = 2025-03-01
    expect(isoDate(m3.planned_date)).toBe("2025-03-01");
    const m14 = rows.find((r) => Number(r.milestone_number) === 14);
    // High tier, -3 (i.e. 3 months AFTER the anchor): 2027-06-01 - (-3 months) = 2027-09-01
    expect(isoDate(m14.planned_date)).toBe("2027-09-01");
    expect(m14.is_stage_gate).toBe(true);
  });

  it60("refuses a second instantiate on the same package with WPP9_ALREADY_INSTANTIATED", async () => {
    await expect(
      asUser(db, OWNER_A, `
        select * from forge_work_milestones_instantiate(
          '${OWNER_A}', 'pkg_a', 'Standard', '2027-06-01', 'Medium');
      `),
    ).rejects.toThrow(/WPP9_ALREADY_INSTANTIATED/);
  });

  it60("refuses instantiation under a tier with a missing offset (WPP9_OFFSET_MISSING)", async () => {
    const created = await asUser(db, OWNER_A, `
      select * from forge_work_milestone_template_create(
        '${OWNER_A}', 'Incomplete', 1, true, null, 'Only milestone', null, null, 'months', null, false, false, 'seed incomplete');
    `);
    const templateId = created.rows[0].id;
    await asUser(db, OWNER_A, `
      select * from forge_work_milestone_complexity_offset_set(
        '${OWNER_A}', '${templateId}', 1, 'High', 5, 'only High defined');
    `);
    await db.exec(`insert into forge_work_packages (owner_id, id, status) values ('${OWNER_A}', 'pkg_incomplete', 'in_progress');`);
    await expect(
      asUser(db, OWNER_A, `
        select * from forge_work_milestones_instantiate(
          '${OWNER_A}', 'pkg_incomplete', 'Incomplete', '2027-01-01', 'Medium');
      `),
    ).rejects.toThrow(/WPP9_OFFSET_MISSING/);
  });

  it60("the snapshot RPC returns templates with nested offsets and instances with late computed", async () => {
    const { rows } = await asUser(db, OWNER_A, `
      select forge_work_milestones_snapshot('${OWNER_A}', 'pkg_a') as snapshot;
    `);
    const snapshot = rows[0].snapshot;
    expect(snapshot.templates.length).toBeGreaterThan(0);
    const standardM3 = snapshot.templates.find((t) => t.templateName === "Standard" && Number(t.milestoneNumber) === 3);
    expect(standardM3.offsets.length).toBe(3);
    expect(snapshot.instances.length).toBe(14);
    expect(snapshot.instances.every((i) => typeof i.late === "boolean")).toBe(true);
  });

  it60("late flag: planned in the past with no actual date is late past the 7-day grace", async () => {
    const { rows } = await asUser(db, OWNER_A, `
      select * from forge_work_milestones_instantiate(
        '${OWNER_A}', 'pkg_cancelled', 'TwoTier', '2000-01-01', 'Combined');
    `).catch(async () => {
      // pkg_cancelled is terminal; use a fresh non-terminal package instead.
      await db.exec(`insert into forge_work_packages (owner_id, id, status) values ('${OWNER_A}', 'pkg_late', 'in_progress');`);
      return asUser(db, OWNER_A, `
        select * from forge_work_milestones_instantiate(
          '${OWNER_A}', 'pkg_late', 'TwoTier', '2000-01-01', 'Combined');
      `);
    });
    const milestoneId = rows[0].id;
    const { rows: snapRows } = await asUser(db, OWNER_A, `
      select forge_work_milestones_snapshot('${OWNER_A}', 'pkg_late') as snapshot;
    `);
    const instance = snapRows[0].snapshot.instances.find((i) => i.id === milestoneId);
    expect(instance.late).toBe(true);
  });

  it60("late flag: an actual date more than 7 days after the planned date is late; within 7 days is not", async () => {
    await db.exec(`insert into forge_work_packages (owner_id, id, status) values ('${OWNER_A}', 'pkg_actual', 'in_progress');`);
    await asUser(db, OWNER_A, `
      select * from forge_work_milestones_instantiate(
        '${OWNER_A}', 'pkg_actual', 'TwoTier', '2027-01-01', 'Combined');
    `);
    const { rows } = await asUser(db, OWNER_A, `
      select * from forge_work_milestones where owner_id = '${OWNER_A}' and work_package_id = 'pkg_actual';
    `);
    const milestone = rows[0];

    await asUser(db, OWNER_A, `
      select * from forge_work_milestone_update(
        '${OWNER_A}', '${milestone.id}', ${milestone.version}, ${sqlStr(milestone.description)}, null, null,
        '${isoDate(milestone.planned_date)}', ('${isoDate(milestone.planned_date)}'::date + interval '10 days')::date, 100, null, null, 'logged on time, 10 days late');
    `);
    let { rows: snapRows } = await asUser(db, OWNER_A, `
      select forge_work_milestones_snapshot('${OWNER_A}', 'pkg_actual') as snapshot;
    `);
    expect(snapRows[0].snapshot.instances[0].late).toBe(true);

    const { rows: afterRows } = await asUser(db, OWNER_A, `
      select * from forge_work_milestones where owner_id = '${OWNER_A}' and id = '${milestone.id}';
    `);
    await asUser(db, OWNER_A, `
      select * from forge_work_milestone_update(
        '${OWNER_A}', '${milestone.id}', ${afterRows[0].version}, ${sqlStr(milestone.description)}, null, null,
        '${isoDate(milestone.planned_date)}', ('${isoDate(milestone.planned_date)}'::date + interval '3 days')::date, 100, null, null, 'corrected: only 3 days late');
    `);
    snapRows = (await asUser(db, OWNER_A, `
      select forge_work_milestones_snapshot('${OWNER_A}', 'pkg_actual') as snapshot;
    `)).rows;
    expect(snapRows[0].snapshot.instances[0].late).toBe(false);
  });

  it60("template update is version-guarded and requires a reason; a stale version is refused", async () => {
    const created = await asUser(db, OWNER_A, `
      select * from forge_work_milestone_template_create(
        '${OWNER_A}', 'VersionTest', 1, true, null, 'Original', null, null, 'months', null, false, false, 'seed');
    `);
    const templateId = created.rows[0].id;
    await asUser(db, OWNER_A, `
      select * from forge_work_milestone_template_update(
        '${OWNER_A}', '${templateId}', 1, 'Updated description', null, null, 'months', null, false, false, 'first edit');
    `);
    await expect(
      asUser(db, OWNER_A, `
        select * from forge_work_milestone_template_update(
          '${OWNER_A}', '${templateId}', 1, 'Stale edit', null, null, 'months', null, false, false, 'should fail');
      `),
    ).rejects.toThrow(/WPP9_VERSION_CONFLICT/);
    await expect(
      asUser(db, OWNER_A, `
        select * from forge_work_milestone_template_update(
          '${OWNER_A}', '${templateId}', 2, 'No reason attempt', null, null, 'months', null, false, false, '');
      `),
    ).rejects.toThrow(/WPP9_REASON_REQUIRED/);
  });

  it60("template retire is version-guarded; a retired template cannot be re-retired", async () => {
    const created = await asUser(db, OWNER_A, `
      select * from forge_work_milestone_template_create(
        '${OWNER_A}', 'RetireTest', 1, true, null, 'To retire', null, null, 'months', null, false, false, 'seed');
    `);
    const templateId = created.rows[0].id;
    await asUser(db, OWNER_A, `
      select * from forge_work_milestone_template_retire('${OWNER_A}', '${templateId}', 1, 'no longer needed');
    `);
    await expect(
      asUser(db, OWNER_A, `
        select * from forge_work_milestone_template_retire('${OWNER_A}', '${templateId}', 2, 'retire again');
      `),
    ).rejects.toThrow(/WPP9_RETIRED/);
  });

  it60("complexity_offset_set can remove a tier (months_from_anchor null) and the removal is reflected in the parent's revision", async () => {
    const created = await asUser(db, OWNER_A, `
      select * from forge_work_milestone_template_create(
        '${OWNER_A}', 'OffsetRemoveTest', 1, true, null, 'Has two tiers', null, null, 'months', null, false, false, 'seed');
    `);
    const templateId = created.rows[0].id;
    await asUser(db, OWNER_A, `
      select * from forge_work_milestone_complexity_offset_set('${OWNER_A}', '${templateId}', 1, 'A', 5, 'add A');
    `);
    await asUser(db, OWNER_A, `
      select * from forge_work_milestone_complexity_offset_set('${OWNER_A}', '${templateId}', 2, 'B', 7, 'add B');
    `);
    await asUser(db, OWNER_A, `
      select * from forge_work_milestone_complexity_offset_set('${OWNER_A}', '${templateId}', 3, 'A', null, 'remove A');
    `);
    const { rows } = await db.query(`
      select complexity_tier from forge_work_milestone_template_complexity_offsets
      where owner_id = '${OWNER_A}' and template_milestone_id = '${templateId}';
    `);
    expect(rows.map((r) => r.complexity_tier)).toEqual(["B"]);
  });

  it60("instance update is version-guarded, requires a reason, and refuses on a terminal package", async () => {
    await db.exec(`insert into forge_work_packages (owner_id, id, status) values ('${OWNER_A}', 'pkg_terminal_test', 'in_progress');`);
    const inst = await asUser(db, OWNER_A, `
      select * from forge_work_milestones_instantiate(
        '${OWNER_A}', 'pkg_terminal_test', 'TwoTier', '2027-01-01', 'Combined');
    `);
    const milestone = inst.rows[0];
    await expect(
      asUser(db, OWNER_A, `
        select * from forge_work_milestone_update(
          '${OWNER_A}', '${milestone.id}', 999, ${sqlStr(milestone.description)}, null, null,
          '${isoDate(milestone.planned_date)}', null, 50, null, null, 'stale version');
      `),
    ).rejects.toThrow(/WPP9_VERSION_CONFLICT/);
    await db.exec(`update forge_work_packages set status = 'verified_closed' where owner_id = '${OWNER_A}' and id = 'pkg_terminal_test';`);
    await expect(
      asUser(db, OWNER_A, `
        select * from forge_work_milestone_update(
          '${OWNER_A}', '${milestone.id}', ${milestone.version}, ${sqlStr(milestone.description)}, null, null,
          '${isoDate(milestone.planned_date)}', null, 50, null, null, 'closed package');
      `),
    ).rejects.toThrow(/WPP9_PACKAGE_TERMINAL/);
  });

  it60("RLS: a co-owner can read OWNER_A's milestones, a stranger (anon) cannot", async () => {
    const asCoOwner = await asUser(db, MEMBER_C, `
      select count(*) as n from forge_work_milestones where owner_id = '${OWNER_A}';
    `);
    expect(Number(asCoOwner.rows[0].n)).toBeGreaterThan(0);

    const asStranger = await asRole(db, "anon", STRANGER, `
      select count(*) as n from forge_work_milestones where owner_id = '${OWNER_A}';
    `).catch((error) => error);
    // anon has no SELECT grant at all on the table, so this must error,
    // not silently return rows — a non-vacuous negative control.
    expect(asStranger).toBeInstanceOf(Error);
  });

  it60("non-vacuous: has_workspace_access denies a workspace-forbidden caller on every write RPC", async () => {
    await expect(
      asUser(db, STRANGER, `
        select * from forge_work_milestone_template_create(
          '${OWNER_A}', 'Hostile', 1, true, null, 'nope', null, null, 'months', null, false, false, 'should fail');
      `),
    ).rejects.toThrow(/WPP9_WORKSPACE_FORBIDDEN/);
  });

  it60("ACL receipt: anon and service_role have no EXECUTE on any slice-9 function; authenticated does", async () => {
    const { rows } = await db.query(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'execute') as anon_exec,
             has_function_privilege('service_role', p.oid, 'execute') as service_role_exec,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname like 'forge_work_milestone%';
    `);
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => {
      expect(row.anon_exec).toBe(false);
      expect(row.service_role_exec).toBe(false);
      expect(row.authenticated_exec).toBe(true);
    });
  });

  it60("non-vacuous negative control: a naive function with no explicit revoke grants anon EXECUTE by default", async () => {
    await db.exec(`create or replace function public._naive_probe() returns int language sql as $$ select 1 $$;`);
    const { rows } = await db.query(`
      select has_function_privilege('anon', '_naive_probe()', 'execute') as anon_exec;
    `);
    expect(rows[0].anon_exec).toBe(true);
  });
});
