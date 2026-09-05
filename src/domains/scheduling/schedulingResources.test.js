import { describe, expect, it } from "vitest";
import {
  computeAssignmentCost,
  computeResourceLoading,
  detectOverallocations,
  rollupProjectCost,
  spreadUnitsAcrossWorkingDays,
} from "./schedulingResources";

// Anchored to the same confirmed Monday used by schedulingCpmEngine.test.js/schedulingBaselines.test.js
// (2026-01-05), for cross-checkability.

const FIVE_DAY_CALENDAR = { id: "cal_5day", working_days: [1, 2, 3, 4, 5] };

function block(overrides = {}) {
  return { id: "block_1", lane_id: "lane_1", calendar_id: null, early_start: "2026-01-05", early_finish: "2026-01-09", ...overrides };
}

function resource(overrides = {}) {
  return { id: "res_1", resource_type: "labor", max_units_per_day: 8, std_rate: 50, ...overrides };
}

describe("schedulingResources — computeAssignmentCost", () => {
  it("prices budgeted and actual units at the resource's std_rate", () => {
    const cost = computeAssignmentCost({ budgeted_units: 40, actual_units: 20, rate_override: null }, resource());
    expect(cost).toEqual({ budgetedCost: 2000, actualCost: 1000 });
  });

  it("prefers rate_override over the resource's std_rate for both budgeted and actual", () => {
    const cost = computeAssignmentCost({ budgeted_units: 10, actual_units: 5, rate_override: 100 }, resource({ std_rate: 50 }));
    expect(cost).toEqual({ budgetedCost: 1000, actualCost: 500 });
  });

  it("treats a missing resource std_rate as zero rather than throwing", () => {
    const cost = computeAssignmentCost({ budgeted_units: 10, actual_units: 0, rate_override: null }, { id: "res_2" });
    expect(cost).toEqual({ budgetedCost: 0, actualCost: 0 });
  });
});

