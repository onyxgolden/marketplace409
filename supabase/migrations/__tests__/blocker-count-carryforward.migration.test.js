// Carry-forward reconcile (PR #784 fix-round residual #1): the trial
// migration (20261113030000) and the field-verification migration
// (20261120000000) on main both carry PR #784's OLD blocker-count body.
// Both are file-only (not yet applied to prod — verified firsthand via
// sb-sql: neither version is recorded, and the live function still
// predates #784), but if either applies AFTER #784 merges, its CREATE
// OR REPLACE clobbers the fix round's two new arms (bust links, budget
// allocations) — the guard is safe (both versions carry it) and
// verification links are safe (the field-verif version counts ALL of
// them as blockers). This test proves each carrier's body, applied
// after the pre-#784 base, still counts both carried-forward arms:
// (1) a RETIRED change order with a surviving bust link still blocks
// naming bust_change_order_links, in any link soft state; (2) a
// RETIRED control estimate with a surviving budget allocation still
// blocks naming budget_allocations, in any allocation soft state;
// (3) ACTIVE parents block on their own arm only, with no redundant
// link/allocation arm; (4) the Planner entitlement guard still raises
// before any count is returned. The fix round's
// field_verification_change_order_links arm is deliberately NOT
// carried into the trial file: its table is created by the gated
// 20261120000000 migration, so the trial body must not reference it
// while that migration is unapplied — and the field-verif file's own
// all-links arm covers the case when it applies.

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const ORIGINAL_MIGRATION_PATH = new URL("../20261008030000_forge_work_package_deletions.sql", import.meta.url);
const BLOCKER_FIX_PATH = new URL("../20261110040000_forge_work_package_deletion_blocker_fix.sql", import.meta.url);
const STEP_CLEANUP_PATH = new URL("../20261110070000_forge_work_package_delete_retired_cleanup.sql", import.meta.url);
const RUNG1_PATH = new URL("../20261002120000_forge_work_management_rung1.sql", import.meta.url);
const TRIAL_PATH = new URL("../20261113030000_saas_trial_30day.sql", import.meta.url);
const FIELD_VERIF_PATH = new URL("../20261120000000_forge_work_field_verifications.sql", import.meta.url);

function extractFunction(sql, signature, endMarker = "$$;") {
  const start = sql.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(-1);
  return sql.slice(start, end + endMarker.length);
}

const originalMigrationSql = readFileSync(ORIGINAL_MIGRATION_PATH, "utf8");
const blockerFixSql = readFileSync(BLOCKER_FIX_PATH, "utf8");
const stepCleanupSql = readFileSync(STEP_CLEANUP_PATH, "utf8");
const rung1Sql = readFileSync(RUNG1_PATH, "utf8");
const nextNumberSql = extractFunction(
  rung1Sql,
  "create or replace function forge_work_next_package_number(p_owner_id text)",
);

const CARRIERS = [
  { label: "20261113030000 (trial)", path: TRIAL_PATH },
  { label: "20261120000000 (field verifications)", path: FIELD_VERIF_PATH },
];

