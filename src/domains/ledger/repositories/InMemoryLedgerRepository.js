/**
 * InMemoryLedgerRepository
 *
 * Repository abstraction for reading ledger history.
 * This keeps balance calculations independent from storage technology.
 *
 * Production storage may later become Supabase/PostgreSQL.
 * The Balance Engine should depend on this interface shape, not direct tables.
 */

export class InMemoryLedgerRepository {
  constructor(generalLedger) {
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
