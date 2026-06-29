import { describe, expect, it } from "vitest";
import { ExecutiveBriefingService } from "../executive-briefing.service";
import type { RiskTrend } from "../risk-history.service";
import type { RiskAssessment } from "../risk-intelligence.service";

const highRiskAssessment: RiskAssessment = {
  summary: "Overall risk is high with a score of 80.",
  primaryDrivers: [
    {
      id: "risk:1000:NEGATIVE_BALANCE",
      accountId: "1000",
      sourceType: "audit",
      sourceFindingType: "NEGATIVE_BALANCE",
      severity: "high",
      score: 80,
      confidence: 1,
      explanation: "Negative account balance detected.",
      recommendedAction:
        "Review cash flow, account classification, and recent postings.",
    },
  ],
  recommendations: [
    "Review cash flow, account classification, and recent postings.",
  ],
  trendIndicators: ["High-severity findings are driving the current risk posture."],
};

describe("ExecutiveBriefingService", () => {
  it("creates an urgent headline and concerns for a worsening trend", () => {
    const trend: RiskTrend = {
      direction: "worsening",
      scoreChange: 25,
      currentScore: 80,
      previousScore: 55,
      currentSeverity: "high",
      previousSeverity: "medium",
    };

    const briefing = new ExecutiveBriefingService().brief({
      assessment: highRiskAssessment,
      trend,
    });

    expect(briefing.headline).toContain("Urgent review recommended");
    expect(briefing.overview).toBe(highRiskAssessment.summary);
    expect(briefing.concerns).toContain(
      "Overall risk score increased from 55 to 80."
    );
    expect(briefing.concerns).toContain("Negative account balance detected.");
    expect(briefing.outlook).toContain("Outlook is negative");
  });

  it("creates improvement language for an improving trend", () => {
    const trend: RiskTrend = {
      direction: "improving",
      scoreChange: -60,
      currentScore: 20,
      previousScore: 80,
      currentSeverity: "low",
      previousSeverity: "high",
    };

    const briefing = new ExecutiveBriefingService().brief({
      assessment: highRiskAssessment,
      trend,
    });

    expect(briefing.headline).toContain("Risk posture is improving");
    expect(briefing.improvements).toContain(
      "Overall risk score improved from 80 to 20."
    );
    expect(briefing.outlook).toContain("Outlook is positive");
  });

  it("creates initial baseline language when no previous trend exists", () => {
    const trend: RiskTrend = {
      direction: "stable",
      scoreChange: 0,
      currentScore: 80,
      previousScore: null,
      currentSeverity: "high",
      previousSeverity: null,
    };

    const briefing = new ExecutiveBriefingService().brief({
      assessment: highRiskAssessment,
      trend,
    });

    expect(briefing.headline).toContain("Initial executive risk baseline");
    expect(briefing.improvements).toContain(
      "Initial baseline established for future executive comparison."
    );
    expect(briefing.outlook).toContain("first executive baseline");
  });

  it("passes recommended actions through from the risk assessment", () => {
    const trend: RiskTrend = {
      direction: "stable",
      scoreChange: 0,
      currentScore: 80,
      previousScore: 80,
      currentSeverity: "high",
      previousSeverity: "high",
    };

    const briefing = new ExecutiveBriefingService().brief({
      assessment: highRiskAssessment,
      trend,
    });

    expect(briefing.recommendedActions).toEqual(
      highRiskAssessment.recommendations
    );
  });
});
