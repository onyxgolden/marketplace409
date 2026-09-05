import { describe, expect, it } from "vitest";
import { levelResources } from "./schedulingResourceLeveling";

// Anchored to the same confirmed Monday used by schedulingCpmEngine.test.js (2026-01-05).
const MON_FRI = Object.freeze({ id: "cal_weekday", working_days: Object.freeze([1, 2, 3, 4, 5]) });
const CALENDARS_BY_ID = new Map([[MON_FRI.id, MON_FRI]]);
const LANES_BY_ID = new Map([["lane_1", { calendar_id: null }]]);

function project(overrides = {}) {
  return { id: "proj_1", start_date: "2026-01-05", end_date: "2026-06-30", default_calendar_id: MON_FRI.id, ...overrides };
}
// early_start/early_finish/late_start/late_finish default to a root block's natural CPM position
// (project start, 2-working-day duration, zero float) -- override them together with total_float_days
// to model a block with slack; a root block's dependency-driven position is always recomputed from
// project.start_date regardless of what's set here (matching real CPM output, where a block with no
// predecessors and no constraint can never start anywhere else), so these fields only matter for
// blocks that DO have a predecessor/constraint, or for late_start/total_float_days (which this module
// reads directly, not through computeForwardDatesForBlock).
function block(id, overrides = {}) {
  return {
    id, task_code: id, lane_id: "lane_1", block_type: "task", duration_days: 2,
    early_start: "2026-01-05", early_finish: "2026-01-06", late_start: "2026-01-05", late_finish: "2026-01-06",
    total_float_days: 0, is_critical: true, calendar_id: null, constraint_type: null, constraint_date: null,
    ...overrides,
  };
}
function dependency(id, predecessorId, successorId, relationshipType = "FS", lagDays = 0) {
  return { id, predecessor_id: predecessorId, successor_id: successorId, relationship_type: relationshipType, lag_days: lagDays };
}
// budgetedUnits is spread evenly across the block's whole duration (spreadUnitsAcrossWorkingDays) --
// pass 16 for a 2-day block to get a full 8/day (matching a resource whose max_units_per_day is 8).
function assignment(blockId, resourceId, budgetedUnits) {
  return { block_id: blockId, resource_id: resourceId, budgeted_units: budgetedUnits };
}
function resource(id, maxUnitsPerDay = 8) {
  return { id, max_units_per_day: maxUnitsPerDay };
}

describe("schedulingResourceLeveling — no conflict", () => {
  it("leaves two sequential (non-overlapping) full-capacity blocks unmoved", () => {
    // B's early/late fields reflect what a real CPM run would already have produced for it (its
    // dependency on A pins it there before any resource leveling happens) -- not an arbitrary
    // standalone position, which computeForwardDatesForBlock would just override back to project
    // start anyway (see the block() helper's own comment).
    const blocks = [block("A"), block("B", { early_start: "2026-01-07", early_finish: "2026-01-08", late_start: "2026-01-07", late_finish: "2026-01-08", total_float_days: 0 })];
    const dependencies = [dependency("dep1", "A", "B")]; // B's earliest start is naturally A's finish + 1 working day.
    const assignments = [assignment("A", "R1", 16), assignment("B", "R1", 16)]; // both full capacity (8/day), but never on the same day.
    const result = levelResources({ project: project(), blocks, dependencies, assignments, resourcesById: new Map([["R1", resource("R1")]]), calendarsById: CALENDARS_BY_ID, lanesById: LANES_BY_ID });

    expect(result.unresolvedConflicts).toEqual([]);
    expect(result.projectFinishExtensionDays).toBe(0);
    expect(result.leveledBlocks.find((b) => b.task_code === "A")).toMatchObject({ leveled_start: "2026-01-05", delay_days: 0 });
    expect(result.leveledBlocks.find((b) => b.task_code === "B")).toMatchObject({ leveled_start: "2026-01-07", delay_days: 0 });
  });

  it("places a block with no resource assignment at its dependency-driven earliest start with zero delay", () => {
    const blocks = [block("A")];
    const result = levelResources({ project: project(), blocks, dependencies: [], assignments: [], resourcesById: new Map(), calendarsById: CALENDARS_BY_ID, lanesById: LANES_BY_ID });
    expect(result.leveledBlocks[0]).toMatchObject({ leveled_start: "2026-01-05", delay_days: 0 });
  });
});

describe("schedulingResourceLeveling — conflict resolution within float", () => {
  it("delays the lower-priority (higher-float) block until the higher-priority block's resource window is clear", () => {
    // Q: zero float, highest priority, stays at its natural 1/5-1/6 position. P: also a root block
    // (same natural 1/5-1/6 position) but with 2 working days of float (late_start 1/7) -- both want
    // the same resource at full capacity, so P must move to exactly 1/7 to clear Q's window.
    const blocks = [
      block("Q"),
      block("P", { late_start: "2026-01-07", late_finish: "2026-01-08", total_float_days: 2, is_critical: false }),
    ];
    const assignments = [assignment("Q", "R1", 16), assignment("P", "R1", 16)];
    const result = levelResources({ project: project(), blocks, dependencies: [], assignments, resourcesById: new Map([["R1", resource("R1", 8)]]), calendarsById: CALENDARS_BY_ID, lanesById: LANES_BY_ID });

    expect(result.unresolvedConflicts).toEqual([]);
    expect(result.leveledBlocks.find((b) => b.task_code === "Q")).toMatchObject({ leveled_start: "2026-01-05", delay_days: 0 });
    expect(result.leveledBlocks.find((b) => b.task_code === "P")).toMatchObject({ leveled_start: "2026-01-07", leveled_finish: "2026-01-08", delay_days: 2 });
    // projectFinishExtensionDays is 2 here, NOT 0, even though P never moved past its own float --
    // this metric is max(leveled early_finish) - max(original early_finish) across every Gantt
    // block, the same "not leaves-only, an accepted named limitation" simplification
    // schedulingBaselines.js's rollupProjectVariance already documents for the same reason: this
    // 2-block fixture has nothing else anchoring the "true" project finish at P's late_finish, so
    // P sliding into its own float still reads as the tracked maximum moving. A fully-populated
    // real schedule normally has a still-later critical block/milestone absorbing this.
    expect(result.projectFinishExtensionDays).toBe(2);
  });
});

