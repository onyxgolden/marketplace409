import { describe, expect, test } from "vitest";
import { Money } from "@/platform";
import { JournalEntry, Posting } from "../../entities";
import { LedgerDirection } from "../../value-objects";
import { PostingEngine } from "../PostingEngine";
import { PostingResult } from "../../results/PostingResult";

function createBalancedJournalEntry() {
  return new JournalEntry({
    id: "journal-1",
    date: "2026-06-18",
    description: "Owner contribution",
    postings: [
      new Posting({
        id: "posting-1",
        accountId: "cash",
        amount: new Money(100),
        direction: LedgerDirection.DEBIT,
        description: "Cash received",
        metadata: { sourceLine: 1 },
      }),
      new Posting({
        id: "posting-2",
        accountId: "owner-equity",
        amount: new Money(100),
        direction: LedgerDirection.CREDIT,
        metadata: { sourceLine: 2 },
      }),
    ],
    metadata: { source: "test" },
  });
}

describe("PostingEngine", () => {
  test("posts a balanced journal entry into ledger entries", () => {
    const engine = new PostingEngine();
    const journalEntry = createBalancedJournalEntry();

    const result = engine.post(journalEntry);

    expect(result).toBeInstanceOf(PostingResult);
    expect(result.journalEntryId).toBe("journal-1");
    expect(result.entryCount).toBe(2);
  });

  test("creates deterministic ledger entry ids from journal entry and posting order", () => {
    const engine = new PostingEngine();
    const journalEntry = createBalancedJournalEntry();

    const result = engine.post(journalEntry);

    expect(result.ledgerEntries[0].id).toBe("journal-1:ledger-entry:1");
    expect(result.ledgerEntries[1].id).toBe("journal-1:ledger-entry:2");
  });

  test("copies posting accounting fields into ledger entries", () => {
    const engine = new PostingEngine();
    const journalEntry = createBalancedJournalEntry();

    const result = engine.post(journalEntry);

    expect(result.ledgerEntries[0].accountId).toBe("cash");
    expect(result.ledgerEntries[0].amount).toEqual(new Money(100));
    expect(result.ledgerEntries[0].direction).toBe(LedgerDirection.DEBIT);
    expect(result.ledgerEntries[0].description).toBe("Cash received");

    expect(result.ledgerEntries[1].accountId).toBe("owner-equity");
    expect(result.ledgerEntries[1].amount).toEqual(new Money(100));
    expect(result.ledgerEntries[1].direction).toBe(LedgerDirection.CREDIT);
    expect(result.ledgerEntries[1].description).toBe("Owner contribution");
  });

  test("adds journal entry metadata to each ledger entry", () => {
    const engine = new PostingEngine();
    const journalEntry = createBalancedJournalEntry();

    const result = engine.post(journalEntry);

    expect(result.ledgerEntries[0].metadata).toEqual({
      sourceLine: 1,
      journalEntryId: "journal-1",
      postingId: "posting-1",
      journalEntryDate: "2026-06-18",
      journalEntryDescription: "Owner contribution",
    });

    expect(result.ledgerEntries[1].metadata).toEqual({
      sourceLine: 2,
      journalEntryId: "journal-1",
      postingId: "posting-2",
      journalEntryDate: "2026-06-18",
      journalEntryDescription: "Owner contribution",
    });
  });

  test("records the posting timestamp on every generated ledger entry", () => {
    const engine = new PostingEngine();
    const journalEntry = createBalancedJournalEntry();

    const result = engine.post(journalEntry);

    expect(result.ledgerEntries[0].createdAt).toBe(result.postedAt);
    expect(result.ledgerEntries[1].createdAt).toBe(result.postedAt);
  });

  test("uses the injected validator when posting", () => {
    let validatedEntry = null;

    const validator = {
      validate(entry) {
        validatedEntry = entry;
        return true;
      },
    };

    const engine = new PostingEngine({ validator });
    const journalEntry = createBalancedJournalEntry();

    engine.post(journalEntry);

    expect(validatedEntry).toBe(journalEntry);
  });

    test("throws when posting anything other than a JournalEntry", () => {
    const engine = new PostingEngine();

    expect(() => engine.post({})).toThrow(
      "PostingEngine requires a JournalEntry"
    );
  });

    test("returns immutable posting metadata", () => {
    const engine = new PostingEngine();
    const journalEntry = createBalancedJournalEntry();

    const result = engine.post(journalEntry);

    expect(Object.isFrozen(result.metadata)).toBe(true);
    expect(result.metadata.source).toBe("PostingEngine");
    expect(result.metadata.validator).toBe("PostingValidator");
  });
});
