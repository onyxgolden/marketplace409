import { describe, expect, test } from "vitest";
import type { FinancialMetricsSummary } from "../../financial-metrics";
import { FinancialInsightsService } from "../financial-insights.service";

describe("FinancialInsightsService", () => {
  test("returns healthy insights for profitable low-debt metrics", () => {
    const metrics: FinancialMetricsSummary = {
      totalAssets: 100000,
      totalLiabilities: 30000,
      totalEquity: 70000,
      revenue: 20000,
      expenses: 12000,
      netIncome: 8000,
      workingCapital: 70000,
      currentRatio: 2.5,
      quickRatio: 2,
      grossProfit: 12000,
      profitMargin: 0.4,
      debtToAssetRatio: 0.3,
      debtToEquityRatio: 30000 / 70000,
      returnOnAssets: 0.08,
      returnOnEquity: 8000 / 70000,
    };

    const summary = FinancialInsightsService.analyze(metrics);

    expect(summary.overallSeverity).toBe("healthy");
    expect(summary.insights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "profitability",
          severity: "healthy",
        }),
        expect.objectContaining({
          category: "leverage",
          severity: "healthy",
        }),
        expect.objectContaining({
          category: "equity",
          severity: "healthy",
        }),
      ])
    );
  });

  test("returns warning when profit margin is weak", () => {
    const metrics: FinancialMetricsSummary = {
      totalAssets: 100000,
      totalLiabilities: 30000,
      totalEquity: 70000,
      revenue: 20000,
      expenses: 19000,
      netIncome: 1000,
      workingCapital: 70000,
      currentRatio: 2.5,
      quickRatio: 2,
      grossProfit: 5000,
      profitMargin: 0.05,
      debtToAssetRatio: 0.3,
      debtToEquityRatio: 30000 / 70000,
      returnOnAssets: 0.01,
      returnOnEquity: 1000 / 70000,
    };

    const summary = FinancialInsightsService.analyze(metrics);

    expect(summary.overallSeverity).toBe("warning");
    expect(summary.insights).toContainEqual(
      expect.objectContaining({
        category: "profitability",
        severity: "warning",
      })
    );
  });

  test("returns critical when business is losing money or equity is negative", () => {
    const metrics: FinancialMetricsSummary = {
      totalAssets: 100000,
      totalLiabilities: 120000,
      totalEquity: -20000,
      revenue: 10000,
      expenses: 15000,
      netIncome: -5000,
      workingCapital: -20000,
      currentRatio: 0.5,
      quickRatio: 0.4,
      grossProfit: -1000,
      profitMargin: -0.5,
      debtToAssetRatio: 1.2,
      debtToEquityRatio: -6,
      returnOnAssets: -0.05,
      returnOnEquity: 0.25,
    };

    const summary = FinancialInsightsService.analyze(metrics);

    expect(summary.overallSeverity).toBe("critical");
    expect(summary.insights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "profitability",
          severity: "critical",
        }),
        expect.objectContaining({
          category: "leverage",
          severity: "critical",
        }),
        expect.objectContaining({
          category: "equity",
          severity: "critical",
        }),
      ])
    );
  });
});
