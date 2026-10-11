// @vitest-environment jsdom

// Two-finger touch gestures on the plan canvas: pinch in/out zooms around
// the fingers' midpoint, moving both fingers together pans, and the second
// finger landing cancels any in-progress single-finger drag (so a half-drawn
// wall never commits). Gestures never dispatch document changes.

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

// Default grid: 6" spacing, major line every 5 → majorPx = 30 * scale.
const scaleFromGrid = (svg) =>
  parseFloat(svg.querySelector("pattern#designer-grid").getAttribute("width")) / 30;

const gridTranslate = (svg) => {
  const t = svg.querySelector('rect[width="10000"]').getAttribute("transform");
  const m = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(t);
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
};

// clientX/Y map 1:1 to svg coords in jsdom (getBoundingClientRect is zeros).
function touch(target, type, pointerId, x, y) {
  act(() => {
    target.dispatchEvent(
      new window.PointerEvent(type, {
        bubbles: true,
        button: 0,
        pointerId,
        pointerType: "touch",
        clientX: x,
        clientY: y,
      })
    );
  });
}

describe("PlanCanvas two-finger touch gestures", () => {
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

  it("pinch-out (fingers apart) zooms in", () => {
    renderCanvas("select");
    expect(scaleFromGrid(svg)).toBeCloseTo(1.6, 5);
    touch(svg, "pointerdown", 1, 140, 60);
    touch(svg, "pointerdown", 2, 300, 60);
    touch(svg, "pointermove", 1, 60, 60);
    touch(svg, "pointermove", 2, 380, 60);
    touch(svg, "pointerup", 1, 60, 60);
    touch(svg, "pointerup", 2, 380, 60);
    // 160px → 320px apart = 2x zoom
    expect(scaleFromGrid(svg)).toBeCloseTo(3.2, 4);
  });

  it("pinch-in (fingers together) zooms out", () => {
    renderCanvas("select");
    touch(svg, "pointerdown", 1, 60, 60);
    touch(svg, "pointerdown", 2, 380, 60);
    touch(svg, "pointermove", 1, 140, 60);
    touch(svg, "pointermove", 2, 300, 60);
    touch(svg, "pointerup", 1, 140, 60);
    touch(svg, "pointerup", 2, 300, 60);
    // 320px → 160px apart = 0.5x zoom
    expect(scaleFromGrid(svg)).toBeCloseTo(0.8, 4);
  });

  it("moving both fingers together pans without zooming", () => {
    renderCanvas("select");
    const before = gridTranslate(svg);
    expect(before.x).toBeCloseTo(12, 5); // 60 % 48
    touch(svg, "pointerdown", 1, 100, 100);
    touch(svg, "pointerdown", 2, 200, 100);
    touch(svg, "pointermove", 1, 140, 100);
    touch(svg, "pointermove", 2, 240, 100);
    touch(svg, "pointerup", 1, 140, 100);
    touch(svg, "pointerup", 2, 240, 100);
    // distance restored (100px) → no zoom; midpoint drifted +40px → pan
    expect(scaleFromGrid(svg)).toBeCloseTo(1.6, 4);
    const after = gridTranslate(svg);
    expect(after.x).toBeCloseTo(4, 4); // (60 + 40) % 48
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it("second finger down cancels an in-progress wall draw", () => {
    renderCanvas("wall");
    touch(svg, "pointerdown", 1, 60, 60); // starts draw-wall drag
    touch(svg, "pointerdown", 2, 220, 60); // pinch takes over
    touch(svg, "pointermove", 1, 100, 100);
    touch(svg, "pointermove", 2, 260, 100);
    touch(svg, "pointerup", 1, 100, 100);
    touch(svg, "pointerup", 2, 260, 100);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("pinch gestures never dispatch document changes", () => {
    renderCanvas("select");
    touch(svg, "pointerdown", 1, 140, 60);
    const callsAfterFirstTap = dispatch.mock.calls.length;
    touch(svg, "pointerdown", 2, 300, 60);
    touch(svg, "pointermove", 1, 60, 60);
    touch(svg, "pointermove", 2, 380, 60);
    touch(svg, "pointerup", 1, 60, 60);
    touch(svg, "pointerup", 2, 380, 60);
    // The first tap may select/deselect (existing behavior); the pinch
    // itself must not touch the document.
    expect(dispatch.mock.calls.length).toBe(callsAfterFirstTap);
  });

  it("zoom clamps at MAX_SCALE instead of blowing up", () => {
    renderCanvas("select");
    touch(svg, "pointerdown", 1, 140, 60);
    touch(svg, "pointerdown", 2, 300, 60);
    touch(svg, "pointermove", 2, 16300, 60); // ~101x spread
    touch(svg, "pointerup", 1, 140, 60);
    touch(svg, "pointerup", 2, 16300, 60);
    const scale = scaleFromGrid(svg);
    expect(Number.isFinite(scale)).toBe(true);
    expect(scale).toBeCloseTo(12, 4); // MAX_SCALE
  });

  it("a third finger does not break the gesture", () => {
    renderCanvas("select");
    touch(svg, "pointerdown", 1, 140, 60);
    const callsAfterFirstTap = dispatch.mock.calls.length;
    touch(svg, "pointerdown", 2, 300, 60);
    touch(svg, "pointerdown", 3, 220, 400); // ignored
    touch(svg, "pointermove", 1, 60, 60);
    touch(svg, "pointermove", 2, 380, 60);
    touch(svg, "pointerup", 3, 220, 400);
    touch(svg, "pointerup", 1, 60, 60);
    touch(svg, "pointerup", 2, 380, 60);
    expect(scaleFromGrid(svg)).toBeCloseTo(3.2, 4);
    expect(dispatch.mock.calls.length).toBe(callsAfterFirstTap);
  });

  // --- ChatGPT NEEDS CHANGES regressions (PR #607 round 2) ---

  it("pointercancel aborts a wall draw instead of committing it", () => {
    renderCanvas("wall");
    touch(svg, "pointerdown", 1, 60, 60);
    touch(svg, "pointermove", 1, 300, 60);
    act(() => {
      svg.dispatchEvent(
        new window.PointerEvent("pointercancel", {
          bubbles: true,
          button: 0,
          pointerId: 1,
          pointerType: "touch",
          clientX: 300,
          clientY: 60,
        })
      );
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("pointercancel aborts for mouse pointers too", () => {
    renderCanvas("wall");
    act(() => {
      svg.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 60, clientY: 60 })
      );
      svg.dispatchEvent(
        new window.PointerEvent("pointermove", { bubbles: true, button: 0, clientX: 300, clientY: 60 })
      );
      svg.dispatchEvent(
        new window.PointerEvent("pointercancel", { bubbles: true, button: 0, clientX: 300, clientY: 60 })
      );
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("pinch baseline uses the first finger's current position, not its touchdown", () => {
    renderCanvas("select");
    touch(svg, "pointerdown", 1, 100, 100);
    touch(svg, "pointermove", 1, 140, 100); // single finger drifts; no pinch yet
    expect(scaleFromGrid(svg)).toBeCloseTo(1.6, 5);
    touch(svg, "pointerdown", 2, 200, 100); // baseline dist 60 from (140,100)
    touch(svg, "pointermove", 2, 240, 100); // dist 100 → factor 100/60
    touch(svg, "pointerup", 1, 140, 100);
    touch(svg, "pointerup", 2, 240, 100);
    // 1.6 * (100/60) = 2.6667; a stale touchdown baseline would give 2.24
    expect(scaleFromGrid(svg)).toBeCloseTo(2.6667, 3);
  });

  it("touch room tap commits on lift, not on touchdown", () => {
    renderCanvas("room");
    touch(svg, "pointerdown", 1, 200, 200);
    expect(dispatch).not.toHaveBeenCalled();
    touch(svg, "pointerup", 1, 200, 200);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].type).toBe("ADD_ROOM");
  });

  it("pinch discards a pending room tap", () => {
    renderCanvas("room");
    touch(svg, "pointerdown", 1, 200, 200);
    touch(svg, "pointerdown", 2, 300, 200); // pinch takes over
    touch(svg, "pointermove", 1, 180, 200);
    touch(svg, "pointerup", 1, 180, 200);
    touch(svg, "pointerup", 2, 300, 200);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("touch calibration tap commits on lift; pinch discards it", () => {
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    const design = { ...createEmptyDesign(), underlay: { x: 0, y: 0 } };
    act(() => {
      root.render(
        <PlanCanvas design={design} tool="calibrate" selection={null} dispatch={dispatch} />
      );
    });
    svg = container.querySelector("svg");
    // tap commits on lift
    touch(svg, "pointerdown", 1, 200, 200);
    expect(dispatch).not.toHaveBeenCalled();
    touch(svg, "pointerup", 1, 200, 200);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].type).toBe("ADD_CALIBRATION_POINT");
    // pinch discards the pending tap
    dispatch.mockClear();
    touch(svg, "pointerdown", 1, 200, 200);
    touch(svg, "pointerdown", 2, 300, 200);
    touch(svg, "pointerup", 1, 200, 200);
    touch(svg, "pointerup", 2, 300, 200);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("mouse room placement still commits on pointerdown", () => {
    renderCanvas("room");
    act(() => {
      svg.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 200, clientY: 200 })
      );
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].type).toBe("ADD_ROOM");
  });

  // --- ChatGPT round-2 NEEDS CHANGES regression: driving-pair tracking ---

  it("lifting a driving finger while a third is down rebases without a zoom jump", () => {
    renderCanvas("select");
    touch(svg, "pointerdown", 1, 100, 100);
    touch(svg, "pointerdown", 2, 300, 100); // pinch drives on [1,2]
    touch(svg, "pointerdown", 3, 200, 300); // swallowed
    touch(svg, "pointerup", 1, 100, 100); // rebase onto [2,3], no zoom step
    expect(scaleFromGrid(svg)).toBeCloseTo(1.6, 5);
    touch(svg, "pointermove", 2, 300, 200);
    touch(svg, "pointerup", 2, 300, 200);
    touch(svg, "pointerup", 3, 200, 300);
    // rebased baseline dist sqrt(100^2+200^2)=223.61; new dist sqrt(100^2+100^2)=141.42
    // scale = 1.6 * (141.42/223.61) = 1.0119 — a stale baseline would jump
    expect(scaleFromGrid(svg)).toBeCloseTo(1.0119, 3);
  });

  it("lifting the non-driving third finger leaves the pinch undisturbed", () => {
    renderCanvas("select");
    touch(svg, "pointerdown", 1, 100, 100);
    touch(svg, "pointerdown", 2, 300, 100);
    touch(svg, "pointerdown", 3, 200, 300);
    touch(svg, "pointerup", 3, 200, 300); // [1,2] still driving
    touch(svg, "pointermove", 1, 50, 100); // dist 200 → 250 = 1.25x
    touch(svg, "pointerup", 1, 50, 100);
    touch(svg, "pointerup", 2, 300, 100);
    expect(scaleFromGrid(svg)).toBeCloseTo(2.0, 4);
  });

  it("pinch ends cleanly when a driving finger lifts with none to rebase onto", () => {
    renderCanvas("select");
    touch(svg, "pointerdown", 1, 100, 100);
    touch(svg, "pointerdown", 2, 300, 100);
    touch(svg, "pointerup", 1, 100, 100); // one finger left → pinch over
    touch(svg, "pointermove", 2, 350, 100); // must not zoom or jump
    touch(svg, "pointerup", 2, 350, 100);
    expect(scaleFromGrid(svg)).toBeCloseTo(1.6, 5);
  });
});
