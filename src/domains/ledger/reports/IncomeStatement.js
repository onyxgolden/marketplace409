import { AccountBalanceCollection } from "./AccountBalanceCollection";
import { FinancialReport } from "./FinancialReport";
import { ReportLine } from "./ReportLine";

/**
 * IncomeStatement
 *
 * Immutable representation of an income statement.
 * Values originate exclusively from calculated ledger balances.
 *
 * An IncomeStatement is a financial report wrapper
 * around a collection of AccountBalance objects.
 */

export class IncomeStatement extends FinancialReport {
  constructor(accountBalances) {
    if (!(accountBalances instanceof AccountBalanceCollection)) {
      throw new Error(
        "IncomeStatement requires an AccountBalanceCollection"
      );
    }

    super({
      name: "Income Statement",
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

  netIncome() {
    return this.accountBalances.totalBalance();
  }
}
