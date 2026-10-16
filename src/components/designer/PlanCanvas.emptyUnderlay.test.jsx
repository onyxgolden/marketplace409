// @vitest-environment jsdom

// The "Start your floor plan" prompt must not sit on top of an imported
// background (a traced-over scan or plan image) just because no walls are
// drawn yet — the underlay is the starting point.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import PlanCanvas from "./PlanCanvas";
import { createEmptyDesign, setUnderlay } from "@/domains/roomDesigner/designerDocument";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
});
function render(design) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<PlanCanvas design={design} tool="select" selection={null} dispatch={vi.fn()} />));
}

describe("empty-plan prompt and background underlay", () => {
  it("shows on a truly empty plan", () => {
    render(createEmptyDesign());
    expect(container.textContent).toContain("Start your floor plan");
  });

  it("hides once a background image is placed, even with no walls yet", () => {
    render(setUnderlay(createEmptyDesign(), {
      name: "scan.png", mimeType: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgo=", widthPx: 100, heightPx: 80,
    }));
    expect(container.textContent).not.toContain("Start your floor plan");
  });
});
