// Work Package Planner slice 9 — bust domain tests. Pure detection,
// variance, fingerprint, day spans, and the status machine. Every
// acceptance worked example from the reconciled busts brief (§7) is
// pinned here in exact numbers.
//
// The quantity-vs-cost separation is the load-bearing rule: an
// installed quantity overrun is NEVER converted into a labor cost —
// a line 25% over on quantity with no verified actual cost produces
// exactly one candidate (INSTALLED_QUANTITY) and no LABOR_COST
// candidate. The manpower shortfall math is verified against the
// slice-6 curve inputs (equal-spread placement, assignment overlay).

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BUST_TRANSITIONS,
  buildCandidates,
  calendarDaySpan,
  canTransition,
  computeFingerprint,
  computePercentVariance,
  computeVariance,
  formatCents,
  formatFingerprintNumber,
  formatVarianceLabel,
  isUnfavorableVariance,
  md5Hex,
  validateConfirmInput,
} from "./busts.js";

const OWNER = "owner_1";
const PACKAGE = "pkg_1";
const BASELINE = {
  id: "base_1", versionNumber: 1,
  baselineStart: "2026-11-09", baselineFinish: "2026-11-18",
  baselineHours: 400, baselineCostCents: 1_000_000, frozenAt: "2026-11-01T00:00:00Z",
};

function snapshot(overrides = {}) {
  return {
    ownerId: OWNER,
    packageId: PACKAGE,
    packageStatus: "draft",
    asOf: "2026-11-15",
    baseline: { ...BASELINE },
    progressBaseline: null,
    takeoffLines: [],
    steps: [],
    placements: [],
    assignments: [],
    latestProgress: null,
    controlEstimate: { originalControlEstimateCents: 2_000_000, currentEstimateCents: 2_100_000 },
    activeBusts: [],
    ...overrides,
  };
}

describe("md5Hex", () => {
  it("matches Node crypto on the RFC 1321 vectors and a fingerprint string", () => {
    const vectors = [
      "",
      "a",
      "abc",
      "message digest",
      "abcdefghijklmnopqrstuvwxyz",
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
      "1234567890".repeat(8),
      "owner1|pkg1|LABOR_COST|PACKAGE|||||b1|1|100000|150000|USD_CENTS|2026-11-15",
    ];
    for (const vector of vectors) {
      expect(md5Hex(vector)).toBe(createHash("md5").update(vector, "utf8").digest("hex"));
    }
  });
});

describe("formatFingerprintNumber", () => {
  it("renders canonically: trailing zeros stripped, null is empty", () => {
    expect(formatFingerprintNumber(100)).toBe("100");
    expect(formatFingerprintNumber(40.5)).toBe("40.5");
    expect(formatFingerprintNumber(2.3455)).toBe("2.3455");
    expect(formatFingerprintNumber(0)).toBe("0");
    expect(formatFingerprintNumber(null)).toBe("");
    expect(formatFingerprintNumber(undefined)).toBe("");
  });
});

describe("computeFingerprint", () => {
  it("is stable for the same comparison and changes when any field changes", () => {
    const input = {
      ownerId: OWNER, packageId: PACKAGE, dimension: "LABOR_COST", scopeType: "PACKAGE",
      takeoffLineId: null, workStepId: null, craft: null, workDate: null, shiftKey: null,
      baselineId: "base_1", baselineVersion: 1, plannedValue: 100000, observedValue: 150000,
      unit: "USD_CENTS", comparisonAsOf: "2026-11-15",
    };
    const first = computeFingerprint(input);
    expect(first).toBe(computeFingerprint(input));
    expect(first).toBe(createHash("md5").update(
      "owner_1|pkg_1|LABOR_COST|PACKAGE||||||base_1|1|100000|150000|USD_CENTS|2026-11-15",
      "utf8",
    ).digest("hex"));
    expect(computeFingerprint({ ...input, observedValue: 150001 })).not.toBe(first);
    expect(computeFingerprint({ ...input, baselineVersion: 2 })).not.toBe(first);
    expect(computeFingerprint({ ...input, comparisonAsOf: "2026-11-16" })).not.toBe(first);
  });

  it("treats 40.5 and 40.5000 as the same figure (scale-insensitive)", () => {
    const base = {
      ownerId: OWNER, packageId: PACKAGE, dimension: "LABOR_HOURS", scopeType: "PACKAGE",
      baselineId: "base_1", baselineVersion: 1, unit: "HOURS", comparisonAsOf: "2026-11-15",
    };
    expect(computeFingerprint({ ...base, plannedValue: 40.5, observedValue: 45 }))
      .toBe(computeFingerprint({ ...base, plannedValue: 40.5000, observedValue: 45.0000 }));
  });
});

