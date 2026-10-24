// @vitest-environment jsdom

// Gesture view-commit coalescing: pinch steps and the touch pan drag used
// to call setView on EVERY pointermove, re-rendering the whole SVG per
// move until a phone fell behind the fingers on heavy scenes. They now
// compute into a pending view and commit at most once per animation
// frame, with a synchronous flush at gesture end. These tests pin the
// contract: (1) a burst of moves within one frame schedules exactly one
// frame and commits nothing until it fires; (2) the committed view is
// EXACTLY the old step-by-step result (math identity, not approximation)
// — proven against an independent replica of the original per-move math
// and against a run whose frames fire immediately (the old cadence);
// (3) release commits the exact final view even if no frame ever fires;
// (4) a mid-gesture pair rebase keeps stepping from the pending view,
// never from the stale committed one.

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

// ---- manual animation-frame clock -------------------------------------
// "queued": callbacks wait until fireFrames() runs them (a burst of moves
// inside one frame). "immediate": the callback runs synchronously when
// scheduled — the pre-fix cadence of one commit per move.
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

// ---- independent replica of the ORIGINAL per-move step math ------------
// (pre-fix applyPinchStep updater + the documented clamps/floor values).
const MIN_SCALE = 0.35;
const MAX_SCALE = 12;
const DEFAULT_VIEW = { scale: 1.6, ox: 60, oy: 60 };

const stepView = (v, prev, cur) => {
  const factor = cur.dist / prev.dist;
  const dx = cur.mid.x - prev.mid.x;
  const dy = cur.mid.y - prev.mid.y;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
  const applied = scale / v.scale;
  return {
    scale,
    ox: cur.mid.x - (cur.mid.x - (v.ox + dx)) * applied,
    oy: cur.mid.y - (cur.mid.y - (v.oy + dy)) * applied,
  };
};

const geom = (a, b) => ({
  dist: Math.hypot(b.x - a.x, b.y - a.y),
  mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
});

// Expected DOM readouts for a view: the pattern width is 30 * scale and
// the grid rect renders translate(view.o % majorPx) with JS % semantics.
const expectView = (svg, v) => {
  expect(scaleFromGrid(svg)).toBeCloseTo(v.scale, 4);
  const majorPx = 30 * v.scale;
  const t = gridTranslate(svg);
  expect(t.x).toBeCloseTo(v.ox % majorPx, 3);
  expect(t.y).toBeCloseTo(v.oy % majorPx, 3);
};

// A four-move pinch burst with zoom AND midpoint drift on both axes.
const BURST = [
  // [pointerId, x, y] applied in order after both fingers are down.
  [1, 120, 60],
  [2, 330, 60],
  [1, 90, 90],
  [2, 360, 90],
];
const BURST_START = { 1: { x: 140, y: 60 }, 2: { x: 300, y: 60 } };

function runBurst(svg) {
  touch(svg, "pointerdown", 1, BURST_START[1].x, BURST_START[1].y);
  touch(svg, "pointerdown", 2, BURST_START[2].x, BURST_START[2].y);
  for (const [id, x, y] of BURST) touch(svg, "pointermove", id, x, y);
}

// The view the burst produces under the original step-by-step commits.
function burstExpected() {
  const pos = { ...BURST_START };
  let prev = geom(pos[1], pos[2]);
  let v = { ...DEFAULT_VIEW };
  for (const [id, x, y] of BURST) {
    pos[id] = { x, y };
    const cur = geom(pos[1], pos[2]);
    v = stepView(v, prev, cur);
    prev = cur;
  }
  return v;
}

