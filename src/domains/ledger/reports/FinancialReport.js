/**
 * FinancialReport
 *
 * Immutable base object for financial reports.
 * Contains report identity only.
 * Reports do not calculate accounting.
 */

export class FinancialReport {
  constructor({ name }) {
    if (!name) {
      throw new Error("FinancialReport requires a name");
    }

    this.name = name;

    Object.freeze(this);
  }
}
