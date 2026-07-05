import {
  buildDashboardIntelligenceFallback,
  buildDashboardIntelligenceResponse,
} from "./dashboardIntelligenceContract.js";

describe("dashboardIntelligenceContract", () => {
  test("builds a stable fallback response shape", () => {
    const result = buildDashboardIntelligenceFallback({
      status: "Unavailable",
      message: "Dashboard intelligence is unavailable.",
      error: "Service failed.",
    });

    expect(result).toMatchObject({
      auditFindings: {
        anomalies: [],
        error: "Service failed.",
      },
      riskDashboard: {
        summary: {
          severity: "low",
          score: 0,
          findingCount: 0,
          status: "Unavailable",
          summary: "Dashboard intelligence is unavailable.",
          severityCounts: {
            low: 0,
            medium: 0,
            high: 0,
            critical: 0,
          },
          topRisks: [],
        },
        assessment: {
          summary: "Dashboard intelligence is unavailable.",
          primaryDrivers: [],
          recommendations: ["Continue routine monitoring."],
          trendIndicators: [],
        },
        executiveBriefing: {
          headline: "Dashboard intelligence is unavailable.",
          overview: "Dashboard intelligence is unavailable.",
          improvements: [],
          concerns: [],
          priorities: [],
          recommendedActions: ["Continue routine monitoring."],
          outlook: "Dashboard intelligence is unavailable.",
        },
      },
      netWorth: {
        totalAssets: 0,
        totalLiabilities: 0,
        netWorth: 0,
        debtToAssetRatio: 0,
      },
    });
  });

  test("normalizes malformed collection fields to safe arrays", () => {
    const result = buildDashboardIntelligenceResponse({
      auditFindings: {
        anomalies: "not-array",
      },
      riskDashboard: {
        summary: {
          topRisks: "not-array",
        },
        assessment: {
          primaryDrivers: "not-array",
          recommendations: "not-array",
          trendIndicators: "not-array",
        },
        executiveBriefing: {
          improvements: "not-array",
          concerns: "not-array",
          priorities: "not-array",
          recommendedActions: "not-array",
        },
      },
    });

    expect(result.auditFindings.anomalies).toEqual([]);
    expect(result.riskDashboard.summary.topRisks).toEqual([]);
    expect(result.riskDashboard.assessment.primaryDrivers).toEqual([]);
    expect(result.riskDashboard.assessment.recommendations).toEqual([
      "Continue routine monitoring.",
    ]);
    expect(result.riskDashboard.assessment.trendIndicators).toEqual([]);
    expect(result.riskDashboard.executiveBriefing.improvements).toEqual([]);
    expect(result.riskDashboard.executiveBriefing.concerns).toEqual([]);
    expect(result.riskDashboard.executiveBriefing.priorities).toEqual([]);
    expect(result.riskDashboard.executiveBriefing.recommendedActions).toEqual([
      "Continue routine monitoring.",
    ]);
  });

  test("fills missing net worth fields with default values", () => {
    const result = buildDashboardIntelligenceResponse({
      netWorth: {
        totalAssets: 100,
      },
    });

    expect(result.netWorth).toEqual({
      totalAssets: 100,
      totalLiabilities: 0,
      netWorth: 0,
      debtToAssetRatio: 0,
    });
  });
});
