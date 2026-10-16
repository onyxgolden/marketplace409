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
 * refuse it. Used as a pre-inspection guard (MM-S1-001): admitted JSON
 * (the task and the parsed register) is checked for depth >32 BEFORE any
 * shape/field validation walks it.
 */
export function maxContainerDepth(value) {
  let max = 0;
  const stack = [[value, 1]];
  while (stack.length) {
    const [v, d] = stack.pop();
    if (v !== null && typeof v === "object") {
      if (d > max) max = d;
      const children = Array.isArray(v) ? v : Object.values(v);
      for (const c of children) stack.push([c, d + 1]);
    }
  }
  return max;
}

export const MAX_CONTAINER_DEPTH = 32;

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
