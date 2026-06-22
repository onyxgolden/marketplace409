import { AccountBalanceCollection } from "./AccountBalanceCollection.js";
import { FinancialReport } from "./FinancialReport.js";
import { ReportLine } from "./ReportLine.js";
import { ReportSection } from "./sections/ReportSection.js";

/**
 * TrialBalance
 *
 * Immutable representation of a trial balance.
 *
 * Supports two data sources:
 * 1. AccountBalanceCollection (legacy + default)
 * 2. Snapshot (rollup-optimized path)
 *
 * Reports represent results. Builders construct report presentation.
 */

export class TrialBalance extends FinancialReport {
  constructor(
    accountBalances,
    { lines = null, sections = null, snapshot = null } = {}
  ) {
    if (!(accountBalances instanceof AccountBalanceCollection)) {
      throw new Error(
        "TrialBalance requires an AccountBalanceCollection"
      );
    }

    let reportLines;

    if (snapshot) {
      const entries = snapshot.entries();

      reportLines = entries.map(([accountId, money]) => {
        return new ReportLine({
          label: accountId,
          amount: money.amount,
        });
      });
    } else {
      reportLines = accountBalances.all().map(
        (accountBalance) =>
          new ReportLine({
            label: accountBalance.accountId,
            amount: accountBalance.balance,
          })
      );
    }

    const finalLines = lines || reportLines;

    const reportSections =
      sections || [
        new ReportSection({
          name: "Accounts",
          lines: finalLines,
        }),
      ];

    super({
      name: "Trial Balance",
      lines: finalLines,
      sections: reportSections,
    });

    this.accountBalances = accountBalances;

    Object.freeze(this);
  }

  accounts() {
    return this.accountBalances.all();
  }

  totalBalance() {
    return this.accountBalances.totalBalance();
  }

  isBalanced() {
    return this.totalBalance() === 0;
  }
}
