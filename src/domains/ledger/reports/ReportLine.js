/**
 * ReportLine
 *
 * Immutable line item for a financial report.
 * Contains presentation-ready report values only.
 * It does not calculate accounting.
 */

export class ReportLine {
  constructor({ label, amount = 0 }) {
    if (!label) {
      throw new Error("ReportLine requires a label");
    }

    this.label = label;
    this.amount = amount;

    Object.freeze(this);
  }
}
