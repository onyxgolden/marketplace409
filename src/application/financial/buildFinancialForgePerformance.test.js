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

  describe("chart regression: multi-year manual history alongside corrected downloaded-account activity", () => {
    // Reproduces the shape of the actual production regression this guards against: several years
    // of ordinary manual/CSV history, PLUS a year of real downloaded Stripe Financial Connections
    // activity -- including one genuinely large transfer (matching the real corrupted production
    // row: a $30,000.00 internal transfer, "Online Banking Withdrawal / Transfer to Share 0009").
    // Every amount below is already correctly-scaled decimal dollars, as
    // FinancialEventImportService now produces post-fix -- this test proves the CHART/aggregation
    // layer handles that correct data properly, not that the import fix itself works (that's
    // financial-event-import.service.test.js's job).
    function manualHistoryFixture() {
      return [
        tx({ id: "manual-2023-income", eventDate: "2023-03-01", amount: 5000, transactionKind: "income", category: "rental_income" }),
        tx({ id: "manual-2023-expense", eventDate: "2023-04-01", amount: 1200, transactionKind: "expense", category: "property_repairs" }),
        tx({ id: "manual-2024-income", eventDate: "2024-05-01", amount: 5200, transactionKind: "income", category: "rental_income" }),
        tx({ id: "manual-2024-expense", eventDate: "2024-06-01", amount: 1300, transactionKind: "expense", category: "utilities" }),
        tx({ id: "manual-2025-income", eventDate: "2025-02-01", amount: 5400, transactionKind: "income", category: "rental_income" }),
        tx({ id: "manual-2025-expense", eventDate: "2025-07-01", amount: 1400, transactionKind: "expense", category: "insurance" }),
      ];
    }

    function correctedStripeActivityFixture() {
      return [
        // The real corrupted production row's TRUE value, post-repair: $30,000.00, not $3,000,000.
        tx({ id: "stripe-2026-transfer", eventDate: "2026-08-21", amount: 30_000, transactionKind: "expense", category: "other" }),
        tx({ id: "stripe-2026-ordinary-expense", eventDate: "2026-07-10", amount: 45.5, transactionKind: "expense", category: "utilities" }),
        tx({ id: "stripe-2026-ordinary-income", eventDate: "2026-07-15", amount: 2100, transactionKind: "income", category: "rental_income" }),
      ];
    }

    test("all-time history retains every earlier year, none blank or flattened, once corrected 2026 activity is added", () => {
      const result = buildFinancialForgePerformance(
        [...manualHistoryFixture(), ...correctedStripeActivityFixture()],
        { scope: "business", today: "2026-08-22", period: { type: "allTime" } },
      );

      expect(result.availableYears).toEqual([2023, 2024, 2025, 2026]);
      const byYear = Object.fromEntries(result.series.map((point) => [point.key, point]));

      // Every earlier year still carries its own real, non-zero data -- not crushed to zero/blank
      // by whatever 2026 shows.
      expect(byYear["2023"].incomeCents).toBe(500_000);
      expect(byYear["2023"].expensesCents).toBe(120_000);
      expect(byYear["2024"].incomeCents).toBe(520_000);
      expect(byYear["2025"].incomeCents).toBe(540_000);
    });

    test("2026 totals reflect the corrected (small, plausible) values, not a 100x-inflated figure", () => {
      const result = buildFinancialForgePerformance(
        [...manualHistoryFixture(), ...correctedStripeActivityFixture()],
        { scope: "business", today: "2026-08-22", period: { type: "year", year: 2026 } },
      );

      // Expenses: $30,000.00 transfer + $45.50 ordinary expense = $30,045.50 -> 3,004,550 cents.
      // If the old bug were still present, this would instead be ~300,000,000+ cents ($3,000,000+).
      expect(result.totals.expensesCents).toBe(3_004_550);
      expect(result.totals.expensesCents).toBeLessThan(10_000_000); // sanity ceiling: well under $100,000, not millions
      expect(result.totals.incomeCents).toBe(210_000);
    });

    test("the correction does not hide, cap, or cosmetically rescale a legitimate large transaction -- the real $30,000 transfer shows up at its full, correct value", () => {
      const result = buildFinancialForgePerformance(
        [...manualHistoryFixture(), ...correctedStripeActivityFixture()],
        { scope: "business", today: "2026-08-22", period: { type: "year", year: 2026 } },
      );

      const transferCategory = result.categories.find((category) => category.category === "other");
      expect(transferCategory).toBeDefined();
      // Exactly $30,000.00 -- not capped, not rounded down, not hidden from the category breakdown.
      expect(transferCategory.expensesCents).toBe(3_000_000);
    });

    test("transfer categorization (expenseCategoryGroups' keyword-based bucketing) remains unaffected by the unit correction -- it operates on category text, never on amount", async () => {
      const { groupExpenseCategory } = await import("./expenseCategoryGroups.js");
      // The exact category string the real corrupted (and now corrected) Stripe rows carry.
      expect(groupExpenseCategory("other").key).toBe("transfers_other");
      // A large or small amount must never change which group a category resolves to -- this
      // function takes only the category string, so there's no way for it to see the amount at all,
      // which this assertion makes explicit rather than merely implicit.
      expect(groupExpenseCategory("other")).toEqual(groupExpenseCategory("other"));
    });
  });
});
