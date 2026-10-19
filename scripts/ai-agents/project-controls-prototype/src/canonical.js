// canonical.js — deterministic encoding + exact rational arithmetic helpers.
// All money is integer minor units (cents). Percents are rational {num, den}.
// No dependencies; BigInt exact throughout. No floating point anywhere.

/** Stable JSON stringify: sorted keys, no whitespace variance. */
export function canonicalStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortValue(v[k]);
    return out;
  }
  return v;
}

/** UTF-8 byte length of a string. */
export function utf8Length(s) {
  return Buffer.byteLength(s, 'utf8');
}

/**
 * Round rational n/d to `decimals` places, half-away-from-zero.
 * Returns a decimal string with exactly `decimals` digits after the point
 * (for decimals=0, an integer string).
 */
export function roundRational(n, d, decimals) {
  n = BigInt(n); d = BigInt(d);
  if (d === 0n) throw new Error('zero denominator in roundRational');
  const sign = (n < 0n) !== (d < 0n) ? -1n : 1n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const scale = 10n ** BigInt(decimals);
  const scaled = an * scale;
  let q = scaled / ad;
  const r = scaled % ad;
  if (2n * r >= ad) q += 1n; // half-away-from-zero
  const neg = sign < 0n && q !== 0n;
  const digits = q.toString().padStart(decimals + 1, '0');
  if (decimals === 0) return (neg ? '-' : '') + digits;
  const intPart = digits.slice(0, -decimals);
  const fracPart = digits.slice(-decimals);
  return (neg ? '-' : '') + intPart + '.' + fracPart;
}

/** Format integer minor units as dollars string, e.g. 12345 -> "123.45". */
export function formatMinor(minor) {
  return roundRational(BigInt(minor), 100n, 2);
}

/** Format a rational as 4-decimal display string. */
export function formatRatio(n, d) {
  return roundRational(n, d, 4);
}

/** Compare rational a/b with c/d: -1, 0, 1. */
export function cmpRational(an, ad, cn, cd) {
  const l = BigInt(an) * BigInt(cd);
  const r = BigInt(cn) * BigInt(ad);
  return l < r ? -1 : l > r ? 1 : 0;
}

/** Add rationals: returns {n, d} reduced-ish (not fully reduced, exact). */
export function addRational(an, ad, cn, cd) {
  return { n: BigInt(an) * BigInt(cd) + BigInt(cn) * BigInt(ad), d: BigInt(ad) * BigInt(cd) };
}

/** Multiply rationals. */
export function mulRational(an, ad, cn, cd) {
  return { n: BigInt(an) * BigInt(cn), d: BigInt(ad) * BigInt(cd) };
}

/** True if rational n/d is zero. */
export function isZero(n, d) {
  return BigInt(n) === 0n;
}

/** Sign of rational: -1, 0, 1. */
export function signRational(n, d) {
  const s = BigInt(n) * BigInt(d);
  return s < 0n ? -1 : s > 0n ? 1 : 0;
}
