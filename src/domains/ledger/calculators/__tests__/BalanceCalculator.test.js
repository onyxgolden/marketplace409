import { describe, expect, test } from "vitest";
import { Money } from "@/platform";
import { GeneralLedger } from "../../entities/GeneralLedger";
import { JournalEntry } from "../../entities/JournalEntry";
import { Posting } from "../../entities/Posting";
import { LedgerDirection } from "../../value-objects";
import { PostingEngine } from "../../services/PostingEngine";
import { BalanceCalculator } from "../BalanceCalculator";

describe("BalanceCalculator", () => {
  test("derives an account balance from posted immutable ledger entries", () => {
    const postingEngine = new PostingEngine();

    const journalEntry = new JournalEntry({
      id: "entry-1",
      date: new Date("2026-01-01"),
      description: "Owner contribution",
      postings: [
        new Posting({
          id: "posting-1",
          accountId: "cash",
          amount: new Money(100),
          direction: LedgerDirection.DEBIT,
        }),
        new Posting({
          id: "posting-2",
          accountId: "equity",
          amount: new Money(100),
          direction: LedgerDirection.CREDIT,
        }),
      ],
    });

    const postingResult = postingEngine.post(journalEntry);
    const ledger = GeneralLedger.create().record(postingResult);

    const calculator = new BalanceCalculator(ledger);

    expect(calculator.getBalanceByAccount("cash")).toBe(100);
  });
});