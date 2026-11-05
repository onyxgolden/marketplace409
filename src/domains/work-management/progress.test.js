// Work Package Planner slice 2 — domain tests: daily totals, as-of
// cumulative, corrections/void semantics at the totals level, percent
// rules (raw vs capped, zero baseline, overrun), and the never-average /
// never-mix-units aggregate rules.

import { describe, expect, it } from "vitest";
import {
  validateProgressEntryInput,
  validateProgressCorrectionInput,
  sumQuantities,
  computeDailyTotalsForLine,
  computeInstalledAsOf,
  computeLineProgress,
  computeUnitGroupedProgress,
  computePidProgress,
  computePackageProgress,
} from "./progress.js";

const entry = (overrides) => ({
  id: "forge_wprg_1",
  workDate: "2026-11-01",
  installedQuantity: 10,
  voidedAt: null,
  ...overrides,
});

describe("validateProgressEntryInput", () => {
  it("accepts a well-formed entry, including zero quantity", () => {
    expect(validateProgressEntryInput({ lineId: "line_1", workDate: "2026-11-01", installedQuantity: 0 }).ok).toBe(true);
    expect(validateProgressEntryInput({ lineId: "line_1", workDate: "2026-11-01", installedQuantity: 12.5 }).ok).toBe(true);
  });

  it("rejects missing line, malformed or impossible dates, and negative or overprecise quantities", () => {
    expect(validateProgressEntryInput({ workDate: "2026-11-01", installedQuantity: 1 }).ok).toBe(false);
    expect(validateProgressEntryInput({ lineId: "l", workDate: "11/01/2026", installedQuantity: 1 }).ok).toBe(false);
    expect(validateProgressEntryInput({ lineId: "l", workDate: "2026-02-30", installedQuantity: 1 }).ok).toBe(false);
    expect(validateProgressEntryInput({ lineId: "l", workDate: "2026-11-01", installedQuantity: -1 }).ok).toBe(false);
    expect(validateProgressEntryInput({ lineId: "l", workDate: "2026-11-01", installedQuantity: 1.23456 }).ok).toBe(false);
    expect(validateProgressEntryInput({ lineId: "l", workDate: "2026-11-01", installedQuantity: "10" }).ok).toBe(false);
  });

  it("does not reject ordinary decimals that binary floating point makes dusty", () => {
    expect(validateProgressEntryInput({ lineId: "l", workDate: "2026-11-01", installedQuantity: 0.1 }).ok).toBe(true);
    expect(sumQuantities([0.1, 0.2])).toBe(0.3);
  });
});

describe("validateProgressCorrectionInput", () => {
  it("requires expectedVersion and at least one change", () => {
    expect(validateProgressCorrectionInput({ expectedVersion: 1 }).ok).toBe(false);
    expect(validateProgressCorrectionInput({ installedQuantity: 5 }).ok).toBe(false);
    expect(validateProgressCorrectionInput({ expectedVersion: 2, installedQuantity: 5 }).ok).toBe(true);
    expect(validateProgressCorrectionInput({ expectedVersion: 2, reason: "x".repeat(2001) }).ok).toBe(false);
  });
});

describe("computeDailyTotalsForLine", () => {
  it("sums multiple entries on the same date and drops voided entries", () => {
    const totals = computeDailyTotalsForLine([
      entry({ workDate: "2026-11-01", installedQuantity: 10 }),
      entry({ id: "forge_wprg_2", workDate: "2026-11-01", installedQuantity: 4 }),
      entry({ id: "forge_wprg_3", workDate: "2026-11-02", installedQuantity: 7 }),
      entry({ id: "forge_wprg_4", workDate: "2026-11-01", installedQuantity: 100, voidedAt: "2026-11-03T00:00:00Z" }),
    ]);
    expect(totals).toEqual([
      { workDate: "2026-11-01", installed: 14 },
      { workDate: "2026-11-02", installed: 7 },
    ]);
  });
});

