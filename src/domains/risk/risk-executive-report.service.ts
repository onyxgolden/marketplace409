import type { RiskActionPlan } from "./risk-action-plan.service";
import type { RiskExecutiveNarrative } from "./risk-executive-narrative.service";
import type { RiskExecutiveScorecard } from "./risk-executive-scorecard.service";
import type { RiskWatchlistReport } from "./risk-watchlist.service";

export type RiskExecutiveReport = {
  generatedAt: string;
  scorecard: RiskExecutiveScorecard;
  narrative: RiskExecutiveNarrative;
  actionPlan: RiskActionPlan;
  watchlist: RiskWatchlistReport;
};

export class RiskExecutiveReportService {
  build({
    generatedAt,
    scorecard,
    narrative,
    actionPlan,
    watchlist,
  }: {
    generatedAt: string;
    scorecard: RiskExecutiveScorecard;
    narrative: RiskExecutiveNarrative;
    actionPlan: RiskActionPlan;
    watchlist: RiskWatchlistReport;
  }): RiskExecutiveReport {
    return {
      generatedAt,
      scorecard,
      narrative,
      actionPlan,
      watchlist,
    };
  }
}
