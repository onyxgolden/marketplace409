// Work Package Planner slice 6 — domain tests. The manpower curve is a
// pure derivation: equal-spread baseline, explicit placements, assignment
// overlay, reconciliation. Every acceptance worked example from the slice-6
// brief (§9) is pinned here in exact numbers.

import { describe, expect, it } from "vitest";
import {
  BASELINE_DISCLOSURE,
  addDays,
  computeManpowerCurve,
  craftKeyFor,
  dayIndexForDate,
  equivalentsForHours,
  isValidCalendarDate,
  outageDates,
  spreadHoursCents,
  validateManpowerCurvePlacementClearInput,
  validateManpowerCurvePlacementInput,
  validateManpowerCurveSettingsInput,
} from "./manpowerCurve.js";

const SETTINGS = { outageStartDate: "2026-11-09", outageDays: 10, standardHoursPerPersonDay: 8 };

function step(overrides = {}) {
  return {
    id: "step_1", title: "Fabricate spool", sequenceNo: 1,
    craftKey: "pipefitter", craftLabel: "Pipefitter",
    plannedDurationDays: 4, plannedPersonHours: 40, version: 1,
    ...overrides,
  };
}

describe("date helpers", () => {
  it("validates calendar dates and rejects impossible ones", () => {
    expect(isValidCalendarDate("2026-11-09")).toBe(true);
    expect(isValidCalendarDate("2026-02-29")).toBe(false);
    expect(isValidCalendarDate("2026-11-09T00:00:00Z")).toBe(false);
    expect(isValidCalendarDate("2026-13-01")).toBe(false);
    expect(isValidCalendarDate(null)).toBe(false);
  });

  it("adds days across month boundaries in UTC only", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-11-09", 9)).toBe("2026-11-18");
    expect(outageDates("2026-11-09", 3)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
  });

  it("maps a work date to a 1-based outage day, or null outside the window", () => {
    expect(dayIndexForDate("2026-11-09", 10, "2026-11-09")).toBe(1);
    expect(dayIndexForDate("2026-11-09", 10, "2026-11-18")).toBe(10);
    expect(dayIndexForDate("2026-11-09", 10, "2026-11-08")).toBe(null);
    expect(dayIndexForDate("2026-11-09", 10, "2026-11-19")).toBe(null);
  });
});

describe("spreadHoursCents", () => {
  it("puts the fractional residual deterministically on the last day and sums exactly", () => {
    expect(spreadHoursCents(1000, 3)).toEqual([333, 333, 334]);
    expect(spreadHoursCents(1000, 3).reduce((a, b) => a + b, 0)).toBe(1000);
    expect(spreadHoursCents(4000, 4)).toEqual([1000, 1000, 1000, 1000]);
    expect(spreadHoursCents(250, 2)).toEqual([125, 125]);
  });
});

describe("equivalentsForHours", () => {
  it("divides by the standard day and rounds to 4 decimals", () => {
    expect(equivalentsForHours(10, 8)).toBe(1.25);
    expect(equivalentsForHours(15, 8)).toBe(1.875);
    expect(equivalentsForHours(10, 4)).toBe(2.5);
  });
});

describe("craftKeyFor", () => {
  it("canonicalizes labels and never fabricates a craft for a blank one", () => {
    expect(craftKeyFor("  Pipefitter  ")).toBe("pipefitter");
    expect(craftKeyFor("Instrument  Technician")).toBe("instrument technician");
    expect(craftKeyFor("")).toBe(null);
    expect(craftKeyFor("   ")).toBe(null);
    expect(craftKeyFor(null)).toBe(null);
  });
});

