import { financialEventFactory } from "../financial-event/financial-event.factory";
import { financialEventPostingAdapter } from "../financial-event/financial-event-posting.adapter";
import { FinancialEngine } from "../ledger/engines/FinancialEngine";
import { GeneralLedger } from "../ledger/entities/GeneralLedger";

export class ImportPipeline {
  constructor({
    eventFactory = financialEventFactory,
    postingAdapter = financialEventPostingAdapter,
  } = {}) {
    this.eventFactory = eventFactory;
    this.postingAdapter = postingAdapter;

    Object.freeze(this);
  }

  buildReports({ records, chartOfAccounts }) {
    const financialEvents = this.toFinancialEvents(records);
    const journalEntries = this.toJournalEntries(financialEvents);
    const ledgerEntries = this.toLedgerEntries(journalEntries);
    const generalLedger = GeneralLedger.fromEntries(ledgerEntries);

    const engine = new FinancialEngine({
      generalLedger,
      chartOfAccounts,
    });

    return engine.buildReports();
  }

  toFinancialEvents(records) {
    if (!Array.isArray(records)) {
      throw new Error("Import records must be an array");
    }

    return records.map((record) => this.eventFactory.fromRentec(record));
  }

  toJournalEntries(financialEvents) {
    if (!Array.isArray(financialEvents)) {
      throw new Error("Financial events must be an array");
    }

    return financialEvents.map((event) =>
      this.postingAdapter.toJournalEntry(event),
    );
  }

  toLedgerEntries(journalEntries) {
    if (!Array.isArray(journalEntries)) {
      throw new Error("Journal entries must be an array");
    }

    return journalEntries.flatMap((journalEntry) => journalEntry.postings);
  }
}

export const importPipeline = new ImportPipeline();
