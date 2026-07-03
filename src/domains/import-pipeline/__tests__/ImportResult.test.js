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

    const transactionReview = [
      {
        transaction: { id: "transaction-1" },
        resolvedProperty: { name: "Unknown Property" },
        needsAssignment: true,
      },
    ];

    const result = new ImportResult({
      records: [{ id: 1 }, { id: 2 }],
      summary,
      reports,
      warnings: [warning],
      transactionReview,
    });

    expect(result.recordCount).toBe(2);
    expect(result.warningCount).toBe(1);
    expect(result.transactionReviewCount).toBe(1);

    expect(result.records).toHaveLength(2);
    expect(result.summary).toBe(summary);
    expect(result.reports).toBe(reports);
    expect(result.warnings).toEqual([warning]);
    expect(result.transactionReview).toEqual(transactionReview);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.records)).toBe(true);
    expect(Object.isFrozen(result.warnings)).toBe(true);
    expect(Object.isFrozen(result.transactionReview)).toBe(true);
  });

  test("serializes to JSON", () => {
    const result = new ImportResult({
      records: [{ id: 1 }],
      summary: { totalRows: 1 },
      reports: { balanceSheet: {} },
      transactionReview: [
        {
          transaction: { id: "transaction-1" },
          resolvedProperty: { name: "Unknown Property" },
          needsAssignment: true,
        },
      ],
    });

    expect(result.toJSON()).toMatchObject({
      recordCount: 1,
      warningCount: 0,
      transactionReviewCount: 1,
      records: [{ id: 1 }],
      summary: { totalRows: 1 },
      reports: { balanceSheet: {} },
      warnings: [],
      transactionReview: [
        {
          transaction: { id: "transaction-1" },
          resolvedProperty: { name: "Unknown Property" },
          needsAssignment: true,
        },
      ],
    });
  });

  test("defaults transaction review to an empty immutable array", () => {
    const result = new ImportResult({
      records: [{ id: 1 }],
      summary: { totalRows: 1 },
      reports: { balanceSheet: {} },
    });

    expect(result.transactionReview).toEqual([]);
    expect(result.transactionReviewCount).toBe(0);
    expect(Object.isFrozen(result.transactionReview)).toBe(true);
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

  test("rejects transaction review values that are not arrays", () => {
    expect(() => {
      new ImportResult({
        records: [],
        summary: {},
        reports: {},
        transactionReview: "review",
      });
    }).toThrow("ImportResult transactionReview must be an array");
  });
});
