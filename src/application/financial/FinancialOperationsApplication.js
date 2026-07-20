export class FinancialOperationsApplication {
  constructor({
    financialIntelligenceApplication,
    financialOperationsService,
  }) {
    if (!financialIntelligenceApplication) {
      throw new Error(
        "FinancialOperationsApplication requires a financial intelligence application.",
      );
    }

    if (!financialOperationsService) {
      throw new Error(
        "FinancialOperationsApplication requires a financial operations service.",
      );
    }

    this.financialIntelligenceApplication =
      financialIntelligenceApplication;
    this.financialOperationsService = financialOperationsService;
  }

  async buildFinancialOperations() {
    const intelligence =
      await this.financialIntelligenceApplication.buildFinancialIntelligence();

    const plan =
      this.financialOperationsService.buildOperationPlan(intelligence);

    return plan.toResponse();
  }

  async buildFinancialOperationsFromDecisions(
    decisions = [],
  ) {
    const acceptedDecisions =
      decisions.filter(
        (decision) =>
          decision.status === "accepted",
      );

    const intelligence = {
      type: "financial-intelligence",
      recommendations:
        acceptedDecisions.map(
          (decision) =>
            decision.selectedAction ||
            decision.recommendation,
        ),
      planningAssistance: {
        priority: "optimize",
        suggestedFocus: "decision execution",
        summary:
          "Execute accepted financial decisions.",
      },
      source: {
        derivedFrom: "financial-decisions",
      },
    };

    const plan =
      this.financialOperationsService.buildOperationPlan(
        intelligence,
      );

    return plan.toResponse();
  }
}

Object.freeze(FinancialOperationsApplication);
