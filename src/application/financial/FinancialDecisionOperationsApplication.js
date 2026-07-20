export class FinancialDecisionOperationsApplication {
  constructor({
    financialOperationsApplication,
  }) {
    if (!financialOperationsApplication) {
      throw new Error(
        "FinancialDecisionOperationsApplication requires a financial operations application.",
      );
    }

    this.financialOperationsApplication =
      financialOperationsApplication;
  }

  async buildOperations({
    decisions = [],
  } = {}) {
    return Object.freeze(
      await this.financialOperationsApplication
        .buildFinancialOperationsFromDecisions(
          decisions,
        ),
    );
  }
}

Object.freeze(FinancialDecisionOperationsApplication);
