// @vitest-environment jsdom

// Racks on the plan: steel drawn from rackPlan, and hit-testing that lets
// pipes on the rack and pumps under it win over the rack itself.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PlanCanvas from "./PlanCanvas";
import { addPipeRun, createEmptyDesign, placeSymbol } from "@/domains/roomDesigner/designerDocument";

if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
const toScreen = (p) => ({ x: 60 + 1.6 * p.x, y: 60 + 1.6 * p.y });

describe("PlanCanvas racks", () => {
  let container;
  let root;
  let dispatch;
  const renderCanvas = (design) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => root.render(<PlanCanvas design={design} tool="select" selection={null} dispatch={dispatch} />));
  };
  const clickAt = (plan) => {
    const svg = container.querySelector("svg");
    const { x, y } = toScreen(plan);
    for (const type of ["pointerdown", "pointerup"]) {
      act(() => svg.dispatchEvent(new window.PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })));
    }
    return dispatch.mock.calls.map((c) => c[0]).filter((a) => a.type === "SELECT").map((a) => a.selection);
  };
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // Rack 480 x 240 centred at (300, 200): spans x 60..540, y 80..320.
  function yard() {
    let d = placeSymbol(createEmptyDesign("Y"), "processEquipment", "pipe-rack", 300, 200, { id: "rack", tag: "PR-1" });
    d = addPipeRun(d, [{ x: 60, y: 150 }, { x: 540, y: 150 }], { id: "line" });
    return placeSymbol(d, "processEquipment", "centrifugal-pump", 200, 260, { id: "pump" });
  }

  it("draws bents, columns and the TOS note", () => {
    renderCanvas(yard());
    const g = container.querySelector('[data-rack="pipe"]');
    expect(g).not.toBeNull();
    expect(g.querySelectorAll("rect").length).toBe(1 + 6); // outline + 6 columns
    expect(container.textContent).toMatch(/TOS EL 15' 0" · 2 tiers @ 6' 0"/);
  });

  it("a pipe on the rack and a pump under it win the click; bare rack area selects the rack", () => {
    renderCanvas(yard());
    expect(clickAt({ x: 400, y: 150 })).toEqual([{ kind: "pipe", id: "line" }]);
    dispatch.mockClear();
    expect(clickAt({ x: 200, y: 260 })).toEqual([{ kind: "symbol", id: "pump" }]);
    dispatch.mockClear();
    expect(clickAt({ x: 450, y: 280 })).toEqual([{ kind: "symbol", id: "rack" }]);
  });
});
