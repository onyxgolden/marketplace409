import { FinancialDecisionOutcomeApplication } from "./FinancialDecisionOutcomeApplication.js";

describe("FinancialDecisionOutcomeApplication", () => {
  test("evaluates decision outcomes through the evaluator", () => {
    const decisionOutcomeEvaluator = {
      evaluate: vi.fn(() => ({
        decisionId: "decision-1",
        evaluation: "recorded",
      })),
    };

    const application =
      new FinancialDecisionOutcomeApplication({
        decisionOutcomeEvaluator,
      });

    const decision = {
      id: "decision-1",
    };

    const result =
      application.evaluateDecisionOutcome(
        decision,
      );

    expect(result).toEqual({
      decisionId: "decision-1",
      evaluation: "recorded",
    });

    expect(
      decisionOutcomeEvaluator.evaluate,
    ).toHaveBeenCalledWith(decision);
  });

  test("requires a decision outcome evaluator", () => {
    expect(
      () =>
        new FinancialDecisionOutcomeApplication({}),
    ).toThrow(
      "FinancialDecisionOutcomeApplication requires a decision outcome evaluator.",
    );
  });
});
