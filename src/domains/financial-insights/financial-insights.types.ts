import type { FinancialMetricsSummary } from "../financial-metrics";

export type FinancialInsightSeverity = "healthy" | "warning" | "critical";

export type FinancialInsightCategory =
  | "profitability"
  | "leverage"
  | "equity"
  | "liquidity";

export type FinancialInsight = {
  category: FinancialInsightCategory;
  severity: FinancialInsightSeverity;
  title: string;
  message: string;
};

export type FinancialInsightSummary = {
  metrics: FinancialMetricsSummary;
  insights: FinancialInsight[];
  overallSeverity: FinancialInsightSeverity;
};
