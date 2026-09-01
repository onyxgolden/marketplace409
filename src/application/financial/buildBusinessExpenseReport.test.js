import { describe, expect, it } from "vitest";
import { buildBusinessExpenseReport, businessExpenseReportToCsv } from "./buildBusinessExpenseReport";

const events = [
  { id: "a", event_date: "2026-08-01", description: "Roof repair", amount: 500, transaction_kind: "expense", normalized_category: "property_repairs", property_id: "930-highland", status: "active" },
  { id: "b", event_date: "2026-08-02", description: "Accounting software", amount: 50, transaction_kind: "expense", normalized_category: "software", property_id: null, status: "active" },
  { id: "c", event_date: "2026-08-03", description: "Rent", amount: 1200, transaction_kind: "income", normalized_category: "rental_income", property_id: "930-highland", status: "active" },
  { id: "d", event_date: "2026-08-04", description: "Old expense", amount: 99, transaction_kind: "expense", normalized_category: "software", property_id: null, status: "deleted", is_deleted: true },
];

describe("buildBusinessExpenseReport", () => {
  it("reports active expenses without including income", () => {
    const report = buildBusinessExpenseReport({ events });
    expect(report.summary).toEqual({ transactionCount: 2, totalExpenses: 550 });
    expect(report.rows.map((row) => row.id)).toEqual(["b", "a"]);
  });
  it("separates portfolio overhead from property expenses", () => {
    expect(buildBusinessExpenseReport({ events }, { scope: "portfolio" }).rows.map((row) => row.id)).toEqual(["b"]);
    expect(buildBusinessExpenseReport({ events }, { scope: "property", propertyId: "930-highland" }).rows.map((row) => row.id)).toEqual(["a"]);
  });
  it("filters category and date deterministically", () => {
    const report = buildBusinessExpenseReport({ events }, { category: "software", startDate: "2026-08-02", endDate: "2026-08-02" });
    expect(report.rows.map((row) => row.id)).toEqual(["b"]);
    expect(report.availableCategories).toEqual(["property_repairs", "software"]);
  });
  it("exports a CSV with scope and total", () => {
    const csv = businessExpenseReportToCsv(buildBusinessExpenseReport({ events }));
    expect(csv).toContain('"Accounting software","software","unassigned","50.00"');
    expect(csv).toContain('"Total"');
  });
});
