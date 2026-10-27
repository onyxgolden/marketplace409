// H0 (home parity) — home layer masks.
//
// Covers the brief §5 layer contract and the HomeLayers.maskMatrix
// acceptance: every one of the 8 trade masks × base-plan on/off resolves
// correctly, industrial mode resolves everything home to false, and print
// masks freeze with a visible sheet title.

import { describe, expect, it } from "vitest";
import {
  HOME_LAYER_KEYS,
  HOME_TRADE_MASKS,
  createHomeLayerMask,
  defaultHomeLayerMask,
  freezeHomePrintMask,
  printMaskTitle,
  resolveHomeLayers,
  setHomeLayer,
  toggleHomeLayer,
} from "./homeLayers";

describe("homeLayers — mask creation", () => {
  it("defaults to base visible and trades hidden", () => {
    const mask = defaultHomeLayerMask();
    expect(mask).toEqual({
      base: true,
      underlay: true,
      furniture: true,
      electrical: false,
      plumbing: false,
      hvac: false,
    });
    expect(Object.isFrozen(mask)).toBe(true);
  });

  it("rejects unknown layers and non-object overrides", () => {
    expect(() => createHomeLayerMask({ piping: true })).toThrow();
    expect(() => createHomeLayerMask("base")).toThrow();
    expect(() => setHomeLayer(defaultHomeLayerMask(), "piping", true)).toThrow();
    expect(() => toggleHomeLayer(defaultHomeLayerMask(), "piping")).toThrow();
  });

  it("set/toggle return new frozen masks and never mutate the input", () => {
    const mask = defaultHomeLayerMask();
    const on = setHomeLayer(mask, "electrical", true);
    expect(on.electrical).toBe(true);
    expect(mask.electrical).toBe(false);
    expect(Object.isFrozen(on)).toBe(true);
    const off = toggleHomeLayer(on, "electrical");
    expect(off.electrical).toBe(false);
    expect(on.electrical).toBe(true);
  });

  it("exposes exactly the six layer keys and eight trade masks", () => {
    expect(HOME_LAYER_KEYS).toEqual([
      "base",
      "underlay",
      "furniture",
      "electrical",
      "plumbing",
      "hvac",
    ]);
    expect(HOME_TRADE_MASKS).toHaveLength(8);
    // Every 2^3 combination exactly once.
    const seen = new Set(HOME_TRADE_MASKS.map((m) => JSON.stringify(m)));
    expect(seen.size).toBe(8);
  });
});

describe("HomeLayers.maskMatrix", () => {
  it("resolves all 8 trade masks × base on/off correctly", () => {
    for (const trades of HOME_TRADE_MASKS) {
      for (const base of [true, false]) {
        const mask = createHomeLayerMask({ ...trades, base });
        const resolved = resolveHomeLayers(mask, { mode: "home", hasUnderlay: true });
        expect(resolved.mode).toBe("home");
        expect(resolved.base).toBe(base);
        expect(resolved.underlay).toBe(true);
        expect(resolved.furniture).toBe(true);
        expect(resolved.trades).toEqual(trades);
        expect(resolved.visibleTradeIds).toEqual(
          ["electrical", "plumbing", "hvac"].filter((t) => trades[t]),
        );
        expect(resolved.tradeOnly).toBe(
          !base && resolved.visibleTradeIds.length > 0,
        );
      }
    }
  });

  it("gates the underlay on one actually existing", () => {
    const mask = createHomeLayerMask({ underlay: true });
    expect(resolveHomeLayers(mask, { mode: "home", hasUnderlay: false }).underlay).toBe(false);
    expect(resolveHomeLayers(mask, { mode: "home" }).underlay).toBe(false);
    expect(resolveHomeLayers(mask, { mode: "home", hasUnderlay: true }).underlay).toBe(true);
  });

  it("resolves every home flag to false in industrial mode", () => {
    const mask = createHomeLayerMask({
      base: true,
      underlay: true,
      furniture: true,
      electrical: true,
      plumbing: true,
      hvac: true,
    });
    const resolved = resolveHomeLayers(mask, { mode: "industrial", hasUnderlay: true });
    expect(resolved).toEqual({
      mode: "industrial",
      base: false,
      underlay: false,
      furniture: false,
      trades: { electrical: false, plumbing: false, hvac: false },
      tradeOnly: false,
      visibleTradeIds: [],
    });
  });

  it("normalizes unknown modes to home", () => {
    const resolved = resolveHomeLayers(defaultHomeLayerMask(), { mode: "bogus" });
    expect(resolved.mode).toBe("home");
    expect(resolved.base).toBe(true);
  });
});

describe("homeLayers — print masks", () => {
  it("titles every mask shape", () => {
    expect(printMaskTitle(createHomeLayerMask({}))).toBe("Base plan");
    expect(printMaskTitle(createHomeLayerMask({ electrical: true }))).toBe(
      "Base + Electrical",
    );
    expect(
      printMaskTitle(createHomeLayerMask({ electrical: true, hvac: true })),
    ).toBe("Base + Electrical + HVAC");
    expect(
      printMaskTitle(createHomeLayerMask({ base: false, plumbing: true })),
    ).toBe("Plumbing only");
    expect(
      printMaskTitle(
        createHomeLayerMask({ base: false, electrical: true, plumbing: true }),
      ),
    ).toBe("Electrical + Plumbing");
    expect(
      printMaskTitle(
        createHomeLayerMask({ base: false, underlay: false, furniture: false }),
      ),
    ).toBe("No layers selected");
  });

  it("freezes a snapshot detached from later toggles", () => {
    const mask = createHomeLayerMask({ electrical: true });
    const frozen = freezeHomePrintMask(mask);
    expect(frozen.title).toBe("Base + Electrical");
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.mask)).toBe(true);
    // A later toggle builds a NEW mask; the frozen snapshot is untouched.
    const later = setHomeLayer(mask, "electrical", false);
    expect(frozen.mask.electrical).toBe(true);
    expect(frozen.title).toBe("Base + Electrical");
    expect(later.electrical).toBe(false);
  });
});
