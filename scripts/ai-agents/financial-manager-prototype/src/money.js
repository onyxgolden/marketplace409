/**
 * money.js — exact monetary arithmetic. Amounts are signed integer decimal
 * strings parsed as BigInt (never float). The fractional-minor variant is an
 * exact rational {numerator, denominator} of decimal strings with a positive
 * denominator. Accumulation is rational; rounding to integer minor units
 * happens ONCE at the displayed section total, half-away-from-zero.
 * Percentages are exact ratios displayed at two decimals, same rounding;
 * a zero budget yields NOT_COMPARABLE (never infinity or 0%).
 */

export const NOT_COMPARABLE = "NOT_COMPARABLE";

const INT_RE = /^-?(0|[1-9][0-9]*)$/;
const POS_INT_RE = /^[1-9][0-9]*$/;

export function isIntegerMinorString(s) {
  return typeof s === "string" && INT_RE.test(s);
}

export function isRationalAmount(a) {
  return (
    a !== null &&
    typeof a === "object" &&
    !Array.isArray(a) &&
    typeof a.numerator === "string" &&
    typeof a.denominator === "string" &&
    INT_RE.test(a.numerator) &&
    POS_INT_RE.test(a.denominator)
  );
}

/** Parse an amount into an exact rational {n, d} with d > 0. Throws on invalid. */
export function parseAmount(a) {
  if (isIntegerMinorString(a)) return { n: BigInt(a), d: 1n };
  if (isRationalAmount(a)) return { n: BigInt(a.numerator), d: BigInt(a.denominator) };
  throw new Error("parseAmount: invalid amount");
}

export function addR(x, y) {
  return { n: x.n * y.d + y.n * x.d, d: x.d * y.d };
}

export function subR(x, y) {
  return { n: x.n * y.d - y.n * x.d, d: x.d * y.d };
}

export function eqR(x, y) {
  return x.n * y.d === y.n * x.d;
}

export function signR(x) {
  if (x.n > 0n) return 1;
  if (x.n < 0n) return -1;
  return 0;
}

export function zeroR() {
  return { n: 0n, d: 1n };
}

/**
 * Round the rational n/d to an integer, half-away-from-zero.
 * BigInt division truncates toward zero, so:
 *   n >= 0 : (2n + d) / 2d
 *   n <  0 : (2n - d) / 2d
 */
export function roundHalfAway(n, d) {
  if (d <= 0n) throw new Error("roundHalfAway: non-positive denominator");
  if (n >= 0n) return (2n * n + d) / (2n * d);
  return (2n * n - d) / (2n * d);
}

export function roundRationalHalfAway(r) {
  return roundHalfAway(r.n, r.d);
}

/** Format an integer minor-unit BigInt as major units with `scale` decimals. */
export function fmtMinor(minor, scale) {
  if (typeof minor === "bigint") {
    // ok
  } else {
    throw new Error("fmtMinor: expected bigint");
  }
  if (!Number.isInteger(scale) || scale < 0 || scale > 6) {
    throw new Error("fmtMinor: bad scale");
  }
  const neg = minor < 0n;
  const a = neg ? -minor : minor;
  if (scale === 0) return (neg ? "-" : "") + a.toString();
  let s = a.toString().padStart(scale + 1, "0");
  const intPart = s.slice(0, s.length - scale);
  const fracPart = s.slice(s.length - scale);
  return (neg ? "-" : "") + intPart + "." + fracPart;
}

/**
 * Format the exact ratio variance/budget as a percentage string with two
 * decimals, half-away-from-zero. Returns NOT_COMPARABLE when budget is zero.
 */
export function fmtPct(variance, budget) {
  if (signR(budget) === 0) return NOT_COMPARABLE;
  // pct = variance / budget * 100 ; two decimals => round(variance*10000/budget)
  // normalize the denominator positive before rounding
  let num = variance.n * 10000n * budget.d;
  let den = variance.d * budget.n;
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const scaled = roundHalfAway(num, den);
  return fmtMinorSigned2(scaled) + "%";
}

/** Format a value already scaled by 100 (i.e. hundredths of a percent) at 2 decimals. */
function fmtMinorSigned2(scaledHundredths) {
  const neg = scaledHundredths < 0n;
  const a = neg ? -scaledHundredths : scaledHundredths;
  let s = a.toString().padStart(3, "0");
  const intPart = s.slice(0, s.length - 2);
  const fracPart = s.slice(s.length - 2);
  return (neg ? "-" : "") + intPart + "." + fracPart;
}

export function exactString(r) {
  return r.n.toString() + "/" + r.d.toString();
}
