import type { RiskActionPlan } from "./risk-action-plan.service";
import type { RiskWatchlistReport } from "./risk-watchlist.service";

export type RiskExecutiveNarrative = {
  executiveSummary: string;
  topConcerns: string[];
  positiveTrends: string[];
  immediatePriorities: string[];
  managementRecommendations: string[];
};

export class RiskExecutiveNarrativeService {
  build({
    watchlistReport,
    actionPlan,
  }: {
    watchlistReport: RiskWatchlistReport;
    actionPlan: RiskActionPlan;
  }): RiskExecutiveNarrative {
    return {
      executiveSummary: this.buildExecutiveSummary({
        watchlistReport,
        actionPlan,
      }),
      topConcerns: this.buildTopConcerns(watchlistReport),
      positiveTrends: this.buildPositiveTrends(watchlistReport),
      immediatePriorities: this.buildImmediatePriorities(actionPlan),
      managementRecommendations: this.buildManagementRecommendations({
        watchlistReport,
        actionPlan,
      }),
    };
  }

  private buildExecutiveSummary({
    watchlistReport,
    actionPlan,
  }: {
    watchlistReport: RiskWatchlistReport;
    actionPlan: RiskActionPlan;
  }): string {
    if (watchlistReport.snapshotCount === 0 || actionPlan.itemCount === 0) {
      return "No active executive risk concerns require management action.";
    }

    if (actionPlan.urgentItemCount > 0) {
      return `${actionPlan.urgentItemCount} urgent risk action item requires immediate executive attention across ${watchlistReport.snapshotCount} risk snapshots.`;
    }

    if (actionPlan.highPriorityItemCount > 0) {
      return `${actionPlan.highPriorityItemCount} high priority risk action item should be reviewed in the next management cycle.`;
    }

    return `${actionPlan.itemCount} risk action item should be tracked through routine operating controls.`;
  }

  private buildTopConcerns(report: RiskWatchlistReport): string[] {
    const concerns = [
      ...report.agingRisks.map(
        (risk) =>
          `${risk.id} is aging across ${risk.ageInSnapshots} snapshots and remains a recurring concern.`
      ),
      ...report.recurringRisks.map(
        (risk) =>
          `${risk.id} has recurred ${risk.occurrences} times and should remain on the executive watchlist.`
      ),
      ...report.newlyIntroducedRisks.map(
        (risk) =>
          `${risk.id} is newly introduced and should be reviewed before it becomes persistent.`
      ),
    ];

    return this.unique(concerns);
  }

  private buildPositiveTrends(report: RiskWatchlistReport): string[] {
    if (report.resolvedRisks.length === 0) {
      return ["No resolved risk trends were detected in the current watchlist."];
    }

    return report.resolvedRisks.map(
      (risk) =>
        `${risk.id} is no longer present in the latest snapshot and may indicate improving control performance.`
    );
  }

  private buildImmediatePriorities(actionPlan: RiskActionPlan): string[] {
    const immediatePriorities = actionPlan.items
      .filter((item) => item.priority === "urgent" || item.priority === "high")
      .map((item) => `${item.riskId}: ${item.action}`);

    if (immediatePriorities.length === 0) {
      return ["No urgent or high priority risk actions are currently open."];
    }

    return immediatePriorities;
  }

  private buildManagementRecommendations({
    watchlistReport,
    actionPlan,
  }: {
    watchlistReport: RiskWatchlistReport;
    actionPlan: RiskActionPlan;
  }): string[] {
    const recommendations: string[] = [];

    if (actionPlan.urgentItemCount > 0) {
      recommendations.push(
        "Assign executive ownership for urgent risk actions before the next operating review."
      );
    }

    if (actionPlan.highPriorityItemCount > 0) {
      recommendations.push(
        "Review high priority risk actions during the next management cycle."
      );
    }

    if (watchlistReport.agingRisks.length > 0) {
      recommendations.push(
        "Escalate aging risks that continue to appear across multiple snapshots."
      );
    }

    if (watchlistReport.newlyIntroducedRisks.length > 0) {
      recommendations.push(
        "Validate newly introduced risks before they become recurring control issues."
      );
    }

    if (recommendations.length === 0) {
      return ["Continue routine monitoring and close open actions through normal controls."];
    }

    return recommendations;
  }

  private unique(values: string[]): string[] {
    return [...new Set(values)];
  }
}
