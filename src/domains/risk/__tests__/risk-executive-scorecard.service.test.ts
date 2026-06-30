import { describe, expect, it } from "vitest";
import type { RiskActionPlan } from "../risk-action-plan.service";
import type { RiskExecutiveNarrative } from "../risk-executive-narrative.service";
import {
  RiskExecutiveScorecardService,
  type RiskExecutiveScorecard,
} from "../risk-executive-scorecard.service";
import type { RiskWatchlistReport } from "../risk-watchlist.service";

const narrative: RiskExecutiveNarrative = {
  executiveSummary: "Executive risk summary.",
  topConcerns: [],
  positiveTrends: [],
  immediatePriorities: ["missing-approval: Escalate immediately."],
  managementRecommendations: [],
};

const watchlistReport: RiskWatchlistReport = {
  snapshotCount: 4,
  newlyIntroducedRisks: [],
  recurringRisks: [],
  resolvedRisks: [],
  agingRisks: [],
  watchlistItems: [],
};

const actionPlan = ({
  itemCount,
  urgentItemCount,
  highPriorityItemCount,
}: {
  itemCount: number;
  urgentItemCount: number;
  highPriorityItemCount: number;
}): RiskActionPlan => ({
  itemCount,
  urgentItemCount,
  highPriorityItemCount,
  items: [],
});

describe("RiskExecutiveScorecardService", () => {
  it("builds a healthy executive scorecard when no actions are open", () => {
    const service = new RiskExecutiveScorecardService();

    expect(
      service.build({
        narrative,
        actionPlan: actionPlan({
          itemCount: 0,
          urgentItemCount: 0,
          highPriorityItemCount: 0,
        }),
        watchlistReport,
      })
    ).toEqual<RiskExecutiveScorecard>({
      overallStatus: "healthy",
      executiveSummary: "Executive risk summary.",
      snapshotCount: 4,
      totalOpenActions: 0,
      urgentActions: 0,
      highPriorityActions: 0,
      recurringRisks: 0,
      newRisks: 0,
      resolvedRisks: 0,
      agingRisks: 0,
      readinessScore: 100,
      managementFocus: ["missing-approval: Escalate immediately."],
    });
  });

  it("marks the scorecard critical when urgent actions exist", () => {
    const service = new RiskExecutiveScorecardService();

    const scorecard = service.build({
      narrative,
      actionPlan: actionPlan({
        itemCount: 2,
        urgentItemCount: 1,
        highPriorityItemCount: 1,
      }),
      watchlistReport,
    });

    expect(scorecard.overallStatus).toBe("critical");
    expect(scorecard.readinessScore).toBe(55);
  });

  it("marks the scorecard action required when high priority actions exist", () => {
    const service = new RiskExecutiveScorecardService();

    const scorecard = service.build({
      narrative,
      actionPlan: actionPlan({
        itemCount: 1,
        urgentItemCount: 0,
        highPriorityItemCount: 1,
      }),
      watchlistReport,
    });

    expect(scorecard.overallStatus).toBe("action_required");
    expect(scorecard.readinessScore).toBe(85);
  });

  it("marks the scorecard watch when only lower priority actions exist", () => {
    const service = new RiskExecutiveScorecardService();

    const scorecard = service.build({
      narrative,
      actionPlan: actionPlan({
        itemCount: 2,
        urgentItemCount: 0,
        highPriorityItemCount: 0,
      }),
      watchlistReport,
    });

    expect(scorecard.overallStatus).toBe("watch");
    expect(scorecard.readinessScore).toBe(90);
  });
});
