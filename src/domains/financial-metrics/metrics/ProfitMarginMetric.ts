import type { FinancialMetricTotals } from "../FinancialMetricTotals";

export class ProfitMarginMetric {
  static calculate(totals: FinancialMetricTotals): number {
    return totals.revenue > 0 ? totals.netIncome / totals.revenue : 0;
  }
}
