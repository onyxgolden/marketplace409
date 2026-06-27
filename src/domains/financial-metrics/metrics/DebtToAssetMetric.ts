import type { FinancialMetricTotals } from "../FinancialMetricTotals";

export class DebtToAssetMetric {
  static calculate(totals: FinancialMetricTotals): number {
    return totals.totalAssets > 0
      ? totals.totalLiabilities / totals.totalAssets
      : 0;
  }
}
