import { AccountBalanceCollection } from "./AccountBalanceCollection";
import { FinancialReport } from "./FinancialReport";
import { ReportLine } from "./ReportLine";

/**
 * BalanceSheet
 *
 * Immutable representation of a balance sheet.
 * Values originate exclusively from calculated ledger balances.
 *
 * A BalanceSheet is a financial report wrapper
 * around a collection of AccountBalance objects.
 */

export class BalanceSheet extends FinancialReport {
  constructor(accountBalances) {
    if (!(accountBalances instanceof AccountBalanceCollection)) {
      throw new Error(
        "BalanceSheet requires an AccountBalanceCollection"
      );
    }

    super({
      name: "Balance Sheet",
      lines: accountBalances.all().map(
        (accountBalance) =>
          new ReportLine({
            label: accountBalance.accountId,
            amount: accountBalance.balance,
          })
      ),
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
}
