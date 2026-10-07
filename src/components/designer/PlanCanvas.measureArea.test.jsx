// @vitest-environment jsdom

// Measure tool, Area mode: click the corners of a space, click the first
// corner to close it, and read its area and perimeter. Never dispatches.

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

function click(target, plan) {
  pointer(target, "pointerdown", plan);
  pointer(target, "pointerup", plan);
}

describe("PlanCanvas measure tool, Area mode", () => {
  let container;
  let root;
  let dispatch;
  let svg;

  const renderCanvas = (tool = "measure-area") => {
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

  // A 12 ft by 10 ft room, traced clockwise from its top-left corner, then
  // closed by clicking that corner again.
  const traceRoom = () => {
    click(svg, { x: 0, y: 0 });
    click(svg, { x: 144, y: 0 });
    click(svg, { x: 144, y: 120 });
    click(svg, { x: 0, y: 120 });
    click(svg, { x: 0, y: 0 });
  };

  it("closing a traced room shows its area in sq ft and its perimeter", () => {
    renderCanvas();
    traceRoom();
    expect(svg.textContent).toContain("120 sq ft");
    expect(svg.textContent).toContain("perimeter");
  });

  it("never dispatches anything, so the design document is untouched", () => {
    renderCanvas();
    traceRoom();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not close on the first click, since a shape needs three corners", () => {
    renderCanvas();
    click(svg, { x: 0, y: 0 });
    click(svg, { x: 0, y: 0 });
    expect(svg.textContent).not.toContain("sq ft");
  });

  it("Escape clears a half-traced shape and any closed result", () => {
    renderCanvas();
    traceRoom();
    expect(svg.textContent).toContain("120 sq ft");
    act(() => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(svg.textContent).not.toContain("sq ft");
  });

  it("leaving the Area mode clears the last result", () => {
    renderCanvas();
    traceRoom();
    expect(svg.textContent).toContain("120 sq ft");
    act(() => {
      root.render(
        <PlanCanvas design={createEmptyDesign()} tool="pan" selection={null} dispatch={dispatch} />
      );
    });
    expect(container.querySelector("svg").textContent).not.toContain("sq ft");
  });

  it("the distance Measure mode is unchanged by the new Area mode", () => {
    renderCanvas("measure");
    click(svg, { x: 0, y: 0 });
    click(svg, { x: 120, y: 0 });
    expect(svg.textContent).not.toContain("sq ft");
    expect(dispatch).not.toHaveBeenCalled();
  });
});
