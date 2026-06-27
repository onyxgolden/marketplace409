import { AccountType } from "../ledger/accounts";
import type { ChartOfAccounts } from "../ledger/accounts";
import type { AccountBalanceCollection } from "../ledger/reports";

export class FinancialMetricTotals {
  readonly totalAssets: number;
  readonly totalLiabilities: number;
  readonly totalEquity: number;
  readonly revenue: number;
  readonly expenses: number;
  readonly netIncome: number;
  readonly workingCapital: number;

  private constructor({
    totalAssets,
    totalLiabilities,
    totalEquity,
    revenue,
    expenses,
  }: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    revenue: number;
    expenses: number;
  }) {
    this.totalAssets = totalAssets;
    this.totalLiabilities = totalLiabilities;
    this.totalEquity = totalEquity;
    this.revenue = revenue;
    this.expenses = expenses;
    this.netIncome = revenue - expenses;
    this.workingCapital = totalAssets - totalLiabilities;
  }

  static fromAccountBalances({
    accountBalances,
    chartOfAccounts,
  }: {
    accountBalances: AccountBalanceCollection;
    chartOfAccounts: ChartOfAccounts;
  }): FinancialMetricTotals {
    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;
    let revenue = 0;
    let expenses = 0;

    for (const balance of accountBalances.all()) {
      const account = chartOfAccounts.getById(balance.accountId);

      switch (account.type) {
        case AccountType.ASSET:
          totalAssets += balance.balance;
          break;

        case AccountType.LIABILITY:
          totalLiabilities += balance.balance;
          break;

        case AccountType.EQUITY:
          totalEquity += balance.balance;
          break;

        case AccountType.REVENUE:
          revenue += balance.balance;
          break;

        case AccountType.EXPENSE:
          expenses += balance.balance;
          break;
      }
    }

    return new FinancialMetricTotals({
      totalAssets,
      totalLiabilities,
      totalEquity,
      revenue,
      expenses,
    });
  }
}
