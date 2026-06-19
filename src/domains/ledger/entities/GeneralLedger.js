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

  count() {
    return this._entries.length;
  }

  isEmpty() {
    return this._entries.length === 0;
  }
}
