import { describe, expect, it } from "vitest";
import { RiskAggregationService } from "../risk-aggregation.service";
import type { RiskFinding } from "../risk.types";

function risk(overrides: Partial<RiskFinding>): RiskFinding {
  return {
    id: "risk-default",
    accountId: "1000",
    sourceType: "audit",
    sourceFindingType: "UNKNOWN",
    severity: "low",
    score: 20,
    confidence: 1,
    explanation: "Risk detected.",
    recommendedAction: "Review risk.",
    ...overrides,
  };
}

describe("RiskAggregationService", () => {
  it("summarizes empty findings as low risk", () => {
    const summary = new RiskAggregationService().summarize([]);

    expect(summary.findingCount).toBe(0);
    expect(summary.score).toBe(0);
    expect(summary.severity).toBe("low");
    expect(summary.topRisks).toEqual([]);
    expect(summary.severityCounts).toEqual({
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    });
  });

  it("uses the highest risk score as the overall score", () => {
    const summary = new RiskAggregationService().summarize([
      risk({ id: "low", severity: "low", score: 20 }),
      risk({ id: "high", severity: "high", score: 80 }),
      risk({ id: "medium", severity: "medium", score: 55 }),
    ]);

    expect(summary.score).toBe(80);
    expect(summary.severity).toBe("high");
  });

  it("sorts top risks by score descending", () => {
    const summary = new RiskAggregationService().summarize([
      risk({ id: "risk-1", score: 20 }),
      risk({ id: "risk-2", score: 80 }),
      risk({ id: "risk-3", score: 55 }),
      risk({ id: "risk-4", score: 95 }),
    ]);

    expect(summary.topRisks.map((finding) => finding.id)).toEqual([
      "risk-4",
      "risk-2",
      "risk-3",
    ]);
  });

  it("counts findings by severity", () => {
    const summary = new RiskAggregationService().summarize([
      risk({ id: "low-1", severity: "low" }),
      risk({ id: "medium-1", severity: "medium" }),
      risk({ id: "high-1", severity: "high" }),
      risk({ id: "critical-1", severity: "critical" }),
      risk({ id: "critical-2", severity: "critical" }),
    ]);

    expect(summary.severityCounts).toEqual({
      low: 1,
      medium: 1,
      high: 1,
      critical: 2,
    });
  });
});
