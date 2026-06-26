import type {
  FinancialInsight,
  FinancialInsightSeverity,
  FinancialInsightSummary,
} from "./financial-insights.types";
import type { FinancialMetricsSummary } from "../financial-metrics";

export class FinancialInsightsService {
  static analyze(metrics: FinancialMetricsSummary): FinancialInsightSummary {
    const insights: FinancialInsight[] = [];

    if (metrics.netIncome < 0) {
      insights.push({
        category: "profitability",
        severity: "critical",
        title: "Business is losing money",
        message: "Expenses are greater than revenue.",
      });
    } else if (metrics.profitMargin < 0.1) {
      insights.push({
        category: "profitability",
        severity: "warning",
        title: "Profit margin is weak",
        message: "Net income is positive, but margin is below 10%.",
      });
    } else {
      insights.push({
        category: "profitability",
        severity: "healthy",
        title: "Profitability is healthy",
        message: "Net income and profit margin are positive.",
      });
    }

    if (metrics.debtToAssetRatio > 0.8) {
      insights.push({
        category: "leverage",
        severity: "critical",
        title: "Debt load is high",
        message: "Liabilities exceed 80% of assets.",
      });
    } else if (metrics.debtToAssetRatio > 0.5) {
      insights.push({
        category: "leverage",
        severity: "warning",
        title: "Debt load needs attention",
        message: "Liabilities exceed 50% of assets.",
      });
    } else {
      insights.push({
        category: "leverage",
        severity: "healthy",
        title: "Debt load is controlled",
        message: "Liabilities are within a healthy range compared to assets.",
      });
    }

    if (metrics.totalEquity < 0) {
      insights.push({
        category: "equity",
        severity: "critical",
        title: "Equity is negative",
        message: "Liabilities exceed assets.",
      });
    } else {
      insights.push({
        category: "equity",
        severity: "healthy",
        title: "Equity is positive",
        message: "Assets exceed liabilities.",
      });
    }

    return {
      metrics,
      insights,
      overallSeverity: FinancialInsightsService.resolveOverallSeverity(insights),
    };
  }

  private static resolveOverallSeverity(
    insights: FinancialInsight[]
  ): FinancialInsightSeverity {
    if (insights.some((insight) => insight.severity === "critical")) {
      return "critical";
    }

    if (insights.some((insight) => insight.severity === "warning")) {
      return "warning";
    }

    return "healthy";
  }
}
