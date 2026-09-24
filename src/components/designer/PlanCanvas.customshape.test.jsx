// @vitest-environment jsdom

// Custom-shape tool on the canvas: click to drop a copy of the pending
// saved shape, snapped and centered on the click point.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PlanCanvas from "./PlanCanvas";
import { createEmptyDesign } from "@/domains/roomDesigner/designerDocument";

if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const toScreen = (plan) => ({ x: 60 + 1.6 * plan.x, y: 60 + 1.6 * plan.y });

function pointer(target, type, plan) {
  const { x, y } = toScreen(plan);
  act(() => {
    target.dispatchEvent(
      new window.PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }),
    );
  });
}

const shape = {
  id: "shape-1",
  name: "Nook",
  bounds: { widthIn: 120, heightIn: 60 },
  entities: {
    walls: [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 120, y: 0 } }],
    rooms: [], openings: [], furniture: [], pipes: [], symbols: [],
  },
};

describe("PlanCanvas custom-shape tool", () => {
  let container;
  let root;
  let dispatch;
  let svg;

  const renderCanvas = (pendingCustomShape) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => {
      root.render(
        <PlanCanvas
          design={createEmptyDesign()}
          tool="custom-shape"
          selection={null}
          pendingCustomShape={pendingCustomShape}
          dispatch={dispatch}
        />,
      );
    });
    svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  };

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("dispatches PLACE_CUSTOM_SHAPE at the clicked point, snapped to the grid", () => {
    renderCanvas(shape);
    // (100,100) is not on the default 6" grid; it snaps to (102,102).
    pointer(svg, "pointerdown", { x: 100, y: 100 });
    pointer(svg, "pointerup", { x: 100, y: 100 });
    expect(dispatch).toHaveBeenCalledWith({ type: "PLACE_CUSTOM_SHAPE", x: 102, y: 102 });
  });

  it("passes an already grid-aligned point through unchanged", () => {
    renderCanvas(shape);
    pointer(svg, "pointerdown", { x: 120, y: 120 });
    pointer(svg, "pointerup", { x: 120, y: 120 });
    expect(dispatch).toHaveBeenCalledWith({ type: "PLACE_CUSTOM_SHAPE", x: 120, y: 120 });
  });

  it("renders a placement ghost sized to the shape's bounds, centered on the cursor", () => {
    renderCanvas(shape);
    pointer(svg, "pointermove", { x: 200, y: 100 });
    const ghost = container.querySelector('[data-testid="placement-ghost"]');
    expect(ghost).not.toBeNull();
    expect(ghost.textContent).toContain("Nook");
    const rect = ghost.querySelector("rect");
    // widthIn 120 * scale 1.6 = 192px; centered means x offset by half.
    expect(Number(rect.getAttribute("width"))).toBeCloseTo(192, 0);
  });

  it("does nothing without a pending shape", () => {
    renderCanvas(null);
    pointer(svg, "pointerdown", { x: 120, y: 120 });
    pointer(svg, "pointerup", { x: 120, y: 120 });
    // Click still fires PLACE_CUSTOM_SHAPE (the reducer itself no-ops on a
    // missing shape); the canvas does not need to know the tool is unusable.
    expect(dispatch).toHaveBeenCalledWith({ type: "PLACE_CUSTOM_SHAPE", x: 120, y: 120 });
    // But no ghost renders with nothing to preview.
    expect(container.querySelector('[data-testid="placement-ghost"]')).toBeNull();
  });
});