describe("PlanCanvas gesture view-commit coalescing (rAF)", () => {
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

  it("a burst of pinch moves within one frame schedules one frame, commits nothing early, then lands on the step-by-step view", () => {
    renderCanvas("select");
    runBurst(svg);
    // Four moves, one frame: the scheduler coalesced the whole burst.
    expect(rafScheduled).toBe(1);
    expect(rafQueue.size).toBe(1);
    // Nothing committed yet — the DOM still shows the pre-gesture view
    // even though four steps were computed.
    expectView(svg, DEFAULT_VIEW);
    fireFrames();
    expectView(svg, burstExpected());
    // Release after the commit: no second frame, no further change.
    touch(svg, "pointerup", 1, 90, 90);
    touch(svg, "pointerup", 2, 360, 90);
    expect(rafScheduled).toBe(1);
    expectView(svg, burstExpected());
  });

  it("the same burst with frames firing immediately (the old per-move cadence) lands on the identical view", () => {
    rafMode = "immediate";
    renderCanvas("select");
    runBurst(svg);
    // Old cadence: one scheduled frame per move, each committing at once.
    expect(rafScheduled).toBe(BURST.length);
    expectView(svg, burstExpected());
    touch(svg, "pointerup", 1, 90, 90);
    touch(svg, "pointerup", 2, 360, 90);
    expectView(svg, burstExpected());
  });

  it("pinch release commits the exact final view even if the frame never fires", () => {
    renderCanvas("select");
    runBurst(svg);
    expectView(svg, DEFAULT_VIEW); // still uncommitted mid-gesture
    touch(svg, "pointerup", 1, 90, 90); // pinch ends here — synchronous flush
    touch(svg, "pointerup", 2, 360, 90);
    expect(rafQueue.size).toBe(0); // the pending frame was cancelled, not left trailing
    expectView(svg, burstExpected());
  });

  it("one-finger touch pan coalesces within a frame, re-arms after it, and commits exactly on release", () => {
    renderCanvas("select");
    const init = gridTranslate(svg);
    expect(init.x).toBeCloseTo(12, 4); // 60 % 48
    touch(svg, "pointerdown", 1, 100, 100); // empty background → pan drag
    touch(svg, "pointermove", 1, 130, 120);
    touch(svg, "pointermove", 1, 160, 150);
    expect(rafScheduled).toBe(1); // two moves, one frame
    expectView(svg, DEFAULT_VIEW); // nothing committed yet
    fireFrames(); // intermediate commit: start-anchored from (100,100)
    expectView(svg, { scale: 1.6, ox: 60 + 60, oy: 60 + 50 });
    touch(svg, "pointermove", 1, 200, 190);
    expect(rafScheduled).toBe(2); // scheduler re-armed for the next frame
    touch(svg, "pointerup", 1, 200, 190); // release flushes synchronously
    expect(rafQueue.size).toBe(0);
    expectView(svg, { scale: 1.6, ox: 60 + 100, oy: 60 + 90 });
  });

  it("a mid-gesture pair rebase keeps stepping from the pending view, not the stale committed one", () => {
    renderCanvas("select");
    touch(svg, "pointerdown", 1, 100, 100);
    touch(svg, "pointerdown", 2, 300, 100); // pinch drives on [1,2]: dist 200, mid (200,100)
    touch(svg, "pointerdown", 3, 200, 300); // swallowed third finger
    touch(svg, "pointermove", 1, 60, 100); // dist 240 → pending scale 1.6 * 1.2
    expectView(svg, DEFAULT_VIEW); // the step is pending, NOT committed
    touch(svg, "pointerup", 1, 60, 100); // rebase onto [2,3] — gesture alive, no flush
    expectView(svg, DEFAULT_VIEW);
    touch(svg, "pointermove", 2, 300, 200); // first step on the rebased pair
    touch(svg, "pointerup", 2, 300, 200); // pinch ends — synchronous flush
    touch(svg, "pointerup", 3, 200, 300);
    // Replica: step 1 from the default view (pair [1,2] geometry), then —
    // with NO step at the rebase — step 2 from step 1's PENDING result
    // against the rebased pair's geometry.
    const afterStep1 = stepView(
      { ...DEFAULT_VIEW },
      geom({ x: 100, y: 100 }, { x: 300, y: 100 }),
      geom({ x: 60, y: 100 }, { x: 300, y: 100 })
    );
    const expected = stepView(
      afterStep1,
      geom({ x: 300, y: 100 }, { x: 200, y: 300 }),
      geom({ x: 300, y: 200 }, { x: 200, y: 300 })
    );
    // Sanity: the stale-committed base would give scale ≈ 1.0119; the
    // pending base gives ≈ 1.2143 — far outside the assertion tolerance.
    expect(expected.scale).toBeCloseTo(1.2143, 3);
    expectView(svg, expected);
  });
});
