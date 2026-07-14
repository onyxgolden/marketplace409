import { describe, expect, test } from "vitest";

import { Account, AccountType, ChartOfAccounts } from "../../ledger/accounts";
import { rentecSemanticResolver } from "../../rentec-import";
import { ImportPipeline } from "../ImportPipeline";

function buildChartOfAccounts() {
  return new ChartOfAccounts([
    new Account({
      id: "1000",
      name: "Cash",
      type: AccountType.ASSET,
    }),
    new Account({
      id: "1500",
      name: "Real Estate",
      type: AccountType.ASSET,
    }),
    new Account({
      id: "4000",
      name: "Rental Income",
      type: AccountType.REVENUE,
    }),
    new Account({
      id: "4010",
      name: "CAM Income",
      type: AccountType.REVENUE,
    }),
    new Account({
      id: "5100",
      name: "Repairs Expense",
      type: AccountType.EXPENSE,
    }),
    new Account({
      id: "5110",
      name: "Maintenance Expense",
      type: AccountType.EXPENSE,
    }),
    new Account({
      id: "5120",
      name: "Supplies Expense",
      type: AccountType.EXPENSE,
    }),
    new Account({
      id: "5200",
      name: "Utilities Expense",
      type: AccountType.EXPENSE,
    }),
    new Account({
      id: "5300",
      name: "Insurance Expense",
      type: AccountType.EXPENSE,
    }),
    new Account({
      id: "5400",
      name: "Mortgage Interest Expense",
      type: AccountType.EXPENSE,
    }),
    new Account({
      id: "5500",
      name: "Property Tax Expense",
      type: AccountType.EXPENSE,
    }),
    new Account({
      id: "5600",
      name: "Professional Fees Expense",
      type: AccountType.EXPENSE,
    }),
    new Account({
      id: "5999",
      name: "Other Expense",
      type: AccountType.EXPENSE,
    }),
  ]);
}

function buildRecords() {
  return [
    {
      date: "2026-01-01",
      property: "123 Main St",
      description: "Rental Income",
      sourceCategory: "Income",
      amount: 1500,
      type: "income",
      rawRow: {},
    },
    {
      date: "2026-01-02",
      property: "123 Main St",
      description: "Repairs",
      sourceCategory: "Expense",
      amount: 200,
      type: "expense",
      rawRow: {},
    },
  ];
}

describe("ImportPipeline", () => {
  test("preserves the financial report interface", () => {
    const pipeline = new ImportPipeline({
      semanticResolver: rentecSemanticResolver,
      ownerId: "owner-1",
    });

    const reports = pipeline.buildReports({
      records: buildRecords(),
      chartOfAccounts: buildChartOfAccounts(),
    });

    expect(reports.balanceSheet).toBeDefined();
    expect(reports.incomeStatement).toBeDefined();
    expect(reports.trialBalance).toBeDefined();
  });

  test("builds immutable financial events and reports as import artifacts", () => {
    const pipeline = new ImportPipeline({
      semanticResolver: rentecSemanticResolver,
      ownerId: "owner-1",
    });

    const result = pipeline.buildImportArtifacts({
      records: buildRecords(),
      chartOfAccounts: buildChartOfAccounts(),
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.financialEvents)).toBe(true);

    expect(result.financialEvents).toHaveLength(2);
    expect(result.financialEvents[0]).toMatchObject({
      owner_id: "owner-1",
      event_date: "2026-01-01",
      description: "Rental Income",
      amount: 1500,
      source_system: "rentec",
    });

    expect(result.financialEvents[1]).toMatchObject({
      owner_id: "owner-1",
      event_date: "2026-01-02",
      description: "Repairs",
      amount: 200,
      source_system: "rentec",
    });

    expect(result.reports.balanceSheet).toBeDefined();
    expect(result.reports.incomeStatement).toBeDefined();
    expect(result.reports.trialBalance).toBeDefined();
  });
});
