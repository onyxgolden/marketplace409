import type { FinancialMetricTotals } from "../FinancialMetricTotals";

export class ReturnOnAssetsMetric {
  static calculate(totals: FinancialMetricTotals): number {
    return totals.totalAssets > 0
      ? totals.netIncome / totals.totalAssets
      : 0;
  }
}
