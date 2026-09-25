// @vitest-environment jsdom

// PlanCanvas — what one-tap Favorites placement relies on:
//   - the canvas reports the plan point at the middle of its viewport
//   - a furniture-only plan is not hidden under the "Start your floor plan" prompt

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import PlanCanvas from "./PlanCanvas";
import { createEmptyDesign, placeFurniture } from "@/domains/roomDesigner/designerDocument";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A ResizeObserver that reports an 800x600 canvas immediately.
window.ResizeObserver = class {
  constructor(cb) { this.cb = cb; }
  observe() { this.cb([{ contentRect: { width: 800, height: 600 } }]); }
  unobserve() {}
  disconnect() {}
};

let container;
let root;
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete HTMLElement.prototype.clientWidth;
  delete HTMLElement.prototype.clientHeight;
});

function render(design, props = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom has no layout: give the wrapper a size for clientWidth/clientHeight.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
  act(() => root.render(<PlanCanvas design={design} tool="select" selection={null} dispatch={vi.fn()} {...props} />));
}

describe("PlanCanvas and Favorites placement", () => {
  it("reports the visible viewport's center in plan inches", () => {
    const onViewCenterChange = vi.fn();
    render(createEmptyDesign(), { onViewCenterChange });
    // Default view: scale 1.6, origin offset (60, 60); an 800x600 canvas.
    expect(onViewCenterChange).toHaveBeenLastCalledWith({ x: (400 - 60) / 1.6, y: (300 - 60) / 1.6 });
  });

  it("hides the empty-plan prompt once the plan has furniture", () => {
    render(createEmptyDesign());
    expect(container.textContent).toContain("Start your floor plan");
    act(() => root.unmount());
    container.remove();
    render(placeFurniture(createEmptyDesign(), "sofa-3seat", 100, 100));
    expect(container.textContent).not.toContain("Start your floor plan");
  });
});
