import { describe, expect, it } from "vitest";
import {
  countWorkingDaysBetween,
  isWorkingDay,
  rollToWorkingDay,
  runCpmEngine,
  stepWorkingDays,
  topologicalOrder,
} from "./schedulingCpmEngine";

// All scenarios anchored to 2026-01-05, a confirmed Monday
// (new Date("2026-01-05T00:00:00.000Z").getUTCDay() === 1), so every expected date below is
// directly assertable without re-deriving the calendar.
const MON_FRI = Object.freeze({ id: "cal_weekday", working_days: Object.freeze([1, 2, 3, 4, 5]) });

function project(overrides = {}) {
  return { id: "proj_1", start_date: "2026-01-05", end_date: "2026-02-28", default_calendar_id: MON_FRI.id, ...overrides };
}

function block(id, overrides = {}) {
  return {
    id, task_code: id, schedule_project_id: "proj_1", lane_id: "lane_1", wbs_node_id: null,
    label: id, category: "eng", block_type: "task", duration_days: 1, calendar_id: null,
    constraint_type: null, constraint_date: null, ...overrides,
  };
}

function dependency(id, predecessorId, successorId, relationshipType = "FS", lagDays = 0) {
  return { id, predecessor_id: predecessorId, successor_id: successorId, relationship_type: relationshipType, lag_days: lagDays };
}

const LANES = [{ id: "lane_1", calendar_id: null }];
const CALENDARS = [MON_FRI];

describe("schedulingCpmEngine — calendar primitives", () => {
  it("isWorkingDay is true Mon-Fri and false Sat/Sun for a weekday calendar", () => {
    expect(isWorkingDay(MON_FRI, new Set(), "2026-01-05")).toBe(true); // Monday
    expect(isWorkingDay(MON_FRI, new Set(), "2026-01-09")).toBe(true); // Friday
    expect(isWorkingDay(MON_FRI, new Set(), "2026-01-10")).toBe(false); // Saturday
    expect(isWorkingDay(MON_FRI, new Set(), "2026-01-11")).toBe(false); // Sunday
  });

  it("rollToWorkingDay walks forward from a Saturday to the following Monday", () => {
    expect(rollToWorkingDay(MON_FRI, new Set(), "2026-01-10", 1)).toBe("2026-01-12");
  });

  it("stepWorkingDays skips the weekend when stepping 5 working days from a Monday", () => {
    expect(stepWorkingDays(MON_FRI, new Set(), "2026-01-05", 5)).toBe("2026-01-12");
  });

  it("countWorkingDaysBetween counts only working days in the span", () => {
    expect(countWorkingDaysBetween(MON_FRI, new Set(), "2026-01-07", "2026-01-13")).toBe(4);
    expect(countWorkingDaysBetween(MON_FRI, new Set(), "2026-01-05", "2026-01-05")).toBe(0);
  });
});

describe("schedulingCpmEngine — topologicalOrder", () => {
  it("excludes hammock blocks from the graph and reports dependencies touching them separately", () => {
    const blocks = [block("A"), block("H", { block_type: "hammock" })];
    const deps = [dependency("d1", "A", "H")];
    const result = topologicalOrder(blocks, deps);
    expect(result.order).toEqual(["A"]);
    expect(result.hammockDependencies).toHaveLength(1);
    expect(result.validDependencies).toHaveLength(0);
  });

  it("reports a dependency referencing a block outside the passed-in blocks array as dangling", () => {
    const blocks = [block("A")];
    const deps = [dependency("d1", "A", "ghost")];
    const result = topologicalOrder(blocks, deps);
    expect(result.danglingDependencies).toHaveLength(1);
    expect(result.validDependencies).toHaveLength(0);
  });
});

describe("schedulingCpmEngine — scenario 1: simple 3-block FS chain", () => {
  it("matches the hand-computed dates exactly, all on the critical path", () => {
    const blocks = [block("A", { duration_days: 3 }), block("B", { duration_days: 2 }), block("C", { duration_days: 4 })];
    const deps = [dependency("d1", "A", "B"), dependency("d2", "B", "C")];
    const result = runCpmEngine({
      project: project({ end_date: "2026-01-15" }), blocks, dependencies: deps, calendars: CALENDARS, lanes: LANES,
    });
    const byId = Object.fromEntries(result.blocks.map((row) => [row.id, row]));
    expect(byId.A).toMatchObject({ early_start: "2026-01-05", early_finish: "2026-01-07", is_critical: true });
    expect(byId.B).toMatchObject({ early_start: "2026-01-08", early_finish: "2026-01-09", is_critical: true });
    expect(byId.C).toMatchObject({ early_start: "2026-01-12", early_finish: "2026-01-15", is_critical: true });
    expect(result.conflicts).toEqual([]);
  });
});

