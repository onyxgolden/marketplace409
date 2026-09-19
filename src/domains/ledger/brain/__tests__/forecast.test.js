import { describe, expect, it } from "vitest";

import { forecastCashFlow } from "../forecast.js";

const START = "2026-09-19";

function monthlyOutflow({ accountId, amount, firstDate = START, intervalDays = 30 }) {
  return {
    accountId,
    direction: "outbound",
    medianAmount: amount,
    medianIntervalDays: intervalDays,
    nextExpectedDate: firstDate,
    cadence: "monthly",
    category: "test",
  };
}

describe("forecastCashFlow", () => {
  it("projects a monthly outflow plus daily burn with correct checkpoint math", () => {
    const result = forecastCashFlow({
      accounts: [{ accountId: "a1", name: "Checking", startingBalance: 5000 }],
      recurringPatterns: [monthlyOutflow({ accountId: "a1", amount: 1000 })],
      dailyBurn: { a1: 50 },
      startDate: START,
      days: 35,
    });

    const [account] = result.accounts;
    expect(account.startingBalance).toBe(5000);
    // Day 0: 5000 - 1000 (rent) - 50 (burn).
    expect(account.checkpoints[0]).toEqual({ date: "2026-09-19", projectedBalance: 3950 });
    // Day 6: 3950 - 6 * 50.
    expect(account.checkpoints[1]).toEqual({ date: "2026-09-25", projectedBalance: 3650 });
    // Day 30 hits the second rent occurrence: 2500 - 1000 - 50 = 1450; day 34 = 1250.
    expect(account.minBalance).toBe(1250);
    expect(account.minBalanceDate).toBe("2026-10-23");
    const last = account.checkpoints[account.checkpoints.length - 1];
    expect(last).toEqual({ date: "2026-10-23", projectedBalance: 1250 });
    expect(result.warnings).toEqual([]);
  });

  it("lands biweekly occurrences on the right dates", () => {
    const result = forecastCashFlow({
      accounts: [{ accountId: "a1", name: "Savings", startingBalance: 10000 }],
      recurringPatterns: [monthlyOutflow({ accountId: "a1", amount: 1482.5, intervalDays: 14 })],
      dailyBurn: {},
      startDate: START,
      days: 35,
    });

    const [account] = result.accounts;
    const byDate = Object.fromEntries(account.checkpoints.map((c) => [c.date, c.projectedBalance]));
    // Day 13 (10/2): only the day-0 mortgage has hit.
    expect(byDate["2026-10-02"]).toBe(8517.5);
    // Day 20 (10/9): day-0 and day-14 mortgages have hit.
    expect(byDate["2026-10-09"]).toBe(7035);
    // Worst balance is first reached on day 28 (third mortgage); it stays flat after.
    expect(account.minBalance).toBe(5552.5);
    expect(account.minBalanceDate).toBe("2026-10-17");
  });

  it("emits exactly one warning at the worst day of a shortfall episode", () => {
    const result = forecastCashFlow({
      accounts: [{ accountId: "a1", name: "Checking", startingBalance: 100 }],
      recurringPatterns: [],
      dailyBurn: { a1: 50 },
      startDate: START,
      days: 10,
      safetyBuffer: 1000,
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      accountId: "a1",
      accountName: "Checking",
      type: "shortfall",
      date: "2026-09-28",
      projectedBalance: -400,
      daysFromStart: 9,
    });
  });

  it("emits a tight warning -- not a shortfall -- when the balance stays positive", () => {
    const result = forecastCashFlow({
      accounts: [{ accountId: "a1", name: "Checking", startingBalance: 1200 }],
      recurringPatterns: [],
      dailyBurn: { a1: 50 },
      startDate: START,
      days: 10,
      safetyBuffer: 1000,
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ type: "tight", projectedBalance: 700 });
  });

  it("splits contiguous episodes into separate warnings", () => {
    // Dips under the buffer, recovers above it via an inbound occurrence, dips again.
    const result = forecastCashFlow({
      accounts: [{ accountId: "a1", name: "Checking", startingBalance: 1100 }],
      recurringPatterns: [
        { accountId: "a1", direction: "inbound", medianAmount: 1500, medianIntervalDays: 8, nextExpectedDate: "2026-09-22", category: "pay" },
      ],
      dailyBurn: { a1: 300 },
      startDate: START,
      days: 20,
      safetyBuffer: 1000,
    });

    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toMatchObject({
      type: "tight",
      date: "2026-09-21",
      projectedBalance: 200,
    });
    expect(result.warnings[1]).toMatchObject({
      type: "shortfall",
      date: "2026-10-07",
      projectedBalance: -1600,
    });
  });

  it("projects a burn-only line when there are no patterns", () => {
    const result = forecastCashFlow({
      accounts: [{ accountId: "a1", name: "Checking", startingBalance: 1000 }],
      recurringPatterns: [],
      dailyBurn: { a1: 25 },
      startDate: START,
      days: 8,
    });

    const [account] = result.accounts;
    expect(account.checkpoints).toHaveLength(3); // day 0, day 6, final day
    expect(account.checkpoints[account.checkpoints.length - 1].projectedBalance).toBe(800);
    expect(account.dailyBurn).toBe(25);
  });

  it("attributes occurrences to the right account only", () => {
    const result = forecastCashFlow({
      accounts: [
        { accountId: "a1", name: "Checking", startingBalance: 5000 },
        { accountId: "b1", name: "Savings", startingBalance: 2000 },
      ],
      recurringPatterns: [monthlyOutflow({ accountId: "b1", amount: 900 })],
      dailyBurn: {},
      startDate: START,
      days: 35,
    });

    const checking = result.accounts.find((a) => a.accountId === "a1");
    expect(checking.checkpoints.every((c) => c.projectedBalance === 5000)).toBe(true);
    const savings = result.accounts.find((a) => a.accountId === "b1");
    expect(savings.minBalance).toBe(200);
  });

  it("clamps the horizon to the 180-day cap", () => {
    const result = forecastCashFlow({
      accounts: [{ accountId: "a1", name: "Checking", startingBalance: 1000 }],
      startDate: START,
      days: 500,
    });

    expect(result.meta.days).toBe(180);
    // Day 0, every 7th day (indices 6..174), plus the final day: 1 + 25 + 1.
    expect(result.accounts[0].checkpoints).toHaveLength(27);
    const last = result.accounts[0].checkpoints[26];
    expect(last.date).toBe("2027-03-17");
  });

  it("returns an empty result for no accounts without throwing", () => {
    const result = forecastCashFlow({ accounts: [], startDate: START, days: 30 });
    expect(result.accounts).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("falls back to a fixed start when the start date is invalid", () => {
    const result = forecastCashFlow({
      accounts: [{ accountId: "a1", name: "Checking", startingBalance: 100 }],
      startDate: "not-a-date",
      days: 3,
    });
    expect(result.meta.startDate).toBe("2026-01-01");
    expect(result.accounts[0].checkpoints[0].date).toBe("2026-01-01");
  });

  it("produces JSON-serializable output", () => {
    const result = forecastCashFlow({
      accounts: [{ accountId: "a1", name: "Checking", startingBalance: 100 }],
      recurringPatterns: [monthlyOutflow({ accountId: "a1", amount: 50 })],
      dailyBurn: { a1: 10 },
      startDate: START,
      days: 35,
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
