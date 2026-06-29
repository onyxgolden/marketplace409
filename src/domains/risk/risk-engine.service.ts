import { RiskAggregationService } from "./risk-aggregation.service";
import { RiskScoringService } from "./risk-scoring.service";
import type { OverallRiskSummary } from "./risk.types";

type AuditFinding = {
  accountId?: string;
  type?: string;
  explanation?: string;
  traceSummary?: string;
};

export class RiskEngine {
  private readonly scoring: RiskScoringService;
  private readonly aggregation: RiskAggregationService;

  constructor({
    scoring = new RiskScoringService(),
    aggregation = new RiskAggregationService(),
  }: {
    scoring?: RiskScoringService;
    aggregation?: RiskAggregationService;
  } = {}) {
    this.scoring = scoring;
    this.aggregation = aggregation;
  }

  analyze(auditFindings: AuditFinding[] = []): OverallRiskSummary {
    const scoredFindings = auditFindings.map((finding) =>
      this.scoring.scoreAuditFinding(finding)
    );

    return this.aggregation.summarize(scoredFindings);
  }
}
