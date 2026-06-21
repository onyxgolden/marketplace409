/**
 * ReportLine
 *
 * Immutable line item for a financial report.
 * Contains presentation-ready report values only.
 * It does not calculate accounting.
 */

export class ReportLine {
  constructor({ label, amount = 0 }) {
    if (!label || label.trim() === "") {
      throw new Error("ReportLine requires a label");
    }

    if (typeof amount !== "number" || !Number.isFinite(amount)) {
      throw new Error("ReportLine amount must be a finite number");
    }

    this.label = label;
    this.amount = amount;

    Object.freeze(this);
  }
}
