import {
  AccountType,
  ChartOfAccounts,
} from "../ledger/accounts/index.js";
import { AccountBalanceCollection } from "../ledger/reports/index.js";
import type { FinancialMetricsSummary } from "./financial-metrics.types";

export class FinancialMetricsService {
  static calculate({
    accountBalances,
    chartOfAccounts,
  }: {
    accountBalances: AccountBalanceCollection;
    chartOfAccounts: ChartOfAccounts;
  }): FinancialMetricsSummary {
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

    const netIncome = revenue - expenses;

    return {
      totalAssets,
      totalLiabilities,
      totalEquity,
      revenue,
      expenses,
      netIncome,
      profitMargin: revenue > 0 ? netIncome / revenue : 0,
      debtToAssetRatio:
        totalAssets > 0 ? totalLiabilities / totalAssets : 0,
    };
  }
}
