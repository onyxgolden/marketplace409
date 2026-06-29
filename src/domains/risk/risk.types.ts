export type RiskSeverity = "low" | "medium" | "high" | "critical";

export type RiskFinding = {
  id: string;
  accountId?: string;
  sourceType: string;
  sourceFindingType: string;
  severity: RiskSeverity;
  score: number;
  confidence: number;
  explanation: string;
  recommendedAction: string;
};

export type OverallRiskSummary = {
  severity: RiskSeverity;
  score: number;
  findingCount: number;
  topRisks: RiskFinding[];
};
