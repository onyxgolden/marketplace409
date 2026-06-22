import { AccountBalanceCollection } from "../AccountBalanceCollection";
import { IncomeStatement } from "../IncomeStatement";
import { AccountBalanceReportLineBuilder } from "./AccountBalanceReportLineBuilder";
import { ReportSectionBuilder } from "./ReportSectionBuilder";

/**
 * IncomeStatementBuilder
 *
 * Builds an immutable IncomeStatement report from calculated account balances.
 * Builders construct report presentation objects.
 * Reports represent the result and do not perform accounting calculations.
 */

export class IncomeStatementBuilder {
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
        "IncomeStatementBuilder requires an AccountBalanceCollection"
      );
    }

    const lines = this.reportLineBuilder.build(accountBalances);

    const sections = [
      this.reportSectionBuilder.build({
        name: "Income Statement",
        lines,
      }),
    ];

    return new IncomeStatement(accountBalances, { lines, sections });
  }
}
