// The fictional security master for TR-1F-A. Matches the `trading_instruments` entity contract from
// the architecture plan (§6): id, symbol, exchange, asset_class, name, status, tick_size, data_origin,
// provenance. This phase ships it as a fixed, versioned, code-shipped catalog -- not a database table
// -- see the "no migration" reasoning in this domain's README-equivalent comment in
// syntheticFixtureAdapter.js. A future TR-1A can add real (`data_origin: "licensed"`) rows using this
// exact same shape without any consumer of this module needing to change.

import { buildSyntheticSymbol, buildSyntheticCompanyName, assertPlausiblyFictional, SYNTHETIC_EXCHANGE_CODE } from "./syntheticNamespace.js";

function buildInstrument({ sequenceNumber, rootIndex, assetClass = "equity", tickSizeCents = 1 }) {
  const symbol = buildSyntheticSymbol(sequenceNumber);
  const name = buildSyntheticCompanyName(rootIndex);
  const instrument = Object.freeze({
    id: `trading_instrument_${symbol.toLowerCase()}`,
    symbol,
    exchange: SYNTHETIC_EXCHANGE_CODE,
    assetClass,
    name,
    status: "active",
    tickSizeCents,
    dataOrigin: "synthetic",
    provenance: Object.freeze({ source: "trading-market-data/tradingInstruments.js", asOf: "2026-09-11" }),
  });
  // Structural gate, not a formality: this throws (failing every consumer, loudly, at module load)
  // if any instrument below were ever hand-edited into something real-looking.
  assertPlausiblyFictional(instrument);
  return instrument;
}

// 12 instruments: enough for a diversification/concentration scenario to bundle several, while
// staying a small, reviewable, fixed set (per the architecture plan's "small fixed symbol set"
// principle, applied here to the synthetic catalog too).
export const SYNTHETIC_INSTRUMENTS = Object.freeze([
  buildInstrument({ sequenceNumber: 1, rootIndex: 0 }),
  buildInstrument({ sequenceNumber: 2, rootIndex: 1 }),
  buildInstrument({ sequenceNumber: 3, rootIndex: 2 }),
  buildInstrument({ sequenceNumber: 4, rootIndex: 3 }),
  buildInstrument({ sequenceNumber: 5, rootIndex: 4 }),
  buildInstrument({ sequenceNumber: 6, rootIndex: 5 }),
  buildInstrument({ sequenceNumber: 7, rootIndex: 6 }),
  buildInstrument({ sequenceNumber: 8, rootIndex: 7 }),
  buildInstrument({ sequenceNumber: 9, rootIndex: 8 }),
  buildInstrument({ sequenceNumber: 10, rootIndex: 9 }),
  buildInstrument({ sequenceNumber: 11, rootIndex: 10 }),
  buildInstrument({ sequenceNumber: 12, rootIndex: 11 }),
]);

const INSTRUMENTS_BY_ID = new Map(SYNTHETIC_INSTRUMENTS.map((instrument) => [instrument.id, instrument]));

export function getSyntheticInstrumentById(instrumentId) {
  return INSTRUMENTS_BY_ID.get(instrumentId) || null;
}

// A deliberately-realistic-but-real-looking symbol used only in tests, to prove the namespace
// validator actually rejects the shape of a genuine ticker rather than merely accepting its own
// output. Exported (not just inlined in a test) so the negative-case fixture is itself reviewable.
export const KNOWN_REAL_LOOKING_SYMBOLS_FOR_NEGATIVE_TESTS = Object.freeze([
  "AAPL", "MSFT", "TSLA", "BRK.A", "SPY",
]);
