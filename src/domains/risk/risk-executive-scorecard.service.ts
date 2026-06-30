import type { RiskActionPlan } from "./risk-action-plan.service";
import type { RiskExecutiveNarrative } from "./risk-executive-narrative.service";
import type { RiskWatchlistReport } from "./risk-watchlist.service";

export type ExecutiveRiskStatus =
  | "healthy"
  | "watch"
  | "action_required"
  | "critical";

export type RiskExecutiveScorecard = {
  overallStatus: ExecutiveRiskStatus;
  executiveSummary: string;
  snapshotCount: number;
  totalOpenActions: number;
  urgentActions: number;
  highPriorityActions: number;
  recurringRisks: number;
  newRisks: number;
  resolvedRisks: number;
  agingRisks: number;
  readinessScore: number;
  managementFocus: string[];
};

export class RiskExecutiveScorecardService {
  build({
    narrative,
    actionPlan,
    watchlistReport,
  }: {
    narrative: RiskExecutiveNarrative;
    actionPlan: RiskActionPlan;
    watchlistReport: RiskWatchlistReport;
  }): RiskExecutiveScorecard {
    return {
      overallStatus: this.determineStatus(actionPlan),
      executiveSummary: narrative.executiveSummary,
      snapshotCount: watchlistReport.snapshotCount,
      totalOpenActions: actionPlan.itemCount,
      urgentActions: actionPlan.urgentItemCount,
      highPriorityActions: actionPlan.highPriorityItemCount,
      recurringRisks: watchlistReport.recurringRisks.length,
      newRisks: watchlistReport.newlyIntroducedRisks.length,
      resolvedRisks: watchlistReport.resolvedRisks.length,
      agingRisks: watchlistReport.agingRisks.length,
      readinessScore: this.calculateReadiness(actionPlan),
      managementFocus: narrative.immediatePriorities,
    };
  }

  private determineStatus(
    actionPlan: RiskActionPlan
  ): ExecutiveRiskStatus {
    if (actionPlan.urgentItemCount > 0) {
      return "critical";
    }

    if (actionPlan.highPriorityItemCount > 0) {
      return "action_required";
    }

    if (actionPlan.itemCount > 0) {
      return "watch";
    }

    return "healthy";
  }

  private calculateReadiness(actionPlan: RiskActionPlan): number {
    if (actionPlan.itemCount === 0) {
      return 100;
    }

    const penalty =
      actionPlan.urgentItemCount * 30 +
      actionPlan.highPriorityItemCount * 15 +
      (actionPlan.itemCount -
        actionPlan.urgentItemCount -
        actionPlan.highPriorityItemCount) *
        5;

    return Math.max(0, 100 - penalty);
  }
}
