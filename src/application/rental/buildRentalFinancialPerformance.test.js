import { describe, expect, it } from "vitest";
import { buildRentalFinancialPerformance } from "./buildRentalFinancialPerformance";

function event(overrides) {
  return { status: "active", is_deleted: false, ...overrides };
}

describe("buildRentalFinancialPerformance — safe source scoping", () => {
  it("includes historical Rentec-sourced income and current FORGE-native income together, in the same month, without double counting", () => {
    const events = [
      event({ event_date: "2026-08-05", amount: "1500.00", transaction_kind: "income", source_system: "rentec" }),
      event({ event_date: "2026-08-12", amount: "1600.00", transaction_kind: "income", source_system: "forge_rental_payment" }),
    ];
    const result = buildRentalFinancialPerformance(events, { today: "2026-08-13", period: { type: "sixMonths" } });
    const august = result.series.find((point) => point.key === "2026-08");
    expect(august.collectedCents).toBe(310000);
  });

  it("includes rentec_api (the financial-history resume importer) income and expenses alongside the legacy rentec CSV import, without double counting", () => {
    const events = [
      event({ event_date: "2026-08-05", amount: "1500.00", transaction_kind: "income", source_system: "rentec" }),
      event({ event_date: "2026-08-06", amount: "700.00", transaction_kind: "income", source_system: "rentec_api" }),
      event({ event_date: "2026-08-05", amount: "200.00", transaction_kind: "expense", source_system: "rentec" }),
      event({ event_date: "2026-08-06", amount: "50.00", transaction_kind: "expense", source_system: "rentec_api" }),
    ];
    const result = buildRentalFinancialPerformance(events, { today: "2026-08-13", period: { type: "sixMonths" } });
    const august = result.series.find((point) => point.key === "2026-08");
    expect(august.collectedCents).toBe(220000);
    expect(august.expensesCents).toBe(25000);
  });

  it("nets a refunded FORGE rent payment back out via its forge_rental_payment_adjustment reversal, instead of counting the refunded money as pure income", () => {
    const events = [
      event({ event_date: "2026-08-20", amount: "20.00", transaction_kind: "income", source_system: "forge_rental_payment" }),
      event({ event_date: "2026-08-22", amount: "1.00", transaction_kind: "income", source_system: "forge_rental_payment" }),
      // The reversal trigger stores the offsetting amount as negative; toCents() takes the
      // absolute value, matching every other expense's positive-dollar convention.
      event({ event_date: "2026-08-22", amount: "-1.00", transaction_kind: "expense", source_system: "forge_rental_payment_adjustment" }),
    ];
    const result = buildRentalFinancialPerformance(events, { today: "2026-08-23", period: { type: "sixMonths" } });
    const august = result.series.find((point) => point.key === "2026-08");
    expect(august.collectedCents).toBe(2100);
    expect(august.expensesCents).toBe(100);
    expect(august.netCents).toBe(2000);
  });

  it("includes Rentec-imported and manually-entered expenses, but excludes bank-feed (Plaid) and QuickBooks expenses whose property attribution to this portfolio isn't guaranteed", () => {
    const events = [
      event({ event_date: "2026-08-05", amount: "200.00", transaction_kind: "expense", source_system: "rentec" }),
      event({ event_date: "2026-08-06", amount: "75.00", transaction_kind: "expense", source_system: "manual" }),
      event({ event_date: "2026-08-07", amount: "999.00", transaction_kind: "expense", source_system: "transaction" }),
      event({ event_date: "2026-08-08", amount: "888.00", transaction_kind: "expense", source_system: "quickbooks" }),
    ];
    const result = buildRentalFinancialPerformance(events, { today: "2026-08-13", period: { type: "sixMonths" } });
    const august = result.series.find((point) => point.key === "2026-08");
    expect(august.expensesCents).toBe(27500);
  });

  it("excludes transfers (tenant security deposits), asset purchases/sales, and liability (loan) payments regardless of source", () => {
    const events = [
      event({ event_date: "2026-08-05", amount: "1500.00", transaction_kind: "transfer", source_system: "rentec" }),
      event({ event_date: "2026-08-05", amount: "50000.00", transaction_kind: "asset_purchase", source_system: "rentec" }),
      event({ event_date: "2026-08-05", amount: "30000.00", transaction_kind: "asset_sale", source_system: "rentec" }),
      event({ event_date: "2026-08-05", amount: "900.00", transaction_kind: "liability_payment", source_system: "rentec" }),
    ];
    const result = buildRentalFinancialPerformance(events, { today: "2026-08-13", period: { type: "sixMonths" } });
    const august = result.series.find((point) => point.key === "2026-08");
    expect(august.collectedCents).toBe(0);
    expect(august.expensesCents).toBe(0);
  });

  it("excludes inactive, deleted, and soft-deleted events", () => {
    const events = [
      event({ event_date: "2026-08-05", amount: "1500.00", transaction_kind: "income", source_system: "rentec", status: "inactive" }),
      event({ event_date: "2026-08-05", amount: "1500.00", transaction_kind: "income", source_system: "rentec", status: "deleted" }),
      event({ event_date: "2026-08-05", amount: "1500.00", transaction_kind: "income", source_system: "rentec", is_deleted: true }),
    ];
    const result = buildRentalFinancialPerformance(events, { today: "2026-08-13", period: { type: "sixMonths" } });
    const august = result.series.find((point) => point.key === "2026-08");
    expect(august.collectedCents).toBe(0);
  });

  it("excludes business_scope=personal even from an otherwise-safe source, as defense in depth", () => {
    // Belt-and-suspenders: quicken_simplifi_csv is already outside SAFE_INCOME_SOURCES/
    // SAFE_EXPENSE_SOURCES, so no personal Simplifi row reaches this today, but a personal-scope
    // row must never count toward rental performance even from a source that IS in the allowlist.
    const events = [
      event({ event_date: "2026-08-05", amount: "1500.00", transaction_kind: "income", source_system: "rentec", business_scope: "personal" }),
      event({ event_date: "2026-08-06", amount: "200.00", transaction_kind: "expense", source_system: "manual", business_scope: "personal" }),
      event({ event_date: "2026-08-07", amount: "700.00", transaction_kind: "income", source_system: "rentec", business_scope: "business" }),
    ];
    const result = buildRentalFinancialPerformance(events, { today: "2026-08-13", period: { type: "sixMonths" } });
    const august = result.series.find((point) => point.key === "2026-08");
    expect(august.collectedCents).toBe(70000);
    expect(august.expensesCents).toBe(0);
  });
});

