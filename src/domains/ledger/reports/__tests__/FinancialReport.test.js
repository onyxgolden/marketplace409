import { describe, expect, test } from "vitest";
import { FinancialReport } from "../FinancialReport";

describe("FinancialReport", () => {
  test("creates an immutable financial report with a name", () => {
    const report = new FinancialReport({ name: "Trial Balance" });

    expect(report.name).toBe("Trial Balance");
    expect(Object.isFrozen(report)).toBe(true);
  });
});
