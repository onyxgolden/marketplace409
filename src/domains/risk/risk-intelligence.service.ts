import type { OverallRiskSummary, RiskFinding, RiskSeverity } from "./risk.types";

export type RiskAssessment = {
  summary: string;
  primaryDrivers: RiskFinding[];
  recommendations: string[];
  trendIndicators: string[];
};

export class RiskIntelligenceService {
  assess(summary: OverallRiskSummary): RiskAssessment {
    const primaryDrivers = this.primaryDrivers(summary);

    return {
      summary: this.executiveSummary(summary),
      primaryDrivers,
      recommendations: this.recommendations(primaryDrivers),
      trendIndicators: this.trendIndicators(summary),
    };
  }

  private executiveSummary(summary: OverallRiskSummary): string {
    if (summary.findingCount === 0) {
      return "No active risk findings were detected in the current ledger snapshot.";
    }

    return [
      `Overall risk is ${summary.severity} with a score of ${summary.score}.`,
      `${summary.findingCount} finding(s) require review.`,
      `Primary concern: ${this.labelFor(summary.severity)}.`,
    ].join(" ");
  }

  private primaryDrivers(summary: OverallRiskSummary): RiskFinding[] {
    return summary.topRisks.filter((risk) => risk.score === summary.score);
  }

  private recommendations(primaryDrivers: RiskFinding[]): string[] {
    const actions = primaryDrivers.map((risk) => risk.recommendedAction);

    return [...new Set(actions)];
  }

  private trendIndicators(summary: OverallRiskSummary): string[] {
    const indicators: string[] = [];

    if (summary.severityCounts.critical > 0) {
      indicators.push("Critical findings are present and should be reviewed immediately.");
    }

    if (summary.severityCounts.high > 0) {
      indicators.push("High-severity findings are driving the current risk posture.");
    }

    if (summary.findingCount === 0) {
      indicators.push("No current finding trend is available.");
    }

    return indicators;
  }

  private labelFor(severity: RiskSeverity): string {
    if (severity === "critical") return "critical exposure";
    if (severity === "high") return "high-risk activity";
    if (severity === "medium") return "moderate-risk activity";
    return "low-risk activity";
  }
}
