// @vitest-environment jsdom

// Wall-rect tool: dragging on the canvas dispatches a single ADD_WALL_RECT
// with the two snapped corners; degenerate drags dispatch nothing.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PlanCanvas from "./PlanCanvas";
import { createEmptyDesign } from "@/domains/roomDesigner/designerDocument";

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
  // Each event gets its own act() so canvas drag state flushes between
  // pointerdown → pointermove → pointerup, like real user interaction.
  act(() => {
    target.dispatchEvent(
      new window.PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
    );
  });
}

describe("PlanCanvas wall-rect tool", () => {
  let container;
  let root;
  let dispatch;
  let svg;

  const renderCanvas = (tool) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => {
      root.render(
        <PlanCanvas design={createEmptyDesign()} tool={tool} selection={null} dispatch={dispatch} />
      );
    });
    svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  };

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("dispatches one ADD_WALL_RECT with the two snapped corners", () => {
    renderCanvas("wallrect");
    pointer(svg, "pointerdown", { x: 0, y: 0 });
    pointer(svg, "pointermove", { x: 144, y: 120 });
    pointer(svg, "pointerup", { x: 144, y: 120 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_WALL_RECT",
      a: { x: 0, y: 0 },
      b: { x: 144, y: 120 },
    });
  });

  it("ignores degenerate rectangles (under 1 inch on a side)", () => {
    renderCanvas("wallrect");
    pointer(svg, "pointerdown", { x: 0, y: 0 });
    pointer(svg, "pointermove", { x: 0.4, y: 0.4 });
    pointer(svg, "pointerup", { x: 0.4, y: 0.4 });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("single-wall tool still dispatches ADD_WALL, not ADD_WALL_RECT", () => {
    renderCanvas("wall");
    pointer(svg, "pointerdown", { x: 0, y: 0 });
    pointer(svg, "pointermove", { x: 144, y: 0 });
    pointer(svg, "pointerup", { x: 144, y: 0 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_WALL",
      a: { x: 0, y: 0 },
      b: { x: 144, y: 0 },
    });
  });
});
