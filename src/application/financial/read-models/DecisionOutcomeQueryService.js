export class DecisionOutcomeQueryService {
  constructor({
    decisionOutcomeRepository,
  } = {}) {
    if (
      !decisionOutcomeRepository ||
      typeof decisionOutcomeRepository.findByDecisionId !== "function"
    ) {
      throw new Error(
        "DecisionOutcomeQueryService requires a decision outcome repository.",
      );
    }

    this.decisionOutcomeRepository =
      decisionOutcomeRepository;

    Object.freeze(this);
  }

  async findByDecisionId(decisionId) {
    if (
      typeof decisionId !== "string" ||
      decisionId.trim().length === 0
    ) {
      throw new Error("Decision id is required");
    }

    return this.decisionOutcomeRepository.findByDecisionId(
      decisionId,
    );
  }
}

Object.freeze(DecisionOutcomeQueryService);
