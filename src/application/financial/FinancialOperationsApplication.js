export class FinancialOperationsApplication {
  constructor({ financialIntelligenceApplication }) {
    if (!financialIntelligenceApplication) {
      throw new Error(
        "FinancialOperationsApplication requires a financial intelligence application.",
      );
    }

    this.financialIntelligenceApplication = financialIntelligenceApplication;
  }

  buildFinancialOperations() {
    const intelligence =
      this.financialIntelligenceApplication.buildFinancialIntelligence();

    const priority = intelligence.planningAssistance?.priority || "monitor";
    const focus =
      intelligence.planningAssistance?.suggestedFocus || "financial controls";

    const actions = (intelligence.recommendations || []).map(
      (recommendation, index) =>
        Object.freeze({
          id: `financial-operation-${index + 1}`,
          title: recommendation,
          category: focus,
          priority,
          status: "recommended",
          rationale: "Derived from deterministic financial intelligence.",
        }),
    );

    return Object.freeze({
      type: "financial-operations",
      priority,
      focus,
      actions: Object.freeze(actions),
      source: Object.freeze({
        ...(intelligence.source || {}),
        derivedFrom: "financial-intelligence",
      }),
    });
  }
}

Object.freeze(FinancialOperationsApplication);
