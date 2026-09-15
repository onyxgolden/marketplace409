import { describe, expect, it } from "vitest";
import { createSyntheticFixtureAdapter } from "../syntheticFixtureAdapter.js";
import { getSyntheticScenarioById } from "../scenarios/syntheticScenarioCatalog.js";
import { MARKET_DATA_CAPABILITY_KEYS } from "../marketDataCapabilities.types.ts";

// This "consumer" is written ONLY against the MarketDataAdapter contract described in
// marketDataAdapter.types.ts -- it takes an adapter as a plain parameter, calls only
// getCapabilities/getQuote/getBars/getCorporateActions, and contains no reference anywhere to
// "synthetic," "fixture," a scenario id, or any concept from this domain's own implementation files.
// A future TR-1A licensed adapter could be substituted here with ZERO changes to this function -- that
// substitutability IS the provider-neutrality proof this test exists to demonstrate, not an assertion
// to take on faith.
function summarizeInstrumentForAnyAdapter(adapter, instrumentId, asOfRange) {
  const capabilities = adapter.getCapabilities();
  const quote = adapter.getQuote(instrumentId, asOfRange.end);
  const bars = adapter.getBars(instrumentId, asOfRange);
  const corporateActions = capabilities.capabilities.includes("supports_corporate_actions")
    ? adapter.getCorporateActions(instrumentId)
    : [];
  return {
    adapterId: adapter.adapterId,
    latestQuoteCents: quote ? quote.lastCents : null,
    barCount: bars.length,
    corporateActionCount: corporateActions.length,
  };
}

describe("market-data adapter provider-neutrality", () => {
  it("a consumer written only against the adapter contract can summarize a synthetic instrument with zero synthetic-specific code", () => {
    const scenario = getSyntheticScenarioById("dividend_and_split_v1");
    const [instrumentId] = scenario.instrumentIds;
    const bars = scenario.materialize()[instrumentId];
    const adapter = createSyntheticFixtureAdapter({ scenarioId: "dividend_and_split_v1" });

    const summary = summarizeInstrumentForAnyAdapter(adapter, instrumentId, {
      start: bars[0].effectiveAt,
      end: bars[bars.length - 1].effectiveAt,
    });

    expect(summary.barCount).toBe(bars.length);
    expect(summary.corporateActionCount).toBe(2);
    expect(summary.latestQuoteCents).toBe(bars[bars.length - 1].unadjustedCloseCents);
  });

  it("the capability vocabulary itself contains no synthetic-specific key", () => {
    for (const key of MARKET_DATA_CAPABILITY_KEYS) {
      expect(key.toLowerCase()).not.toContain("synthetic");
      expect(key.toLowerCase()).not.toContain("fixture");
    }
  });

  it("the adapter's public surface exposes no scenario id, seed, or generation-rule detail", () => {
    const adapter = createSyntheticFixtureAdapter({ scenarioId: "rising_market_v1" });
    const publicKeys = Object.keys(adapter).sort();
    expect(publicKeys).toEqual(["adapterId", "getBars", "getCapabilities", "getCorporateActions", "getQuote"]);
    // adapterId is an opaque identifier a consumer treats as a string, not something it parses for
    // "is this synthetic" -- the consumer test above never inspects adapterId's contents.
  });
});
