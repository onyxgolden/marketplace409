import {
  RiskActionPlanService,
  type RiskActionPlan,
} from "./risk-action-plan.service";
import {
  RiskExecutiveNarrativeService,
  type RiskExecutiveNarrative,
} from "./risk-executive-narrative.service";
import {
  RiskExecutiveReportService,
  type RiskExecutiveReport,
} from "./risk-executive-report.service";
import {
  RiskExecutiveScorecardService,
  type RiskExecutiveScorecard,
} from "./risk-executive-scorecard.service";
import type { RiskWatchlistReport } from "./risk-watchlist.service";

export type RiskExecutiveReportOrchestratorResult = {
  report: RiskExecutiveReport;
  actionPlan: RiskActionPlan;
  narrative: RiskExecutiveNarrative;
  scorecard: RiskExecutiveScorecard;
};

export class RiskExecutiveReportOrchestrator {
  private readonly actionPlanService = new RiskActionPlanService();
  private readonly narrativeService = new RiskExecutiveNarrativeService();
  private readonly scorecardService = new RiskExecutiveScorecardService();
  private readonly reportService = new RiskExecutiveReportService();

  build({
    generatedAt,
    watchlistReport,
  }: {
    generatedAt: string;
    watchlistReport: RiskWatchlistReport;
  }): RiskExecutiveReportOrchestratorResult {
    const actionPlan = this.actionPlanService.build(watchlistReport);
    const narrative = this.narrativeService.build({
      watchlistReport,
      actionPlan,
    });
    const scorecard = this.scorecardService.build({
      narrative,
      actionPlan,
      watchlistReport,
    });

    const report = this.reportService.build({
      generatedAt,
      scorecard,
      narrative,
      actionPlan,
      watchlist: watchlistReport,
    });

    return {
      report,
      actionPlan,
      narrative,
      scorecard,
    };
  }
}
