function assertObject(value, message) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(message);
  }
}

function assertNonEmptyString(value, message) {
  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
    throw new Error(message);
  }
}

function deepFreeze(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  Object.freeze(value);

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }

  return value;
}

export class DecisionOutcomeReadModelAdapter {
  buildOutcome(evaluation) {
    assertObject(
      evaluation,
      "DecisionOutcomeReadModelAdapter requires a decision outcome evaluation.",
    );

    assertNonEmptyString(
      evaluation.decisionId,
      "Decision outcome evaluation requires a decision id.",
    );

    assertNonEmptyString(
      evaluation.status,
      "Decision outcome evaluation requires a status.",
    );

    if (!Object.hasOwn(evaluation, "evaluation")) {
      throw new Error(
        "Decision outcome evaluation requires an evaluation.",
      );
    }

    if (!Object.hasOwn(evaluation, "outcome")) {
      throw new Error(
        "Decision outcome evaluation requires an outcome.",
      );
    }

    return deepFreeze({
      type: "decision-outcome",
      decisionId: evaluation.decisionId,
      status: evaluation.status,
      evaluation: evaluation.evaluation,
      outcome: evaluation.outcome,
      metadata: {
        provider: "decision-outcome",
        projectionStatus: "evaluation-backed",
        phase: "17E",
      },
    });
  }
}

export const decisionOutcomeReadModelAdapter =
  new DecisionOutcomeReadModelAdapter();
