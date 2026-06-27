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
});
