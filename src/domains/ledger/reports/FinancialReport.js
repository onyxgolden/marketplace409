import { ReportLine } from "./ReportLine.js";
import { ReportSection } from "./sections/ReportSection.js";

/**
 * FinancialReport
 *
 * Immutable base object for financial reports.
 * Contains report identity, reusable report lines, and reusable report sections.
 * Optionally carries source AccountBalanceCollection for audit-grade validation.
 * Reports do not calculate accounting.
 */

export class FinancialReport {
  constructor({
    name,
    lines = [],
    sections = [],
    accountBalances = null,
  }) {
    if (!name) {
      throw new Error("FinancialReport requires a name");
    }

    lines.forEach((line) => {
      if (!(line instanceof ReportLine)) {
        throw new Error("FinancialReport lines must be ReportLine objects");
      }
    });

    sections.forEach((section) => {
      if (!(section instanceof ReportSection)) {
        throw new Error(
          "FinancialReport sections must be ReportSection objects"
        );
      }
    });

    if (
      accountBalances !== null &&
      accountBalances !== undefined &&
      accountBalances.constructor?.name !== "AccountBalanceCollection"
    ) {
      throw new Error(
        "FinancialReport accountBalances must be AccountBalanceCollection or null"
      );
    }

    this.name = name;
    this._lines = Object.freeze([...lines]);
    this._sections = Object.freeze([...sections]);
    this.accountBalances = accountBalances;

    if (this.constructor === FinancialReport) {
      Object.freeze(this);
    }
  }

  lines() {
    return this._lines;
  }

  sections() {
    return this._sections;
  }
}
