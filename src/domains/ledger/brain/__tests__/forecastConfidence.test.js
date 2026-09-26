import { describe, expect, it } from "vitest";

import {
  BURN_WINDOW_DAYS,
  MIN_BURN_HISTORY_DAYS,
  MIN_BURN_TRANSACTIONS,
  assessBurnConfidence,
} from "../forecastConfidence.js";

describe("assessBurnConfidence", () => {
  it("withholds on thin data (few days of history)", () => {
    const result = assessBurnConfidence({ daysOfHistory: 12, transactionCount: 200 });
    expect(result.confident).toBe(false);
    expect(result.explanation).toContain("Not enough history to project reliably");
    expect(result.explanation).toContain("12 of the last 90 days");
  });

  it("withholds on thin data (few transactions despite long span)", () => {
    const result = assessBurnConfidence({ daysOfHistory: 90, transactionCount: 5 });
    expect(result.confident).toBe(false);
    expect(result.explanation).toContain("only 5 transactions to learn from");
  });

  it("withholds when there is no history at all", () => {
    const result = assessBurnConfidence({ daysOfHistory: 0, transactionCount: 0 });
    expect(result.confident).toBe(false);
    expect(result.explanation).toContain("Not enough history to project reliably");
  });

  it("shows the metric when data is sufficient", () => {
    const result = assessBurnConfidence({ daysOfHistory: 90, transactionCount: 300 });
    expect(result.confident).toBe(true);
    expect(result.explanation).toBeNull();
  });

  it("passes exactly at both thresholds", () => {
    const result = assessBurnConfidence({
      daysOfHistory: MIN_BURN_HISTORY_DAYS,
      transactionCount: MIN_BURN_TRANSACTIONS,
    });
    expect(result.confident).toBe(true);
  });

  it("fails just under either threshold", () => {
    expect(
      assessBurnConfidence({
        daysOfHistory: MIN_BURN_HISTORY_DAYS - 1,
        transactionCount: MIN_BURN_TRANSACTIONS,
      }).confident,
    ).toBe(false);
    expect(
      assessBurnConfidence({
        daysOfHistory: MIN_BURN_HISTORY_DAYS,
        transactionCount: MIN_BURN_TRANSACTIONS - 1,
      }).confident,
    ).toBe(false);
  });

  it("exposes its thresholds and the window for the UI", () => {
    const result = assessBurnConfidence({ daysOfHistory: 90, transactionCount: 300 });
    expect(BURN_WINDOW_DAYS).toBe(90);
    expect(result.windowDays).toBe(90);
    expect(result.minHistoryDays).toBe(MIN_BURN_HISTORY_DAYS);
    expect(result.minTransactions).toBe(MIN_BURN_TRANSACTIONS);
    expect(result.daysOfHistory).toBe(90);
    expect(result.transactionCount).toBe(300);
  });

  it("treats missing input as no history", () => {
    const result = assessBurnConfidence();
    expect(result.confident).toBe(false);
    expect(result.daysOfHistory).toBe(0);
    expect(result.transactionCount).toBe(0);
  });

  it("ignores non-numeric garbage instead of trusting it", () => {
    const result = assessBurnConfidence({ daysOfHistory: "abc", transactionCount: NaN });
    expect(result.confident).toBe(false);
    expect(result.daysOfHistory).toBe(0);
    expect(result.transactionCount).toBe(0);
  });
});
