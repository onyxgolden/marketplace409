import { describe, expect, it } from "vitest";
import { RiskExecutiveReportOrchestrator } from "../risk-executive-report-orchestrator.service";
import type { RiskWatchlistReport } from "../risk-watchlist.service";

describe("RiskExecutiveReportOrchestrator", () => {
  it("builds a complete executive report from a watchlist report", () => {
    const watchlistReport: RiskWatchlistReport = {
      snapshotCount: 2,
      newlyIntroducedRisks: [
        {
          id: "risk-new",
          finding: {
            id: "risk-new",
            severity: "medium",
            score: 55,
            explanation: "New risk entered the watchlist.",
            recommendedAction: "Review new risk.",
          },
          occurrences: 1,
          firstSeen: "2026-06-29T00:00:00.000Z",
          lastSeen: "2026-06-29T00:00:00.000Z",
          ageInSnapshots: 1,
          persistenceScore: 0.5,
          status: "new",
        },
      ],
      recurringRisks: [
        {
          id: "risk-critical",
          finding: {
            id: "risk-critical",
            severity: "critical",
            score: 95,
            explanation: "Critical risk remains unresolved.",
            recommendedAction: "Assign executive owner.",
          },
          occurrences: 2,
          firstSeen: "2026-06-28T00:00:00.000Z",
          lastSeen: "2026-06-29T00:00:00.000Z",
          ageInSnapshots: 2,
          persistenceScore: 1,
          status: "recurring",
        },
      ],
      resolvedRisks: [],
      agingRisks: [],
      watchlistItems: [
        {
          id: "risk-critical",
          status: "recurring",
          severity: "critical",
          score: 95,
          persistenceScore: 1,
          executiveSummary:
            "Critical risk remains unresolved. Persisted across 2 of 2 snapshots.",
          recommendedAction: "Assign executive owner.",
        },
        {
          id: "risk-new",
          status: "new",
          severity: "medium",
          score: 55,
          persistenceScore: 0.5,
          executiveSummary:
            "New risk entered the watchlist. Persisted across 1 of 1 snapshots.",
          recommendedAction: "Review new risk.",
        },
      ],
    };

    const result = new RiskExecutiveReportOrchestrator().build({
      generatedAt: "2026-06-30T00:00:00.000Z",
      watchlistReport,
    });

    expect(result.report.generatedAt).toBe("2026-06-30T00:00:00.000Z");
    expect(result.report.watchlist).toBe(watchlistReport);
    expect(result.actionPlan.itemCount).toBe(2);
    expect(result.actionPlan.urgentItemCount).toBe(1);
    expect(result.narrative.executiveSummary).toContain("urgent");
    expect(result.scorecard.overallStatus).toBe("critical");
    expect(result.scorecard.totalOpenActions).toBe(2);
    expect(result.report.actionPlan).toBe(result.actionPlan);
    expect(result.report.narrative).toBe(result.narrative);
    expect(result.report.scorecard).toBe(result.scorecard);
  });

  it("builds a healthy report when the watchlist has no active items", () => {
    const watchlistReport: RiskWatchlistReport = {
      snapshotCount: 0,
      newlyIntroducedRisks: [],
      recurringRisks: [],
      resolvedRisks: [],
      agingRisks: [],
      watchlistItems: [],
    };

    const result = new RiskExecutiveReportOrchestrator().build({
      generatedAt: "2026-06-30T00:00:00.000Z",
      watchlistReport,
    });

    expect(result.actionPlan.itemCount).toBe(0);
    expect(result.scorecard.overallStatus).toBe("healthy");
    expect(result.scorecard.readinessScore).toBe(100);
    expect(result.report.actionPlan.items).toEqual([]);
  });
});
