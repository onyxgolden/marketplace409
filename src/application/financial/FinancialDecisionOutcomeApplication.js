export class FinancialDecisionOutcomeApplication {
  constructor({
    decisionOutcomeEvaluator,
  }) {
    if (!decisionOutcomeEvaluator) {
      throw new Error(
        "FinancialDecisionOutcomeApplication requires a decision outcome evaluator.",
      );
    }

    this.decisionOutcomeEvaluator =
      decisionOutcomeEvaluator;
  }

  evaluateDecisionOutcome(decision) {
    return this.decisionOutcomeEvaluator.evaluate(
      decision,
    );
  }
}
