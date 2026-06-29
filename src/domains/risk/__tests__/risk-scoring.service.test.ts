import { describe, expect, it } from "vitest";
import { RiskScoringService } from "../risk-scoring.service";

describe("RiskScoringService", () => {
  it("scores negative balances as high risk", () => {
    const risk = new RiskScoringService().scoreAuditFinding({
      accountId: "1000",
      type: "NEGATIVE_BALANCE",
      explanation: "Account has a negative balance.",
    });

    expect(risk.sourceType).toBe("audit");
    expect(risk.sourceFindingType).toBe("NEGATIVE_BALANCE");
    expect(risk.severity).toBe("high");
    expect(risk.score).toBe(80);
    expect(risk.accountId).toBe("1000");
  });

  it("scores large balances as medium risk", () => {
    const risk = new RiskScoringService().scoreAuditFinding({
      accountId: "1100",
      type: "LARGE_BALANCE",
    });

    expect(risk.severity).toBe("medium");
    expect(risk.score).toBe(55);
  });

  it("scores unknown findings as low risk", () => {
    const risk = new RiskScoringService().scoreAuditFinding({
      accountId: "9999",
      type: "SOMETHING_NEW",
    });

    expect(risk.severity).toBe("low");
    expect(risk.score).toBe(20);
  });
});
