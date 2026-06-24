import { ImportWarning } from "./ImportWarning";

export class ImportResult {
  constructor({
    records = [],
    summary,
    reports,
    warnings = [],
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

    this.records = Object.freeze([...records]);
    this.summary = summary;
    this.reports = reports;
    this.warnings = Object.freeze([...warnings]);

    Object.freeze(this);
  }

  get recordCount() {
    return this.records.length;
  }

  get warningCount() {
    return this.warnings.length;
  }

  toJSON() {
    return {
      recordCount: this.recordCount,
      warningCount: this.warningCount,
      records: this.records,
      summary: this.summary,
      reports: this.reports,
      warnings: this.warnings,
    };
  }
}
