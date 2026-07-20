import { describe, expect, test } from "vitest";
import { Decision } from "../decision";
import { DecisionOutcomeEvaluator } from "../decision-outcome-evaluator";

describe("DecisionOutcomeEvaluator", () => {
  test("evaluates completed decisions", () => {
    const decision = new Decision({
      id: "decision-1",
      context: {},
      recommendation: "Reduce expenses",
      confidence: 0.8,
      priority: "medium",
      status: "completed",
      outcome: {
        savings: 5000,
      },
    });

    const evaluator =
      new DecisionOutcomeEvaluator();

    const result =
      evaluator.evaluate(decision);

    expect(result).toEqual({
      decisionId: "decision-1",
      status: "completed",
      outcome: {
        savings: 5000,
      },
      evaluation: "recorded",
    });

    expect(Object.isFrozen(result)).toBe(true);
  });

  test("rejects non-completed decisions", () => {
    const decision = new Decision({
      id: "decision-1",
      context: {},
      recommendation: "Reduce expenses",
      confidence: 0.8,
      priority: "medium",
    });

    const evaluator =
      new DecisionOutcomeEvaluator();

    expect(() =>
      evaluator.evaluate(decision),
    ).toThrow(
      "Only completed decisions can be evaluated",
    );
  });
});
