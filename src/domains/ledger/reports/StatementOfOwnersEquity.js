import { FinancialReport } from "./FinancialReport";

/**
 * StatementOfOwnersEquity
 *
 * Immutable financial report composed of reusable report sections.
 * Represents changes in owner's equity during a reporting period.
 */

export class StatementOfOwnersEquity extends FinancialReport {
  constructor({ sections = [] } = {}) {
    super({
      name: "Statement of Owner's Equity",
      sections,
      lines: sections.flatMap((section) => section.lines()),
    });

    Object.freeze(this);
  }
}
