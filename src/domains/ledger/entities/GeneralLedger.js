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
    this.entries = Object.freeze([...entries]);
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

  record(postingResult) {
    if (!postingResult) {
      throw new Error("Posting result is required");
    }

    if (!postingResult.success) {
      throw new Error("Cannot record failed posting result");
    }

    if (!Array.isArray(postingResult.entries)) {
      throw new Error("Posting result must contain ledger entries");
    }

    return new GeneralLedger([...this.entries, ...postingResult.entries]);
  }

  getEntries() {
    return [...this.entries];
  }

  count() {
    return this.entries.length;
  }

  isEmpty() {
    return this.entries.length === 0;
  }
}
