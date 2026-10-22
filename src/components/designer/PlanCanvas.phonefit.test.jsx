// @vitest-environment jsdom

// Phone auto-fit: mounting PlanCanvas with a content-bearing design in a
// phone-width container fits the whole drawing in view; a desktop-width
// container keeps the default view byte-for-byte. The fit fires once per
// autoFitKey identity (open / level switch), never on edits, resizes, or
// after the user has navigated, and the interactive zoom floor follows a
// below-minimum fitted scale instead of snapping up on the first wheel.

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

describe("PlanCanvas phone auto-fit", () => {
  let container;
  let root;
  let dispatch;

  const renderCanvas = (design, props = {}) => {
    if (!root) {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      dispatch = vi.fn();
    }
    act(() => {
      root.render(
        <PlanCanvas
          design={design}
          tool="select"
          selection={null}
          dispatch={dispatch}
          {...props}
        />,
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

  it("fits the whole large drawing, centered with margin, on a phone canvas", () => {
    mockSize = { w: 390, h: 700 };
    renderCanvas(largeDesign(), { autoFitKey: "p1:level1" });
    // Fit scale = (390 - 48) / 7680 ≈ 0.0445 — far below the 0.35 floor.
    const scale = 342 / 7680;
    const first = coords(wallLine(container, 0));
    expect(first.x1).toBeCloseTo(24, 6);
    expect(first.x2).toBeCloseTo(366, 6);
    expect(first.y1).toBeCloseTo((700 - 5280 * scale) / 2, 6);
    expect(first.y2).toBeCloseTo(first.y1, 6);
    const second = coords(wallLine(container, 1));
    expect(second.y1).toBeCloseTo(first.y1 + 5280 * scale, 6);
    // Everything lands inside the canvas.
    for (const c of [first, second]) {
      expect(c.x1).toBeGreaterThanOrEqual(0);
      expect(c.x2).toBeLessThanOrEqual(390);
      expect(c.y1).toBeGreaterThanOrEqual(0);
      expect(c.y1).toBeLessThanOrEqual(700);
    }
  });

  it("leaves the default view untouched on a desktop canvas", () => {
    mockSize = { w: 1200, h: 800 };
    const design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 200, y: 100 });
    renderCanvas(design, { autoFitKey: "p1:level1" });
    // Default view { scale: 1.6, ox: 60, oy: 60 }, exactly as before.
    expect(coords(wallLine(container))).toEqual({ x1: 60, y1: 60, x2: 380, y2: 220 });
  });

  it("keeps the default view for an empty design on a phone canvas", () => {
    mockSize = { w: 390, h: 700 };
    renderCanvas(createEmptyDesign(), { autoFitKey: "p1:level1" });
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toContain("Start your floor plan");
  });

  it("does not refit on edits or resizes, and refits when the key changes", () => {
    mockSize = { w: 390, h: 700 };
    let design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 240, y: 120 });
    renderCanvas(design, { autoFitKey: "p1:level1" });
    // Fit: scale = 342 / 240 = 1.425, ox = 24, oy = (700 - 171) / 2 = 264.5.
    expect(coords(wallLine(container)).x1).toBeCloseTo(24, 6);
    expect(coords(wallLine(container)).y1).toBeCloseTo(264.5, 6);

    // Resize (orientation change) must not refit in v1.
    mockSize = { w: 360, h: 640 };
    triggerResize();
    expect(coords(wallLine(container)).y1).toBeCloseTo(264.5, 6);

    // An edit (new design object, same identity) must not refit, even
    // though the content bounds grew far beyond the fitted view.
    design = addWall(design, { x: 2000, y: 0 }, { x: 2240, y: 120 });
    renderCanvas(design, { autoFitKey: "p1:level1" });
    expect(coords(wallLine(container, 0)).x1).toBeCloseTo(24, 6);
    expect(coords(wallLine(container, 0)).y1).toBeCloseTo(264.5, 6);

    // A switch (new identity) refits against the new bounds at the
    // current canvas size: scale = (360 - 48) / 2240, centered.
    renderCanvas(design, { autoFitKey: "p1:level2" });
    const scale = 312 / 2240;
    expect(coords(wallLine(container, 0)).x1).toBeCloseTo(24, 6);
    expect(coords(wallLine(container, 0)).y1).toBeCloseTo((640 - 120 * scale) / 2, 6);
    expect(coords(wallLine(container, 0)).x2).toBeCloseTo(24 + 240 * scale, 6);
  });

  it("wheel zoom after a below-floor fit does not snap up to the old floor", () => {
    mockSize = { w: 390, h: 700 };
    renderCanvas(largeDesign(), { autoFitKey: "p1:level1" });
    const fitted = coords(wallLine(container, 0));
    const fittedWidth = fitted.x2 - fitted.x1;
    const svg = container.querySelector("svg");
    const wheel = (deltaY) => {
      act(() => {
        svg.dispatchEvent(
          new window.WheelEvent("wheel", {
            bubbles: true,
            deltaY,
            clientX: 195,
            clientY: 350,
          }),
        );
      });
    };
    // Zooming out from the fitted scale: the floor IS the fitted scale,
    // so the width stays at the fit — it must NOT jump to the old floor's
    // 7680 * 0.35 = 2688 px wide.
    wheel(100);
    let after = coords(wallLine(container, 0));
    expect(after.x2 - after.x1).toBeCloseTo(fittedWidth, 4);
    // Zooming in steps smoothly from the fitted scale (no 0.35 snap).
    wheel(-100);
    after = coords(wallLine(container, 0));
    expect(after.x2 - after.x1).toBeCloseTo(fittedWidth * 1.12, 4);
    // And the user's view is not snapped back by a later re-render/edit.
    renderCanvas(largeDesign(), { autoFitKey: "p1:level1" });
    expect(coords(wallLine(container, 0)).x2).toBeCloseTo(after.x2, 4);
  });

  it("switching to an empty design restores the default view and the normal zoom floor (D-001)", () => {
    mockSize = { w: 390, h: 700 };
    renderCanvas(largeDesign(), { autoFitKey: "p1:level1" });
    // Fitted below MIN_SCALE (0.35): fitFloor is now ≈ 0.0445.
    expect(coords(wallLine(container, 0)).x1).toBeCloseTo(24, 6);

    // Switch the SAME mounted canvas to an empty design: no fit is
    // produced, so the previous fitted view and floor must not survive.
    renderCanvas(createEmptyDesign(), { autoFitKey: "p1:level2" });
    expect(container.textContent).toContain("Start your floor plan");

    // Content appearing under the same (already-applied) identity does
    // not refit — its position proves the view is the default again.
    const design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 240, y: 120 });
    renderCanvas(design, { autoFitKey: "p1:level2" });
    expect(coords(wallLine(container))).toEqual({ x1: 60, y1: 60, x2: 444, y2: 252 });

    // And the interactive floor is MIN_SCALE again, not the previous
    // design's ≈0.0445 floor: zooming out repeatedly clamps at 0.35.
    const svg = container.querySelector("svg");
    for (let i = 0; i < 30; i += 1) {
      act(() => {
        svg.dispatchEvent(
          new window.WheelEvent("wheel", {
            bubbles: true,
            deltaY: 100,
            clientX: 195,
            clientY: 350,
          }),
        );
      });
    }
    const after = coords(wallLine(container));
    expect(after.x2 - after.x1).toBeCloseTo(240 * 0.35, 4);
  });

  it("a fit cancelled before measuring cannot leak stale fit state across an identity change (D-001)", () => {
    mockSize = { w: 390, h: 700 };
    renderCanvas(largeDesign(), { autoFitKey: "p1:level1" });
    // Fitted below MIN_SCALE; fitFloor ≈ 0.0445 belongs to this identity.
    expect(coords(wallLine(container, 0)).x1).toBeCloseTo(24, 6);

    // The canvas becomes unmeasured, a new identity opens, and the user
    // interacts before it is measured — cancelling that identity's fit.
    mockSize = { w: 0, h: 0 };
    triggerResize();
    const cancelled = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 240, y: 120 });
    renderCanvas(cancelled, { autoFitKey: "p1:level2" });
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

    // Another identity change, to an empty design, still unmeasured;
    // only now is the canvas measured. No fit is produced for it, so it
    // must open at the default view with the normal floor — the first
    // design's fitted view/floor must not leak through the cancelled one.
    renderCanvas(createEmptyDesign(), { autoFitKey: "p1:level3" });
    mockSize = { w: 390, h: 700 };
    triggerResize();
    const design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 240, y: 120 });
    renderCanvas(design, { autoFitKey: "p1:level3" });
    expect(coords(wallLine(container))).toEqual({ x1: 60, y1: 60, x2: 444, y2: 252 });
    const svg2 = container.querySelector("svg");
    for (let i = 0; i < 30; i += 1) {
      act(() => {
        svg2.dispatchEvent(
          new window.WheelEvent("wheel", {
            bubbles: true,
            deltaY: 100,
            clientX: 195,
            clientY: 350,
          }),
        );
      });
    }
    const after = coords(wallLine(container));
    expect(after.x2 - after.x1).toBeCloseTo(240 * 0.35, 4);
  });

  it("a user interaction before the canvas is measured cancels the pending fit", () => {
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
    // The canvas is measured only now; the fit for this open is cancelled,
    // so the view stays at the desktop default.
    mockSize = { w: 390, h: 700 };
    triggerResize();
    expect(coords(wallLine(container))).toEqual({ x1: 60, y1: 60, x2: 444, y2: 252 });
  });
});
