import { describe, expect, it } from "vitest";
import projectRetirementTimeline, { averageRealReturnPct } from "../projectRetirementTimeline";

// Tiny synthetic dataset: blended 50/50 returns are 0.05, 0.10, 0.15,
// so the long-run average is exactly 0.10 (10%).
const SYNTHETIC = {
  years: [2000, 2001, 2002],
  stockReal: [0.1, 0.2, 0.3],
  bondReal: [0, 0, 0],
};

const BASE = {
  retirementAge: 65,
  planningAge: 67,
  retirementYear: 2030,
  nestEgg: 1000,
  annualWithdrawal: 100,
  stockPct: 0.5,
  data: SYNTHETIC,
};

describe("averageRealReturnPct", () => {
  it("matches the hand-computed mean of the blended series", () => {
    expect(averageRealReturnPct({ stockPct: 0.5, data: SYNTHETIC })).toBeCloseTo(10, 10);
  });

  it("returns null when the dataset is missing or ragged", () => {
    expect(averageRealReturnPct({ stockPct: 0.5, data: null })).toBeNull();
    expect(
      averageRealReturnPct({ stockPct: 0.5, data: { years: [2000], stockReal: [0.1], bondReal: [] } }),
    ).toBeNull();
  });
});

describe("projectRetirementTimeline", () => {
  it("projects hand-computed balances at the average real return", () => {
    // avg = 0.10. Point 0 = nestEgg; each later point = bal * 1.10 - 100.
    // 1000 * 1.10 - 100 = 1000 (steady state — a nice check).
    const result = projectRetirementTimeline(BASE);
    expect(result.avgRealReturnPct).toBe(10);
    expect(result.horizonYears).toBe(2);
    expect(result.exhaustedAt).toBeNull();
    expect(result.years).toHaveLength(3);
    expect(result.years[0]).toEqual({ age: 65, calendarYear: 2030, balance: 1000, withdrawal: 100 });
    expect(result.years[1]).toEqual({ age: 66, calendarYear: 2031, balance: 1000, withdrawal: 100 });
    // Final point (planning age): no withdrawal is scheduled after it.
    expect(result.years[2]).toEqual({ age: 67, calendarYear: 2032, balance: 1000, withdrawal: null });
  });

  it("compounds the spending-smile decline per retirement year", () => {
    const result = projectRetirementTimeline({ ...BASE, spendingDeclinePct: 10 });
    // i=0: w=100 -> bal 1000*1.1-100 = 1000
    // i=1: w=100*0.9=90 -> bal 1000*1.1-90 = 1010
    expect(result.years[0].withdrawal).toBe(100);
    expect(result.years[1].withdrawal).toBe(90);
    expect(result.years[1].balance).toBe(1000);
    expect(result.years[2].balance).toBe(1010);
  });

  it("ends the line at exhaustion instead of rendering negative balances", () => {
    // i=0: bal 100, w 90 -> 100*1.1-90 = 20
    // i=1: bal 20, w 90 -> 20*1.1-90 = -68 <= 0 -> exhausted at 67
    const result = projectRetirementTimeline({ ...BASE, nestEgg: 100, annualWithdrawal: 90 });
    expect(result.exhaustedAt).toBe(67);
    expect(result.years).toHaveLength(3);
    expect(result.years[2]).toEqual({ age: 67, calendarYear: 2032, balance: 0, withdrawal: null });
    expect(result.years.every((point) => point.balance >= 0)).toBe(true);
  });

  it("clamps a negative decline to flat spending", () => {
    const result = projectRetirementTimeline({ ...BASE, spendingDeclinePct: -5 });
    expect(result.years[1].withdrawal).toBe(100);
  });

  it("returns the null shape on invalid input — never Infinity or NaN", () => {
    const bad = projectRetirementTimeline({ ...BASE, nestEgg: NaN });
    expect(bad.years).toEqual([]);
    expect(bad.avgRealReturnPct).toBeNull();
    expect(bad.exhaustedAt).toBeNull();

    const badAge = projectRetirementTimeline({ ...BASE, retirementAge: 95, planningAge: 90 });
    expect(badAge.years).toEqual([]);
  });

  it("returns the null shape when the dataset is missing", () => {
    const result = projectRetirementTimeline({ ...BASE, data: null });
    expect(result.years).toEqual([]);
    expect(result.avgRealReturnPct).toBeNull();
  });
});
