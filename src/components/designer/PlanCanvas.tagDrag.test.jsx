// @vitest-environment jsdom

// Phone-overview tag drag (separate slice after the FCCU freeze D2 fix
// round 3 verdict, which ruled the tag-drag gap preexisting and NOT a D2
// merge prerequisite): a drag starting on a phone-overview tag must pan.
// The tag's pointerdown is swallowed for tap-select, so without this the
// commonest drag origin on a phone — tags cover the fitted plot — never
// pans at all for mouse, and touch pans lose the down→threshold distance
// (60x40 came out 52.5x35: the drag anchored at the arming move instead
// of the down point). These tests pin the contract:
// (1) touch drags pan the FULL delta from the down point;
// (2) explicit pan-intent mouse drags (Space, middle button, Pan tool)
//     pan from a tag; a plain left-button press stays tap-select;
// (3) a tap still selects and moves nothing; a sub-threshold move pans
//     nothing; (4) one pointer arms exactly once across a rapid burst;
// (5) a wheel before the first pan move rebases on the down point (no
//     invented delta); (6) a pinch takes over a tag-armed pan and the
//     surviving finger cannot silently re-arm from the stale origin.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PlanCanvas from "./PlanCanvas";
import { addWall, createEmptyDesign, placeSymbol } from "@/domains/roomDesigner/designerDocument";

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

// ---- manual animation-frame clock (same shape as gestureCoalescing) ----
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

// ---- independent replicas of the gesture math --------------------------
const MIN_SCALE = 0.35;
const MAX_SCALE = 12;
// The fitted phone scale is far below MIN_SCALE, so the wheel/pinch floor
// is the fitted scale itself (see onWheel: floor drops to the fitted
// scale while a below-MIN_SCALE open-time fit is in effect).
const FIT_SCALE = 342 / 7680;

const wheelStep = (v, deltaY, screen, floor = FIT_SCALE) => {
  const factor = deltaY < 0 ? 1.12 : 1 / 1.12;
  const scale = Math.min(MAX_SCALE, Math.max(floor, v.scale * factor));
  const applied = scale / v.scale;
  return {
    scale,
    ox: screen.x - (screen.x - v.ox) * applied,
    oy: screen.y - (screen.y - v.oy) * applied,
  };
};

function wheel(svg, deltaY, x, y) {
  act(() => {
    svg.dispatchEvent(
      new window.WheelEvent("wheel", { bubbles: true, deltaY, clientX: x, clientY: y }),
    );
  });
}

function pointer(target, type, pointerId, pointerType, x, y, opts = {}) {
  act(() => {
    target.dispatchEvent(
      new window.PointerEvent(type, {
        bubbles: true,
        button: opts.button ?? 0,
        buttons: opts.buttons,
        pointerId,
        pointerType,
        clientX: x,
        clientY: y,
      }),
    );
  });
}

const mouse = (target, type, x, y, opts = {}) =>
  pointer(target, type, 1, "mouse", x, y, opts);
const touch = (target, type, pointerId, x, y, opts = {}) =>
  pointer(target, type, pointerId, "touch", x, y, opts);

