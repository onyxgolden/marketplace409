import { describe, expect, it } from "vitest";
import { RiskDashboardService } from "../risk-dashboard.service";

describe("RiskDashboardService", () => {
  it("assembles risk summary, assessment, snapshot, trend, and briefing", () => {
    const dashboard = new RiskDashboardService().build({
      auditFindings: [
        {
          accountId: "1000",
          type: "NEGATIVE_BALANCE",
          explanation: "Negative account balance detected.",
        },
      ],
      timestamp: "2026-06-29T18:00:00.000Z",
    });

    expect(dashboard.summary.findingCount).toBe(1);
    expect(dashboard.assessment.summary).toContain("Overall risk is");
    expect(dashboard.snapshot.timestamp).toBe("2026-06-29T18:00:00.000Z");
    expect(dashboard.trend.previousScore).toBeNull();
    expect(dashboard.executiveBriefing.headline).toContain(
      "Initial executive risk baseline"
    );
    expect(dashboard.topRisks).toEqual(dashboard.summary.topRisks);
  });

  it("uses a previous snapshot to produce worsening executive trend context", () => {
    const dashboard = new RiskDashboardService().build({
      auditFindings: [
        {
          accountId: "1000",
          type: "NEGATIVE_BALANCE",
          explanation: "Negative account balance detected.",
        },
      ],
      previousSnapshot: {
        timestamp: "2026-06-28T18:00:00.000Z",
        overallScore: 0,
        severity: "low",
        findingCount: 0,
        topDrivers: [],
      },
      timestamp: "2026-06-29T18:00:00.000Z",
    });

    expect(dashboard.trend.direction).toBe("worsening");
    expect(dashboard.executiveBriefing.headline).toContain(
      "Urgent review recommended"
    );
  });

  it("creates a calm baseline dashboard when no findings exist", () => {
    const dashboard = new RiskDashboardService().build({
      auditFindings: [],
      timestamp: "2026-06-29T18:00:00.000Z",
    });

    expect(dashboard.summary.score).toBe(0);
    expect(dashboard.summary.severity).toBe("low");
    expect(dashboard.assessment.recommendations).toEqual([]);
    expect(dashboard.executiveBriefing.recommendedActions).toEqual([]);
  });
});
