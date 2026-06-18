import { LedgerEntry } from "../entities/LedgerEntry";
import { JournalEntry } from "../entities/JournalEntry";
import { PostingResult } from "../results/PostingResult";
import { PostingValidator } from "./PostingValidator";

export class PostingEngine {
  constructor({ validator = new PostingValidator() } = {}) {
    this.validator = validator;
  }

  post(journalEntry) {
    if (!(journalEntry instanceof JournalEntry)) {
      throw new Error("PostingEngine requires a JournalEntry");
    }

    this.validator.validate(journalEntry);

    const postedAt = new Date();

    const ledgerEntries = journalEntry.postings.map((posting, index) => {
      return new LedgerEntry({
        id: `${journalEntry.id}:ledger-entry:${index + 1}`,
        accountId: posting.accountId,
        amount: posting.amount,
        direction: posting.direction,
        description: posting.description || journalEntry.description,
        metadata: {
          ...posting.metadata,
          journalEntryId: journalEntry.id,
          postingId: posting.id,
          journalEntryDate: journalEntry.date,
          journalEntryDescription: journalEntry.description,
        },
        createdAt: postedAt,
      });
    });

    return new PostingResult({
      journalEntryId: journalEntry.id,
      ledgerEntries,
      postedAt,
      metadata: {
        source: "PostingEngine",
        validator: this.validator.constructor.name,
      },
    });
  }
}