describe("computeInstalledAsOf", () => {
  it("includes only work dates on or before as-of, regardless of entry order", () => {
    const entries = [
      entry({ workDate: "2026-11-03", installedQuantity: 5 }),
      entry({ id: "forge_wprg_2", workDate: "2026-11-01", installedQuantity: 10 }),
    ];
    expect(computeInstalledAsOf(entries, "2026-11-01")).toBe(10);
    expect(computeInstalledAsOf(entries, "2026-11-02")).toBe(10);
    expect(computeInstalledAsOf(entries, "2026-11-03")).toBe(15);
  });

  it("a backfilled earlier date moves later as-of totals (entry timestamp is irrelevant)", () => {
    const entries = [entry({ workDate: "2026-11-05", installedQuantity: 5 })];
    expect(computeInstalledAsOf(entries, "2026-11-05")).toBe(5);
    const backfilled = [...entries, entry({ id: "forge_wprg_2", workDate: "2026-11-02", installedQuantity: 3 })];
    expect(computeInstalledAsOf(backfilled, "2026-11-05")).toBe(8);
    expect(computeInstalledAsOf(backfilled, "2026-11-03")).toBe(3);
  });
});

describe("computeLineProgress", () => {
  it("reports raw percent, capped completion, remaining, and overrun separately", () => {
    const progress = computeLineProgress({ baselineQuantity: 40, baselineUnit: "ft", installed: 44 });
    expect(progress.percentComplete).toBe(110);
    expect(progress.cappedCompletion).toBe(100);
    expect(progress.remaining).toBe(0);
    expect(progress.overrun).toBe(true);
  });

  it("zero baseline is N/A percent, never a divide-by-zero, with installed still shown", () => {
    const progress = computeLineProgress({ baselineQuantity: 0, baselineUnit: "ft", installed: 5 });
    expect(progress.percentComplete).toBeNull();
    expect(progress.cappedCompletion).toBeNull();
    expect(progress.installed).toBe(5);
    expect(progress.remaining).toBeNull();
    expect(progress.overrun).toBe(false);
  });
});

describe("computeUnitGroupedProgress", () => {
  it("aggregates a single unit with a positive baseline into one percent", () => {
    const grouped = computeUnitGroupedProgress([
      { baselineQuantity: 40, baselineUnit: "ft", installed: 10 },
      { baselineQuantity: 10, baselineUnit: "ft", installed: 10 },
    ]);
    expect(grouped.aggregatePercent).toBe(40);
    expect(grouped.totalInstalled).toBe(20);
    expect(grouped.totalBaseline).toBe(50);
  });

  it("mixed units never produce an aggregate percent — unit groups only", () => {
    const grouped = computeUnitGroupedProgress([
      { baselineQuantity: 40, baselineUnit: "ft", installed: 10 },
      { baselineQuantity: 5, baselineUnit: "ea", installed: 5 },
    ]);
    expect(grouped.aggregatePercent).toBeNull();
    expect(grouped.cappedAggregateCompletion).toBeNull();
    expect(grouped.unitGroups).toHaveLength(2);
  });

  it("a zero-baseline line blocks the aggregate percent even in a single unit", () => {
    const grouped = computeUnitGroupedProgress([
      { baselineQuantity: 40, baselineUnit: "ft", installed: 10 },
      { baselineQuantity: 0, baselineUnit: "ft", installed: 5 },
    ]);
    expect(grouped.aggregatePercent).toBeNull();
    expect(grouped.unitGroups).toHaveLength(1);
  });
});

describe("computePidProgress and computePackageProgress", () => {
  it("never averages line percentages: a P&ID percent is totals over totals", () => {
    const pid = computePidProgress({
      pIdDrawingId: "dwg_pid1",
      lines: [
        { baselineQuantity: 100, baselineUnit: "ft", installed: 100 },
        { baselineQuantity: 10, baselineUnit: "ft", installed: 0 },
      ],
    });
    // Averaging 100% and 0% would say 50%; totals say 100/110 = 90.909...
    expect(pid.aggregatePercent).toBeCloseTo(90.909, 3);
    expect(pid.lines[0].percentComplete).toBe(100);
    expect(pid.lines[1].percentComplete).toBe(0);
  });

  it("package rollups include unassociated lines; P&ID rollups never fabricate one", () => {
    const pkg = computePackageProgress({
      lines: [
        { pIdDrawingId: "dwg_pid1", baselineQuantity: 40, baselineUnit: "ft", installed: 10 },
        { pIdDrawingId: null, baselineQuantity: 5, baselineUnit: "ea", installed: 5 },
      ],
    });
    expect(pkg.lines).toHaveLength(2);
    expect(pkg.pidRollups).toHaveLength(1);
    expect(pkg.pidRollups[0].pIdDrawingId).toBe("dwg_pid1");
    expect(pkg.aggregatePercent).toBeNull();
  });
});
