export class LedgerPostingResult {
  constructor({
    financialEvents = [],
    journalEntries = [],
    postingResults = [],
    ledger,
    postedAt = new Date(),
    metadata = {},
  }) {
    if (!Array.isArray(financialEvents)) {
      throw new Error("LedgerPostingResult financialEvents must be an array");
    }

    if (!Array.isArray(journalEntries)) {
      throw new Error("LedgerPostingResult journalEntries must be an array");
    }

    if (!Array.isArray(postingResults)) {
      throw new Error("LedgerPostingResult postingResults must be an array");
    }

    if (!ledger) {
      throw new Error("LedgerPostingResult requires a ledger");
    }

    this.financialEvents = Object.freeze([...financialEvents]);
    this.journalEntries = Object.freeze([...journalEntries]);
    this.postingResults = Object.freeze([...postingResults]);
    this.ledger = ledger;
    this.postedAt = postedAt;
    this.metadata = Object.freeze({ ...metadata });
    this.readyForFinancialReports = true;

    Object.freeze(this);
  }

  get financialEventCount() {
    return this.financialEvents.length;
  }

  get journalEntryCount() {
    return this.journalEntries.length;
  }

  get postingResultCount() {
    return this.postingResults.length;
  }

  get ledgerEntryCount() {
    return this.postingResults.reduce(
      (total, postingResult) => total + postingResult.entryCount,
      0,
    );
  }

  toJSON() {
    return {
      financialEventCount: this.financialEventCount,
      journalEntryCount: this.journalEntryCount,
      postingResultCount: this.postingResultCount,
      ledgerEntryCount: this.ledgerEntryCount,
      postedAt: this.postedAt,
      readyForFinancialReports: this.readyForFinancialReports,
      metadata: this.metadata,
      journalEntries: this.journalEntries.map((entry) => entry.toJSON()),
      postingResults: this.postingResults.map((result) => result.toJSON()),
    };
  }
}
