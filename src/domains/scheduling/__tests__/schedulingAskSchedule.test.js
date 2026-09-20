import { describe, expect, it } from "vitest";
import {
  SUPPORTED_SCHEDULE_QUESTIONS,
  chicagoTodayISO,
  parseScheduleQuestion,
  answerScheduleQuestion,
  answerCriticalPath,
  answerConstraints,
  answerFloat,
  answerLateMilestones,
  answerBaselineVariance,
} from "../schedulingAskSchedule";
import { detectConflicts } from "../schedulingCpmEngine";

const BLOCKS = [
  {
    id: "block_a1010", task_code: "A1010", label: "Mobilize", block_type: "task",
    early_start: "2026-01-05", early_finish: "2026-01-09",
    late_start: "2026-01-05", late_finish: "2026-01-09",
    total_float_days: 0, is_critical: true, constraint_type: null, constraint_date: null,
    percent_complete: 100,
  },
  {
    id: "block_a1020", task_code: "A1020", label: "Framing", block_type: "task",
    early_start: "2026-01-12", early_finish: "2026-01-23",
    late_start: "2026-01-12", late_finish: "2026-01-23",
    total_float_days: 0, is_critical: true, constraint_type: "must_start_on", constraint_date: "2026-01-12",
    percent_complete: 40,
  },
  {
    id: "block_a1030", task_code: "A1030", label: "Rough-in", block_type: "task",
    early_start: "2026-01-12", early_finish: "2026-01-20",
    late_start: "2026-01-15", late_finish: "2026-01-23",
    total_float_days: 3, is_critical: false, constraint_type: null, constraint_date: null,
    percent_complete: 0,
  },
  {
    id: "block_m1040", task_code: "M1040", label: "Dry-in milestone", block_type: "milestone",
    early_start: "2026-01-26", early_finish: "2026-01-26",
    late_start: "2026-01-28", late_finish: "2026-01-28",
    total_float_days: 2, is_critical: false, constraint_type: "FNLT", constraint_date: "2026-01-24",
    percent_complete: 0,
  },
  {
    id: "block_m1050", task_code: "M1050", label: "Old milestone", block_type: "milestone",
    early_start: "2025-12-01", early_finish: "2025-12-01",
    late_start: "2025-12-01", late_finish: "2025-12-01",
    total_float_days: 0, is_critical: true, constraint_type: null, constraint_date: null,
    percent_complete: 20,
  },
];

describe("parseScheduleQuestion", () => {
  it("routes critical-path phrasings", () => {
    expect(parseScheduleQuestion("What is the critical path?").type).toBe("critical_path");
    expect(parseScheduleQuestion("show me critical activities").type).toBe("critical_path");
  });
  it("routes near-critical to float, not to critical path", () => {
    expect(parseScheduleQuestion("which activities are near critical?").type).toBe("float");
    expect(parseScheduleQuestion("near-critical tasks").type).toBe("float");
  });
  it("routes constraint questions", () => {
    expect(parseScheduleQuestion("Which activities have constraints?").type).toBe("constraints");
  });
  it("routes float questions, capturing an activity reference", () => {
    const ranked = parseScheduleQuestion("Which activities have the least float?");
    expect(ranked.type).toBe("float");
    expect(ranked.activityQuery).toBeNull();
    const targeted = parseScheduleQuestion("What is the float for Framing?");
    expect(targeted.type).toBe("float");
    expect(targeted.activityQuery).toBe("framing");
  });
  it("routes milestone and baseline questions", () => {
    expect(parseScheduleQuestion("Which milestones are late?").type).toBe("late_milestones");
    expect(parseScheduleQuestion("What changed since the baseline?").type).toBe("baseline_variance");
    expect(parseScheduleQuestion("show baseline variance").type).toBe("baseline_variance");
  });
  it("routes help phrasings and unknown input", () => {
    expect(parseScheduleQuestion("help").type).toBe("help");
    expect(parseScheduleQuestion("what can you answer?").type).toBe("help");
    const unknown = parseScheduleQuestion("order more lumber");
    expect(unknown.type).toBe("unknown");
    expect(parseScheduleQuestion("").type).toBe("unknown");
    expect(parseScheduleQuestion(null).type).toBe("unknown");
  });
});

