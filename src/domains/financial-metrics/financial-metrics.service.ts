import {
  ChartOfAccounts,
} from "../ledger/accounts/index.js";
import { AccountBalanceCollection } from "../ledger/reports/index.js";
import { ClassificationTaxonomy } from "../ledger/services";
import { FinancialMetricTotals } from "./FinancialMetricTotals";
import type { FinancialMetricsSummary } from "./financial-metrics.types";
import {
  CurrentRatioMetric,
  DebtToAssetMetric,
  DebtToEquityMetric,
  GrossProfitMetric,
  ProfitMarginMetric,
  QuickRatioMetric,
  ReturnOnAssetsMetric,
} from "./metrics";

export class FinancialMetricsService {
  static calculate({
    accountBalances,
    chartOfAccounts,
    classificationTaxonomy = new ClassificationTaxonomy(),
  }: {
    accountBalances: AccountBalanceCollection;
    chartOfAccounts: ChartOfAccounts;
    classificationTaxonomy?: ClassificationTaxonomy;
  }): FinancialMetricsSummary {
    const totals = FinancialMetricTotals.fromAccountBalances({
      accountBalances,
      chartOfAccounts,
    });

    const currentRatio = CurrentRatioMetric.calculate({
      accountBalances,
      chartOfAccounts,
      classificationTaxonomy,
    });
    const quickRatio = QuickRatioMetric.calculate({
      accountBalances,
      chartOfAccounts,
      classificationTaxonomy,
    });
    const grossProfit = GrossProfitMetric.calculate({
      accountBalances,
      chartOfAccounts,
      classificationTaxonomy,
    });
    const debtToAssetRatio = DebtToAssetMetric.calculate(totals);
    const debtToEquityRatio = DebtToEquityMetric.calculate(totals);

    return {
      totalAssets: totals.totalAssets,
      totalLiabilities: totals.totalLiabilities,
      totalEquity: totals.totalEquity,
      revenue: totals.revenue,
      expenses: totals.expenses,
      netIncome: totals.netIncome,
      workingCapital: totals.workingCapital,
      currentRatio,
      quickRatio,
      grossProfit,
      profitMargin: ProfitMarginMetric.calculate({
        accountBalances,
        chartOfAccounts,
      }),
      debtToAssetRatio,
      debtToEquityRatio,
      returnOnAssets: ReturnOnAssetsMetric.calculate(totals),
      returnOnEquity:
        totals.totalEquity > 0 ? totals.netIncome / totals.totalEquity : 0,
    };
  }
}
