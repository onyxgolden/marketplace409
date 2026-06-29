import type {
  OverallRiskSummary,
  RiskFinding,
  RiskSeverity,
  RiskSeverityCounts,
} from "./risk.types";

export class RiskAggregationService {
  summarize(findings: RiskFinding[]): OverallRiskSummary {
    const sortedFindings = [...findings].sort((a, b) => b.score - a.score);
    const score = sortedFindings[0]?.score ?? 0;

    return {
      severity: this.severityForScore(score),
      score,
      findingCount: findings.length,
      severityCounts: this.countBySeverity(findings),
      topRisks: sortedFindings.slice(0, 3),
    };
  }

  private severityForScore(score: number): RiskSeverity {
    if (score >= 90) return "critical";
    if (score >= 70) return "high";
    if (score >= 40) return "medium";
    return "low";
  }

  private countBySeverity(findings: RiskFinding[]): RiskSeverityCounts {
    return findings.reduce<RiskSeverityCounts>(
      (counts, finding) => {
        counts[finding.severity] += 1;
        return counts;
      },
      {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      }
    );
  }
}
