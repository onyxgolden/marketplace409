import { ReportLine } from "./ReportLine";

/**
 * FinancialReport
 *
 * Immutable base object for financial reports.
 * Contains report identity and reusable report lines.
 * Reports do not calculate accounting.
 */

export class FinancialReport {
  constructor({ name, lines = [] }) {
    if (!name) {
      throw new Error("FinancialReport requires a name");
    }

    lines.forEach((line) => {
      if (!(line instanceof ReportLine)) {
        throw new Error("FinancialReport lines must be ReportLine objects");
      }
    });

    this.name = name;
    this._lines = Object.freeze([...lines]);

    Object.freeze(this);
  }

  lines() {
    return this._lines;
  }
}
