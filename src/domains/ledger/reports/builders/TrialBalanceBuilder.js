import { AccountBalanceCollection } from "../AccountBalanceCollection";
import { TrialBalance } from "../TrialBalance";
import { AccountBalanceReportLineBuilder } from "./AccountBalanceReportLineBuilder";
import { ReportSectionBuilder } from "./ReportSectionBuilder";

/**
 * TrialBalanceBuilder
 *
 * Builds an immutable TrialBalance report from calculated account balances.
 * Builders construct report presentation objects.
 * Reports represent the result and do not perform accounting calculations.
 */

export class TrialBalanceBuilder {
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
        "TrialBalanceBuilder requires an AccountBalanceCollection"
      );
    }

    const lines = this.reportLineBuilder.build(accountBalances);

    const sections = [
      this.reportSectionBuilder.build({
        name: "Accounts",
        lines,
      }),
    ];

    return new TrialBalance(accountBalances, { lines, sections });
  }
}
