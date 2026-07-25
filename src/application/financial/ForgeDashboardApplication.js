import {
  CanonicalDashboardProjection,
} from "../intelligence/index.js";

import {
  buildDashboardIntelligenceFallback,
  buildDashboardIntelligenceResponse,
} from "./dashboardIntelligenceContract.js";

function formatCurrency(value) {
  if (value == null) return "$0";
  return `$${Number(value).toLocaleString()}`;
}

const DEFAULT_LEDGER_CONTEXT = Object.freeze({
  accounts: Object.freeze([
    Object.freeze({ id: "1000", name: "Cash", balance: 280000 }),
    Object.freeze({ id: "1100", name: "Accounts Receivable", balance: 120000 }),
    Object.freeze({ id: "2000", name: "Debt", balance: -40000 }),
  ]),
  postings: Object.freeze([]),
});

const DEFAULT_ASSETS = Object.freeze([
  Object.freeze({ id: "cash", name: "Cash", category: "bank", value: 280000 }),
]);

const DEFAULT_LIABILITIES = Object.freeze([
  Object.freeze({ id: "debt", name: "Debt", category: "loan", balance: 0 }),
]);

export class ForgeDashboardApplication {
  static buildDashboardRequestInput() {
    return {
      ledgerContext: DEFAULT_LEDGER_CONTEXT,
      assets: DEFAULT_ASSETS,
      liabilities: DEFAULT_LIABILITIES,
    };
  }

  static buildLoadingDashboardIntelligence() {
    return buildDashboardIntelligenceFallback({
      status: "Loading",
      message: "Dashboard intelligence is loading.",
    });
  }

  static buildErrorDashboardIntelligence(error) {
    return buildDashboardIntelligenceFallback({
      status: "Review",
      message: "Dashboard intelligence could not be loaded.",
      error:
        error instanceof Error
          ? error.message
          : "Unable to load dashboard intelligence.",
    });
  }

  static normalizeDashboardIntelligence(input) {
    if (
      input?.type === "canonical-intelligence-context"
    ) {
      return buildDashboardIntelligenceResponse(
        CanonicalDashboardProjection.project(input),
      );
    }

    return buildDashboardIntelligenceResponse(input);
  }

  static async loadDashboardIntelligence({ fetcher = fetch } = {}) {
    try {
      const response = await fetcher("/api/financial/dashboard-intelligence", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(this.buildDashboardRequestInput()),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Unable to load dashboard intelligence.",
        );
      }

      return this.normalizeDashboardIntelligence(payload.data);
    } catch (error) {
      return this.buildErrorDashboardIntelligence(error);
    }
  }

  static async loadReadModels({ fetcher = fetch, logger = console } = {}) {
    try {
      const response = await fetcher(
        "/api/financial/read-models?business=true&investor=true&kpi=true&executive=true",
      );

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error ?? "Read models failed.");
      }

      return payload.data;
    } catch (error) {
      logger.warn("Read models failed (non-blocking):", error);
      return null;
    }
  }

  static buildViewModel(dashboardIntelligence) {
    const normalized = this.normalizeDashboardIntelligence(
      dashboardIntelligence ?? this.buildLoadingDashboardIntelligence(),
    );

    const auditFindings = normalized.auditFindings;
    const riskDashboard = normalized.riskDashboard;
    const netWorth = normalized.netWorth;

    const riskSummary = riskDashboard.summary;
    const riskAssessment = riskDashboard.assessment;
    const executiveBriefing = riskDashboard.executiveBriefing;

    return {
      auditFindings,
      riskDashboard,
      netWorth,
      riskSummary,
      riskAssessment,
      executiveBriefing,
      alertItems: [
        {
          label: riskSummary.status,
          detail: riskSummary.summary,
        },
        {
          label: "Audit Findings",
          detail: `${auditFindings?.anomalies?.length ?? 0} active findings in the current read-only scan.`,
        },
      ],
      insightItems: [
        {
          label: "Executive Outlook",
          detail: executiveBriefing.outlook,
        },
        {
          label: "Recommended Focus",
          detail:
            riskAssessment.recommendations[0] ?? "Continue routine monitoring.",
        },
      ],
      portfolioSummaryItems: [
        { label: "Assets", value: formatCurrency(netWorth.totalAssets) },
        {
          label: "Liabilities",
          value: formatCurrency(netWorth.totalLiabilities),
        },
        { label: "Net Worth", value: formatCurrency(netWorth.netWorth) },
      ],
      systemHealthItems: [
        {
          label: "Dashboard Shell",
          status: "online",
          detail: "Executive dashboard composition is active.",
        },
        {
          label: "Dashboard Intelligence API",
          status: auditFindings?.error ? "review" : "online",
          detail:
            auditFindings?.error ??
            "Dashboard intelligence loaded through the financial application API.",
        },
        {
          label: "Risk Services",
          status: "online",
          detail:
            "Risk dashboard service returned current summary and assessment.",
        },
      ],
      systemStatusItems: [
        {
          label: "Risk Engine",
          detail: riskSummary.summary,
          value: riskSummary.status,
        },
        {
          label: "Audit Layer",
          detail: "Read-only anomaly scan completed.",
          value: `${auditFindings?.anomalies?.length ?? 0} findings`,
        },
        {
          label: "Net Worth",
          detail: "Snapshot calculation completed.",
          value: formatCurrency(netWorth.netWorth),
        },
      ],
      recentActivities: [
        {
          id: "dashboard-intelligence",
          label: "Dashboard intelligence refreshed",
          detail:
            "Financial dashboard intelligence loaded through the application API.",
          type: "system",
          timestamp: "Current session",
        },
        {
          id: "audit-findings",
          label: "Audit scan completed",
          detail: `${auditFindings?.anomalies?.length ?? 0} anomalies detected.`,
          type: "audit",
          timestamp: "Current session",
        },
        {
          id: "net-worth",
          label: "Net worth snapshot calculated",
          detail: `Current net worth is ${formatCurrency(netWorth.netWorth)}.`,
          type: "wealth",
          timestamp: "Current session",
        },
      ],
    };
  }
}

Object.freeze(ForgeDashboardApplication);
