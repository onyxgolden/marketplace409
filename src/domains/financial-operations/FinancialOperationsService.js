import {
  FinancialOperation,
  FinancialOperationCollection,
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
}

Object.freeze(FinancialOperationsService);
