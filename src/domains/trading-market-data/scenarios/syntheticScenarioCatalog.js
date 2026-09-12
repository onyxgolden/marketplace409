// The versioned catalog of TR-1F-A's synthetic scenarios. Every entry's `generationRuleSummary` is the
// actual, complete explanation of why its bars look the way they do -- a reviewer should be able to
// read the summary, then read the `config` passed to generateScenarioBars(), and see the connection
// directly, with no hidden hand-tuning. `materialize()` is pure and deterministic: calling it twice
// with the same catalog entry produces byte-identical output (proven in
// __tests__/syntheticScenarioCatalog.test.js).
//
// Versioning: a scenario's `version` increments only when its `config` changes in a way that would
// change its bars. Bars for a given (id, version) pair are permanent once shipped -- a correction
// ships as a new version, never an edit to an existing one, matching the immutable-history discipline
// used everywhere else in this codebase.

import { generateScenarioBars } from "./scenarioGenerators.js";
import { SYNTHETIC_INSTRUMENTS } from "../tradingInstruments.js";

const [
  INSTRUMENT_1, INSTRUMENT_2, INSTRUMENT_3, INSTRUMENT_4, INSTRUMENT_5, INSTRUMENT_6,
  INSTRUMENT_7, INSTRUMENT_8, INSTRUMENT_9, INSTRUMENT_10, INSTRUMENT_11, INSTRUMENT_12,
] = SYNTHETIC_INSTRUMENTS;

function singleInstrumentScenario({ id, version, title, teaches, generationRuleSummary, instrument, config }) {
  return Object.freeze({
    id,
    version,
    title,
    teaches,
    generationRuleSummary,
    instrumentIds: Object.freeze([instrument.id]),
    // Exposed directly (not re-derived from bar deltas by a consumer) so getCorporateActions() can
    // never drift from the exact config that actually produced the bars.
    corporateActionsByInstrumentId: Object.freeze({
      [instrument.id]: Object.freeze(config.corporateActions || []),
    }),
    materialize: () => Object.freeze({ [instrument.id]: generateScenarioBars(config) }),
  });
}

