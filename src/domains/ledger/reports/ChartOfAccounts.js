import { AccountBalanceCollection } from "./AccountBalanceCollection";

/**
 * ChartOfAccounts
 *
 * Represents the organized chart of accounts
 * derived from calculated account balances.
 *
 * This class is responsible only for exposing
 * account information for reporting.
 */

export class ChartOfAccounts {
  constructor(accountBalances) {
    if (!(accountBalances instanceof AccountBalanceCollection)) {
      throw new Error(
        "ChartOfAccounts requires an AccountBalanceCollection"
      );
    }

    this.accountBalances = accountBalances;

    Object.freeze(this);
  }

  accounts() {
    return this.accountBalances.all();
  }

  count() {
    return this.accountBalances.count();
  }
}
