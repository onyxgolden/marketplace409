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

/** SHA-256 hex of raw UTF-8 text (not JSON-canonicalized). */
export function sha256HexText(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
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
 * Exact rational number as {num, den} BigInts, always reduced, den > 0.
 * Used so means/ratios/displays never pick up floating-point error — the
 * brief requires an "exact rational sum/count" and rounding that "never
 * decides equality" against claimed header values.
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

export function rAdd(a, b) {
  return rational(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function rDiv(a, b) {
  if (b.num === 0n) throw new RangeError("rational: division by zero");
  return rational(a.num * b.den, a.den * b.num);
}

export function rCompare(a, b) {
  const l = a.num * b.den;
  const r = b.num * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
}

export function rEquals(a, b) {
  return rCompare(a, b) === 0;
}

/** JSON-safe projection of a rational: BigInts become decimal strings
 *  (JSON.stringify cannot serialize BigInt at all, and a JS Number could
 *  silently lose precision — a string keeps the value exact). */
export function rToJSON(r) {
  if (r === null) return null;
  return { num: r.num.toString(), den: r.den.toString() };
}

/** Decimal display with half-away-from-zero rounding at `decimals` places. */
export function rToFixed(r, decimals) {
  const neg = r.num < 0n;
  const n = neg ? -r.num : r.num;
  const scale = 10n ** BigInt(decimals);
  // value = n/den; scaled = n*scale/den, with half-away-from-zero carry
  // when the remainder is at least half of the denominator.
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

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/**
 * Exact rational from a finite JS number, by round-tripping through its
 * canonical decimal string (JS's double-to-string is shortest-round-trip,
 * so `(3.8).toString() === "3.8"`): this recovers the author's intended
 * exact decimal value instead of the binary float's true (inexact) value.
 * Used so a header claim like 3.8 is compared against computed metrics
 * as the exact rational 19/5, never as an imprecise float — "like-for-
 * like rational values," per the brief; display rounding plays no part
 * in the equality decision.
 */
export function numberToExactRational(n) {
  if (!Number.isFinite(n)) throw new RangeError("numberToExactRational: not finite");
  const s = n.toString();
  if (!DECIMAL_RE.test(s)) throw new RangeError(`numberToExactRational: unsupported numeric literal '${s}'`);
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [intPart, fracPart = ""] = body.split(".");
  const den = 10n ** BigInt(fracPart.length);
  const num = BigInt(intPart + fracPart) * (neg ? -1n : 1n);
  return rational(num, den);
}
