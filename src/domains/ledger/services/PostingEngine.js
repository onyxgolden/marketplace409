import { LedgerEntry } from "../entities/LedgerEntry";
import { JournalEntry } from "../entities/JournalEntry";
import { PostingResult } from "../results/PostingResult";

export class PostingEngine {
  post(journalEntry) {
    if (!(journalEntry instanceof JournalEntry)) {
      throw new Error("PostingEngine requires a JournalEntry");
    }

    journalEntry.validateBalanced();

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
        createdAt: new Date(),
      });
    });

    return new PostingResult({
      journalEntryId: journalEntry.id,
      ledgerEntries,
      metadata: {
        source: "PostingEngine",
      },
    });
  }
}
