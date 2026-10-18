/**
 * canonical.js — deterministic BigInt minor-unit arithmetic, exact
 * rationals, and canonical JSON for the Finance Agent prototype.
 * Pure Node 24 ESM, zero dependencies.
 *
 * Money is ALWAYS BigInt minor units (cents for USD scale2). Decimal
 * quantity/rate/tax inputs are signed integer/rational pairs with a
 * positive denominator, bounded to 6 decimal places and absolute
 * numerator <= 10^18. Rounding is half-away-from-zero, applied exactly
 * once per line for extension and tax.
 */

import { createHash } from "node:crypto";

export const HEX40 = /^[0-9a-f]{40}$/;

/** Canonical JSON: stable key ordering, no whitespace. */
export function canonicalJson(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "bigint") return `{"$bigint":"${v.toString()}"}`;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("nonfinite number in canonicalJson");
    return JSON.stringify(v);
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  }
  throw new Error(`uncodable type in canonicalJson: ${typeof v}`);
}

export function canonicalByteLength(v) {
  return Buffer.byteLength(canonicalJson(v), "utf8");
}

export function sha256HexUtf8(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Git blob SHA-1 with the "blob <len>\0" header. */
export function gitBlobId(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return createHash("sha1").update(Buffer.concat([header, bytes])).digest("hex");
}

/** Parse a signed decimal string into {num: BigInt, den: BigInt}.
 *  At most 6 decimal places; |numerator| <= 10^18 after scaling.
 *  Denominator is always a positive power of 10. */
export function parseDecimalToRational(s, where) {
  if (typeof s !== "string") throw new Error(`${where}: decimal must be a string`);
  const t = s.trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(t);
  if (!m) throw new Error(`${where}: malformed decimal '${s}' (max 6 decimal places)`);
  const sign = m[1] === "-" ? -1n : 1n;
  const digits = m[2] + (m[3] ?? "");
  const fracLen = (m[3] ?? "").length;
  const den = 10n ** BigInt(fracLen);
  const num = sign * BigInt(digits);
  if (num > 10n ** 18n || num < -(10n ** 18n)) {
    throw new Error(`${where}: decimal numerator exceeds 10^18`);
  }
  return { num, den };
}

/** Parse a signed integer string into BigInt. No decimals, no exponents. */
export function parseMinorUnits(s, where) {
  if (typeof s !== "string") throw new Error(`${where}: amount must be a string`);
  if (!/^-?\d+$/.test(s.trim())) throw new Error(`${where}: malformed integer '${s}'`);
  return BigInt(s.trim());
}

/** Round rational num/den to a whole number, half away from zero.
 *  den must be nonzero. Returns BigInt. */
export function roundHalfAway(num, den) {
  if (den === 0n) throw new Error("roundHalfAway: zero denominator");
  const sign = (num < 0n) !== (den < 0n) ? -1n : 1n;
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  const q = a / b;
  const r = a % b;
  const bumped = r * 2n >= b ? q + 1n : q;
  return sign * bumped;
}

/** Line extension in minor units: quantity_rational x unit_price_minor,
 *  rounded once half-away-from-zero. */
export function lineExtensionMinor(qty, unitPriceMinor) {
  return roundHalfAway(qty.num * unitPriceMinor, qty.den);
}

/** Line tax in minor units: extension_minor x rate_rational,
 *  rounded once half-away-from-zero. */
export function lineTaxMinor(extensionMinor, rate) {
  return roundHalfAway(extensionMinor * rate.num, rate.den);
}

/** Format BigInt minor units as a decimal string at the given scale.
 *  e.g. formatMinor(12345n, 2) -> "123.45"; formatMinor(-5n, 2) -> "-0.05". */
export function formatMinor(minor, scale) {
  const neg = minor < 0n;
  const a = neg ? -minor : minor;
  const s = a.toString().padStart(scale + 1, "0");
  const intPart = s.slice(0, s.length - scale);
  const fracPart = s.slice(s.length - scale);
  return `${neg ? "-" : ""}${intPart}.${fracPart}`;
}

/** Exact rational equality. */
export function rEquals(a, b) {
  if (a === null || b === null) return a === b;
  return a.num * b.den === b.num * a.den;
}

export function rational(num, den) {
  if (den === 0n) throw new Error("rational: zero denominator");
  if (den < 0n) return { num: -num, den: -den };
  return { num, den };
}
