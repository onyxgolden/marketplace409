import { FinancialReport } from "./FinancialReport";

/**
 * CashFlowStatement
 *
 * Immutable financial report composed of reusable report sections.
 * Represents operating, investing, and financing activities.
 */

export class CashFlowStatement extends FinancialReport {
  constructor({ sections = [] } = {}) {
    super({
      name: "Cash Flow Statement",
      sections,
      lines: sections.flatMap((section) => section.lines()),
    });

    Object.freeze(this);
  }
}
