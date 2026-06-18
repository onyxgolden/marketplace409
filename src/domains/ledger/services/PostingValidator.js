import { JournalEntry } from "../entities/JournalEntry";
import { Posting } from "../entities/Posting";

export class PostingValidator {
  validate(journalEntry) {
    if (!(journalEntry instanceof JournalEntry)) {
      throw new Error("PostingValidator requires a JournalEntry");
    }

    if (!Array.isArray(journalEntry.postings)) {
      throw new Error("JournalEntry postings must be an array");
    }

    if (journalEntry.postings.length < 2) {
      throw new Error("JournalEntry requires at least two postings");
    }

    journalEntry.postings.forEach((posting) => {
      if (!(posting instanceof Posting)) {
        throw new Error("JournalEntry postings must contain Posting objects");
      }
    });

    journalEntry.validateBalanced();

    return true;
  }
}
