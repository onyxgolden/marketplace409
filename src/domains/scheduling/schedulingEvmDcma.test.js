import { describe, expect, it } from "vitest";
import {
  computeEvm, computeDcmaMetrics, runCriticalPathTest,
  dcmaLogicDensity, dcmaLeadsAndLags, dcmaRelationshipTypes, dcmaHardConstraints,
  dcmaFloatMetrics, dcmaDurationMetrics, dcmaInvalidDates, dcmaResourceAssignment,
  dcmaMissedTasks, dcmaCriticalPathLengthIndex, dcmaBaselineExecutionIndex,
} from "./schedulingEvmDcma";

// Anchored to the same confirmed Monday used by schedulingCpmEngine.test.js (2026-01-05).
const MON_FRI = Object.freeze({ id: "cal_weekday", working_days: Object.freeze([1, 2, 3, 4, 5]) });
const LANES = [{ id: "lane_1", calendar_id: null }];
const CALENDARS = [MON_FRI];

function project(overrides = {}) {
  return { id: "proj_1", start_date: "2026-01-05", end_date: "2026-06-30", default_calendar_id: MON_FRI.id, ...overrides };
}
function block(id, overrides = {}) {
  return {
    id, task_code: id, schedule_project_id: "proj_1", lane_id: "lane_1", wbs_node_id: null,
    label: id, category: "eng", block_type: "task", duration_days: 1, calendar_id: null,
    constraint_type: null, constraint_date: null, total_float_days: 0, is_critical: true,
    percent_complete: 0, actual_start: null, actual_finish: null, ...overrides,
  };
}
function dependency(id, predecessorId, successorId, relationshipType = "FS", lagDays = 0) {
  return { id, predecessor_id: predecessorId, successor_id: successorId, relationship_type: relationshipType, lag_days: lagDays };
}

describe("schedulingEvmDcma — computeEvm", () => {
  it("computes PV/EV/AC/CV/SV/CPI/SPI and all three EAC variants for a mid-span status date", () => {
    const blockInputs = [{ taskCode: "A", budgetedCost: 1000, actualCost: 400, percentComplete: 50, baselineStart: "2026-01-01", baselineFinish: "2026-01-10" }];
    const evm = computeEvm({ asOfDate: "2026-01-05", blockInputs });
    expect(evm).toMatchObject({
      bac: 1000, pv: 500, ev: 500, ac: 400, cv: 100, sv: 0, cpi: 1.25, spi: 1,
      eac: { atypical: 900, typical: 800, cpiSpi: 800 },
      etc: 400, vac: 200,
    });
  });

  it("gives zero planned value before the baseline span starts, and full planned value once it's passed", () => {
    const blockInputs = [{ taskCode: "A", budgetedCost: 1000, actualCost: 0, percentComplete: 0, baselineStart: "2026-01-05", baselineFinish: "2026-01-09" }];
    expect(computeEvm({ asOfDate: "2026-01-01", blockInputs }).pv).toBe(0);
    expect(computeEvm({ asOfDate: "2026-01-09", blockInputs }).pv).toBe(1000);
    expect(computeEvm({ asOfDate: "2026-02-01", blockInputs }).pv).toBe(1000);
  });

  it("treats a zero-duration (milestone) baseline span as 100% planned exactly on its date, 0% before", () => {
    const blockInputs = [{ taskCode: "M", budgetedCost: 500, actualCost: 0, percentComplete: 0, baselineStart: "2026-01-05", baselineFinish: "2026-01-05" }];
    expect(computeEvm({ asOfDate: "2026-01-04", blockInputs }).pv).toBe(0);
    expect(computeEvm({ asOfDate: "2026-01-05", blockInputs }).pv).toBe(500);
  });

  it("gives zero planned value (but real earned/actual value) for a block added since baseline", () => {
    const blockInputs = [{ taskCode: "NEW", budgetedCost: 200, actualCost: 50, percentComplete: 25, baselineStart: null, baselineFinish: null }];
    const evm = computeEvm({ asOfDate: "2026-01-05", blockInputs });
    expect(evm.pv).toBe(0);
    expect(evm.ev).toBe(50); // 200 * 0.25
    expect(evm.ac).toBe(50);
  });

  it("returns null (not Infinity/NaN) for CPI/SPI/typical EAC when actual or planned value is zero", () => {
    const blockInputs = [{ taskCode: "A", budgetedCost: 1000, actualCost: 0, percentComplete: 30, baselineStart: "2026-02-01", baselineFinish: "2026-02-10" }];
    const evm = computeEvm({ asOfDate: "2026-01-01", blockInputs }); // before baseline span -> pv=0 too
    expect(evm.cpi).toBeNull();
    expect(evm.spi).toBeNull();
    expect(evm.eac.typical).toBeNull();
    expect(evm.eac.cpiSpi).toBeNull();
    expect(evm.eac.atypical).toBe(700); // still computable: 0 + (1000 - 300)
  });
});

