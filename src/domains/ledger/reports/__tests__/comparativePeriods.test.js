import { describe, expect, test } from "vitest";
import { expandMonths } from "../comparativePeriods";

describe("expandMonths", () => {
  test("expands month keys into inclusive periods", () => {
    const periods = expandMonths(["2026-06", "2026-07"]);

    expect(periods).toEqual([
      {
        key: "2026-06",
        label: "Jun 2026",
        startDate: "2026-06-01",
        endDate: "2026-06-30",
      },
      {
        key: "2026-07",
        label: "Jul 2026",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      },
    ]);
  });

  test("computes February month-end correctly in leap and non-leap years", () => {
    const [leap] = expandMonths(["2024-02"]);
    expect(leap.endDate).toBe("2024-02-29");

    const [nonLeap] = expandMonths(["2026-02"]);
    expect(nonLeap.endDate).toBe("2026-02-28");
  });

  test("handles 31-day months and December", () => {
    const [december] = expandMonths(["2026-12"]);
    expect(december).toMatchObject({
      key: "2026-12",
      label: "Dec 2026",
      startDate: "2026-12-01",
      endDate: "2026-12-31",
    });
  });

  test("accepts exactly 12 periods", () => {
    const keys = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
    expect(expandMonths(keys)).toHaveLength(12);
  });

  test("rejects more than 12 periods", () => {
    const keys = Array.from({ length: 13 }, (_, i) => `2026-${String((i % 12) + 1).padStart(2, "0")}`);
    expect(() => expandMonths(keys)).toThrow(/at most 12/);
  });

  test("throws on invalid month keys", () => {
    for (const bad of ["2026-13", "2026-00", "2026-6", "06-2026", "2026/06", "june", "", null, 202606]) {
      expect(() => expandMonths([bad])).toThrow(/Invalid month key/);
    }
  });

  test("throws on empty or missing input", () => {
    expect(() => expandMonths([])).toThrow(/non-empty/);
    expect(() => expandMonths(null)).toThrow(/non-empty/);
    expect(() => expandMonths(undefined)).toThrow(/non-empty/);
  });
});