describe("computeManpowerCurve — worked examples (§9)", () => {
  it("40h over 4 days = 10h/day and 1.25 equivalent persons at an 8h standard", () => {
    const curve = computeManpowerCurve({ settings: SETTINGS, steps: [step()], placements: [], assignments: [] });
    expect(curve.windowConfigured).toBe(true);
    expect(curve.window.outageEndDate).toBe("2026-11-18");
    expect(curve.days.slice(0, 4).map((d) => d.totalRequiredHours)).toEqual([10, 10, 10, 10]);
    expect(curve.days.slice(0, 4).map((d) => d.totalRequiredEquivalents)).toEqual([1.25, 1.25, 1.25, 1.25]);
    expect(curve.days.slice(4).every((d) => d.totalRequiredHours === 0)).toBe(true);
    expect(curve.totals.requiredHours).toBe(40);
    expect(curve.totals.requiredEquivalents).toBe(5);
    expect(curve.reconciliation.reconciled).toBe(true);
    expect(curve.reconciliation.knownActiveStepHours).toBe(40);
    expect(curve.baselineDisclosure).toBe(BASELINE_DISCLOSURE);
    expect(curve.warnings.some((w) => w.code === "BASELINE_UNSEQUENCED")).toBe(true);
  });

  it("30h over 2 days placed on day 3 = 15h/day on days 3–4; clearing reverts to days 1–2", () => {
    const placedStep = step({ id: "step_2", plannedDurationDays: 2, plannedPersonHours: 30 });
    const placed = computeManpowerCurve({
      settings: SETTINGS, steps: [placedStep],
      placements: [{ stepId: "step_2", startDayIndex: 3 }], assignments: [],
    });
    expect(placed.days.slice(0, 2).map((d) => d.totalRequiredHours)).toEqual([0, 0]);
    expect(placed.days.slice(2, 4).map((d) => d.totalRequiredHours)).toEqual([15, 15]);
    expect(placed.days.slice(2, 4).map((d) => d.totalRequiredEquivalents)).toEqual([1.875, 1.875]);
    expect(placed.warnings.some((w) => w.code === "BASELINE_UNSEQUENCED")).toBe(false);

    const cleared = computeManpowerCurve({ settings: SETTINGS, steps: [placedStep], placements: [], assignments: [] });
    expect(cleared.days.slice(0, 2).map((d) => d.totalRequiredHours)).toEqual([15, 15]);
    expect(cleared.days.slice(2, 4).map((d) => d.totalRequiredHours)).toEqual([0, 0]);
  });

  it("overlapping steps sum exactly per day and per craft", () => {
    const steps = [
      step({ id: "s1", plannedDurationDays: 2, plannedPersonHours: 20 }),
      step({ id: "s2", sequenceNo: 2, craftKey: "welder", craftLabel: "Welder", plannedDurationDays: 2, plannedPersonHours: 16 }),
    ];
    const curve = computeManpowerCurve({ settings: SETTINGS, steps, placements: [], assignments: [] });
    expect(curve.days[0].totalRequiredHours).toBe(18);
    expect(curve.days[0].crafts.pipefitter.requiredHours).toBe(10);
    expect(curve.days[0].crafts.welder.requiredHours).toBe(8);
    expect(curve.days[1].totalRequiredHours).toBe(18);
    expect(curve.days.slice(2).every((d) => d.totalRequiredHours === 0)).toBe(true);
    expect(curve.totals.requiredHours).toBe(36);
    expect(curve.reconciliation.reconciled).toBe(true);
  });

  it("reordering steps (sequence_no) changes nothing", () => {
    const steps = [
      step({ id: "s1", sequenceNo: 1, plannedDurationDays: 2, plannedPersonHours: 20 }),
      step({ id: "s2", sequenceNo: 2, craftKey: "welder", craftLabel: "Welder", plannedDurationDays: 2, plannedPersonHours: 16 }),
    ];
    const reordered = [
      step({ id: "s2", sequenceNo: 1, craftKey: "welder", craftLabel: "Welder", plannedDurationDays: 2, plannedPersonHours: 16 }),
      step({ id: "s1", sequenceNo: 2, plannedDurationDays: 2, plannedPersonHours: 20 }),
    ];
    const a = computeManpowerCurve({ settings: SETTINGS, steps, placements: [], assignments: [] });
    const b = computeManpowerCurve({ settings: SETTINGS, steps: reordered, placements: [], assignments: [] });
    expect(b.days).toEqual(a.days);
    expect(b.totals).toEqual(a.totals);
  });

  it("assignment overlay adds 28 capacity hours and leaves demand unchanged", () => {
    const assignments = [
      { workDate: "2026-11-09", craftKey: "pipefitter", craftLabel: "Pipefitter", crewSize: 2, hoursPerPerson: 7 },
      { workDate: "2026-11-10", craftKey: "pipefitter", craftLabel: "Pipefitter", crewSize: 2, hoursPerPerson: 7 },
    ];
    const curve = computeManpowerCurve({ settings: SETTINGS, steps: [step()], placements: [], assignments });
    expect(curve.days[0].totalAssignedHours).toBe(14);
    expect(curve.days[1].totalAssignedHours).toBe(14);
    expect(curve.totals.assignedHours).toBe(28);
    expect(curve.totals.requiredHours).toBe(40);
    expect(curve.days[0].totalGapHours).toBe(4);
    expect(curve.days[0].crafts.pipefitter.assignedShiftPersonSlots).toBe(2);
    expect(curve.capacity.inWindowAssignmentHours).toBe(28);
    expect(curve.capacity.outOfWindowAssignmentCount).toBe(0);
  });

  it("a step with no duration spreads over the whole window", () => {
    const curve = computeManpowerCurve({
      settings: SETTINGS,
      steps: [step({ plannedDurationDays: null, plannedPersonHours: 20 })],
      placements: [], assignments: [],
    });
    expect(curve.days.map((d) => d.totalRequiredHours)).toEqual(Array(10).fill(2));
    expect(curve.totals.requiredHours).toBe(20);
  });

  it("a step longer than the window is unallocated, never clipped or extended", () => {
    const curve = computeManpowerCurve({
      settings: SETTINGS,
      steps: [step({ plannedDurationDays: 12, plannedPersonHours: 40 })],
      placements: [], assignments: [],
    });
    expect(curve.days.every((d) => d.totalRequiredHours === 0)).toBe(true);
    expect(curve.totals.requiredHours).toBe(0);
    expect(curve.unallocated.knownHours).toBe(40);
    expect(curve.excludedSteps).toHaveLength(1);
    expect(curve.excludedSteps[0].reason).toBe("duration_exceeds_outage");
    expect(curve.reconciliation.reconciled).toBe(false);
    expect(curve.reconciliation.requiredHoursTotal + curve.reconciliation.unallocatedKnownHours)
      .toBe(curve.reconciliation.knownActiveStepHours);
  });

  it("a placement that runs past the window is unallocated, never clipped", () => {
    const curve = computeManpowerCurve({
      settings: SETTINGS,
      steps: [step({ plannedDurationDays: 4, plannedPersonHours: 40 })],
      placements: [{ stepId: "step_1", startDayIndex: 8 }],
      assignments: [],
    });
    expect(curve.days.every((d) => d.totalRequiredHours === 0)).toBe(true);
    expect(curve.unallocated.knownHours).toBe(40);
    expect(curve.excludedSteps[0].reason).toBe("placement_outside_window");
    expect(curve.reconciliation.reconciled).toBe(false);
  });

  it("a step with no hours is unknown, not zero; a step with no craft is unclassified, never fabricated", () => {
    const steps = [
      step({ id: "no-hours", plannedPersonHours: null }),
      step({ id: "no-craft", sequenceNo: 2, craftKey: null, craftLabel: null, plannedPersonHours: 16 }),
      step({ id: "ok", sequenceNo: 3, plannedPersonHours: 8, plannedDurationDays: 1 }),
    ];
    const curve = computeManpowerCurve({ settings: SETTINGS, steps, placements: [], assignments: [] });
    expect(curve.unallocated.unknownSteps).toBe(1);
    expect(curve.unallocated.unclassifiedHours).toBe(16);
    expect(curve.totals.requiredHours).toBe(8);
    expect(curve.reconciliation.knownActiveStepHours).toBe(24);
    expect(curve.reconciliation.reconciled).toBe(false);
    expect(curve.crafts.find((c) => c.craftKey === null)?.craftLabel).toBe("Unclassified");
    expect(curve.excludedSteps.map((s) => s.reason)).toEqual(["missing_hours", "missing_craft"]);
    expect(curve.warnings.some((w) => w.code === "UNKNOWN_HOURS")).toBe(true);
  });

  it("assignments outside the window are counted, never mapped to a day", () => {
    const curve = computeManpowerCurve({
      settings: SETTINGS, steps: [step()],
      placements: [],
      assignments: [
        { workDate: "2026-11-08", craftKey: "pipefitter", craftLabel: "Pipefitter", crewSize: 4, hoursPerPerson: 8 },
        { workDate: "2026-11-19", craftKey: "pipefitter", craftLabel: "Pipefitter", crewSize: 4, hoursPerPerson: 8 },
        { workDate: "2026-11-09", craftKey: "pipefitter", craftLabel: "Pipefitter", crewSize: 1, hoursPerPerson: 8 },
      ],
    });
    expect(curve.capacity.outOfWindowAssignmentCount).toBe(2);
    expect(curve.totals.assignedHours).toBe(8);
    expect(curve.warnings.some((w) => w.code === "OUT_OF_WINDOW_ASSIGNMENTS")).toBe(true);
  });

  it("no window configured lists every step as excluded and never guesses dates", () => {
    const curve = computeManpowerCurve({ settings: null, steps: [step()], placements: [], assignments: [] });
    expect(curve.windowConfigured).toBe(false);
    expect(curve.days).toEqual([]);
    expect(curve.excludedSteps).toHaveLength(1);
    expect(curve.excludedSteps[0].reason).toBe("window_not_configured");
    expect(curve.warnings.some((w) => w.code === "WINDOW_NOT_CONFIGURED")).toBe(true);
  });

  it("no steps gives an empty demand chart and a reconciled zero total", () => {
    const curve = computeManpowerCurve({ settings: SETTINGS, steps: [], placements: [], assignments: [] });
    expect(curve.days).toHaveLength(10);
    expect(curve.days.every((d) => d.totalRequiredHours === 0)).toBe(true);
    expect(curve.totals.requiredHours).toBe(0);
    expect(curve.reconciliation.reconciled).toBe(true);
  });

  it("assignments alone give a staffing-only overlay, explicitly not demand", () => {
    const curve = computeManpowerCurve({
      settings: SETTINGS, steps: [],
      placements: [],
      assignments: [{ workDate: "2026-11-09", craftKey: "welder", craftLabel: "Welder", crewSize: 3, hoursPerPerson: 8 }],
    });
    expect(curve.totals.requiredHours).toBe(0);
    expect(curve.totals.assignedHours).toBe(24);
    expect(curve.days[0].crafts.welder.requiredHours).toBe(0);
    expect(curve.days[0].crafts.welder.assignedHours).toBe(24);
  });

  it("the reconciliation invariant holds per craft across mixed exclusions", () => {
    const steps = [
      step({ id: "a", plannedDurationDays: 2, plannedPersonHours: 20 }),
      step({ id: "b", sequenceNo: 2, craftKey: "welder", craftLabel: "Welder", plannedDurationDays: 2, plannedPersonHours: 16 }),
      step({ id: "c", sequenceNo: 3, plannedDurationDays: 12, plannedPersonHours: 12 }),
      step({ id: "d", sequenceNo: 4, craftKey: null, craftLabel: null, plannedPersonHours: 8 }),
    ];
    const curve = computeManpowerCurve({ settings: SETTINGS, steps, placements: [], assignments: [] });
    const { requiredHoursTotal, unallocatedKnownHours, unclassifiedKnownHours, knownActiveStepHours } = curve.reconciliation;
    expect(requiredHoursTotal + unallocatedKnownHours + unclassifiedKnownHours).toBe(knownActiveStepHours);
    expect(knownActiveStepHours).toBe(56);
    expect(requiredHoursTotal).toBe(36);
    expect(unallocatedKnownHours).toBe(12);
    expect(unclassifiedKnownHours).toBe(8);
  });

  it("a 4-hour standard day doubles the equivalent persons for the same hours", () => {
    const curve = computeManpowerCurve({
      settings: { ...SETTINGS, standardHoursPerPersonDay: 4 },
      steps: [step()], placements: [], assignments: [],
    });
    expect(curve.days[0].totalRequiredEquivalents).toBe(2.5);
    expect(curve.totals.requiredEquivalents).toBe(10);
  });
});