describe("schedulingEvmDcma — dcmaLogicDensity", () => {
  it("excludes milestones and counts non-milestone activities missing a predecessor or successor", () => {
    const blocks = [block("A"), block("B"), block("C"), block("M", { block_type: "milestone" })];
    const dependencies = [dependency("d1", "B", "C")];
    const result = dcmaLogicDensity(blocks, dependencies);
    expect(result).toMatchObject({ missingPredecessor: 2, missingSuccessor: 2, totalActivities: 3, percentMissing: (4 / 6) * 100, pass: false });
  });

  it("passes trivially with no activities", () => {
    expect(dcmaLogicDensity([], [])).toMatchObject({ percentMissing: 0, pass: true });
  });
});

describe("schedulingEvmDcma — dcmaLeadsAndLags", () => {
  it("flags any lead as a failure, and lags over the 5% threshold", () => {
    const dependencies = [dependency("d1", "A", "B", "FS", -2), ...Array.from({ length: 19 }, (_, i) => dependency(`d${i + 2}`, "A", "B"))];
    const result = dcmaLeadsAndLags(dependencies);
    expect(result.leads).toBe(1);
    expect(result.leadsPass).toBe(false);
  });

  it("passes with no leads and lags under 5%", () => {
    const dependencies = Array.from({ length: 20 }, (_, i) => dependency(`d${i}`, "A", "B"));
    const result = dcmaLeadsAndLags(dependencies);
    expect(result).toMatchObject({ leads: 0, lags: 0, leadsPass: true, lagsPass: true });
  });
});

describe("schedulingEvmDcma — dcmaRelationshipTypes", () => {
  it("passes at exactly the 90% FS threshold", () => {
    const dependencies = [...Array.from({ length: 9 }, (_, i) => dependency(`d${i}`, "A", "B", "FS")), dependency("d10", "A", "B", "SS")];
    expect(dcmaRelationshipTypes(dependencies)).toMatchObject({ fsPercent: 90, pass: true });
  });

  it("fails below the threshold", () => {
    const dependencies = [dependency("d1", "A", "B", "FS"), dependency("d2", "A", "B", "SS")];
    expect(dcmaRelationshipTypes(dependencies)).toMatchObject({ fsPercent: 50, pass: false });
  });

  it("treats no dependencies as 100% (vacuously true)", () => {
    expect(dcmaRelationshipTypes([])).toMatchObject({ fsPercent: 100, pass: true });
  });
});

describe("schedulingEvmDcma — dcmaHardConstraints", () => {
  it("excludes milestones and flags must_start_on/must_finish_on activities", () => {
    const blocks = [
      block("A", { constraint_type: "must_finish_on", constraint_date: "2026-02-01" }),
      block("B"), block("C"), block("M", { block_type: "milestone", constraint_type: "must_start_on", constraint_date: "2026-01-01" }),
    ];
    expect(dcmaHardConstraints(blocks)).toMatchObject({ hardCount: 1, totalActivities: 3, pass: false });
  });
});

