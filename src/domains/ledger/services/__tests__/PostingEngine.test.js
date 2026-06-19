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
});
