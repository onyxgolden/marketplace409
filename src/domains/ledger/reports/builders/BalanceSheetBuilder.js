import { AccountBalanceCollection } from "../AccountBalanceCollection";
import { BalanceSheet } from "../BalanceSheet";
import { AccountBalanceReportLineBuilder } from "./AccountBalanceReportLineBuilder";
import { ReportSectionBuilder } from "./ReportSectionBuilder";

/**
 * BalanceSheetBuilder
 *
 * Builds an immutable BalanceSheet report from calculated account balances.
 * Builders construct report presentation objects.
 * Reports represent the result and do not perform accounting calculations.
 */

export class BalanceSheetBuilder {
  constructor({
    reportLineBuilder = new AccountBalanceReportLineBuilder(),
    reportSectionBuilder = new ReportSectionBuilder(),
  } = {}) {
    this.reportLineBuilder = reportLineBuilder;
    this.reportSectionBuilder = reportSectionBuilder;

    Object.freeze(this);
  }

  build(accountBalances) {
    if (!(accountBalances instanceof AccountBalanceCollection)) {
      throw new Error(
        "BalanceSheetBuilder requires an AccountBalanceCollection"
      );
    }

    const lines = this.reportLineBuilder.build(accountBalances);

    const sections = [
      this.reportSectionBuilder.build({
        name: "Balance Sheet",
        lines,
      }),
    ];

    return new BalanceSheet(accountBalances, { lines, sections });
  }
}
