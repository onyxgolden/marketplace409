// @vitest-environment jsdom

// Open-time auto-fit, all viewport sizes: the Designer starts with the
// full drawing visible on computer AND phone. Covers the cases the
// phone-only fit missed: desktop open/switch, and content arriving after
// first render under an identity whose fit never landed (the async
// project load landing after an empty first render). Once a fit lands,
// edits never refit, and a user interaction before the fit cancels it
// for that identity — the view is the user's from then on.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import PlanCanvas from "./PlanCanvas";
import {
  addWall,
  createEmptyDesign,
} from "@/domains/roomDesigner/designerDocument";

// PlanCanvas measures its wrapper via clientWidth/clientHeight (read once
// in an effect) and a ResizeObserver callback. jsdom reports 0 for every
// element, so both are stubbed: the size comes from a mutable mock the
// tests set before rendering, and ResizeObserver callbacks are captured
// so a test can fire a "resize" by hand.
let mockSize = { w: 0, h: 0 };
const roCallbacks = [];
window.ResizeObserver = class {
  constructor(cb) {
    roCallbacks.push(cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
};
const widthDesc = Object.getOwnPropertyDescriptor(window.Element.prototype, "clientWidth");
const heightDesc = Object.getOwnPropertyDescriptor(window.Element.prototype, "clientHeight");
Object.defineProperty(window.Element.prototype, "clientWidth", {
  configurable: true,
  get() {
    return mockSize.w;
  },
});
Object.defineProperty(window.Element.prototype, "clientHeight", {
  configurable: true,
  get() {
    return mockSize.h;
  },
});
afterAll(() => {
  if (widthDesc) Object.defineProperty(window.Element.prototype, "clientWidth", widthDesc);
  else delete window.Element.prototype.clientWidth;
  if (heightDesc) Object.defineProperty(window.Element.prototype, "clientHeight", heightDesc);
  else delete window.Element.prototype.clientHeight;
});

function triggerResize() {
  act(() => {
    for (const cb of roCallbacks) cb();
  });
}

// The wall's solid segment: stroke #e5e7eb (dimension lines use #9ca3af).
function wallLine(container, index = 0) {
  const lines = [...container.querySelectorAll("line")].filter(
    (l) => l.getAttribute("stroke") === "#e5e7eb",
  );
  return lines[index];
}
const coords = (line) => ({
  x1: Number(line.getAttribute("x1")),
  y1: Number(line.getAttribute("y1")),
  x2: Number(line.getAttribute("x2")),
  y2: Number(line.getAttribute("y2")),
});

// 7680 x 5280 in of content: two horizontal walls at the extremes.
function largeDesign() {
  let design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 7680, y: 0 });
  design = addWall(design, { x: 0, y: 5280 }, { x: 7680, y: 5280 });
  return design;
}

