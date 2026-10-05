import { describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path";
const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261004010000_forge_work_management_rung4.sql"), "utf8");

describe("rung4 scheduling migration — reviewer findings (PR #549)", () => {
  it("references real packages and baseline versions via foreign keys", () => {
    // Reviewer finding 5: direct inserts of fabricated rows are rejected.
    expect(sql).toMatch(/forge_work_progress_snapshots_package_fk[\s\S]*?references forge_work_packages\s*\(\s*owner_id\s*,\s*id\s*\)/i);
    expect(sql).toMatch(/forge_work_progress_snapshots_baseline_fk[\s\S]*?references forge_work_package_baselines\s*\(\s*owner_id\s*,\s*package_id\s*,\s*version_number\s*\)/i);
    expect(sql).toMatch(/forge_work_package_baselines_package_fk[\s\S]*?references forge_work_packages/i);
    expect(sql).toMatch(/forge_work_manpower_days_package_fk[\s\S]*?references forge_work_packages/i);
    expect(sql).toMatch(/forge_work_weekly_commitments_package_fk[\s\S]*?references forge_work_packages/i);
  });

  it("verifies snapshot derived fields at the write boundary", () => {
    // Reviewer finding 5: earned value must be consistent with the named baseline.
    expect(sql).toMatch(/create trigger forge_work_progress_snapshots_verify_trg/i);
    expect(sql).toMatch(/before insert on forge_work_progress_snapshots/i);
    expect(sql).toMatch(/earned_hours[\s\S]*?earned_pct \/ 100[\s\S]*?baseline_hours/i);
    expect(sql).toMatch(/earned_cost[\s\S]*?earned_pct \/ 100[\s\S]*?baseline_cost/i);
    // Planned % is derived from the frozen schedule (reviewer finding 4).
    expect(sql).toMatch(/status_date <= v_baseline_start/);
    expect(sql).toMatch(/planned_pct[\s\S]*?does not match frozen schedule/i);
  });

  it("stamps the authenticated caller at the database boundary", () => {
    // Reviewer finding 1 (re-review): NOT NULL cannot authenticate an
    // identity — the trigger overwrites attribution from auth.uid() (the
    // authenticated PostgREST caller) and fails closed without one. No
    // payload value is trusted; no cross-request session state is used.
    expect(sql).toMatch(/create or replace function forge_work_stamp_actor\(\)/i);
    expect(sql).toMatch(/auth\.uid\(\)::text/);
    expect(sql).toMatch(/missing authenticated identity/);
    expect(sql).toMatch(/NEW\.frozen_by := v_actor/);
    expect(sql).toMatch(/NEW\.recorded_by := v_actor/);
    expect(sql).toMatch(/forge_work_package_baselines_stamp_actor_trg/);
    expect(sql).toMatch(/forge_work_progress_snapshots_stamp_actor_trg/);
    expect(sql).toMatch(/forge_work_weekly_commitments_stamp_actor_trg/);
    expect(sql).toMatch(/forge_work_manpower_days_stamp_actor_trg/);
    expect(sql).not.toMatch(/forge_work_set_actor/);
  });

  it("preserves creation identity on mutable tables", () => {
    expect(sql).toMatch(/create or replace function forge_work_preserve_actor\(\)/i);
    expect(sql).toMatch(/NEW\.recorded_by := OLD\.recorded_by/);
    expect(sql).toMatch(/forge_work_weekly_commitments_preserve_actor_trg/);
    expect(sql).toMatch(/forge_work_manpower_days_preserve_actor_trg/);
  });

  it("recomputes forecasts with engine semantics and rejects nulls", () => {
    // Reviewer finding 2 (re-review): ETC/EAC are derived, never supplied.
    expect(sql).toMatch(/forecast fields \(etc\/eac hours\/cost\) are required/);
    expect(sql).toMatch(/v_remaining_cost := v_baseline_cost - NEW\.earned_cost/);
    expect(sql).toMatch(/v_etc_cost := v_remaining_cost \/ \(NEW\.earned_cost \/ NEW\.actual_cost\)/);
    expect(sql).toMatch(/snapshot etc_cost % inconsistent with engine forecast/);
    expect(sql).toMatch(/snapshot eac_cost inconsistent with actual_cost \+ forecast etc_cost/);
  });

  it("has no silent 'system' attribution default", () => {
    // Reviewer finding 1: attribution is the authenticated actor, always present.
    expect(sql).not.toMatch(/default 'system'/);
    expect(sql).toMatch(/recorded_by text not null,/);
  });

  it("keeps baselines immutable and snapshots append-only", () => {
    expect(sql).toMatch(/forge_work_package_baselines_immutable_trg/);
    expect(sql).toMatch(/forge_work_progress_snapshots_immutable_trg/);
    expect(sql).toMatch(/before update or delete on forge_work_package_baselines/);
    expect(sql).toMatch(/before update or delete on forge_work_progress_snapshots/);
  });
});
