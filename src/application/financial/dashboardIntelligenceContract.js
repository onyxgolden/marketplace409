const DEFAULT_RISK_DASHBOARD = Object.freeze({
  summary: Object.freeze({
    severity: "low",
    score: 0,
    findingCount: 0,
    severityCounts: Object.freeze({
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    }),
    topRisks: Object.freeze([]),
    status: "Ready",
    summary: "Dashboard intelligence is ready.",
  }),
  assessment: Object.freeze({
    summary: "Dashboard intelligence is ready.",
    primaryDrivers: Object.freeze([]),
    recommendations: Object.freeze(["Continue routine monitoring."]),
    trendIndicators: Object.freeze([]),
  }),
  executiveBriefing: Object.freeze({
    headline: "Dashboard intelligence ready.",
    overview: "Dashboard intelligence is ready.",
    improvements: Object.freeze([]),
    concerns: Object.freeze([]),
    priorities: Object.freeze([]),
    recommendedActions: Object.freeze(["Continue routine monitoring."]),
    outlook: "Dashboard intelligence is ready.",
  }),
});

const DEFAULT_NET_WORTH = Object.freeze({
  totalAssets: 0,
  totalLiabilities: 0,
  netWorth: 0,
  debtToAssetRatio: 0,
});

const DEFAULT_AUDIT_FINDINGS = Object.freeze({
  anomalies: Object.freeze([]),
});

export function buildDashboardIntelligenceFallback({
  status = "Loading",
  message = "Dashboard intelligence is loading.",
  error = null,
} = {}) {
  return buildDashboardIntelligenceResponse({
    auditFindings: {
      anomalies: [],
      ...(error ? { error } : {}),
    },
    riskDashboard: {
      summary: {
        ...DEFAULT_RISK_DASHBOARD.summary,
        status,
        summary: message,
      },
      assessment: {
        ...DEFAULT_RISK_DASHBOARD.assessment,
        summary: message,
      },
      executiveBriefing: {
        ...DEFAULT_RISK_DASHBOARD.executiveBriefing,
        headline: message,
        overview: message,
        outlook: message,
      },
    },
    netWorth: DEFAULT_NET_WORTH,
  });
}

export function buildDashboardIntelligenceResponse({
  auditFindings = DEFAULT_AUDIT_FINDINGS,
  riskDashboard = DEFAULT_RISK_DASHBOARD,
  netWorth = DEFAULT_NET_WORTH,
} = {}) {
  return {
    auditFindings: {
      ...DEFAULT_AUDIT_FINDINGS,
      ...auditFindings,
      anomalies: Array.isArray(auditFindings?.anomalies)
        ? auditFindings.anomalies
        : [],
    },
    riskDashboard: {
      summary: {
        ...DEFAULT_RISK_DASHBOARD.summary,
        ...(riskDashboard?.summary ?? {}),
        severityCounts: {
          ...DEFAULT_RISK_DASHBOARD.summary.severityCounts,
          ...(riskDashboard?.summary?.severityCounts ?? {}),
        },
        topRisks: Array.isArray(riskDashboard?.summary?.topRisks)
          ? riskDashboard.summary.topRisks
          : [],
      },
      assessment: {
        ...DEFAULT_RISK_DASHBOARD.assessment,
        ...(riskDashboard?.assessment ?? {}),
        primaryDrivers: Array.isArray(
          riskDashboard?.assessment?.primaryDrivers,
        )
          ? riskDashboard.assessment.primaryDrivers
          : [],
        recommendations: Array.isArray(
          riskDashboard?.assessment?.recommendations,
        )
          ? riskDashboard.assessment.recommendations
          : ["Continue routine monitoring."],
        trendIndicators: Array.isArray(
          riskDashboard?.assessment?.trendIndicators,
        )
          ? riskDashboard.assessment.trendIndicators
          : [],
      },
      executiveBriefing: {
        ...DEFAULT_RISK_DASHBOARD.executiveBriefing,
        ...(riskDashboard?.executiveBriefing ?? {}),
        improvements: Array.isArray(
          riskDashboard?.executiveBriefing?.improvements,
        )
          ? riskDashboard.executiveBriefing.improvements
          : [],
        concerns: Array.isArray(riskDashboard?.executiveBriefing?.concerns)
          ? riskDashboard.executiveBriefing.concerns
          : [],
        priorities: Array.isArray(
          riskDashboard?.executiveBriefing?.priorities,
        )
          ? riskDashboard.executiveBriefing.priorities
          : [],
        recommendedActions: Array.isArray(
          riskDashboard?.executiveBriefing?.recommendedActions,
        )
          ? riskDashboard.executiveBriefing.recommendedActions
          : ["Continue routine monitoring."],
      },
    },
    netWorth: {
      ...DEFAULT_NET_WORTH,
      ...(netWorth ?? {}),
    },
  };
}
