import { FinancialDecisionOutcomeApplication } from "./FinancialDecisionOutcomeApplication.js";

describe("FinancialDecisionOutcomeApplication", () => {
  test("evaluates and persists decision outcomes", async () => {
    const evaluation = {
      decisionId: "decision-1",
      evaluation: "recorded",
    };

    const persistedEvaluation = {
      ...evaluation,
      persisted: true,
    };

    const decisionOutcomeEvaluator = {
      evaluate: vi.fn(() => evaluation),
    };

    const decisionOutcomeRepository = {
      save: vi.fn(async () => persistedEvaluation),
    };

    const application =
      new FinancialDecisionOutcomeApplication({
        decisionOutcomeEvaluator,
        decisionOutcomeRepository,
      });

    const decision = {
      id: "decision-1",
    };

    const result =
      await application.evaluateDecisionOutcome(
        decision,
      );

    expect(
      decisionOutcomeEvaluator.evaluate,
    ).toHaveBeenCalledWith(decision);

    expect(
      decisionOutcomeRepository.save,
    ).toHaveBeenCalledWith(evaluation);

    expect(result).toBe(persistedEvaluation);
  });

  test("supports synchronous repository implementations", async () => {
    const evaluation = {
      decisionId: "decision-1",
      evaluation: "recorded",
    };

    const decisionOutcomeEvaluator = {
      evaluate: vi.fn(() => evaluation),
    };

    const decisionOutcomeRepository = {
      save: vi.fn(() => evaluation),
    };

    const application =
      new FinancialDecisionOutcomeApplication({
        decisionOutcomeEvaluator,
        decisionOutcomeRepository,
      });

    await expect(
      application.evaluateDecisionOutcome({
        id: "decision-1",
      }),
    ).resolves.toBe(evaluation);
  });

  test("requires a decision outcome evaluator", () => {
    expect(
      () =>
        new FinancialDecisionOutcomeApplication({
          decisionOutcomeRepository: {
            save: vi.fn(),
          },
        }),
    ).toThrow(
      "FinancialDecisionOutcomeApplication requires a decision outcome evaluator.",
    );
  });

  test("requires a decision outcome repository", () => {
    expect(
      () =>
        new FinancialDecisionOutcomeApplication({
          decisionOutcomeEvaluator: {
            evaluate: vi.fn(),
          },
        }),
    ).toThrow(
      "FinancialDecisionOutcomeApplication requires a decision outcome repository.",
    );
  });
});
