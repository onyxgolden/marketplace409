import { describe, expect, it } from "vitest";
import { RiskHistoryService } from "../risk-history.service";
import type { OverallRiskSummary } from "../risk.types";

describe("RiskHistoryService", () => {
  it("creates a read-only snapshot from an overall risk summary", () => {
    const summary: OverallRiskSummary = {
      severity: "high",
      score: 80,
      findingCount: 1,
      severityCounts: {
        low: 0,
        medium: 0,
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
      ],
    };

    const snapshot = new RiskHistoryService().createSnapshot({
      summary,
      timestamp: "2026-06-29T18:00:00.000Z",
    });

    expect(snapshot).toEqual({
      timestamp: "2026-06-29T18:00:00.000Z",
      overallScore: 80,
      severity: "high",
      findingCount: 1,
      topDrivers: summary.topRisks,
    });
  });

  it("reports worsening risk when the latest score increases", () => {
    const service = new RiskHistoryService();

    const trend = service.compare(
      {
        timestamp: "2026-06-29T18:00:00.000Z",
        overallScore: 80,
        severity: "high",
        findingCount: 1,
        topDrivers: [],
      },
      {
        timestamp: "2026-06-28T18:00:00.000Z",
        overallScore: 55,
        severity: "medium",
        findingCount: 1,
        topDrivers: [],
      }
    );

    expect(trend).toEqual({
      direction: "worsening",
      scoreChange: 25,
      currentScore: 80,
      previousScore: 55,
      currentSeverity: "high",
      previousSeverity: "medium",
    });
  });

  it("reports improving risk when the latest score decreases", () => {
    const service = new RiskHistoryService();

    const trend = service.compare(
      {
        timestamp: "2026-06-29T18:00:00.000Z",
        overallScore: 20,
        severity: "low",
        findingCount: 1,
        topDrivers: [],
      },
      {
        timestamp: "2026-06-28T18:00:00.000Z",
        overallScore: 80,
        severity: "high",
        findingCount: 1,
        topDrivers: [],
      }
    );

    expect(trend.direction).toBe("improving");
    expect(trend.scoreChange).toBe(-60);
  });

  it("reports stable risk when no previous snapshot exists", () => {
    const trend = new RiskHistoryService().compare({
      timestamp: "2026-06-29T18:00:00.000Z",
      overallScore: 80,
      severity: "high",
      findingCount: 1,
      topDrivers: [],
    });

    expect(trend).toEqual({
      direction: "stable",
      scoreChange: 0,
      currentScore: 80,
      previousScore: null,
      currentSeverity: "high",
      previousSeverity: null,
    });
  });
});
