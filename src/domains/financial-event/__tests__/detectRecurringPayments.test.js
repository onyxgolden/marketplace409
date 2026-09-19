import { describe, expect, test } from "vitest";
import { detectRecurringPayments, cadenceLabel, monthlyEquivalentAmount } from "../detectRecurringPayments.js";

function row(id, eventDate, amount, extra = {}) {
  return {
    id,
    eventDate,
    amount,
    accountId: "acct-1",
    accountName: "Regular Savings Account",
    transactionKind: amount < 0 ? "income" : "expense",
    normalizedCategory: "mortgage_payment",
    ...extra,
  };
}

describe("detectRecurringPayments", () => {
  test("finds a biweekly pattern with amount drift and one missed payment", () => {
    // Mirrors the real mortgage series: 1413.83 -> 1482.50 drift, ~15-day gaps,
    // one 31-day gap where a leg never arrived.
    const rows = [
      row("a", "2026-03-15", 1413.83),
      row("b", "2026-03-20", 1413.83),
      row("c", "2026-04-06", 1413.83),
      row("d", "2026-04-20", 1413.83),
      row("e", "2026-05-06", 1482.5),
      row("f", "2026-05-20", 1482.5),
      row("g", "2026-06-20", 1482.5), // skipped 06-06: 30-day gap
      row("h", "2026-07-06", 1482.5),
    ];
    const [pattern] = detectRecurringPayments(rows);
    expect(pattern).toBeDefined();
    expect(pattern.cadence).toBe("biweekly");
    expect(pattern.occurrences).toBe(8);
    expect(pattern.medianAmount).toBeCloseTo(1448.17, 0);
    expect(pattern.nextExpectedDate).toBe("2026-07-22"); // last 07-06 + median 16d
    expect(pattern.irregularIntervals).toBeGreaterThanOrEqual(1);
  });

  test("finds a clean monthly subscription", () => {
    const rows = [
      row("a", "2026-06-01", 15.99, { normalizedCategory: "subscriptions" }),
      row("b", "2026-07-01", 15.99, { normalizedCategory: "subscriptions" }),
      row("c", "2026-08-01", 15.99, { normalizedCategory: "subscriptions" }),
      row("d", "2026-09-01", 15.99, { normalizedCategory: "subscriptions" }),
    ];
    const [pattern] = detectRecurringPayments(rows);
    expect(pattern.cadence).toBe("monthly");
    expect(pattern.occurrences).toBe(4);
    expect(pattern.nextExpectedDate).toBe("2026-10-02"); // last 09-01 + median 31d
  });

  test("ignores groups with fewer than 3 occurrences", () => {
    const rows = [row("a", "2026-08-01", 50), row("b", "2026-09-01", 50)];
    expect(detectRecurringPayments(rows)).toEqual([]);
  });

  test("ignores irregular spending", () => {
    const rows = [
      row("a", "2026-01-05", 42.1),
      row("b", "2026-03-17", 41.8),
      row("c", "2026-04-02", 43.0),
      row("d", "2026-08-29", 42.5),
    ];
    expect(detectRecurringPayments(rows)).toEqual([]);
  });

  test("splits different amounts on the same account into separate non-patterns", () => {
    const rows = [
      row("a", "2026-07-01", 100),
      row("b", "2026-07-02", 5000),
      row("c", "2026-08-01", 100),
      row("d", "2026-08-02", 5000),
    ];
    // Each amount appears twice -- below the 3-occurrence minimum.
    expect(detectRecurringPayments(rows)).toEqual([]);
  });

  test("separates inbound from outbound", () => {
    const rows = [
      row("a", "2026-07-01", -2000, { normalizedCategory: "payroll" }),
      row("b", "2026-07-15", -2000, { normalizedCategory: "payroll" }),
      row("c", "2026-07-29", -2000, { normalizedCategory: "payroll" }),
      row("d", "2026-07-01", 2000, { normalizedCategory: "payroll" }),
      row("e", "2026-07-15", 2000, { normalizedCategory: "payroll" }),
      row("f", "2026-07-29", 2000, { normalizedCategory: "payroll" }),
    ];
    const patterns = detectRecurringPayments(rows);
    expect(patterns).toHaveLength(2);
    expect(new Set(patterns.map((p) => p.direction))).toEqual(new Set(["inbound", "outbound"]));
  });

  test("skips zero-amount and dateless rows", () => {
    const rows = [
      row("a", "2026-07-01", 25),
      row("b", "2026-08-01", 25),
      row("c", "2026-09-01", 25),
      { id: "z", eventDate: "2026-10-01", amount: 0 },
      { id: "n", eventDate: null, amount: 25 },
    ];
    const [pattern] = detectRecurringPayments(rows);
    expect(pattern.occurrences).toBe(3);
  });
});

describe("cadenceLabel", () => {
  test("labels common cadences", () => {
    expect(cadenceLabel(7)).toBe("weekly");
    expect(cadenceLabel(14)).toBe("biweekly");
    expect(cadenceLabel(15.2)).toBe("biweekly");
    expect(cadenceLabel(30)).toBe("monthly");
    expect(cadenceLabel(91)).toBe("quarterly");
    expect(cadenceLabel(365)).toBe("yearly");
    expect(cadenceLabel(45)).toBe("every 45 days");
  });
});

describe("monthlyEquivalentAmount", () => {
  test("scales a biweekly amount to a month", () => {
    // The real mortgage: $1,482.50 every ~16 days -> ~$2,820/mo.
    expect(monthlyEquivalentAmount({ medianAmount: 1482.5, medianIntervalDays: 16 })).toBeCloseTo(2820.46, 1);
  });

  test("leaves a monthly amount nearly unchanged", () => {
    expect(monthlyEquivalentAmount({ medianAmount: 3.75, medianIntervalDays: 30 })).toBeCloseTo(3.81, 1);
  });

  test("falls back to the raw amount without a usable interval", () => {
    expect(monthlyEquivalentAmount({ medianAmount: 100, medianIntervalDays: 0 })).toBe(100);
    expect(monthlyEquivalentAmount({ medianAmount: 100 })).toBe(100);
    expect(monthlyEquivalentAmount(null)).toBe(0);
  });
});

describe("pattern identity passthrough", () => {
  test("carries accountId and businessScope through to the pattern", () => {
    const rows = [
      { id: "a", eventDate: "2026-07-01", amount: 50, accountId: "acct-9", accountName: "Advantage", businessScope: "personal", transactionKind: "expense", normalizedCategory: "groceries" },
      { id: "b", eventDate: "2026-08-01", amount: 50, accountId: "acct-9", accountName: "Advantage", businessScope: "personal", transactionKind: "expense", normalizedCategory: "groceries" },
      { id: "c", eventDate: "2026-09-01", amount: 50, accountId: "acct-9", accountName: "Advantage", businessScope: "personal", transactionKind: "expense", normalizedCategory: "groceries" },
    ];
    const [pattern] = detectRecurringPayments(rows);
    expect(pattern.accountId).toBe("acct-9");
    expect(pattern.businessScope).toBe("personal");
  });
});
