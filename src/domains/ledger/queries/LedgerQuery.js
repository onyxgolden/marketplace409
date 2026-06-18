/**
 * LedgerQuery
 *
 * Read-only query object for immutable ledger history.
 * This class never modifies data.
 * It provides the foundation for reporting and financial analysis.
 */

export class LedgerQuery {
  constructor(repository) {
    if (!repository) {
      throw new Error("LedgerRepository is required");
    }

    this.repository = repository;
    Object.freeze(this);
  }

  getEntries() {
    return this.repository.getEntries();
  }

  getEntriesByAccountId(accountId) {
    return this.repository.getEntriesByAccountId(accountId);
  }

  count() {
    return this.repository.count();
  }

  isEmpty() {
    return this.repository.isEmpty();
  }
}
