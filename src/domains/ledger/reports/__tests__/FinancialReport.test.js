import { describe, expect, test } from "vitest";
import { FinancialReport } from "../FinancialReport";
import { ReportLine } from "../ReportLine";
import { ReportSection } from "../sections/ReportSection";

describe("FinancialReport", () => {
  test("creates an immutable financial report with a name", () => {
    const report = new FinancialReport({ name: "Trial Balance" });

    expect(report.name).toBe("Trial Balance");
    expect(Object.isFrozen(report)).toBe(true);
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

    expect(() =>
      report.lines().push(new ReportLine({ label: "Extra" }))
    ).toThrow();
  });

  test("stores immutable report sections", () => {
    const section = new ReportSection({
      name: "Assets",
      lines: [new ReportLine({ label: "Cash", amount: 100 })],
    });

    const report = new FinancialReport({
      name: "Balance Sheet",
      sections: [section],
    });

    expect(report.sections()).toEqual([section]);
    expect(() => report.sections().push(section)).toThrow();
  });

  test("requires sections to be ReportSection objects", () => {
    expect(
      () =>
        new FinancialReport({
          name: "Bad Report",
          sections: [{ name: "Assets" }],
        })
    ).toThrow("FinancialReport sections must be ReportSection objects");
  });
});
