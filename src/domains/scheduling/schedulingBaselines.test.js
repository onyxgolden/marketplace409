import { describe, expect, it } from "vitest";
import { captureBaseline, computeBlockVariance, computeScheduleVariance, rollupProjectVariance } from "./schedulingBaselines";

// Anchored to the same confirmed Monday used by schedulingCpmEngine.test.js (2026-01-05), so dates
// here are cross-checkable against that file. This module does pure calendar-day arithmetic (no
// working-day calendar walking), so weekday identity isn't functionally load-bearing -- it's kept
// purely for independent verifiability.

function baselineBlock(taskCode, overrides = {}) {
  return {
    block_task_code: taskCode, label: taskCode, block_type: "task",
    baseline_start: "2026-01-05", baseline_finish: "2026-01-09", baseline_duration_days: 3,
    percent_complete: 0, total_float_days: 0, is_critical: true,
    ...overrides,
  };
}

function currentBlock(taskCode, overrides = {}) {
  return {
    task_code: taskCode, label: taskCode, block_type: "task",
    early_start: "2026-01-05", early_finish: "2026-01-09", duration_days: 3,
    percent_complete: 0, total_float_days: 0, is_critical: true,
    actual_start: null, actual_finish: null,
    ...overrides,
  };
}

describe("schedulingBaselines — captureBaseline", () => {
  it("snapshots CPM-computed dates, not any raw constraint start_date", () => {
    const project = { id: "proj_1" };
    const blocks = [
      { task_code: "A", label: "Task A", block_type: "task", early_start: "2026-01-05", early_finish: "2026-01-07", duration_days: 3, percent_complete: 50, total_float_days: 0, is_critical: true },
    ];
    const { baseline, baselineBlocks } = captureBaseline({ project, blocks, name: "Initial Baseline", ownerId: "owner_1", baselineId: "bl_1", createdAt: "2026-01-05T00:00:00.000Z" });

    expect(baseline).toMatchObject({ owner_id: "owner_1", id: "bl_1", schedule_project_id: "proj_1", name: "Initial Baseline" });
    expect(baselineBlocks).toHaveLength(1);
    expect(baselineBlocks[0]).toMatchObject({
      block_task_code: "A", label: "Task A", block_type: "task",
      baseline_start: "2026-01-05", baseline_finish: "2026-01-07",
      baseline_duration_days: 3, percent_complete: 50, total_float_days: 0, is_critical: true,
    });
  });

  it("returns zero baseline blocks for an empty blocks array, no throw", () => {
    const { baseline, baselineBlocks } = captureBaseline({ project: { id: "proj_1" }, blocks: [], name: "Empty", ownerId: "owner_1", baselineId: "bl_1", createdAt: "2026-01-05T00:00:00.000Z" });
    expect(baseline.id).toBe("bl_1");
    expect(baselineBlocks).toEqual([]);
  });

  it("snapshots a hammock block the same way as any other block (early_start/early_finish already resolved by the CPM engine)", () => {
    const blocks = [{ task_code: "H", label: "Hammock", block_type: "hammock", early_start: "2026-01-05", early_finish: "2026-01-14", duration_days: 0, percent_complete: 0, total_float_days: 2, is_critical: false }];
    const { baselineBlocks } = captureBaseline({ project: { id: "proj_1" }, blocks, name: "B", ownerId: "owner_1", baselineId: "bl_1", createdAt: "2026-01-05T00:00:00.000Z" });
    expect(baselineBlocks[0]).toMatchObject({ block_type: "hammock", baseline_start: "2026-01-05", baseline_finish: "2026-01-14" });
  });
});

