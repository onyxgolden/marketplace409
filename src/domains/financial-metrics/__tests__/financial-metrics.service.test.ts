import { describe, expect, test } from "vitest";
import { Account } from "../../ledger/accounts/Account.js";
import { AccountType } from "../../ledger/accounts/AccountType.js";
import { ChartOfAccounts } from "../../ledger/accounts/ChartOfAccounts.js";
import { AccountBalance } from "../../ledger/reports/AccountBalance.js";
import { AccountBalanceCollection } from "../../ledger/reports/AccountBalanceCollection.js";
import { FinancialMetricsService } from "../financial-metrics.service";

describe("FinancialMetricsService", () => {
  test("calculates financial metrics from account balances and chart of accounts", () => {
    const chartOfAccounts = new ChartOfAccounts([
      new Account({ id: "cash", name: "Cash", type: AccountType.ASSET }),
      new Account({ id: "debt", name: "Debt", type: AccountType.LIABILITY }),
      new Account({ id: "equity", name: "Equity", type: AccountType.EQUITY }),
      new Account({ id: "revenue", name: "Revenue", type: AccountType.REVENUE }),
      new Account({ id: "expense", name: "Expense", type: AccountType.EXPENSE }),
    ]);

    const accountBalances = new AccountBalanceCollection([
      new AccountBalance({ accountId: "cash", balance: 100000 }),
      new AccountBalance({ accountId: "debt", balance: 40000 }),
      new AccountBalance({ accountId: "equity", balance: 60000 }),
      new AccountBalance({ accountId: "revenue", balance: 12000 }),
      new AccountBalance({ accountId: "expense", balance: 9000 }),
    ]);

    const summary = FinancialMetricsService.calculate({
      accountBalances,
      chartOfAccounts,
    });

    expect(summary).toEqual({
      totalAssets: 100000,
      totalLiabilities: 40000,
      totalEquity: 60000,
      revenue: 12000,
      expenses: 9000,
      netIncome: 3000,
      profitMargin: 0.25,
      debtToAssetRatio: 0.4,
    });
  });
});