describe("schedulingCpmEngine — scenario 2: SS/FF/SF with lag from one predecessor", () => {
  it("matches the hand-computed dates for each relationship type", () => {
    const blocks = [
      block("P", { duration_days: 4 }),
      block("Q", { duration_days: 2 }),
      block("R", { duration_days: 1 }),
      block("S", { duration_days: 5 }),
    ];
    const deps = [
      dependency("d1", "P", "Q", "SS", 2),
      dependency("d2", "P", "R", "FF", 1),
      dependency("d3", "P", "S", "SF", 0),
    ];
    const result = runCpmEngine({
      project: project({ end_date: "2026-03-31" }), blocks, dependencies: deps, calendars: CALENDARS, lanes: LANES,
    });
    const byId = Object.fromEntries(result.blocks.map((row) => [row.id, row]));
    expect(byId.P).toMatchObject({ early_start: "2026-01-05", early_finish: "2026-01-08" });
    expect(byId.Q).toMatchObject({ early_start: "2026-01-07", early_finish: "2026-01-08" });
    expect(byId.R).toMatchObject({ early_start: "2026-01-09", early_finish: "2026-01-09" });
    expect(byId.S).toMatchObject({ early_start: "2025-12-30", early_finish: "2026-01-05" });
  });
});

describe("schedulingCpmEngine — scenario 4: holiday spanning a normally-working weekday", () => {
  it("pushes early_finish one working day later than the no-holiday case", () => {
    const blocks = [block("A", { duration_days: 4 })];
    const withoutHoliday = runCpmEngine({ project: project(), blocks, dependencies: [], calendars: CALENDARS, lanes: LANES, holidays: [] });
    const withHoliday = runCpmEngine({
      project: project(), blocks, dependencies: [], calendars: CALENDARS, lanes: LANES,
      holidays: [{ calendar_id: "cal_weekday", holiday_date: "2026-01-08", label: "Test holiday" }],
    });
    const withoutRow = withoutHoliday.blocks.find((row) => row.id === "A");
    const withRow = withHoliday.blocks.find((row) => row.id === "A");
    expect(withoutRow.early_finish).toBe("2026-01-08");
    expect(withRow.early_finish).toBe("2026-01-09");
  });
});

describe("schedulingCpmEngine — scenario 5: diamond graph, float on the non-critical leg", () => {
  it("matches every hand-computed date and puts C's float at exactly 4 working days", () => {
    const blocks = [
      block("A", { duration_days: 2 }),
      block("B", { duration_days: 5 }),
      block("C", { duration_days: 1 }),
      block("D", { duration_days: 1 }),
    ];
    const deps = [
      dependency("d1", "A", "B"),
      dependency("d2", "A", "C"),
      dependency("d3", "B", "D"),
      dependency("d4", "C", "D"),
    ];
    const result = runCpmEngine({
      project: project({ end_date: "2026-01-14" }), blocks, dependencies: deps, calendars: CALENDARS, lanes: LANES,
    });
    const byId = Object.fromEntries(result.blocks.map((row) => [row.id, row]));
    expect(byId.A).toMatchObject({ early_start: "2026-01-05", early_finish: "2026-01-06" });
    expect(byId.B).toMatchObject({ early_start: "2026-01-07", early_finish: "2026-01-13" });
    expect(byId.C).toMatchObject({ early_start: "2026-01-07", early_finish: "2026-01-07" });
    expect(byId.D).toMatchObject({ early_start: "2026-01-14", early_finish: "2026-01-14" });

    expect(byId.A.is_critical).toBe(true);
    expect(byId.B.is_critical).toBe(true);
    expect(byId.D.is_critical).toBe(true);
    expect(byId.C.is_critical).toBe(false);
    expect(byId.C.total_float_days).toBe(4);
  });
});

