import { describe, expect, it } from "vitest";
import { computeCategorySuggestion } from "../budgetSuggestion.js";

describe("computeCategorySuggestion", () => {
  it("computes the median of the last N complete calendar months", () => {
    const events = [
      { eventDate: "2026-06-05", amount: 300 },
      { eventDate: "2026-06-20", amount: 100 }, // June total: 400
      { eventDate: "2026-07-10", amount: 350 }, // July total: 350
      { eventDate: "2026-08-01", amount: 500 }, // August total: 500
    ];

    const result = computeCategorySuggestion({ events, asOfDate: "2026-09-18", lookbackMonths: 3 });

    expect(result.suggestedAmountCents).toBe(40000); // median of [400, 350, 500] = 400
    expect(result.sampleMonths).toBe(3);
    expect(result.basisMonths).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("resists a single spike month via the median rather than an average", () => {
    const events = [
      { eventDate: "2026-06-15", amount: 100 },
      { eventDate: "2026-07-15", amount: 100 },
      { eventDate: "2026-08-15", amount: 900 }, // spike
    ];

    const result = computeCategorySuggestion({ events, asOfDate: "2026-09-18", lookbackMonths: 3 });

    expect(result.suggestedAmountCents).toBe(10000); // median of [100, 100, 900] = 100, not the ~367 average
  });

  it("returns a null suggestion when the category has no events in the lookback window", () => {
    const events = [{ eventDate: "2025-01-10", amount: 50 }]; // far outside the 3-month window

    const result = computeCategorySuggestion({ events, asOfDate: "2026-09-18", lookbackMonths: 3 });

    expect(result.suggestedAmountCents).toBeNull();
    expect(result.sampleMonths).toBe(0);
  });

  it("excludes events from the current in-progress month", () => {
    const events = [
      { eventDate: "2026-08-10", amount: 200 }, // August total: 200
      { eventDate: "2026-09-05", amount: 999999 }, // current month -- must be ignored entirely
    ];

    const result = computeCategorySuggestion({ events, asOfDate: "2026-09-18", lookbackMonths: 3 });

    // Only August had data; June and July are real $0 samples -- median of [0, 0, 200] = 0.
    expect(result.suggestedAmountCents).toBe(0);
    expect(result.sampleMonths).toBe(1);
    expect(result.basisMonths).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("treats a month with zero matching events as a real $0 sample, not missing data", () => {
    const events = [
      { eventDate: "2026-08-10", amount: 300 }, // only August has this category
    ];

    const result = computeCategorySuggestion({ events, asOfDate: "2026-09-18", lookbackMonths: 3 });

    expect(result.suggestedAmountCents).toBe(0); // median of [0, 0, 300] = 0
    expect(result.sampleMonths).toBe(1);
  });

  it("rejects a non-array events argument", () => {
    expect(() => computeCategorySuggestion({ events: null, asOfDate: "2026-09-18" })).toThrow(/events must be an array/);
  });

  it("rejects a missing asOfDate", () => {
    expect(() => computeCategorySuggestion({ events: [], asOfDate: "" })).toThrow(/asOfDate is required/);
  });

  it("rejects a non-positive-integer lookbackMonths", () => {
    expect(() => computeCategorySuggestion({ events: [], asOfDate: "2026-09-18", lookbackMonths: 0 })).toThrow(/lookbackMonths must be a positive integer/);
    expect(() => computeCategorySuggestion({ events: [], asOfDate: "2026-09-18", lookbackMonths: 2.5 })).toThrow(/lookbackMonths must be a positive integer/);
  });
});
