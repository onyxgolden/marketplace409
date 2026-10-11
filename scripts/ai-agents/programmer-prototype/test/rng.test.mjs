import { describe, it, expect } from "vitest";
import { xmur3, mulberry32, rngFromString, seedForTicket, pick, intBelow } from "../src/rng.mjs";

describe("deterministic rng", () => {
  it("produces identical sequences for the same seed string", () => {
    const a = rngFromString("pa2-seed");
    const b = rngFromString("pa2-seed");
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = rngFromString("seed-one");
    const b = rngFromString("seed-two");
    expect(Array.from({ length: 5 }, () => a())).not.toEqual(
      Array.from({ length: 5 }, () => b())
    );
  });

  it("xmur3 is stable", () => {
    expect(xmur3("abc")()).toBe(xmur3("abc")());
  });

  it("mulberry32 stays in [0,1)", () => {
    const r = mulberry32(12345);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("seedForTicket is stable per ticket", () => {
    expect(seedForTicket("corpus-seed", "pa2-0001")).toBe(seedForTicket("corpus-seed", "pa2-0001"));
    expect(seedForTicket("corpus-seed", "pa2-0001")).not.toBe(seedForTicket("corpus-seed", "pa2-0002"));
  });

  it("pick and intBelow stay in range", () => {
    const r = rngFromString("range-check");
    const arr = ["a", "b", "c"];
    for (let i = 0; i < 50; i++) {
      expect(arr).toContain(pick(r, arr));
      const n = intBelow(r, 7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
    }
  });
});
