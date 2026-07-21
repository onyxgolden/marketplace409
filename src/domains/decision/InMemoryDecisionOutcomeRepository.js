function assertEvaluation(evaluation) {
  if (
    typeof evaluation !== "object" ||
    evaluation === null ||
    Array.isArray(evaluation)
  ) {
    throw new TypeError(
      "Decision outcome evaluation must be an object",
    );
  }

  if (
    typeof evaluation.decisionId !== "string" ||
    evaluation.decisionId.length === 0
  ) {
    throw new TypeError(
      "Decision outcome evaluation decisionId must be a non-empty string",
    );
  }
}

function assertDecisionId(decisionId) {
  if (
    typeof decisionId !== "string" ||
    decisionId.length === 0
  ) {
    throw new TypeError(
      "Decision id must be a non-empty string",
    );
  }
}

export class InMemoryDecisionOutcomeRepository {
  constructor(initialEvaluations = []) {
    if (!Array.isArray(initialEvaluations)) {
      throw new TypeError(
        "Initial decision outcome evaluations must be an array",
      );
    }

    this.evaluationsByDecisionId = new Map();

    for (const evaluation of initialEvaluations) {
      this.save(evaluation);
    }
  }

  save(evaluation) {
    assertEvaluation(evaluation);

    this.evaluationsByDecisionId.set(
      evaluation.decisionId,
      evaluation,
    );

    return evaluation;
  }

  findByDecisionId(decisionId) {
    assertDecisionId(decisionId);

    return (
      this.evaluationsByDecisionId.get(decisionId) ??
      null
    );
  }
}
