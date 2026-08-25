import { describe, expect, test } from "vitest";
import { buildFinancialForgePerformance } from "./buildFinancialForgePerformance.js";

function tx(overrides = {}) {
  return {
    id: "t1",
    eventDate: "2026-06-15",
    amount: 100,
    transactionKind: "income",
    category: "rental_income",
    businessScope: "business",
    financialAccountId: "acct-1",
    ...overrides,
  };
}

describe("buildFinancialForgePerformance", () => {
  test("rejects an unsupported scope", () => {
    expect(() => buildFinancialForgePerformance([], { scope: "rental" })).toThrow(
      "Financial FORGE performance scope must be \"business\" or \"personal\", got: rental",
    );
  });

  test("excludes personal-scoped events from a business-scoped view, and vice versa", () => {
    const events = [
      tx({ id: "biz-1", businessScope: "business", amount: 1000 }),
      tx({ id: "personal-1", businessScope: "personal", amount: 500 }),
    ];

    const business = buildFinancialForgePerformance(events, { scope: "business", today: "2026-06-20" });
    const personal = buildFinancialForgePerformance(events, { scope: "personal", today: "2026-06-20" });

    expect(business.totals.incomeCents).toBe(100000);
    expect(personal.totals.incomeCents).toBe(50000);
  });

  test("excludes asset_purchase transactions from income/expense totals", () => {
    const events = [
      tx({ id: "purchase-1", transactionKind: "asset_purchase", amount: 5000 }),
    ];

    const result = buildFinancialForgePerformance(events, { scope: "business", today: "2026-06-20" });

    expect(result.totals.incomeCents).toBe(0);
    expect(result.totals.expensesCents).toBe(0);
    expect(result.totals.transactionCount).toBe(0);
  });

  test("sixMonths buckets the trailing 6 calendar months ending on today's month", () => {
    const result = buildFinancialForgePerformance(
      [tx({ eventDate: "2026-06-15", amount: 200 })],
      { scope: "business", today: "2026-06-20", period: { type: "sixMonths" } },
    );

    expect(result.series.map((point) => point.key)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
    ]);
    expect(result.series.at(-1).incomeCents).toBe(20000);
    expect(result.granularity).toBe("monthly");
  });

  test("ytd buckets January through the current month", () => {
    const result = buildFinancialForgePerformance([], { scope: "business", today: "2026-03-10", period: { type: "ytd" } });

    expect(result.series.map((point) => point.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  test("year buckets all 12 months of the requested year", () => {
    const result = buildFinancialForgePerformance([], { scope: "business", today: "2026-06-20", period: { type: "year", year: 2025 } });

    expect(result.series).toHaveLength(12);
    expect(result.series[0].key).toBe("2025-01");
    expect(result.series.at(-1).key).toBe("2025-12");
  });

  test("allTime buckets by year and reports every year that has data", () => {
    const events = [
      tx({ eventDate: "2024-03-01", amount: 100 }),
      tx({ eventDate: "2026-06-15", amount: 200 }),
    ];

    const result = buildFinancialForgePerformance(events, { scope: "business", today: "2026-06-20", period: { type: "allTime" } });

    expect(result.granularity).toBe("yearly");
    expect(result.series.map((point) => point.key)).toEqual(["2024", "2025", "2026"]);
    expect(result.availableYears).toEqual([2024, 2026]);
  });

  test("builds a category breakdown scoped to the selected period", () => {
    const events = [
      tx({ eventDate: "2026-06-01", category: "utilities", transactionKind: "expense", amount: 75 }),
      tx({ eventDate: "2025-01-01", category: "utilities", transactionKind: "expense", amount: 999 }),
    ];

    const result = buildFinancialForgePerformance(events, { scope: "business", today: "2026-06-20", period: { type: "ytd" } });

    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].category).toBe("utilities");
    expect(result.categories[0].expensesCents).toBe(7500);
  });

  test("builds an account reconciliation breakdown using the supplied account names", () => {
    const events = [
      tx({ eventDate: "2026-06-01", financialAccountId: "acct-1", amount: 100 }),
      tx({ eventDate: "2026-06-02", financialAccountId: "acct-1", transactionKind: "expense", amount: 40 }),
    ];

    const result = buildFinancialForgePerformance(events, {
      scope: "business", today: "2026-06-20", period: { type: "ytd" },
      accountsById: { "acct-1": "Business Savings" },
    });

    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].accountName).toBe("Business Savings");
    expect(result.accounts[0].transactionCount).toBe(2);
    expect(result.accounts[0].netCents).toBe(6000);
  });

  test("reports the true earliest/latest date coverage regardless of the selected period", () => {
    const events = [
      tx({ eventDate: "2025-01-01" }),
      tx({ eventDate: "2026-08-22" }),
    ];

    const result = buildFinancialForgePerformance(events, { scope: "business", today: "2026-08-24", period: { type: "sixMonths" } });

    expect(result.coverage).toEqual({ earliest: "2025-01-01", latest: "2026-08-22" });
  });

  test("returns null coverage bounds when the scope has no activity at all", () => {
    const result = buildFinancialForgePerformance(
      [tx({ businessScope: "personal" })],
      { scope: "business", today: "2026-06-20" },
    );

    expect(result.coverage).toEqual({ earliest: null, latest: null });
  });
});