describe("buildRentalFinancialPerformance — month alignment and net presentation", () => {
  it("aligns collected, expenses, and net to the exact same month keys, with no drift between the two series", () => {
    const events = [
      event({ event_date: "2026-07-10", amount: "1000.00", transaction_kind: "income", source_system: "rentec" }),
      event({ event_date: "2026-08-10", amount: "400.00", transaction_kind: "expense", source_system: "manual" }),
    ];
    const result = buildRentalFinancialPerformance(events, { today: "2026-08-13", period: { type: "sixMonths" } });
    const july = result.series.find((point) => point.key === "2026-07");
    const august = result.series.find((point) => point.key === "2026-08");
    expect(july).toMatchObject({ collectedCents: 100000, expensesCents: 0, netCents: 100000 });
    expect(august).toMatchObject({ collectedCents: 0, expensesCents: 40000, netCents: -40000 });
  });

  it("presents a negative net figure honestly when expenses exceed collections in a month", () => {
    const events = [
      event({ event_date: "2026-08-05", amount: "500.00", transaction_kind: "income", source_system: "rentec" }),
      event({ event_date: "2026-08-06", amount: "2000.00", transaction_kind: "expense", source_system: "manual" }),
    ];
    const result = buildRentalFinancialPerformance(events, { today: "2026-08-13", period: { type: "sixMonths" } });
    const august = result.series.find((point) => point.key === "2026-08");
    expect(august.netCents).toBe(-150000);
  });

  it("returns a truthful zero-value month, distinct from an omitted one, when a month in the window has no safe events at all", () => {
    const result = buildRentalFinancialPerformance([], { today: "2026-08-13", period: { type: "sixMonths" } });
    expect(result.series).toHaveLength(6);
    result.series.forEach((point) => expect(point).toMatchObject({ collectedCents: 0, expensesCents: 0, netCents: 0 }));
  });

  it("returns a truthful month with income but zero expenses, and vice versa, rather than omitting either series", () => {
    const events = [event({ event_date: "2026-08-05", amount: "1500.00", transaction_kind: "income", source_system: "rentec" })];
    const result = buildRentalFinancialPerformance(events, { today: "2026-08-13", period: { type: "sixMonths" } });
    const august = result.series.find((point) => point.key === "2026-08");
    expect(august.collectedCents).toBe(150000);
    expect(august.expensesCents).toBe(0);
  });
});

