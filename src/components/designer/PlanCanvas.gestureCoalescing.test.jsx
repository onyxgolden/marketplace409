// @vitest-environment jsdom

// D2 fix round, Gate 5: wheel zoom and the mouse pan drag used to call
// setView on EVERY input event, re-rendering the whole SVG per event —
// the same fall-behind-the-pointer failure pinch/touch-pan had before
// PR #675. Both now ride the gesture frame scheduler. These tests pin
// the contract (mirroring PlanCanvas.pinchRaf.test.jsx): (1) a burst of
// wheel steps / pan moves within one frame schedules exactly one frame
// and commits nothing until it fires; (2) the committed view is EXACTLY
// the old step-by-step result (math identity, not approximation) — proven
// against an independent replica of the original per-event math and
// against a run whose frames fire immediately (the old cadence);
// (3) release commits the exact final view even if no frame ever fires
// (onPointerUp flushes synchronously); (4) the wheel anchor is preserved
// — each step zooms around its cursor point.

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

// Default grid: 6" spacing, major line every 5 → majorPx = 30 * scale.
const scaleFromGrid = (svg) =>
  parseFloat(svg.querySelector("pattern#designer-grid").getAttribute("width")) / 30;

const gridTranslate = (svg) => {
  const t = svg.querySelector('rect[width="10000"]').getAttribute("transform");
  const m = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(t);
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
};

// ---- manual animation-frame clock (same shape as pinchRaf) ------------
let rafMode = "queued";
let rafQueue = new Map();
let rafSeq = 0;
let rafScheduled = 0;
const realRaf = window.requestAnimationFrame;
const realCancelRaf = window.cancelAnimationFrame;

function installRafMock() {
  rafQueue = new Map();
  rafSeq = 0;
  rafScheduled = 0;
  window.requestAnimationFrame = (cb) => {
    rafScheduled += 1;
    const id = ++rafSeq;
    if (rafMode === "immediate") {
      cb(0);
      return id;
    }
    rafQueue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    rafQueue.delete(id);
  };
}

function fireFrames() {
  const pending = [...rafQueue.values()];
  rafQueue.clear();
  act(() => {
    for (const cb of pending) cb(0);
  });
}

// ---- independent replicas of the ORIGINAL per-event math ---------------
const MIN_SCALE = 0.35;
const MAX_SCALE = 12;
const DEFAULT_VIEW = { scale: 1.6, ox: 60, oy: 60 };

const wheelStep = (v, deltaY, screen) => {
  const factor = deltaY < 0 ? 1.12 : 1 / 1.12;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
  const applied = scale / v.scale;
  return {
    scale,
    ox: screen.x - (screen.x - v.ox) * applied,
    oy: screen.y - (screen.y - v.oy) * applied,
  };
};

// Expected DOM readouts for a view: the pattern width is 30 * scale and
// the grid rect renders translate(view.o % majorPx) with JS % semantics.
const expectView = (svg, v) => {
  expect(scaleFromGrid(svg)).toBeCloseTo(v.scale, 4);
  const majorPx = 30 * v.scale;
  const t = gridTranslate(svg);
  expect(t.x).toBeCloseTo(v.ox % majorPx, 3);
  expect(t.y).toBeCloseTo(v.oy % majorPx, 3);
};

function wheel(svg, deltaY, x, y) {
  act(() => {
    svg.dispatchEvent(
      new window.WheelEvent("wheel", { bubbles: true, deltaY, clientX: x, clientY: y }),
    );
  });
}

function mouse(target, type, x, y, button = 0) {
  act(() => {
    target.dispatchEvent(
      new window.PointerEvent(type, {
        bubbles: true,
        button,
        pointerId: 1,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
      }),
    );
  });
}

describe("PlanCanvas gesture coalescing — wheel + mouse pan (D2 Gate 5)", () => {
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
        <PlanCanvas design={createEmptyDesign()} tool={tool} selection={null} dispatch={dispatch} />,
      );
    });
    svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  };

  beforeEach(() => {
    rafMode = "queued";
    installRafMock();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.requestAnimationFrame = realRaf;
    window.cancelAnimationFrame = realCancelRaf;
  });

  it("a burst of wheel steps within one frame schedules one frame, commits nothing early, then lands on the step-by-step view", () => {
    renderCanvas("select");
    const anchor = { x: 195, y: 422 };
    const steps = [-100, -100, 100, -100]; // in, in, out, in
    for (const d of steps) wheel(svg, d, anchor.x, anchor.y);
    expect(rafScheduled).toBe(1);
    expect(rafQueue.size).toBe(1);
    // Nothing committed yet — the DOM still shows the pre-gesture view.
    expectView(svg, DEFAULT_VIEW);
    fireFrames();
    let expected = { ...DEFAULT_VIEW };
    for (const d of steps) expected = wheelStep(expected, d, anchor);
    expectView(svg, expected);
    // No further frame was scheduled by the commit itself.
    expect(rafScheduled).toBe(1);
  });

  it("the same wheel burst with frames firing immediately (the old per-event cadence) lands on the identical view", () => {
    rafMode = "immediate";
    renderCanvas("select");
    const anchor = { x: 195, y: 422 };
    const steps = [-100, -100, 100, -100];
    for (const d of steps) wheel(svg, d, anchor.x, anchor.y);
    expect(rafScheduled).toBe(steps.length);
    let expected = { ...DEFAULT_VIEW };
    for (const d of steps) expected = wheelStep(expected, d, anchor);
    expectView(svg, expected);
  });

  it("a single wheel step zooms around the cursor point, not the canvas origin", () => {
    renderCanvas("select");
    wheel(svg, -100, 100, 100);
    fireFrames();
    // scale 1.6 * 1.12 = 1.792 around (100, 100):
    // ox = oy = 100 - (100 - 60) * 1.12 = 55.2.
    expectView(svg, { scale: 1.792, ox: 55.2, oy: 55.2 });
  });

  it("a burst of mouse pan moves within one frame schedules one frame, commits nothing early, then lands on the dragged view", () => {
    renderCanvas("pan");
    mouse(svg, "pointerdown", 100, 100);
    const moves = [
      [120, 110],
      [150, 130],
      [180, 140],
    ];
    for (const [x, y] of moves) mouse(svg, "pointermove", x, y);
    expect(rafScheduled).toBe(1);
    expect(rafQueue.size).toBe(1);
    expectView(svg, DEFAULT_VIEW);
    fireFrames();
    // Pan offsets are absolute from the drag origin: ox = 60 + (180-100),
    // oy = 60 + (140-100); scale unchanged.
    expectView(svg, { scale: 1.6, ox: 140, oy: 100 });
    mouse(svg, "pointerup", 180, 140);
    expect(rafScheduled).toBe(1);
    expectView(svg, { scale: 1.6, ox: 140, oy: 100 });
  });

  it("releasing the mouse pan before any frame fires commits the exact final view synchronously", () => {
    renderCanvas("pan");
    mouse(svg, "pointerdown", 100, 100);
    mouse(svg, "pointermove", 150, 130);
    mouse(svg, "pointermove", 180, 140);
    // No frame fired yet — but the pointerup flush is synchronous.
    expectView(svg, DEFAULT_VIEW);
    mouse(svg, "pointerup", 180, 140);
    expectView(svg, { scale: 1.6, ox: 140, oy: 100 });
  });
});
