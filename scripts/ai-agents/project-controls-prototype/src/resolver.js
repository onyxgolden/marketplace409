// resolver.js — deterministic fixture resolver with a monotonic budget.
// Every candidate object is charged BEFORE inspection. Attempt 65 refuses.
// Budget: 256 KiB total input, 64 consulted objects, 512 checked spans,
// 256 output records, 256 KiB final output.

import { createHash } from 'node:crypto';
import { utf8Length } from './canonical.js';
import { parseWithSpans } from './spans.js';

export const LIMITS = {
  maxInputBytes: 256 * 1024,
  maxObjects: 64,
  maxSpans: 512,
  maxOutputRecords: 256,
  maxOutputBytes: 256 * 1024,
  maxDepth: 32,
};

export class BudgetExceeded extends Error {
  constructor(what) {
    super(`BUDGET_EXCEEDED: ${what}`);
    this.code = 'BUDGET_EXCEEDED';
  }
}

export class InputLimit extends Error {
  constructor(what) {
    super(`INPUT_LIMIT: ${what}`);
    this.code = 'INPUT_LIMIT';
  }
}

/** Git blob SHA-1 of UTF-8 bytes (with the git blob header). */
export function gitBlobSha1(text) {
  const bytes = Buffer.from(text, 'utf8');
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

/** SHA-256 hex of UTF-8 bytes. */
export function sha256Hex(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

export class Resolver {
  constructor(store) {
    // store: { fixture_id: { bytes: string, sha256: string, media_type: string } }
    this.store = store;
    this.objectsCharged = 0;
    this.spansCharged = 0;
    this.inputBytesCharged = 0;
    this.outputRecordsCharged = 0;
    // PC650-001: track distinct objects to make charging idempotent.
    // The 64-object budget counts DISTINCT candidate objects; re-visiting
    // an already-charged object (e.g., during validation after admission)
    // does not consume budget again.
    this._chargedObjects = new WeakSet();
  }

  /**
   * Charge one consulted object; throws BudgetExceeded at 65.
   * Idempotent: charging the same object twice counts once.
   * Only objects/arrays/functions are counted; primitives are ignored.
   * If obj is undefined, counts unconditionally (for synthetic candidates).
   */
  chargeObject(obj) {
    if (obj === undefined) {
      // Synthetic candidate (e.g., array slot): count unconditionally
      this.objectsCharged += 1;
    } else if (obj !== null && (typeof obj === 'object' || typeof obj === 'function')) {
      if (this._chargedObjects.has(obj)) return;
      this._chargedObjects.add(obj);
      this.objectsCharged += 1;
    } else {
      // Primitive: not a candidate, do not count
      return;
    }
    if (this.objectsCharged > LIMITS.maxObjects) {
      throw new BudgetExceeded(`object ${this.objectsCharged} exceeds ${LIMITS.maxObjects}`);
    }
  }

  /** Charge input bytes; throws InputLimit over 256 KiB. */
  chargeInputBytes(n) {
    this.inputBytesCharged += n;
    if (this.inputBytesCharged > LIMITS.maxInputBytes) {
      throw new InputLimit(`input bytes ${this.inputBytesCharged} exceed ${LIMITS.maxInputBytes}`);
    }
  }

  /** Charge one checked span; throws BudgetExceeded at 513. */
  chargeSpan() {
    this.spansCharged += 1;
    if (this.spansCharged > LIMITS.maxSpans) {
      throw new BudgetExceeded(`span ${this.spansCharged} exceeds ${LIMITS.maxSpans}`);
    }
  }

  /** Charge one output record; throws at 257. */
  chargeOutputRecord() {
    this.outputRecordsCharged += 1;
    if (this.outputRecordsCharged > LIMITS.maxOutputRecords) {
      throw new BudgetExceeded(`output record ${this.outputRecordsCharged} exceeds ${LIMITS.maxOutputRecords}`);
    }
  }

  /**
   * Resolve a fixture ref to its parsed object. Charges the object and its
   * bytes BEFORE inspection; verifies SHA-256 of registered bytes.
   * Parses with byte-span tracking so every operand can carry a verified
   * citation. Returns { fixture_id, record, spans, bytes } or throws
   * {code: READ_DENIED|HASH_MISMATCH}.
   *
   * PC650-004: the CITED DOCUMENT is the canonical bytes of the record
   * WITHOUT source_ref. The source_ref.blob pin authenticates EXACTLY these
   * bytes (git blob SHA-1). Spans for citations are computed over the cited
   * bytes, so the blob, the spans, and the quoted slices all refer to the
   * same source document — no self-reference discrepancy.
   */
  resolve(fixtureId) {
    // PC650-001: charge the registry entry candidate BEFORE reading its fields.
    // The entry object is charged idempotently (distinct objects); repeated
    // resolutions of the same fixture do not consume additional budget.
    // The per-ref budget is enforced during task admission (checkTask charges
    // each fixture_ref), so 65 refs refuse before resolution begins.
    const entry = this.store[fixtureId];
    if (!entry) {
      // Charge a synthetic candidate for the failed lookup
      this.chargeObject();
      const e = new Error(`READ_DENIED: unknown fixture ${fixtureId}`);
      e.code = 'READ_DENIED';
      throw e;
    }
    this.chargeObject(entry);
    this.chargeInputBytes(utf8Length(entry.bytes));
    const actual = sha256Hex(entry.bytes);
    if (actual !== entry.sha256) {
      const e = new Error(`HASH_MISMATCH: fixture ${fixtureId}`);
      e.code = 'HASH_MISMATCH';
      throw e;
    }
    let parsed;
    try {
      parsed = parseWithSpans(entry.bytes);
    } catch {
      const e = new Error(`INVALID_INPUT: fixture ${fixtureId} is not JSON`);
      e.code = 'INVALID_INPUT';
      throw e;
    }
    // PC650-001: charge the parsed record before inspection.
    this.chargeObject(parsed.value);
    // PC650-004: build the cited document (without source_ref) with charged
    // canonicalization. The cited bytes are what the blob pin authenticates
    // and what citation spans refer to.
    const { source_ref: pin, ...rest } = parsed.value;
    const citedBytes = chargedCanonicalOf(rest, this);
    if (citedBytes === null) {
      const e = new Error(`INVALID_INPUT: fixture ${fixtureId} cited-document admission failed`);
      e.code = 'INVALID_INPUT';
      throw e;
    }
    let cited;
    try {
      cited = parseWithSpans(citedBytes);
    } catch {
      const e = new Error(`INVALID_INPUT: fixture ${fixtureId} cited bytes unparseable`);
      e.code = 'INVALID_INPUT';
      throw e;
    }
    return {
      fixture_id: fixtureId,
      record: parsed.value,       // full record WITH source_ref (for validation)
      sourceRef: pin,            // the source_ref pin (may be undefined if absent)
      spans: parsed.spans,       // spans over full bytes (reference)
      bytes: entry.bytes,        // full registered bytes
      citedRecord: cited.value,  // record WITHOUT source_ref
      citedBytes,                // canonical bytes WITHOUT source_ref (blob-authenticated)
      citedSpans: cited.spans,   // spans over citedBytes (for citations)
    };
  }
}

function checkDepth(v, depth) {
  if (depth > LIMITS.maxDepth) {
    const e = new Error('INVALID_INPUT: nesting depth exceeds 32');
    e.code = 'INVALID_INPUT';
    throw e;
  }
  if (Array.isArray(v)) {
    for (const x of v) checkDepth(x, depth + 1);
  } else if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v)) checkDepth(v[k], depth + 1);
  }
}

