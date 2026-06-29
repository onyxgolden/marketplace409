import type { OverallRiskSummary, RiskFinding } from "./risk.types";

export class RiskAggregationService {
  summarize(findings: RiskFinding[]): OverallRiskSummary {
    return {
      severity: "low",
      score: 0,
      findingCount: findings.length,
      topRisks: findings.slice(0, 3),
    };
  }
}
