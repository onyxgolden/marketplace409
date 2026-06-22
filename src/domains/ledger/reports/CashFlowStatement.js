import { FinancialReport } from "./FinancialReport.js";
import { ReportSection } from "./sections/ReportSection.js";

/**
 * CashFlowStatement
 *
 * Immutable cash flow statement composed of report sections.
 * Sections contain lines; CashFlowStatement exposes a flattened view.
 */

export class CashFlowStatement extends FinancialReport {
  constructor({ sections = [] } = {}) {
    if (!Array.isArray(sections)) {
      throw new Error("CashFlowStatement requires sections array");
    }

    sections.forEach((section) => {
      if (!(section instanceof ReportSection)) {
        throw new Error("CashFlowStatement sections must be ReportSection objects");
      }
    });

    const lines = sections.flatMap((section) => section.lines());

    super({
      name: "Cash Flow Statement",
      lines,
      sections,
    });

    this._sections = Object.freeze([...sections]);

    Object.freeze(this);
  }

  sections() {
    return this._sections;
  }
}