describe("schedulingResources — spreadUnitsAcrossWorkingDays", () => {
  it("splits units evenly across a 5-working-day span (Mon-Fri, exact division)", () => {
    const rows = spreadUnitsAcrossWorkingDays({ block: block(), calendar: FIVE_DAY_CALENDAR, holidaySet: null, totalUnits: 40 });
    expect(rows).toEqual([
      { date: "2026-01-05", units: 8 },
      { date: "2026-01-06", units: 8 },
      { date: "2026-01-07", units: 8 },
      { date: "2026-01-08", units: 8 },
      { date: "2026-01-09", units: 8 },
    ]);
  });

  it("sums to exactly totalUnits even when it doesn't divide evenly across the working days", () => {
    const rows = spreadUnitsAcrossWorkingDays({ block: block(), calendar: FIVE_DAY_CALENDAR, holidaySet: null, totalUnits: 10 });
    const sum = rows.reduce((acc, row) => acc + row.units, 0);
    expect(sum).toBe(10);
    expect(rows).toHaveLength(5);
  });

  it("skips weekend days when spreading across a span that includes them", () => {
    // Mon 2026-01-05 through Mon 2026-01-12 spans one weekend (Sat 10th, Sun 11th) -- 6 working days.
    const rows = spreadUnitsAcrossWorkingDays({ block: block({ early_start: "2026-01-05", early_finish: "2026-01-12" }), calendar: FIVE_DAY_CALENDAR, holidaySet: null, totalUnits: 12 });
    expect(rows.map((row) => row.date)).toEqual(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-12"]);
    expect(rows.reduce((acc, row) => acc + row.units, 0)).toBe(12);
  });

  it("excludes a holiday from the working-day set", () => {
    const rows = spreadUnitsAcrossWorkingDays({ block: block({ early_finish: "2026-01-06" }), calendar: FIVE_DAY_CALENDAR, holidaySet: new Set(["2026-01-06"]), totalUnits: 8 });
    expect(rows).toEqual([{ date: "2026-01-05", units: 8 }]);
  });

  it("returns an empty array when totalUnits is 0 or dates are missing, no throw", () => {
    expect(spreadUnitsAcrossWorkingDays({ block: block(), calendar: FIVE_DAY_CALENDAR, holidaySet: null, totalUnits: 0 })).toEqual([]);
    expect(spreadUnitsAcrossWorkingDays({ block: block({ early_start: null }), calendar: FIVE_DAY_CALENDAR, holidaySet: null, totalUnits: 5 })).toEqual([]);
  });
});

describe("schedulingResources — computeResourceLoading", () => {
  it("sums two concurrent assignments of the same resource on the same day", () => {
    const blocksById = new Map([
      ["block_1", block({ id: "block_1", early_start: "2026-01-05", early_finish: "2026-01-05" })],
      ["block_2", block({ id: "block_2", early_start: "2026-01-05", early_finish: "2026-01-05" })],
    ]);
    const assignments = [
      { block_id: "block_1", resource_id: "res_1", budgeted_units: 6 },
      { block_id: "block_2", resource_id: "res_1", budgeted_units: 4 },
    ];
    const loading = computeResourceLoading({
      assignments, blocksById,
      calendarsById: new Map([["cal_5day", FIVE_DAY_CALENDAR]]),
      lanesById: new Map([["lane_1", { calendar_id: "cal_5day" }]]),
      holidaysByCalendarId: new Map(), project: {},
    });
    expect(loading).toEqual([{ resource_id: "res_1", date: "2026-01-05", allocated_units: 10 }]);
  });

  it("keeps two different resources' loading separate", () => {
    const blocksById = new Map([["block_1", block()]]);
    const assignments = [
      { block_id: "block_1", resource_id: "res_1", budgeted_units: 8 },
      { block_id: "block_1", resource_id: "res_2", budgeted_units: 8 },
    ];
    const loading = computeResourceLoading({
      assignments, blocksById,
      calendarsById: new Map([["cal_5day", FIVE_DAY_CALENDAR]]),
      lanesById: new Map([["lane_1", { calendar_id: "cal_5day" }]]),
      holidaysByCalendarId: new Map(), project: {},
    });
    expect(new Set(loading.map((row) => row.resource_id))).toEqual(new Set(["res_1", "res_2"]));
  });

  it("skips an assignment whose block no longer exists, no throw", () => {
    const loading = computeResourceLoading({
      assignments: [{ block_id: "missing", resource_id: "res_1", budgeted_units: 8 }],
      blocksById: new Map(), calendarsById: new Map(), lanesById: new Map(), holidaysByCalendarId: new Map(), project: {},
    });
    expect(loading).toEqual([]);
  });
});

describe("schedulingResources — detectOverallocations", () => {
  it("flags a day where allocated units exceed the resource's max_units_per_day", () => {
    const loading = [{ resource_id: "res_1", date: "2026-01-05", allocated_units: 10 }];
    const conflicts = detectOverallocations({ loading, resourcesById: new Map([["res_1", resource({ max_units_per_day: 8 })]]) });
    expect(conflicts).toEqual([{ resource_id: "res_1", date: "2026-01-05", allocated_units: 10, max_units_per_day: 8, over_by: 2 }]);
  });

  it("does not flag a day at or under capacity", () => {
    const loading = [{ resource_id: "res_1", date: "2026-01-05", allocated_units: 8 }];
    const conflicts = detectOverallocations({ loading, resourcesById: new Map([["res_1", resource({ max_units_per_day: 8 })]]) });
    expect(conflicts).toEqual([]);
  });
});

describe("schedulingResources — rollupProjectCost", () => {
  it("combines resource-assignment cost and expense cost per block and at the project level", () => {
    const rollup = rollupProjectCost({
      assignments: [{ block_id: "block_1", resource_id: "res_1", budgeted_units: 40, actual_units: 20, rate_override: null }],
      resourcesById: new Map([["res_1", resource({ std_rate: 50 })]]),
      expenses: [{ block_id: "block_1", budgeted_cost: 500, actual_cost: 100 }, { block_id: "block_2", budgeted_cost: 300, actual_cost: 300 }],
    });

    expect(rollup.byBlock).toEqual(
      expect.arrayContaining([
        { block_id: "block_1", budgeted_cost: 2500, actual_cost: 1100, remaining_cost: 1400 },
        { block_id: "block_2", budgeted_cost: 300, actual_cost: 300, remaining_cost: 0 },
      ]),
    );
    expect(rollup.project).toEqual({ budgeted_cost: 2800, actual_cost: 1400, remaining_cost: 1400 });
  });

  it("does not floor a negative remaining_cost -- over-budget is a real signal", () => {
    const rollup = rollupProjectCost({
      assignments: [{ block_id: "block_1", resource_id: "res_1", budgeted_units: 10, actual_units: 20, rate_override: null }],
      resourcesById: new Map([["res_1", resource({ std_rate: 10 })]]),
      expenses: [],
    });
    expect(rollup.project).toEqual({ budgeted_cost: 100, actual_cost: 200, remaining_cost: -100 });
  });

  it("skips an assignment whose resource no longer exists, no throw", () => {
    const rollup = rollupProjectCost({ assignments: [{ block_id: "block_1", resource_id: "missing", budgeted_units: 10, actual_units: 0 }], resourcesById: new Map(), expenses: [] });
    expect(rollup.byBlock).toEqual([]);
    expect(rollup.project).toEqual({ budgeted_cost: 0, actual_cost: 0, remaining_cost: 0 });
  });
});
