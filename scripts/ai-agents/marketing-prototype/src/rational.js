/**
 * rational.js — exact integer/rational arithmetic on BigInt.
 *
 * No binary floats anywhere: every rate is a reduced {n, d} pair with
 * d > 0, every money total is a BigInt of minor units. Display rounding
 * (percentages to 2 decimals, ROAS to 4) is half-away-from-zero, computed
 * exactly from the rational. Comparisons use exact values, never display
 * strings.
 */

function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** Reduced rational n/d with d > 0. d must be nonzero. */
export function rat(n, d) {
  n = BigInt(n);
  d = BigInt(d);
  if (d === 0n) throw new RangeError("rational: zero denominator");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export function ratEq(a, b) {
  return a.n === b.n && a.d === b.d;
}

/** -1 | 0 | 1 */
export function ratCmp(a, b) {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
}

/**
 * Parse an exact decimal string into a rational. Accepts an optional
 * trailing "%" (percent → hundredths) and an optional leading sign.
 * Examples: "5.00%" → 1/20, "2.0000" → 2/1, "0.05" → 1/20.
 * Returns null when the text is not an exact decimal.
 */
export function parseDecimal(text) {
  if (typeof text !== "string") return null;
  let s = text.trim();
  if (s.length === 0 || s.length > 64) return null;
  let percent = false;
  if (s.endsWith("%")) {
    percent = true;
    s = s.slice(0, -1).trim();
  }
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const neg = m[1] === "-";
  const intPart = m[2].replace(/^0+(?=\d)/, "") || "0";
  const fracPart = m[3] ?? "";
  if (intPart.length + fracPart.length > 40) return null;
  let n = BigInt(intPart + fracPart || "0");
  let d = 10n ** BigInt(fracPart.length);
  if (percent) d *= 100n;
  if (neg) n = -n;
  return rat(n, d);
}

/**
 * Format a non-negative rational with `decimals` digits after the point,
 * rounding half-away-from-zero. Returns the plain decimal string.
 * All marketing metrics are non-negative, so only the positive path is
 * exercised; negatives still round away from zero for completeness.
 */
export function formatFixed(r, decimals) {
  const scale = 10n ** BigInt(decimals);
  const neg = r.n < 0n;
  const an = neg ? -r.n : r.n;
  // scaled = round_half_away(an * scale / d)
  const num = an * scale;
  let q = num / r.d;
  const rem = num % r.d;
  if (rem * 2n >= r.d) q += 1n;
  const intDigits = q / scale;
  const fracDigits = q % scale;
  const frac = fracDigits.toString().padStart(decimals, "0");
  const body = decimals === 0 ? intDigits.toString() : `${intDigits.toString()}.${frac}`;
  return neg && q !== 0n ? `-${body}` : body;
}

/** Percentage display: 2 decimals + "%", e.g. 1/20 → "5.00%". */
export function formatPercent(r) {
  return `${formatFixed(rat(r.n * 100n, r.d), 2)}%`;
}

/** ROAS display: 4 decimals, e.g. 200005/100000 → "2.0001". */
export function formatRoas(r) {
  return formatFixed(r, 4);
}

/** Exact "n/d" string for diagnostics. */
export function exactString(r) {
  return `${r.n.toString()}/${r.d.toString()}`;
}
