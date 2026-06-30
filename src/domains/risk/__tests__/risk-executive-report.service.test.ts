import { describe, expect, it } from "vitest";
import { RiskExecutiveReportService } from "../risk-executive-report.service";
import type { RiskActionPlan } from "../risk-action-plan.service";
import type { RiskExecutiveNarrative } from "../risk-executive-narrative.service";
import type { RiskExecutiveScorecard } from "../risk-executive-scorecard.service";
import type { RiskWatchlistReport } from "../risk-watchlist.service";

describe("RiskExecutiveReportService", () => {
  it("packages executive risk artifacts into a single report", () => {
    const scorecard: RiskExecutiveScorecard = {
      overallStatus: "action_required",
      executiveSummary: "1 high priority risk action item should be reviewed in the next management cycle.",
      snapshotCount: 2,
      totalOpenActions: 1,
      urgentActions: 0,
      highPriorityActions: 1,
      recurringRisks: 1,
      newRisks: 0,
      resolvedRisks: 1,
      agingRisks: 0,
      readinessScore: 85,
      managementFocus: ["risk-1: Review control weakness."],
    };

    const narrative: RiskExecutiveNarrative = {
      executiveSummary: scorecard.executiveSummary,
      topConcerns: ["risk-1 has recurred 2 times and should remain on the executive watchlist."],
      positiveTrends: ["risk-2 is no longer present in the latest snapshot and may indicate improving control performance."],
      immediatePriorities: ["risk-1: Review control weakness."],
      managementRecommendations: ["Review high priority risk actions during the next management cycle."],
    };

    const actionPlan: RiskActionPlan = {
      itemCount: 1,
      urgentItemCount: 0,
      highPriorityItemCount: 1,
      items: [
        {
          id: "action-risk-1",
          riskId: "risk-1",
          priority: "high",
          severity: "high",
          score: 75,
          persistenceScore: 0.7,
          status: "open",
          businessImpact: "High risk may create meaningful financial, compliance, or control exposure.",
          action: "Review control weakness.",
          urgency: "Prioritize in the next management review cycle.",
        },
      ],
    };

    const watchlist: RiskWatchlistReport = {
      snapshotCount: 2,
      watchlistItems: [],
      recurringRisks: [
        {
          id: "risk-1",
          occurrences: 2,
          latestSeverity: "high",
          latestScore: 75,
        },
      ],
      newlyIntroducedRisks: [],
      resolvedRisks: [
        {
          id: "risk-2",
          lastSeenSnapshotId: "snapshot-1",
        },
      ],
      agingRisks: [],
    };

    const report = new RiskExecutiveReportService().build({
      generatedAt: "2026-06-30T00:00:00.000Z",
      scorecard,
      narrative,
      actionPlan,
      watchlist,
    });

    expect(report).toEqual({
      generatedAt: "2026-06-30T00:00:00.000Z",
      scorecard,
      narrative,
      actionPlan,
      watchlist,
    });
  });
});
