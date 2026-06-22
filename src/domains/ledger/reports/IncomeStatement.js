import { AccountBalanceCollection } from "./AccountBalanceCollection.js";
import { FinancialReport } from "./FinancialReport.js";
import { ReportLine } from "./ReportLine.js";
import { ReportSection } from "./sections/ReportSection.js";

/**
 * IncomeStatement
 *
 * Immutable representation of an income statement.
 *
 * Supports:
 * 1. AccountBalanceCollection (legacy)
 * 2. Snapshot (rollup-optimized)
 */

export class IncomeStatement extends FinancialReport {
  constructor(
    accountBalances,
    { lines = null, sections = null, snapshot = null } = {}
  ) {
    if (!(accountBalances instanceof AccountBalanceCollection)) {
      throw new Error(
        "IncomeStatement requires an AccountBalanceCollection"
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
          name: "Income Statement",
          lines: finalLines,
        }),
      ];

    super({
      name: "Income Statement",
      lines: finalLines,
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
