import { describe, expect, test } from "vitest";

import { Account, AccountType, ChartOfAccounts } from "../../ledger/accounts";
import { ImportPipeline } from "../ImportPipeline";
import { rentecSemanticResolver } from "../../rentec-import";

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

describe("ImportPipeline", () => {
  test("builds financial reports from Rentec records", () => {
    const records = [
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

    const pipeline = new ImportPipeline({
      semanticResolver: rentecSemanticResolver,
    });

    const reports = pipeline.buildReports({
      records,
      chartOfAccounts: buildChartOfAccounts(),
    });

    expect(reports.balanceSheet).toBeDefined();
    expect(reports.incomeStatement).toBeDefined();
    expect(reports.trialBalance).toBeDefined();
  });
});
