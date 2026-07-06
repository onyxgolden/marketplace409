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

    this.financialIntelligenceApplication = financialIntelligenceApplication;
    this.financialOperationsService = financialOperationsService;
  }

  buildFinancialOperations() {
    const intelligence =
      this.financialIntelligenceApplication.buildFinancialIntelligence();

    const priority = intelligence.planningAssistance?.priority || "monitor";
    const focus =
      intelligence.planningAssistance?.suggestedFocus || "financial controls";
    const operations =
      this.financialOperationsService.buildOperations(intelligence);

    return Object.freeze({
      type: "financial-operations",
      priority,
      focus,
      actions: operations.toArray(),
      source: Object.freeze({
        ...(intelligence.source || {}),
        derivedFrom: "financial-intelligence",
      }),
    });
  }
}

Object.freeze(FinancialOperationsApplication);
