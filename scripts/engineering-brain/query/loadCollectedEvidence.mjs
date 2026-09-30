import { readFileSync } from "node:fs";
import { hasUsableEvidence } from "./rerankImplicatedCode.mjs";

/**
 * loadCollectedEvidence.mjs — bridge the nightly evidence collector into diagnosis.
 *
 * The collector (signals/collectEvidenceCli.mjs) writes evidence.json:
 *   { schema_version, collected_at, repo, evidence: { <signal_id>: {...} } }
 * Each per-signal entry carries provenance (signal_id, kind, collected_at) plus
 * the failure facts: { failed_step, error_lines[], mentioned_paths[] } for CI
 * failures, { status, failure_reason } for delivery signals.
 *
 * This loader reads that file, keeps only signals with substantive failure
 * evidence (the same predicate the re-ranker uses, so a kept signal is always
 * one the re-ranker can act on), and selects the one the caller names.
 * Everything except the file read is pure. Fail-closed throughout: a missing
 * file, malformed JSON, or zero usable signals throws with a message that says
 * what to do instead of letting diagnosis run un-ranked and look ranked.
 *
 * Deliberately generic: any evidence record with provenance plus
 * failed_step/error_lines/mentioned_paths works — nothing here is CI-specific,
 * so a future local evidence source (e.g. a machine-health collector) can feed
 * the same interface without changes.
 */

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Normalize a parsed evidence payload into a signal list.
 * Accepts the collector envelope ({ evidence: { id: {...} } }) and, defensively,
 * a bare { id: {...} } map. Returns { signals, warnings }.
 * Signals that failed collection ({ status: "error" }) or carry no substantive
 * evidence are excluded with a warning — never silently treated as usable.
 */
export function parseCollectedEvidence(payload) {
  const warnings = [];
  if (!isRecord(payload)) {
    throw new Error("collected evidence payload must be a JSON object");
  }
  const map = isRecord(payload.evidence) ? payload.evidence : payload;
  const signals = [];
  for (const [signalId, entry] of Object.entries(map)) {
    if (signalId === "schema_version" || signalId === "collected_at" || signalId === "repo") continue;
    if (!isRecord(entry)) {
      warnings.push(`signal "${signalId}" skipped: not an object`);
      continue;
    }
    if (entry.status === "error") {
      warnings.push(`signal "${signalId}" skipped: collection failed (${entry.error || "unknown error"})`);
      continue;
    }
    const signal = { signal_id: signalId, ...entry };
    if (!hasUsableEvidence(signal)) {
      warnings.push(`signal "${signalId}" skipped: no usable failure evidence (no failed_step, error_lines, or mentioned_paths)`);
      continue;
    }
    signals.push(signal);
  }
  return { signals, warnings };
}

/** Read and parse an evidence.json file. Throws on missing file / bad JSON. */
export function loadCollectedEvidenceFile(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`cannot read evidence file "${filePath}": ${error.message}`);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(`evidence file "${filePath}" is not valid JSON: ${error.message}`);
  }
  return parseCollectedEvidence(payload);
}

/**
 * Pick the signal to re-rank with. Never guesses: exactly one usable signal is
 * auto-selected; several require an explicit id; zero or an unknown id throws
 * with the available ids listed.
 */
export function selectEvidenceSignal(signals, signalId) {
  const list = Array.isArray(signals) ? signals : [];
  if (list.length === 0) {
    throw new Error("no usable evidence signals in the evidence file");
  }
  if (signalId == null || signalId === "") {
    if (list.length === 1) return list[0];
    const ids = list.map((s) => s.signal_id).join(", ");
    throw new Error(
      `evidence file holds ${list.length} usable signals; pass --signal with one of: ${ids}`,
    );
  }
  const found = list.find((s) => s.signal_id === String(signalId));
  if (!found) {
    const ids = list.map((s) => s.signal_id).join(", ");
    throw new Error(`unknown signal "${signalId}"; available: ${ids}`);
  }
  return found;
}
