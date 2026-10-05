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
    // EAC identity: actuals + ETC.
    expect(sql).toMatch(/eac_cost[\s\S]*?actual_cost \+ NEW\.etc_cost/i);
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
