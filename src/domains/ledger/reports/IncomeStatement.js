import { AccountBalanceCollection } from "./AccountBalanceCollection";

/**
 * IncomeStatement
 *
 * Immutable representation of an income statement.
 * Values originate exclusively from calculated ledger balances.
 */

export class IncomeStatement {
  constructor(accountBalances) {
    if (!(accountBalances instanceof AccountBalanceCollection)) {
      throw new Error(
        "IncomeStatement requires an AccountBalanceCollection"
      );
    }

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
