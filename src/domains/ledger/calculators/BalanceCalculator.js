import { Money } from "@/platform";
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

    const amount = entries.reduce((balance, entry) => {
      if (entry.direction === LedgerDirection.DEBIT) {
        return balance + entry.amount.amount;
      }

      if (entry.direction === LedgerDirection.CREDIT) {
        return balance - entry.amount.amount;
      }

      return balance;
    }, 0);

    return new Money(amount);
  }

  // Period variant for multi-period reporting: the balance of the account considering only entries
  // whose accounting date falls inside the period. Either bound may be omitted -- an omitted
  // startDate makes this an as-of balance (everything up to endDate), which is how point-in-time
  // statements like the balance sheet filter.
  getBalanceByAccountInPeriod(accountId, { startDate, endDate } = {}) {
    if (!accountId) {
      throw new Error("Account id is required");
    }

    const entries = this.generalLedger.findByAccountInPeriod(accountId, {
      startDate,
      endDate,
    });

    const amount = entries.reduce((balance, entry) => {
      if (entry.direction === LedgerDirection.DEBIT) {
        return balance + entry.amount.amount;
      }

      if (entry.direction === LedgerDirection.CREDIT) {
        return balance - entry.amount.amount;
      }

      return balance;
    }, 0);

    return new Money(amount);
  }
}

Object.freeze(BalanceCalculator);