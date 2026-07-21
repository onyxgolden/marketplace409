export class FinancialDecisionOutcomeApplication {
  constructor({
    decisionOutcomeEvaluator,
    decisionOutcomeRepository,
  }) {
    if (!decisionOutcomeEvaluator) {
      throw new Error(
        "FinancialDecisionOutcomeApplication requires a decision outcome evaluator.",
      );
    }

    if (!decisionOutcomeRepository) {
      throw new Error(
        "FinancialDecisionOutcomeApplication requires a decision outcome repository.",
      );
    }

    this.decisionOutcomeEvaluator =
      decisionOutcomeEvaluator;

    this.decisionOutcomeRepository =
      decisionOutcomeRepository;
  }

  async evaluateDecisionOutcome(decision) {
    const evaluation =
      this.decisionOutcomeEvaluator.evaluate(
        decision,
      );

    return await this.decisionOutcomeRepository.save(
      evaluation,
    );
  }
}
