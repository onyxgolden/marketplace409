import { Posting } from "../entities/Posting";

/**
 * TraceResolver (READ-ONLY)
 *
 * Builds a full audit trace from ReportLine → FinancialEvent.
 * Does NOT mutate ledger or reports.
 */
export class TraceResolver {
  resolveFromReportLine(reportLine, ledgerContext) {
    if (!reportLine || !reportLine.label) {
      throw new Error("ReportLine required");
    }

    const accountId = reportLine.label;

    const journalEntries = [];
    const postings = [];
    const financialEvents = [];
    const sourceRecordIds = [];

    const ledgerEntries = ledgerContext?.ledger?.getEntries?.() ?? [];

    for (const entry of ledgerEntries) {
      // Entry is assumed Posting-derived
      if (entry.accountId !== accountId) continue;

      postings.push(entry);

      const event = entry?.metadata?.event;
      if (event) {
        financialEvents.push(event);

        if (event.source_record_id) {
          sourceRecordIds.push(event.source_record_id);
        }
      }
    }

    return {
      accountId,
      journalEntries,
      postings,
      financialEvents,
      sourceRecordIds,
    };
  }
}

export const traceResolver = new TraceResolver();