/** Verify a SourceRef pin against the cited document bytes.
 *  PC650-004: the pin's blob is the git blob SHA-1 of the CITED BYTES — the
 *  canonical record WITHOUT source_ref. This is the exact document that
 *  citation spans refer to. The blob authenticates the cited bytes; no
 *  self-reference workaround changes the source document.
 *  ref: the source_ref pin {repo, path, commit, blob, algorithm, revision}.
 *  citedBytes: canonical JSON string of the record without source_ref.
 *  Returns {ok, reason}.
 */
export function verifySourceRef(ref, citedBytes) {
  if (!ref || typeof ref !== 'object') return { ok: false, reason: 'missing source_ref pin' };
  if (typeof citedBytes !== 'string') return { ok: false, reason: 'missing cited bytes' };
  const blob = gitBlobSha1(citedBytes);
  if (blob !== ref.blob) return { ok: false, reason: `blob mismatch: pin ${ref.blob} != cited bytes ${blob}` };
  if (ref.commit !== SYNTHETIC_COMMIT) return { ok: false, reason: 'commit mismatch' };
  return { ok: true };
}

export const SYNTHETIC_COMMIT = '0'.repeat(40);

/**
 * PC650-001: charged canonical serialization. Walks the value with the
 * resolver budget, charging each object/array BEFORE reading its fields.
 * Uses descriptor-safe reads (no getter invocation). Returns the canonical
 * JSON string, or null if the budget is exceeded or an accessor is found.
 * This ensures verifySourceRef's reparse consumes the same admission
 * contract as the primary path — no uncharged descendant traversal.
 */
function chargedCanonicalOf(v, resolver, depth = 0) {
  // PC650-001: BudgetExceeded propagates (it's a budget refusal, not an
  // admission failure). Other errors (accessors, depth, type) return null.
  try {
    return chargedCanonicalInner(v, resolver, depth);
  } catch (e) {
    if (e && e.code === 'BUDGET_EXCEEDED') throw e;
    return null;
  }
}

function chargedCanonicalInner(v, resolver, depth) {
  if (depth > LIMITS.maxDepth) throw new InputLimit('provenance: depth exceeds 32');
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new InputLimit('provenance: non-finite number');
    return String(v);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v !== 'object') throw new InputLimit('provenance: unsupported value');
  // Charge BEFORE any key/descriptor inspection.
  resolver.chargeObject(v);
  // Descriptor-safe: reject accessors without executing them.
  const keys = Object.keys(v);
  for (const k of keys) {
    const desc = Object.getOwnPropertyDescriptor(v, k);
    if (!desc || typeof desc.get === 'function' || typeof desc.set === 'function') {
      throw new InputLimit('provenance: accessor or missing descriptor');
    }
  }
  if (Array.isArray(v)) {
    // Sparse check: every index must have a descriptor.
    for (let i = 0; i < v.length; i++) {
      if (!Object.getOwnPropertyDescriptor(v, i)) {
        throw new InputLimit('provenance: sparse array');
      }
    }
    const parts = v.map((x) => chargedCanonicalInner(x, resolver, depth + 1));
    return '[' + parts.join(',') + ']';
  }
  const parts = [];
  for (const k of keys.sort()) {
    const desc = Object.getOwnPropertyDescriptor(v, k);
    parts.push(JSON.stringify(k) + ':' + chargedCanonicalInner(desc.value, resolver, depth + 1));
  }
  return '{' + parts.join(',') + '}';
}