describe("answerCriticalPath", () => {
  it("lists critical activities ordered by early start with the project finish", () => {
    const answer = answerCriticalPath({}, { cpmBlocks: BLOCKS });
    expect(answer.questionType).toBe("critical_path");
    expect(answer.items.map((item) => item.taskCode)).toEqual(["M1050", "A1010", "A1020"]);
    expect(answer.summary).toContain("3 critical activities");
    expect(answer.summary).toContain("2026-01-26");
  });
  it("reports no critical activities when the schedule has none", () => {
    const answer = answerCriticalPath({}, { cpmBlocks: BLOCKS.map((b) => ({ ...b, is_critical: false })) });
    expect(answer.items).toEqual([]);
    expect(answer.summary).toContain("No critical activities");
  });
});

describe("answerConstraints", () => {
  it("lists constrained activities and flags dependency conflicts via the engine's blockId contract", () => {
    const answer = answerConstraints({}, {
      cpmBlocks: BLOCKS,
      conflicts: [{ type: "constraint_conflict", blockId: "block_a1020" }],
    });
    expect(answer.questionType).toBe("constraints");
    expect(answer.items.map((item) => item.taskCode)).toEqual(["A1020", "M1040"]);
    expect(answer.items[0].detail).toContain("conflicts with the dependency network");
    expect(answer.items[1].detail).not.toContain("conflicts");
  });
  it("flags conflicts produced by the real engine, not an invented shape", () => {
    // A must_finish_on block whose dependency network alone would finish later
    // than the constraint allows -- straight from detectConflicts' real output.
    const conflicts = detectConflicts({
      blocks: [{
        id: "block_a1020", task_code: "A1020", label: "Framing",
        constraint_type: "must_finish_on", constraint_date: "2026-01-12",
      }],
      cyclicBlockIds: new Set(),
      danglingDependencies: [],
      hammockDependencies: [],
      forwardResults: new Map([["block_a1020", {
        dependencyOnlyEarlyStart: "2026-01-10",
        dependencyOnlyEarlyFinish: "2026-01-20",
      }]]),
      hammockAnomalies: [],
    });
    expect(conflicts.some((c) => c.type === "constraint_conflict" && c.blockId === "block_a1020")).toBe(true);
    const answer = answerConstraints({}, {
      cpmBlocks: BLOCKS.filter((b) => b.task_code === "A1020"),
      conflicts,
    });
    expect(answer.items).toHaveLength(1);
    expect(answer.items[0].detail).toContain("conflicts with the dependency network");
  });
  it("ignores invented task_code/task_codes fields on conflicts", () => {
    const answer = answerConstraints({}, {
      cpmBlocks: BLOCKS,
      conflicts: [{ type: "constraint_conflict", task_code: "A1020", task_codes: ["M1040"] }],
    });
    expect(answer.items.every((item) => !item.detail.includes("conflicts with"))).toBe(true);
  });
  it("reports when nothing is constrained", () => {
    const answer = answerConstraints({}, { cpmBlocks: BLOCKS.map((b) => ({ ...b, constraint_type: null, constraint_date: null })) });
    expect(answer.summary).toContain("No activities carry a date constraint");
  });
});

