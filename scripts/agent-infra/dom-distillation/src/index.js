/**
 * index.js — distill(snapshot) public entrypoint.
 *
 * Steps:
 *   1. Strict schema validation (unknown props rejected).
 *   2. Snapshot pin verification: the canonical snapshot identity
 *      (schema/document/build/task/frame topology + node content) must
 *      equal snapshot_digest — stale or tampered snapshots refuse, never
 *      distill. The pin is RECOMPUTED, never trusted.
 *   3. Bounded graph validation (acyclic, single-parent, valid roots,
 *      full root coverage, depth cap) — malformed graphs refuse, never hang.
 *   4. Deterministic distillation with a hard output-token budget.
 *
 * Output envelope: source identity/pin, tokenizer/version, retained
 * references, omissions with reasons, complete flag, distilled text.
 * References are valid only for that snapshot+frame; the output grants no
 * permission to click or otherwise act.
 *
 * Source metadata in the envelope is DETACHED (deep-cloned): mutating the
 * envelope never retroactively changes the caller's snapshot, and vice
 * versa.
 *
 * Pure Node 24 ESM. Deterministic: same input bytes -> byte-identical output.
 */

import { validateSnapshot, SCHEMA_VERSION, ROLES } from "./schemas.js";
import { canonicalJson, sha256HexUtf8 } from "./canonical.js";
import { validateGraph } from "./graph.js";
import { distill, MAX_OUTPUT_TOKENS } from "./distill.js";
import { countTokens, tokenizerInfo } from "./tokenizer.js";
import { setRoleVocabulary } from "./parse.js";

setRoleVocabulary(ROLES);

export const DISTILLER_VERSION = "dom-distill/1";
export { SCHEMA_VERSION, MAX_OUTPUT_TOKENS };

