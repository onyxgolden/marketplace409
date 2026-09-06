import { describe, expect, it } from "vitest";
import { normalizeBoolean, normalizeDateCell, parsePredecessorsCell, validateAndPlanImport } from "./schedulingExcelImport";

describe("normalizeBoolean", () => {
  it("returns null for blank, true/false for recognized strings, undefined for garbage", () => {
    expect(normalizeBoolean("")).toBeNull();
    expect(normalizeBoolean(null)).toBeNull();
    expect(normalizeBoolean("Yes")).toBe(true);
    expect(normalizeBoolean("no")).toBe(false);
    expect(normalizeBoolean(true)).toBe(true);
    expect(normalizeBoolean("maybe")).toBeUndefined();
  });
});

describe("normalizeDateCell", () => {
  it("accepts a Date instance, an ISO string, rejects garbage, and treats blank as null", () => {
    expect(normalizeDateCell(new Date("2026-03-01T00:00:00Z"))).toBe("2026-03-01");
    expect(normalizeDateCell("2026-03-01")).toBe("2026-03-01");
    expect(normalizeDateCell("")).toBeNull();
    expect(normalizeDateCell(undefined)).toBeNull();
    expect(normalizeDateCell("not a date")).toBeUndefined();
  });
});

describe("parsePredecessorsCell", () => {
  it("parses a comma-separated list with optional signed lag", () => {
    expect(parsePredecessorsCell("A1010:FS+2, A1020:SS-1, A1030:FF")).toEqual([
      { taskCode: "A1010", relationshipType: "FS", lagDays: 2 },
      { taskCode: "A1020", relationshipType: "SS", lagDays: -1 },
      { taskCode: "A1030", relationshipType: "FF", lagDays: 0 },
    ]);
  });

  it("returns an empty array for a blank cell", () => {
    expect(parsePredecessorsCell("")).toEqual([]);
    expect(parsePredecessorsCell(null)).toEqual([]);
  });

  it("throws a descriptive error for malformed syntax", () => {
    expect(() => parsePredecessorsCell("A1010")).toThrow(/not a valid predecessor/);
    expect(() => parsePredecessorsCell("A1010:XX")).toThrow(/not a valid predecessor/);
  });
});

describe("validateAndPlanImport", () => {
  const existingBlocksByTaskCode = new Map([
    ["A1010", { category: "eng", milestone: false }],
    ["A1020", { category: "field", milestone: false }],
  ]);
  const laneIdByNameLower = new Map([["engineering", "lane_eng"], ["field execution", "lane_field"]]);
  const projectStartDate = "2026-01-01";

  it("builds a patch for a valid row, computing startIdx from the project start date", () => {
    const result = validateAndPlanImport({
      rows: [{ taskCode: "A1010", taskName: "Renamed", lane: "Engineering", durationWeeks: 3, start: "2026-01-15", percentComplete: 50 }],
      existingBlocksByTaskCode, laneIdByNameLower, projectStartDate,
    });
    expect(result.success).toBe(true);
    expect(result.patches).toEqual([{
      taskCode: "A1010", taskName: "Renamed", laneId: "lane_eng", durationWeeks: 3, startIdx: 2, percentComplete: 50,
    }]);
  });

  it("rejects a task code that doesn't exist in the project", () => {
    const result = validateAndPlanImport({ rows: [{ taskCode: "A9999" }], existingBlocksByTaskCode, laneIdByNameLower, projectStartDate });
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/does not exist in this project/);
  });

  it("rejects a duplicate task code within the same file", () => {
    const result = validateAndPlanImport({
      rows: [{ taskCode: "A1010" }, { taskCode: "A1010" }], existingBlocksByTaskCode, laneIdByNameLower, projectStartDate,
    });
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate"))).toBe(true);
  });

  it("rejects an unrecognized lane, category, or milestone value, collecting every row's errors", () => {
    const result = validateAndPlanImport({
      rows: [
        { taskCode: "A1010", lane: "Nonexistent Lane" },
        { taskCode: "A1020", category: "bogus" },
      ],
      existingBlocksByTaskCode, laneIdByNameLower, projectStartDate,
    });
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/does not match any lane/);
    expect(result.errors[1]).toMatch(/Category must be one of/);
  });

  it("forces duration to 0 when a row is marked a milestone", () => {
    const result = validateAndPlanImport({
      rows: [{ taskCode: "A1010", milestone: "Yes", durationWeeks: 5 }], existingBlocksByTaskCode, laneIdByNameLower, projectStartDate,
    });
    expect(result.patches[0].durationWeeks).toBe(0);
  });

  it("rejects a predecessor reference that resolves to nothing in the project or the file", () => {
    const result = validateAndPlanImport({
      rows: [{ taskCode: "A1010", predecessors: "A9999:FS" }], existingBlocksByTaskCode, laneIdByNameLower, projectStartDate,
    });
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/isn't in this project or this file/);
  });

  it("allows a predecessor reference to another row being edited in the same file", () => {
    const result = validateAndPlanImport({
      rows: [{ taskCode: "A1010", predecessors: "A1020:FS" }, { taskCode: "A1020" }],
      existingBlocksByTaskCode, laneIdByNameLower, projectStartDate,
    });
    expect(result.success).toBe(true);
    expect(result.patches[0].predecessors).toEqual([{ taskCode: "A1020", relationshipType: "FS", lagDays: 0 }]);
  });

  it("leaves a field untouched (absent from the patch) when its column is blank or missing", () => {
    const result = validateAndPlanImport({ rows: [{ taskCode: "A1010" }], existingBlocksByTaskCode, laneIdByNameLower, projectStartDate });
    expect(result.success).toBe(true);
    expect(result.patches[0]).toEqual({ taskCode: "A1010" });
  });

  it("requires a task code", () => {
    const result = validateAndPlanImport({ rows: [{ taskName: "No code" }], existingBlocksByTaskCode, laneIdByNameLower, projectStartDate });
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Task Code is required/);
  });
});
