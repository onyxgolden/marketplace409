// D1 dashboard rebuild: the strip + scope chart read one summary of the
// already-loaded in-scope package array, so the chart slices must always
// add up to the strip totals. These tests pin that reconciliation, the
// null-cost rule, and the lifecycle ordering of the breakdown.
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_STATUS_ORDER,
  statusChartColor,
  summarizePlannerDashboard,
} from "./plannerDashboard.js";

const PKG = (overrides) => ({
  id: "wp_x",
  code: "WP-0000",
  title: "Test package",
  package_type: "remodel",
  priority: "normal",
  status: "draft",
  planned_start: null,
  planned_finish: null,
  percent_complete: 0,
  unit: null,
  area: null,
  system: null,
  property_id: null,
  mode: "commercial",
  planned_cost_cents: null,
  responsible_party: null,
  updated_at: "2026-10-01T00:00:00Z",
  forge_project_id: "proj_1",
  ...overrides,
});

describe("summarizePlannerDashboard", () => {
  it("summarizes an empty scope as zeros with an empty breakdown", () => {
    const summary = summarizePlannerDashboard([]);
    expect(summary.totalPackages).toBe(0);
    expect(summary.totalPlannedCostCents).toBe(0);
    expect(summary.hasPlannedCost).toBe(false);
    expect(summary.statusBreakdown).toEqual([]);
  });

  it("treats a non-array input as an empty scope", () => {
    expect(summarizePlannerDashboard(null).totalPackages).toBe(0);
    expect(summarizePlannerDashboard(undefined).statusBreakdown).toEqual([]);
  });

  it("totals packages and costs, and the slices reconcile to the strip", () => {
    const summary = summarizePlannerDashboard([
      PKG({ id: "wp_1", status: "draft", planned_cost_cents: 150000 }),
      PKG({ id: "wp_2", status: "in_progress", planned_cost_cents: null }),
      PKG({ id: "wp_3", status: "draft", planned_cost_cents: 25000 }),
      PKG({ id: "wp_4", status: "complete", planned_cost_cents: 50000 }),
    ]);
    expect(summary.totalPackages).toBe(4);
    expect(summary.totalPlannedCostCents).toBe(225000);
    expect(summary.hasPlannedCost).toBe(true);
    // Counts sum to the strip total; slice costs sum to the strip cost.
    expect(summary.statusBreakdown.reduce((sum, s) => sum + s.count, 0)).toBe(4);
    expect(summary.statusBreakdown.reduce((sum, s) => sum + s.costCents, 0)).toBe(225000);
    // Percents sum to 100.
    expect(summary.statusBreakdown.reduce((sum, s) => sum + s.percentOfTotal, 0)).toBeCloseTo(100, 6);
    // Lifecycle order, not frequency order: draft, in_progress, complete.
    expect(summary.statusBreakdown.map((s) => s.status)).toEqual(["draft", "in_progress", "complete"]);
    expect(summary.statusBreakdown[0]).toMatchObject({ count: 2, costCents: 175000, hasCost: true, percentOfTotal: 50 });
    expect(summary.statusBreakdown[1]).toMatchObject({ count: 1, costCents: 0, hasCost: false, percentOfTotal: 25 });
  });

  it("never reports a false $0.00 when no package carries a cost yet", () => {
    const summary = summarizePlannerDashboard([
      PKG({ status: "draft", planned_cost_cents: null }),
      PKG({ status: "draft", planned_cost_cents: null }),
    ]);
    expect(summary.totalPlannedCostCents).toBe(0);
    expect(summary.hasPlannedCost).toBe(false);
    expect(summary.statusBreakdown).toEqual([
      { status: "draft", count: 2, costCents: 0, hasCost: false, percentOfTotal: 100 },
    ]);
  });

  it("counts an unknown status instead of dropping it, sorted last", () => {
    const summary = summarizePlannerDashboard([
      PKG({ status: "draft" }),
      PKG({ status: "not_a_real_status" }),
    ]);
    expect(summary.totalPackages).toBe(2);
    expect(summary.statusBreakdown.map((s) => s.status)).toEqual(["draft", "not_a_real_status"]);
  });

  it("gives every lifecycle status a chart color", () => {
    for (const status of DASHBOARD_STATUS_ORDER) {
      expect(statusChartColor(status)).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(statusChartColor("not_a_real_status")).toBe("#94a3b8");
  });
});
