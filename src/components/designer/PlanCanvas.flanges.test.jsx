// @vitest-environment jsdom

// D2 (c) hoist: renderPipe must read flanges from the once-per-render
// grouped map, not from a per-pipe full-design scan. Parity is proven at
// the render layer: the glyphs (count, run, end, screen position) match
// connectionFlanges(design) exactly; a re-render with the same design
// object does not recompute the grouping; detaching the pump removes the
// glyphs on the new design object.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PlanCanvas from "./PlanCanvas";
import {
  addPipeRun,
  createEmptyDesign,
  deleteSymbol,
  placeSymbol,
} from "@/domains/roomDesigner/designerDocument";
import { detectRunAttachments } from "@/domains/roomDesigner/pipeAttachments";
import {
  connectionFlanges,
  connectionFlangesByRun,
  elevationCacheStats,
  __resetElevationCache,
} from "@/domains/roomDesigner/pipeCrossings";

if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Default view: scale 1.6, offset (60,60) → screen = 60 + 1.6 * plan.
const toScreen = (p) => ({ x: 60 + 1.6 * p.x, y: 60 + 1.6 * p.y });

// Same flange fixture as pipeCrossings.cache.test.js: a real
// centrifugal pump (processEquipment) with run "s" attached at its
// nozzle — one start flange.
function flangedDesign() {
  let d = placeSymbol(createEmptyDesign(), "processEquipment", "centrifugal-pump", 200, 200, { id: "p1" });
  d = addPipeRun(d, [{ x: 200, y: 191 }, { x: 200, y: 40 }], { id: "s", diameterIn: 4 });
  d = detectRunAttachments(d, "s");
  return d;
}

describe("PlanCanvas flanges — D2 (c) hoist", () => {
  let container;
  let root;
  let dispatch;

  const renderCanvas = (design, selection = null) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => {
      root.render(<PlanCanvas design={design} tool="select" selection={selection} dispatch={dispatch} />);
    });
  };
  const rerenderCanvas = (design) => {
    act(() => {
      root.render(<PlanCanvas design={design} tool="select" selection={null} dispatch={dispatch} />);
    });
  };
  const flangeGlyphs = () => [...container.querySelectorAll('[data-testid^="pipe-flange-"]')];

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders exactly the flanges connectionFlanges returns, at the same geometry", () => {
    const design = flangedDesign();
    const flat = connectionFlanges(design);
    expect(flat).toHaveLength(1);
    expect(flat[0].runId).toBe("s");
    expect(flat[0].end).toBe("start");
    renderCanvas(design);
    const glyphs = flangeGlyphs();
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0].getAttribute("data-testid")).toBe("pipe-flange-s-start");
    const s = toScreen(flat[0]);
    expect(glyphs[0].getAttribute("transform")).toBe(
      `translate(${s.x} ${s.y}) rotate(${flat[0].axisDeg})`,
    );
  });

  it("re-rendering with the same design object reuses the grouping", () => {
    __resetElevationCache();
    const design = flangedDesign();
    renderCanvas(design);
    expect(elevationCacheStats().flangeComputations).toBe(1);
    const before = flangeGlyphs().map((g) => g.getAttribute("transform"));
    rerenderCanvas(design);
    expect(elevationCacheStats().flangeComputations).toBe(1);
    expect(flangeGlyphs().map((g) => g.getAttribute("transform"))).toEqual(before);
  });

  it("detaching the pump removes the flange glyphs on the new design", () => {
    const design = flangedDesign();
    renderCanvas(design);
    expect(flangeGlyphs()).toHaveLength(1);
    const detached = detectRunAttachments(deleteSymbol(design, "p1"), "s");
    expect(connectionFlangesByRun(detached).get("s")).toBeUndefined();
    rerenderCanvas(detached);
    expect(flangeGlyphs()).toHaveLength(0);
  });

  it("a run with no attachments renders no flange glyphs", () => {
    let d = createEmptyDesign();
    d = addPipeRun(d, [{ x: 900, y: 100 }, { x: 900, y: 500 }], { id: "b", diameterIn: 2 });
    renderCanvas(d);
    expect(flangeGlyphs()).toHaveLength(0);
    expect(container.querySelector("polyline")).not.toBeNull();
  });
});

