import { describe, expect, test } from "vitest";

import {
  DecisionOutcomeReadModelAdapter,
} from "./DecisionOutcomeReadModelAdapter.js";

function buildEvaluation(overrides = {}) {
  return Object.freeze({
    decisionId: "decision-1",
    status: "completed",
    evaluation: Object.freeze({
      result: "recorded",
    }),
    outcome: Object.freeze({
      result: "approved",
    }),
    ...overrides,
  });
}

describe("DecisionOutcomeReadModelAdapter", () => {
  test("requires a decision outcome evaluation", () => {
    const adapter = new DecisionOutcomeReadModelAdapter();

    expect(() => adapter.buildOutcome(null)).toThrow(
      "DecisionOutcomeReadModelAdapter requires a decision outcome evaluation.",
    );
  });

  test("requires the canonical evaluation contract", () => {
    const adapter = new DecisionOutcomeReadModelAdapter();

    expect(() =>
      adapter.buildOutcome({
        status: "completed",
        evaluation: {},
        outcome: {},
      }),
    ).toThrow(
      "Decision outcome evaluation requires a decision id.",
    );

    expect(() =>
      adapter.buildOutcome({
        decisionId: "decision-1",
        evaluation: {},
        outcome: {},
      }),
    ).toThrow(
      "Decision outcome evaluation requires a status.",
    );

    expect(() =>
      adapter.buildOutcome({
        decisionId: "decision-1",
        status: "completed",
        outcome: {},
      }),
    ).toThrow(
      "Decision outcome evaluation requires an evaluation.",
    );

    expect(() =>
      adapter.buildOutcome({
        decisionId: "decision-1",
        status: "completed",
        evaluation: {},
      }),
    ).toThrow(
      "Decision outcome evaluation requires an outcome.",
    );
  });

  test("projects a deterministic decision outcome read model", () => {
    const adapter = new DecisionOutcomeReadModelAdapter();
    const evaluation = buildEvaluation();

    expect(adapter.buildOutcome(evaluation)).toEqual({
      type: "decision-outcome",
      decisionId: "decision-1",
      status: "completed",
      evaluation: evaluation.evaluation,
      outcome: evaluation.outcome,
      metadata: {
        provider: "decision-outcome",
        projectionStatus: "evaluation-backed",
        phase: "17E",
      },
    });
  });

  test("does not invent additional decision data", () => {
    const adapter = new DecisionOutcomeReadModelAdapter();
    const model = adapter.buildOutcome(buildEvaluation());

    expect(model).not.toHaveProperty("createdAt");
    expect(model).not.toHaveProperty("updatedAt");
    expect(model).not.toHaveProperty("score");
    expect(model).not.toHaveProperty("analytics");
    expect(model).not.toHaveProperty("persistenceId");
  });

  test("returns an immutable decision outcome projection", () => {
    const adapter = new DecisionOutcomeReadModelAdapter();

    const model = adapter.buildOutcome(
      buildEvaluation({
        evaluation: {
          result: "recorded",
          detail: {
            source: "decision-evaluator",
          },
        },
        outcome: {
          result: "approved",
          detail: {
            reason: "criteria-satisfied",
          },
        },
      }),
    );

    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.evaluation)).toBe(true);
    expect(Object.isFrozen(model.evaluation.detail)).toBe(true);
    expect(Object.isFrozen(model.outcome)).toBe(true);
    expect(Object.isFrozen(model.outcome.detail)).toBe(true);
    expect(Object.isFrozen(model.metadata)).toBe(true);
  });
});
