import { AccountBalance } from "./AccountBalance.js";

/**
 * AccountBalanceCollection
 *
 * Immutable collection of calculated account balances.
 * Provides a reusable reporting abstraction for all
 * financial statements.
 */

export class AccountBalanceCollection {
  constructor(accountBalances = []) {
    for (const balance of accountBalances) {
      if (!(balance instanceof AccountBalance)) {
        throw new Error(
          "AccountBalanceCollection accepts only AccountBalance instances"
        );
      }
    }

    this.accountBalances = [...accountBalances];

    Object.freeze(this.accountBalances);
    Object.freeze(this);
  }

  all() {
    return this.accountBalances;
  }

  count() {
    return this.accountBalances.length;
  }

  totalBalance() {
    return this.accountBalances.reduce(
      (sum, balance) => sum + balance.balance,
      0
    );
  }
}
