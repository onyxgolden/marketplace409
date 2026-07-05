export class FinancialIntelligenceApplication {
  constructor({ readModelApplication }) {
    if (!readModelApplication) {
      throw new Error(
        "FinancialIntelligenceApplication requires a read model application.",
      );
    }

    this.readModelApplication = readModelApplication;
  }

  buildFinancialIntelligence() {
    const executiveSummary =
      this.readModelApplication.buildExecutiveSummary();
    const kpiModel = this.readModelApplication.buildKPIModel();

    const kpis = kpiModel.kpis || {};
    const health = executiveSummary.health || {};

    return Object.freeze({
      type: "financial-intelligence",
      trendAnalysis: Object.freeze(this.buildTrendAnalysis(kpis)),
      scenarioModeling: Object.freeze(this.buildScenarioModeling(kpis)),
      forecast: Object.freeze(this.buildForecast(kpis)),
      recommendations: Object.freeze(this.buildRecommendations(kpis, health)),
      planningAssistance: Object.freeze(
        this.buildPlanningAssistance(kpis, health),
      ),
      source: Object.freeze({
        authority: "financial-engine-derived-read-models",
        mutableLedgerState: false,
        aiGenerated: false,
      }),
    });
  }

  buildTrendAnalysis(kpis) {
    return {
      profitability:
        kpis.profit > 0
          ? "positive"
          : kpis.profit < 0
            ? "negative"
            : "neutral",
      liquidity:
        kpis.cash > 0
          ? "cash-positive"
          : "cash-constrained",
      leverage:
        kpis.assets > 0 && kpis.liabilities / kpis.assets > 0.5
          ? "elevated"
          : "controlled",
    };
  }

  buildScenarioModeling(kpis) {
    const revenue = Number(kpis.revenue || 0);
    const expenses = Number(kpis.expenses || 0);

    return {
      revenueDownTenPercent: {
        revenue: revenue * 0.9,
        profit: revenue * 0.9 - expenses,
      },
      expenseUpTenPercent: {
        expenses: expenses * 1.1,
        profit: revenue - expenses * 1.1,
      },
    };
  }

  buildForecast(kpis) {
    const revenue = Number(kpis.revenue || 0);
    const expenses = Number(kpis.expenses || 0);

    return {
      nextPeriodRevenueBaseline: revenue,
      nextPeriodExpenseBaseline: expenses,
      nextPeriodProfitBaseline: revenue - expenses,
      method: "current-period-baseline",
    };
  }

  buildRecommendations(kpis, health) {
    const recommendations = [];

    if (kpis.profit < 0) {
      recommendations.push("Reduce expenses or increase revenue before expanding.");
    }

    if (kpis.margin < 0.15) {
      recommendations.push("Review pricing, margins, and operating costs.");
    }

    if (kpis.cash <= 0) {
      recommendations.push("Prioritize cash reserves and short-term liquidity.");
    }

    if (health.label === "Healthy" && recommendations.length === 0) {
      recommendations.push("Continue routine monitoring and preserve current controls.");
    }

    return recommendations;
  }

  buildPlanningAssistance(kpis, health) {
    return {
      priority:
        health.label === "Critical"
          ? "stabilize"
          : health.label === "Warning"
            ? "improve"
            : "optimize",
      suggestedFocus:
        kpis.profit < 0
          ? "profitability"
          : kpis.cash <= 0
            ? "liquidity"
            : "controlled growth",
    };
  }
}

Object.freeze(FinancialIntelligenceApplication);
