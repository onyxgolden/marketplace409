import { describe, expect, test } from "vitest";
import { FinancialReport } from "../FinancialReport";
import { ReportLine } from "../ReportLine";

describe("FinancialReport", () => {
  test("creates an immutable financial report with a name", () => {
    const report = new FinancialReport({ name: "Trial Balance" });

    expect(report.name).toBe("Trial Balance");
    expect(Object.isFrozen(report)).toBe(true);
  });
});

test("stores immutable report lines", () => {
  const report = new FinancialReport({
    name: "Owner Report",
    lines: [
      new ReportLine({ label: "Cash", amount: 100 }),
      new ReportLine({ label: "Debt", amount: -100 }),
    ],
  });

  expect(report.lines()).toEqual([
    new ReportLine({ label: "Cash", amount: 100 }),
    new ReportLine({ label: "Debt", amount: -100 }),
  ]);

  expect(() => report.lines().push(new ReportLine({ label: "Extra" }))).toThrow();
});
