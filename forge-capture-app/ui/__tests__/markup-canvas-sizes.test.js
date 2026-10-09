// Tests for forge-capture-app/ui/markup-canvas-sizes.js -- the plotter
// paper-size catalog (Slice A). No DOM.

import { describe, it, expect } from "vitest";
import {
  LOGICAL_UNITS_PER_INCH,
  LEGACY_CANVAS_ID,
  PAPER_SIZES,
  ORIENTATIONS,
  CanvasSizeError,
  resolveCanvasSize,
  DEFAULT_CANVAS_SIZE,
  canvasSizeKey,
} from "../markup-canvas-sizes.js";

describe("PAPER_SIZES -- the 7-size catalog", () => {
  it("has exactly the 7 sizes the brief names, each with a stable id and positive landscape inches", () => {
    expect(PAPER_SIZES).toHaveLength(7);
    const ids = new Set();
    for (const s of PAPER_SIZES) {
      expect(s.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.widthIn).toBeGreaterThan(0);
      expect(s.heightIn).toBeGreaterThan(0);
      expect(typeof s.name).toBe("string");
    }
  });

  it("matches the brief's exact named sizes and inch dimensions", () => {
    const byId = new Map(PAPER_SIZES.map((s) => [s.id, s]));
    expect(byId.get("ansi_b")).toMatchObject({ widthIn: 17, heightIn: 11 });
    expect(byId.get("ansi_c")).toMatchObject({ widthIn: 22, heightIn: 17 });
    expect(byId.get("ansi_d")).toMatchObject({ widthIn: 34, heightIn: 22 });
    expect(byId.get("ansi_e")).toMatchObject({ widthIn: 44, heightIn: 34 });
    expect(byId.get("arch_c")).toMatchObject({ widthIn: 24, heightIn: 18 });
    expect(byId.get("arch_d")).toMatchObject({ widthIn: 36, heightIn: 24 });
    expect(byId.get("arch_e")).toMatchObject({ widthIn: 48, heightIn: 36 });
  });

  it("never includes the legacy id -- legacy is a separate, non-paper-size concept", () => {
    expect(PAPER_SIZES.some((s) => s.id === LEGACY_CANVAS_ID)).toBe(false);
  });
});

describe("resolveCanvasSize -- the only source of a usable canvas identity", () => {
  it("derives the legacy canvas at its fixed 640x480, with no orientation", () => {
    const size = resolveCanvasSize(LEGACY_CANVAS_ID);
    expect(size).toEqual({ id: "legacy", orientation: null, width: 640, height: 480 });
  });

  it("rejects a non-landscape orientation for the legacy canvas", () => {
    expect(() => resolveCanvasSize(LEGACY_CANVAS_ID, "portrait")).toThrow(CanvasSizeError);
  });

  it("accepts an explicit landscape (or omitted) orientation for the legacy canvas", () => {
    expect(() => resolveCanvasSize(LEGACY_CANVAS_ID, "landscape")).not.toThrow();
    expect(() => resolveCanvasSize(LEGACY_CANVAS_ID)).not.toThrow();
  });

  for (const def of PAPER_SIZES) {
    it(`derives "${def.id}" landscape at exactly ${def.widthIn * LOGICAL_UNITS_PER_INCH}x${def.heightIn * LOGICAL_UNITS_PER_INCH} logical units`, () => {
      const size = resolveCanvasSize(def.id, "landscape");
      expect(size).toEqual({
        id: def.id,
        orientation: "landscape",
        width: def.widthIn * LOGICAL_UNITS_PER_INCH,
        height: def.heightIn * LOGICAL_UNITS_PER_INCH,
      });
    });

    it(`derives "${def.id}" portrait with width/height swapped from landscape`, () => {
      const landscape = resolveCanvasSize(def.id, "landscape");
      const portrait = resolveCanvasSize(def.id, "portrait");
      expect(portrait.width).toBe(landscape.height);
      expect(portrait.height).toBe(landscape.width);
      expect(portrait.orientation).toBe("portrait");
    });
  }

  it("fails closed on an unknown size id", () => {
    expect(() => resolveCanvasSize("not_a_size", "landscape")).toThrow(CanvasSizeError);
  });

  it("fails closed on a missing or invalid orientation for a real paper size", () => {
    expect(() => resolveCanvasSize("ansi_b")).toThrow(CanvasSizeError);
    expect(() => resolveCanvasSize("ansi_b", "sideways")).toThrow(CanvasSizeError);
  });

  it("has no parameter through which a raw width/height could be forged -- the function signature itself only accepts (sizeId, orientation)", () => {
    expect(resolveCanvasSize.length).toBe(2);
    // Even if a caller tries to smuggle extra fields in, resolveCanvasSize
    // only ever reads its own two named parameters -- passing a bogus
    // width/height as a third argument has no effect on the result.
    const size = resolveCanvasSize("ansi_b", "landscape", { width: 999999, height: 999999 });
    expect(size.width).toBe(17 * LOGICAL_UNITS_PER_INCH);
    expect(size.height).toBe(11 * LOGICAL_UNITS_PER_INCH);
  });
});

