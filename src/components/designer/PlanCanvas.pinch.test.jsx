// @vitest-environment jsdom

// Two-finger touch gestures on the plan canvas: pinch in/out zooms around
// the fingers' midpoint, moving both fingers together pans, and the second
// finger landing cancels any in-progress single-finger drag (so a half-drawn
// wall never commits). Gestures never dispatch document changes.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PlanCanvas, { autoPanViewForPoint } from "./PlanCanvas";
import { createEmptyDesign } from "@/domains/roomDesigner/designerDocument";

// PlanCanvas uses a ResizeObserver for its wrapper size; jsdom has none.
// Capture the observe callback so tests can drive a measured canvas size.
let roCallback = null;
if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    constructor(cb) {
      roCallback = cb;
    }
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

  it("touch drag from empty background pans the canvas", () => {
    renderCanvas("select");
    const init = gridTranslate(svg);
    expect(init.x).toBeCloseTo(12, 4); // 60 % majorPx
    expect(init.y).toBeCloseTo(12, 4);
    touch(svg, "pointerdown", 1, 100, 100);
    touch(svg, "pointermove", 1, 150, 130);
    touch(svg, "pointerup", 1, 150, 130);
    const t = gridTranslate(svg);
    expect(t.x).toBeCloseTo(14, 4); // (60 + 50) % 48
    expect(t.y).toBeCloseTo(42, 4); // (60 + 30) % 48
    expect(scaleFromGrid(svg)).toBeCloseTo(1.6, 5); // pan never zooms
  });

  it("touch tap on empty background still deselects without panning", () => {
    renderCanvas("select");
    touch(svg, "pointerdown", 1, 100, 100);
    touch(svg, "pointerup", 1, 100, 100);
    const still = gridTranslate(svg);
    expect(still.x).toBeCloseTo(12, 4);
    expect(still.y).toBeCloseTo(12, 4);
    expect(dispatch).toHaveBeenCalledWith({ type: "SELECT", selection: null });
  });

  it("mouse drag from empty background does not pan (desktop behavior unchanged)", () => {
    renderCanvas("select");
    act(() => {
      svg.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100 })
      );
      svg.dispatchEvent(
        new window.PointerEvent("pointermove", { bubbles: true, button: 0, clientX: 150, clientY: 130 })
      );
      svg.dispatchEvent(
        new window.PointerEvent("pointerup", { bubbles: true, button: 0, clientX: 150, clientY: 130 })
      );
    });
    const end = gridTranslate(svg);
    expect(end.x).toBeCloseTo(12, 4);
    expect(end.y).toBeCloseTo(12, 4);
  });

  // mouse events (pointerType defaults to "" — not touch)
  function mouse(target, type, x, y, pointerId = 1) {
    act(() => {
      target.dispatchEvent(
        new window.PointerEvent(type, {
          bubbles: true,
          button: 0,
          pointerId,
          clientX: x,
          clientY: y,
        })
      );
    });
  }

  // Give the canvas a measured size (jsdom reports clientWidth 0).
  function measureCanvas(w = 800, h = 600) {
    const wrap = container.firstChild;
    Object.defineProperty(wrap, "clientWidth", { value: w, configurable: true });
    Object.defineProperty(wrap, "clientHeight", { value: h, configurable: true });
    act(() => {
      roCallback();
    });
  }

  it("wall drawing auto-pans when the pointer leaves the viewport", () => {
    renderCanvas("wall");
    measureCanvas(800, 600);
    mouse(svg, "pointerdown", 400, 300);
    const before = gridTranslate(svg);
    mouse(svg, "pointermove", 900, 300); // 100px past the right edge
    const after = gridTranslate(svg);
    // ox re-anchors so the FINAL snapped endpoint renders at the 16px
    // margin: snapPoint grid-snaps (900-60)/1.6 = 525 → 528, so
    // ox' = 784 - 528*1.6 = -60.8 → translate -60.8 % 48 = -12.8.
    expect(after.x).toBeCloseTo(-12.8, 3);
    expect(after.y).toBeCloseTo(before.y, 5);
    // The final endpoint renders inside the viewport (rendered bounds).
    const x2 = parseFloat(svg.querySelector('line[stroke="#34d399"]').getAttribute("x2"));
    expect(x2).toBeGreaterThanOrEqual(16);
    expect(x2).toBeLessThanOrEqual(800 - 16);
    // The drag survives and commits the extended wall.
    mouse(svg, "pointerup", 900, 300);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_WALL" })
    );
  });

  it("mouse drawing survives pointerleave mid-drag when capture is held", () => {
    renderCanvas("wall");
    measureCanvas(800, 600);
    // Simulate a capturing browser: the leave guard must not tear down.
    const captured = new Set();
    svg.setPointerCapture = (id) => captured.add(id);
    svg.hasPointerCapture = (id) => captured.has(id);
    mouse(svg, "pointerdown", 400, 300);
    // React synthesizes onPointerLeave from native pointerout.
    act(() => {
      svg.dispatchEvent(new window.PointerEvent("pointerout", { bubbles: true, pointerId: 1 }));
    });
    mouse(svg, "pointermove", 500, 300);
    mouse(svg, "pointerup", 500, 300);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_WALL" })
    );
  });
});

