import { LedgerFilter } from "../filters";

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

  find(filter = LedgerFilter.all()) {
    if (!(filter instanceof LedgerFilter)) {
      throw new Error("LedgerQuery.find requires a LedgerFilter");
    }

    return this.repository.getEntries().filter((entry) => filter.matches(entry));
  }

  getEntries() {
    return this.find(LedgerFilter.all());
  }

  getEntriesByAccountId(accountId) {
    return this.find(LedgerFilter.byAccountId(accountId));
  }

  count(filter = LedgerFilter.all()) {
    return this.find(filter).length;
  }

  isEmpty(filter = LedgerFilter.all()) {
    return this.count(filter) === 0;
  }
}
