import { describe, expect, test } from "vitest";

import { ProductionImportWorkflow } from "../ProductionImportWorkflow";

describe("ProductionImportWorkflow", () => {
  test("builds an ImportResult using parsed records, reports, review items, and default summary", () => {
    const parser = {
      parseCsv(csv) {
        return JSON.parse(csv);
      },
    };

    const pipeline = {
      buildImportArtifacts({ records }) {
        return {
          financialEvents: [],
          reports: {
            balanceSheet: { recordCount: records.length },
            incomeStatement: { recordCount: records.length },
            trialBalance: { recordCount: records.length },
          },
        };
      },
    };

    const workflow = new ProductionImportWorkflow({
      parser,
      pipeline,
      sourceName: "Test",
    });

    const result = workflow.importCsv({
      csv: JSON.stringify([
        {
          id: "record-1",
          property: "Unknown Property",
        },
      ]),
      chartOfAccounts: {},
    });

    expect(result.records).toEqual([
      {
        id: "record-1",
        property: "Unknown Property",
      },
    ]);
    expect(result.summary).toEqual({
      totalRows: 1,
      importedRows: 1,
      skippedRows: 0,
    });
    expect(result.reports.balanceSheet).toEqual({ recordCount: 1 });
    expect(result.transactionReview).toMatchObject([
      {
        record: {
          id: "record-1",
          property: "Unknown Property",
        },
        transaction: {
          id: "review-transaction:Test:test-undefined-0",
          provider: "test",
          amountCents: 0,
          description: "",
        },
        resolvedProperty: {
          name: "Unknown Property",
        },
        needsAssignment: true,
      },
    ]);
    expect(result.warningCount).toBe(0);
  });

  test("supports custom summaries", () => {
    const parser = {
      parse(rows) {
        return rows;
      },
    };

    const pipeline = {
      buildImportArtifacts() {
        return {
          financialEvents: [],
          reports: {
            balanceSheet: {},
            incomeStatement: {},
            trialBalance: {},
          },
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

  test("adds deterministic advisory property suggestions to unresolved review items", () => {
    const parser = {
      parse(rows) {
        return rows;
      },
    };

    const pipeline = {
      buildImportArtifacts() {
        return {
          financialEvents: [],
          reports: {
            balanceSheet: {},
            incomeStatement: {},
            trialBalance: {},
          },
        };
      },
    };

    const workflow = new ProductionImportWorkflow({
      parser,
      pipeline,
      sourceName: "Test",
    });

    const property = {
      id: "property-1",
      name: "Kent Avenue Duplex",
      address: "4800 Kent Ave",
    };

    const result = workflow.importRows({
      rows: [
        {
          id: "record-1",
          description: "Plumbing repair at 4800 Kent Ave",
          property: "Unknown Property",
        },
      ],
      chartOfAccounts: {},
      properties: [property],
    });

    expect(result.transactionReview[0]).toMatchObject({
      needsAssignment: true,
      confidence: 1,
      recommendations: [
        {
          property,
          score: 1,
          explanation: "Transaction context contains the property address.",
        },
      ],
      suggestedProperties: [property],
      assignmentStatus: "suggested",
      reviewState: "pending",
    });
  });

  test("preserves assigned review behavior when a record already has a property", () => {
    const parser = {
      parse(rows) {
        return rows;
      },
    };

    const pipeline = {
      buildImportArtifacts() {
        return {
          financialEvents: [],
          reports: {
            balanceSheet: {},
            incomeStatement: {},
            trialBalance: {},
          },
        };
      },
    };

    const workflow = new ProductionImportWorkflow({
      parser,
      pipeline,
      sourceName: "Test",
    });

    const result = workflow.importRows({
      rows: [
        {
          id: "record-1",
          description: "Expense at 4800 Kent Ave",
          property: "Existing Property",
          resolvedProperty: {
            id: "existing-property",
            name: "Existing Property",
          },
        },
      ],
      chartOfAccounts: {},
      properties: [
        {
          id: "candidate-property",
          name: "Candidate Property",
          address: "4800 Kent Ave",
        },
      ],
    });

    expect(result.transactionReview[0]).toMatchObject({
      needsAssignment: false,
      confidence: 0,
      suggestedProperties: [],
      assignmentStatus: "assigned",
    });
  });

  test("requires a parser", () => {
    expect(() => new ProductionImportWorkflow()).toThrow(
      "ProductionImportWorkflow requires a parser",
    );
  });
});
