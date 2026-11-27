// D4.1 package dashboard — pure summarizers. Fail-before: these tests
// pin the contract before the module exists.
import { describe, expect, it } from "vitest";

import {
  craftGroupKey,
  parseDetailFocus,
  planningPercentDisplay,
  planningStepsDisplay,
  serializeDetailFocus,
  summarizeChangeOrderStrip,
  summarizePackageCostSplit,
  summarizeWorkPlanByCraft,
} from "./packageDashboard.js";

describe("summarizeWorkPlanByCraft", () => {
  it("groups active steps by craft with planned hours and missing-hours counts", () => {
    const steps = [
      { id: "s1", craftKey: "pipefitter", craftLabel: "Pipefitter", plannedPersonHours: 10, retiredAt: null },
      { id: "s2", craftKey: "pipefitter", craftLabel: "Pipefitter", plannedPersonHours: 4.5, retiredAt: null },
      { id: "s3", craftKey: "welder", craftLabel: "Welder", plannedPersonHours: null, retiredAt: null },
      { id: "s4", craftKey: null, craftLabel: null, plannedPersonHours: 2, retiredAt: null },
    ];
    const result = summarizeWorkPlanByCraft(steps);
    expect(result.totalSteps).toBe(4);
    expect(result.totalPlannedHours).toBe(16.5);
    expect(result.hoursMissingCount).toBe(1);
    expect(result.hasHours).toBe(true);
    // Biggest planned hours first; the No craft bucket always sorts
    // last even though it out-hours the Welder group.
    expect(result.groups.map((g) => g.key)).toEqual(["pipefitter", "welder", "no-craft"]);
    const pipe = result.groups[0];
    expect(pipe).toMatchObject({ label: "Pipefitter", stepCount: 2, plannedHours: 14.5, hoursMissingCount: 0 });
    const weld = result.groups[1];
    expect(weld).toMatchObject({ label: "Welder", stepCount: 1, plannedHours: 0, hoursMissingCount: 1 });
    const none = result.groups[2];
    expect(none).toMatchObject({ label: "No craft", stepCount: 1, plannedHours: 2, hoursMissingCount: 0 });
  });

  it("ignores retired steps and sorts biggest planned hours first with No craft last", () => {
    const steps = [
      { id: "s1", craftKey: null, craftLabel: null, plannedPersonHours: 99, retiredAt: null },
      { id: "s2", craftKey: "electrician", craftLabel: "Electrician", plannedPersonHours: 3, retiredAt: null },
      { id: "s3", craftKey: "pipefitter", craftLabel: "Pipefitter", plannedPersonHours: 8, retiredAt: null },
      { id: "s4", craftKey: "pipefitter", craftLabel: "Pipefitter", plannedPersonHours: 8, retiredAt: "2026-11-01T00:00:00Z" },
    ];
    const result = summarizeWorkPlanByCraft(steps);
    expect(result.totalSteps).toBe(3);
    expect(result.groups.map((g) => g.key)).toEqual(["pipefitter", "electrician", "no-craft"]);
  });

  it("returns empty groups for an empty step list", () => {
    const result = summarizeWorkPlanByCraft([]);
    expect(result).toMatchObject({ groups: [], totalSteps: 0, totalPlannedHours: 0, hoursMissingCount: 0, hasHours: false });
  });

  it("derives the group key from the label when no craft key is stored", () => {
    expect(craftGroupKey({ craftKey: null, craftLabel: "  Pipefitter " })).toBe("pipefitter");
    expect(craftGroupKey({ craftKey: null, craftLabel: null })).toBe("no-craft");
    expect(craftGroupKey({ craftKey: "welder", craftLabel: "Welder" })).toBe("welder");
  });
});

describe("summarizePackageCostSplit", () => {
  const estimate = {
    id: "est_1",
    currentControlEstimateCents: 250000,
    originalControlEstimateCents: 250000,
    contingencyCents: 10000,
    version: 2,
  };
  const lines = [
    { id: "l1", category: "labor", description: "Crew", amountCents: 150000 },
    { id: "l2", category: "material", description: "Pipe", amountCents: 100000 },
  ];
  const allocation = {
    id: "alloc_1",
    controlEstimateId: "est_1",
    controlEstimateVersion: 2,
    allocatedTotalCents: 250000,
    version: 1,
    lines,
  };

  it("reconciles a saved allocation that matches the current estimate exactly", () => {
    const result = summarizePackageCostSplit({ notApplied: false, estimate, allocation, plannedLaborForecastCents: 90000 });
    expect(result.state).toBe("reconciled");
    expect(result.estimateCents).toBe(250000);
    expect(result.allocatedTotalCents).toBe(250000);
    expect(result.gapCents).toBe(0);
    expect(result.categoryTotals).toEqual({ labor: 150000, material: 100000, equipment: 0, external_services: 0, rental: 0 });
    expect(result.lineCount).toBe(2);
    expect(result.plannedLaborForecastCents).toBe(90000);
  });

  it("reports not-applied, no-estimate, and no-allocation as distinct incomplete states", () => {
    expect(summarizePackageCostSplit({ notApplied: true, estimate: null, allocation: null }).state).toBe("not-applied");
    expect(summarizePackageCostSplit({ notApplied: false, estimate: null, allocation: null }).state).toBe("no-estimate");
    expect(summarizePackageCostSplit({ notApplied: false, estimate, allocation: null }).state).toBe("no-allocation");
  });

  it("reports stale when the allocation was saved against an older estimate version", () => {
    const stale = { ...allocation, controlEstimateVersion: 1 };
    const result = summarizePackageCostSplit({ notApplied: false, estimate, allocation: stale });
    expect(result.state).toBe("stale");
    expect(result.gapCents).toBe(0);
  });

  it("reports mismatch when the version matches but the totals differ — never silently normalizes", () => {
    const short = { ...allocation, allocatedTotalCents: 240000, lines: [{ id: "l1", category: "labor", description: "Crew", amountCents: 240000 }] };
    const result = summarizePackageCostSplit({ notApplied: false, estimate, allocation: short });
    expect(result.state).toBe("mismatch");
    expect(result.gapCents).toBe(-10000);
    expect(result.categoryTotals.labor).toBe(240000);
  });

  it("keeps an explicit zero estimate distinct from a missing one", () => {
    const zero = { ...estimate, currentControlEstimateCents: 0 };
    const result = summarizePackageCostSplit({ notApplied: false, estimate: zero, allocation: null });
    expect(result.state).toBe("no-allocation");
    expect(result.estimateCents).toBe(0);
  });
});

