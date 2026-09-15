import { describe, expect, it } from "vitest";
import { generateScenarioBars } from "../scenarios/scenarioGenerators.js";

const BASE_CONFIG = Object.freeze({
  seedString: "test_scenario_determinism",
  startPriceCents: 10000,
  spreadBps: 20,
  volumeProfile: "normal",
  phases: [{ barCount: 30, trendSlopeCentsPerBar: 10, volatilityAmplitudeCents: 25 }],
});

describe("generateScenarioBars determinism", () => {
  it("identical seed + config produce byte-identical output across independent calls", () => {
    const first = generateScenarioBars(BASE_CONFIG);
    const second = generateScenarioBars(BASE_CONFIG);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("a different seedString produces a different price path (proves the seed actually matters)", () => {
    const a = generateScenarioBars(BASE_CONFIG);
    const b = generateScenarioBars({ ...BASE_CONFIG, seedString: "a_completely_different_seed" });
    expect(a.map((bar) => bar.unadjustedCloseCents)).not.toEqual(b.map((bar) => bar.unadjustedCloseCents));
  });

  it("produces exactly barCount bars, in ascending sequenceIndex and effectiveAt order", () => {
    const bars = generateScenarioBars(BASE_CONFIG);
    expect(bars).toHaveLength(30);
    for (let i = 0; i < bars.length; i += 1) {
      expect(bars[i].sequenceIndex).toBe(i);
      if (i > 0) expect(bars[i].effectiveAt > bars[i - 1].effectiveAt).toBe(true);
    }
  });
});

describe("effective_at / received_at", () => {
  it("are distinct fields on every bar, never equal, with a fixed deterministic offset", () => {
    const bars = generateScenarioBars(BASE_CONFIG);
    for (const bar of bars) {
      expect(bar.receivedAt).not.toBe(bar.effectiveAt);
      const deltaMs = new Date(bar.receivedAt).getTime() - new Date(bar.effectiveAt).getTime();
      expect(deltaMs).toBe(60_000);
    }
  });
});

describe("corporate actions: adjusted vs. unadjusted", () => {
  const config = {
    seedString: "corporate_actions_test",
    startPriceCents: 10000,
    spreadBps: 15,
    volumeProfile: "normal",
    phases: [{ barCount: 20, trendSlopeCentsPerBar: 0, volatilityAmplitudeCents: 0 }],
    corporateActions: [{ atBarIndex: 10, type: "split", ratioNumerator: 2, ratioDenominator: 1 }],
  };

  it("a 2-for-1 split halves the unadjusted price from the split bar forward, leaves prior bars' unadjusted price untouched", () => {
    const bars = generateScenarioBars(config);
    const beforeSplit = bars[9];
    const atSplit = bars[10];
    // volatilityAmplitudeCents=0 and trendSlopeCentsPerBar=0 above means price is flat at 10000
    // before any action, so this is an exact, not approximate, assertion.
    expect(beforeSplit.unadjustedCloseCents).toBe(10000);
    expect(atSplit.unadjustedCloseCents).toBe(5000);
  });

  it("adjusted price has no discontinuity across the split (prior bars rescaled to match)", () => {
    const bars = generateScenarioBars(config);
    const beforeSplit = bars[9];
    const atSplit = bars[10];
    expect(beforeSplit.adjustedCloseCents).toBe(5000); // rescaled: 10000 / 2
    expect(atSplit.adjustedCloseCents).toBe(5000); // real post-split price, unchanged
  });

  it("unadjusted and adjusted are identical for a scenario with no corporate actions", () => {
    const bars = generateScenarioBars(BASE_CONFIG);
    for (const bar of bars) {
      expect(bar.adjustedCloseCents).toBe(bar.unadjustedCloseCents);
    }
  });

  it("a flat-amount dividend reduces only the adjusted price of prior bars, never the unadjusted price", () => {
    const dividendConfig = {
      ...config,
      corporateActions: [{ atBarIndex: 10, type: "dividend", amountCents: 75 }],
    };
    const bars = generateScenarioBars(dividendConfig);
    expect(bars[9].unadjustedCloseCents).toBe(10000);
    expect(bars[9].adjustedCloseCents).toBe(9925); // 10000 - 75
    expect(bars[10].unadjustedCloseCents).toBe(10000);
    expect(bars[10].adjustedCloseCents).toBe(10000); // on/after the dividend bar, untouched
  });

  it("rejects an unknown corporate action type", () => {
    expect(() =>
      generateScenarioBars({ ...config, corporateActions: [{ atBarIndex: 5, type: "not_a_real_type" }] }),
    ).toThrow();
  });
});