describe("schedulingBaselines — computeBlockVariance", () => {
  it("scenario A: zero variance when the task finishes exactly on baseline (using actual_finish)", () => {
    const variance = computeBlockVariance(baselineBlock("A"), currentBlock("A", { actual_finish: "2026-01-09" }));
    expect(variance).toMatchObject({
      taskCode: "A", startVarianceDays: 0, finishVarianceDays: 0, durationVarianceDays: 0,
      usedActualStart: false, usedActualFinish: true,
    });
  });

  it("scenario B: slipping task with unchanged duration -- finish variance and duration variance are distinct", () => {
    const variance = computeBlockVariance(baselineBlock("B"), currentBlock("B", { early_start: "2026-01-12", early_finish: "2026-01-16" }));
    expect(variance).toMatchObject({
      taskCode: "B", startVarianceDays: 7, finishVarianceDays: 7, durationVarianceDays: 0,
      usedActualStart: false, usedActualFinish: false,
    });
  });

  it("scenario C: actual_finish earlier than the CPM-projected early_finish proves actual precedence", () => {
    // early_finish exactly matches the baseline (would give 0 if early_finish were used instead of actual_finish).
    const variance = computeBlockVariance(baselineBlock("C"), currentBlock("C", { actual_start: "2026-01-05", actual_finish: "2026-01-08", early_finish: "2026-01-09" }));
    expect(variance).toMatchObject({
      taskCode: "C", finishVarianceDays: -1, durationVarianceDays: -1,
      usedActualStart: true, usedActualFinish: true,
    });
  });

  it("uses early_finish for the finish side when only actual_start is set (the two sides are independent)", () => {
    const variance = computeBlockVariance(baselineBlock("D"), currentBlock("D", { actual_start: "2026-01-05", actual_finish: null, early_finish: "2026-01-12" }));
    expect(variance).toMatchObject({ usedActualStart: true, usedActualFinish: false, finishVarianceDays: 3 });
  });
});

describe("schedulingBaselines — computeScheduleVariance", () => {
  it("scenario D: reports a block removed since baseline without crashing or fabricating variance", () => {
    const result = computeScheduleVariance({ baselineBlocks: [baselineBlock("REMOVED-1", { label: "Deleted Scope Item" })], currentBlocks: [] });
    expect(result.compared).toEqual([]);
    expect(result.removedSinceBaseline).toEqual([{ taskCode: "REMOVED-1", label: "Deleted Scope Item" }]);
    expect(result.addedSinceBaseline).toEqual([]);
  });

  it("scenario E: reports a block added since baseline", () => {
    const result = computeScheduleVariance({ baselineBlocks: [], currentBlocks: [currentBlock("ADDED-1", { label: "New Scope Item" })] });
    expect(result.addedSinceBaseline).toEqual([{ taskCode: "ADDED-1", label: "New Scope Item" }]);
    expect(result.compared).toEqual([]);
    expect(result.removedSinceBaseline).toEqual([]);
  });

  it("compares a block present in both baseline and current", () => {
    const result = computeScheduleVariance({ baselineBlocks: [baselineBlock("A")], currentBlocks: [currentBlock("A", { actual_finish: "2026-01-09" })] });
    expect(result.compared).toHaveLength(1);
    expect(result.compared[0]).toMatchObject({ taskCode: "A", finishVarianceDays: 0 });
  });
});

describe("schedulingBaselines — rollupProjectVariance", () => {
  it("scenario F: project-level finish variance across a multi-block scenario, including an added-since-baseline block", () => {
    const baselineBlocks = [
      baselineBlock("A", { baseline_finish: "2026-01-09" }),
      baselineBlock("B", { baseline_finish: "2026-01-16" }),
      baselineBlock("C", { baseline_finish: "2026-01-12" }),
    ];
    const currentBlocks = [
      currentBlock("A", { actual_finish: "2026-01-09" }),
      currentBlock("B", { early_finish: "2026-01-21" }),
      currentBlock("C", { actual_finish: "2026-01-13" }),
      currentBlock("D", { early_finish: "2026-01-23" }), // added since baseline, no baseline counterpart
    ];

    const rollup = rollupProjectVariance({ baselineBlocks, currentBlocks });

    expect(rollup).toMatchObject({
      baselineProjectFinish: "2026-01-16",
      currentProjectFinish: "2026-01-23",
      projectFinishVarianceDays: 7,
    });
  });

  it("returns null fields (not zero) when both sets are empty, no throw", () => {
    const rollup = rollupProjectVariance({ baselineBlocks: [], currentBlocks: [] });
    expect(rollup).toEqual({ baselineProjectFinish: null, currentProjectFinish: null, projectFinishVarianceDays: null });
  });
});
