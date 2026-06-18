/**
 * AccountBalance
 *
 * Immutable calculated balance for a single ledger account.
 * This is a reporting value object only.
 * It does not store or mutate ledger data.
 */

export class AccountBalance {
  constructor({ accountId, debitTotal = 0, creditTotal = 0, balance = 0 }) {
    if (!accountId) {
      throw new Error("AccountBalance requires an accountId");
    }

    this.accountId = accountId;
    this.debitTotal = debitTotal;
    this.creditTotal = creditTotal;
    this.balance = balance;

    Object.freeze(this);
  }

  isZero() {
    return this.balance === 0;
  }
}
