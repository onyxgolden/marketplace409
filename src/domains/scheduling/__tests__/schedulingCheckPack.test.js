import { describe, expect, it } from "vitest";
import {
  CHECK_DEFINITIONS,
  CHECK_FIELDS,
  getCheckDefinition,
  runCheckPack,
} from "../schedulingCheckPack.js";
import { dcmaFloatMetrics, dcmaInvalidDates, dcmaLogicDensity } from "../schedulingEvmDcma.js";

const DATA_DATE = "2026-09-22";

// Fixture: 7 activities, each flagged by exactly one check (plus one clean).
// Block ids double as task codes for readability.
const BLOCKS = [
  { id: "A1", taskCode: "A1", label: "Broken scope", blockType: "task" },
  { id: "A2", taskCode: "A2", label: "In progress work", blockType: "task" },
  { id: "A3", taskCode: "A3", label: "Future actual start", blockType: "task" },
  { id: "A4", taskCode: "A4", label: "Future actual finish", blockType: "task" },
  { id: "A5", taskCode: "A5", label: "No WBS code", blockType: "task" },
  { id: "A6", taskCode: "A6", label: "Late constraint", blockType: "task" },
  { id: "A7", taskCode: "A7", label: "Healthy", blockType: "task" },
  { id: "M1", taskCode: "M1", label: "Project milestone", blockType: "milestone" },
];

// A1 floats free (broken). Everyone else chains: A2->A3->A4->A5->A6->A7->M1.
// M1 has no successors but is a milestone, so it must never count as broken.
const DEPENDENCIES = [
  { predecessorId: "A2", successorId: "A3" },
  { predecessorId: "A3", successorId: "A4" },
  { predecessorId: "A4", successorId: "A5" },
  { predecessorId: "A5", successorId: "A6" },
  { predecessorId: "A6", successorId: "A7" },
  { predecessorId: "A7", successorId: "M1" },
];

function progress(overrides) {
  return {
    earlyStart: "2026-09-10",
    earlyFinish: "2026-09-17",
    totalFloatDays: 5,
    percentComplete: 0,
    actualStart: null,
    actualFinish: null,
    ...overrides,
  };
}

const CPM = {
  A1: progress(),
  A2: progress({ percentComplete: 40 }),
  A3: progress({ actualStart: "2026-09-23" }),
  A4: progress({ percentComplete: 100, actualFinish: "2026-09-23" }),
  A5: progress(),
  A6: progress({ totalFloatDays: -3 }),
  A7: progress(),
  M1: progress({ totalFloatDays: null }),
};

// Everything coded except A5.
const WBS_ACTIVITIES = ["A1", "A2", "A3", "A4", "A6", "A7", "M1"].map((code) => ({ code, wbsId: "w1" }));

const INPUT = {
  blocks: BLOCKS,
  dependencies: DEPENDENCIES,
  cpmByTaskCode: CPM,
  wbsActivities: WBS_ACTIVITIES,
  dataDate: DATA_DATE,
};

function flaggedIds(report, checkId) {
  return report.checks.find((check) => check.id === checkId).rows.map((row) => row.activityId);
}

describe("schedulingCheckPack definitions", () => {
  it("exposes exactly the six immutable built-in checks", () => {
    expect(CHECK_DEFINITIONS).toHaveLength(6);
    expect(CHECK_DEFINITIONS.map((def) => def.id)).toEqual([
      "broken_activities",
      "gapped_activities",
      "start_in_future",
      "finish_in_future",
      "uncoded",
      "negative_float",
    ]);
    expect(Object.isFrozen(CHECK_DEFINITIONS)).toBe(true);
    for (const def of CHECK_DEFINITIONS) {
      expect(Object.isFrozen(def)).toBe(true);
      expect(Object.isFrozen(def.columns)).toBe(true);
    }
  });

  it("uses only known column fields, with unique check and action ids", () => {
    const ids = CHECK_DEFINITIONS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    const actions = CHECK_DEFINITIONS.map((def) => def.action);
    expect(new Set(actions).size).toBe(actions.length);
    for (const def of CHECK_DEFINITIONS) {
      for (const column of def.columns) {
        expect(Object.hasOwn(CHECK_FIELDS, column)).toBe(true);
      }
    }
  });

  it("getCheckDefinition resolves by id", () => {
    expect(getCheckDefinition("negative_float").label).toBe("Negative Float");
    expect(getCheckDefinition("nope")).toBeNull();
  });

  it("negative float carries the task's example column preset", () => {
    expect(getCheckDefinition("negative_float").columns).toEqual(["activityId", "name", "start", "finish", "float"]);
  });
});