export const SYNTHETIC_SCENARIOS = Object.freeze([
  singleInstrumentScenario({
    id: "rising_market_v1",
    version: 1,
    title: "A steadily rising market",
    teaches: "rising_market",
    generationRuleSummary:
      "Single phase, 60 bars, trendSlopeCentsPerBar=+15 (a small, steady upward drift every bar), " +
      "volatilityAmplitudeCents=20 (modest day-to-day noise, much smaller than the trend), " +
      "spreadBps=15 (tight, typical spread), volumeProfile=normal.",
    instrument: INSTRUMENT_1,
    config: {
      seedString: "rising_market_v1",
      startPriceCents: 10000,
      spreadBps: 15,
      volumeProfile: "normal",
      phases: [{ barCount: 60, trendSlopeCentsPerBar: 15, volatilityAmplitudeCents: 20 }],
    },
  }),
  singleInstrumentScenario({
    id: "falling_market_v1",
    version: 1,
    title: "A steadily falling market",
    teaches: "falling_market",
    generationRuleSummary:
      "Identical shape to rising_market_v1, mirrored: trendSlopeCentsPerBar=-15, same volatility, " +
      "spread, and volume parameters -- the only difference is the sign of the trend.",
    instrument: INSTRUMENT_2,
    config: {
      seedString: "falling_market_v1",
      startPriceCents: 10000,
      spreadBps: 15,
      volumeProfile: "normal",
      phases: [{ barCount: 60, trendSlopeCentsPerBar: -15, volatilityAmplitudeCents: 20 }],
    },
  }),
  singleInstrumentScenario({
    id: "flat_market_v1",
    version: 1,
    title: "A flat, range-bound market",
    teaches: "flat_market",
    generationRuleSummary:
      "trendSlopeCentsPerBar=0 (no drift at all) with a small volatilityAmplitudeCents=10, so the " +
      "price wanders in a narrow band around its starting point rather than trending either way.",
    instrument: INSTRUMENT_3,
    config: {
      seedString: "flat_market_v1",
      startPriceCents: 10000,
      spreadBps: 15,
      volumeProfile: "normal",
      phases: [{ barCount: 60, trendSlopeCentsPerBar: 0, volatilityAmplitudeCents: 10 }],
    },
  }),
  singleInstrumentScenario({
    id: "volatile_market_v1",
    version: 1,
    title: "A choppy, high-volatility market",
    teaches: "volatile_market",
    generationRuleSummary:
      "trendSlopeCentsPerBar=0 (no net direction) with a large volatilityAmplitudeCents=150 -- large " +
      "bar-to-bar swings with no underlying trend, contrasted deliberately against flat_market_v1's " +
      "small amplitude at the same zero slope.",
    instrument: INSTRUMENT_4,
    config: {
      seedString: "volatile_market_v1",
      startPriceCents: 10000,
      spreadBps: 15,
      volumeProfile: "normal",
      phases: [{ barCount: 60, trendSlopeCentsPerBar: 0, volatilityAmplitudeCents: 150 }],
    },
  }),
  singleInstrumentScenario({
    id: "spread_and_slippage_v1",
    version: 1,
    title: "A wide-spread, thin-volume market",
    teaches: "spread_and_slippage",
    generationRuleSummary:
      "spreadBps=250 (2.5%, roughly 15x rising_market_v1's spread) combined with volumeProfile=thin " +
      "(base volume 50 vs. 500 for 'normal') -- a wide bid/ask gap and low liquidity together are " +
      "exactly the conditions where a market order's real fill price diverges noticeably from the " +
      "last-quoted price.",
    instrument: INSTRUMENT_5,
    config: {
      seedString: "spread_and_slippage_v1",
      startPriceCents: 10000,
      spreadBps: 250,
      volumeProfile: "thin",
      phases: [{ barCount: 40, trendSlopeCentsPerBar: 5, volatilityAmplitudeCents: 30 }],
    },
  }),
  singleInstrumentScenario({
    id: "order_type_conditions_v1",
    version: 1,
    title: "A trending-with-noise path for order-type lessons",
    teaches: "order_type_conditions",
    generationRuleSummary:
      "A moderate uptrend (trendSlopeCentsPerBar=10) with enough noise (volatilityAmplitudeCents=40) " +
      "to cross arbitrary round price levels multiple times over 40 bars -- deliberately general, so " +
      "a later order-ticket lesson (TR-2F/TR-1F-B) can place market/limit/stop/stop-limit orders at " +
      "levels this path is guaranteed to approach and cross without the fixture itself needing to " +
      "encode order-specific behavior (TR-1F-A ships market data only, never an order engine).",
    instrument: INSTRUMENT_6,
    config: {
      seedString: "order_type_conditions_v1",
      startPriceCents: 10000,
      spreadBps: 20,
      volumeProfile: "normal",
      phases: [{ barCount: 40, trendSlopeCentsPerBar: 10, volatilityAmplitudeCents: 40 }],
    },
  }),
  singleInstrumentScenario({
    id: "partial_fill_conditions_v1",
    version: 1,
    title: "A thin-volume market suited to partial-fill lessons",
    teaches: "partial_fill",
    generationRuleSummary:
      "volumeProfile=thin (base volume 50 shares/bar) with a mild uptrend -- deliberately low " +
      "available volume per bar, so a later order engine (TR-2F) simulating a large order against " +
      "this fixture has a realistic, low ceiling to partially fill against. TR-1F-A supplies only the " +
      "volume data; it implements no fill logic itself.",
    instrument: INSTRUMENT_7,
    config: {
      seedString: "partial_fill_conditions_v1",
      startPriceCents: 10000,
      spreadBps: 20,
      volumeProfile: "thin",
      phases: [{ barCount: 40, trendSlopeCentsPerBar: 5, volatilityAmplitudeCents: 25 }],
    },
  }),
  singleInstrumentScenario({
    id: "dividend_and_split_v1",
    version: 1,
    title: "A rising market with a split and a dividend",
    teaches: "dividend_and_split",
    generationRuleSummary:
      "An 80-bar uptrend (trendSlopeCentsPerBar=8) with two corporateActions: a 2-for-1 split at bar " +
      "30 (unadjusted price halves from that bar forward; adjusted price for bars before 30 is halved " +
      "to remove the discontinuity) and a 50-cent dividend at bar 60 (adjusted price for bars before " +
      "60 is reduced by 50 cents, unadjusted price is untouched -- see " +
      "applyCorporateActionsAndComputeAdjustedPrices' documented, deliberately simplified rule).",
    instrument: INSTRUMENT_8,
    config: {
      seedString: "dividend_and_split_v1",
      startPriceCents: 10000,
      spreadBps: 15,
      volumeProfile: "normal",
      phases: [{ barCount: 80, trendSlopeCentsPerBar: 8, volatilityAmplitudeCents: 20 }],
      corporateActions: [
        { atBarIndex: 30, type: "split", ratioNumerator: 2, ratioDenominator: 1 },
        { atBarIndex: 60, type: "dividend", amountCents: 50 },
      ],
    },
  }),
  Object.freeze({
    id: "concentration_bundle_v1",
    version: 1,
    title: "Three instruments moving together (concentration risk)",
    teaches: "concentration_and_diversification",
    generationRuleSummary:
      "Three instruments (SYN0009/10/11) generated from the SAME seedString and the SAME trend/" +
      "volatility phase config -- their seeded-random noise sequences are therefore identical, so " +
      "the three price paths move in lockstep. A portfolio holding all three has no real risk " +
      "reduction from 'diversifying' across them, which is exactly the concentration-risk lesson " +
      "this bundle exists to support (contrast with diversification_bundle_v1 below).",
    instrumentIds: Object.freeze([INSTRUMENT_9.id, INSTRUMENT_10.id, INSTRUMENT_11.id]),
    corporateActionsByInstrumentId: Object.freeze({}),
    materialize: () => {
      const sharedConfig = {
        seedString: "concentration_bundle_v1",
        startPriceCents: 10000,
        spreadBps: 20,
        volumeProfile: "normal",
        phases: [{ barCount: 40, trendSlopeCentsPerBar: 6, volatilityAmplitudeCents: 30 }],
      };
      return Object.freeze({
        [INSTRUMENT_9.id]: generateScenarioBars(sharedConfig),
        [INSTRUMENT_10.id]: generateScenarioBars(sharedConfig),
        [INSTRUMENT_11.id]: generateScenarioBars(sharedConfig),
      });
    },
  }),
  Object.freeze({
    id: "diversification_bundle_v1",
    version: 1,
    title: "Three instruments moving independently (diversification)",
    teaches: "concentration_and_diversification",
    generationRuleSummary:
      "Same three instruments (SYN0009/10/11) and the same trend/volatility phase shape as " +
      "concentration_bundle_v1, but each generated from a DIFFERENT seedString -- their noise " +
      "sequences are therefore uncorrelated, so the three price paths diverge from each other even " +
      "though every other parameter is identical. A portfolio holding all three sees real risk " +
      "reduction, which is the diversification lesson this bundle supports.",
    instrumentIds: Object.freeze([INSTRUMENT_9.id, INSTRUMENT_10.id, INSTRUMENT_11.id]),
    corporateActionsByInstrumentId: Object.freeze({}),
    materialize: () => {
      const baseConfig = {
        startPriceCents: 10000,
        spreadBps: 20,
        volumeProfile: "normal",
        phases: [{ barCount: 40, trendSlopeCentsPerBar: 6, volatilityAmplitudeCents: 30 }],
      };
      return Object.freeze({
        [INSTRUMENT_9.id]: generateScenarioBars({ ...baseConfig, seedString: "diversification_bundle_v1_a" }),
        [INSTRUMENT_10.id]: generateScenarioBars({ ...baseConfig, seedString: "diversification_bundle_v1_b" }),
        [INSTRUMENT_11.id]: generateScenarioBars({ ...baseConfig, seedString: "diversification_bundle_v1_c" }),
      });
    },
  }),
  singleInstrumentScenario({
    id: "drawdown_and_recovery_v1",
    version: 1,
    title: "Rise, sharp drawdown, then recovery",
    teaches: "drawdown_and_recovery",
    generationRuleSummary:
      "Three phases in sequence: (1) 20 bars rising at +10/bar, (2) 15 bars falling sharply at " +
      "-60/bar (the drawdown), (3) 25 bars rising at +40/bar (the recovery) -- a deliberately " +
      "steeper decline than either surrounding phase, so the drawdown is visually and numerically " +
      "unambiguous rather than blending into normal noise.",
    instrument: INSTRUMENT_12,
    config: {
      seedString: "drawdown_and_recovery_v1",
      startPriceCents: 10000,
      spreadBps: 20,
      volumeProfile: "normal",
      phases: [
        { barCount: 20, trendSlopeCentsPerBar: 10, volatilityAmplitudeCents: 20 },
        { barCount: 15, trendSlopeCentsPerBar: -60, volatilityAmplitudeCents: 40 },
        { barCount: 25, trendSlopeCentsPerBar: 40, volatilityAmplitudeCents: 30 },
      ],
    },
  }),
  singleInstrumentScenario({
    id: "fomo_and_revenge_trading_setup_v1",
    version: 1,
    title: "Calm, then a sharp spike, then a sharp reversal",
    teaches: "fomo_and_revenge_trading_setup",
    generationRuleSummary:
      "Three phases: (1) 10 calm bars (+5/bar, low volatility) establishing a baseline, (2) 5 bars " +
      "spiking hard at +120/bar (the 'everyone's buying, don't miss out' shape a later FOMO-coaching " +
      "lesson reacts to), (3) 8 bars reversing hard at -150/bar (the trap). TR-1F-A only guarantees " +
      "this specific, deterministic price shape exists as a fixture -- it implements no coaching or " +
      "intervention logic itself; that is TR-3's job.",
    instrument: INSTRUMENT_2,
    config: {
      seedString: "fomo_and_revenge_trading_setup_v1",
      startPriceCents: 10000,
      spreadBps: 20,
      volumeProfile: "normal",
      phases: [
        { barCount: 10, trendSlopeCentsPerBar: 5, volatilityAmplitudeCents: 15 },
        { barCount: 5, trendSlopeCentsPerBar: 120, volatilityAmplitudeCents: 60 },
        { barCount: 8, trendSlopeCentsPerBar: -150, volatilityAmplitudeCents: 80 },
      ],
    },
  }),
]);

const SCENARIOS_BY_ID = new Map(SYNTHETIC_SCENARIOS.map((scenario) => [scenario.id, scenario]));

export function getSyntheticScenarioById(scenarioId) {
  return SCENARIOS_BY_ID.get(scenarioId) || null;
}
