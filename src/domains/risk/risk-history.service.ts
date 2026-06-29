import type { OverallRiskSummary, RiskFinding, RiskSeverity } from "./risk.types";

export type RiskSnapshot = {
  timestamp: string;
  overallScore: number;
  severity: RiskSeverity;
  findingCount: number;
  topDrivers: RiskFinding[];
};

export type RiskTrendDirection = "improving" | "worsening" | "stable";

export type RiskTrend = {
  direction: RiskTrendDirection;
  scoreChange: number;
  currentScore: number;
  previousScore: number | null;
  currentSeverity: RiskSeverity;
  previousSeverity: RiskSeverity | null;
};

export class RiskHistoryService {
  createSnapshot({
    summary,
    timestamp = new Date().toISOString(),
  }: {
    summary: OverallRiskSummary;
    timestamp?: string;
  }): RiskSnapshot {
    return {
      timestamp,
      overallScore: summary.score,
      severity: summary.severity,
      findingCount: summary.findingCount,
      topDrivers: summary.topRisks,
    };
  }

  compare(latest: RiskSnapshot, previous?: RiskSnapshot | null): RiskTrend {
    if (!previous) {
      return {
        direction: "stable",
        scoreChange: 0,
        currentScore: latest.overallScore,
        previousScore: null,
        currentSeverity: latest.severity,
        previousSeverity: null,
      };
    }

    const scoreChange = latest.overallScore - previous.overallScore;

    return {
      direction: this.directionFor(scoreChange),
      scoreChange,
      currentScore: latest.overallScore,
      previousScore: previous.overallScore,
      currentSeverity: latest.severity,
      previousSeverity: previous.severity,
    };
  }

  private directionFor(scoreChange: number): RiskTrendDirection {
    if (scoreChange < 0) return "improving";
    if (scoreChange > 0) return "worsening";
    return "stable";
  }
}
