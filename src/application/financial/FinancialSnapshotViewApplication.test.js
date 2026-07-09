import { describe, expect, it } from "vitest";
import { FinancialSnapshotViewApplication } from "./FinancialSnapshotViewApplication.js";

describe("FinancialSnapshotViewApplication", () => {
  it("builds a financial snapshot view model", () => {
    const application = new FinancialSnapshotViewApplication();

    const snapshot = application.buildSnapshot({
      cash: "10000",
      receivables: "2500",
      debt: "4000",
      revenue: "12000",
      expenses: "8500",
    });

    expect(snapshot.assets).toBe(1250000);
    expect(snapshot.liabilities).toBe(400000);
    expect(snapshot.equity).toBe(850000);
    expect(snapshot.revenue).toBe(1200000);
    expect(snapshot.expenses).toBe(850000);
    expect(snapshot.profit).toBe(350000);
    expect(snapshot.margin).toBeCloseTo(0.2916666666666667, 6);
    expect(snapshot.healthMessage).toBe(
      "Strong early signal. Your business is profitable with a healthy margin.",
    );
    expect(snapshot.balanceSheet.length).toBeGreaterThan(0);
    expect(snapshot.incomeStatement.length).toBeGreaterThan(0);
  });

  it("returns an entry message when no values are provided", () => {
    const application = new FinancialSnapshotViewApplication();

    const snapshot = application.buildSnapshot({
      cash: "",
      receivables: "",
      debt: "",
      revenue: "",
      expenses: "",
    });

    expect(snapshot.assets).toBe(0);
    expect(snapshot.revenue).toBe(0);
    expect(snapshot.healthMessage).toBe(
      "Enter your numbers to generate a simple business health snapshot.",
    );
  });
});
