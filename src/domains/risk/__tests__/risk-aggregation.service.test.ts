import { describe, expect, it } from "vitest";
import { RiskAggregationService } from "../risk-aggregation.service";
import type { RiskFinding } from "../risk.types";

describe("RiskAggregationService", () => {
  it("summarizes risk findings", () => {
    const findings: RiskFinding[] = [
      {
        id: "risk-1",
        accountId: "1000",
        sourceType: "audit",
        sourceFindingType: "LARGE_BALANCE",
        severity: "high",
        score: 80,
        confidence: 1,
        explanation: "Large balance detected.",
        recommendedAction: "Review account activity.",
      },
    ];

    const summary = new RiskAggregationService().summarize(findings);

    expect(summary.findingCount).toBe(1);
    expect(summary.topRisks).toHaveLength(1);
  });
});
