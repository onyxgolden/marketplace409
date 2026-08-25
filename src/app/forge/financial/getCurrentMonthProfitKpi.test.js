import { describe, expect, test } from "vitest";
import { getCurrentMonthProfitKpi } from "./getCurrentMonthProfitKpi.js";

function tx(overrides = {}) {
  return {
    id: "t1",
    eventDate: "2026-08-15",
    amount: 100,
    transactionKind: "income",
    category: "rental_income",
    businessScope: "business",
    financialAccountId: "acct-1",
    ...overrides,
  };
}

describe("getCurrentMonthProfitKpi", () => {
  test("excludes prior-month activity", () => {
    const result = getCurrentMonthProfitKpi(
      [tx({ id: "prior", eventDate: "2026-07-31", amount: 5000 })],
      { scope: "business", today: "2026-08-15" },
    );

    expect(result.revenueDollars).toBe(0);
    expect(result.expensesDollars).toBe(0);
    expect(result.profitDollars).toBe(0);
  });

  test("includes current-month income and expenses", () => {
    const result = getCurrentMonthProfitKpi(
      [
        tx({ id: "income-1", eventDate: "2026-08-01", amount: 3000, transactionKind: "income" }),
        tx({ id: "income-2", eventDate: "2026-08-31", amount: 1000, transactionKind: "income" }),
        tx({ id: "expense-1", eventDate: "2026-08-15", amount: 1200, transactionKind: "expense" }),
      ],
      { scope: "business", today: "2026-08-15" },
    );

    expect(result.revenueDollars).toBe(4000);
    expect(result.expensesDollars).toBe(1200);
    expect(result.profitDollars).toBe(2800);
    expect(result.monthKey).toBe("2026-08");
  });

  test("business and personal scopes do not blend", () => {
    const transactions = [
      tx({ id: "biz", eventDate: "2026-08-10", amount: 5000, businessScope: "business" }),
      tx({ id: "personal", eventDate: "2026-08-10", amount: 9000, businessScope: "personal" }),
    ];

    const business = getCurrentMonthProfitKpi(transactions, { scope: "business", today: "2026-08-15" });
    const personal = getCurrentMonthProfitKpi(transactions, { scope: "personal", today: "2026-08-15" });

    expect(business.revenueDollars).toBe(5000);
    expect(personal.revenueDollars).toBe(9000);
  });

  test("returns plain dollar amounts, not cents -- callers must not divide again", () => {
    const result = getCurrentMonthProfitKpi(
      [tx({ eventDate: "2026-08-10", amount: 4235.67, transactionKind: "income" })],
      { scope: "business", today: "2026-08-15" },
    );

    // Regression: page.js's money() formatter divided every dollar KPI by 100, on the mistaken
    // assumption its inputs were cents (fixed separately, PR #18). If this function ever started
    // returning cents instead of dollars, money(result.revenueDollars) would silently display
    // $42.36 instead of $4,235.67 -- pin the exact dollar-scale contract here.
    expect(result.revenueDollars).toBe(4235.67);
    expect(result.revenueDollars).not.toBe(423567);
    expect(result.revenueDollars).not.toBe(42.3567);
  });

  test("month boundaries: the last day of the prior month and the first day of the current month are bucketed correctly", () => {
    const result = getCurrentMonthProfitKpi(
      [
        tx({ id: "last-day-prior-month", eventDate: "2026-07-31", amount: 1, transactionKind: "income" }),
        tx({ id: "first-day-current-month", eventDate: "2026-08-01", amount: 2, transactionKind: "income" }),
        tx({ id: "last-day-current-month", eventDate: "2026-08-31", amount: 3, transactionKind: "income" }),
      ],
      { scope: "business", today: "2026-08-31" },
    );

    expect(result.revenueDollars).toBe(5);
  });

  test("resolves \"today\" via UTC (Date.toISOString), independent of the caller's local timezone", () => {
    // No explicit `today` -- exercises the real default (`new Date().toISOString().slice(0, 10)`),
    // which is always UTC regardless of the host's configured local timezone. Assert only that it
    // resolves to *a* month bucketed from event dates without throwing, since the real current date
    // is not under test control here.
    const result = getCurrentMonthProfitKpi([tx({ eventDate: "2026-08-15", amount: 10 })], { scope: "business" });
    expect(typeof result.monthKey).toBe("string");
    expect(result.monthKey).toMatch(/^\d{4}-\d{2}$/);
  });

  test("defaults to a zeroed result for an empty transaction list", () => {
    const result = getCurrentMonthProfitKpi([], { scope: "business", today: "2026-08-15" });
    expect(result).toEqual({ monthKey: "2026-08", revenueDollars: 0, expensesDollars: 0, profitDollars: 0 });
  });
});