describe("validators", () => {
  it("accepts a valid settings input and defaults the standard day", () => {
    expect(validateManpowerCurveSettingsInput({ outageStartDate: "2026-11-09", outageDays: 10 })).toEqual({ ok: true });
    expect(validateManpowerCurveSettingsInput({
      outageStartDate: "2026-11-09", outageDays: 10, standardHoursPerPersonDay: 8, expectedVersion: 2, reason: "Outage moved",
    })).toEqual({ ok: true });
  });

  it("rejects bad settings inputs", () => {
    expect(validateManpowerCurveSettingsInput(null).ok).toBe(false);
    expect(validateManpowerCurveSettingsInput({ outageStartDate: "2026-02-29", outageDays: 10 }).ok).toBe(false);
    expect(validateManpowerCurveSettingsInput({ outageStartDate: "2026-11-09", outageDays: 0 }).ok).toBe(false);
    expect(validateManpowerCurveSettingsInput({ outageStartDate: "2026-11-09", outageDays: 367 }).ok).toBe(false);
    expect(validateManpowerCurveSettingsInput({ outageStartDate: "2026-11-09", outageDays: 10, standardHoursPerPersonDay: 0 }).ok).toBe(false);
    expect(validateManpowerCurveSettingsInput({ outageStartDate: "2026-11-09", outageDays: 10, standardHoursPerPersonDay: 25 }).ok).toBe(false);
    expect(validateManpowerCurveSettingsInput({ outageStartDate: "2026-11-09", outageDays: 10, standardHoursPerPersonDay: 8.005 }).ok).toBe(false);
    expect(validateManpowerCurveSettingsInput({ outageStartDate: "2026-11-09", outageDays: 10, expectedVersion: -1 }).ok).toBe(false);
    expect(validateManpowerCurveSettingsInput({ outageStartDate: "2026-11-09", outageDays: 10, reason: "x".repeat(1001) }).ok).toBe(false);
  });

  it("accepts a valid placement input and rejects bad ones", () => {
    expect(validateManpowerCurvePlacementInput({ stepId: "step_1", startDayIndex: 3 })).toEqual({ ok: true });
    expect(validateManpowerCurvePlacementInput({ stepId: "step_1", startDayIndex: 3, expectedVersion: 1, reason: "Sequencing" })).toEqual({ ok: true });
    expect(validateManpowerCurvePlacementInput({ stepId: "", startDayIndex: 3 }).ok).toBe(false);
    expect(validateManpowerCurvePlacementInput({ stepId: "step_1", startDayIndex: 0 }).ok).toBe(false);
    expect(validateManpowerCurvePlacementInput({ stepId: "step_1", startDayIndex: 1.5 }).ok).toBe(false);
  });

  it("requires a version and a reason to clear a placement", () => {
    expect(validateManpowerCurvePlacementClearInput({ placementId: "p1", expectedVersion: 1, reason: "No longer sequenced" })).toEqual({ ok: true });
    expect(validateManpowerCurvePlacementClearInput({ placementId: "p1", expectedVersion: 1, reason: "  " }).ok).toBe(false);
    expect(validateManpowerCurvePlacementClearInput({ placementId: "p1", reason: "x" }).ok).toBe(false);
    expect(validateManpowerCurvePlacementClearInput({ placementId: "p1", expectedVersion: 0, reason: "x" }).ok).toBe(false);
  });
});
