import { describe, expect, test } from "vitest";
import { Account } from "../../ledger/accounts/Account.js";
import { AccountClassification } from "../../ledger/accounts/AccountClassification.js";
import { AccountType } from "../../ledger/accounts/AccountType.js";
import { ChartOfAccounts } from "../../ledger/accounts/ChartOfAccounts.js";
import { AccountBalance } from "../../ledger/reports/AccountBalance.js";
import { AccountBalanceCollection } from "../../ledger/reports/AccountBalanceCollection.js";
import { FinancialMetricsService } from "../financial-metrics.service";

describe("FinancialMetricsService", () => {
  test("calculates supported financial metrics from account balances and chart of accounts", () => {
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
      workingCapital: 60000,
      currentRatio: 0,
      quickRatio: 0,
      profitMargin: 0.25,
      debtToAssetRatio: 0.4,
      debtToEquityRatio: 40000 / 60000,
      returnOnAssets: 0.03,
      returnOnEquity: 0.05,
    });
  });

  test("calculates current ratio from ledger semantic classification membership", () => {
    const chartOfAccounts = new ChartOfAccounts([
      new Account({
        id: "cash",
        name: "Operating Cash",
        type: AccountType.ASSET,
        classification: AccountClassification.CASH,
      }),
      new Account({
        id: "inventory",
        name: "Inventory",
        type: AccountType.ASSET,
        classification: AccountClassification.INVENTORY,
      }),
      new Account({
        id: "equipment",
        name: "Equipment",
        type: AccountType.ASSET,
      }),
      new Account({
        id: "accounts-payable",
        name: "Accounts Payable",
        type: AccountType.LIABILITY,
        classification: AccountClassification.CURRENT_LIABILITY,
      }),
      new Account({
        id: "long-term-debt",
        name: "Long-Term Debt",
        type: AccountType.LIABILITY,
      }),
    ]);

    const accountBalances = new AccountBalanceCollection([
      new AccountBalance({ accountId: "cash", balance: 50000 }),
      new AccountBalance({ accountId: "inventory", balance: 25000 }),
      new AccountBalance({ accountId: "equipment", balance: 125000 }),
      new AccountBalance({ accountId: "accounts-payable", balance: 30000 }),
      new AccountBalance({ accountId: "long-term-debt", balance: 90000 }),
    ]);

    const summary = FinancialMetricsService.calculate({
      accountBalances,
      chartOfAccounts,
    });

    expect(summary.currentRatio).toBe(75000 / 30000);
    expect(summary.totalAssets).toBe(200000);
    expect(summary.totalLiabilities).toBe(120000);
  });

  test("calculates quick ratio from ledger semantic classification membership", () => {
    const chartOfAccounts = new ChartOfAccounts([
      new Account({
        id: "cash",
        name: "Operating Cash",
        type: AccountType.ASSET,
        classification: AccountClassification.CASH,
      }),
      new Account({
        id: "accounts-receivable",
        name: "Accounts Receivable",
        type: AccountType.ASSET,
        classification: AccountClassification.ACCOUNTS_RECEIVABLE,
      }),
      new Account({
        id: "inventory",
        name: "Inventory",
        type: AccountType.ASSET,
        classification: AccountClassification.INVENTORY,
      }),
      new Account({
        id: "accounts-payable",
        name: "Accounts Payable",
        type: AccountType.LIABILITY,
        classification: AccountClassification.CURRENT_LIABILITY,
      }),
    ]);

    const accountBalances = new AccountBalanceCollection([
      new AccountBalance({ accountId: "cash", balance: 50000 }),
      new AccountBalance({ accountId: "accounts-receivable", balance: 10000 }),
      new AccountBalance({ accountId: "inventory", balance: 25000 }),
      new AccountBalance({ accountId: "accounts-payable", balance: 30000 }),
    ]);

    const summary = FinancialMetricsService.calculate({
      accountBalances,
      chartOfAccounts,
    });

    expect(summary.quickRatio).toBe(60000 / 30000);
    expect(summary.currentRatio).toBe(85000 / 30000);
  });

  test("returns zero ratios when denominators are zero", () => {
    const chartOfAccounts = new ChartOfAccounts([
      new Account({ id: "debt", name: "Debt", type: AccountType.LIABILITY }),
      new Account({ id: "expense", name: "Expense", type: AccountType.EXPENSE }),
    ]);

    const accountBalances = new AccountBalanceCollection([
      new AccountBalance({ accountId: "debt", balance: 40000 }),
      new AccountBalance({ accountId: "expense", balance: 9000 }),
    ]);

    const summary = FinancialMetricsService.calculate({
      accountBalances,
      chartOfAccounts,
    });

    expect(summary).toEqual({
      totalAssets: 0,
      totalLiabilities: 40000,
      totalEquity: 0,
      revenue: 0,
      expenses: 9000,
      netIncome: -9000,
      workingCapital: -40000,
      currentRatio: 0,
      quickRatio: 0,
      profitMargin: 0,
      debtToAssetRatio: 0,
      debtToEquityRatio: 0,
      returnOnAssets: 0,
      returnOnEquity: 0,
    });
  });
});