describe("schedulingEvmDcma — dcmaFloatMetrics", () => {
  it("flags negative float and high float separately", () => {
    const blocks = [
      block("A", { total_float_days: -1 }), block("B", { total_float_days: 50 }),
      block("C", { total_float_days: 0 }), block("D", { total_float_days: 0 }),
    ];
    const result = dcmaFloatMetrics(blocks);
    expect(result.negativeFloatCount).toBe(1);
    expect(result.negativeFloatPass).toBe(false);
    expect(result.highFloatCount).toBe(1);
  });

  it("passes with healthy float across the board", () => {
    const blocks = [block("A", { total_float_days: 0 }), block("B", { total_float_days: 5 })];
    expect(dcmaFloatMetrics(blocks)).toMatchObject({ negativeFloatPass: true, highFloatPass: true });
  });
});

describe("schedulingEvmDcma — dcmaDurationMetrics", () => {
  it("flags tasks over 44 working days, excluding milestones/hammocks", () => {
    const blocks = [block("A", { duration_days: 50 }), block("B", { duration_days: 10 }), block("H", { block_type: "hammock", duration_days: 90 })];
    expect(dcmaDurationMetrics(blocks)).toMatchObject({ highDurationCount: 1, totalTasks: 2, pass: false });
  });
});

describe("schedulingEvmDcma — dcmaInvalidDates", () => {
  it("flags an actual date recorded after the status date", () => {
    const blocks = [block("A", { actual_finish: "2026-01-10" })];
    expect(dcmaInvalidDates(blocks, "2026-01-05")).toMatchObject({ invalidCount: 1, taskCodes: ["A"], pass: false });
  });

  it("passes when every actual date is on or before the status date", () => {
    const blocks = [block("A", { actual_start: "2026-01-01", actual_finish: "2026-01-05" })];
    expect(dcmaInvalidDates(blocks, "2026-01-05")).toMatchObject({ invalidCount: 0, pass: true });
  });
});

describe("schedulingEvmDcma — dcmaResourceAssignment", () => {
  it("computes the percent of activities with at least one assignment, excluding hammocks", () => {
    const blocks = [block("A"), block("B"), block("H", { block_type: "hammock" })];
    const assignments = [{ block_id: "A", resource_id: "r1" }];
    expect(dcmaResourceAssignment(blocks, assignments)).toMatchObject({ assignedCount: 1, totalActivities: 2, percent: 50 });
  });
});

describe("schedulingEvmDcma — dcmaMissedTasks", () => {
  it("counts a due-but-incomplete task as missed", () => {
    const baselineBlocks = [{ block_task_code: "A", baseline_finish: "2026-01-05" }];
    const currentBlocksByTaskCode = new Map([["A", { percent_complete: 60, actual_finish: null }]]);
    expect(dcmaMissedTasks(baselineBlocks, currentBlocksByTaskCode, "2026-01-10")).toMatchObject({ dueCount: 1, missedCount: 1, taskCodes: ["A"] });
  });

  it("does not count a completed task as missed", () => {
    const baselineBlocks = [{ block_task_code: "A", baseline_finish: "2026-01-05" }];
    const currentBlocksByTaskCode = new Map([["A", { percent_complete: 100, actual_finish: "2026-01-04" }]]);
    expect(dcmaMissedTasks(baselineBlocks, currentBlocksByTaskCode, "2026-01-10")).toMatchObject({ dueCount: 1, missedCount: 0 });
  });

  it("does not count a task removed since baseline as missed", () => {
    const baselineBlocks = [{ block_task_code: "GONE", baseline_finish: "2026-01-05" }];
    expect(dcmaMissedTasks(baselineBlocks, new Map(), "2026-01-10")).toMatchObject({ dueCount: 1, missedCount: 0 });
  });

  it("excludes not-yet-due baseline tasks", () => {
    const baselineBlocks = [{ block_task_code: "A", baseline_finish: "2026-02-01" }];
    expect(dcmaMissedTasks(baselineBlocks, new Map(), "2026-01-10")).toMatchObject({ dueCount: 0, missedCount: 0 });
  });
});

