import { FinancialReport } from "./FinancialReport.js";
import { ReportSection } from "./sections/ReportSection.js";
import { ReportLine } from "./ReportLine.js";

/**
 * CashFlowStatement
 *
 * Immutable cash flow statement composed of report sections.
 * Supports both legacy section input and snapshot-based generation.
 */

export class CashFlowStatement extends FinancialReport {
  constructor({ sections = null, snapshot = null } = {}) {
    let finalSections;

    if (snapshot) {
      const entries = snapshot.entries();

      const lines = entries.map(([accountId, money]) => {
        return new ReportLine({
          label: accountId,
          amount: money.amount,
        });
      });

      finalSections = [
        new ReportSection({
          name: "Cash Flow",
          lines,
        }),
      ];
    } else {
      if (!Array.isArray(sections)) {
        throw new Error("CashFlowStatement requires sections array");
      }

      sections.forEach((section) => {
        if (!(section instanceof ReportSection)) {
          throw new Error(
            "CashFlowStatement sections must be ReportSection objects"
          );
        }
      });

      finalSections = sections;
    }

    const lines = finalSections.flatMap((section) => section.lines());

    super({
      name: "Cash Flow Statement",
      lines,
      sections: finalSections,
    });

    this._sections = Object.freeze([...finalSections]);

    Object.freeze(this);
  }

  sections() {
    return this._sections;
  }
}
