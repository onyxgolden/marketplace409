// @vitest-environment jsdom

// Pipe tool + TEMA nozzles: a click near a nozzle anchor snaps the run's
// vertex exactly onto it, in both drawing modes.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PlanCanvas from "./PlanCanvas";
import { createEmptyDesign, placeSymbol } from "@/domains/roomDesigner/designerDocument";
import { findSymbol } from "@/domains/roomDesigner/symbolRegistry";
import { temaAnchorsWorld } from "@/domains/roomDesigner/temaGeometry";
import { setSymbolDrawingMode, setSymbolTemaConfig } from "@/domains/roomDesigner/temaInstances";
import { TEMA_PRESETS } from "@/domains/roomDesigner/temaTypes";

if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Default view: scale 1.6, offset (60,60) -> screen = 60 + 1.6 * plan.
const toScreen = (plan) => ({ x: 60 + 1.6 * plan.x, y: 60 + 1.6 * plan.y });
function fire(target, type, plan, Ctor = window.PointerEvent) {
  const { x, y } = toScreen(plan);
  act(() => {
    target.dispatchEvent(new Ctor(type, { bubbles: true, button: 0, clientX: x, clientY: y }));
  });
}

function exchangerDesign(mode) {
  let design = placeSymbol(createEmptyDesign(), "processEquipment", "tema-exchanger", 200, 150, { id: "hx" });
  design = setSymbolTemaConfig(design, "hx", TEMA_PRESETS.AES);
  if (mode) design = setSymbolDrawingMode(design, "hx", mode);
  return design;
}

describe("PlanCanvas pipe tool snaps to TEMA nozzles", () => {
  let container;
  let root;
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each([["detailed"], ["pid"]])("starts the run on the tube inlet anchor (%s)", (mode) => {
    const design = exchangerDesign(mode);
    const tubeIn = temaAnchorsWorld(findSymbol("processEquipment", "tema-exchanger"), design.symbols[0]).find((a) => a.id === "tube-in");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const dispatch = vi.fn();
    act(() => {
      root.render(<PlanCanvas design={design} tool="pipe" selection={null} orthoSnap={false} dispatch={dispatch} />);
    });
    const svg = container.querySelector("svg");
    fire(svg, "pointerdown", { x: tubeIn.x + 2.5, y: tubeIn.y - 2 });
    fire(svg, "pointerup", { x: tubeIn.x + 2.5, y: tubeIn.y - 2 });
    fire(svg, "pointerdown", { x: 60, y: 24 });
    fire(svg, "pointerup", { x: 60, y: 24 });
    fire(svg, "dblclick", { x: 60, y: 24 }, window.MouseEvent);
    const call = dispatch.mock.calls.find(([a]) => a.type === "ADD_PIPE_RUN");
    expect(call).toBeTruthy();
    expect(call[0].points[0].x).toBeCloseTo(tubeIn.x, 6);
    expect(call[0].points[0].y).toBeCloseTo(tubeIn.y, 6);
  });
});
