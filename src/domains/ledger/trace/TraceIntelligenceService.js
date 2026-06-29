import { traceResolver } from "./TraceResolver";

/**
 * TraceIntelligenceService
 *
 * Converts raw financial trace into human-readable explanations.
 * READ-ONLY. No mutations.
 */
export class TraceIntelligenceService {
  constructor(resolver = traceResolver) {
    this.resolver = resolver;
  }

  explain(reportLine, ledgerContext) {
    const trace = this.resolver.resolveFromReportLine(
      reportLine,
      ledgerContext
    );

    const events = trace.financialEvents || [];

    const summary = this.buildSummary(events);
    const drivers = this.buildDrivers(events);
    const flow = this.buildFlow(trace);
    const riskFlags = this.detectRisks(events);

    return {
      accountId: trace.accountId,
      summary,
      drivers,
      flow,
      riskFlags,
    };
  }

  buildSummary(events) {
    if (!events.length) return "No financial events found.";

    const first = events[0];

    return `${first.description || "Financial activity"} affecting account ${first.normalized_category || "unknown"}`;
  }

  buildDrivers(events) {
    return events.map((e) => ({
      event: e.description,
      amount: e.amount,
      category: e.normalized_category,
    }));
  }

  buildFlow(trace) {
    return [
      "FinancialEvent → JournalEntry → Posting → Account → ReportLine"
    ];
  }

  detectRisks(events) {
    const risks = [];

    for (const e of events) {
      if (e.amount > 100000) {
        risks.push("Large transaction detected");
      }

      if (e.tax_deductible === false && e.normalized_category === "expense") {
        risks.push("Non-deductible expense detected");
      }
    }

    return risks;
  }
}

export const traceIntelligenceService = new TraceIntelligenceService();
