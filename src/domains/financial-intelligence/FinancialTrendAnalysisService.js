export class FinancialTrendAnalysisService {
  analyze(kpis = {}) {
    return Object.freeze({
      profitability:
        kpis.profit > 0
          ? "positive"
          : kpis.profit < 0
            ? "negative"
            : "neutral",
      liquidity: kpis.cash > 0 ? "cash-positive" : "cash-constrained",
      leverage:
        kpis.assets > 0 && kpis.liabilities / kpis.assets > 0.5
          ? "elevated"
          : "controlled",
    });
  }
}

Object.freeze(FinancialTrendAnalysisService);