// Registry-change regression — MUST stay last in this file: it resets the
// global symbol registry (clearing the catalogs too), and earlier tests
// use catalog symbols via placeSymbol. D2 fix-round Gate 3: PlanCanvas
// used to memoize connectionFlangesByRun on [design] alone, so a
// re-render of the SAME design object after a registration/reset served
// the old flange geometry while the memoized elevation path already used
// the new generation. The canvas now reads the domain WeakMap directly
// per render, so the two paths stay in lockstep.
describe("PlanCanvas flanges — registry change on unchanged design identity", () => {
  let container;
  let root;
  let dispatch;

  const renderCanvas = (design) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => {
      root.render(<PlanCanvas design={design} tool="select" selection={null} dispatch={dispatch} />);
    });
  };
  const rerenderCanvas = (design) => {
    act(() => {
      root.render(<PlanCanvas design={design} tool="select" selection={null} dispatch={dispatch} />);
    });
  };
  const flangeGlyphs = () => [...container.querySelectorAll('[data-testid^="pipe-flange-"]')];

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("same design object, new registry generation: flanges re-derive (z changes), plan geometry and order preserved", async () => {
    const { __resetSymbolRegistry, registerSymbolSet } = await import(
      "@/domains/roomDesigner/symbolRegistry"
    );
    const { detectRunJunctions } = await import("@/domains/roomDesigner/pipeAttachments");
    __resetElevationCache();
    __resetSymbolRegistry();
    const registerRack = (elevationIn) =>
      registerSymbolSet({
        domain: "test-rack",
        title: "Test racks",
        symbols: [
          {
            id: "rack-a",
            label: "Rack A",
            widthIn: 480,
            depthIn: 240,
            rack: { kind: "pipe", tiers: 2, elevationIn, tierSpacingIn: 72, bentSpacingIn: 240 },
          },
        ],
      });
    registerRack(180);
    // Header rides the rack at 181; two short branches junction onto it
    // over the rack, so both junction flanges sit at z=181. Plan
    // geometry (x/y/angle) is registry-independent.
    let design = placeSymbol(createEmptyDesign(), "test-rack", "rack-a", 500, 500, { id: "tr1" });
    design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "header", diameterIn: 2 });
    design = addPipeRun(design, [{ x: 500, y: 500 }, { x: 500, y: 600 }], { id: "b1", diameterIn: 2 });
    design = addPipeRun(design, [{ x: 600, y: 500 }, { x: 600, y: 600 }], { id: "b2", diameterIn: 2 });
    design = detectRunJunctions(design, "b1");
    design = detectRunJunctions(design, "b2");
    const flatBefore = connectionFlanges(design);
    expect(flatBefore).toHaveLength(2);
    expect(flatBefore.map((f) => [f.runId, f.end, f.elevationIn])).toEqual([
      ["b1", "start", 181],
      ["b2", "start", 181],
    ]);
    renderCanvas(design);
    expect(elevationCacheStats().flangeComputations).toBe(1);
    const glyphsBefore = flangeGlyphs();
    expect(glyphsBefore.map((g) => g.getAttribute("data-testid"))).toEqual([
      "pipe-flange-b1-start",
      "pipe-flange-b2-start",
    ]);
    const transformsBefore = glyphsBefore.map((g) => g.getAttribute("transform"));

    // Same design object, new registry generation (rack top 180 -> 120):
    // the mounted canvas must re-derive, not serve the stale grouping.
    __resetSymbolRegistry();
    registerRack(120);
    rerenderCanvas(design);
    expect(elevationCacheStats().flangeComputations).toBe(2);
    expect(connectionFlanges(design).map((f) => [f.runId, f.end, f.elevationIn])).toEqual([
      ["b1", "start", 121],
      ["b2", "start", 121],
    ]);
    const glyphsAfter = flangeGlyphs();
    expect(glyphsAfter.map((g) => g.getAttribute("data-testid"))).toEqual([
      "pipe-flange-b1-start",
      "pipe-flange-b2-start",
    ]);
    // Plan geometry (x/y/angle) and ordering are unchanged — only z moved.
    expect(glyphsAfter.map((g) => g.getAttribute("transform"))).toEqual(transformsBefore);
  });
});
