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
    checkDepth(parsed.value, 0);
    return { fixture_id: fixtureId, record: parsed.value, spans: parsed.spans, bytes: entry.bytes };
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

/** Verify a SourceRef pin against the resolver store (synthetic repo).
 *  The pin's blob is the git blob SHA-1 of the canonical record WITHOUT the
 *  source_ref itself (avoids self-reference); commit is the fixed synthetic id.
 *  PC650-001: charges the parsed record candidates before inspection.
 */
export function verifySourceRef(ref, resolver) {
  const entry = resolver.store[ref.path];
  if (!entry) return { ok: false, reason: 'unknown fixture path' };
  // Charge the registry entry before reading its bytes
  resolver.chargeObject(entry);
  let record;
  try { record = JSON.parse(entry.bytes); } catch { return { ok: false, reason: 'unparseable bytes' }; }
  // Charge the parsed record and its top-level structure before walking.
  // The parsed object is a new candidate distinct from the entry.
  resolver.chargeObject(record);
  const { source_ref, ...rest } = record;
  void source_ref;
  // Charge the rest object before canonicalization reads it
  resolver.chargeObject(rest);
  const blob = gitBlobSha1(canonicalOf(rest));
  if (blob !== ref.blob) return { ok: false, reason: 'blob mismatch' };
  if (ref.commit !== SYNTHETIC_COMMIT) return { ok: false, reason: 'commit mismatch' };
  return { ok: true };
}

export const SYNTHETIC_COMMIT = '0'.repeat(40);

function canonicalOf(v) {
  // local stable stringify (resolver has no canonical.js dep cycle issue —
  // canonical.js is standalone, but keep resolver dependency-free anyway)
  return JSON.stringify(sortKeys(v));
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}