describe("autoPanViewForPoint — auto-pan anchors the final snapped endpoint", () => {
  const size = { w: 800, h: 600 };
  const view = { ox: 60, oy: 60, scale: 1.6 };

  // Screen position of the endpoint after applying the re-anchored view.
  const rendered = (p, v, a) => ({
    x: a.ox + p.x * v.scale,
    y: a.oy + p.y * v.scale,
  });

  it("returns null when the endpoint already renders within bounds or the canvas is unmeasured", () => {
    expect(autoPanViewForPoint({ x: 100, y: 100 }, size, view)).toBeNull();
    expect(autoPanViewForPoint({ x: 1000, y: 100 }, { w: 0, h: 0 }, view)).toBeNull();
  });

  it("re-anchors an off-screen endpoint to the margin on every edge", () => {
    // plan point rendering at x=-30 (finger past the left edge)
    const left = { x: (-30 - 60) / 1.6, y: 150 };
    const a = autoPanViewForPoint(left, size, view);
    expect(a).not.toBeNull();
    const r = rendered(left, view, a);
    expect(r.x).toBeCloseTo(16, 9);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeCloseTo(300, 9); // untouched axis keeps tracking
    expect(a.oy).toBe(view.oy);

    const cases = [
      [{ x: (830 - 60) / 1.6, y: 150 }, 800 - 16, 300], // right
      [{ x: 212.5, y: (-25 - 60) / 1.6 }, 400, 16], // top
      [{ x: 212.5, y: (650 - 60) / 1.6 }, 400, 600 - 16], // bottom
      [{ x: (-10 - 60) / 1.6, y: (620 - 60) / 1.6 }, 16, 600 - 16], // corner
    ];
    for (const [p, ex, ey] of cases) {
      const anchored = autoPanViewForPoint(p, size, view);
      const rr = rendered(p, view, anchored);
      expect(rr.x).toBeCloseTo(ex, 9);
      expect(rr.y).toBeCloseTo(ey, 9);
    }
  });

  it("reproduces the 12x-zoom report: endpoint at x=806 is pulled inside", () => {
    // ChatGPT's round-2 repro: at 12x zoom the snapped endpoint rendered at
    // x=806 on an 800px canvas — 6px off-screen after a pre-snap anchor.
    const zoomed = { ox: 60, oy: 60, scale: 12 };
    const p = { x: (806 - 60) / 12, y: 100 }; // renders at x=806 pre-anchor
    const a = autoPanViewForPoint(p, size, zoomed);
    expect(a).not.toBeNull();
    const r = rendered(p, zoomed, a);
    expect(r.x).toBeCloseTo(800 - 16, 9); // margin — fully visible
    expect(r.x).toBeLessThanOrEqual(800);
  });
});
