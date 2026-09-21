import { describe, expect, it } from "vitest";
import {
  DEFAULT_DRIFT_THRESHOLD_DAYS,
  detectBaselineDrift,
} from "../schedulingDriftAlerts";
import { chicagoTodayISO } from "../schedulingAskSchedule";

function currentBlock(overrides) {
  return {
    id: `block_${overrides.task_code}`,
    task_code: overrides.task_code,
    label: overrides.label ?? overrides.task_code,
    block_type: "task",
    early_start: null,
    early_finish: null,
    actual_start: null,
    actual_finish: null,
    percent_complete: 0,
    ...overrides,
  };
}

function baselineBlock(overrides) {
  return {
    block_task_code: overrides.task_code,
    label: overrides.label ?? overrides.task_code,
    block_type: "task",
    baseline_start: null,
    baseline_finish: null,
    ...overrides,
  };
}

const reportFor = (currentBlocks, baselineBlocks, options) =>
  detectBaselineDrift(
    { blocks: currentBlocks },
    baselineBlocks === null ? null : { name: "Baseline 1", baselineBlocks },
    options,
  );

describe("detectBaselineDrift", () => {
  it("flags a late activity with finish variance, direction, and major severity", () => {
    const report = reportFor(
      [currentBlock({ task_code: "A1010", label: "Mobilize", early_start: "2026-01-05", early_finish: "2026-01-14" })],
      [baselineBlock({ task_code: "A1010", label: "Mobilize", baseline_start: "2026-01-05", baseline_finish: "2026-01-09" })],
    );
    expect(report.hasBaseline).toBe(true);
    expect(report.drifted).toHaveLength(1);
    const item = report.drifted[0];
    expect(item.taskCode).toBe("A1010");
    expect(item.startVarianceDays).toBe(0);
    expect(item.finishVarianceDays).toBe(5);
    expect(item.direction).toBe("late");
    expect(item.severity).toBe("major"); // 5 > 2 * threshold(2)
    expect(item.baselineStart).toBe("2026-01-05");
    expect(item.currentFinish).toBe("2026-01-14");
    expect(item.detail).toContain("+5d");
    expect(report.summary.driftedCount).toBe(1);
    expect(report.summary.majorCount).toBe(1);
    expect(report.summary.lateCount).toBe(1);
  });

  it("flags an early activity as minor when within twice the threshold", () => {
    const report = reportFor(
      [currentBlock({ task_code: "A1020", early_start: "2026-01-09", early_finish: "2026-01-20" })],
      [baselineBlock({ task_code: "A1020", baseline_start: "2026-01-12", baseline_finish: "2026-01-23" })],
    );
    const item = report.drifted[0];
    expect(item.startVarianceDays).toBe(-3);
    expect(item.finishVarianceDays).toBe(-3);
    expect(item.direction).toBe("early");
    expect(item.severity).toBe("minor"); // 3 <= 2 * 2
    expect(report.summary.earlyCount).toBe(1);
  });

  it("leaves on-time activities out of the drift list", () => {
    const report = reportFor(
      [currentBlock({ task_code: "A1030", early_start: "2026-01-13", early_finish: "2026-01-24" })],
      [baselineBlock({ task_code: "A1030", baseline_start: "2026-01-12", baseline_finish: "2026-01-23" })],
    );
    expect(report.drifted).toHaveLength(0);
    expect(report.summary.comparedCount).toBe(1);
  });

  it("treats the threshold as a strict boundary: exactly 2 days is not drift, 3 days is", () => {
    expect(DEFAULT_DRIFT_THRESHOLD_DAYS).toBe(2);
    const atBoundary = reportFor(
      [currentBlock({ task_code: "A1", early_start: "2026-01-12", early_finish: "2026-01-25" })],
      [baselineBlock({ task_code: "A1", baseline_start: "2026-01-12", baseline_finish: "2026-01-23" })],
    );
    expect(atBoundary.drifted).toHaveLength(0); // finish variance exactly +2

    const pastBoundary = reportFor(
      [currentBlock({ task_code: "A1", early_start: "2026-01-12", early_finish: "2026-01-26" })],
      [baselineBlock({ task_code: "A1", baseline_start: "2026-01-12", baseline_finish: "2026-01-23" })],
    );
    expect(pastBoundary.drifted).toHaveLength(1); // finish variance +3
  });

  it("excludes completed activities even when their dates moved -- done is never late", () => {
    const report = reportFor(
      [currentBlock({
        task_code: "A1040", early_start: "2026-01-05", early_finish: "2026-01-19",
        percent_complete: 100,
      })],
      [baselineBlock({ task_code: "A1040", baseline_start: "2026-01-05", baseline_finish: "2026-01-09" })],
    );
    expect(report.drifted).toHaveLength(0);
    expect(report.summary.completedExcludedCount).toBe(1);
    expect(report.summary.comparedCount).toBe(0);
  });

  it("excludes completed milestones too", () => {
    const report = reportFor(
      [currentBlock({
        task_code: "M1050", block_type: "milestone", label: "Dry-in",
        early_start: "2026-02-10", early_finish: "2026-02-10", percent_complete: 100,
      })],
      [baselineBlock({ task_code: "M1050", block_type: "milestone", baseline_start: "2026-01-26", baseline_finish: "2026-01-26" })],
    );
    expect(report.drifted).toHaveLength(0);
    expect(report.summary.completedExcludedCount).toBe(1);
  });

  it("excludes activities with no baseline row as 'no baseline', not zero drift", () => {
    const report = reportFor(
      [currentBlock({ task_code: "A1060", early_start: "2026-03-01", early_finish: "2026-03-10" })],
      [baselineBlock({ task_code: "A9999", baseline_start: "2026-01-05", baseline_finish: "2026-01-09" })],
    );
    expect(report.drifted).toHaveLength(0);
    expect(report.summary.noBaselineCount).toBe(1);
    expect(report.summary.addedSinceBaselineCount).toBe(1);
    expect(report.summary.removedSinceBaselineCount).toBe(1);
  });

  it("treats zero/undefined baseline dates as no baseline, not on-schedule", () => {
    const report = reportFor(
      [currentBlock({ task_code: "A1070", early_start: "2026-04-01", early_finish: "2026-04-20" })],
      [
        baselineBlock({ task_code: "A1070" }), // both dates undefined
        baselineBlock({ task_code: "A1071", baseline_start: "", baseline_finish: "" }), // empty strings
      ],
    );
    expect(report.drifted).toHaveLength(0);
    expect(report.summary.noBaselineCount).toBe(1);
  });

  it("reports mixed direction when start moves early and finish moves late", () => {
    const report = reportFor(
      [currentBlock({ task_code: "A1080", early_start: "2026-01-08", early_finish: "2026-01-28" })],
      [baselineBlock({ task_code: "A1080", baseline_start: "2026-01-12", baseline_finish: "2026-01-23" })],
    );
    const item = report.drifted[0];
    expect(item.startVarianceDays).toBe(-4);
    expect(item.finishVarianceDays).toBe(5);
    expect(item.direction).toBe("mixed");
    expect(item.severity).toBe("major");
    expect(report.summary.mixedCount).toBe(1);
  });

  it("puts major severity exactly above twice the threshold", () => {
    const justMinor = reportFor(
      [currentBlock({ task_code: "A1", early_start: "2026-01-12", early_finish: "2026-01-27" })],
      [baselineBlock({ task_code: "A1", baseline_start: "2026-01-12", baseline_finish: "2026-01-23" })],
    );
    expect(justMinor.drifted[0].severity).toBe("minor"); // 4 == 2 * 2, not above

    const major = reportFor(
      [currentBlock({ task_code: "A1", early_start: "2026-01-12", early_finish: "2026-01-28" })],
      [baselineBlock({ task_code: "A1", baseline_start: "2026-01-12", baseline_finish: "2026-01-23" })],
    );
    expect(major.drifted[0].severity).toBe("major"); // 5 > 2 * 2
  });

  it("honors a custom threshold from options", () => {
    const strict = reportFor(
      [currentBlock({ task_code: "A1", early_start: "2026-01-12", early_finish: "2026-01-27" })],
      [baselineBlock({ task_code: "A1", baseline_start: "2026-01-12", baseline_finish: "2026-01-23" })],
      { thresholdDays: 5 },
    );
    expect(strict.drifted).toHaveLength(0); // 4 <= 5
    expect(strict.thresholdDays).toBe(5);

    const loose = reportFor(
      [currentBlock({ task_code: "A1", early_start: "2026-01-12", early_finish: "2026-01-29" })],
      [baselineBlock({ task_code: "A1", baseline_start: "2026-01-12", baseline_finish: "2026-01-23" })],
      { thresholdDays: 5 },
    );
    expect(loose.drifted).toHaveLength(1); // 6 > 5
    expect(loose.drifted[0].severity).toBe("minor"); // 6 <= 2 * 5
  });

  it("prefers actual dates over early dates when both are present", () => {
    const report = reportFor(
      [currentBlock({
        task_code: "A1090",
        actual_start: "2026-01-05", actual_finish: "2026-01-09",
        early_start: "2026-02-01", early_finish: "2026-02-10",
      })],
      [baselineBlock({ task_code: "A1090", baseline_start: "2026-01-05", baseline_finish: "2026-01-09" })],
    );
    // Actuals match the baseline exactly, so no drift even though early dates moved.
    expect(report.drifted).toHaveLength(0);
    expect(report.drifted[0]).toBeUndefined();
  });

  it("returns a well-formed empty report when no baseline was captured", () => {
    const report = reportFor(
      [currentBlock({ task_code: "A1100", early_start: "2026-01-05", early_finish: "2026-01-09" })],
      null,
    );
    expect(report.hasBaseline).toBe(false);
    expect(report.baselineName).toBeNull();
    expect(report.drifted).toEqual([]);
    expect(report.summary.driftedCount).toBe(0);
  });

  it("computes project finish variance from the latest finishes on each side", () => {
    const report = reportFor(
      [
        currentBlock({ task_code: "A1", early_start: "2026-01-05", early_finish: "2026-01-09" }),
        currentBlock({ task_code: "A2", early_start: "2026-01-10", early_finish: "2026-02-05" }),
      ],
      [
        baselineBlock({ task_code: "A1", baseline_start: "2026-01-05", baseline_finish: "2026-01-09" }),
        baselineBlock({ task_code: "A2", baseline_start: "2026-01-10", baseline_finish: "2026-01-30" }),
      ],
    );
    expect(report.summary.projectFinishVarianceDays).toBe(6);
  });

  it("sorts major drift first, then by largest variance, then task code", () => {
    const report = reportFor(
      [
        currentBlock({ task_code: "B2", early_start: "2026-01-12", early_finish: "2026-01-26" }), // +3 minor
        currentBlock({ task_code: "A1", early_start: "2026-01-12", early_finish: "2026-02-02" }), // +10 major
        currentBlock({ task_code: "C3", early_start: "2026-01-12", early_finish: "2026-01-30" }), // +7 major
      ],
      [
        baselineBlock({ task_code: "A1", baseline_start: "2026-01-12", baseline_finish: "2026-01-23" }),
        baselineBlock({ task_code: "B2", baseline_start: "2026-01-12", baseline_finish: "2026-01-23" }),
        baselineBlock({ task_code: "C3", baseline_start: "2026-01-12", baseline_finish: "2026-01-23" }),
      ],
    );
    expect(report.drifted.map((item) => item.taskCode)).toEqual(["A1", "C3", "B2"]);
  });

  it("freezes the report, item list, and items", () => {
    const report = reportFor(
      [currentBlock({ task_code: "A1", early_start: "2026-01-12", early_finish: "2026-01-28" })],
      [baselineBlock({ task_code: "A1", baseline_start: "2026-01-12", baseline_finish: "2026-01-23" })],
    );
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.drifted)).toBe(true);
    expect(Object.isFrozen(report.summary)).toBe(true);
    expect(Object.isFrozen(report.drifted[0])).toBe(true);
  });

  it("stamps the report with an injectable as-of date, defaulting to Chicago today", () => {
    const injected = reportFor(
      [currentBlock({ task_code: "A1", early_start: "2026-01-12", early_finish: "2026-01-23" })],
      [baselineBlock({ task_code: "A1", baseline_start: "2026-01-12", baseline_finish: "2026-01-23" })],
      { todayISO: "2026-03-15" },
    );
    expect(injected.asOf).toBe("2026-03-15");

    // Chicago-date edge: 2026-09-20 02:30 UTC is still 2026-09-19 in Chicago.
    // A UTC-based "today" would stamp the wrong date; the helper must not.
    const chicagoEdge = detectBaselineDrift(
      { blocks: [] },
      { name: "B", baselineBlocks: [] },
      { todayISO: chicagoTodayISO(new Date("2026-09-20T02:30:00.000Z")) },
    );
    expect(chicagoEdge.asOf).toBe("2026-09-19");

    const defaulted = reportFor([], []);
    expect(defaulted.asOf).toBe(chicagoTodayISO());
    expect(defaulted.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
