import { traceResolver } from "./TraceResolver";
import { traceIntelligenceService } from "./TraceIntelligenceService";

/**
 * TraceQueryService
 *
 * Natural language → financial trace explanation
 * READ-ONLY, no mutations
 */
export class TraceQueryService {
  constructor(resolver = traceResolver, intelligence = traceIntelligenceService) {
    this.resolver = resolver;
    this.intelligence = intelligence;
  }

  ask(query, reportLine, ledgerContext) {
    if (!query) throw new Error("Query required");

    const trace = this.resolver.resolveFromReportLine(
      reportLine,
      ledgerContext
    );

    const insight = this.intelligence.explain(reportLine, ledgerContext);

    return {
      query,
      answer: this.generateAnswer(query, insight),
      drivers: insight.drivers,
      riskFlags: insight.riskFlags,
      trace,
    };
  }

  generateAnswer(query, insight) {
    const q = query.toLowerCase();

    if (q.includes("why") || q.includes("increase")) {
      return insight.summary;
    }

    if (q.includes("expense")) {
      return "Expenses are driven by categorized financial events in the ledger.";
    }

    if (q.includes("cash")) {
      return "Cash movements are derived from posting-level financial events.";
    }

    return "Financial trace available via ledger inspection.";
  }
}

export const traceQueryService = new TraceQueryService();
