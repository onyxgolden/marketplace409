// @vitest-environment jsdom

// Systems on the plan: pipes and equipment draw in their system color (an
// object's own color wins), underground pipe is dashed and tagged UG, and a
// legend lists the systems in use.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PlanCanvas from "./PlanCanvas";
import { addPipeRun, createEmptyDesign, placeSymbol } from "@/domains/roomDesigner/designerDocument";
import { addSystem, setMemberColor, setMemberSystem, setPipeUnderground } from "@/domains/roomDesigner/designSystems";

if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

function plant() {
  let d = addPipeRun(createEmptyDesign("S"), [{ x: 0, y: 0 }, { x: 120, y: 0 }], { id: "cw" });
  d = addPipeRun(d, [{ x: 0, y: 60 }, { x: 120, y: 60 }], { id: "plain" });
  d = placeSymbol(d, "processEquipment", "centrifugal-pump", 200, 0, { id: "p1" });
  d = placeSymbol(d, "processEquipment", "centrifugal-pump", 200, 80, { id: "p2" });
  d = addSystem(d, { name: "Cooling water", color: "#22c55e" });
  d = setMemberSystem(d, { kind: "pipe", id: "cw" }, "system_1");
  d = setMemberSystem(d, { kind: "symbol", id: "p1" }, "system_1");
  d = setMemberColor(d, { kind: "symbol", id: "p2" }, "#a855f7");
  return setPipeUnderground(d, "cw", true);
}

describe("PlanCanvas systems", () => {
  let container;
  let root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<PlanCanvas design={plant()} tool="select" selection={null} dispatch={vi.fn()} />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("colors pipes by system and keeps the default for unassigned runs", () => {
    const strokes = [...container.querySelectorAll("polyline")].map((p) => p.getAttribute("stroke"));
    expect(strokes).toContain("#22c55e");
    expect(strokes).toContain("#7dd3fc");
  });

  it("dashes underground pipe and tags its label UG", () => {
    const ug = container.querySelector('polyline[data-underground="true"]');
    expect(ug).not.toBeNull();
    expect(ug.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(container.textContent).toMatch(/UG · /);
  });

  it("draws equipment outlines in the system color, or the item's own color", () => {
    const html = container.innerHTML;
    expect(html).toMatch(/stroke="#22c55e"/); // p1 via Cooling water
    expect(html).toMatch(/stroke="#a855f7"/); // p2 own color
  });

  it("shows a legend of the systems in use and the UG key", () => {
    const legend = container.querySelector('[data-testid="systems-legend"]');
    expect(legend).not.toBeNull();
    expect(legend.textContent).toMatch(/Cooling water/);
    expect(legend.textContent).toMatch(/UG = underground/);
  });

  it("no legend when nothing uses a system", () => {
    act(() => root.render(<PlanCanvas design={createEmptyDesign("x")} tool="select" selection={null} dispatch={vi.fn()} />));
    expect(container.querySelector('[data-testid="systems-legend"]')).toBeNull();
  });
});
