import { describe, expect, it } from "vitest";
import type { RiskActionPlan } from "../risk-action-plan.service";
import {
  RiskExecutiveNarrativeService,
  type RiskExecutiveNarrative,
} from "../risk-executive-narrative.service";
import type { RiskWatchlistReport } from "../risk-watchlist.service";

const emptyWatchlistReport: RiskWatchlistReport = {
  snapshotCount: 0,
  newlyIntroducedRisks: [],
  recurringRisks: [],
  resolvedRisks: [],
  agingRisks: [],
  watchlistItems: [],
};

const emptyActionPlan: RiskActionPlan = {
  itemCount: 0,
  urgentItemCount: 0,
  highPriorityItemCount: 0,
  items: [],
};

describe("RiskExecutiveNarrativeService", () => {
  it("returns a calm narrative when no executive risks require action", () => {
    const service = new RiskExecutiveNarrativeService();

    expect(
      service.build({
        watchlistReport: emptyWatchlistReport,
        actionPlan: emptyActionPlan,
      })
    ).toEqual<RiskExecutiveNarrative>({
      executiveSummary:
        "No active executive risk concerns require management action.",
      topConcerns: [],
      positiveTrends: [
        "No resolved risk trends were detected in the current watchlist.",
      ],
      immediatePriorities: [
        "No urgent or high priority risk actions are currently open.",
      ],
      managementRecommendations: [
        "Continue routine monitoring and close open actions through normal controls.",
      ],
    });
  });

  it("summarizes urgent risk actions for executive attention", () => {
    const service = new RiskExecutiveNarrativeService();

    const narrative = service.build({
      watchlistReport: {
        ...emptyWatchlistReport,
        snapshotCount: 4,
      },
      actionPlan: {
        itemCount: 1,
        urgentItemCount: 1,
        highPriorityItemCount: 0,
        items: [
          {
            id: "action-missing-approval",
            riskId: "missing-approval",
            priority: "urgent",
            severity: "critical",
            score: 95,
            persistenceScore: 1,
            status: "open",
            businessImpact:
              "Critical risk may materially impact financial integrity, governance, or operational trust.",
            action: "Escalate missing approvals immediately.",
            urgency: "Immediate management attention required.",
          },
        ],
      },
    });

    expect(narrative.executiveSummary).toBe(
      "1 urgent risk action item requires immediate executive attention across 4 risk snapshots."
    );
    expect(narrative.immediatePriorities).toEqual([
      "missing-approval: Escalate missing approvals immediately.",
    ]);
    expect(narrative.managementRecommendations).toContain(
      "Assign executive ownership for urgent risk actions before the next operating review."
    );
  });

  it("builds concerns from aging, recurring, and new risks", () => {
    const service = new RiskExecutiveNarrativeService();

    const narrative = service.build({
      watchlistReport: {
        snapshotCount: 3,
        agingRisks: [
          {
            id: "aging-risk",
            finding: {
              id: "aging-risk",
              sourceType: "executive_test",
              sourceFindingType: "TEST_RISK",
              severity: "high",
              score: 82,
              confidence: 1,
              explanation: "Aging risk persists.",
              recommendedAction: "Assign owner.",
            },
            occurrences: 3,
            firstSeen: "2026-06-01",
            lastSeen: "2026-06-03",
            ageInSnapshots: 3,
            persistenceScore: 1,
            status: "recurring",
          },
        ],
        recurringRisks: [
          {
            id: "recurring-risk",
            finding: {
              id: "recurring-risk",
              sourceType: "executive_test",
              sourceFindingType: "TEST_RISK",
              severity: "medium",
              score: 64,
              confidence: 1,
              explanation: "Recurring risk persists.",
              recommendedAction: "Review process.",
            },
            occurrences: 2,
            firstSeen: "2026-06-02",
            lastSeen: "2026-06-03",
            ageInSnapshots: 2,
            persistenceScore: 0.67,
            status: "recurring",
          },
        ],
        newlyIntroducedRisks: [
          {
            id: "new-risk",
            finding: {
              id: "new-risk",
              sourceType: "executive_test",
              sourceFindingType: "TEST_RISK",
              severity: "low",
              score: 25,
              confidence: 1,
              explanation: "New risk appeared.",
              recommendedAction: "Monitor.",
            },
            occurrences: 1,
            firstSeen: "2026-06-03",
            lastSeen: "2026-06-03",
            ageInSnapshots: 1,
            persistenceScore: 0.33,
            status: "new",
          },
        ],
        resolvedRisks: [],
        watchlistItems: [],
      },
      actionPlan: emptyActionPlan,
    });

    expect(narrative.topConcerns).toEqual([
      "aging-risk is aging across 3 snapshots and remains a recurring concern.",
      "recurring-risk has recurred 2 times and should remain on the executive watchlist.",
      "new-risk is newly introduced and should be reviewed before it becomes persistent.",
    ]);
  });

  it("identifies positive trends from resolved risks", () => {
    const service = new RiskExecutiveNarrativeService();

    const narrative = service.build({
      watchlistReport: {
        ...emptyWatchlistReport,
        snapshotCount: 2,
        resolvedRisks: [
          {
            id: "resolved-risk",
            finding: {
              id: "resolved-risk",
              sourceType: "executive_test",
              sourceFindingType: "TEST_RISK",
              severity: "medium",
              score: 44,
              confidence: 1,
              explanation: "Resolved issue.",
              recommendedAction: "No further action.",
            },
            occurrences: 1,
            firstSeen: "2026-06-01",
            lastSeen: "2026-06-01",
            ageInSnapshots: 1,
            persistenceScore: 0.5,
            status: "resolved",
          },
        ],
      },
      actionPlan: emptyActionPlan,
    });

    expect(narrative.positiveTrends).toEqual([
      "resolved-risk is no longer present in the latest snapshot and may indicate improving control performance.",
    ]);
  });
});
