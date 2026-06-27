import { describe, expect, test } from "vitest";

import { Account, AccountType, ChartOfAccounts } from "../../ledger/accounts";
import { QuickBooksProductionImportService } from "../quickbooks-production-import.service";

function buildChartOfAccounts() {
  return new ChartOfAccounts([
    new Account({ id: "1000", name: "Cash", type: AccountType.ASSET }),
    new Account({ id: "1500", name: "Real Estate", type: AccountType.ASSET }),
    new Account({ id: "4000", name: "Rental Income", type: AccountType.REVENUE }),
    new Account({ id: "4010", name: "CAM Income", type: AccountType.REVENUE }),
    new Account({ id: "5100", name: "Repairs Expense", type: AccountType.EXPENSE }),
    new Account({ id: "5110", name: "Maintenance Expense", type: AccountType.EXPENSE }),
    new Account({ id: "5120", name: "Supplies Expense", type: AccountType.EXPENSE }),
    new Account({ id: "5200", name: "Utilities Expense", type: AccountType.EXPENSE }),
    new Account({ id: "5300", name: "Insurance Expense", type: AccountType.EXPENSE }),
    new Account({ id: "5400", name: "Mortgage Interest Expense", type: AccountType.EXPENSE }),
    new Account({ id: "5500", name: "Property Tax Expense", type: AccountType.EXPENSE }),
    new Account({ id: "5600", name: "Professional Fees Expense", type: AccountType.EXPENSE }),
    new Account({ id: "5999", name: "Other Expense", type: AccountType.EXPENSE }),
  ]);
}

describe("QuickBooksProductionImportService", () => {
  test("imports QuickBooks rows into records, summary, reports, and warnings", () => {
    const rows = [
      {
        DATE: "01/01/2026",
        DESCRIPTION: "Rental Income",
        AMOUNT: "1500.00",
        ACCOUNT: "Rental Income",
        CATEGORY: "Rental Income",
        PROPERTY: "170 John",
        ID: "qb-1",
      },
      {
        DATE: "01/02/2026",
        DESCRIPTION: "Repairs",
        AMOUNT: "-250.00",
        ACCOUNT: "Repairs Expense",
        CATEGORY: "Repairs",
        PROPERTY: "170 John",
        ID: "qb-2",
      },
    ];

    const result = QuickBooksProductionImportService.importRows({
      rows,
      chartOfAccounts: buildChartOfAccounts(),
    });

    expect(result.records).toHaveLength(2);

    expect(result.summary).toMatchObject({
      totalRows: 2,
      importedRows: 2,
      skippedRows: 0,
    });

    expect(result.reports.balanceSheet).toBeDefined();
    expect(result.reports.incomeStatement).toBeDefined();
    expect(result.reports.trialBalance).toBeDefined();

    expect(result.warnings).toEqual([]);
    expect(result.warningCount).toBe(0);
  });

  test("imports QuickBooks CSV into records, summary, reports, and warnings", () => {
    const csv = [
      "Date,Description,Amount,Account,Category,Class,Transaction ID",
      "01/01/2026,Rental Income,1500.00,Rental Income,Rental Income,170 John,qb-1",
      "01/02/2026,Repairs,-250.00,Repairs Expense,Repairs,170 John,qb-2",
    ].join("\n");

    const result = QuickBooksProductionImportService.importCsv({
      csv,
      chartOfAccounts: buildChartOfAccounts(),
    });

    expect(result.records).toHaveLength(2);

    expect(result.records[0]).toMatchObject({
      date: "2026-01-01",
      description: "Rental Income",
      amount: 1500,
      property: "170 John",
      sourceRecordId: "qb-1",
    });

    expect(result.records[1]).toMatchObject({
      date: "2026-01-02",
      description: "Repairs",
      amount: -250,
      property: "170 John",
      sourceRecordId: "qb-2",
    });

    expect(result.summary).toMatchObject({
      totalRows: 2,
      importedRows: 2,
      skippedRows: 0,
    });

    expect(result.reports.balanceSheet).toBeDefined();
    expect(result.reports.incomeStatement).toBeDefined();
    expect(result.reports.trialBalance).toBeDefined();

    expect(result.warnings).toEqual([]);
    expect(result.warningCount).toBe(0);
  });
});
