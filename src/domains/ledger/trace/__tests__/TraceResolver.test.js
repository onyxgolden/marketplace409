import { GeneralLedger } from "../../entities/GeneralLedger";
import { Posting } from "../../entities/Posting";
import { LedgerDirection } from "../../value-objects";
import { Money } from "@/platform";
import { TraceResolver } from "../TraceResolver";

describe("TraceResolver", () => {
  function posting({ id, accountId, amount, event }) {
    return new Posting({
      id,
      accountId,
      amount: new Money(amount),
      direction: LedgerDirection.DEBIT,
      metadata: event ? { event } : {},
    });
  }

  test("maps a report line to matching ledger postings and source records", () => {
    const event = {
      id: "event-1",
      source_record_id: "bank-row-1",
      description: "Rent payment",
      amount: 120000,
    };

    const ledger = GeneralLedger.fromEntries([
      posting({
        id: "posting-1",
        accountId: "4000",
        amount: 120000,
        event,
      }),
      posting({
        id: "posting-2",
        accountId: "5000",
        amount: 30000,
      }),
    ]);

    const resolver = new TraceResolver();

    const trace = resolver.resolveFromReportLine(
      { label: "4000", amount: 120000 },
      { ledger }
    );

    expect(trace).toEqual({
      accountId: "4000",
      journalEntries: [],
      postings: [ledger.getEntries()[0]],
      financialEvents: [event],
      sourceRecordIds: ["bank-row-1"],
    });
  });

  test("returns an empty trace when no ledger posting matches the report line", () => {
    const ledger = GeneralLedger.fromEntries([
      posting({
        id: "posting-1",
        accountId: "1000",
        amount: 50000,
      }),
    ]);

    const resolver = new TraceResolver();

    const trace = resolver.resolveFromReportLine(
      { label: "4000", amount: 120000 },
      { ledger }
    );

    expect(trace).toEqual({
      accountId: "4000",
      journalEntries: [],
      postings: [],
      financialEvents: [],
      sourceRecordIds: [],
    });
  });

  test("requires a report line", () => {
    const resolver = new TraceResolver();

    expect(() => resolver.resolveFromReportLine(null, {})).toThrow(
      "ReportLine required"
    );
  });
});
