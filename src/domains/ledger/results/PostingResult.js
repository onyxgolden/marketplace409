export class PostingResult {
  constructor({
    journalEntryId,
    ledgerEntries = [],
    postedAt = new Date(),
    metadata = {},
  }) {
    if (!journalEntryId) {
      throw new Error("PostingResult requires a journalEntryId");
    }

    if (!Array.isArray(ledgerEntries)) {
      throw new Error("PostingResult ledgerEntries must be an array");
    }

    this.journalEntryId = journalEntryId;
    this.ledgerEntries = Object.freeze([...ledgerEntries]);
    this.postedAt = postedAt;
    this.metadata = Object.freeze({ ...metadata });

    Object.freeze(this);
  }

  get entryCount() {
    return this.ledgerEntries.length;
  }

  toJSON() {
    return {
      journalEntryId: this.journalEntryId,
      entryCount: this.entryCount,
      postedAt: this.postedAt,
      metadata: this.metadata,
      ledgerEntries: this.ledgerEntries.map((entry) => entry.toJSON()),
    };
  }
}
