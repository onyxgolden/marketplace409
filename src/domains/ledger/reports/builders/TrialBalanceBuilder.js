import { AccountBalanceCollection } from "../AccountBalanceCollection";
import { ReportSection } from "../sections/ReportSection";
import { TrialBalance } from "../TrialBalance";
import { AccountBalanceReportLineBuilder } from "./AccountBalanceReportLineBuilder";

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
  } = {}) {
    this.reportLineBuilder = reportLineBuilder;

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
      new ReportSection({
        name: "Accounts",
        lines,
      }),
    ];

    return new TrialBalance(accountBalances, { lines, sections });
  }
}
