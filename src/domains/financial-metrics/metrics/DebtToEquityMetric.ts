import type { FinancialMetricTotals } from "../FinancialMetricTotals";

export class DebtToEquityMetric {
  static calculate(totals: FinancialMetricTotals): number {
    return totals.totalEquity > 0
      ? totals.totalLiabilities / totals.totalEquity
      : 0;
  }
}
