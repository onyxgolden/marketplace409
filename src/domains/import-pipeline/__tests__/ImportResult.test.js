import { describe, expect, test } from "vitest";

import { ImportResult } from "../ImportResult";
import { ImportWarning } from "../ImportWarning";

describe("ImportResult", () => {
  test("creates an immutable import result", () => {
    const summary = {
      totalRows: 2,
      importedRows: 2,
      skippedRows: 0,
    };

    const reports = {
      balanceSheet: {},
      incomeStatement: {},
      trialBalance: {},
    };

    const warning = new ImportWarning({
      code: "UNKNOWN_CATEGORY",
      message: "Category could not be mapped.",
    });

    const result = new ImportResult({
      records: [{ id: 1 }, { id: 2 }],
      summary,
      reports,
      warnings: [warning],
    });

    expect(result.recordCount).toBe(2);
    expect(result.warningCount).toBe(1);

    expect(result.records).toHaveLength(2);
    expect(result.summary).toBe(summary);
    expect(result.reports).toBe(reports);
    expect(result.warnings).toEqual([warning]);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.records)).toBe(true);
    expect(Object.isFrozen(result.warnings)).toBe(true);
  });

  test("serializes to JSON", () => {
    const result = new ImportResult({
      records: [{ id: 1 }],
      summary: { totalRows: 1 },
      reports: { balanceSheet: {} },
    });

    expect(result.toJSON()).toMatchObject({
      recordCount: 1,
      warningCount: 0,
      records: [{ id: 1 }],
      summary: { totalRows: 1 },
      reports: { balanceSheet: {} },
      warnings: [],
    });
  });

  test("requires summary and reports", () => {
    expect(() => new ImportResult({ reports: {} })).toThrow();
    expect(() => new ImportResult({ summary: {} })).toThrow();
  });

  test("rejects warnings that are not ImportWarning instances", () => {
    expect(() => {
      new ImportResult({
        records: [],
        summary: {},
        reports: {},
        warnings: ["Unknown category"],
      });
    }).toThrow("ImportResult warnings must contain only ImportWarning instances");
  });
});
