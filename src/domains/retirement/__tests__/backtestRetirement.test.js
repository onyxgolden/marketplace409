import { describe, expect, it } from "vitest";
import backtestRetirement from "../backtestRetirement";
import shillerData from "../shillerAnnual.json";

// Hand-computed case on a tiny synthetic 6-year dataset.
// stockPct = 1.0, nestEgg = 100, annualWithdrawal = 30, horizon = 3.
// Windows: starts 2000..2002 (2005 - 3), three windows.
//
// Window 2000 (returns 0.10, -0.20, 0.05):
//   100 * 1.10 - 30 = 80; 80 * 0.80 - 30 = 34; 34 * 1.05 - 30 = 5.70 > 0 -> SUCCESS
// Window 2001 (returns -0.20, 0.05, 0.08):
//   100 * 0.80 - 30 = 50; 50 * 1.05 - 30 = 22.50; 22.50 * 1.08 - 30 = -5.70 -> FAIL
// Window 2002 (returns 0.05, 0.08, -0.10):
//   100 * 1.05 - 30 = 75; 75 * 1.08 - 30 = 51; 51 * 0.90 - 30 = 15.90 -> SUCCESS
const SYNTHETIC = {
  years: [2000, 2001, 2002, 2003, 2004, 2005],
  stockReal: [0.1, -0.2, 0.05, 0.08, -0.1, 0.03],
  bondReal: [0, 0, 0, 0, 0, 0],
  inflation: [0, 0, 0, 0, 0, 0],
};

