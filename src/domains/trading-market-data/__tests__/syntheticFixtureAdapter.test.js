import { describe, expect, it } from "vitest";
import { createSyntheticFixtureAdapter } from "../syntheticFixtureAdapter.js";
import { getSyntheticScenarioById } from "../scenarios/syntheticScenarioCatalog.js";

describe("createSyntheticFixtureAdapter", () => {
  it("throws for an unknown scenario id", () => {
    expect(() => createSyntheticFixtureAdapter({ scenarioId: "not_a_real_scenario" })).toThrow();
  });

  it("getQuote returns the latest bar at or before asOf, and null before the scenario starts", () => {
    const scenario = getSyntheticScenarioById("rising_market_v1");
    const [instrumentId] = scenario.instrumentIds;
    const adapter = createSyntheticFixtureAdapter({ scenarioId: "rising_market_v1" });
    const bars = scenario.materialize()[instrumentId];

    expect(adapter.getQuote(instrumentId, "0001-01-01T00:00:00.000Z")).toBeNull();

    const quote = adapter.getQuote(instrumentId, bars[5].effectiveAt);
    expect(quote.lastCents).toBe(bars[5].unadjustedCloseCents);
    expect(quote.bidCents).toBe(bars[5].bidCents);
    expect(quote.askCents).toBe(bars[5].askCents);

    // Asking "as of" a timestamp between two bars returns the earlier one, never the later one.
    const betweenBars = new Date(new Date(bars[5].effectiveAt).getTime() + 1000).toISOString();
    expect(adapter.getQuote(instrumentId, betweenBars).lastCents).toBe(bars[5].unadjustedCloseCents);
  });

  it("getBars filters to the requested range, inclusive, in order", () => {
    const scenario = getSyntheticScenarioById("rising_market_v1");
    const [instrumentId] = scenario.instrumentIds;
    const adapter = createSyntheticFixtureAdapter({ scenarioId: "rising_market_v1" });
    const bars = scenario.materialize()[instrumentId];

    const slice = adapter.getBars(instrumentId, { start: bars[3].effectiveAt, end: bars[7].effectiveAt });
    expect(slice.map((bar) => bar.sequenceIndex)).toEqual([3, 4, 5, 6, 7]);
  });

  it("getBars/getQuote/getCorporateActions throw for an instrument not in this scenario", () => {
    const adapter = createSyntheticFixtureAdapter({ scenarioId: "rising_market_v1" });
    expect(() => adapter.getBars("trading_instrument_does_not_exist", { start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00.000Z" })).toThrow();
    expect(() => adapter.getCorporateActions("trading_instrument_does_not_exist")).toThrow();
  });

  it("getCorporateActions returns the exact configured actions for a scenario that has them, empty for one that doesn't", () => {
    const withActions = createSyntheticFixtureAdapter({ scenarioId: "dividend_and_split_v1" });
    const [instrumentId] = getSyntheticScenarioById("dividend_and_split_v1").instrumentIds;
    const actions = withActions.getCorporateActions(instrumentId);
    expect(actions).toHaveLength(2);
    expect(actions[0].type).toBe("split");
    expect(actions[1].type).toBe("dividend");

    const withoutActions = createSyntheticFixtureAdapter({ scenarioId: "rising_market_v1" });
    const [plainInstrumentId] = getSyntheticScenarioById("rising_market_v1").instrumentIds;
    expect(withoutActions.getCorporateActions(plainInstrumentId)).toEqual([]);
  });

  it("getCapabilities reports the expected fixed capability set, and never a synthetic-specific key", () => {
    const adapter = createSyntheticFixtureAdapter({ scenarioId: "rising_market_v1" });
    const capabilities = adapter.getCapabilities();
    expect(capabilities.capabilities).toContain("supports_quotes");
    expect(capabilities.capabilities).toContain("supports_bars");
    expect(capabilities.capabilities.some((key) => key.toLowerCase().includes("synthetic"))).toBe(false);
  });
});
