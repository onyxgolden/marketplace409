import type { RiskFinding, RiskSeverity } from "./risk.types";

type AuditFinding = {
  accountId?: string;
  type?: string;
  explanation?: string;
  traceSummary?: string;
};

export class RiskScoringService {
  scoreAuditFinding(finding: AuditFinding): RiskFinding {
    const sourceFindingType = finding.type ?? "UNKNOWN";
    const rule = this.ruleFor(sourceFindingType);

    return {
      id: this.buildId(finding),
      accountId: finding.accountId,
      sourceType: "audit",
      sourceFindingType,
      severity: rule.severity,
      score: rule.score,
      confidence: rule.confidence,
      explanation: finding.explanation ?? rule.explanation,
      recommendedAction: rule.recommendedAction,
    };
  }

  private ruleFor(sourceFindingType: string): {
    severity: RiskSeverity;
    score: number;
    confidence: number;
    explanation: string;
    recommendedAction: string;
  } {
    if (sourceFindingType === "NEGATIVE_BALANCE") {
      return {
        severity: "high",
        score: 80,
        confidence: 1,
        explanation: "Negative account balance detected.",
        recommendedAction: "Review cash flow, account classification, and recent postings.",
      };
    }

    if (sourceFindingType === "LARGE_BALANCE") {
      return {
        severity: "medium",
        score: 55,
        confidence: 0.9,
        explanation: "Large account balance detected.",
        recommendedAction: "Verify that the account balance is expected and supported by trace evidence.",
      };
    }

    return {
      severity: "low",
      score: 20,
      confidence: 0.5,
      explanation: "Unclassified audit finding detected.",
      recommendedAction: "Manually review the audit finding if it persists.",
    };
  }

  private buildId(finding: AuditFinding): string {
    return [
      "risk",
      finding.accountId ?? "unknown-account",
      finding.type ?? "UNKNOWN",
    ].join(":");
  }
}
