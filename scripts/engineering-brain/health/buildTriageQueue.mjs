/**
 * buildTriageQueue.mjs — Slice 6: deterministic triage queue.
 *
 * Turns prioritized findings into a read-only, deduplicated, stably-ordered
 * queue for human triage. Pure, deterministic, zero I/O.
 *
 * Ordering (all deterministic):
 *   1. severity: critical → high → medium → low
 *   2. confidence: high → medium → low
 *   3. freshness: newer lastSeen first (null lastSeen sorts last)
 *   4. tie-breaker: finding id, lexicographic (stable across refreshes)
 *
 * Dedup: findings already carry stable Slice 5 ids; this module drops exact
 * duplicate ids (keeping the first) but never merges independent findings.
 * Two findings with different ids are different queue items, even if their
 * text is similar.
 *
 * Hard invariants:
 * - stable ids: the queue item id IS the finding id (no generated ids)
 * - no synthetic "resolved" state: a finding absent from this snapshot
 *   simply does not appear; disappearance is never reported as resolution
 * - money-moving capabilities are flagged, never labeled defective
 */

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 };

function compareQueueItems(a, b) {
  const sev = (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3);
  if (sev !== 0) return sev;

  const conf =
    (CONFIDENCE_RANK[a.confidence] ?? 2) - (CONFIDENCE_RANK[b.confidence] ?? 2);
  if (conf !== 0) return conf;

  // Newer lastSeen first; null sorts after any real timestamp.
  const aSeen = a.lastSeen ? Date.parse(a.lastSeen) : NaN;
  const bSeen = b.lastSeen ? Date.parse(b.lastSeen) : NaN;
  const aValid = Number.isFinite(aSeen);
  const bValid = Number.isFinite(bSeen);
  if (aValid && bValid && aSeen !== bSeen) return bSeen - aSeen;
  if (aValid !== bValid) return aValid ? -1 : 1;

  // Stable tie-breaker: lexicographic id.
  return String(a.id).localeCompare(String(b.id));
}

/**
 * @param {object} input
 * @param {Array} input.prioritized — from prioritizeFindings()
 * @returns {Array} ordered queue items (same objects, sorted; duplicates by id removed)
 */
export function buildTriageQueue({ prioritized = [] }) {
  const seen = new Set();
  const unique = [];
  for (const item of prioritized) {
    if (!item || !item.id) continue;
    if (seen.has(item.id)) continue; // exact-id dedup only
    seen.add(item.id);
    unique.push(item);
  }
  unique.sort(compareQueueItems);
  return unique;
}
