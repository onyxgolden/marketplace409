import { describe, expect, it } from "vitest";
import { layoutTreemap } from "./treemapLayout.js";

function totalArea(rects) {
  return rects.reduce((sum, r) => sum + r.width * r.height, 0);
}

describe("layoutTreemap", () => {
  it("a single item fills the whole rectangle", () => {
    const out = layoutTreemap([{ key: "a", weight: 5 }], 100, 50);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "a", x: 0, y: 0, width: 100, height: 50 });
  });

  it("conserves total area across many items, regardless of weight spread", () => {
    const items = [
      { key: "a", weight: 40 },
      { key: "b", weight: 25 },
      { key: "c", weight: 15 },
      { key: "d", weight: 10 },
      { key: "e", weight: 6 },
      { key: "f", weight: 4 },
    ];
    const out = layoutTreemap(items, 300, 200);
    expect(out).toHaveLength(items.length);
    expect(totalArea(out)).toBeCloseTo(300 * 200, 3);
  });

  it("every tile stays within the container bounds", () => {
    const items = Array.from({ length: 11 }, (_, i) => ({ key: `g${i}`, weight: (i % 5) + 1 }));
    const out = layoutTreemap(items, 400, 240);
    for (const r of out) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-6);
      expect(r.y).toBeGreaterThanOrEqual(-1e-6);
      expect(r.x + r.width).toBeLessThanOrEqual(400 + 1e-6);
      expect(r.y + r.height).toBeLessThanOrEqual(240 + 1e-6);
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
    }
  });

  it("a larger weight gets a larger area, proportional to its share", () => {
    const out = layoutTreemap([{ key: "big", weight: 9 }, { key: "small", weight: 1 }], 100, 100);
    const big = out.find((r) => r.key === "big");
    const small = out.find((r) => r.key === "small");
    expect(big.width * big.height).toBeCloseTo(9000, 1); // 90% of the 10,000 total area
    expect(small.width * small.height).toBeCloseTo(1000, 1); // 10%
  });

  it("drops zero and negative weight items entirely -- never a synthetic zero-area tile", () => {
    const out = layoutTreemap([{ key: "real", weight: 10 }, { key: "zero", weight: 0 }, { key: "neg", weight: -3 }], 100, 100);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe("real");
  });

  it("an empty list, or a non-positive container, lays out nothing", () => {
    expect(layoutTreemap([], 100, 100)).toEqual([]);
    expect(layoutTreemap([{ key: "a", weight: 1 }], 0, 100)).toEqual([]);
    expect(layoutTreemap([{ key: "a", weight: 1 }], 100, 0)).toEqual([]);
  });

  it("is deterministic: the same input always produces byte-identical output", () => {
    const items = [
      { key: "a", weight: 7 },
      { key: "b", weight: 3 },
      { key: "c", weight: 12 },
      { key: "d", weight: 1 },
    ];
    const first = layoutTreemap(items, 250, 180);
    const second = layoutTreemap(items.map((i) => ({ ...i })), 250, 180);
    expect(second).toEqual(first);
  });

  it("preserves input order in the output (never silently reorders items)", () => {
    const items = [
      { key: "z", weight: 1 },
      { key: "a", weight: 5 },
      { key: "m", weight: 3 },
    ];
    const out = layoutTreemap(items, 100, 100);
    expect(out.map((r) => r.key)).toEqual(["z", "a", "m"]);
  });

  it("passes through extra fields on each item untouched", () => {
    const out = layoutTreemap([{ key: "a", weight: 1, label: "Acme", statusKey: "ready" }], 10, 10);
    expect(out[0]).toMatchObject({ key: "a", label: "Acme", statusKey: "ready" });
  });
});
