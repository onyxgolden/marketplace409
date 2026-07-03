import { ImportWarning } from "./ImportWarning";

export class ImportResult {
  constructor({
    records = [],
    summary,
    reports,
    warnings = [],
    transactionReview = [],
  }) {
    if (!Array.isArray(records)) {
      throw new Error("ImportResult records must be an array");
    }

    if (!summary) {
      throw new Error("ImportResult requires a summary");
    }

    if (!reports) {
      throw new Error("ImportResult requires reports");
    }

    if (!Array.isArray(warnings)) {
      throw new Error("ImportResult warnings must be an array");
    }

    if (!warnings.every((warning) => warning instanceof ImportWarning)) {
      throw new Error(
        "ImportResult warnings must contain only ImportWarning instances"
      );
    }

    if (!Array.isArray(transactionReview)) {
      throw new Error("ImportResult transactionReview must be an array");
    }

    this.records = Object.freeze([...records]);
    this.summary = summary;
    this.reports = reports;
    this.warnings = Object.freeze([...warnings]);
    this.transactionReview = Object.freeze([...transactionReview]);

    Object.freeze(this);
  }

  get recordCount() {
    return this.records.length;
  }

  get warningCount() {
    return this.warnings.length;
  }

  get transactionReviewCount() {
    return this.transactionReview.length;
  }

  toJSON() {
    return {
      recordCount: this.recordCount,
      warningCount: this.warningCount,
      transactionReviewCount: this.transactionReviewCount,
      records: this.records,
      summary: this.summary,
      reports: this.reports,
      warnings: this.warnings,
      transactionReview: this.transactionReview,
    };
  }
}
