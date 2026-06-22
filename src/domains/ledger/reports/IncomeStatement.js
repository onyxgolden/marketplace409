import { AccountBalanceCollection } from "./AccountBalanceCollection";
import { FinancialReport } from "./FinancialReport";
import { ReportLine } from "./ReportLine";
import { ReportSection } from "./sections/ReportSection";

/**
 * IncomeStatement
 *
 * Immutable representation of an income statement.
 *
 * IncomeStatement may receive already-built report lines and sections
 * from a builder. It keeps backward-compatible construction from
 * AccountBalanceCollection during the builder migration.
 *
 * Reports represent results. Builders construct report presentation.
 */

export class IncomeStatement extends FinancialReport {
  constructor(accountBalances, { lines = null, sections = null } = {}) {
    if (!(accountBalances instanceof AccountBalanceCollection)) {
      throw new Error(
        "IncomeStatement requires an AccountBalanceCollection"
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
          name: "Income Statement",
          lines: reportLines,
        }),
      ];

    super({
      name: "Income Statement",
      lines: reportLines,
      sections: reportSections,
    });

    this.accountBalances = accountBalances;

    Object.freeze(this);
  }

  accounts() {
    return this.accountBalances.all();
  }

  netIncome() {
    return this.accountBalances.totalBalance();
  }
}