describe("answerFloat", () => {
  it("ranks non-critical activities by lowest float first", () => {
    const answer = answerFloat({ type: "float", activityQuery: null }, { cpmBlocks: BLOCKS });
    expect(answer.items.map((item) => item.taskCode)).toEqual(["M1040", "A1030"]);
    expect(answer.summary).toContain("3 critical activities (min float 0d)");
    expect(answer.summary).not.toContain("zero float");
  });
  it("answers a targeted float question by label or task code", () => {
    const byLabel = answerFloat({ type: "float", activityQuery: "framing" }, { cpmBlocks: BLOCKS });
    expect(byLabel.items[0].taskCode).toBe("A1020");
    expect(byLabel.summary).toContain("0 days of total float (critical)");
    const byCode = answerFloat({ type: "float", activityQuery: "a1030" }, { cpmBlocks: BLOCKS });
    expect(byCode.items[0].taskCode).toBe("A1030");
    expect(byCode.summary).toContain("3 days of total float");
  });
  it("prefers an exact task code over a partial label containing it", () => {
    const blocks = [
      { id: "b1", task_code: "A10", label: "A1020 staging area", block_type: "task", total_float_days: 5, is_critical: false, early_start: "2026-01-05", early_finish: "2026-01-09", late_start: "2026-01-10", late_finish: "2026-01-14" },
      { id: "b2", task_code: "A1020", label: "Framing", block_type: "task", total_float_days: 2, is_critical: false, early_start: "2026-01-12", early_finish: "2026-01-23", late_start: "2026-01-14", late_finish: "2026-01-25" },
    ];
    const answer = answerFloat({ type: "float", activityQuery: "a1020" }, { cpmBlocks: blocks });
    expect(answer.items[0].taskCode).toBe("A1020");
  });
  it("resolves a partial label match only when it is unambiguous", () => {
    const answer = answerFloat({ type: "float", activityQuery: "rough" }, { cpmBlocks: BLOCKS });
    expect(answer.items[0].taskCode).toBe("A1030");
  });
  it("returns an explicit ambiguity result instead of picking an arbitrary activity", () => {
    const blocks = [
      { id: "b1", task_code: "A1020", label: "Framing", block_type: "task", total_float_days: 2, is_critical: false },
      { id: "b2", task_code: "A1021", label: "Framing punchlist", block_type: "task", total_float_days: 4, is_critical: false },
      { id: "b3", task_code: "A1030", label: "Rough-in", block_type: "task", total_float_days: 3, is_critical: false },
    ];
    // "fram" is not an exact label of either candidate, so the partial match
    // must surface the ambiguity instead of picking one.
    const answer = answerFloat({ type: "float", activityQuery: "fram" }, { cpmBlocks: blocks });
    expect(answer.questionType).toBe("float");
    expect(answer.summary).toContain('matches 2 activities');
    expect(answer.items.map((item) => item.taskCode)).toEqual(["A1020", "A1021"]);
    // No single activity was selected -- the items are the candidates.
    expect(answer.summary).not.toContain("days of total float");
  });
  it("reports an unmatched activity reference without guessing", () => {
    const answer = answerFloat({ type: "float", activityQuery: "roofing" }, { cpmBlocks: BLOCKS });
    expect(answer.items).toEqual([]);
    expect(answer.summary).toContain('No activity matches "roofing"');
  });
  it("reports the actual critical float, which can be negative", () => {
    const negative = BLOCKS.map((b) => (b.is_critical ? { ...b, total_float_days: -2 } : b));
    const answer = answerFloat({ type: "float", activityQuery: null }, { cpmBlocks: negative });
    expect(answer.summary).toContain("3 critical activities (min float -2d)");
    expect(answer.summary).not.toContain("zero float");
  });
  it("describes an all-critical schedule without claiming zero float", () => {
    const allCritical = BLOCKS.map((b) => ({ ...b, is_critical: true, total_float_days: -1 }));
    const answer = answerFloat({ type: "float", activityQuery: null }, { cpmBlocks: allCritical });
    expect(answer.summary).toContain("Every scheduled activity is critical (min float -1d)");
    expect(answer.summary).not.toContain("zero float");
  });
});

