// @vitest-environment jsdom

// Placement ghost previews: a mouse-following, semi-transparent preview of
// what the active placement tool would commit at the cursor. The ghost is
// component-local preview state — cursor tracking must never dispatch, so
// it can never write to the design document or create undo entries.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PlanCanvas from "./PlanCanvas";
import "@/domains/roomDesigner/pipingCatalog"; // registers the piping symbol set
import {
  addWall,
  createEmptyDesign,
} from "@/domains/roomDesigner/designerDocument";

// PlanCanvas uses a ResizeObserver for its wrapper size; jsdom has none.
if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Default view: scale 1.6, offset (60,60) → screen = 60 + 1.6 * plan.
const toScreen = (plan) => ({ x: 60 + 1.6 * plan.x, y: 60 + 1.6 * plan.y });

function pointer(target, type, plan) {
  const { x, y } = toScreen(plan);
  act(() => {
    target.dispatchEvent(
      new window.PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
    );
  });
}

function pressEscape() {
  act(() => {
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  });
}

describe("PlanCanvas placement ghost", () => {
  let container;
  let root;
  let dispatch;
  let svg;

  const renderCanvas = (design, props = {}) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => {
      root.render(
        <PlanCanvas
          design={design}
          tool="select"
          selection={null}
          dispatch={dispatch}
          {...props}
        />
      );
    });
    svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  };

  const rerender = (design, props = {}) => {
    act(() => {
      root.render(
        <PlanCanvas
          design={design}
          tool="select"
          selection={null}
          dispatch={dispatch}
          {...props}
        />
      );
    });
  };

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const ghost = () => container.querySelector('[data-testid="placement-ghost"]');

  it("follows the mouse with the snapped room footprint", () => {
    renderCanvas(createEmptyDesign(), { tool: "room", pendingRoomTemplate: "bedroom" });
    // (61.4, 60) snaps to the 6" grid at (60, 60); the 144x144 bedroom
    // footprint starts there.
    pointer(svg, "pointermove", { x: 61.4, y: 60 });
    const g = ghost();
    expect(g).not.toBeNull();
    const polygon = g.querySelector("polygon");
    const tl = toScreen({ x: 60, y: 60 });
    const br = toScreen({ x: 204, y: 204 });
    expect(polygon.getAttribute("points")).toContain(`${tl.x},${tl.y}`);
    expect(polygon.getAttribute("points")).toContain(`${br.x},${br.y}`);
    expect(g.querySelector("text").textContent).toContain("Bedroom");
  });

  it("never dispatches while tracking the cursor", () => {
    renderCanvas(createEmptyDesign(), { tool: "room", pendingRoomTemplate: "bedroom" });
    pointer(svg, "pointermove", { x: 61.4, y: 60 });
    pointer(svg, "pointermove", { x: 90, y: 90 });
    pointer(svg, "pointermove", { x: 120, y: 120 });
    // No design writes, no undo entries — the ghost is preview-only.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("shows the door ghost on the hovered wall and hides it off-wall", () => {
    const design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 240, y: 0 });
    renderCanvas(design, { tool: "door" });
    // (100, 5) is within tolerance of the wall; the 36" default door width
    // snaps its offset 100 -> 102 on the 6" grid.
    pointer(svg, "pointermove", { x: 100, y: 5 });
    let g = ghost();
    expect(g).not.toBeNull();
    const line = g.querySelector("line");
    const g1 = toScreen({ x: 102, y: 0 });
    const g2 = toScreen({ x: 138, y: 0 });
    expect(Number(line.getAttribute("x1"))).toBeCloseTo(g1.x, 5);
    expect(Number(line.getAttribute("x2"))).toBeCloseTo(g2.x, 5);
    expect(g.querySelector("text").textContent).toContain("door");
    // Far from any wall: no ghost.
    pointer(svg, "pointermove", { x: 400, y: 400 });
    expect(ghost()).toBeNull();
  });

  it("shows the furniture footprint only when a catalog piece is pending", () => {
    renderCanvas(createEmptyDesign(), { tool: "furniture", pendingCatalogId: "sofa-3seat" });
    pointer(svg, "pointermove", { x: 60, y: 60 });
    const g = ghost();
    expect(g).not.toBeNull();
    expect(g.querySelector("polygon")).not.toBeNull();
    expect(g.querySelector("text").textContent).toContain("Sofa");
  });

  it("shows nothing for the furniture tool without a pending piece", () => {
    renderCanvas(createEmptyDesign(), { tool: "furniture", pendingCatalogId: null });
    pointer(svg, "pointermove", { x: 60, y: 60 });
    expect(ghost()).toBeNull();
  });

  it("shows the piping-symbol footprint for the symbol tool", () => {
    renderCanvas(createEmptyDesign(), {
      tool: "piping",
      pendingSymbol: { domain: "piping", symbolId: "gate-valve" },
    });
    pointer(svg, "pointermove", { x: 60, y: 60 });
    const g = ghost();
    expect(g).not.toBeNull();
    expect(g.querySelector("text").textContent).toContain("Gate valve");
  });

  it("shows nothing for non-placement tools", () => {
    renderCanvas(createEmptyDesign(), { tool: "select" });
    pointer(svg, "pointermove", { x: 60, y: 60 });
    expect(ghost()).toBeNull();
  });

  it("Escape clears the ghost", () => {
    renderCanvas(createEmptyDesign(), { tool: "room", pendingRoomTemplate: "bedroom" });
    pointer(svg, "pointermove", { x: 61.4, y: 60 });
    expect(ghost()).not.toBeNull();
    pressEscape();
    expect(ghost()).toBeNull();
  });

  it("switching tools clears the ghost", () => {
    const design = createEmptyDesign();
    renderCanvas(design, { tool: "room", pendingRoomTemplate: "bedroom" });
    pointer(svg, "pointermove", { x: 61.4, y: 60 });
    expect(ghost()).not.toBeNull();
    rerender(design, { tool: "select" });
    expect(ghost()).toBeNull();
  });

  it("does not show the ghost while a drag is in progress", () => {
    const design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 240, y: 0 });
    renderCanvas(design, { tool: "wall" });
    // pointerdown starts a wall draw drag; the draw preview (not the
    // ghost anchor) owns the preview layer during the drag.
    pointer(svg, "pointerdown", { x: 60, y: 60 });
    pointer(svg, "pointermove", { x: 120, y: 60 });
    expect(ghost()).toBeNull();
  });
});
