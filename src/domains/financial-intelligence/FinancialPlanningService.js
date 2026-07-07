export class FinancialPlanningService {
  buildPlan(kpis = {}, health = {}) {
    const priority =
      health.label === "Critical"
        ? "stabilize"
        : health.label === "Warning"
          ? "improve"
          : "optimize";

    const suggestedFocus =
      kpis.profit < 0
        ? "profitability"
        : kpis.cash <= 0
          ? "liquidity"
          : "controlled growth";

    const summary =
      priority === "stabilize"
        ? "Stabilize financial resilience and liquidity."
        : priority === "improve"
          ? "Improve financial performance and controls."
          : "Optimize operating performance.";

    return Object.freeze({
      priority,
      suggestedFocus,
      summary,
    });
  }
}

Object.freeze(FinancialPlanningService);
