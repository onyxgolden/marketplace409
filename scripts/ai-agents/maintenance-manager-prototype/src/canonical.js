/**
 * canonical.js — deterministic JSON canonicalization and hashing helpers.
 * Pure Node 24 ESM, node:crypto only. No model calls, no I/O.
 */

import { createHash } from "node:crypto";

function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v !== null && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortValue(v[k]);
    return out;
  }
  return v;
}

/** Canonical JSON: sorted keys, no whitespace. Throws on undefined. */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

/** SHA-256 hex of the UTF-8 canonical JSON of value. */
export function sha256HexUtf8(value) {
  return createHash("sha256").update(Buffer.from(canonicalJson(value), "utf8")).digest("hex");
}

/** SHA-256 hex of raw UTF-8 text/bytes (not JSON-canonicalized). */
export function sha256HexBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Canonical JSON byte length (UTF-8). */
export function canonicalByteLength(value) {
  return Buffer.byteLength(canonicalJson(value), "utf8");
}

/** Git blob object ID: sha1("blob <byteLength>\0" + bytes). Returns 40 lowercase hex. */
export function gitBlobId(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

/** Deep-clone via canonical JSON (detached snapshots). */
export function detached(value) {
  return JSON.parse(canonicalJson(value));
}

export const HEX40 = /^[0-9a-f]{40}$/;
export const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Maximum container-nesting depth of a parsed JSON value, where the
 * outermost object/array itself counts as depth 1. Iterative (explicit
 * stack), not recursive, so a pathologically deep/wide input cannot blow
 * the native call stack before the depth check itself has a chance to
 * refuse it.
 *
 * MM-S1-001: this is a STRUCTURAL preflight only. It uses own-property
 * descriptors and NEVER invokes accessor properties (getters/setters) —
 * they are skipped entirely without being read. Only data-descriptor
 * values that are themselves objects/arrays are descended into; leaf
 * values are never read. A throwing getter/proxy on the task path is
 * therefore never touched by the depth guard. Used for the task object
 * (which is caller-supplied and may carry accessors); the register uses
 * the byte-level maxJsonNestingDepth() on its raw text before parsing,
 * so parsed register candidates are never walked at all.
 */
export function maxContainerDepth(value) {
  let max = 0;
  const stack = [[value, 1]];
  while (stack.length) {
    const [v, d] = stack.pop();
    if (v !== null && typeof v === "object") {
      if (d > max) {
        max = d;
        if (max > MAX_CONTAINER_DEPTH) return max;
      }
      let keys;
      try {
        keys = Object.keys(v);
      } catch {
        continue;
      }
      for (const k of keys) {
        let desc;
        try {
          desc = Object.getOwnPropertyDescriptor(v, k);
        } catch {
          continue;
        }
        // Skip accessors entirely — never invoke user getters/setters.
        if (!desc || !("value" in desc)) continue;
        const child = desc.value;
        if (child !== null && typeof child === "object") {
          if (d >= MAX_CONTAINER_DEPTH) {
            // At the cap with a deeper container present — depth exceeds cap.
            return MAX_CONTAINER_DEPTH + 1;
          }
          stack.push([child, d + 1]);
        }
      }
    }
  }
  return max;
}

export const MAX_CONTAINER_DEPTH = 32;

/**
 * MM-S1-001: admit caller-supplied data into a bounded, data-only
 * snapshot. Walks OWN enumerable properties via descriptors ONLY —
 * accessor properties (get/set, i.e. descriptors without a "value") are
 * REJECTED without invocation (SchemaError). Each admitted object is
 * charged via budget.countObject() BEFORE any of its fields are read,
 * and the container depth cap is enforced during the walk itself, so
 * admission is bounded before any semantic inspection.
 *
 * Returns a plain JSON-safe deep copy containing only data values.
 * The caller MUST use the returned snapshot for ALL downstream work
 * (validation, hashing, budgeting, diagnostics) — never rewalk the raw
 * input, because rewalking (e.g. canonicalJson for a task_id) would
 * invoke the very accessors admission rejected.
 *
 * "__proto__" keys are defined as own data properties (not assigned),
 * so a crafted payload cannot re-prototype the snapshot.
 */
class AdmissionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AdmissionError";
    this.code = code;
  }
}

/**
 * MM-S1-001: admit caller-supplied data into a bounded, data-only
 * snapshot. Walks OWN enumerable properties via descriptors ONLY —
 * accessor properties (get/set, i.e. descriptors without a "value") are
 * REJECTED without invocation (AdmissionError). Each admitted object is
 * charged via budget.countObject() BEFORE any of its fields are read,
 * and the container depth cap is enforced during the walk itself, so
 * admission is bounded before any semantic inspection.
 *
 * Returns a plain JSON-safe deep copy containing only data values.
 * The caller MUST use the returned snapshot for ALL downstream work
 * (validation, hashing, budgeting, diagnostics) — never rewalk the raw
 * input, because rewalking (e.g. canonicalJson for a task_id) would
 * invoke the very accessors admission rejected.
 *
 * "__proto__" keys are defined as own data properties (not assigned),
 * so a crafted payload cannot re-prototype the snapshot.
 */
