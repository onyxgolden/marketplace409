import { LedgerRepository } from "./LedgerRepository";

/**
 * InMemoryLedgerRepository
 *
 * In-memory implementation of the LedgerRepository contract.
 * Production storage may later become Supabase/PostgreSQL.
 */

export class InMemoryLedgerRepository extends LedgerRepository {
  constructor(generalLedger) {
    super();

    if (!generalLedger) {
      throw new Error("GeneralLedger is required");
    }

    this.generalLedger = generalLedger;
    Object.freeze(this);
  }

  getEntries() {
    return this.generalLedger.getEntries();
  }

  getEntriesByAccountId(accountId) {
    if (!accountId) {
      throw new Error("Account id is required");
    }

    return this.getEntries().filter((entry) => entry.accountId === accountId);
  }

  count() {
    return this.getEntries().length;
  }

  isEmpty() {
    return this.count() === 0;
  }
}
