import { LedgerEntry } from "../entities/LedgerEntry";
import { JournalEntry } from "../entities/JournalEntry";

export class PostingEngine {
  post(journalEntry) {
    if (!(journalEntry instanceof JournalEntry)) {
      throw new Error("PostingEngine requires a JournalEntry");
    }

    journalEntry.validateBalanced();

    return journalEntry.postings.map((posting, index) => {
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
  }
}
