import { describe, expect, test } from "vitest";

import { ProductionImportWorkflow } from "../ProductionImportWorkflow";

describe("ProductionImportWorkflow", () => {
  test("builds an ImportResult using parsed records, reports, and default summary", () => {
    const parser = {
      parseCsv(csv) {
        return JSON.parse(csv);
      },
    };

    const pipeline = {
      buildReports({ records }) {
        return {
          balanceSheet: { recordCount: records.length },
          incomeStatement: { recordCount: records.length },
          trialBalance: { recordCount: records.length },
        };
      },
    };

    const workflow = new ProductionImportWorkflow({
      parser,
      pipeline,
      sourceName: "Test",
    });

    const result = workflow.importCsv({
      csv: JSON.stringify([{ id: "record-1" }]),
      chartOfAccounts: {},
    });

    expect(result.records).toEqual([{ id: "record-1" }]);
    expect(result.summary).toEqual({
      totalRows: 1,
      importedRows: 1,
      skippedRows: 0,
    });
    expect(result.reports.balanceSheet).toEqual({ recordCount: 1 });
    expect(result.warningCount).toBe(0);
  });

  test("supports custom summaries", () => {
    const parser = {
      parse(rows) {
        return rows;
      },
    };

    const pipeline = {
      buildReports() {
        return {
          balanceSheet: {},
          incomeStatement: {},
          trialBalance: {},
        };
      },
    };

    const workflow = new ProductionImportWorkflow({
      parser,
      pipeline,
      sourceName: "Test",
      summaryBuilder(records) {
        return {
          totalRows: records.length,
          totalAmount: records.reduce((sum, record) => sum + record.amount, 0),
        };
      },
    });

    const result = workflow.importRows({
      rows: [{ amount: 100 }, { amount: 50 }],
      chartOfAccounts: {},
    });

    expect(result.summary).toEqual({
      totalRows: 2,
      totalAmount: 150,
    });
  });

  test("requires a parser", () => {
    expect(() => new ProductionImportWorkflow()).toThrow(
      "ProductionImportWorkflow requires a parser",
    );
  });
});