describe("DEFAULT_CANVAS_SIZE", () => {
  it("is the resolved legacy canvas", () => {
    expect(DEFAULT_CANVAS_SIZE).toEqual({ id: "legacy", orientation: null, width: 640, height: 480 });
  });
});

describe("resolveCanvasSize -- frozen identities (review finding, round 1)", () => {
  // A caller holding a resolved identity must not be able to mutate it --
  // resolveCanvasSize is supposed to be the ONLY source of a canvas's
  // width/height, and DEFAULT_CANVAS_SIZE in particular is a single
  // shared instance assigned by reference to every step that has never
  // called setCanvasSize (see process-guide-markup.js's own _state()),
  // so an unfrozen result would let one caller's mutation corrupt every
  // other legacy-default step's bounds too.
  it("every resolved identity is frozen, legacy and every paper size alike", () => {
    expect(Object.isFrozen(resolveCanvasSize(LEGACY_CANVAS_ID))).toBe(true);
    for (const def of PAPER_SIZES) {
      expect(Object.isFrozen(resolveCanvasSize(def.id, "landscape"))).toBe(true);
      expect(Object.isFrozen(resolveCanvasSize(def.id, "portrait"))).toBe(true);
    }
  });

  it("DEFAULT_CANVAS_SIZE itself is frozen", () => {
    expect(Object.isFrozen(DEFAULT_CANVAS_SIZE)).toBe(true);
  });

  it("an attempted mutation of a resolved identity throws (ES module strict mode) and leaves the value unchanged", () => {
    const size = resolveCanvasSize("ansi_b", "landscape");
    expect(() => {
      size.width = 999999;
    }).toThrow(TypeError);
    expect(size.width).toBe(17 * LOGICAL_UNITS_PER_INCH); // unchanged
  });

  it("an attempted mutation of DEFAULT_CANVAS_SIZE throws and leaves it unchanged", () => {
    expect(() => {
      DEFAULT_CANVAS_SIZE.width = 999999;
    }).toThrow(TypeError);
    expect(DEFAULT_CANVAS_SIZE.width).toBe(640);
    expect(DEFAULT_CANVAS_SIZE.height).toBe(480);
  });
});

describe("canvasSizeKey", () => {
  it("is stable and distinct per id+orientation pair", () => {
    const a = canvasSizeKey(resolveCanvasSize("ansi_b", "landscape"));
    const b = canvasSizeKey(resolveCanvasSize("ansi_b", "portrait"));
    const c = canvasSizeKey(resolveCanvasSize("ansi_c", "landscape"));
    const aAgain = canvasSizeKey(resolveCanvasSize("ansi_b", "landscape"));
    expect(a).toBe(aAgain);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("differs for the legacy canvas vs. any paper size", () => {
    expect(canvasSizeKey(DEFAULT_CANVAS_SIZE)).not.toBe(canvasSizeKey(resolveCanvasSize("ansi_b", "landscape")));
  });
});

describe("ORIENTATIONS", () => {
  it("is exactly landscape and portrait", () => {
    expect(ORIENTATIONS).toEqual(["landscape", "portrait"]);
  });
});
