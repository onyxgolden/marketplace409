export class FinancialOperation {
  constructor({
    id,
    title,
    category,
    priority = "monitor",
    status = "recommended",
    rationale,
  }) {
    if (!id) {
      throw new Error("FinancialOperation requires an id.");
    }

    if (!title) {
      throw new Error("FinancialOperation requires a title.");
    }

    if (!category) {
      throw new Error("FinancialOperation requires a category.");
    }

    if (!rationale) {
      throw new Error("FinancialOperation requires a rationale.");
    }

    this.id = id;
    this.title = title;
    this.category = category;
    this.priority = priority;
    this.status = status;
    this.rationale = rationale;

    Object.freeze(this);
  }
}

Object.freeze(FinancialOperation);
