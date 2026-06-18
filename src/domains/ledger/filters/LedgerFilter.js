/**
 * LedgerFilter
 *
 * Immutable value object describing which ledger entries to query.
 * This prevents LedgerQuery from growing dozens of specialized methods.
 */

export class LedgerFilter {
  constructor({
    accountId = null,
    journalId = null,
    reference = null,
    fromDate = null,
    toDate = null,
  } = {}) {
    this.accountId = accountId;
    this.journalId = journalId;
    this.reference = reference;
    this.fromDate = fromDate;
    this.toDate = toDate;

    Object.freeze(this);
  }

  static all() {
    return new LedgerFilter();
  }

  static byAccountId(accountId) {
    return new LedgerFilter({ accountId });
  }

  static byJournalId(journalId) {
    return new LedgerFilter({ journalId });
  }

  static byReference(reference) {
    return new LedgerFilter({ reference });
  }

  static byDateRange(fromDate, toDate) {
    return new LedgerFilter({ fromDate, toDate });
  }

  matches(entry) {
    if (!entry) {
      return false;
    }

    if (this.accountId && entry.accountId !== this.accountId) {
      return false;
    }

    if (this.journalId && entry.journalId !== this.journalId) {
      return false;
    }

    if (this.reference && entry.reference !== this.reference) {
      return false;
    }

    const entryDate = entry.date ? new Date(entry.date) : null;

    if (this.fromDate && (!entryDate || entryDate < new Date(this.fromDate))) {
      return false;
    }

    if (this.toDate && (!entryDate || entryDate > new Date(this.toDate))) {
      return false;
    }

    return true;
  }
}