describe("calendarDaySpan", () => {
  it("is end exclusive of start", () => {
    expect(calendarDaySpan("2026-11-09", "2026-11-18")).toBe(9);
    expect(calendarDaySpan("2026-11-09", "2026-11-09")).toBe(0);
  });

  it("counts a DST-transition day exactly once (spring forward 2026-03-08)", () => {
    // Mar 7 -> Mar 10 crosses the 2026-03-08 spring-forward day: 3 days, not 2.96.
    expect(calendarDaySpan("2026-03-07", "2026-03-10")).toBe(3);
    // Fall back 2026-11-01: Nov 1 -> Nov 3 is 2 days, not 2.04.
    expect(calendarDaySpan("2026-10-31", "2026-11-02")).toBe(2);
  });

  it("counts across a year boundary", () => {
    expect(calendarDaySpan("2026-12-30", "2027-01-02")).toBe(3);
    expect(calendarDaySpan("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("returns null for missing or malformed dates", () => {
    expect(calendarDaySpan(null, "2026-11-10")).toBe(null);
    expect(calendarDaySpan("2026-11-10", "not-a-date")).toBe(null);
  });
});

describe("variance", () => {
  it("is the absolute overrun, rounded to the dimension scale", () => {
    expect(computeVariance("LABOR_COST", 100000, 150000)).toBe(50000);
    expect(computeVariance("LABOR_HOURS", 400, 440.5)).toBe(40.5);
    expect(computeVariance("INSTALLED_QUANTITY", 10, 12.3456)).toBe(2.3456);
    expect(computeVariance("SCHEDULE_DAYS", 9, 12)).toBe(3);
    // Manpower runs the other way: required above capacity.
    expect(computeVariance("MANPOWER_SHORTFALL", 40, 24)).toBe(16);
  });

  it("is 0 for a favorable variance and null for missing figures", () => {
    expect(computeVariance("LABOR_COST", 100000, 90000)).toBe(0);
    expect(computeVariance("MANPOWER_SHORTFALL", 24, 40)).toBe(0);
    expect(computeVariance("LABOR_COST", null, 90000)).toBe(null);
    expect(computeVariance("LABOR_COST", 100000, null)).toBe(null);
  });

  it("never reports a zero-plan percent as infinity", () => {
    expect(computePercentVariance(0, 50)).toBe(null);
    expect(computePercentVariance(100000, 50000)).toBe(50);
    expect(computePercentVariance(3, 1)).toBe(33.3333);
    expect(computePercentVariance(null, 50)).toBe(null);
  });

  it("isUnfavorableVariance runs manpower the other way", () => {
    expect(isUnfavorableVariance("LABOR_COST", 100, 101)).toBe(true);
    expect(isUnfavorableVariance("LABOR_COST", 100, 100)).toBe(false);
    expect(isUnfavorableVariance("MANPOWER_SHORTFALL", 40, 24)).toBe(true);
    expect(isUnfavorableVariance("MANPOWER_SHORTFALL", 24, 40)).toBe(false);
  });
});

describe("buildCandidates — quantity vs cost separation (§7.1)", () => {
  it("a line 25% over on quantity yields exactly one candidate and no labor-cost candidate", () => {
    const { candidates, insufficiencies } = buildCandidates(snapshot({
      takeoffLines: [
        { id: "line_1", drawingId: "dwg_1", drawingNumber: "W-0005-1", quantity: 10, unit: "EA", installedQuantity: 12.5 },
      ],
    }));
    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(candidate.dimension).toBe("INSTALLED_QUANTITY");
    expect(candidate.scopeType).toBe("TAKEOFF_LINE");
    expect(candidate.takeoffLineId).toBe("line_1");
    expect(candidate.plannedValue).toBe(10);
    expect(candidate.observedValue).toBe(12.5);
    expect(candidate.varianceValue).toBe(2.5);
    expect(candidate.variancePercent).toBe(25);
    expect(candidate.unit).toBe("EA");
    expect(candidate.baselineId).toBe(null);
    expect(candidate.targetLabel).toBe("Drawing W-0005-1 — 10 EA planned");
    expect(candidate.alreadyRecorded).toBe(false);
    // No labor-cost candidate: a quantity overrun is never converted
    // into a labor cost. (Labor cost is still unevaluable here — no
    // progress snapshot — which the insufficiencies say plainly.)
    expect(candidates.filter((c) => c.dimension === "LABOR_COST")).toHaveLength(0);
    expect(insufficiencies.some((item) => item.dimension === "LABOR_COST")).toBe(true);
  });

  it("a line at or under plan yields no candidate", () => {
    const { candidates } = buildCandidates(snapshot({
      takeoffLines: [
        { id: "line_1", drawingId: "dwg_1", drawingNumber: "W-0005-1", quantity: 10, unit: "EA", installedQuantity: 10 },
        { id: "line_2", drawingId: "dwg_1", drawingNumber: "W-0005-1", quantity: 5, unit: "LF", installedQuantity: 4 },
      ],
    }));
    expect(candidates).toHaveLength(0);
  });

  it("a missing installed quantity is insufficient evidence, never zero", () => {
    const { candidates, insufficiencies } = buildCandidates(snapshot({
      takeoffLines: [
        { id: "line_1", drawingId: "dwg_1", drawingNumber: "W-0005-1", quantity: 10, unit: "EA", installedQuantity: null },
      ],
    }));
    expect(candidates).toHaveLength(0);
    expect(insufficiencies.some((item) => item.dimension === "INSTALLED_QUANTITY")).toBe(true);
  });
});

describe("buildCandidates — labor hours and cost (§7.1)", () => {
  it("actuals above the frozen baseline yield labor candidates in cents", () => {
    const { candidates } = buildCandidates(snapshot({
      latestProgress: { statusDate: "2026-11-15", actualHours: 440.5, actualCostCents: 1_250_000, baselineVersion: 1 },
    }));
    expect(candidates.map((c) => c.dimension).sort()).toEqual(["LABOR_COST", "LABOR_HOURS"]);
    const hours = candidates.find((c) => c.dimension === "LABOR_HOURS");
    expect(hours.plannedValue).toBe(400);
    expect(hours.observedValue).toBe(440.5);
    expect(hours.varianceValue).toBe(40.5);
    expect(hours.variancePercent).toBe(10.125);
    expect(hours.unit).toBe("HOURS");
    expect(hours.baselineId).toBe("base_1");
    expect(hours.baselineVersion).toBe(1);
    expect(hours.comparisonAsOf).toBe("2026-11-15");
    expect(hours.targetLabel).toBe("Whole package");
    const cost = candidates.find((c) => c.dimension === "LABOR_COST");
    expect(cost.plannedValue).toBe(1_000_000);
    expect(cost.observedValue).toBe(1_250_000);
    expect(cost.varianceValue).toBe(250_000);
    expect(cost.variancePercent).toBe(25);
    expect(cost.unit).toBe("USD_CENTS");
  });

  it("actuals at or under the baseline yield no labor candidates", () => {
    const { candidates } = buildCandidates(snapshot({
      latestProgress: { statusDate: "2026-11-15", actualHours: 400, actualCostCents: 1_000_000, baselineVersion: 1 },
    }));
    expect(candidates).toHaveLength(0);
  });

  it("a re-baseline does not rewrite the snapshot's allowance (progressBaseline wins)", () => {
    const oldBaseline = {
      id: "base_0", versionNumber: 1,
      baselineStart: "2026-11-09", baselineFinish: "2026-11-18",
      baselineHours: 400, baselineCostCents: 1_000_000, frozenAt: "2026-11-01T00:00:00Z",
    };
    const { candidates } = buildCandidates(snapshot({
      baseline: { ...BASELINE, id: "base_1", versionNumber: 2, baselineHours: 500, baselineCostCents: 1_200_000 },
      progressBaseline: oldBaseline,
      latestProgress: { statusDate: "2026-11-15", actualHours: 440.5, actualCostCents: 1_100_000, baselineVersion: 1 },
    }));
    // 440.5 > 400 (v1 allowance) and 1,100,000 > 1,000,000 (v1 cost):
    // both bust against v1, the baseline the snapshot was measured
    // against — even though neither would bust against v2.
    const hours = candidates.find((c) => c.dimension === "LABOR_HOURS");
    expect(hours).toBeDefined();
    expect(hours.baselineId).toBe("base_0");
    expect(hours.baselineVersion).toBe(1);
    expect(hours.plannedValue).toBe(400);
    const cost = candidates.find((c) => c.dimension === "LABOR_COST");
    expect(cost).toBeDefined();
    expect(cost.baselineId).toBe("base_0");
    expect(cost.baselineVersion).toBe(1);
    expect(cost.plannedValue).toBe(1_000_000);
    expect(cost.observedValue).toBe(1_100_000);
  });

  it("a progress snapshot naming a missing baseline version yields insufficiencies, not a false comparison", () => {
    const { candidates, insufficiencies } = buildCandidates(snapshot({
      progressBaseline: null,
      latestProgress: { statusDate: "2026-11-15", actualHours: 9999, actualCostCents: 9999999, baselineVersion: 99 },
    }));
    expect(candidates).toHaveLength(0);
    expect(insufficiencies.filter((item) => ["LABOR_HOURS", "LABOR_COST", "SCHEDULE_DAYS"].includes(item.dimension))).toHaveLength(3);
  });
});

describe("buildCandidates — schedule days (§7.3)", () => {
  it("a status date past the frozen finish yields a schedule candidate (end exclusive of start)", () => {
    const { candidates } = buildCandidates(snapshot({
      latestProgress: { statusDate: "2026-11-21", actualHours: 100, actualCostCents: 100_000, baselineVersion: 1 },
    }));
    const schedule = candidates.find((c) => c.dimension === "SCHEDULE_DAYS");
    expect(schedule).toBeDefined();
    // Planned span Nov 9 -> Nov 18 is 9 days; observed Nov 9 -> Nov 21 is 12 days.
    expect(schedule.plannedValue).toBe(9);
    expect(schedule.observedValue).toBe(12);
    expect(schedule.varianceValue).toBe(3);
    expect(schedule.variancePercent).toBe(33.3333);
    expect(schedule.unit).toBe("DAYS");
  });

  it("a DST-transition window counts each day once", () => {
    const { candidates } = buildCandidates(snapshot({
      baseline: {
        id: "base_dst", versionNumber: 1,
        baselineStart: "2026-03-07", baselineFinish: "2026-03-10",
        baselineHours: 100, baselineCostCents: 100_000, frozenAt: "2026-03-01T00:00:00Z",
      },
      latestProgress: { statusDate: "2026-03-12", actualHours: 10, actualCostCents: 10_000, baselineVersion: 1 },
    }));
    const schedule = candidates.find((c) => c.dimension === "SCHEDULE_DAYS");
    expect(schedule).toBeDefined();
    expect(schedule.plannedValue).toBe(3);
    expect(schedule.observedValue).toBe(5);
    expect(schedule.varianceValue).toBe(2);
  });

  it("a year-boundary window counts the same way", () => {
    const { candidates } = buildCandidates(snapshot({
      baseline: {
        id: "base_yr", versionNumber: 1,
        baselineStart: "2026-12-30", baselineFinish: "2027-01-02",
        baselineHours: 100, baselineCostCents: 100_000, frozenAt: "2026-12-01T00:00:00Z",
      },
      latestProgress: { statusDate: "2027-01-05", actualHours: 10, actualCostCents: 10_000, baselineVersion: 1 },
    }));
    const schedule = candidates.find((c) => c.dimension === "SCHEDULE_DAYS");
    expect(schedule.plannedValue).toBe(3);
    expect(schedule.observedValue).toBe(6);
    expect(schedule.varianceValue).toBe(3);
  });

  it("a status date on or before the finish yields no schedule candidate", () => {
    const { candidates } = buildCandidates(snapshot({
      latestProgress: { statusDate: "2026-11-18", actualHours: 100, actualCostCents: 100_000, baselineVersion: 1 },
    }));
    expect(candidates.find((c) => c.dimension === "SCHEDULE_DAYS")).toBeUndefined();
  });
});

describe("buildCandidates — manpower shortfall (§7.2)", () => {
  // One step: 40 person-hours over 4 days (Nov 9-12), pipefitters.
  // Curve spreads 10 hrs/day. Assignments cover 8 hrs/day -> 2 hrs/day short.
  function manpowerSnapshot(assignments) {
    return snapshot({
      steps: [
        { id: "step_1", title: "Fabricate spool", sequenceNo: 1, craftKey: "pipefitters", craftLabel: "Pipefitters", plannedDurationDays: 4, plannedPersonHours: 40, version: 1 },
      ],
      placements: [
        { id: "place_1", stepId: "step_1", baselineVersion: 1, startDayIndex: 1, version: 1 },
      ],
      assignments,
    });
  }

  it("computes the shortfall from the slice-6 curve inputs (required vs assigned per craft-day)", () => {
    const { candidates } = buildCandidates(manpowerSnapshot([
      { workDate: "2026-11-09", craftKey: "pipefitters", craftLabel: "Pipefitters", shiftKey: "day", crewSize: 1, hoursPerPerson: 8 },
      { workDate: "2026-11-10", craftKey: "pipefitters", craftLabel: "Pipefitters", shiftKey: "day", crewSize: 1, hoursPerPerson: 8 },
      { workDate: "2026-11-11", craftKey: "pipefitters", craftLabel: "Pipefitters", shiftKey: "day", crewSize: 1, hoursPerPerson: 8 },
      { workDate: "2026-11-12", craftKey: "pipefitters", craftLabel: "Pipefitters", shiftKey: "day", crewSize: 1, hoursPerPerson: 8 },
    ]));
    const shorts = candidates.filter((c) => c.dimension === "MANPOWER_SHORTFALL");
    expect(shorts).toHaveLength(4);
    for (const short of shorts) {
      expect(short.plannedValue).toBe(10);
      expect(short.observedValue).toBe(8);
      expect(short.varianceValue).toBe(2);
      expect(short.variancePercent).toBe(20);
      expect(short.unit).toBe("HOURS");
      expect(short.craft).toBe("pipefitters");
      expect(short.shiftKey).toBe(null);
      expect(short.targetLabel).toContain("Pipefitters");
    }
    expect(shorts.map((s) => s.workDate).sort()).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]);
  });

  it("sums capacity across shifts for one craft-day (demand is not shift-specific)", () => {
    const { candidates } = buildCandidates(manpowerSnapshot([
      { workDate: "2026-11-09", craftKey: "pipefitters", craftLabel: "Pipefitters", shiftKey: "day", crewSize: 1, hoursPerPerson: 6 },
      { workDate: "2026-11-09", craftKey: "pipefitters", craftLabel: "Pipefitters", shiftKey: "night", crewSize: 1, hoursPerPerson: 4 },
    ]));
    const shorts = candidates.filter((c) => c.dimension === "MANPOWER_SHORTFALL");
    // Nov 9 is fully covered by the two shifts together (6 + 4 = 10);
    // the other three days have no assignments at all, so they short
    // the full 10 hours each.
    expect(shorts.map((s) => s.workDate).sort()).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
    for (const short of shorts) {
      expect(short.plannedValue).toBe(10);
      expect(short.observedValue).toBe(0);
      expect(short.varianceValue).toBe(10);
    }
  });

  it("fully staffed days yield no candidate", () => {
    const { candidates } = buildCandidates(manpowerSnapshot([
      { workDate: "2026-11-09", craftKey: "pipefitters", craftLabel: "Pipefitters", shiftKey: "day", crewSize: 2, hoursPerPerson: 5 },
      { workDate: "2026-11-10", craftKey: "pipefitters", craftLabel: "Pipefitters", shiftKey: "day", crewSize: 2, hoursPerPerson: 5 },
      { workDate: "2026-11-11", craftKey: "pipefitters", craftLabel: "Pipefitters", shiftKey: "day", crewSize: 2, hoursPerPerson: 5 },
      { workDate: "2026-11-12", craftKey: "pipefitters", craftLabel: "Pipefitters", shiftKey: "day", crewSize: 2, hoursPerPerson: 5 },
    ]));
    expect(candidates.filter((c) => c.dimension === "MANPOWER_SHORTFALL")).toHaveLength(0);
  });
});

