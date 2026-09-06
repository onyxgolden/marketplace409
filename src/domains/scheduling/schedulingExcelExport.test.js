import { describe, expect, it } from "vitest";
import { ACTIVITY_COLUMNS, buildActivityRows, formatPredecessorsCell } from "./schedulingExcelExport";

function block(overrides = {}) {
  return {
    id: "b1", task_code: "A1010", label: "Design", lane_id: "lane1", category: "eng",
    block_type: "task", duration_days: 14, early_start: "2026-01-05", early_finish: "2026-01-16",
    percent_complete: 0, actual_start: null, actual_finish: null, total_float_days: 0, is_critical: true,
    ...overrides,
  };
}

describe("schedulingExcelExport", () => {
  it("gives every column a header and a key", () => {
    for (const column of ACTIVITY_COLUMNS) {
      expect(column.header.length).toBeGreaterThan(0);
      expect(column.key.length).toBeGreaterThan(0);
    }
  });

  it("formats a block's predecessors as CODE:TYPE with a signed lag suffix, omitting zero lag", () => {
    const dependencies = [
      { predecessor_id: "p1", successor_id: "b1", relationship_type: "FS", lag_days: 2 },
      { predecessor_id: "p2", successor_id: "b1", relationship_type: "SS", lag_days: -1 },
      { predecessor_id: "p3", successor_id: "b1", relationship_type: "FF", lag_days: 0 },
      { predecessor_id: "p4", successor_id: "other", relationship_type: "FS", lag_days: 0 },
    ];
    const taskCodeById = new Map([["p1", "A1000"], ["p2", "A1001"], ["p3", "A1002"], ["p4", "A9999"]]);
    expect(formatPredecessorsCell("b1", dependencies, taskCodeById)).toBe("A1000:FS+2, A1001:SS-1, A1002:FF");
  });

  it("returns an empty string when a block has no predecessors", () => {
    expect(formatPredecessorsCell("b1", [], new Map())).toBe("");
  });

  it("converts duration_days to whole weeks and reports Milestone/Critical as Yes/No", () => {
    const [row] = buildActivityRows({
      ganttBlocks: [block({ block_type: "milestone", duration_days: 0, is_critical: false })],
      dependencies: [], lanesById: new Map([["lane1", { name: "Engineering" }]]),
    });
    expect(row.milestone).toBe("Yes");
    expect(row.critical).toBe("No");
    expect(row.durationWeeks).toBe(0);
    expect(row.lane).toBe("Engineering");
  });

  it("sorts rows by start date, then task code", () => {
    const rows = buildActivityRows({
      ganttBlocks: [
        block({ id: "b2", task_code: "A2000", early_start: "2026-01-01" }),
        block({ id: "b1", task_code: "A1000", early_start: "2026-01-01" }),
        block({ id: "b3", task_code: "A0500", early_start: "2025-12-01" }),
      ],
      dependencies: [], lanesById: new Map(),
    });
    expect(rows.map((row) => row.taskCode)).toEqual(["A0500", "A1000", "A2000"]);
  });
});
