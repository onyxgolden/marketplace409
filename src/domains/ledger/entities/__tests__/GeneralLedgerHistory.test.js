import { describe, expect, test } from "vitest";

import { Money } from "../../../../platform/value-objects/Money";
import { GeneralLedger } from "../GeneralLedger";
import { JournalEntry } from "../JournalEntry";
import { Posting } from "../Posting";
import { PostingEngine } from "../../services/PostingEngine";

describe("GeneralLedger history behavior", () => {
  test("starts with an empty immutable history", () => {
    const ledger = new GeneralLedger();

    expect(ledger.entries).toEqual([]);
    expect(Object.isFrozen(ledger.entries)).toBe(true);
  });

  test("history remains immutable after recording", () => {
    const ledger = new GeneralLedger();
    const postingEngine = new PostingEngine();

    const journalEntry = new JournalEntry({
      id: "journal-entry-opening-balance",
      date: new Date("2026-01-01T00:00:00.000Z"),
      description: "Opening Balance",
      postings: [
        new Posting({
          id: "posting-cash-debit",
          accountId: "cash",
          amount: new Money(1000),
          direction: "DEBIT",
        }),
        new Posting({
          id: "posting-equity-credit",
          accountId: "equity",
          amount: new Money(1000),
          direction: "CREDIT",
        }),
      ],
    });

    const postingResult = postingEngine.post(journalEntry);

    ledger.record(postingResult);

    expect(Object.isFrozen(ledger.entries)).toBe(true);

    expect(() => {
      ledger.entries.push("bad");
    }).toThrow();
  });
});