describe("backtestRetirement", () => {
  it("matches hand-computed window outcomes on the synthetic dataset", () => {
    const result = backtestRetirement({
      nestEgg: 100,
      annualWithdrawal: 30,
      stockPct: 1.0,
      horizonYears: 3,
      data: SYNTHETIC,
    });
    expect(result.windowsTested).toBe(3);
    expect(result.successes).toBe(2);
    expect(result.failures).toBe(1);
    expect(result.survivalPct).toBe(66.7);
    expect(result.worstStarts).toEqual([2001]);
    expect(result.horizonYears).toBe(3);
  });

  it("60/40, 4% withdrawal, 30 years on real Shiller data: 98.4% and 1966 fails", () => {
    const result = backtestRetirement({
      nestEgg: 1_000_000,
      annualWithdrawal: 40_000,
      stockPct: 0.6,
      horizonYears: 30,
      data: shillerData,
    });
    expect(result.windowsTested).toBe(122); // starts 1871..1992
    expect(result.successes).toBe(120);
    expect(result.failures).toBe(2);
    expect(result.survivalPct).toBe(98.4);
    // 1966 is the classic worst-case start for the 4% rule — if it is not
    // among the failures, the simulation engine is wrong.
    expect(result.worstStarts).toContain(1966);
  });

  it("a 10% withdrawal rate collapses survival well below 100%", () => {
    const result = backtestRetirement({
      nestEgg: 1_000_000,
      annualWithdrawal: 100_000,
      stockPct: 0.6,
      horizonYears: 30,
      data: shillerData,
    });
    expect(result.survivalPct).toBe(6.6);
    expect(result.survivalPct).toBeLessThan(50);
  });

  it("returns null survival when the horizon exceeds the data span", () => {
    const result = backtestRetirement({
      nestEgg: 1_000_000,
      annualWithdrawal: 40_000,
      stockPct: 0.6,
      horizonYears: 200,
      data: shillerData,
    });
    expect(result.windowsTested).toBe(0);
    expect(result.survivalPct).toBeNull();
  });

  it("returns null survival for a sub-1-year horizon", () => {
    for (const horizonYears of [0, -5, NaN]) {
      const result = backtestRetirement({
        nestEgg: 1_000_000,
        annualWithdrawal: 40_000,
        stockPct: 0.6,
        horizonYears,
        data: shillerData,
      });
      expect(result.survivalPct).toBeNull();
      expect(result.windowsTested).toBe(0);
    }
  });

  it("spendingDeclinePct 0 is identical to flat behavior (regression)", () => {
    const result = backtestRetirement({
      nestEgg: 100,
      annualWithdrawal: 30,
      stockPct: 1.0,
      horizonYears: 3,
      data: SYNTHETIC,
      spendingDeclinePct: 0,
    });
    expect(result.windowsTested).toBe(3);
    expect(result.survivalPct).toBe(66.7);
    expect(result.worstStarts).toEqual([2001]);
  });

  it("a 10%/yr spending decline rescues the failing 2001 window on the synthetic set", () => {
    // Withdrawals: 30, 27, 24.30.
    // Window 2000 (0.10, -0.20, 0.05): 80 -> 37 -> 14.55 > 0 -> SUCCESS
    // Window 2001 (-0.20, 0.05, 0.08): 50 -> 25.5 -> 3.24 > 0 -> SUCCESS (was FAIL flat)
    // Window 2002 (0.05, 0.08, -0.10): 75 -> 54 -> 24.3 > 0 -> SUCCESS
    const result = backtestRetirement({
      nestEgg: 100,
      annualWithdrawal: 30,
      stockPct: 1.0,
      horizonYears: 3,
      data: SYNTHETIC,
      spendingDeclinePct: 10,
    });
    expect(result.windowsTested).toBe(3);
    expect(result.successes).toBe(3);
    expect(result.survivalPct).toBe(100);
    expect(result.worstStarts).toEqual([]);
  });

  it("the 1% smile never hurts survival on real Shiller data", () => {
    const flat = backtestRetirement({
      nestEgg: 1_000_000,
      annualWithdrawal: 40_000,
      stockPct: 0.6,
      horizonYears: 30,
      data: shillerData,
    });
    const smile = backtestRetirement({
      nestEgg: 1_000_000,
      annualWithdrawal: 40_000,
      stockPct: 0.6,
      horizonYears: 30,
      data: shillerData,
      spendingDeclinePct: 1,
    });
    expect(flat.survivalPct).toBe(98.4);
    // Declining withdrawals withdraw strictly less in every year after year 0,
    // so no window that survived flat can fail with the smile.
    expect(smile.survivalPct).toBeGreaterThanOrEqual(flat.survivalPct);
  });

  it("negative or non-finite decline clamps to flat behavior", () => {
    for (const spendingDeclinePct of [-5, Number.NaN]) {
      const result = backtestRetirement({
        nestEgg: 100,
        annualWithdrawal: 30,
        stockPct: 1.0,
        horizonYears: 3,
        data: SYNTHETIC,
        spendingDeclinePct,
      });
      expect(result.survivalPct).toBe(66.7);
      expect(result.worstStarts).toEqual([2001]);
    }
  });

  it("a zero (or negative) withdrawal always survives — nothing to fund", () => {
    for (const annualWithdrawal of [0, -1000]) {
      const result = backtestRetirement({
        nestEgg: 1_000_000,
        annualWithdrawal,
        stockPct: 0.6,
        horizonYears: 30,
        data: shillerData,
      });
      expect(result.survivalPct).toBe(100);
    }
  });

  it("ending at exactly $0 after the final withdrawal counts as survival", () => {
    // 0% real returns, nestEgg 90, withdrawal 30, horizon 3:
    // 90 -> 60 -> 30 -> 0. The money lasted the full horizon.
    const flat = {
      years: [2000, 2001, 2002, 2003],
      stockReal: [0, 0, 0, 0],
      bondReal: [0, 0, 0, 0],
      inflation: [0, 0, 0, 0],
    };
    const result = backtestRetirement({
      nestEgg: 90,
      annualWithdrawal: 30,
      stockPct: 1.0,
      horizonYears: 3,
      data: flat,
    });
    expect(result.windowsTested).toBe(1);
    expect(result.successes).toBe(1);
    expect(result.survivalPct).toBe(100);
  });

  it("from the same starting nest egg, declining spending isolates the spending shape", () => {
    // 0% real returns, nestEgg 100, withdrawal 60, horizon 2.
    // Flat: 100 -> 40 -> -20 (fails). Declining 50%/yr: 100 -> 40 -> 10 (survives).
    // The UI's flat-vs-declining comparison runs both from the same nest egg
    // so the survival gap reflects the spending shape, not the starting balance.
    const flat = {
      years: [2000, 2001, 2002],
      stockReal: [0, 0, 0],
      bondReal: [0, 0, 0],
      inflation: [0, 0, 0],
    };
    const runFlat = backtestRetirement({
      nestEgg: 100,
      annualWithdrawal: 60,
      stockPct: 1.0,
      horizonYears: 2,
      data: flat,
    });
    const runDeclining = backtestRetirement({
      nestEgg: 100,
      annualWithdrawal: 60,
      stockPct: 1.0,
      horizonYears: 2,
      data: flat,
      spendingDeclinePct: 50,
    });
    expect(runFlat.survivalPct).toBe(0);
    expect(runDeclining.survivalPct).toBe(100);
  });
});
