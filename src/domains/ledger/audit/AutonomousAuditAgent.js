import { traceResolver } from "../trace/TraceResolver";
import { traceIntelligenceService } from "../trace/TraceIntelligenceService";

/**
 * AutonomousAuditAgent
 *
 * Background read-only auditor for ledger system.
 * Detects anomalies and explains them automatically.
 */
export class AutonomousAuditAgent {
  constructor(resolver = traceResolver, intelligence = traceIntelligenceService) {
    this.resolver = resolver;
    this.intelligence = intelligence;
  }

  run(ledgerContext) {
    const ledger = ledgerContext?.ledger;
    if (!ledger) return [];

    const entries = ledger.getEntries?.() || [];

    const findings = [];

    for (const entry of entries) {
      const anomalies = this.detect(entry);

      if (anomalies.length > 0) {
        const trace = this.resolver.resolveFromReportLine(
          { label: entry.accountId },
          { ledger }
        );

        const insight = this.intelligence.explain(
          { label: entry.accountId },
          { ledger }
        );

        findings.push({
          accountId: entry.accountId,
          anomalies,
          insight,
          traceSummary: trace.sourceRecordIds,
        });
      }
    }

    return findings;
  }

  detect(entry) {
    const flags = [];

    // Large movement detection
    const amount = entry.amount?.amount ?? entry.amount;
    if (typeof amount === "number" && Math.abs(amount) > 100000) {
      flags.push("Large transaction detected");
    }

    // Missing metadata
    if (!entry.metadata) {
      flags.push("Missing metadata on ledger entry");
    }

    // Suspicious account usage pattern
    if (entry.accountId === "9999") {
      flags.push("Unclassified account usage");
    }

    return flags;
  }
}

export const autonomousAuditAgent = new AutonomousAuditAgent();
