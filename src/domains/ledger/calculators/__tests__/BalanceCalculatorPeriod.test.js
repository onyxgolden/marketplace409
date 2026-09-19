import { describe, expect, test } from "vitest";
import { Money } from "@/platform";
import { GeneralLedger } from "../../entities/GeneralLedger";
import { JournalEntry } from "../../entities/JournalEntry";
import { Posting } from "../../entities/Posting";
import { LedgerDirection } from "../../value-objects";
import { PostingEngine } from "../../services/PostingEngine";
import { BalanceCalculator } from "../BalanceCalculator";

function postRent(id, date, amount) {
  const engine = new PostingEngine();
  return engine.post(
    new JournalEntry({
      id,
      date,
      description: "Rent collected",
      postings: [
        new Posting({
          id: `${id}-p1`,
          accountId: "cash",
          amount: new Money(amount),
          direction: LedgerDirection.DEBIT,
        }),
        new Posting({
          id: `${id}-p2`,
          accountId: "revenue",
          amount: new Money(amount),
          direction: LedgerDirection.CREDIT,
        }),
      ],
    }),
  );
}

const ledger = GeneralLedger.create()
  .record(postRent("je-jan", "2026-01-15", 1000))
  .record(postRent("je-feb", "2026-02-15", 2000));

const calculator = new BalanceCalculator(ledger);

describe("BalanceCalculator.getBalanceByAccountInPeriod", () => {
  test("sums only the entries inside the period", () => {
    expect(
      calculator.getBalanceByAccountInPeriod("revenue", {
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      }).amount,
    ).toBe(-1000);
    expect(
      calculator.getBalanceByAccountInPeriod("revenue", {
        startDate: "2026-02-01",
        endDate: "2026-02-28",
      }).amount,
    ).toBe(-2000);
  });

  test("an omitted startDate behaves as an as-of balance", () => {
    expect(
      calculator.getBalanceByAccountInPeriod("revenue", { endDate: "2026-01-31" }).amount,
    ).toBe(-1000);
    expect(
      calculator.getBalanceByAccountInPeriod("revenue", { endDate: "2026-02-28" }).amount,
    ).toBe(-3000);
  });

  test("the unfiltered balance is unchanged", () => {
    expect(calculator.getBalanceByAccount("revenue").amount).toBe(-3000);
  });

  test("requires an account id", () => {
    expect(() =>
      calculator.getBalanceByAccountInPeriod(null, { startDate: "2026-01-01" }),
    ).toThrow("Account id is required");
  });
});
