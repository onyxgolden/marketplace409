import { FinancialOperationCollection } from "./FinancialOperationCollection.js";

export class FinancialOperationPlan {
  constructor({
    priority = "monitor",
    focus = "financial controls",
    actions = FinancialOperationCollection.empty(),
    source = {},
  } = {}) {
    this.type = "financial-operations";
    this.priority = priority;
    this.focus = focus;
    this.actions = actions;
    this.source = Object.freeze({
      ...source,
    });

    Object.freeze(this);
  }

  toResponse() {
    return Object.freeze({
      type: this.type,
      priority: this.priority,
      focus: this.focus,
      actions: this.actions.toArray(),
      source: this.source,
    });
  }
}

Object.freeze(FinancialOperationPlan);
