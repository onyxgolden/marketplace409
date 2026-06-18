import { AccountBalanceCollection } from "./AccountBalanceCollection";

/**
 * BalanceSheet
 *
 * Immutable representation of a balance sheet.
 * Values originate exclusively from calculated ledger balances.
 */

export class BalanceSheet {
  constructor(accountBalances) {
    if (!(accountBalances instanceof AccountBalanceCollection)) {
      throw new Error(
        "BalanceSheet requires an AccountBalanceCollection"
      );
    }

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
