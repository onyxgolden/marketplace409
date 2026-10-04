import { describe, it, expect } from "vitest";
import {
  percentCompletePhysical,
  percentCompleteMilestone,
  percentCompleteRulesOfCredit,
  percentComplete,
  earnedValue,
  plannedValue,
  costVariance,
  scheduleVariance,
  costPerformanceIndex,
  schedulePerformanceIndex,
  estimateToComplete,
  estimateAtCompletion,
  percentPlannedComplete,
  manpowerVariance,
  weightedPercentComplete,
} from "./workScheduling.js";

describe("percentCompletePhysical", () => {
  it("computes installed over planned", () => {
    expect(percentCompletePhysical(50, 200)).toBe(25);
  });
  it("caps at 100 when over-installed", () => {
    expect(percentCompletePhysical(250, 200)).toBe(100);
  });
  it("returns 0 when nothing planned (no divide-by-zero)", () => {
    expect(percentCompletePhysical(10, 0)).toBe(0);
  });
  it("returns 0 when nothing installed", () => {
    expect(percentCompletePhysical(0, 200)).toBe(0);
  });
  it("rejects non-numbers", () => {
    expect(() => percentCompletePhysical("50", 200)).toThrow(/finite/);
  });
});

describe("percentCompleteMilestone", () => {
  it("weights achieved milestones", () => {
    const ms = [
      { weight: 30, achieved: true },
      { weight: 30, achieved: false },
      { weight: 40, achieved: true },
    ];
    expect(percentCompleteMilestone(ms)).toBe(70);
  });
  it("returns 0 for empty milestones", () => {
    expect(percentCompleteMilestone([])).toBe(0);
  });
  it("rejects negative weights", () => {
    expect(() => percentCompleteMilestone([{ weight: -5, achieved: true }])).toThrow(/>= 0/);
  });
});

describe("percentCompleteRulesOfCredit", () => {
  it("sums credits of completed steps", () => {
    const steps = [
      { credit: 20, complete: true },
      { credit: 30, complete: false },
      { credit: 50, complete: true },
    ];
    expect(percentCompleteRulesOfCredit(steps)).toBe(70);
  });
  it("caps at 100", () => {
    expect(percentCompleteRulesOfCredit([{ credit: 120, complete: true }])).toBe(100);
  });
});

describe("percentComplete dispatch", () => {
  it("routes by method", () => {
    expect(percentComplete("physical_quantity", { installedQty: 1, plannedQty: 4 })).toBe(25);
    expect(percentComplete("milestone", { milestones: [{ weight: 1, achieved: true }] })).toBe(100);
    expect(percentComplete("rules_of_credit", { steps: [{ credit: 40, complete: true }] })).toBe(40);
  });
  it("rejects unknown methods", () => {
    expect(() => percentComplete("vibes", {})).toThrow(/unknown progress method/);
  });
});

describe("earned value", () => {
  it("earnedValue multiplies pct by BAC", () => {
    expect(earnedValue(25, 1000)).toBe(250);
  });
  it("plannedValue multiplies planned pct by BAC", () => {
    expect(plannedValue(50, 1000)).toBe(500);
  });
  it("rejects pct over 100", () => {
    expect(() => earnedValue(150, 1000)).toThrow(/0-100/);
  });
  it("costVariance is earned minus actual", () => {
    expect(costVariance(250, 300)).toBe(-50);
  });
  it("scheduleVariance is earned minus planned", () => {
    expect(scheduleVariance(250, 500)).toBe(-250);
  });
  it("CPI handles zero actual", () => {
    expect(costPerformanceIndex(100, 0)).toBe(Infinity);
    expect(costPerformanceIndex(0, 0)).toBe(1);
  });
  it("SPI handles zero planned", () => {
    expect(schedulePerformanceIndex(100, 0)).toBe(1);
  });
});

describe("forecasting", () => {
  it("ETC divides remaining work by CPI", () => {
    expect(estimateToComplete(1000, 250, 0.5)).toBe(1500);
  });
  it("ETC is 0 when work is complete", () => {
    expect(estimateToComplete(1000, 1000, 0.5)).toBe(0);
  });
  it("EAC is actual plus ETC", () => {
    expect(estimateAtCompletion(300, 1500)).toBe(1800);
  });
});

describe("percentPlannedComplete", () => {
  it("computes PPC", () => {
    expect(percentPlannedComplete(8, 10)).toBe(80);
  });
  it("returns 0 when nothing planned", () => {
    expect(percentPlannedComplete(0, 0)).toBe(0);
  });
  it("rejects completed > planned", () => {
    expect(() => percentPlannedComplete(11, 10)).toThrow(/0\.\.planned/);
  });
});

describe("manpowerVariance", () => {
  it("computes all deltas", () => {
    const v = manpowerVariance({
      plannedHeads: 10, actualHeads: 12,
      plannedManhours: 100, estimatedManhours: 110, actualManhours: 96,
    });
    expect(v.headsDelta).toBe(2);
    expect(v.estimatedDelta).toBe(10);
    expect(v.timesheetVsTrackDelta).toBe(14);
    expect(v.actualDelta).toBe(-4);
  });
  it("skips deltas when inputs are missing", () => {
    const v = manpowerVariance({ plannedHeads: 10, actualHeads: 12 });
    expect(v.headsDelta).toBe(2);
    expect(v.estimatedDelta).toBeUndefined();
  });
});

describe("weightedPercentComplete", () => {
  it("rolls disciplines by weight", () => {
    const entries = [
      { pct: 100, weight: 0.3 },
      { pct: 50, weight: 0.7 },
    ];
    expect(weightedPercentComplete(entries)).toBeCloseTo(65, 10);
  });
  it("returns 0 for empty entries", () => {
    expect(weightedPercentComplete([])).toBe(0);
  });
});
