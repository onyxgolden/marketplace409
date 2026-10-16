/**
 * index.js — distill(snapshot) public entrypoint.
 *
 * Steps:
 *   1. Strict schema validation (unknown props rejected).
 *   2. Snapshot pin verification: sha256(canonicalJson(nodes)) must equal
 *      snapshot_digest — stale or tampered snapshots refuse, never distill.
 *   3. Deterministic distillation with a hard output-token budget.
 *
 * Output envelope: source identity/digest, tokenizer/version, retained
 * references, omissions with reasons, complete flag, distilled text.
 * References are valid only for that snapshot+frame; the output grants no
 * permission to click or otherwise act.
 *
 * Pure Node 24 ESM. Deterministic: same input bytes -> byte-identical output.
 */

import { validateSnapshot, SCHEMA_VERSION } from "./schemas.js";
import { canonicalJson, sha256HexUtf8 } from "./canonical.js";
import { distill, MAX_OUTPUT_TOKENS } from "./distill.js";
import { countTokens, tokenizerInfo } from "./tokenizer.js";

export const DISTILLER_VERSION = "dom-distill/1";
export { SCHEMA_VERSION, MAX_OUTPUT_TOKENS };

function boundName(name) {
  const cps = [...String(name)];
  return cps.length <= 160 ? cps.join("") : cps.slice(0, 160).join("") + "…[truncated]";
}

/**
 * verifyReferenceMap(envelope, snapshot): every map entry must name a real
 * snapshot node with matching role/name/frame and bind the snapshot digest.
 * Returns null when clean, else a human-readable failure string.
 * Context-only entries must still name real snapshot nodes.
 */
export function verifyReferenceMap(envelope, snapshot) {
  if (!envelope || typeof envelope !== "object" || !envelope.reference_map) {
    return "no reference map in envelope";
  }
  const byRef = new Map(snapshot.nodes.map(n => [n.ref, n]));
  for (const [ref, m] of Object.entries(envelope.reference_map)) {
    const n = byRef.get(ref);
    if (!n) return `map ref ${ref} is fabricated (no such snapshot node)`;
    if (m.snapshot_digest !== snapshot.snapshot_digest) return `map ref ${ref} binds wrong digest`;
    if (m.frame_id !== n.frame_id) return `map ref ${ref} binds wrong frame`;
    if (m.role !== n.role) return `map ref ${ref} role mismatch`;
    if (!m.context_only && m.name !== boundName(n.name)) return `map ref ${ref} name mismatch`;
  }
  return null;
}

/**
 * Baseline serialization: the canonical JSON of the full snapshot, i.e.
 * what would be handed to a model WITHOUT distillation. Token counts for
 * both baseline and distilled output use the same pinned tokenizer.
 */
export function baselineText(snapshot) {
  return canonicalJson(snapshot);
}

export function baselineTokens(snapshot) {
  return countTokens(baselineText(snapshot));
}

export function distillSnapshot(snapshot) {
  let validated;
  try {
    validated = validateSnapshot(snapshot);
  } catch (e) {
    return {
      status: "REFUSED",
      reason: "SCHEMA",
      detail: String(e.message || e),
      complete: false,
      reference_map: null,
      distilled_text: null,
    };
  }

  // Pin verification BEFORE any distillation work touches node fields.
  const nodesArray = [...validated.nodes.values()].sort((a, b) => (a.ref < b.ref ? -1 : 1));
  const computed = sha256HexUtf8(nodesArray);
  if (computed !== snapshot.snapshot_digest) {
    return {
      status: "REFUSED",
      reason: "STALE_SNAPSHOT",
      detail: "snapshot_digest does not match canonical nodes; refs may be stale",
      complete: false,
      reference_map: null,
      distilled_text: null,
    };
  }

  const out = distill(validated, snapshot.snapshot_digest);
  const tok = tokenizerInfo();
  return {
    distiller_version: DISTILLER_VERSION,
    tokenizer: tok.id,
    tokenizer_source: tok.source,
    source: {
      fixture_id: snapshot.fixture_id,
      build_id: snapshot.build_id,
      snapshot_digest: snapshot.snapshot_digest,
      document: snapshot.document,
      task: snapshot.task,
    },
    baseline_tokens: baselineTokens(snapshot),
    ...out,
  };
}
