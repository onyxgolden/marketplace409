// Tests for forge-capture-app/ui/overlay-core.js — region-picker math.
// Pure logic, no DOM.
import { describe, it, expect } from "vitest";
import {
  rectOf,
  cssToPhysical,
  dimsText,
  coordsText,
  clamp,
  loupeSourceRect,
  readoutPosition,
} from "../overlay-core.js";

describe("rectOf", () => {
  it("normalizes drag direction", () => {
    expect(rectOf({ x: 10, y: 20 }, { x: 30, y: 60 })).toEqual({ x: 10, y: 20, w: 20, h: 40 });
    expect(rectOf({ x: 30, y: 60 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, w: 20, h: 40 });
  });

  it("handles zero-size drags", () => {
    expect(rectOf({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, w: 0, h: 0 });
  });
});

describe("cssToPhysical", () => {
  it("scales by the devicePixelRatio", () => {
    expect(cssToPhysical(100, 1)).toBe(100);
    expect(cssToPhysical(100, 2)).toBe(200);
    expect(cssToPhysical(100, 1.25)).toBe(125);
    expect(cssToPhysical(10.4, 2)).toBe(21);
  });
});

describe("dimsText / coordsText", () => {
  it("shows physical pixels like the capture will", () => {
    expect(dimsText(100, 50, 2)).toBe("200 x 100");
    expect(coordsText(10, 20, 1.5)).toBe("15, 30");
  });
});

describe("clamp", () => {
  it("clamps both ends", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

describe("loupeSourceRect", () => {
  it("centers on the cursor at 1:1 scale", () => {
    const r = loupeSourceRect(100, 100, 800, 600, 800, 600, 17);
    expect(r.sw).toBe(34);
    expect(r.sh).toBe(34);
    expect(r.sx).toBe(83);
    expect(r.sy).toBe(83);
    expect(r.centerX).toBe(17);
    expect(r.centerY).toBe(17);
  });

  it("scales the source span on hidpi backdrops", () => {
    // 4K backdrop on a 1080p CSS window: the loupe samples physical px.
    const r = loupeSourceRect(100, 100, 3840, 2160, 1920, 1080, 17);
    expect(r.sw).toBe(68);
    expect(r.centerX).toBe(34);
  });

  it("clamps to the image edges", () => {
    const topLeft = loupeSourceRect(0, 0, 800, 600, 800, 600, 17);
    expect(topLeft.sx).toBe(0);
    expect(topLeft.sy).toBe(0);
    const bottomRight = loupeSourceRect(799, 599, 800, 600, 800, 600, 17);
    expect(bottomRight.sx + bottomRight.sw).toBeLessThanOrEqual(800);
    expect(bottomRight.sy + bottomRight.sh).toBeLessThanOrEqual(600);
  });

  it("never exceeds the image when the image is tiny", () => {
    const r = loupeSourceRect(5, 5, 10, 10, 800, 600, 17);
    expect(r.sw).toBeLessThanOrEqual(10);
    expect(r.sh).toBeLessThanOrEqual(10);
    expect(r.sx).toBeGreaterThanOrEqual(0);
    expect(r.sy).toBeGreaterThanOrEqual(0);
  });
});

describe("readoutPosition", () => {
  it("places the readout down-right of the cursor by default", () => {
    expect(readoutPosition(100, 100, 1920, 1080, 120, 40)).toEqual({ left: 118, top: 118 });
  });

  it("flips inside the window near the edges", () => {
    const p = readoutPosition(1900, 1060, 1920, 1080, 120, 40);
    expect(p.left + 120).toBeLessThanOrEqual(1920);
    expect(p.top + 40).toBeLessThanOrEqual(1080);
    expect(p.left).toBeGreaterThanOrEqual(12);
    expect(p.top).toBeGreaterThanOrEqual(12);
  });
});