describe("PlanCanvas open-time fit (all sizes)", () => {
  let container;
  let root;

  const renderCanvas = (design, props = {}) => {
    if (!root) {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    }
    act(() => {
      root.render(
        <PlanCanvas design={design} tool="select" selection={null} dispatch={vi.fn()} {...props} />,
      );
    });
  };

  afterEach(() => {
    if (root) act(() => root.unmount());
    root = null;
    container?.remove();
    container = null;
    roCallbacks.length = 0;
    mockSize = { w: 0, h: 0 };
  });

  it("fits a large drawing on a desktop canvas, 48px margin", () => {
    mockSize = { w: 1200, h: 800 };
    renderCanvas(largeDesign(), { autoFitKey: "p1:level1" });
    // avail = 1104 x 704; height limits: scale = 704 / 5280.
    const scale = 704 / 5280;
    const first = coords(wallLine(container, 0));
    expect(first.x1).toBeCloseTo(88, 6);
    expect(first.x2).toBeCloseTo(1112, 6);
    expect(first.y1).toBeCloseTo(48, 6);
    const second = coords(wallLine(container, 1));
    expect(second.y1).toBeCloseTo(752, 6);
    for (const c of [first, second]) {
      expect(c.x1).toBeGreaterThanOrEqual(0);
      expect(c.x2).toBeLessThanOrEqual(1200);
      expect(c.y1).toBeGreaterThanOrEqual(0);
      expect(c.y1).toBeLessThanOrEqual(800);
    }
  });

  it("fits on a desktop level switch", () => {
    mockSize = { w: 1200, h: 800 };
    const small = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 200, y: 100 });
    renderCanvas(small, { autoFitKey: "p1:level1" });
    renderCanvas(largeDesign(), { autoFitKey: "p1:level2" });
    const first = coords(wallLine(container, 0));
    expect(first.x1).toBeCloseTo(88, 6);
    expect(first.x2).toBeCloseTo(1112, 6);
  });

  it("fits the async load: empty mount, then content under the same identity", () => {
    mockSize = { w: 390, h: 700 };
    renderCanvas(createEmptyDesign(), { autoFitKey: "p1:level1" });
    // The empty attempt leaves the identity pending, not settled.
    expect(container.textContent).toContain("Start your floor plan");
    renderCanvas(largeDesign(), { autoFitKey: "p1:level1" });
    const first = coords(wallLine(container, 0));
    expect(first.x1).toBeCloseTo(24, 6);
    expect(first.x2).toBeCloseTo(366, 6);
  });

  it("fits the async load on desktop under the same identity", () => {
    mockSize = { w: 1200, h: 800 };
    renderCanvas(createEmptyDesign(), { autoFitKey: "p1:level1" });
    renderCanvas(largeDesign(), { autoFitKey: "p1:level1" });
    const first = coords(wallLine(container, 0));
    expect(first.x1).toBeCloseTo(88, 6);
    expect(first.x2).toBeCloseTo(1112, 6);
  });

  it("does not refit once settled, even as content grows under the same identity", () => {
    mockSize = { w: 1200, h: 800 };
    let design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 200, y: 100 });
    renderCanvas(design, { autoFitKey: "p1:level1" });
    // Settled fit: scale = 1104 / 200 = 5.52, ox = 48, oy = 124.
    expect(coords(wallLine(container))).toEqual({ x1: 48, y1: 124, x2: 1152, y2: 676 });
    design = addWall(design, { x: 2000, y: 0 }, { x: 2240, y: 120 });
    renderCanvas(design, { autoFitKey: "p1:level1" });
    expect(coords(wallLine(container, 0))).toEqual({ x1: 48, y1: 124, x2: 1152, y2: 676 });
  });

  it("a user interaction before the fit cancels it on desktop too", () => {
    mockSize = { w: 0, h: 0 };
    const design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 240, y: 120 });
    renderCanvas(design, { autoFitKey: "p1:level1" });
    const svg = container.querySelector("svg");
    act(() => {
      svg.dispatchEvent(
        new window.PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    mockSize = { w: 1200, h: 800 };
    triggerResize();
    // Default view { scale: 1.6, ox: 60, oy: 60 } — no fit, no yank.
    expect(coords(wallLine(container))).toEqual({ x1: 60, y1: 60, x2: 444, y2: 252 });
  });

  it("phone open sequence: empty mount, load with a new identity, still fits", () => {
    mockSize = { w: 390, h: 700 };
    renderCanvas(createEmptyDesign(), { autoFitKey: "p1:pending" });
    renderCanvas(largeDesign(), { autoFitKey: "p1:level1" });
    const first = coords(wallLine(container, 0));
    expect(first.x1).toBeCloseTo(24, 6);
    expect(first.x2).toBeCloseTo(366, 6);
  });

  // P689-001: settlement belongs to the current activation of an identity,
  // not a remembered matching string. A → B(pending) → A must fit again on
  // the return, on desktop and phone, whatever made B pending.
  it("fits A again after an empty B on desktop", () => {
    mockSize = { w: 1200, h: 800 };
    renderCanvas(largeDesign(), { autoFitKey: "A" });
    expect(coords(wallLine(container)).x1).toBeCloseTo(88, 6);
    renderCanvas(createEmptyDesign(), { autoFitKey: "B" });
    renderCanvas(largeDesign(), { autoFitKey: "A" });
    expect(coords(wallLine(container)).x1).toBeCloseTo(88, 6);
  });

  it("fits A again after an empty B on phone", () => {
    mockSize = { w: 390, h: 700 };
    renderCanvas(largeDesign(), { autoFitKey: "A" });
    expect(coords(wallLine(container)).x1).toBeCloseTo(24, 6);
    renderCanvas(createEmptyDesign(), { autoFitKey: "B" });
    renderCanvas(largeDesign(), { autoFitKey: "A" });
    const first = coords(wallLine(container));
    expect(first.x1).toBeCloseTo(24, 6);
    expect(first.x2).toBeCloseTo(366, 6);
  });

  it("fits A again after a cancelled B on desktop", () => {
    mockSize = { w: 1200, h: 800 };
    renderCanvas(largeDesign(), { autoFitKey: "A" });
    expect(coords(wallLine(container)).x1).toBeCloseTo(88, 6);
    // Drive the canvas unmeasured, then let B arrive and be cancelled by
    // a user interaction before any fit can land for it.
    mockSize = { w: 0, h: 0 };
    triggerResize();
    renderCanvas(largeDesign(), { autoFitKey: "B" });
    const svg = container.querySelector("svg");
    act(() => {
      svg.dispatchEvent(
        new window.PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    mockSize = { w: 1200, h: 800 };
    triggerResize();
    // B stays on the default view (cancelled), not fitted.
    expect(coords(wallLine(container)).x1).toBeCloseTo(60, 6);
    // Returning to A is a fresh activation: it fits again, and B's
    // cancellation does not poison it.
    renderCanvas(largeDesign(), { autoFitKey: "A" });
    expect(coords(wallLine(container)).x1).toBeCloseTo(88, 6);
  });

  it("fits A again after an unmeasured B on desktop", () => {
    mockSize = { w: 1200, h: 800 };
    renderCanvas(largeDesign(), { autoFitKey: "A" });
    expect(coords(wallLine(container)).x1).toBeCloseTo(88, 6);
    // B arrives while the canvas is unmeasured, so no fit can land for
    // it; A returns while still unmeasured, and only then is the canvas
    // measured — the pending return-to-A fit must land on measurement.
    mockSize = { w: 0, h: 0 };
    triggerResize();
    renderCanvas(largeDesign(), { autoFitKey: "B" });
    renderCanvas(largeDesign(), { autoFitKey: "A" });
    mockSize = { w: 1200, h: 800 };
    triggerResize();
    expect(coords(wallLine(container)).x1).toBeCloseTo(88, 6);
  });

  it("a refit after returning to A settles the new activation: later edits do not refit", () => {
    mockSize = { w: 1200, h: 800 };
    renderCanvas(largeDesign(), { autoFitKey: "A" });
    renderCanvas(createEmptyDesign(), { autoFitKey: "B" });
    renderCanvas(largeDesign(), { autoFitKey: "A" });
    expect(coords(wallLine(container)).x1).toBeCloseTo(88, 6);
    // Growing the drawing under the returned activation must not refit:
    // a refit would move x1 to 150 (scale 704/6000 on the taller content).
    let design = largeDesign();
    design = addWall(design, { x: 0, y: 6000 }, { x: 7680, y: 6000 });
    renderCanvas(design, { autoFitKey: "A" });
    expect(coords(wallLine(container)).x1).toBeCloseTo(88, 6);
  });
});
