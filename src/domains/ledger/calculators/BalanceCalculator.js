import { LedgerFilter } from "../filters";

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

  calculate(filter = LedgerFilter.all()) {
    const entries = this.ledgerQuery.find(filter);

    return entries.reduce(
      (balance, entry) => balance + Number(entry.amount ?? 0),
      0
    );
  }

  calculateAccount(accountId) {
    return this.calculate(LedgerFilter.byAccountId(accountId));
  }
}
