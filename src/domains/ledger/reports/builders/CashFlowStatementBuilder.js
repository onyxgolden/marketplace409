import { CashFlowStatement } from "../CashFlowStatement.js";
import { ReportLine } from "../ReportLine.js";
import { ReportSectionBuilder } from "./ReportSectionBuilder.js";

/**
 * CashFlowStatementBuilder
 *
 * Builds an immutable CashFlowStatement from presentation-ready
 * cash flow activity lines.
 *
 * Cash flow statements are naturally section-oriented:
 * operating, investing, and financing activities.
 *
 * This builder constructs report sections.
 * It does not calculate accounting.
 */

export class CashFlowStatementBuilder {
  constructor({
    reportSectionBuilder = new ReportSectionBuilder(),
  } = {}) {
    this.reportSectionBuilder = reportSectionBuilder;

    Object.freeze(this);
  }

  build({
    operatingActivities = [],
    investingActivities = [],
    financingActivities = [],
  } = {}) {
    this.#validateLines("operatingActivities", operatingActivities);
    this.#validateLines("investingActivities", investingActivities);
    this.#validateLines("financingActivities", financingActivities);

    const sections = [
      this.reportSectionBuilder.build({
        name: "Operating Activities",
        lines: operatingActivities,
      }),
      this.reportSectionBuilder.build({
        name: "Investing Activities",
        lines: investingActivities,
      }),
      this.reportSectionBuilder.build({
        name: "Financing Activities",
        lines: financingActivities,
      }),
    ];

    return new CashFlowStatement({ sections });
  }

  #validateLines(name, lines) {
    lines.forEach((line) => {
      if (!(line instanceof ReportLine)) {
        throw new Error(
          `CashFlowStatementBuilder ${name} must contain ReportLine objects`
        );
      }
    });
  }
}