describe("schedulingCpmEngine — scenario 6: hard must_start_on conflicting with the dependency network", () => {
  it("overrides the computed start date and reports exactly one constraint_conflict", () => {
    const blocks = [
      block("A", { duration_days: 3 }),
      block("B", { duration_days: 2, constraint_type: "must_start_on", constraint_date: "2026-01-06" }),
      block("C", { duration_days: 4 }),
    ];
    const deps = [dependency("d1", "A", "B"), dependency("d2", "B", "C")];
    const result = runCpmEngine({
      project: project({ end_date: "2026-01-20" }), blocks, dependencies: deps, calendars: CALENDARS, lanes: LANES,
    });
    const byId = Object.fromEntries(result.blocks.map((row) => [row.id, row]));
    expect(byId.B.early_start).toBe("2026-01-06");
    expect(byId.B.early_finish).toBe("2026-01-07");

    const conflicts = result.conflicts.filter((conflict) => conflict.type === "constraint_conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ blockId: "B", constraintType: "must_start_on", constraintDate: "2026-01-06", computedDate: "2026-01-08" });
  });
});

describe("schedulingCpmEngine — scenario 7: hammock with 2 start anchors and 2 finish anchors", () => {
  it("resolves early_start/early_finish from the diamond's anchor blocks", () => {
    const blocks = [
      block("A", { duration_days: 2 }),
      block("B", { duration_days: 5 }),
      block("C", { duration_days: 1 }),
      block("D", { duration_days: 1 }),
      block("H", { block_type: "hammock", lane_id: null, wbs_node_id: "wbs_1" }),
    ];
    const deps = [
      dependency("d1", "A", "B"),
      dependency("d2", "A", "C"),
      dependency("d3", "B", "D"),
      dependency("d4", "C", "D"),
    ];
    const hammockAnchors = [
      { id: "ha1", hammock_block_id: "H", anchor_block_id: "A", anchor_role: "start" },
      { id: "ha2", hammock_block_id: "H", anchor_block_id: "C", anchor_role: "start" },
      { id: "ha3", hammock_block_id: "H", anchor_block_id: "B", anchor_role: "finish" },
      { id: "ha4", hammock_block_id: "H", anchor_block_id: "D", anchor_role: "finish" },
    ];
    const result = runCpmEngine({
      project: project({ end_date: "2026-01-14" }), blocks, dependencies: deps, calendars: CALENDARS, lanes: LANES, hammockAnchors,
    });
    const hammockRow = result.blocks.find((row) => row.id === "H");
    expect(hammockRow.early_start).toBe("2026-01-05");
    expect(hammockRow.early_finish).toBe("2026-01-14");
  });
});

describe("schedulingCpmEngine — scenario 8: cyclic dependency graph plus an unrelated block", () => {
  it("excludes only the cycle from CPM computation and still computes the unrelated block normally", () => {
    const blocks = [block("X"), block("Y"), block("Z"), block("W", { duration_days: 3 })];
    const deps = [dependency("d1", "X", "Y"), dependency("d2", "Y", "Z"), dependency("d3", "Z", "X")];
    const result = runCpmEngine({
      project: project({ end_date: "2026-01-31" }), blocks, dependencies: deps, calendars: CALENDARS, lanes: LANES,
    });
    const byId = Object.fromEntries(result.blocks.map((row) => [row.id, row]));

    for (const id of ["X", "Y", "Z"]) {
      expect(byId[id].early_start).toBeNull();
      expect(byId[id].early_finish).toBeNull();
      expect(byId[id].is_critical).toBe(false);
    }
    expect(byId.W.early_start).toBe("2026-01-05");
    expect(byId.W.is_critical).toBe(true);

    const cycleConflicts = result.conflicts.filter((conflict) => conflict.type === "cycle");
    expect(cycleConflicts).toHaveLength(1);
    expect(new Set(cycleConflicts[0].blockIds)).toEqual(new Set(["X", "Y", "Z"]));
  });
});

describe("schedulingCpmEngine — scenario 9: empty project / single block", () => {
  it("does not throw on an empty project", () => {
    const result = runCpmEngine({ project: project(), blocks: [], dependencies: [] });
    expect(result).toEqual({ blocks: [], conflicts: [] });
  });

  it("gives a lone block with no dependencies a trivial critical path (float 0)", () => {
    const blocks = [block("A", { duration_days: 2 })];
    const result = runCpmEngine({ project: project({ end_date: "2026-01-06" }), blocks, dependencies: [], calendars: CALENDARS, lanes: LANES });
    const row = result.blocks[0];
    expect(row.early_start).toBe("2026-01-05");
    expect(row.early_finish).toBe("2026-01-06");
    expect(row.total_float_days).toBe(0);
    expect(row.is_critical).toBe(true);
  });
});

describe("schedulingCpmEngine — scenario 10: dependency_out_of_scope guard", () => {
  it("drops a dependency referencing a block outside the run without crashing, and reports it", () => {
    const blocks = [block("A", { duration_days: 2 })];
    const deps = [dependency("d1", "A", "ghost")];
    const result = runCpmEngine({ project: project({ end_date: "2026-01-06" }), blocks, dependencies: deps, calendars: CALENDARS, lanes: LANES });
    const row = result.blocks.find((item) => item.id === "A");
    expect(row.early_start).toBe("2026-01-05"); // computed normally, unaffected by the dangling edge
    const outOfScope = result.conflicts.filter((conflict) => conflict.type === "dependency_out_of_scope");
    expect(outOfScope).toHaveLength(1);
    expect(outOfScope[0].dependencyId).toBe("d1");
  });
});

describe("schedulingCpmEngine — milestones", () => {
  it("keeps early_start === early_finish for a milestone regardless of relationship type driving it", () => {
    const blocks = [block("A", { duration_days: 3 }), block("M", { block_type: "milestone", duration_days: 0 })];
    const deps = [dependency("d1", "A", "M", "FS", 0)];
    const result = runCpmEngine({ project: project({ end_date: "2026-01-31" }), blocks, dependencies: deps, calendars: CALENDARS, lanes: LANES });
    const row = result.blocks.find((item) => item.id === "M");
    expect(row.early_start).toBe(row.early_finish);
  });
});