describe("buildCandidates — already recorded and insufficiencies", () => {
  it("marks a candidate whose fingerprint matches an active bust as already recorded", () => {
    const first = buildCandidates(snapshot({
      takeoffLines: [
        { id: "line_1", drawingId: "dwg_1", drawingNumber: "W-0005-1", quantity: 10, unit: "EA", installedQuantity: 12.5 },
      ],
    }));
    expect(first.candidates).toHaveLength(1);
    const fingerprint = first.candidates[0].sourceFingerprint;
    const second = buildCandidates(snapshot({
      takeoffLines: [
        { id: "line_1", drawingId: "dwg_1", drawingNumber: "W-0005-1", quantity: 10, unit: "EA", installedQuantity: 12.5 },
      ],
      activeBusts: [{ id: "bust_1", sourceFingerprint: fingerprint, status: "OPEN", dimension: "INSTALLED_QUANTITY" }],
    }));
    expect(second.candidates[0].alreadyRecorded).toBe(true);
    expect(second.candidates[0].alreadyRecordedBustId).toBe("bust_1");
    // A retired bust with the same fingerprint does not count as recorded.
    const third = buildCandidates(snapshot({
      takeoffLines: [
        { id: "line_1", drawingId: "dwg_1", drawingNumber: "W-0005-1", quantity: 10, unit: "EA", installedQuantity: 12.5 },
      ],
      activeBusts: [{ id: "bust_1", sourceFingerprint: fingerprint, status: "RETIRED", dimension: "INSTALLED_QUANTITY" }],
    }));
    expect(third.candidates[0].alreadyRecorded).toBe(false);
  });

  it("reports insufficiencies instead of inventing figures when inputs are missing", () => {
    const { candidates, insufficiencies } = buildCandidates(snapshot({
      baseline: null,
      latestProgress: null,
    }));
    expect(candidates).toHaveLength(0);
    expect(insufficiencies.some((item) => item.dimension === "LABOR_HOURS")).toBe(true);
    expect(insufficiencies.some((item) => item.dimension === "LABOR_COST")).toBe(true);
    expect(insufficiencies.some((item) => item.dimension === "SCHEDULE_DAYS")).toBe(true);
    expect(insufficiencies.some((item) => item.dimension === "MANPOWER_SHORTFALL")).toBe(true);
  });

  it("does not run detection on a terminal package", () => {
    const { candidates, insufficiencies } = buildCandidates(snapshot({
      packageStatus: "cancelled",
      takeoffLines: [
        { id: "line_1", drawingId: "dwg_1", drawingNumber: "W-0005-1", quantity: 10, unit: "EA", installedQuantity: 99 },
      ],
    }));
    expect(candidates).toHaveLength(0);
    expect(insufficiencies).toHaveLength(1);
  });
});

