import { describe, expect, it } from "vitest";
import { buildBusinessExpenseReport } from "./buildBusinessExpenseReport";
import { buildFinancialLedgerReport } from "./buildFinancialLedgerReport";
import { buildIncomeExpenseStatement } from "./buildIncomeExpenseStatement";
import { buildScheduleEAssistant } from "./buildScheduleEAssistant";

const LEGACY = "1900-w-decker"; // legacy CSV import slug
const API_VARIANT = "1900-west-decker"; // Rentec API import slug, same house

function expense(overrides = {}) {
  return {
    id: "evt-1", event_date: "2020-01-06", description: "Mortgage interest",
    amount: -476.8, transaction_kind: "expense", normalized_category: "mortgage_interest",
    property_id: LEGACY, source_system: "rentec", status: "active", is_deleted: false,
    ...overrides,
  };
}

describe("property alias resolution in report builders", () => {
  it("business expense report: both pipeline slugs surface under the canonical filter, once each house", () => {
    const events = [
      expense({ id: "e1", property_id: LEGACY, source_system: "rentec", amount: -476.8 }),
      expense({ id: "e2", property_id: API_VARIANT, source_system: "rentec_api", amount: -476.8 }),
    ];
    const report = buildBusinessExpenseReport({ events }, { propertyId: LEGACY });
    expect(report.summary.transactionCount).toBe(2);
    expect(report.summary.totalExpenses).toBeCloseTo(953.6, 5);
    expect(report.availableProperties).toEqual([LEGACY]);
    for (const row of report.rows) expect(row.propertyId).toBe(LEGACY);
  });

  it("business expense report: filtering the API variant slug resolves to the same canonical house", () => {
    const events = [expense({ property_id: LEGACY }), expense({ property_id: API_VARIANT })];
    const report = buildBusinessExpenseReport({ events }, { propertyId: API_VARIANT });
    expect(report.summary.transactionCount).toBe(2);
  });

  it("another property cannot see the aliased rows", () => {
    const events = [expense({ property_id: LEGACY }), expense({ property_id: API_VARIANT })];
    const report = buildBusinessExpenseReport({ events }, { propertyId: "335-butler" });
    expect(report.summary.transactionCount).toBe(0);
    expect(report.summary.totalExpenses).toBe(0);
  });

  it("manual + legacy + API expenses for one canonical house total correctly", () => {
    const events = [
      expense({ id: "e1", property_id: LEGACY, source_system: "rentec", amount: -100 }),
      expense({ id: "e2", property_id: API_VARIANT, source_system: "rentec_api", amount: -200 }),
      expense({ id: "e3", property_id: LEGACY, source_system: "manual", amount: -50 }),
      expense({ id: "e4", property_id: "335-butler", source_system: "rentec", amount: -999 }),
    ];
    const report = buildBusinessExpenseReport({ events }, { propertyId: LEGACY });
    expect(report.summary.totalExpenses).toBeCloseTo(350, 5);
    const byProperty = Object.fromEntries(report.byProperty.map((p) => [p.propertyId, p.amount]));
    expect(byProperty[LEGACY]).toBeCloseTo(350, 5);
    expect(byProperty[API_VARIANT]).toBeUndefined();
  });

  it("financial ledger report: canonical filter matches both variants and lists one canonical property", () => {
    const events = [expense({ property_id: LEGACY }), expense({ property_id: API_VARIANT })];
    const report = buildFinancialLedgerReport({ events }, { propertyId: LEGACY });
    expect(report.rows).toHaveLength(2);
    expect(report.availableProperties).toEqual([LEGACY]);
    for (const row of report.rows) expect(row.propertyId).toBe(LEGACY);
  });

  it("income/expense statement: byProperty groups both variants under the canonical slug", () => {
    const events = [
      { ...expense({ id: "e1", property_id: LEGACY }), transaction_kind: "income", amount: 1000, normalized_category: "rental_income" },
      expense({ id: "e2", property_id: API_VARIANT, amount: -200 }),
    ];
    const report = buildIncomeExpenseStatement({ events }, { propertyId: LEGACY });
    expect(report.summary.income).toBeCloseTo(1000, 5);
    expect(report.summary.expenses).toBeCloseTo(200, 5);
    const byProperty = Object.fromEntries(report.byProperty.map((p) => [p.propertyId, p]));
    expect(byProperty[LEGACY].net).toBeCloseTo(800, 5);
    expect(byProperty[API_VARIANT]).toBeUndefined();
  });

  it("schedule E assistant: canonical filter includes both variants", () => {
    const events = [
      expense({ id: "e1", property_id: LEGACY, event_date: "2020-01-06" }),
      expense({ id: "e2", property_id: API_VARIANT, event_date: "2020-02-06" }),
    ];
    const report = buildScheduleEAssistant({ events }, { taxYear: 2020, propertyId: LEGACY });
    // Note: totalExpensesCents accumulates the raw amount field (a pre-existing mislabeled
    // unit in this builder), so the expectation uses dollars, matching the code's behavior.
    expect(report.summary.totalExpensesCents).toBeCloseTo(953.6, 5);
  });
});
