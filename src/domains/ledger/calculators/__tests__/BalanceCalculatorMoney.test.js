import { describe, expect, test } from "vitest";
import { Money } from "@/platform";
import { GeneralLedger } from "../../entities/GeneralLedger";
import { JournalEntry } from "../../entities/JournalEntry";
import { Posting } from "../../entities/Posting";
import { LedgerDirection } from "../../value-objects";
import { PostingEngine } from "../../services/PostingEngine";
import { BalanceCalculator } from "../BalanceCalculator";

describe("BalanceCalculator Money", () => {
  test("returns a Money value object", () => {
    const postingEngine = new PostingEngine();

    const journalEntry = new JournalEntry({
      id: "entry-money-1",
      date: new Date("2026-01-01"),
      description: "Initial funding",
      postings: [
        new Posting({
          id: "posting-money-1",
          accountId: "cash",
          amount: new Money(500),
          direction: LedgerDirection.DEBIT,
        }),
        new Posting({
          id: "posting-money-2",
          accountId: "equity",
          amount: new Money(500),
          direction: LedgerDirection.CREDIT,
        }),
      ],
    });

    const ledger = GeneralLedger.create().record(
      postingEngine.post(journalEntry),
    );

    const calculator = new BalanceCalculator(ledger);
    const balance = calculator.getBalanceByAccount("cash");

    expect(balance).toBeInstanceOf(Money);
    expect(balance.amount).toBe(500);
  });
});