import { FinancialDecisionApplication } from "./FinancialDecisionApplication.js";

describe("FinancialDecisionApplication", () => {
  function buildDecisionApplication() {
    return {
      createDecision: vi.fn((input) => ({
        type: "decision",
        decision: input,
        status: "open",
      })),
    };
  }

  test("creates decisions from financial recommendations", () => {
    const decisionApplication = buildDecisionApplication();

    const application = new FinancialDecisionApplication({
      decisionApplication,
    });

    const result = application.buildDecisions({
      recommendations: [
        "Review pricing, margins, and operating costs.",
        "Prioritize cash reserves.",
      ],
      kpis: {
        profit: 30000,
        cash: 25000,
      },
      health: {
        label: "Healthy",
      },
    });

    expect(result.type).toBe(
      "financial-decisions",
    );

    expect(result.decisions).toHaveLength(2);

    expect(result.decisions[0].decision).toMatchObject({
      id: "financial-decision-1",
      recommendation:
        "Review pricing, margins, and operating costs.",
      confidence: 0.8,
      priority: "medium",
    });

    expect(
      decisionApplication.createDecision,
    ).toHaveBeenCalledTimes(2);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.decisions)).toBe(true);
  });

  test("requires a decision application", () => {
    expect(
      () =>
        new FinancialDecisionApplication({}),
    ).toThrow(
      "FinancialDecisionApplication requires a decision application.",
    );
  });
});
