import { AccountBalanceCollection } from "./AccountBalanceCollection";
import { FinancialReport } from "./FinancialReport";
import { ReportLine } from "./ReportLine";
import { ReportSection } from "./sections/ReportSection";

/**
 * TrialBalance
 *
 * Represents a trial balance generated from
 * immutable ledger history.
 *
 * A TrialBalance is a financial report wrapper
 * around a collection of AccountBalance objects.
 */

export class TrialBalance extends FinancialReport {
  constructor(accountBalances) {
    if (!(accountBalances instanceof AccountBalanceCollection)) {
      throw new Error(
        "TrialBalance requires an AccountBalanceCollection"
      );
    }

    const lines = accountBalances.all().map(
      (accountBalance) =>
        new ReportLine({
          label: accountBalance.accountId,
          amount: accountBalance.balance,
        })
    );

    super({
      name: "Trial Balance",
      lines,
      sections: [
        new ReportSection({
          name: "Accounts",
          lines,
        }),
      ],
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
