// The reserved fictional namespace TR-1F-A's synthetic security master draws from. "Synthetic" is a
// structural property here, not a label: every function that creates a `trading_instruments` row in
// this domain (see tradingInstruments.js) MUST validate through assertPlausiblyFictional() below --
// there is no code path that accepts an instrument whose symbol/exchange/name doesn't match this
// namespace's own rules, so a mislabeled `data_origin` alone could never make a real-looking security
// slip through.
//
// Design choices, and why each one keeps this namespace disjoint from any real security:
//  - Exchange code "XSYN" (4 letters, matching the MIC-code shape used by real exchanges like XNYS/
//    XNAS/XASE/ARCX) is checked against a denylist of real MIC codes below to guarantee it was never
//    accidentally reused, rather than just asserting it "looks fake."
//  - Symbols are always exactly "SYN" followed by 4 digits (e.g. "SYN0001"). Real US equity tickers on
//    every major exchange are 1-5 letters (occasionally with a "." class suffix like "BRK.A"); none use
//    a fixed 3-letter-prefix-plus-4-digit numeric shape. This is a structural, checkable disjointness,
//    not a style convention.
//  - Company names always end with the literal, non-optional suffix " (Synthetic Training Co.)" -- no
//    real company files SEC paperwork under a name containing that phrase.

export const SYNTHETIC_EXCHANGE_CODE = "XSYN";

// A denylist of real-world MIC (Market Identifier Code) exchange codes, checked to prove
// SYNTHETIC_EXCHANGE_CODE was never accidentally a real one. Not exhaustive of every MIC that has ever
// existed -- exhaustive enough to make the point defensible, and the check is mechanical (existence in
// this array), not a judgment call.
const REAL_EXCHANGE_MIC_DENYLIST = Object.freeze([
  "XNYS", "XNAS", "XASE", "ARCX", "BATS", "XCHI", "XPHL", "XBOS", "XCIS",
  "IEXG", "EDGA", "EDGX", "XNGS", "XNMS", "XNCM",
]);

if (REAL_EXCHANGE_MIC_DENYLIST.includes(SYNTHETIC_EXCHANGE_CODE)) {
  // Fails at module load time, not silently -- this can never ship if the constant above is ever
  // "helpfully" changed to something that collides with a real exchange.
  throw new Error(
    `SYNTHETIC_EXCHANGE_CODE (${SYNTHETIC_EXCHANGE_CODE}) collides with a real exchange MIC code.`,
  );
}

const SYNTHETIC_SYMBOL_PATTERN = /^SYN[0-9]{4}$/;
const SYNTHETIC_NAME_SUFFIX = " (Synthetic Training Co.)";

// A small, deliberately-invented word list used to build company names. None of these words are drawn
// from, or similar to, any real company's name -- they're generic, faintly sci-fi/fantasy-sounding
// compounds chosen specifically because they don't resemble real corporate naming conventions.
const SYNTHETIC_NAME_ROOTS = Object.freeze([
  "Glimmerforge", "Quartzwave", "Nebulon", "Coralight", "Driftstone",
  "Emberreach", "Hollowmere", "Latticework", "Mossgate", "Sablewind",
  "Thornfield", "Wickerlight",
]);

export function buildSyntheticSymbol(sequenceNumber) {
  if (!Number.isInteger(sequenceNumber) || sequenceNumber < 1 || sequenceNumber > 9999) {
    throw new Error("sequenceNumber must be an integer between 1 and 9999.");
  }
  return `SYN${String(sequenceNumber).padStart(4, "0")}`;
}

export function buildSyntheticCompanyName(rootIndex) {
  const root = SYNTHETIC_NAME_ROOTS[rootIndex % SYNTHETIC_NAME_ROOTS.length];
  return `${root} Industries${SYNTHETIC_NAME_SUFFIX}`;
}

// The single gate every synthetic instrument must pass through. Throws with a specific reason rather
// than returning false, so a caller can never accidentally ignore a failed check by forgetting to
// inspect a boolean return value.
export function assertPlausiblyFictional({ exchange, symbol, name }) {
  if (exchange !== SYNTHETIC_EXCHANGE_CODE) {
    throw new Error(`Exchange "${exchange}" is not the reserved synthetic exchange code.`);
  }
  if (REAL_EXCHANGE_MIC_DENYLIST.includes(exchange)) {
    throw new Error(`Exchange "${exchange}" collides with a real exchange MIC code.`);
  }
  if (!SYNTHETIC_SYMBOL_PATTERN.test(symbol)) {
    throw new Error(
      `Symbol "${symbol}" does not match the reserved synthetic pattern /^SYN[0-9]{4}$/.`,
    );
  }
  if (!name.endsWith(SYNTHETIC_NAME_SUFFIX)) {
    throw new Error(`Name "${name}" does not carry the required "${SYNTHETIC_NAME_SUFFIX}" suffix.`);
  }
  return true;
}

// A positive check usable directly in tests/assertions without a try/catch, for readability.
export function isPlausiblyFictional(instrument) {
  try {
    return assertPlausiblyFictional(instrument);
  } catch {
    return false;
  }
}
