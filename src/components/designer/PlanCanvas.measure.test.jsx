// @vitest-environment jsdom

// Measure tool: click two points, see the distance. Never dispatches —
// a pure read, nothing in the design document changes.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PlanCanvas from "./PlanCanvas";
import { createEmptyDesign, addWall } from "@/domains/roomDesigner/designerDocument";

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

describe("PlanCanvas measure tool", () => {
  let container;
  let root;
  let dispatch;
  let svg;

  const renderCanvas = (design = createEmptyDesign()) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => {
      root.render(
        <PlanCanvas design={design} tool="measure" selection={null} dispatch={dispatch} />
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

  it("shows a live distance while aiming the second point, without dispatching anything", () => {
    renderCanvas();
    pointer(svg, "pointerdown", { x: 0, y: 0 });
    pointer(svg, "pointermove", { x: 120, y: 0 });
    expect(container.textContent).toContain("10' 0\"");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("commits a measurement on the second click and keeps it visible — still no dispatch", () => {
    renderCanvas();
    pointer(svg, "pointerdown", { x: 0, y: 0 });
    pointer(svg, "pointermove", { x: 144, y: 0 });
    pointer(svg, "pointerdown", { x: 144, y: 0 });
    expect(container.textContent).toContain("12' 0\"");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("a third click starts a brand-new measurement rather than chaining off the last point", () => {
    renderCanvas();
    pointer(svg, "pointerdown", { x: 0, y: 0 });
    pointer(svg, "pointerdown", { x: 144, y: 0 }); // first measurement: 12'
    pointer(svg, "pointerdown", { x: 200, y: 0 }); // starts fresh, not from (144,0)
    pointer(svg, "pointermove", { x: 200, y: 48 }); // 4' straight down from the new start
    expect(container.textContent).toContain("4' 0\"");
    expect(container.textContent).not.toContain("12' 0\"");
  });

  it("Escape cancels an in-progress first click without committing a measurement", () => {
    renderCanvas();
    pointer(svg, "pointerdown", { x: 0, y: 0 });
    pointer(svg, "pointermove", { x: 120, y: 0 });
    expect(container.textContent).toContain("10' 0\"");
    act(() => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.textContent).not.toContain("10' 0\"");
    // Escape's pre-existing CLEAR_SELECTION dispatch is expected and
    // unrelated to Measure; nothing measurement-specific is ever dispatched.
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: expect.stringContaining("MEASURE") }));
  });

  it("snaps the measured points to existing wall endpoints, same as drawing", () => {
    let design = createEmptyDesign();
    design = addWall(design, { x: 0, y: 0 }, { x: 120, y: 0 });
    renderCanvas(design);
    // Click near (but not exactly on) the wall's far endpoint — should snap to it.
    pointer(svg, "pointerdown", { x: 1, y: 1 });
    pointer(svg, "pointermove", { x: 121, y: -1 });
    expect(container.textContent).toContain("10' 0\"");
  });

  it("switching away from Measure hides the result; switching back starts clean", () => {
    const design = createEmptyDesign();
    renderCanvas(design);
    pointer(svg, "pointerdown", { x: 0, y: 0 });
    pointer(svg, "pointerdown", { x: 144, y: 0 });
    expect(container.textContent).toContain("12' 0\"");

    act(() => {
      root.render(<PlanCanvas design={design} tool="select" selection={null} dispatch={dispatch} />);
    });
    expect(container.textContent).not.toContain("12' 0\"");

    act(() => {
      root.render(<PlanCanvas design={design} tool="measure" selection={null} dispatch={dispatch} />);
    });
    // A fresh click now starts a NEW measurement, not finalizing against
    // the stale pre-switch start point.
    pointer(svg, "pointerdown", { x: 0, y: 0 });
    pointer(svg, "pointermove", { x: 0, y: 24 });
    expect(container.textContent).toContain("2' 0\"");
    expect(dispatch).not.toHaveBeenCalled();
  });
});