export function admitData(value, budget, what, depth = 1) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth > MAX_CONTAINER_DEPTH) {
    throw new AdmissionError("INPUT_LIMIT", `${what}: exceeds maximum container nesting depth of ${MAX_CONTAINER_DEPTH}`);
  }
  budget.countObject(what);
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i++) {
      const desc = Object.getOwnPropertyDescriptor(value, i);
      if (!desc || !("value" in desc)) {
        throw new AdmissionError("INVALID_INPUT", `${what}[${i}]: accessor properties are not admitted`);
      }
      out.push(admitData(desc.value, budget, `${what}[${i}]`, depth + 1));
    }
    return out;
  }
  const out = {};
  for (const k of Object.keys(value)) {
    const desc = Object.getOwnPropertyDescriptor(value, k);
    if (!desc || !("value" in desc)) {
      throw new AdmissionError("INVALID_INPUT", `${what}.${k}: accessor properties are not admitted`);
    }
    const child = admitData(desc.value, budget, `${what}.${k}`, depth + 1);
    Object.defineProperty(out, k, { value: child, enumerable: true, configurable: true, writable: true });
  }
  return out;
}

export { AdmissionError };

/**
 * Byte-level JSON nesting depth scanner (MM-S1-001). Computes the maximum
 * container nesting depth directly from raw JSON TEXT without parsing it
 * and without constructing any objects — candidate fields are never
 * materialized, let alone read. Tracks `{`/`[` depth while correctly
 * skipping over string literals (with escape handling). Depth semantics
 * match maxContainerDepth(): the outermost container counts as depth 1.
 *
 * Used for the register: the depth check runs on registerResolved.text
 * BEFORE JSON.parse, so no parsed register candidate is ever walked by
 * the guard. The text length is already bounded by the payload budget
 * (resolveSourceRef charges it), so the scan is linear in an already-
 * bounded input. Returns 0 for empty/non-JSON text (JSON.parse will then
 * refuse it as INVALID_INPUT separately); never throws.
 */
export function maxJsonNestingDepth(text) {
  if (typeof text !== "string" || text.length === 0) return 0;
  let max = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (c === 0x5c) { // backslash
        escaped = true;
      } else if (c === 0x22) { // quote
        inString = false;
      }
      continue;
    }
    if (c === 0x22) { // quote
      inString = true;
    } else if (c === 0x7b || c === 0x5b) { // { or [
      depth++;
      if (depth > max) max = depth;
      if (max > MAX_CONTAINER_DEPTH) return max; // early exit; already over cap
    } else if (c === 0x7d || c === 0x5d) { // } or ]
      if (depth > 0) depth--;
    }
  }
  return max;
}

/**
 * Exact rational number as {num, den} BigInts, always reduced, den > 0.
 * Used for the PM-compliance rate (exact n/d, never a lossy float) and
 * for day-count arithmetic that must stay exact across the whole audit.
 */
function bgcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

export function rational(num, den = 1n) {
  num = BigInt(num);
  den = BigInt(den);
  if (den === 0n) throw new RangeError("rational: denominator cannot be zero");
  if (den < 0n) { num = -num; den = -den; }
  const g = bgcd(num, den) || 1n;
  return { num: num / g, den: den / g };
}

export function rCompare(a, b) {
  const l = a.num * b.den;
  const r = b.num * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
}

export function rEquals(a, b) {
  return rCompare(a, b) === 0;
}

/** JSON-safe projection of a rational: BigInts become decimal strings. */
export function rToJSON(r) {
  if (r === null) return null;
  return { num: r.num.toString(), den: r.den.toString() };
}

/** Decimal display with half-away-from-zero rounding at `decimals` places. */
export function rToFixed(r, decimals) {
  const neg = r.num < 0n;
  const n = neg ? -r.num : r.num;
  const scale = 10n ** BigInt(decimals);
  const scaled = n * scale;
  const q = scaled / r.den;
  const rem = scaled % r.den;
  let finalQ = q;
  if (rem * 2n >= r.den) finalQ += 1n;
  const str = finalQ.toString().padStart(decimals + 1, "0");
  const intPart = str.slice(0, str.length - decimals) || "0";
  const fracPart = decimals > 0 ? str.slice(str.length - decimals) : "";
  const body = decimals > 0 ? `${intPart}.${fracPart}` : intPart;
  return (neg && finalQ !== 0n ? "-" : "") + body;
}

export function rToPercentFixed(r, decimals) {
  return rToFixed(rational(r.num * 100n, r.den), decimals);
}

/** Civil-calendar day index (days since the epoch, UTC, no DST/local
 *  calendar): used for age = as_of_day - created_day and all date-bin
 *  arithmetic. `ms` must already be a validated real calendar instant. */
export function dayIndexOfMs(ms) {
  return Math.floor(ms / 86400000);
}