describe("buildRentalFinancialPerformance — period controls", () => {
  const events = [
    event({ event_date: "2025-11-01", amount: "1000.00", transaction_kind: "income", source_system: "rentec" }),
    event({ event_date: "2026-01-01", amount: "1200.00", transaction_kind: "income", source_system: "rentec" }),
    event({ event_date: "2026-03-01", amount: "1300.00", transaction_kind: "income", source_system: "forge_rental_payment" }),
    event({ event_date: "2026-08-01", amount: "1500.00", transaction_kind: "income", source_system: "forge_rental_payment" }),
  ];

  it("sixMonths ends on the current month and covers exactly the trailing six calendar months", () => {
    const result = buildRentalFinancialPerformance(events, { today: "2026-08-13", period: { type: "sixMonths" } });
    expect(result.series.map((p) => p.key)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
    expect(result.granularity).toBe("monthly");
  });

  it("ytd covers January through the current month only, never future months", () => {
    const result = buildRentalFinancialPerformance(events, { today: "2026-03-15", period: { type: "ytd" } });
    expect(result.series.map((p) => p.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("year shows all twelve months of the selected year, including future and pre-data months as truthful zeros", () => {
    const result = buildRentalFinancialPerformance(events, { today: "2026-08-13", period: { type: "year", year: 2026 } });
    expect(result.series).toHaveLength(12);
    expect(result.series[0].key).toBe("2026-01");
    expect(result.series[11].key).toBe("2026-12");
    expect(result.series.find((p) => p.key === "2026-12").collectedCents).toBe(0);
  });

  it("allTime groups by year, not by month, from the earliest year with data through the current year", () => {
    const result = buildRentalFinancialPerformance(events, { today: "2026-08-13", period: { type: "allTime" } });
    expect(result.granularity).toBe("yearly");
    expect(result.series.map((p) => p.key)).toEqual(["2025", "2026"]);
    expect(result.series.find((p) => p.key === "2025").collectedCents).toBe(100000);
    expect(result.series.find((p) => p.key === "2026").collectedCents).toBe(400000);
  });

  it("floors the allTime view at 2014 even when stray pre-2014 ledger entries exist, so a couple of outlier years don't stretch the chart back across a decade of empty data", () => {
    const eventsWithStrayEarlyEntry = [
      event({ event_date: "2007-03-01", amount: "50.00", transaction_kind: "expense", source_system: "rentec" }),
      ...events,
    ];
    const result = buildRentalFinancialPerformance(eventsWithStrayEarlyEntry, { today: "2026-08-13", period: { type: "allTime" } });
    expect(result.series[0].key).toBe("2014");
    expect(result.availableYears).toEqual([2007, 2025, 2026]);
  });

  it("still starts allTime at a later actual data year when the owner's history begins after 2014", () => {
    const laterEvents = [event({ event_date: "2018-05-01", amount: "500.00", transaction_kind: "income", source_system: "rentec" })];
    const result = buildRentalFinancialPerformance(laterEvents, { today: "2026-08-13", period: { type: "allTime" } });
    expect(result.series[0].key).toBe("2018");
  });

  it("exposes only the years actually present in the owner's safely-scoped financial history for the year selector", () => {
    const result = buildRentalFinancialPerformance(events, { today: "2026-08-13", period: { type: "sixMonths" } });
    expect(result.availableYears).toEqual([2025, 2026]);
  });

  it("returns an empty year list, not a fabricated current year, when there is no safe financial history at all", () => {
    const result = buildRentalFinancialPerformance([], { today: "2026-08-13", period: { type: "sixMonths" } });
    expect(result.availableYears).toEqual([]);
  });

  it("defaults an out-of-range or missing year selection to the current year rather than throwing", () => {
    const result = buildRentalFinancialPerformance(events, { today: "2026-08-13", period: { type: "year" } });
    expect(result.series[0].key).toBe("2026-01");
  });
});

describe("buildRentalFinancialPerformance — UTC-safe keys", () => {
  it("produces month keys that are pure UTC-derived slices, immune to local-timezone drift", () => {
    const events = [event({ event_date: "2026-01-01", amount: "100.00", transaction_kind: "income", source_system: "rentec" })];
    const result = buildRentalFinancialPerformance(events, { today: "2026-08-13", period: { type: "allTime" } });
    // A Date-object round-trip through a non-UTC-pinned formatter is exactly the bug class fixed
    // in ForgeMonthlyTrendChart's monthLabel — this asserts the *data* layer never does that at all.
    expect(result.series[0].key).toBe("2026");
  });

  it("builds six-month window keys via Date.UTC arithmetic, not local Date construction", () => {
    const result = buildRentalFinancialPerformance([], { today: "2026-01-13", period: { type: "sixMonths" } });
    expect(result.series.map((p) => p.key)).toEqual(["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"]);
  });
});
