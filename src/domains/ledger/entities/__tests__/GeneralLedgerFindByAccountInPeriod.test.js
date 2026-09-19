import { describe, expect, test } from "vitest";
import { Money } from "@/platform";
import { GeneralLedger } from "../GeneralLedger";
import { JournalEntry } from "../JournalEntry";
import { Posting } from "../Posting";
import { LedgerDirection } from "../../value-objects";
import { PostingEngine } from "../../services/PostingEngine";

function postRent(id, date, amount) {
  const engine = new PostingEngine();
  const journalEntry = new JournalEntry({
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
  });
  return engine.post(journalEntry);
}

const ledger = GeneralLedger.create()
  .record(postRent("je-jan", "2026-01-15", 1000))
  .record(postRent("je-feb", "2026-02-15", 2000));

describe("GeneralLedger.findByAccountInPeriod", () => {
  test("returns only entries whose accounting date falls in the period", () => {
    const entries = ledger.findByAccountInPeriod("revenue", {
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].amount.amount).toBe(1000);
  });

  test("bounds are inclusive", () => {
    const entries = ledger.findByAccountInPeriod("revenue", {
      startDate: "2026-01-15",
      endDate: "2026-01-15",
    });
    expect(entries).toHaveLength(1);
  });

  test("accepts Date bounds and open-ended ranges", () => {
    expect(
      ledger.findByAccountInPeriod("revenue", { startDate: new Date("2026-02-01") }),
    ).toHaveLength(1);
    expect(
      ledger.findByAccountInPeriod("revenue", { endDate: "2026-01-31" }),
    ).toHaveLength(1);
    expect(ledger.findByAccountInPeriod("revenue", {})).toHaveLength(2);
  });

  test("filters by accounting date, not posting time", () => {
    // Both entries were posted "now"; only the January journal date matches.
    const entries = ledger.findByAccountInPeriod("cash", {
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.journalEntryDate).toBe("2026-01-15");
  });

  test("falls back to createdAt when the posting stamp is absent", () => {
    const legacy = GeneralLedger.fromEntries([
      { accountId: "revenue", createdAt: new Date("2026-03-10T12:00:00Z") },
    ]);
    expect(
      legacy.findByAccountInPeriod("revenue", {
        startDate: "2026-03-01",
        endDate: "2026-03-31",
      }),
    ).toHaveLength(1);
    expect(
      legacy.findByAccountInPeriod("revenue", {
        startDate: "2026-04-01",
        endDate: "2026-04-30",
      }),
    ).toHaveLength(0);
  });

  test("excludes entries with an unknown date when bounds are set", () => {
    const dateless = GeneralLedger.fromEntries([{ accountId: "revenue" }]);
    expect(
      dateless.findByAccountInPeriod("revenue", {
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      }),
    ).toHaveLength(0);
  });
});