function keyDown(key) {
  act(() => {
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function keyUp(key) {
  act(() => {
    window.dispatchEvent(new window.KeyboardEvent("keyup", { key, bubbles: true }));
  });
}

describe("PlanCanvas phone-overview tag drag", () => {
  let container;
  let root;
  let dispatch;
  let svg;

  // 7680 x 5280 in of content: two horizontal walls at the extremes
  // (same shape as the open-fit suite).
  function largeDesign() {
    let design = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 7680, y: 0 });
    design = addWall(design, { x: 0, y: 5280 }, { x: 7680, y: 5280 });
    design = placeSymbol(design, "processEquipment", "column", 3300, 2820, {
      layer: "equipment",
      tag: "T-101",
    });
    return design;
  }

  // Renders the large design on a 390x700 phone pane and lets the
  // open-time fit land: fitted scale = 342/7680 = 0.0445, far below the
  // 0.09 tag gate, so the phone-overview tag renders.
  const renderFittedCanvas = (tool = "select", design = largeDesign()) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => {
      root.render(
        <PlanCanvas design={design} tool={tool} selection={null} dispatch={dispatch} autoFitKey="p1:level1" />,
      );
    });
    svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    measureCanvas(390, 700);
    expect(scaleFromGrid(svg)).toBeCloseTo(342 / 7680, 4);
  };

  // Give the canvas a measured size (jsdom reports clientWidth 0).
  function measureCanvas(w = 800, h = 600) {
    const wrap = container.firstChild;
    Object.defineProperty(wrap, "clientWidth", { value: w, configurable: true });
    Object.defineProperty(wrap, "clientHeight", { value: h, configurable: true });
    act(() => {
      roCallback();
    });
  }

  // The top wall's left endpoint in screen px: x1 = view.ox, y1 = view.oy.
  const wallOrigin = () => {
    const wall = [...svg.querySelectorAll("line")].find(
      (l) => l.getAttribute("stroke") === "#e5e7eb",
    );
    return {
      x: Number(wall.getAttribute("x1")),
      y: Number(wall.getAttribute("y1")),
    };
  };

  const view = () => ({
    scale: scaleFromGrid(svg),
    ...wallOrigin(),
  });

  const tagPoint = () => {
    const tag = container.querySelector('[data-label-kind="equipment-tag"]');
    expect(tag).not.toBeNull();
    return {
      el: tag,
      x: Number(tag.getAttribute("x")),
      y: Number(tag.getAttribute("y")),
    };
  };

  beforeEach(() => {
    rafMode = "queued";
    installRafMock();
    window.__FCCU_GESTURE_TRACE = true;
    window.__fccuGestureTrace = [];
  });

  afterEach(() => {
    window.__FCCU_GESTURE_TRACE = false;
    window.__fccuGestureTrace = [];
    act(() => {
      root.unmount();
    });
    container.remove();
    window.requestAnimationFrame = realRaf;
    window.cancelAnimationFrame = realCancelRaf;
  });

  it("touch drag from a tag pans the FULL delta from the down point (leg H)", () => {
    const design = largeDesign();
    renderFittedCanvas("select", design);
    const { el: tag, x: tagX, y: tagY } = tagPoint();
    const before = view();
    // Down on the tag, then step to +60/+40 in three moves.
    touch(tag, "pointerdown", 1, tagX, tagY);
    touch(tag, "pointermove", 1, tagX + 20, tagY + 10); // arms the pan (>6px)
    touch(svg, "pointermove", 1, tagX + 40, tagY + 30);
    touch(svg, "pointermove", 1, tagX + 60, tagY + 40);
    touch(svg, "pointerup", 1, tagX + 60, tagY + 40);
    const after = view();
    // Full delta: 60x40, not the old 52.5x35 (down→threshold lost).
    expect(after.x - before.x).toBeCloseTo(60, 3);
    expect(after.y - before.y).toBeCloseTo(40, 3);
    expect(after.scale).toBeCloseTo(before.scale, 5); // pan never zooms
    expect(dispatch).toHaveBeenCalledWith({
      type: "SELECT",
      selection: { kind: "symbol", id: design.symbols[0].id },
    });
  });

  it("Space+drag from a tag pans the full delta (mouse, leg E)", () => {
    renderFittedCanvas();
    const { el: tag, x: tagX, y: tagY } = tagPoint();
    const before = view();
    keyDown(" ");
    mouse(tag, "pointerdown", tagX, tagY, { button: 0 });
    mouse(svg, "pointermove", tagX + 30, tagY + 20);
    mouse(svg, "pointermove", tagX + 60, tagY + 40);
    mouse(svg, "pointerup", tagX + 60, tagY + 40, { button: 0 });
    keyUp(" ");
    const after = view();
    expect(after.x - before.x).toBeCloseTo(60, 3);
    expect(after.y - before.y).toBeCloseTo(40, 3);
    expect(after.scale).toBeCloseTo(before.scale, 5);
  });

  it("middle-button drag from a tag pans the full delta (mouse)", () => {
    renderFittedCanvas();
    const { el: tag, x: tagX, y: tagY } = tagPoint();
    const before = view();
    mouse(tag, "pointerdown", tagX, tagY, { button: 1 });
    mouse(svg, "pointermove", tagX + 60, tagY + 40);
    mouse(svg, "pointerup", tagX + 60, tagY + 40, { button: 1 });
    const after = view();
    expect(after.x - before.x).toBeCloseTo(60, 3);
    expect(after.y - before.y).toBeCloseTo(40, 3);
    expect(after.scale).toBeCloseTo(before.scale, 5);
  });

  it("Pan-tool left drag from a tag pans the full delta (mouse)", () => {
    renderFittedCanvas("pan");
    const { el: tag, x: tagX, y: tagY } = tagPoint();
    const before = view();
    mouse(tag, "pointerdown", tagX, tagY, { button: 0 });
    mouse(svg, "pointermove", tagX + 60, tagY + 40);
    mouse(svg, "pointerup", tagX + 60, tagY + 40, { button: 0 });
    const after = view();
    expect(after.x - before.x).toBeCloseTo(60, 3);
    expect(after.y - before.y).toBeCloseTo(40, 3);
    expect(after.scale).toBeCloseTo(before.scale, 5);
  });

  it("a tag tap still selects and moves nothing (touch and mouse)", () => {
    const design = largeDesign();
    renderFittedCanvas("select", design);
    const { el: tag, x: tagX, y: tagY } = tagPoint();
    const before = view();
    touch(tag, "pointerdown", 1, tagX, tagY);
    touch(tag, "pointerup", 1, tagX, tagY);
    mouse(tag, "pointerdown", tagX, tagY, { button: 0 });
    mouse(tag, "pointerup", tagX, tagY, { button: 0 });
    const after = view();
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
    expect(after.scale).toBeCloseTo(before.scale, 5);
    expect(dispatch).toHaveBeenCalledWith({
      type: "SELECT",
      selection: { kind: "symbol", id: design.symbols[0].id },
    });
  });

  it("a sub-threshold touch move from a tag does not pan", () => {
    renderFittedCanvas();
    const { el: tag, x: tagX, y: tagY } = tagPoint();
    const before = view();
    touch(tag, "pointerdown", 1, tagX, tagY);
    touch(tag, "pointermove", 1, tagX + 3, tagY + 2); // <6px: still a tap
    touch(tag, "pointerup", 1, tagX + 3, tagY + 2);
    const after = view();
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it("a plain mouse left drag from a tag (select tool, no Space) does not pan", () => {
    renderFittedCanvas();
    const { el: tag, x: tagX, y: tagY } = tagPoint();
    const before = view();
    mouse(tag, "pointerdown", tagX, tagY, { button: 0 });
    mouse(svg, "pointermove", tagX + 60, tagY + 40);
    mouse(svg, "pointerup", tagX + 60, tagY + 40, { button: 0 });
    const after = view();
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
    expect(after.scale).toBeCloseTo(before.scale, 5);
    expect(dispatch).toHaveBeenCalledWith({
      type: "SELECT",
      selection: { kind: "symbol", id: expect.any(String) },
    });
  });

  it("rapid moves arm exactly once: a burst within one frame lands on the absolute view", () => {
    renderFittedCanvas();
    const { el: tag, x: tagX, y: tagY } = tagPoint();
    const before = view();
    touch(tag, "pointerdown", 1, tagX, tagY);
    touch(tag, "pointermove", 1, tagX + 10, tagY); // arms the pan
    touch(svg, "pointermove", 1, tagX + 20, tagY);
    touch(svg, "pointermove", 1, tagX + 30, tagY);
    // Nothing commits until a frame fires.
    expect(view().x).toBeCloseTo(before.x, 5);
    fireFrames();
    const after = view();
    expect(after.x - before.x).toBeCloseTo(30, 3);
    expect(after.y).toBeCloseTo(before.y, 5);
    // Exactly one pan-start in the trace: the burst armed once.
    const starts = window.__fccuGestureTrace.filter((e) => e.event === "pan-start");
    expect(starts.length).toBe(1);
    expect(starts[0].drag.start).toEqual({ x: tagX, y: tagY });
    expect(starts[0].tag).toBe(true);
    touch(svg, "pointerup", 1, tagX + 30, tagY);
  });

  it("wheel before the first pan move after tag-arming rebases on the down point", () => {
    renderFittedCanvas();
    const { el: tag, x: tagX, y: tagY } = tagPoint();
    const v0 = view();
    touch(tag, "pointerdown", 1, tagX, tagY);
    touch(tag, "pointermove", 1, tagX + 10, tagY); // arms the pan
    // Wheel at a DIFFERENT anchor than the drag pointer: if the rebase
    // used the wheel point, it would invent a (W - down) delta.
    const wheelAt = { x: tagX + 100, y: tagY + 100 };
    wheel(svg, -120, wheelAt.x, wheelAt.y); // zoom in 1.12x
    touch(svg, "pointermove", 1, tagX + 60, tagY + 40);
    touch(svg, "pointerup", 1, tagX + 60, tagY + 40);
    // Independent replica: arming move pans v0 by (10,0); the wheel zooms
    // that view around W; the pan move rebases the drag origin onto the
    // zoomed view at the DOWN point (the last pan point), so the final
    // offsets are the zoomed offsets plus the full (60,40) from down.
    const armPoint = { x: tagX + 10, y: tagY };
    const v1 = { scale: v0.scale, ox: v0.x + (armPoint.x - tagX), oy: v0.y + (armPoint.y - tagY) };
    const v2 = wheelStep(v1, -120, wheelAt);
    const expected = {
      scale: v2.scale,
      ox: v2.ox - (armPoint.x - tagX) + 60,
      oy: v2.oy - (armPoint.y - tagY) + 40,
    };
    const after = view();
    expect(after.scale).toBeCloseTo(expected.scale, 4);
    expect(after.x).toBeCloseTo(expected.ox, 3);
    expect(after.y).toBeCloseTo(expected.oy, 3);
  });

  it("a pinch takes over a tag-armed pan and the surviving finger cannot re-arm", () => {
    renderFittedCanvas();
    const { el: tag, x: tagX, y: tagY } = tagPoint();
    const v0 = view();
    touch(tag, "pointerdown", 1, tagX, tagY);
    touch(tag, "pointermove", 1, tagX + 20, tagY); // arms the pan
    touch(svg, "pointerdown", 2, tagX + 100, tagY); // second finger: pinch
    touch(svg, "pointermove", 1, tagX - 50, tagY);
    touch(svg, "pointermove", 2, tagX + 150, tagY);
    touch(svg, "pointerup", 2, tagX + 150, tagY); // pinch ends: flush commits
    // Baseline at pinch start: finger 1 at tagX+20 (the arming move),
    // finger 2 at tagX+100 → 80px apart; after the moves 200px apart,
    // so 200/80 = 2.5x zoom: the pinch ran, not the pan.
    expect(scaleFromGrid(svg)).toBeCloseTo(v0.scale * 2.5, 3);
    const afterPinch = view();
    // The surviving finger moves on: no pan — its tag origin was dropped
    // when the pinch took over, so it must lift and press again to pan.
    touch(svg, "pointermove", 1, tagX - 20, tagY);
    touch(svg, "pointermove", 1, tagX + 10, tagY);
    const after = view();
    expect(after.x).toBeCloseTo(afterPinch.x, 5);
    expect(after.y).toBeCloseTo(afterPinch.y, 5);
    expect(after.scale).toBeCloseTo(afterPinch.scale, 5);
    touch(svg, "pointerup", 1, tagX + 10, tagY);
  });
});
