import { AccountBalanceCollection } from "./AccountBalanceCollection";

/**
 * TrialBalance
 *
 * Represents a trial balance generated from
 * immutable ledger history.
 *
 * A TrialBalance is simply a reporting wrapper
 * around a collection of AccountBalance objects.
 */

export class TrialBalance {
  constructor(accountBalances) {
    if (!(accountBalances instanceof AccountBalanceCollection)) {
      throw new Error(
        "TrialBalance requires an AccountBalanceCollection"
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

  isBalanced() {
    return this.totalBalance() === 0;
  }
}
