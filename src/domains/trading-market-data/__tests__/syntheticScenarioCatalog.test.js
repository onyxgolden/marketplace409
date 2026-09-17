import { describe, expect, it } from "vitest";
import { SYNTHETIC_SCENARIOS, getSyntheticScenarioById } from "../scenarios/syntheticScenarioCatalog.js";
import { isPlausiblyFictional } from "../syntheticNamespace.js";
import { getSyntheticInstrumentById } from "../tradingInstruments.js";

describe("synthetic scenario catalog", () => {
  it("covers all 11 required teaching concepts", () => {
    const teaches = new Set(SYNTHETIC_SCENARIOS.map((scenario) => scenario.teaches));
    expect(teaches).toEqual(
      new Set([
        "rising_market",
        "falling_market",
        "flat_market",
        "volatile_market",
        "spread_and_slippage",
        "order_type_conditions",
        "partial_fill",
        "dividend_and_split",
        "concentration_and_diversification",
        "drawdown_and_recovery",
        "fomo_and_revenge_trading_setup",
      ]),
    );
  });

  it("every scenario documents a real, non-empty generation rule", () => {
    for (const scenario of SYNTHETIC_SCENARIOS) {
      expect(scenario.generationRuleSummary.length).toBeGreaterThan(40);
    }
  });

  it("every scenario's instruments are real, registered, plausibly-fictional instruments", () => {
    for (const scenario of SYNTHETIC_SCENARIOS) {
      for (const instrumentId of scenario.instrumentIds) {
        const instrument = getSyntheticInstrumentById(instrumentId);
        expect(instrument, `scenario ${scenario.id} references unknown instrument ${instrumentId}`).not.toBeNull();
        expect(isPlausiblyFictional(instrument)).toBe(true);
      }
    }
  });

  it("calling materialize() twice on the same scenario produces byte-identical output", () => {
    for (const scenario of SYNTHETIC_SCENARIOS) {
      const first = scenario.materialize();
      const second = scenario.materialize();
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
  });

  it("getSyntheticScenarioById finds a real entry and returns null for an unknown id", () => {
    expect(getSyntheticScenarioById(SYNTHETIC_SCENARIOS[0].id)).toBe(SYNTHETIC_SCENARIOS[0]);
    expect(getSyntheticScenarioById("does_not_exist")).toBeNull();
  });

  it("concentration_bundle instruments move together; diversification_bundle instruments diverge", () => {
    const concentrated = getSyntheticScenarioById("concentration_bundle_v1").materialize();
    const [instrumentA, instrumentB] = Object.keys(concentrated);
    expect(concentrated[instrumentA].map((bar) => bar.unadjustedCloseCents)).toEqual(
      concentrated[instrumentB].map((bar) => bar.unadjustedCloseCents),
    );

    const diversified = getSyntheticScenarioById("diversification_bundle_v1").materialize();
    const [divA, divB] = Object.keys(diversified);
    expect(diversified[divA].map((bar) => bar.unadjustedCloseCents)).not.toEqual(
      diversified[divB].map((bar) => bar.unadjustedCloseCents),
    );
  });
});