describe("summarizeChangeOrderStrip", () => {
  const summary = {
    hasEstimate: true,
    originalControlEstimateCents: 250000,
    currentEstimateCents: 250000,
    contingencyCents: 50000,
    runningContractPriceCents: 270000,
    contingencyRemainingCents: -5000,
    laborCostCents: 90000,
    totalJobCostCents: 360000,
    countsByStatus: { estimated: 1, approved: 1, material_ordered: 1, denied: 2 },
    countedChangeOrderCount: 2,
    countedNonDeviationCents: 15000,
    countedDeviationCents: 5000,
    warnings: [{ code: "contingency_overdrawn", message: "Contingency is overdrawn by $50.00 — counted Deviations exceed the pool." }],
  };

  it("counts open as every active status except denied and keeps a negative remainder negative", () => {
    const result = summarizeChangeOrderStrip(summary);
    expect(result.state).toBe("ready");
    expect(result.openCount).toBe(3);
    expect(result.deniedCount).toBe(2);
    expect(result.countedCount).toBe(2);
    expect(result.approvedValueCents).toBe(20000);
    expect(result.contingencyUsedCents).toBe(5000);
    expect(result.contingencyRemainingCents).toBe(-5000);
    expect(result.runningContractPriceCents).toBe(270000);
    expect(result.warnings).toHaveLength(1);
  });

  it("reports not-applied and no-estimate without inventing contract figures", () => {
    expect(summarizeChangeOrderStrip({ ...summary, notApplied: true }).state).toBe("not-applied");
    const noEstimate = summarizeChangeOrderStrip({ ...summary, hasEstimate: false, currentEstimateCents: null, contingencyCents: null, runningContractPriceCents: null, contingencyRemainingCents: null });
    expect(noEstimate.state).toBe("no-estimate");
    expect(noEstimate.openCount).toBe(3);
    expect(noEstimate.approvedValueCents).toBe(20000);
    expect(noEstimate.runningContractPriceCents).toBeNull();
    expect(noEstimate.contingencyRemainingCents).toBeNull();
  });
});

describe("detail focus parsing", () => {
  it("round-trips every allowed focus shape and rejects anything else", () => {
    const cases = [
      { kind: "craft", craftKey: "pipefitter" },
      { kind: "craft", craftKey: "no-craft" },
      { kind: "change-orders", filter: "open" },
      { kind: "change-orders", filter: "counted" },
      { kind: "change-orders", filter: "deviation" },
      { kind: "change-orders", filter: "all" },
      { kind: "budget-allocation", category: "labor" },
      { kind: "budget-allocation", category: "all" },
      { kind: "estimate" },
    ];
    for (const focus of cases) {
      expect(parseDetailFocus(serializeDetailFocus(focus))).toEqual(focus);
    }
    expect(parseDetailFocus(null)).toBeNull();
    expect(parseDetailFocus("")).toBeNull();
    expect(parseDetailFocus("craft:")).toBeNull();
    expect(parseDetailFocus("craft:pipefitter;DROP")).toBeNull();
    expect(parseDetailFocus("change-orders:approved")).toBeNull();
    expect(parseDetailFocus("budget-allocation:concrete")).toBeNull();
    expect(parseDetailFocus("tab=steps")).toBeNull();
    expect(parseDetailFocus("<script>alert(1)</script>")).toBeNull();
    expect(serializeDetailFocus(null)).toBeNull();
    expect(serializeDetailFocus({ kind: "craft", craftKey: "" })).toBeNull();
  });
});

describe("planning display helpers", () => {
  it("distinguishes unavailable, not started, and earned steps", () => {
    expect(planningStepsDisplay(null)).toBe("Unavailable");
    expect(planningStepsDisplay({ initialized: false, stepsEarned: 0, stepsTotal: 22 })).toBe("Not started");
    expect(planningStepsDisplay({ initialized: true, stepsEarned: 5, stepsTotal: 22 })).toBe("5 of 22 steps");
    expect(planningPercentDisplay(null)).toBe("Unavailable");
    expect(planningPercentDisplay({ initialized: false, percentComplete: 0 })).toBe("Not started — 0%");
    expect(planningPercentDisplay({ initialized: true, percentComplete: 45 })).toBe("45%");
  });
});
