import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { Account, AccountType, ChartOfAccounts } from "../../ledger/accounts";
import { RentecProductionImportService } from "../rentec-production-import.service";

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

describe("RentecProductionImportService", () => {
  test("imports Rentec CSV into records, summary, reports, and warnings", () => {
    const csv = fs.readFileSync(
      path.join(__dirname, "fixtures", "rentec-export.csv"),
      "utf8",
    );

    const result = RentecProductionImportService.importCsv({
      csv,
      chartOfAccounts: buildChartOfAccounts(),
    });

    expect(result.records).toHaveLength(2);

    expect(result.summary).toMatchObject({
      totalRows: 2,
      importedRows: 2,
      skippedRows: 0,
      totalIncome: 1500,
      totalExpenses: 250,
      properties: ["170 John"],
    });

    expect(result.reports.balanceSheet).toBeDefined();
    expect(result.reports.incomeStatement).toBeDefined();
    expect(result.reports.trialBalance).toBeDefined();

    expect(result.warnings).toEqual([]);
    expect(result.warningCount).toBe(0);
  });
});
