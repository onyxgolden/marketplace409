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