describe("status machine", () => {
  it("allows forward moves and reopens, and forbids the rest", () => {
    expect(canTransition("OPEN", "UNDER_REVIEW")).toBe(true);
    expect(canTransition("OPEN", "ACCEPTED_OVERRUN")).toBe(true);
    expect(canTransition("UNDER_REVIEW", "RESOLVED_BY_CHANGE")).toBe(true);
    expect(canTransition("ACCEPTED_OVERRUN", "UNDER_REVIEW")).toBe(true);
    expect(canTransition("RETIRED", "UNDER_REVIEW")).toBe(true);
    expect(canTransition("OPEN", "RETIRED")).toBe(false);
    expect(canTransition("UNDER_REVIEW", "UNDER_REVIEW")).toBe(false);
    expect(canTransition("ACCEPTED_OVERRUN", "RESOLVED_BY_CHANGE")).toBe(false);
    expect(canTransition("INVALID_DATA", "ACCEPTED_OVERRUN")).toBe(false);
    expect(BUST_TRANSITIONS.OPEN).toEqual(["UNDER_REVIEW", "ACCEPTED_OVERRUN", "RESOLVED_BY_CHANGE", "INVALID_DATA"]);
  });
});

describe("validateConfirmInput", () => {
  const valid = {
    dimension: "LABOR_COST",
    scopeType: "PACKAGE",
    baselineId: "base_1",
    baselineVersion: 1,
    plannedValue: 100000,
    observedValue: 150000,
    unit: "USD_CENTS",
    evidenceSummary: "Actual cost is over the frozen baseline.",
    comparisonAsOf: "2026-11-15",
  };

  it("accepts a valid confirm", () => {
    expect(validateConfirmInput(valid)).toEqual([]);
  });

  it("rejects a wrong scope for the dimension", () => {
    expect(validateConfirmInput({ ...valid, dimension: "INSTALLED_QUANTITY", scopeType: "PACKAGE" }))
      .toContain("INVALID_TARGET");
    expect(validateConfirmInput({ ...valid, dimension: "MANPOWER_SHORTFALL", scopeType: "PACKAGE", craft: "x", workDate: "2026-11-09" }))
      .toContain("INVALID_TARGET");
  });

  it("rejects a missing baseline for non-quantity dimensions", () => {
    expect(validateConfirmInput({ ...valid, baselineId: null })).toContain("INVALID_BASELINE");
  });

  it("rejects a wrong unit and a non-unfavorable direction", () => {
    expect(validateConfirmInput({ ...valid, unit: "HOURS" })).toContain("INVALID_UNIT");
    expect(validateConfirmInput({ ...valid, observedValue: 100000 })).toContain("INVALID_VALUE");
    expect(validateConfirmInput({ ...valid, observedValue: 90000 })).toContain("INVALID_VALUE");
    expect(validateConfirmInput({ ...valid, dimension: "MANPOWER_SHORTFALL", scopeType: "CRAFT_DAY", craft: "pipefitters", workDate: "2026-11-09", plannedValue: 10, observedValue: 12, unit: "HOURS" }))
      .toContain("INVALID_VALUE");
  });

  it("rejects fractional cents and short evidence", () => {
    expect(validateConfirmInput({ ...valid, plannedValue: 100000.5 })).toContain("INVALID_COST");
    expect(validateConfirmInput({ ...valid, evidenceSummary: "too short" })).toContain("INVALID_EVIDENCE");
    expect(validateConfirmInput({ ...valid, evidenceSummary: "x".repeat(2001) })).toContain("INVALID_EVIDENCE");
  });
});

describe("formatting", () => {
  it("formats cents and variance labels in plain words", () => {
    expect(formatCents(207500)).toBe("$2,075.00");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(null)).toBe("—");
    expect(formatVarianceLabel({
      dimension: "LABOR_COST", plannedValue: 100000, observedValue: 150000,
      varianceValue: 50000, variancePercent: 50, unit: "USD_CENTS",
    })).toBe("$1,500.00 vs $1,000.00 planned — $500.00 over (50%)");
    expect(formatVarianceLabel({
      dimension: "MANPOWER_SHORTFALL", plannedValue: 40, observedValue: 24,
      varianceValue: 16, variancePercent: 40, unit: "HOURS",
    })).toBe("16 HOURS short (required 40 HOURS, assigned 24 HOURS) (40%)");
    expect(formatVarianceLabel({
      dimension: "SCHEDULE_DAYS", plannedValue: 9, observedValue: 12,
      varianceValue: 3, variancePercent: null, unit: "DAYS",
    })).toBe("12 DAYS vs 9 DAYS planned — 3 DAYS over");
  });
});
