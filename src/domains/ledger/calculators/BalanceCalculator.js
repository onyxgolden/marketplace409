import { AccountBalance, AccountBalanceCollection } from "../reports";

/**
 * BalanceCalculator
 *
 * Computes balances exclusively from immutable ledger history.
 * It never stores balances and never mutates ledger entries.
 */

export class BalanceCalculator {
  constructor(ledgerQuery) {
    if (!ledgerQuery) {
      throw new Error("LedgerQuery is required");
    }

    this.ledgerQuery = ledgerQuery;

    Object.freeze(this);
  }

  calculateAll() {
    const entries = this.getLedgerEntries();
    const balancesByAccount = new Map();

    for (const entry of entries) {
      const postings = entry.postings || [];

      for (const posting of postings) {
        const accountId = posting.accountId;

        if (!accountId) {
          continue;
        }

        const existing = balancesByAccount.get(accountId) || {
          accountId,
          debitTotal: 0,
          creditTotal: 0,
        };

        existing.debitTotal += posting.debit || 0;
        existing.creditTotal += posting.credit || 0;

        balancesByAccount.set(accountId, existing);
      }
    }

    const accountBalances = Array.from(balancesByAccount.values()).map(
      (balance) =>
        new AccountBalance({
          accountId: balance.accountId,
          debitTotal: balance.debitTotal,
          creditTotal: balance.creditTotal,
          balance: balance.debitTotal - balance.creditTotal,
        })
    );

    return new AccountBalanceCollection(accountBalances);
  }

  calculateForAccount(accountId) {
    if (!accountId) {
      throw new Error("accountId is required");
    }

    const collection = this.calculateAll();

    return (
      collection
        .all()
        .find((accountBalance) => accountBalance.accountId === accountId) ||
      new AccountBalance({ accountId })
    );
  }

  getLedgerEntries() {
    if (typeof this.ledgerQuery.all === "function") {
      return this.ledgerQuery.all();
    }

    if (typeof this.ledgerQuery.getAll === "function") {
      return this.ledgerQuery.getAll();
    }

    if (typeof this.ledgerQuery.entries === "function") {
      return this.ledgerQuery.entries();
    }

    throw new Error(
      "LedgerQuery must expose all(), getAll(), or entries()"
    );
  }
}
