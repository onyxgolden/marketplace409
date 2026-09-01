import { describe, expect, it } from "vitest";
import { VIEWPORT_NAMES, VIEWPORT_PRESETS, getViewportPreset } from "../viewportPresets.mjs";

describe("viewport presets", () => {
  it("defines exactly desktop, tablet, and mobile", () => {
    expect([...VIEWPORT_NAMES].sort()).toEqual(["desktop", "mobile", "tablet"]);
  });

  it("gives each preset a distinct, deterministic width and height", () => {
    const dimensions = VIEWPORT_NAMES.map((name) => `${VIEWPORT_PRESETS[name].width}x${VIEWPORT_PRESETS[name].height}`);
    expect(new Set(dimensions).size).toBe(3);
  });

  it("returns the exact same preset object shape on repeated calls (determinism)", () => {
    expect(getViewportPreset("desktop")).toEqual(getViewportPreset("desktop"));
  });

  it("throws on an unknown viewport name rather than returning undefined", () => {
    expect(() => getViewportPreset("ultrawide")).toThrow(/Unknown viewport preset/);
  });

  it("returns frozen objects that cannot be mutated by a caller", () => {
    const desktop = getViewportPreset("desktop");
    expect(() => { desktop.width = 9999; }).toThrow();
    expect(getViewportPreset("desktop").width).not.toBe(9999);
  });
});
