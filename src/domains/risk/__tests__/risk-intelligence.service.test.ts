import { describe, expect, it } from "vitest";
import { RiskIntelligenceService } from "../risk-intelligence.service";
import type { OverallRiskSummary } from "../risk.types";

describe("RiskIntelligenceService", () => {
  it("interprets an overall risk summary without scoring or aggregation", () => {
    const summary: OverallRiskSummary = {
      severity: "high",
      score: 80,
      findingCount: 2,
      severityCounts: {
        low: 0,
        medium: 1,
        high: 1,
        critical: 0,
      },
      topRisks: [
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
        {
          id: "risk:1100:LARGE_BALANCE",
          accountId: "1100",
          sourceType: "audit",
          sourceFindingType: "LARGE_BALANCE",
          severity: "medium",
          score: 55,
          confidence: 0.9,
          explanation: "Large account balance detected.",
          recommendedAction:
            "Verify that the account balance is expected and supported by trace evidence.",
        },
      ],
    };

    const assessment = new RiskIntelligenceService().assess(summary);

    expect(assessment.summary).toContain("Overall risk is high");
    expect(assessment.primaryDrivers).toHaveLength(1);
    expect(assessment.primaryDrivers[0].sourceFindingType).toBe(
      "NEGATIVE_BALANCE"
    );
    expect(assessment.recommendations).toEqual([
      "Review cash flow, account classification, and recent postings.",
    ]);
    expect(assessment.trendIndicators).toContain(
      "High-severity findings are driving the current risk posture."
    );
  });

  it("returns a calm assessment when no findings exist", () => {
    const assessment = new RiskIntelligenceService().assess({
      severity: "low",
      score: 0,
      findingCount: 0,
      severityCounts: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      },
      topRisks: [],
    });

    expect(assessment.primaryDrivers).toEqual([]);
    expect(assessment.recommendations).toEqual([]);
    expect(assessment.summary).toContain("No active risk findings");
    expect(assessment.trendIndicators).toEqual([
      "No current finding trend is available.",
    ]);
  });
});
