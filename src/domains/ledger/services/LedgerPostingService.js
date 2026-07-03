import { financialEventPostingAdapter } from "../../financial-event/financial-event-posting.adapter";
import { LedgerPostingResult } from "../results";
import { PostingEngine } from "./PostingEngine";

export class LedgerPostingService {
  constructor({
    ledgerRepository,
    postingAdapter = financialEventPostingAdapter,
    postingEngine = new PostingEngine(),
  } = {}) {
    if (!ledgerRepository) {
      throw new Error("Ledger repository is required");
    }

    this.ledgerRepository = ledgerRepository;
    this.postingAdapter = postingAdapter;
    this.postingEngine = postingEngine;

    Object.freeze(this);
  }

  post(ledgerPostingInput) {
    if (!ledgerPostingInput?.readyForLedgerPosting) {
      throw new Error("Ledger posting input is not ready for ledger posting");
    }

    const financialEvents = [...ledgerPostingInput.financialEvents];

    const journalEntries = financialEvents.map((event) =>
      this.postingAdapter.toJournalEntry(event),
    );

    const postingResults = journalEntries.map((journalEntry) =>
      this.postingEngine.post(journalEntry),
    );

    const startingLedger = this.ledgerRepository.load();

    const updatedLedger = postingResults.reduce(
      (ledger, postingResult) => ledger.record(postingResult),
      startingLedger,
    );

    this.ledgerRepository.save(updatedLedger);

    return new LedgerPostingResult({
      financialEvents,
      journalEntries,
      postingResults,
      ledger: updatedLedger,
      metadata: {
        source: "LedgerPostingService",
        connectionId: ledgerPostingInput.connectionId,
        provider: ledgerPostingInput.provider,
        financialEventsImportedAt:
          ledgerPostingInput.financialEventsImportedAt,
      },
    });
  }
}