function detached(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Canonical snapshot identity (DOM-004).
 * Covers: schema version, fixture/build identity, document identity
 * (url+title), task identity, frame topology (frame ids in declared order
 * with their root refs), and full node content (sorted by ref).
 * Changing any of these changes the pin. Verification recomputes this
 * from the presented snapshot — a submitted digest string is never trusted.
 */
export function snapshotPin(snap) {
  const nodesSorted = [...snap.nodes].sort((a, b) => (a.ref < b.ref ? -1 : 1));
  return sha256HexUtf8({
    schema_version: snap.schema_version,
    fixture_id: snap.fixture_id,
    build_id: snap.build_id,
    document: snap.document,
    task: snap.task,
    frames: snap.frames,
    nodes: nodesSorted,
  });
}

/**
 * verifyReferenceMap(envelope, snapshot): full source/head/frame binding.
 * - Recomputes the snapshot pin from `snapshot` and requires the
 *   envelope's claimed pin to equal it (stale content with an unchanged
 *   digest string fails here).
 * - Requires envelope source identity (fixture/build/document) to agree
 *   with the snapshot.
 * - Every map entry: key === m.ref; entry pin === recomputed pin; entry
 *   names a real snapshot node with matching role/name/frame; entry source
 *   binding agrees with the snapshot.
 * Returns null when clean, else a human-readable failure string.
 */
export function verifyReferenceMap(envelope, snapshot) {
  if (!envelope || typeof envelope !== "object" || !envelope.reference_map) {
    return "no reference map in envelope";
  }
  if (!envelope.source || typeof envelope.source !== "object") {
    return "no source identity in envelope";
  }
  let pin;
  try {
    pin = snapshotPin(snapshot);
  } catch (e) {
    return `cannot recompute snapshot pin: ${e.message}`;
  }
  if (envelope.source.snapshot_pin !== pin) {
    return "envelope source pin does not match recomputed snapshot pin";
  }
  if (envelope.source.fixture_id !== snapshot.fixture_id) {
    return "envelope source fixture_id does not match snapshot";
  }
  if (envelope.source.build_id !== snapshot.build_id) {
    return "envelope source build_id does not match snapshot";
  }
  if (!envelope.source.document || envelope.source.document.url !== snapshot.document.url) {
    return "envelope source document does not match snapshot";
  }
  const byRef = new Map(snapshot.nodes.map(n => [n.ref, n]));
  for (const [key, m] of Object.entries(envelope.reference_map)) {
    if (!m || typeof m !== "object") return `map entry ${key} is not an object`;
    if (m.ref !== key) return `map entry key ${key} disagrees with m.ref ${JSON.stringify(m.ref)}`;
    if (m.snapshot_pin !== pin) return `map ref ${key} binds wrong snapshot pin`;
    const n = byRef.get(key);
    if (!n) return `map ref ${key} is fabricated (no such snapshot node)`;
    if (m.frame_id !== n.frame_id) return `map ref ${key} binds wrong frame`;
    if (m.role !== n.role) return `map ref ${key} role mismatch`;
    if (m.name !== n.name) return `map ref ${key} name mismatch`;
    if (!m.source || m.source.fixture_id !== snapshot.fixture_id) {
      return `map ref ${key} source fixture_id mismatch`;
    }
    if (m.source.build_id !== snapshot.build_id) {
      return `map ref ${key} source build_id mismatch`;
    }
    if (m.source.document_url !== snapshot.document.url) {
      return `map ref ${key} source document_url mismatch`;
    }
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

/**
 * The model-bound payload (see PAYLOAD.md): distilled_text ONLY.
 * The reference map, source envelope, omissions and counts are host-side
 * and never sent. The benchmark measures exactly this payload.
 */
export function payloadText(out) {
  return out.distilled_text;
}

export function payloadTokens(out) {
  return out.distilled_text === null ? null : countTokens(out.distilled_text);
}

export function distillSnapshot(snapshot) {
  let validated;
  try {
    validated = validateSnapshot(snapshot);
  } catch (e) {
    return {
      status: "REFUSED",
      reason: "SCHEMA",
      detail: String((e && e.message) || e),
      complete: false,
      reference_map: null,
      distilled_text: null,
    };
  }

  // Pin verification BEFORE any distillation work touches node fields.
  // The pin covers schema/document/build/task/frame topology + nodes.
  let pin;
  try {
    pin = snapshotPin(snapshot);
  } catch (e) {
    return {
      status: "REFUSED",
      reason: "STALE_SNAPSHOT",
      detail: `cannot compute snapshot pin: ${String((e && e.message) || e)}`,
      complete: false,
      reference_map: null,
      distilled_text: null,
    };
  }
  if (pin !== snapshot.snapshot_digest) {
    return {
      status: "REFUSED",
      reason: "STALE_SNAPSHOT",
      detail: "snapshot_digest does not match canonical snapshot identity; refs may be stale",
      complete: false,
      reference_map: null,
      distilled_text: null,
    };
  }

  // Bounded graph validation BEFORE distillation: cycles, multi-parent,
  // invalid roots and disconnected coverage refuse here — never hang.
  let parentOf;
  try {
    parentOf = validateGraph(validated.frames, validated.nodes);
  } catch (e) {
    return {
      status: "REFUSED",
      reason: "INVALID_GRAPH",
      detail: String((e && e.message) || e),
      complete: false,
      reference_map: null,
      distilled_text: null,
    };
  }

  const out = distill(validated, pin, parentOf, {
    fixture_id: snapshot.fixture_id,
    build_id: snapshot.build_id,
    document_url: snapshot.document.url,
  });
  const tok = tokenizerInfo();
  return {
    distiller_version: DISTILLER_VERSION,
    tokenizer: tok.id,
    tokenizer_source: tok.source,
    source: {
      fixture_id: snapshot.fixture_id,
      build_id: snapshot.build_id,
      snapshot_pin: pin,
      document: detached(snapshot.document),
      task: detached(snapshot.task),
    },
    baseline_tokens: baselineTokens(snapshot),
    ...out,
  };
}
