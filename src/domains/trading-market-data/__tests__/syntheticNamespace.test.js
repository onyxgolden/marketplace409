import { describe, expect, it } from "vitest";
import {
  assertPlausiblyFictional,
  isPlausiblyFictional,
  buildSyntheticSymbol,
  buildSyntheticCompanyName,
  SYNTHETIC_EXCHANGE_CODE,
} from "../syntheticNamespace.js";
import { KNOWN_REAL_LOOKING_SYMBOLS_FOR_NEGATIVE_TESTS } from "../tradingInstruments.js";

describe("synthetic namespace", () => {
  it("accepts a properly-built synthetic instrument", () => {
    const instrument = {
      exchange: SYNTHETIC_EXCHANGE_CODE,
      symbol: buildSyntheticSymbol(42),
      name: buildSyntheticCompanyName(0),
    };
    expect(() => assertPlausiblyFictional(instrument)).not.toThrow();
    expect(isPlausiblyFictional(instrument)).toBe(true);
  });

  it("REJECTS every known real-looking symbol, even paired with the synthetic exchange/name", () => {
    for (const realSymbol of KNOWN_REAL_LOOKING_SYMBOLS_FOR_NEGATIVE_TESTS) {
      const instrument = {
        exchange: SYNTHETIC_EXCHANGE_CODE,
        symbol: realSymbol,
        name: buildSyntheticCompanyName(0),
      };
      expect(isPlausiblyFictional(instrument), `expected "${realSymbol}" to be rejected`).toBe(false);
      expect(() => assertPlausiblyFictional(instrument)).toThrow();
    }
  });

  it("rejects a real exchange code even with an otherwise-valid synthetic symbol/name", () => {
    const instrument = { exchange: "XNYS", symbol: buildSyntheticSymbol(1), name: buildSyntheticCompanyName(0) };
    expect(isPlausiblyFictional(instrument)).toBe(false);
  });

  it("rejects a company name missing the required synthetic suffix", () => {
    const instrument = { exchange: SYNTHETIC_EXCHANGE_CODE, symbol: buildSyntheticSymbol(1), name: "Apple Inc." };
    expect(isPlausiblyFictional(instrument)).toBe(false);
  });

  it("buildSyntheticSymbol rejects out-of-range sequence numbers", () => {
    expect(() => buildSyntheticSymbol(0)).toThrow();
    expect(() => buildSyntheticSymbol(10000)).toThrow();
    expect(() => buildSyntheticSymbol(1.5)).toThrow();
  });

  it("the reserved exchange code itself is not in the real-exchange denylist (module-load-time self-check)", () => {
    // If syntheticNamespace.js's own self-check ever failed, importing it at all would throw --
    // reaching this line at all is itself part of the proof.
    expect(SYNTHETIC_EXCHANGE_CODE).toBe("XSYN");
  });
});
