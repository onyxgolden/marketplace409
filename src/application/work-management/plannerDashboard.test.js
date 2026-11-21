// D1 dashboard rebuild: the strip + scope chart read one summary of the
// already-loaded in-scope package array, so the chart slices must always
// add up to the strip totals. These tests pin that reconciliation, the
// null-cost rule, and the lifecycle ordering of the breakdown.
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_STATUS_ORDER,
  PROGRESS_DIMENSIONS,
  statusChartColor,
  summarizePlannerDashboard,
  summarizePlannerProgress,
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

describe("summarizePlannerProgress", () => {
  // Planning % here is the PDF credit-weighted % (computePlanningProgress
  // output), NOT the package percent_complete column (execution basis).
  // ids are wholly synthetic; planner names / units / systems invented.
  const PROGRESS_PKG = (overrides) => PKG({
    id: "wp_p",
    status: "draft",
    unit: "Unit A",
    system: "Exchanger",
    responsible_party: { display_name: "Planner Ada" },
    ...overrides,
  });
  const PLANNING = (percentComplete) => ({ percentComplete, initialized: true });

  it("summarizes an empty scope as zeros with empty group tables", () => {
    const summary = summarizePlannerProgress([], {});
    expect(summary.total).toMatchObject({
      packageCount: 0, completeCount: 0, percentComplete: null, hasPlanning: false,
      packagesWithPlanning: 0, packagesWithoutPlanning: 0, statusCounts: {},
    });
    expect(summary.bySystem).toEqual([]);
    expect(summary.byPlanner).toEqual([]);
    expect(summary.byUnit).toEqual([]);
  });

  it("treats a null planning map as no planning data (never a false 0%)", () => {
    const summary = summarizePlannerProgress([PROGRESS_PKG()], null);
    expect(summary.total.percentComplete).toBe(null);
    expect(summary.total.hasPlanning).toBe(false);
    expect(summary.total.packagesWithoutPlanning).toBe(1);
  });

  it("counts a package complete only at 100% planning, and means the %", () => {
    const summary = summarizePlannerProgress([
      PROGRESS_PKG({ id: "wp_1", status: "complete" }),
      PROGRESS_PKG({ id: "wp_2", status: "in_progress" }),
      PROGRESS_PKG({ id: "wp_3", status: "draft" }),
    ], {
      wp_1: PLANNING(100),
      wp_2: PLANNING(50),
      wp_3: PLANNING(0),
    });
    // Status complete alone does not earn the count: only the 100%
    // planning row is complete. The mean is (100 + 50 + 0) / 3 = 50.
    expect(summary.total).toMatchObject({ packageCount: 3, completeCount: 1, percentComplete: 50 });
    expect(summary.total.statusCounts).toEqual({ draft: 1, in_progress: 1, complete: 1 });
  });

  it("rounds the group mean to one decimal", () => {
    const summary = summarizePlannerProgress([
      PROGRESS_PKG({ id: "wp_1" }),
      PROGRESS_PKG({ id: "wp_2" }),
      PROGRESS_PKG({ id: "wp_3" }),
    ], { wp_1: PLANNING(100), wp_2: PLANNING(33), wp_3: PLANNING(0) });
    expect(summary.total.percentComplete).toBe(44.3);
  });

  it("excludes packages without trusted planning % from the mean and counts them", () => {
    const summary = summarizePlannerProgress([
      PROGRESS_PKG({ id: "wp_1" }),
      PROGRESS_PKG({ id: "wp_2" }),
      PROGRESS_PKG({ id: "wp_3" }),
    ], { wp_1: PLANNING(80), wp_2: null, wp_3: PLANNING(40) });
    // Mean over the two known rows only: (80 + 40) / 2 = 60.
    expect(summary.total).toMatchObject({
      percentComplete: 60, hasPlanning: true,
      packagesWithPlanning: 2, packagesWithoutPlanning: 1,
    });
  });

  it("groups by planner, unit, and system, and every table reconciles to the total", () => {
    const packages = [
      PROGRESS_PKG({ id: "wp_1", unit: "Unit A", system: "Exchanger", responsible_party: { display_name: "Planner Ada" }, status: "draft" }),
      PROGRESS_PKG({ id: "wp_2", unit: "Unit A", system: "Piping", responsible_party: { display_name: "Planner Ada" }, status: "in_progress" }),
      PROGRESS_PKG({ id: "wp_3", unit: "Unit B", system: "Piping", responsible_party: null, status: "complete" }),
      PROGRESS_PKG({ id: "wp_4", unit: null, system: null, responsible_party: { display_name: "Planner Bo" }, status: "draft" }),
    ];
    const planning = {
      wp_1: PLANNING(100), wp_2: PLANNING(50), wp_3: PLANNING(100), wp_4: PLANNING(0),
    };
    const summary = summarizePlannerProgress(packages, planning);
    expect(summary.total).toMatchObject({ packageCount: 4, completeCount: 2, percentComplete: 62.5 });
    // Planner: Ada 2, Bo 1, Unassigned 1.
    expect(summary.byPlanner.map((g) => [g.label, g.packageCount, g.completeCount, g.percentComplete])).toEqual([
      ["Planner Ada", 2, 1, 75],
      ["Planner Bo", 1, 0, 0],
      ["Unassigned", 1, 1, 100],
    ]);
    // Unit: A 2, B 1, No unit 1.
    expect(summary.byUnit.map((g) => [g.label, g.packageCount])).toEqual([
      ["Unit A", 2], ["Unit B", 1], ["No unit", 1],
    ]);
    // System: Piping 2, Exchanger 1, No system 1.
    expect(summary.bySystem.map((g) => [g.label, g.packageCount])).toEqual([
      ["Piping", 2], ["Exchanger", 1], ["No system", 1],
    ]);
    // Reconciliation: every table's counts, completes, and status
    // counts add up to the total's.
    for (const table of [summary.byPlanner, summary.byUnit, summary.bySystem]) {
      expect(table.reduce((s, g) => s + g.packageCount, 0)).toBe(4);
      expect(table.reduce((s, g) => s + g.completeCount, 0)).toBe(2);
      expect(table.reduce((s, g) => s + g.packagesWithoutPlanning, 0)).toBe(0);
      const statuses = {};
      for (const group of table) {
        for (const [status, count] of Object.entries(group.statusCounts)) {
          statuses[status] = (statuses[status] || 0) + count;
        }
      }
      expect(statuses).toEqual(summary.total.statusCounts);
    }
  });

  it("orders groups biggest first, label ascending on ties", () => {
    const summary = summarizePlannerProgress([
      PROGRESS_PKG({ id: "wp_1", system: "Zulu" }),
      PROGRESS_PKG({ id: "wp_2", system: "Alpha" }),
      PROGRESS_PKG({ id: "wp_3", system: "Alpha" }),
      PROGRESS_PKG({ id: "wp_4", system: "Mike" }),
    ], {});
    expect(summary.bySystem.map((g) => g.label)).toEqual(["Alpha", "Mike", "Zulu"]);
  });

  it("uses sentinel keys for missing planner / unit / system values", () => {
    const summary = summarizePlannerProgress([PROGRESS_PKG({ responsible_party: null, unit: null, system: null })], {});
    expect(summary.byPlanner[0]).toMatchObject({ key: "__unassigned__", label: "Unassigned" });
    expect(summary.byUnit[0]).toMatchObject({ key: "__none__", label: "No unit" });
    expect(summary.bySystem[0]).toMatchObject({ key: "__none__", label: "No system" });
    expect(PROGRESS_DIMENSIONS.map((d) => d.key)).toEqual(["system", "planner", "unit"]);
  });
});
