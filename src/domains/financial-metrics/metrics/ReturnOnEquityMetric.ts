import type { FinancialMetricTotals } from "../FinancialMetricTotals";

export class ReturnOnEquityMetric {
  static calculate(totals: FinancialMetricTotals): number {
    return totals.totalEquity > 0
      ? totals.netIncome / totals.totalEquity
      : 0;
  }
}
