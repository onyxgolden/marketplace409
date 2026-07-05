export class FinancialPlanningService {
  buildPlan(kpis = {}, health = {}) {
    return Object.freeze({
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
    });
  }
}

Object.freeze(FinancialPlanningService);
