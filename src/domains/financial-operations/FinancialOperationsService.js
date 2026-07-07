import {
  FinancialOperation,
  FinancialOperationCollection,
  FinancialOperationPlan,
} from "./index.js";

export class FinancialOperationsService {
  buildOperations(intelligence = {}) {
    const priority = intelligence.planningAssistance?.priority || "monitor";
    const category =
      intelligence.planningAssistance?.suggestedFocus || "financial controls";

    const operations = (intelligence.recommendations || []).map(
      (recommendation, index) =>
        new FinancialOperation({
          id: `financial-operation-${index + 1}`,
          title: recommendation,
          category,
          priority,
          status: "recommended",
          rationale: "Derived from deterministic financial intelligence.",
        }),
    );

    return new FinancialOperationCollection(operations);
  }

  buildOperationPlan(intelligence = {}) {
    const priority = intelligence.planningAssistance?.priority || "monitor";
    const focus =
      intelligence.planningAssistance?.suggestedFocus || "financial controls";
    const summary =
      intelligence.planningAssistance?.summary ||
      "Maintain current financial controls.";
    const actions = this.buildOperations(intelligence);

    return new FinancialOperationPlan({
      priority,
      focus,
      summary,
      actions,
      source: Object.freeze({
        ...(intelligence.source || {}),
        derivedFrom: "financial-intelligence",
      }),
    });
  }
}

Object.freeze(FinancialOperationsService);
