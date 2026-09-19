/**
 * GeneralLedger
 *
 * Owns immutable accounting history.
 * It does not calculate balances.
 * It does not mutate ledger entries.
 * It only records posted ledger entries as the source of truth.
 */

export class GeneralLedger {
  constructor(entries = []) {
    this._entries = Object.freeze([...entries]);
    Object.freeze(this);
  }

  static create() {
    return new GeneralLedger([]);
  }

  static fromEntries(entries = []) {
    if (!Array.isArray(entries)) {
      throw new Error("GeneralLedger entries must be an array");
    }

    return new GeneralLedger(entries);
  }

  get entries() {
    return Object.freeze([...this._entries]);
  }

  record(postingResult) {
    if (!postingResult) {
      throw new Error("Posting result is required");
    }

    if (!Array.isArray(postingResult.ledgerEntries)) {
      throw new Error("Posting result must contain ledger entries");
    }

    return new GeneralLedger([...this._entries, ...postingResult.ledgerEntries]);
  }

  getEntries() {
    return this.entries;
  }

  findByAccount(accountId) {
    return Object.freeze(
      this._entries.filter((entry) => entry.accountId === accountId),
    );
  }

  // Period-filtered variant for multi-period reporting. Bounds are inclusive and either may be
  // omitted (open-ended). Entries are filtered by their accounting date -- the journal entry date
  // stamped into metadata at posting time -- falling back to createdAt for entries that predate
  // the stamp. Dates may be Date instances or date strings; all comparisons are day-granularity.
  findByAccountInPeriod(accountId, { startDate, endDate } = {}) {
    const start = toDateOnly(startDate);
    const end = toDateOnly(endDate);

    return Object.freeze(
      this._entries.filter((entry) => {
        if (entry.accountId !== accountId) return false;

        if (start || end) {
          // A period report must not silently attribute entries whose accounting date is unknown.
          const entryDate = toDateOnly(entry.metadata?.journalEntryDate ?? entry.createdAt);
          if (!entryDate) return false;
          if (start && entryDate < start) return false;
          if (end && entryDate > end) return false;
        }
        return true;
      }),
    );
  }

  count() {
    return this._entries.length;
  }

  isEmpty() {
    return this._entries.length === 0;
  }
}

function toDateOnly(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}