// Fixture copied from the PR #784 fix-round test
// (20261111000000_...migration.test.js) — same minimal tables, roles,
// entitlement stub and RLS shape — plus the one table that fixture did
// not need: forge_work_field_verification_revisions, which the
// field-verification carrier's blocker body references.

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
  -- Fix-round stub for the Planner entitlement guard (real function in
  -- 20261113010000_saas_auth_pr1.sql): entitled unless a test flips the
  -- test.entitled setting off.
  create function forge_has_app_entitlement(p_owner_id text, p_app_key text)
  returns boolean language sql stable as $$
    select coalesce(current_setting('test.entitled', true), 'true') = 'true'
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

  create table forge_work_drawings (
    owner_id text not null, id text not null, package_id text not null,
    primary key (owner_id, id),
    unique (owner_id, package_id, id),
    foreign key (owner_id, package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_progress_entries (
    owner_id text not null, id text not null, work_package_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_steps (
    owner_id text not null, id text not null, work_package_id text not null,
    retired_at timestamptz,
    primary key (owner_id, id),
    unique (owner_id, work_package_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_step_order (
    owner_id text not null, work_package_id text not null,
    generation integer not null default 0,
    primary key (owner_id, work_package_id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_step_revisions (
    owner_id text not null, id text not null, step_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, step_id) references forge_work_steps (owner_id, id) on delete restrict);
  create table forge_work_step_drawing_links (
    owner_id text not null, id text not null, work_package_id text not null,
    step_id text not null, drawing_id text, retired_at timestamptz,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id, step_id)
      references forge_work_steps (owner_id, work_package_id, id) on delete restrict,
    foreign key (owner_id, work_package_id, drawing_id)
      references forge_work_drawings (owner_id, package_id, id) on delete restrict
  );
  create table forge_work_step_drawing_link_revisions (
    owner_id text not null, id text not null, link_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, link_id)
      references forge_work_step_drawing_links (owner_id, id) on delete restrict
  );

  -- The five types this migration fixes, each with the real retired_at
  -- column and the real revisions-table FK shape (ON DELETE RESTRICT).
  create table forge_work_permit_annotations (
    owner_id text not null, id text not null, work_package_id text not null,
    retired_at timestamptz,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_permit_annotation_revisions (
    owner_id text not null, id text not null, annotation_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, annotation_id) references forge_work_permit_annotations (owner_id, id) on delete restrict);

  create table forge_work_craft_assignments (
    owner_id text not null, id text not null, work_package_id text not null,
    retired_at timestamptz,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_craft_assignment_revisions (
    owner_id text not null, id text not null, assignment_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, assignment_id) references forge_work_craft_assignments (owner_id, id) on delete restrict);

  create table forge_work_control_estimates (
    owner_id text not null, id text not null, work_package_id text not null,
    retired_at timestamptz,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_control_estimate_revisions (
    owner_id text not null, id text not null, estimate_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, estimate_id) references forge_work_control_estimates (owner_id, id) on delete restrict);

  create table forge_work_change_orders (
    owner_id text not null, id text not null, work_package_id text not null,
    retired_at timestamptz,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_change_order_revisions (
    owner_id text not null, id text not null, change_order_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, change_order_id) references forge_work_change_orders (owner_id, id) on delete restrict);

  create table forge_work_craft_rates (
    owner_id text not null, id text not null, work_package_id text not null,
    retired_at timestamptz,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_craft_rate_revisions (
    owner_id text not null, id text not null, craft_rate_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, craft_rate_id) references forge_work_craft_rates (owner_id, id) on delete restrict);

  -- Fix round: the three additional RESTRICT referrers the original
  -- header missed (bust links + verification links reference change
  -- orders; budget allocations reference control estimates), with the
  -- real FK shape. All three are audit/history rows with no hard-delete
  -- path, so the fixture proves they keep blocking instead of purging.
  -- Minimal busts/verifications parents included only as FK targets.
  create table forge_work_package_busts (
    owner_id text not null, id text not null, work_package_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_package_bust_change_orders (
    owner_id text not null, id text not null, bust_id text not null,
    change_order_id text not null, unlinked_at timestamptz,
    primary key (owner_id, id),
    foreign key (owner_id, bust_id) references forge_work_package_busts (owner_id, id) on delete restrict,
    foreign key (owner_id, change_order_id) references forge_work_change_orders (owner_id, id) on delete restrict);
  create table forge_work_field_verifications (
    owner_id text not null, id text not null, work_package_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict);
  create table forge_work_field_verification_links (
    owner_id text not null, id text not null, verification_id text not null,
    work_package_id text not null, change_order_id text, retired_at timestamptz,
    primary key (owner_id, id),
    foreign key (owner_id, verification_id) references forge_work_field_verifications (owner_id, id) on delete restrict,
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict,
    foreign key (owner_id, change_order_id) references forge_work_change_orders (owner_id, id) on delete restrict);
  create table forge_work_field_verification_revisions (
    owner_id text not null, id text not null, verification_id text not null,
    primary key (owner_id, id),
    foreign key (owner_id, verification_id) references forge_work_field_verifications (owner_id, id) on delete restrict);

  create table forge_work_budget_allocations (
    owner_id text not null, id text not null, work_package_id text not null,
    control_estimate_id text not null, retired_at timestamptz,
    primary key (owner_id, id),
    foreign key (owner_id, work_package_id) references forge_work_packages (owner_id, id) on delete restrict,
    foreign key (owner_id, control_estimate_id) references forge_work_control_estimates (owner_id, id) on delete restrict);

  ${nextNumberSql}

  alter table forge_work_packages enable row level security;
  create policy forge_work_packages_workspace_select on forge_work_packages
    for select to authenticated using (has_workspace_access(owner_id));
  create policy forge_work_packages_workspace_insert on forge_work_packages
    for insert to authenticated with check (has_workspace_access(owner_id));
  create policy forge_work_packages_workspace_update on forge_work_packages
    for update to authenticated
    using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
  grant select, insert, update, delete on forge_work_packages to authenticated;
`;

function carrierSuite(label, carrierPath) {
  const carrierSql = readFileSync(carrierPath, "utf8");
  const carrierFnSql = extractFunction(
    carrierSql,
    "create or replace function public.forge_work_package_deletion_blocker_counts(",
  );

  let db;
  let seedCounter = 9000;

  async function query(sql) {
    const result = await db.query(sql);
    return result.rows;
  }

  async function asActor(actor, owners) {
    await db.exec(`select set_config('test.actor', '${actor}', false)`);
    await db.exec(`select set_config('test.owners', '${owners}', false)`);
  }

  async function asEntitled(entitled) {
    await db.exec(`select set_config('test.entitled', '${entitled ? "true" : "false"}', false)`);
  }

  async function seedPackage(ownerId) {
    seedCounter += 1;
    const id = `forge_wp_cf_${seedCounter}`;
    const code = `WP-CF-${seedCounter}`;
    await db.exec(`
      insert into forge_work_packages (owner_id, id, code, title, status, version)
      values ('${ownerId}', '${id}', '${code}', 'Carry-forward test ${seedCounter}', 'draft', 1)
    `);
    return { id, code, version: 1 };
  }

  async function callBlockers(ownerId, packageId) {
    const rows = await query(`
      select forge_work_package_deletion_blockers('${ownerId}', '${packageId}') as result
    `);
    return rows[0].result;
  }

  describe(`carry-forward: ${label} blocker body still counts the PR #784 fix-round arms`, () => {
    beforeAll(async () => {
      db = new PGlite();
      await db.exec(SETUP_SQL);
      await db.exec(originalMigrationSql);
      await db.exec(blockerFixSql);
      await db.exec(stepCleanupSql);
      await db.exec(carrierFnSql);
      await asActor("owner_1", "owner_1");
      await asEntitled(true);
    }, 60000);

    it("the extracted carrier body carries both fix-round arms (static guard against a stale span)", async () => {
      expect(carrierFnSql).toContain("select 'budget_allocations'");
      expect(carrierFnSql).toContain("select 'bust_change_order_links'");
    });

    it("retired change order + ACTIVE bust link: blocked naming bust_change_order_links", async () => {
      await asActor("owner_1", "owner_1");
      const pkg = await seedPackage("owner_1");
      const coId = `forge_cf_co_${pkg.id}`;
      await db.exec(`
        insert into forge_work_change_orders (owner_id, id, work_package_id, retired_at)
        values ('owner_1', '${coId}', '${pkg.id}', now());
        insert into forge_work_package_busts (owner_id, id, work_package_id)
        values ('owner_1', 'forge_cf_bust_${pkg.id}', '${pkg.id}');
        insert into forge_work_package_bust_change_orders (owner_id, id, bust_id, change_order_id)
        values ('owner_1', 'forge_cf_blink_${pkg.id}', 'forge_cf_bust_${pkg.id}', '${coId}');
      `);
      expect(await callBlockers("owner_1", pkg.id)).toEqual([
        { type: "bust_change_order_links", count: 1 },
      ]);
    });

    it("retired change order + UNLINKED bust link: still blocked (the FK fires on the history row too)", async () => {
      await asActor("owner_1", "owner_1");
      const pkg = await seedPackage("owner_1");
      const coId = `forge_cf_co_unl_${pkg.id}`;
      await db.exec(`
        insert into forge_work_change_orders (owner_id, id, work_package_id, retired_at)
        values ('owner_1', '${coId}', '${pkg.id}', now());
        insert into forge_work_package_busts (owner_id, id, work_package_id)
        values ('owner_1', 'forge_cf_bust_unl_${pkg.id}', '${pkg.id}');
        insert into forge_work_package_bust_change_orders (owner_id, id, bust_id, change_order_id, unlinked_at)
        values ('owner_1', 'forge_cf_blink_unl_${pkg.id}', 'forge_cf_bust_unl_${pkg.id}', '${coId}', now());
      `);
      expect(await callBlockers("owner_1", pkg.id)).toEqual([
        { type: "bust_change_order_links", count: 1 },
      ]);
    });

    it("retired control estimate + ACTIVE budget allocation: blocked naming budget_allocations", async () => {
      await asActor("owner_1", "owner_1");
      const pkg = await seedPackage("owner_1");
      const estId = `forge_cf_est_${pkg.id}`;
      await db.exec(`
        insert into forge_work_control_estimates (owner_id, id, work_package_id, retired_at)
        values ('owner_1', '${estId}', '${pkg.id}', now());
        insert into forge_work_budget_allocations (owner_id, id, work_package_id, control_estimate_id)
        values ('owner_1', 'forge_cf_alloc_${pkg.id}', '${pkg.id}', '${estId}');
      `);
      expect(await callBlockers("owner_1", pkg.id)).toEqual([
        { type: "budget_allocations", count: 1 },
      ]);
    });

    it("retired control estimate + RETIRED budget allocation: still blocked (the FK fires on the retired row too)", async () => {
      await asActor("owner_1", "owner_1");
      const pkg = await seedPackage("owner_1");
      const estId = `forge_cf_est_r_${pkg.id}`;
      await db.exec(`
        insert into forge_work_control_estimates (owner_id, id, work_package_id, retired_at)
        values ('owner_1', '${estId}', '${pkg.id}', now());
        insert into forge_work_budget_allocations (owner_id, id, work_package_id, control_estimate_id, retired_at)
        values ('owner_1', 'forge_cf_alloc_r_${pkg.id}', '${pkg.id}', '${estId}', now());
      `);
      expect(await callBlockers("owner_1", pkg.id)).toEqual([
        { type: "budget_allocations", count: 1 },
      ]);
    });

    it("ACTIVE change order + bust link: blocked by change_orders only (no redundant link arm)", async () => {
      await asActor("owner_1", "owner_1");
      const pkg = await seedPackage("owner_1");
      const coId = `forge_cf_co_act_${pkg.id}`;
      await db.exec(`
        insert into forge_work_change_orders (owner_id, id, work_package_id)
        values ('owner_1', '${coId}', '${pkg.id}');
        insert into forge_work_package_busts (owner_id, id, work_package_id)
        values ('owner_1', 'forge_cf_bust_act_${pkg.id}', '${pkg.id}');
        insert into forge_work_package_bust_change_orders (owner_id, id, bust_id, change_order_id)
        values ('owner_1', 'forge_cf_blink_act_${pkg.id}', 'forge_cf_bust_act_${pkg.id}', '${coId}');
      `);
      expect(await callBlockers("owner_1", pkg.id)).toEqual([
        { type: "change_orders", count: 1 },
      ]);
    });

    it("ACTIVE control estimate + allocation: blocked by control_estimates only (no redundant allocation arm)", async () => {
      await asActor("owner_1", "owner_1");
      const pkg = await seedPackage("owner_1");
      const estId = `forge_cf_est_act_${pkg.id}`;
      await db.exec(`
        insert into forge_work_control_estimates (owner_id, id, work_package_id)
        values ('owner_1', '${estId}', '${pkg.id}');
        insert into forge_work_budget_allocations (owner_id, id, work_package_id, control_estimate_id)
        values ('owner_1', 'forge_cf_alloc_act_${pkg.id}', '${pkg.id}', '${estId}');
      `);
      expect(await callBlockers("owner_1", pkg.id)).toEqual([
        { type: "control_estimates", count: 1 },
      ]);
    });

    it("without a Planner entitlement the blocker call raises FORGE_TRIAL_ENTITLEMENT_REQUIRED", async () => {
      await asActor("owner_1", "owner_1");
      await asEntitled(false);
      try {
        await expect(callBlockers("owner_1", "forge_wp_missing")).rejects.toThrow(
          "FORGE_TRIAL_ENTITLEMENT_REQUIRED",
        );
      } finally {
        await asEntitled(true);
      }
    });
  });
}

describe("blocker-count carry-forward (PR #784 fix-round residual #1)", () => {
  for (const carrier of CARRIERS) {
    carrierSuite(carrier.label, carrier.path);
  }
});
