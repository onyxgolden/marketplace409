import { traceResolver } from "@/domains/ledger/trace/TraceResolver";
import { traceIntelligenceService } from "@/domains/ledger/trace/TraceIntelligenceService";

/**
 * AutonomousAuditAgent
 *
 * READ-ONLY audit visibility layer.
 * Detects account-level anomalies and enriches them with trace intelligence.
 *
 * Does NOT mutate ledger, postings, journal entries, reports, or financial events.
 */
export class AutonomousAuditAgent {
  constructor({
    resolver = traceResolver,
    intelligence = traceIntelligenceService,
  } = {}) {
    this.resolver = resolver;
    this.intelligence = intelligence;
  }

  run({ ledger } = {}) {
    const accounts = ledger?.accounts ?? [];

    const anomalies = accounts.flatMap((account) => {
      return this.auditAccount(account, ledger);
    });

    return {
      anomalies,
      inspectedAccounts: accounts.length,
    };
  }

  auditAccount(account, ledgerContext) {
    const findings = [];

    if (!account) return findings;

    if (typeof account.balance === "number" && account.balance < 0) {
      findings.push(
        this.buildFinding({
          account,
          type: "NEGATIVE_BALANCE",
          description: "Account has a negative balance.",
          ledgerContext,
        })
      );
    }

    if (typeof account.balance === "number" && Math.abs(account.balance) > 100000) {
      findings.push(
        this.buildFinding({
          account,
          type: "LARGE_BALANCE",
          description: "Account balance is unusually large.",
          ledgerContext,
        })
      );
    }

    return findings;
  }

  buildFinding({ account, type, description, ledgerContext }) {
    const reportLine = {
      label: account.id,
      amount: account.balance,
    };

    let traceSummary = "No trace available.";
    let explanation = description;

    try {
      const trace = this.resolver.resolveFromReportLine(reportLine, {
        ledger: ledgerContext,
      });

      traceSummary = [
        `accountId=${trace.accountId}`,
        `postings=${trace.postings?.length ?? 0}`,
        `events=${trace.financialEvents?.length ?? 0}`,
        `sources=${trace.sourceRecordIds?.length ?? 0}`,
      ].join(" | ");

      const intelligence = this.intelligence.explain(reportLine, {
        ledger: ledgerContext,
      });

      explanation = intelligence.summary || description;
    } catch (error) {
      traceSummary = `Trace unavailable: ${error.message}`;
    }

    return {
      accountId: account.id,
      type,
      explanation,
      traceSummary,
    };
  }
}

export const autonomousAuditAgent = new AutonomousAuditAgent();
