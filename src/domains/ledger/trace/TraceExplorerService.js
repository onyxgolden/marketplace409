import { traceResolver } from "./TraceResolver";

/**
 * TraceExplorerService
 *
 * UI-facing read-only adapter over TraceResolver.
 * Converts raw trace graph into UI-ready structure.
 */
export class TraceExplorerService {
  constructor(resolver = traceResolver) {
    this.resolver = resolver;
  }

  exploreReportLine(reportLine, ledgerContext) {
    const trace = this.resolver.resolveFromReportLine(
      reportLine,
      ledgerContext
    );

    return {
      node: {
        type: "reportLine",
        accountId: trace.accountId,
      },

      children: [
        {
          type: "postings",
          items: trace.postings.map((p) => ({
            id: p.id,
            accountId: p.accountId,
            amount: p.amount,
          })),
        },

        {
          type: "financialEvents",
          items: trace.financialEvents.map((e) => ({
            id: e.id,
            date: e.event_date,
            description: e.description,
            amount: e.amount,
            sourceSystem: e.source_system,
          })),
        },

        {
          type: "sourceRecords",
          items: trace.sourceRecordIds.map((id) => ({
            source_record_id: id,
          })),
        },
      ],
    };
  }
}

export const traceExplorerService = new TraceExplorerService();
