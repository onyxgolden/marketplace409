import {
  buildDashboardIntelligenceFallback,
  buildDashboardIntelligenceResponse,
} from "./dashboardIntelligenceContract.js";

export class FinancialDashboardIntelligenceApplication {
  constructor({ auditAgent, riskDashboardService, netWorthService }) {
    if (!auditAgent) {
      throw new Error(
        "FinancialDashboardIntelligenceApplication requires an audit agent.",
      );
    }

    if (!riskDashboardService) {
      throw new Error(
        "FinancialDashboardIntelligenceApplication requires a risk dashboard service.",
      );
    }

    if (!netWorthService) {
      throw new Error(
        "FinancialDashboardIntelligenceApplication requires a net worth service.",
      );
    }

    this.auditAgent = auditAgent;
    this.riskDashboardService = riskDashboardService;
    this.netWorthService = netWorthService;
  }

  buildDashboardIntelligence({
    intelligenceContext = {},
  } = {}) {
    const financial =
      intelligenceContext?.financial || {};

    const position =
      financial?.position || {};

    const ledgerContext =
      financial?.dashboard?.ledgerContext || {};

    const assets =
      position.assets || [];

    const liabilities =
      position.liabilities || [];

    const auditFindings = this.auditAgent.run({
      ledger: ledgerContext,
    });

    const riskDashboard = this.riskDashboardService.build({
      auditFindings: auditFindings?.anomalies ?? [],
    });

    const netWorth = this.netWorthService.calculate(
      assets,
      liabilities,
    );

    return buildDashboardIntelligenceResponse({
      auditFindings,
      riskDashboard,
      netWorth,
    });
  }

  static buildFallbackResponse(input) {
    return buildDashboardIntelligenceFallback(input);
  }

  static buildResponse(input) {
    return buildDashboardIntelligenceResponse(input);
  }
}

Object.freeze(FinancialDashboardIntelligenceApplication);
