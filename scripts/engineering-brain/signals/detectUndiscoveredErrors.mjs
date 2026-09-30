/**
 * detectUndiscoveredErrors.mjs — FORGE Engineering Brain: undiscovered-error detection
 * from runtime signals.
 *
 * Runtime signals are facts from production nobody has asked about yet: a receipt delivery
 * that terminally failed, a queue row stuck in "sending" for hours, a CI run that went red
 * on main. Each signal is correlated to the code that likely owns it using the Brain's own
 * retrieval (searchRecords — content tokens included), then signals are grouped into
 * distinct undiscovered errors and ranked.
 *
 * Pure, deterministic, no model calls, no I/O, no credentials. Signal *collection* lives in
 * the fetchers (fetchSupabaseSignals.mjs, fetchGithubSignals.py); this module only reasons
 * over the signal JSON they produce. The same signals + manifest always yield the same report.
 *
 * A signal looks like:
 *   {
 *     signal_id: "supabase:private_financing_payment_receipt_deliveries:failed:<row-id>",
 *     source: "supabase" | "github",
 *     kind: "delivery_failed" | "delivery_stuck" | "ci_failed",
 *     severity: "error" | "warning",
 *     title: "Payment receipt delivery failed",
 *     group_title: "Payment receipt delivery failed",  // shared across grouped signals
 *     detected_at: "2026-09-29T18:00:00.000Z",
 *     correlation_query: "payment receipt delivery failed",
 *     evidence: { ... }           // source-specific facts: failure_reason, run URL, ...
 *   }
 */

import { searchRecords } from "../query/searchRecords.mjs";
import { rankResults } from "../query/rankResults.mjs";

const SEVERITY_RANK = { error: 0, warning: 1 };
const MAX_IMPLICATED_PER_SIGNAL = 3;
const MAX_FAILURE_REASONS = 5;

// Which code does this signal point at? Uses the Brain's pass-1 retrieval (metadata +
// indexed content tokens, zero I/O) so the correlation works anywhere the manifest loads --
// including environments with no git checkout and no credentials.
export function correlateSignal(signal, manifestRecords, { topN = MAX_IMPLICATED_PER_SIGNAL } = {}) {
  const queryText = signal.correlation_query || signal.title || "";
  if (!queryText || !manifestRecords?.length) return [];
  const ranked = rankResults(searchRecords(manifestRecords, { queryText }));
  return ranked.slice(0, Math.max(0, topN)).map((entry) => ({
    source_path: entry.record.source_path,
    source_type: entry.record.source_type,
    symbol_or_section: entry.record.symbol_or_section,
    token_overlap: entry.matchSignals.tokenOverlapCount,
  }));
}

function groupKey(signal, implicated) {
  const topPath = implicated[0]?.source_path || "unknown";
  return `${signal.kind || "unknown"}||${topPath}`;
}

function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? SEVERITY_RANK.warning;
}

// Group signals into distinct undiscovered errors and rank them: errors before warnings,
// then by signal count (a problem hitting 5 deliveries outranks a one-off), then by recency.
export function detectUndiscoveredErrors({ signals, manifestRecords }) {
  const groups = new Map();

  for (const signal of signals || []) {
    const implicated = correlateSignal(signal, manifestRecords);
    const key = groupKey(signal, implicated);
    if (!groups.has(key)) {
      groups.set(key, {
        kind: signal.kind || "unknown",
        severity: signal.severity || "warning",
        title: signal.group_title || signal.title || signal.kind || "Unnamed signal",
        signal_count: 0,
        first_seen: signal.detected_at || null,
        last_seen: signal.detected_at || null,
        failure_reasons: [],
        sources: new Set(),
        implicated_code: implicated,
        diagnose_query: signal.correlation_query || signal.title || "",
        signal_ids: [],
      });
    }
    const group = groups.get(key);
    group.signal_count += 1;
    group.signal_ids.push(signal.signal_id);
    if (signal.source) group.sources.add(signal.source);
    // Keep the most severe rating any member signal carried.
    if (severityRank(signal.severity) < severityRank(group.severity)) {
      group.severity = signal.severity;
    }
    if (signal.detected_at) {
      if (!group.first_seen || signal.detected_at < group.first_seen) group.first_seen = signal.detected_at;
      if (!group.last_seen || signal.detected_at > group.last_seen) group.last_seen = signal.detected_at;
    }
    const reason = signal.evidence?.failure_reason || signal.evidence?.failure_message;
    if (reason && !group.failure_reasons.includes(reason) && group.failure_reasons.length < MAX_FAILURE_REASONS) {
      group.failure_reasons.push(reason);
    }
  }

  const errors = Array.from(groups.values()).map((group) => ({
    ...group,
    sources: Array.from(group.sources).sort(),
  }));

  errors.sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      b.signal_count - a.signal_count ||
      String(b.last_seen || "").localeCompare(String(a.last_seen || "")),
  );

  return {
    generated_at: new Date().toISOString(),
    signal_count: (signals || []).length,
    error_count: errors.length,
    errors,
  };
}