describe("answerLateMilestones", () => {
  it("flags milestones past their finish constraint and past-due incomplete milestones", () => {
    const answer = answerLateMilestones({}, { cpmBlocks: BLOCKS, todayISO: "2026-01-15" });
    expect(answer.questionType).toBe("late_milestones");
    expect(answer.items.map((item) => item.taskCode)).toEqual(["M1040", "M1050"]);
    expect(answer.items[0].detail).toContain("constrained to finish by 2026-01-24");
    expect(answer.items[1].detail).toContain("past due");
    expect(answer.summary).toContain("2 of 2 milestones are late");
  });
  it("reports all milestones on track when none are late", () => {
    const onTrack = BLOCKS.map((b) => b.block_type === "milestone"
      ? { ...b, early_start: "2026-03-01", early_finish: "2026-03-01", constraint_type: null, constraint_date: null, percent_complete: 0 }
      : b);
    const answer = answerLateMilestones({}, { cpmBlocks: onTrack, todayISO: "2026-01-15" });
    expect(answer.items).toEqual([]);
    expect(answer.summary).toContain("on track");
  });
  it("does not flag a completed past-due milestone as late", () => {
    const done = BLOCKS.map((b) => (b.task_code === "M1050" ? { ...b, percent_complete: 100 } : b));
    const answer = answerLateMilestones({}, { cpmBlocks: done, todayISO: "2026-01-15" });
    expect(answer.items.map((item) => item.taskCode)).toEqual(["M1040"]);
  });
  it("does not flag a completed milestone with a finish-constraint violation as late", () => {
    // M1040 violates its FNLT constraint (scheduled 2026-01-26 vs 2026-01-24),
    // but 100% complete means done -- never late.
    const done = BLOCKS.map((b) => (b.task_code === "M1040" ? { ...b, percent_complete: 100 } : b));
    const answer = answerLateMilestones({}, { cpmBlocks: done, todayISO: "2026-01-15" });
    expect(answer.items.map((item) => item.taskCode)).toEqual(["M1050"]);
  });
});

describe("chicagoTodayISO", () => {
  it("returns the Chicago date, not UTC, for a late-evening instant", () => {
    // 2026-09-19 23:30 in Chicago (CDT) is 2026-09-20 04:30 UTC -- the old
    // toISOString().slice(0, 10) returned the 20th and marked milestones late
    // a day early.
    expect(chicagoTodayISO(new Date("2026-09-20T04:30:00Z"))).toBe("2026-09-19");
  });
  it("keeps the Chicago date for instants from positive-offset timezones", () => {
    // A 09:30 +09:00 reading is 00:30 UTC; in Chicago (CDT) it is still the
    // previous calendar day.
    expect(chicagoTodayISO(new Date("2026-06-15T00:30:00Z"))).toBe("2026-06-14");
  });
  it("never shifts a date-only schedule value", () => {
    expect(chicagoTodayISO(new Date("2026-01-15T12:00:00Z"))).toBe("2026-01-15");
  });
});

describe("answerBaselineVariance", () => {
  const baseline = {
    name: "Baseline 1",
    compared: [
      { taskCode: "A1010", startVarianceDays: 0, finishVarianceDays: 5 },
      { taskCode: "A1020", startVarianceDays: 0, finishVarianceDays: 0 },
    ],
    addedSinceBaseline: [{ taskCode: "A1090", label: "Extra work" }],
    removedSinceBaseline: [],
    rollup: { projectFinishVarianceDays: 5 },
  };
  it("summarizes moves, adds, and the project-finish shift", () => {
    const answer = answerBaselineVariance({}, { baseline });
    expect(answer.questionType).toBe("baseline_variance");
    expect(answer.summary).toContain('baseline "Baseline 1"');
    expect(answer.summary).toContain("1 moved, 1 added, 0 removed");
    expect(answer.summary).toContain("project finish +5d");
    expect(answer.items.map((item) => item.taskCode)).toEqual(["A1010", "A1090"]);
  });
  it("says so plainly when no baseline exists", () => {
    const answer = answerBaselineVariance({}, { baseline: null });
    expect(answer.items).toEqual([]);
    expect(answer.summary).toContain("No baseline has been captured");
  });
});

describe("answerScheduleQuestion dispatch", () => {
  it("never guesses on unknown questions -- it returns the supported list", () => {
    const answer = answerScheduleQuestion({ type: "unknown" }, { cpmBlocks: BLOCKS });
    expect(answer.questionType).toBe("unknown");
    expect(answer.items.length).toBe(SUPPORTED_SCHEDULE_QUESTIONS.filter((q) => q.id !== "float_for").length);
  });
  it("dispatches every supported question type", () => {
    const context = { cpmBlocks: BLOCKS, conflicts: [], todayISO: "2026-01-15", baseline: null };
    for (const type of ["critical_path", "constraints", "float", "late_milestones", "baseline_variance", "help"]) {
      const answer = answerScheduleQuestion({ type }, context);
      expect(answer.questionType).toBe(type);
      expect(typeof answer.summary).toBe("string");
    }
  });
});
