export class FinancialRecommendationService {
  recommend(kpis = {}, health = {}) {
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

    return Object.freeze(recommendations);
  }
}

Object.freeze(FinancialRecommendationService);
