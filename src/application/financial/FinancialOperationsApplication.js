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
}

Object.freeze(FinancialOperationsApplication);
