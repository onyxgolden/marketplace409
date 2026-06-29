import { FinancialEventGateway } from "../financial-event/FinancialEventGateway";
import { financialEventPostingAdapter } from "../financial-event/financial-event-posting.adapter";
import { FinancialEngine } from "../ledger/engines/FinancialEngine";
import { GeneralLedger } from "../ledger/entities/GeneralLedger";

export class ImportPipeline {
  constructor({
    semanticResolver,
    eventFactory,
    postingAdapter = financialEventPostingAdapter,
    ownerId = null,
  } = {}) {
    if (!semanticResolver) {
      throw new Error("Semantic resolver is required");
    }

    this.semanticResolver = semanticResolver;
    this.postingAdapter = postingAdapter;
    this.ownerId = ownerId;

    // 🧱 OPTION B: STRICT ENTRY GATE
    this.gateway = new FinancialEventGateway(eventFactory, ownerId);

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
    const resolvedRecords = this.semanticResolver.resolveMany(records);

    return resolvedRecords.map((record) =>
      this.gateway.create(record),
    );
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

    return journalEntries.flatMap((je) => je.postings);
  }
}