describe("schedulingEvmDcma — dcmaCriticalPathLengthIndex", () => {
  it("computes a healthy ~1.0 index when the critical path has zero float", () => {
    const result = dcmaCriticalPathLengthIndex({ baselineProjectFinish: "2026-01-15", asOfDate: "2026-01-05", criticalPathTotalFloatDays: 0 });
    expect(result.cpli).toBe(1);
  });

  it("returns null once the baseline finish date has already passed", () => {
    const result = dcmaCriticalPathLengthIndex({ baselineProjectFinish: "2026-01-01", asOfDate: "2026-01-05", criticalPathTotalFloatDays: 0 });
    expect(result.cpli).toBeNull();
  });
});

describe("schedulingEvmDcma — dcmaBaselineExecutionIndex", () => {
  it("computes the ratio of on-time-completed to due", () => {
    const baselineBlocks = [{ block_task_code: "A", baseline_finish: "2026-01-01" }, { block_task_code: "B", baseline_finish: "2026-01-02" }];
    const currentBlocksByTaskCode = new Map([
      ["A", { percent_complete: 100, actual_finish: "2026-01-01" }],
      ["B", { percent_complete: 40, actual_finish: null }],
    ]);
    expect(dcmaBaselineExecutionIndex(baselineBlocks, currentBlocksByTaskCode, "2026-01-10")).toMatchObject({ bei: 0.5, dueCount: 2, completedCount: 1 });
  });

  it("returns null (not zero) when nothing is due yet", () => {
    expect(dcmaBaselineExecutionIndex([], new Map(), "2026-01-10")).toMatchObject({ bei: null, dueCount: 0 });
  });
});

describe("schedulingEvmDcma — computeDcmaMetrics", () => {
  it("aggregates all eleven arithmetic points into one report", () => {
    const blocks = [block("A"), block("B")];
    const dependencies = [dependency("d1", "A", "B")];
    const result = computeDcmaMetrics({ blocks, dependencies, assignments: [], baselineBlocks: [], asOfDate: "2026-01-05" });
    expect(Object.keys(result)).toEqual([
      "logic", "leadsAndLags", "relationshipTypes", "hardConstraints", "float", "duration",
      "invalidDates", "resources", "missedTasks", "baselineExecutionIndex",
    ]);
  });
});

describe("schedulingEvmDcma — runCriticalPathTest", () => {
  it("passes for a single-terminal chain whose extension pushes the finish date forward", () => {
    const blocks = [block("A", { duration_days: 5 }), block("B", { duration_days: 5 })];
    const dependencies = [dependency("d1", "A", "B")];
    const result = runCriticalPathTest({ project: project(), blocks, dependencies, calendars: CALENDARS, lanes: LANES, testDays: 10 });
    expect(result.pass).toBe(true);
    expect(result.drivingTaskCode).toBe("B");
    expect(result.shiftDays).toBeGreaterThan(0);
  });

  it("fails when more than one terminal activity exists (open-ended logic)", () => {
    const blocks = [block("A", { duration_days: 5 }), block("B", { duration_days: 5 }), block("C", { duration_days: 3 })];
    // A -> B is linked; C has no predecessor and no successor -- a second, disconnected terminal.
    const dependencies = [dependency("d1", "A", "B")];
    const result = runCriticalPathTest({ project: project(), blocks, dependencies, calendars: CALENDARS, lanes: LANES });
    expect(result.pass).toBe(false);
    expect(result.terminalTaskCodes).toEqual(["B", "C"]);
  });

  it("fails when a hard must_finish_on constraint pins the terminal activity regardless of duration", () => {
    const blocks = [block("A", { duration_days: 5, constraint_type: "must_finish_on", constraint_date: "2026-01-09" })];
    const result = runCriticalPathTest({ project: project(), blocks, dependencies: [], calendars: CALENDARS, lanes: LANES, testDays: 10 });
    expect(result.pass).toBe(false);
    expect(result.shiftDays).toBe(0);
  });

  it("returns pass:null with a reason when there are no Gantt blocks", () => {
    const result = runCriticalPathTest({ project: project(), blocks: [], dependencies: [] });
    expect(result.pass).toBeNull();
    expect(result.reason).toBeTruthy();
  });
});
