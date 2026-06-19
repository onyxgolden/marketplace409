import { describe, expect, test } from "vitest";
import { Money } from "@/platform";
import { GeneralLedger } from "../GeneralLedger";
import { LedgerEntry } from "../LedgerEntry";
import { PostingResult } from "../../results/PostingResult";
import { LedgerDirection } from "../../value-objects";

function createLedgerEntry(id = "ledger-entry-1") {
  return new LedgerEntry({
    id,
    accountId: "cash",
    amount: new Money(100),
    direction: LedgerDirection.DEBIT,
    description: "Cash received",
    metadata: { source: "test" },
  });
}

describe("GeneralLedger", () => {
  test("creates an empty general ledger", () => {
    const ledger = GeneralLedger.create();

    expect(ledger.isEmpty()).toBe(true);
    expect(ledger.count()).toBe(0);
    expect(ledger.getEntries()).toEqual([]);
  });

  test("records ledger entries from a posting result", () => {
    const ledger = GeneralLedger.create();
    const ledgerEntry = createLedgerEntry();

    const postingResult = new PostingResult({
      journalEntryId: "journal-1",
      ledgerEntries: [ledgerEntry],
    });

    const updatedLedger = ledger.record(postingResult);

    expect(updatedLedger.count()).toBe(1);
    expect(updatedLedger.getEntries()).toEqual([ledgerEntry]);
  });
});