describe("schedulingCheckPack filters", () => {
  it("flags each activity under exactly its own check", () => {
    const report = runCheckPack(INPUT);
    expect(flaggedIds(report, "broken_activities")).toEqual(["A1"]);
    expect(flaggedIds(report, "gapped_activities")).toEqual(["A2"]);
    expect(flaggedIds(report, "start_in_future")).toEqual(["A3"]);
    expect(flaggedIds(report, "finish_in_future")).toEqual(["A4"]);
    expect(flaggedIds(report, "uncoded")).toEqual(["A5"]);
    expect(flaggedIds(report, "negative_float")).toEqual(["A6"]);
    const allFlagged = report.checks.flatMap((check) => flaggedIds(report, check.id));
    expect(allFlagged.filter((id) => id === "A7")).toEqual([]);
  });

  it("never flags a milestone as broken", () => {
    const report = runCheckPack(INPUT);
    expect(flaggedIds(report, "broken_activities")).not.toContain("M1");
  });

  it("reports summary counts and a needs_attention/clean status per check", () => {
    const report = runCheckPack(INPUT);
    const negativeFloat = report.checks.find((check) => check.id === "negative_float");
    expect(negativeFloat.flaggedCount).toBe(1);
    expect(negativeFloat.totalActivities).toBe(8);
    expect(negativeFloat.status).toBe("needs_attention");
    expect(negativeFloat.completed).toBe(false);
    const empty = runCheckPack({ blocks: [], dependencies: [], cpmByTaskCode: {}, wbsActivities: [], dataDate: DATA_DATE });
    for (const check of empty.checks) {
      expect(check.flaggedCount).toBe(0);
      expect(check.status).toBe("clean");
      expect(check.completed).toBe(true);
      expect(check.rows).toEqual([]);
    }
    expect(empty.totalActivities).toBe(0);
  });

  it("exposes the slice-4 step contract: deterministic step id, named action, counts, completion state", () => {
    const report = runCheckPack(INPUT);
    const check = report.checks.find((c) => c.id === "negative_float");
    expect(check.stepId).toBe("check_negative_float");
    expect(check.action).toBe("review_negative_float");
    expect(check.flaggedCount).toBe(1);
    expect(typeof check.completed).toBe("boolean");
    // Deterministic: same input, same step ids and actions on a second run.
    const again = runCheckPack(INPUT);
    expect(again.checks.map((c) => [c.stepId, c.action])).toEqual(report.checks.map((c) => [c.stepId, c.action]));
  });

  it("handles an empty schedule without throwing", () => {
    expect(() => runCheckPack({})).not.toThrow();
    expect(() => runCheckPack({ dataDate: DATA_DATE })).not.toThrow();
  });

  it("does not mutate its inputs", () => {
    const frozen = {
      blocks: structuredClone(BLOCKS),
      dependencies: structuredClone(DEPENDENCIES),
      cpmByTaskCode: structuredClone(CPM),
      wbsActivities: structuredClone(WBS_ACTIVITIES),
      dataDate: DATA_DATE,
    };
    const snapshot = structuredClone(frozen);
    runCheckPack(frozen);
    expect(frozen).toEqual(snapshot);
  });

  it("freezes the report", () => {
    const report = runCheckPack(INPUT);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.checks)).toBe(true);
    for (const check of report.checks) {
      expect(Object.isFrozen(check)).toBe(true);
      expect(Object.isFrozen(check.rows)).toBe(true);
    }
  });
});

describe("schedulingCheckPack DCMA contract", () => {
  // Same fixture in the relational shape the DCMA functions take, so the
  // contract below compares like with like.
  const relationalBlocks = BLOCKS.map((block) => {
    const p = CPM[block.taskCode];
    return {
      id: block.id,
      task_code: block.taskCode,
      block_type: block.blockType,
      actual_start: p.actualStart,
      actual_finish: p.actualFinish,
      total_float_days: p.totalFloatDays,
      constraint_type: null,
    };
  });
  const relationalDependencies = DEPENDENCIES.map((d) => ({ predecessor_id: d.predecessorId, successor_id: d.successorId }));

  it("start/finish-in-future flags consume dcmaInvalidDates per-activity task codes", () => {
    const invalid = dcmaInvalidDates(relationalBlocks, DATA_DATE);
    expect(invalid.invalidCount).toBe(2);
    const report = runCheckPack(INPUT);
    const union = new Set([...flaggedIds(report, "start_in_future"), ...flaggedIds(report, "finish_in_future")]);
    expect(new Set(invalid.taskCodes)).toEqual(union);
  });

  it("negative-float flags reproduce dcmaFloatMetrics' negative count", () => {
    const metrics = dcmaFloatMetrics(relationalBlocks);
    expect(metrics.negativeFloatCount).toBe(1);
    const report = runCheckPack(INPUT);
    expect(report.checks.find((c) => c.id === "negative_float").flaggedCount).toBe(metrics.negativeFloatCount);
  });

  it("broken activities are consistent with dcmaLogicDensity's missing-logic counts", () => {
    const density = dcmaLogicDensity(relationalBlocks, relationalDependencies);
    const report = runCheckPack(INPUT);
    const broken = flaggedIds(report, "broken_activities");
    // Each broken activity has neither predecessor nor successor, so it feeds
    // both missing counts exactly once.
    expect(broken).toEqual(["A1"]);
    expect(density.missingPredecessor).toBeGreaterThanOrEqual(broken.length);
    expect(density.missingSuccessor).toBeGreaterThanOrEqual(broken.length);
  });
});