describe("schedulingResourceLeveling — conflict resolution when float runs out", () => {
  it("caps the delayed block at its own late_start and reports the still-conflicting day, not silently pushing further", () => {
    const blocks = [
      block("Q"),
      block("P", { late_start: "2026-01-06", late_finish: "2026-01-07", total_float_days: 1, is_critical: false }),
    ];
    const assignments = [assignment("Q", "R1", 16), assignment("P", "R1", 16)];
    const result = levelResources({ project: project(), blocks, dependencies: [], assignments, resourcesById: new Map([["R1", resource("R1", 8)]]), calendarsById: CALENDARS_BY_ID, lanesById: LANES_BY_ID });

    expect(result.projectFinishExtensionDays).toBe(1); // P's leveled finish (1/7) is one day past the original tracked max (1/6) -- see the "within float" test above for why this metric still moves even though P stayed inside its own float.
    const p = result.leveledBlocks.find((b) => b.task_code === "P");
    expect(p).toMatchObject({ leveled_start: "2026-01-06" }); // pinned at its own late_start, not moved further.
    expect(result.unresolvedConflicts).toHaveLength(1);
    expect(result.unresolvedConflicts[0]).toMatchObject({ task_code: "P", leveled_start: "2026-01-06" });
    expect(result.unresolvedConflicts[0].conflicts).toEqual([{ resource_id: "R1", date: "2026-01-06", allocated_units: 16, max_units_per_day: 8, over_by: 8 }]);
  });

  it("resolves the same tight-float conflict, and reports the finish extension, when allowExtension is true", () => {
    const blocks = [
      block("Q"),
      block("P", { late_start: "2026-01-06", late_finish: "2026-01-07", total_float_days: 1, is_critical: false }),
    ];
    const assignments = [assignment("Q", "R1", 16), assignment("P", "R1", 16)];
    const result = levelResources({ project: project(), blocks, dependencies: [], assignments, resourcesById: new Map([["R1", resource("R1", 8)]]), calendarsById: CALENDARS_BY_ID, lanesById: LANES_BY_ID, allowExtension: true });

    expect(result.unresolvedConflicts).toEqual([]);
    expect(result.leveledBlocks.find((b) => b.task_code === "P")).toMatchObject({ leveled_start: "2026-01-07", leveled_finish: "2026-01-08" });
    expect(result.projectFinishExtensionDays).toBe(2); // original max finish 1/6 -> leveled max finish 1/8.
  });
});

describe("schedulingResourceLeveling — cascading delay through dependencies", () => {
  it("a downstream block's earliest start reflects its predecessor's LEVELED finish, not its original finish", () => {
    const blocks = [
      block("Q"),
      block("P", { late_start: "2026-01-07", late_finish: "2026-01-08", total_float_days: 2, is_critical: false }),
      block("D", { early_start: "2026-01-07", early_finish: "2026-01-08", late_start: "2026-01-09", late_finish: "2026-01-10", total_float_days: 2, is_critical: false }),
    ];
    const dependencies = [dependency("dep1", "P", "D", "FS", 0)];
    // D has no resource assignment of its own -- any delay it shows is purely cascaded from P's leveled finish.
    const assignments = [assignment("Q", "R1", 16), assignment("P", "R1", 16)];
    const result = levelResources({ project: project(), blocks, dependencies, assignments, resourcesById: new Map([["R1", resource("R1", 8)]]), calendarsById: CALENDARS_BY_ID, lanesById: LANES_BY_ID });

    const p = result.leveledBlocks.find((b) => b.task_code === "P");
    const d = result.leveledBlocks.find((b) => b.task_code === "D");
    expect(p.leveled_finish).toBe("2026-01-08"); // P delayed to clear Q's resource window, as in the float-resolution test above.
    expect(d.leveled_start).toBe("2026-01-09"); // P's leveled finish (1/8) + 1 working day, NOT P's original finish (1/6) + 1.
    expect(d.delay_days).toBe(2); // original D.early_start 1/7 -> leveled 1/9.
  });
});

describe("schedulingResourceLeveling — cyclic blocks", () => {
  it("excludes a cyclic pair entirely from the leveled output, matching the CPM engine's own cycle handling", () => {
    const blocks = [block("A"), block("B")];
    const dependencies = [dependency("d1", "A", "B"), dependency("d2", "B", "A")];
    const result = levelResources({ project: project(), blocks, dependencies, assignments: [], resourcesById: new Map(), calendarsById: CALENDARS_BY_ID, lanesById: LANES_BY_ID });
    expect(result.leveledBlocks).toEqual([]);
  });
});
