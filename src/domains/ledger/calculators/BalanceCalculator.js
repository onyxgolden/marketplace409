import { LedgerDirection } from "../value-objects";

/**
 * BalanceCalculator
 *
 * Derives balances entirely from immutable LedgerEntry history.
 * Balances are never persisted.
 */
export class BalanceCalculator {
  constructor(generalLedger) {
    if (!generalLedger) {
      throw new Error("GeneralLedger is required");
    }

    this.generalLedger = generalLedger;
    Object.freeze(this);
  }

  getBalanceByAccount(accountId) {
    if (!accountId) {
      throw new Error("Account id is required");
    }

    const entries = this.generalLedger.findByAccount(accountId);

    return entries.reduce((balance, entry) => {
      if (entry.direction === LedgerDirection.DEBIT) {
        return balance + entry.amount.amount;
      }

      if (entry.direction === LedgerDirection.CREDIT) {
        return balance - entry.amount.amount;
      }

      return balance;
    }, 0);
  }
}

Object.freeze(BalanceCalculator);
