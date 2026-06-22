import { AccountBalanceCollection } from "./AccountBalanceCollection";
import { FinancialReport } from "./FinancialReport";
import { ReportLine } from "./ReportLine";
import { ReportSection } from "./sections/ReportSection";

/**
 * TrialBalance
 *
 * Immutable representation of a trial balance.
 *
 * TrialBalance may receive already-built report lines and sections
 * from a builder. It keeps backward-compatible construction from
 * AccountBalanceCollection during the builder migration.
 *
 * Reports represent results. Builders construct report presentation.
 */

export class TrialBalance extends FinancialReport {
  constructor(accountBalances, { lines = null, sections = null } = {}) {
    if (!(accountBalances instanceof AccountBalanceCollection)) {
      throw new Error(
        "TrialBalance requires an AccountBalanceCollection"
      );
    }

    const reportLines =
      lines ||
      accountBalances.all().map(
        (accountBalance) =>
          new ReportLine({
            label: accountBalance.accountId,
            amount: accountBalance.balance,
          })
      );

    const reportSections =
      sections ||
      [
        new ReportSection({
          name: "Accounts",
          lines: reportLines,
        }),
      ];

    super({
      name: "Trial Balance",
      lines: reportLines,
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
