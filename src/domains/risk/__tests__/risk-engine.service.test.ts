import { describe, expect, it } from "vitest";
import { RiskEngine } from "../risk-engine.service";

describe("RiskEngine", () => {
  it("orchestrates audit finding scoring and aggregation", () => {
    const summary = new RiskEngine().analyze([
      {
        accountId: "1000",
        type: "NEGATIVE_BALANCE",
        explanation: "Account has a negative balance.",
      },
      {
        accountId: "1100",
        type: "LARGE_BALANCE",
      },
    ]);

    expect(summary.findingCount).toBe(2);
    expect(summary.score).toBe(80);
    expect(summary.severity).toBe("high");
    expect(summary.severityCounts).toEqual({
      low: 0,
      medium: 1,
      high: 1,
      critical: 0,
    });
    expect(summary.topRisks.map((risk) => risk.sourceFindingType)).toEqual([
      "NEGATIVE_BALANCE",
      "LARGE_BALANCE",
    ]);
  });

  it("returns a low-risk summary when no audit findings exist", () => {
    const summary = new RiskEngine().analyze([]);

    expect(summary.findingCount).toBe(0);
    expect(summary.score).toBe(0);
    expect(summary.severity).toBe("low");
    expect(summary.topRisks).toEqual([]);
  });
});
