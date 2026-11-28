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
// FR1 (ChatGPT NEEDS CHANGES at 4d5b182, drop 8074857eb) adds:
// (7) explicit pan from a tag must NOT change selection (Space/middle/
//     Pan drag is navigation, not selection) and must not mutate the
//     design — pinned with a pre-existing different selection;
// (8) touch drag from a tag KEEPS the tag's symbol selected — the
//     preexisting canvas policy (a touch pan from a hit selects it),
//     retained deliberately and documented in PlanCanvas, not an
//     oversight; (9) pointercancel and lostpointercapture mid tag-drag
//     tear the drag down and the next gesture starts fresh — including
//     the same-batch case the C2 live check caught: the browser delivers
//     lostpointercapture lazily WITH the next move, so the move handler
//     still closes over the pre-loss drag state and pans one step on
//     the stale drag (+8,+6 measured live) unless the synchronous
//     lostCaptureRef stops it.
// FR2 (ChatGPT NEEDS CHANGES at 340069e, drop 468953784) adds:
// (10) a touch tag-drag whose capture is lost, then an outside release
//     (no pointerup ever delivered) and a next fresh touch, pans fresh
//     with no phantom pinch — the lost id is retired synchronously, so
//     the new touch does not pair with a stale finger;
// (11) losing a driving pinch finger ends the pinch and the survivor
//     cannot drive a phantom pinch from the stale point; a move from
//     the dead finger after the loss moves nothing (capture-phase guard);
// (12) three-finger: losing a non-driving third finger keeps the
//     driving pair intact, and losing a driving finger rebases the
//     pinch onto the surviving pair with no zoom step (exact scale
//     factor pinned);
// (13) a same-batch capture loss followed by pointerup cannot commit
//     a stale deferred tap (room tool) or a stale draw (wall tool) —
//     the up handler bails for a dead pointer before any commit path.

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

  // Two equipment symbols, far enough apart (~90px on screen at fit)
  // that collision filtering keeps both overview tags.
  function twoSymbolDesign() {
    let design = largeDesign();
    design = placeSymbol(design, "processEquipment", "horizontal-drum", 5000, 4000, {
      layer: "equipment",
      tag: "D-101",
    });
    return design;
  }

  // Renders the large design on a 390x700 phone pane and lets the
  // open-time fit land: fitted scale = 342/7680 = 0.0445, far below the
  // 0.09 tag gate, so the phone-overview tag renders.
  const renderFittedCanvas = (tool = "select", design = largeDesign(), selection = null) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => {
      root.render(
        <PlanCanvas design={design} tool={tool} selection={selection} dispatch={dispatch} autoFitKey="p1:level1" />,
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

  // The tag for a specific symbol, by its displayed text (tags sort
  // selected-first, so the first tag in the DOM is not always T-101).
  const tagPointByText = (text) => {
    const tag = [...container.querySelectorAll('[data-label-kind="equipment-tag"]')].find(
      (t) => t.textContent === text,
    );
    expect(tag).not.toBeUndefined();
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
    // FR1 P1: explicit pan is navigation, not selection — nothing
    // dispatched at all (no SELECT, no design mutation).
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("Space+drag from a tag does not change an existing different selection (FR1 P1)", () => {
    const design = twoSymbolDesign();
    const other = design.symbols.find((s) => s.tag === "D-101");
    renderFittedCanvas("select", design, { kind: "symbol", id: other.id });
    const { el: tag, x: tagX, y: tagY } = tagPointByText("T-101");
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
    // The D-101 selection survives untouched: no SELECT, no mutation.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("touch drag from a tag keeps the tag's symbol selected (documented FR1 policy)", () => {
    const design = twoSymbolDesign();
    const other = design.symbols.find((s) => s.tag === "D-101");
    const target = design.symbols.find((s) => s.tag === "T-101");
    renderFittedCanvas("select", design, { kind: "symbol", id: other.id });
    const { el: tag, x: tagX, y: tagY } = tagPointByText("T-101");
    const before = view();
    touch(tag, "pointerdown", 1, tagX, tagY);
    touch(tag, "pointermove", 1, tagX + 20, tagY + 10); // arms the pan (>6px)
    touch(svg, "pointermove", 1, tagX + 60, tagY + 40);
    touch(svg, "pointerup", 1, tagX + 60, tagY + 40);
    const after = view();
    expect(after.x - before.x).toBeCloseTo(60, 3);
    expect(after.y - before.y).toBeCloseTo(40, 3);
    // Touch-down SELECT is the preexisting canvas policy (a touch pan
    // from a hit selects it — see handlePointerDownAction): the drag
    // replaces the prior D-101 selection with T-101, and nothing else
    // is dispatched.
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "SELECT",
      selection: { kind: "symbol", id: target.id },
    });
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
    // FR1 P1: explicit pan is navigation, not selection.
    expect(dispatch).not.toHaveBeenCalled();
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
    // FR1 P1: explicit pan is navigation, not selection.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("pointercancel mid tag-drag tears the drag down and the next gesture starts fresh (FR1 P1)", () => {
    renderFittedCanvas();
    const { el: tag, x: tagX, y: tagY } = tagPoint();
    const before = view();
    keyDown(" ");
    mouse(tag, "pointerdown", tagX, tagY, { button: 0 });
    mouse(svg, "pointermove", tagX + 30, tagY + 20); // arms the pan
    fireFrames();
    const mid = view();
    expect(mid.x - before.x).toBeCloseTo(30, 3);
    expect(mid.y - before.y).toBeCloseTo(20, 3);
    pointer(svg, "pointercancel", 1, "mouse", tagX + 30, tagY + 20);
    // Moves after the cancel must not pan: the drag is gone.
    mouse(svg, "pointermove", tagX + 90, tagY + 60);
    fireFrames();
    const afterCancel = view();
    expect(afterCancel.x).toBeCloseTo(mid.x, 3);
    expect(afterCancel.y).toBeCloseTo(mid.y, 3);
    // The next gesture starts fresh from its own down point.
    mouse(tag, "pointerdown", tagX, tagY, { button: 0 });
    mouse(svg, "pointermove", tagX + 60, tagY + 40);
    mouse(svg, "pointerup", tagX + 60, tagY + 40, { button: 0 });
    keyUp(" ");
    const after = view();
    expect(after.x - mid.x).toBeCloseTo(60, 3);
    expect(after.y - mid.y).toBeCloseTo(40, 3);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("lostpointercapture mid tag-drag tears the drag down and the next gesture starts fresh (FR1 P1)", () => {
    renderFittedCanvas();
    const { el: tag, x: tagX, y: tagY } = tagPoint();
    const before = view();
    keyDown(" ");
    mouse(tag, "pointerdown", tagX, tagY, { button: 0 });
    mouse(svg, "pointermove", tagX + 30, tagY + 20); // arms the pan
    fireFrames();
    const mid = view();
    expect(mid.x - before.x).toBeCloseTo(30, 3);
    expect(mid.y - before.y).toBeCloseTo(20, 3);
    pointer(svg, "lostpointercapture", 1, "mouse", tagX + 30, tagY + 20);
    // Moves after the loss must not pan: the drag is gone.
    mouse(svg, "pointermove", tagX + 90, tagY + 60);
    fireFrames();
    const afterLoss = view();
    expect(afterLoss.x).toBeCloseTo(mid.x, 3);
    expect(afterLoss.y).toBeCloseTo(mid.y, 3);
    // The next gesture starts fresh from its own down point.
    mouse(tag, "pointerdown", tagX, tagY, { button: 0 });
    mouse(svg, "pointermove", tagX + 60, tagY + 40);
    mouse(svg, "pointerup", tagX + 60, tagY + 40, { button: 0 });
    keyUp(" ");
    const after = view();
    expect(after.x - mid.x).toBeCloseTo(60, 3);
    expect(after.y - mid.y).toBeCloseTo(40, 3);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("a move in the same batch as lostpointercapture must not pan on the stale drag (FR1 P1, C2 live finding)", () => {
    renderFittedCanvas();
    const { el: tag, x: tagX, y: tagY } = tagPoint();
    const before = view();
    keyDown(" ");
    mouse(tag, "pointerdown", tagX, tagY, { button: 0 });
    mouse(svg, "pointermove", tagX + 30, tagY + 20); // arms the pan
    fireFrames();
    const mid = view();
    expect(mid.x - before.x).toBeCloseTo(30, 3);
    expect(mid.y - before.y).toBeCloseTo(20, 3);
    // The browser delivers lostpointercapture lazily, WITH the next
    // move — both land in one React batch, so the move handler still
    // closes over the pre-loss drag state. Without the synchronous
    // lostCaptureRef this move pans the full +60,+40 on the stale
    // drag; with it, the move bails and the view does not move at all.
    act(() => {
      svg.dispatchEvent(
        new window.PointerEvent("lostpointercapture", {
          bubbles: true, button: 0, pointerId: 1, pointerType: "mouse",
          clientX: tagX + 30, clientY: tagY + 20,
        }),
      );
      svg.dispatchEvent(
        new window.PointerEvent("pointermove", {
          bubbles: true, button: 0, pointerId: 1, pointerType: "mouse",
          clientX: tagX + 90, clientY: tagY + 60,
        }),
      );
    });
    fireFrames();
    const afterLoss = view();
    expect(afterLoss.x).toBeCloseTo(mid.x, 3);
    expect(afterLoss.y).toBeCloseTo(mid.y, 3);
    // The next gesture starts fresh from its own down point.
    mouse(tag, "pointerdown", tagX, tagY, { button: 0 });
    mouse(svg, "pointermove", tagX + 60, tagY + 40);
    mouse(svg, "pointerup", tagX + 60, tagY + 40, { button: 0 });
    keyUp(" ");
    const after = view();
    expect(after.x - mid.x).toBeCloseTo(60, 3);
    expect(after.y - mid.y).toBeCloseTo(40, 3);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("a touch tag-drag whose capture is lost, then a fresh touch, pans fresh with no phantom pinch (FR2 P1)", () => {
    renderFittedCanvas();
    const { el: tag, x: tagX, y: tagY } = tagPoint();
    const before = view();
    touch(tag, "pointerdown", 1, tagX, tagY);
    touch(svg, "pointermove", 1, tagX + 30, tagY + 20); // arms the pan
    fireFrames();
    const mid = view();
    expect(mid.x - before.x).toBeCloseTo(30, 3);
    expect(mid.y - before.y).toBeCloseTo(20, 3);
    // Capture lost mid-drag; the finger lifts OUTSIDE the svg, so no
    // pointerup/cancel is ever delivered for pointer 1.
    pointer(svg, "lostpointercapture", 1, "touch", tagX + 30, tagY + 20);
    // A move arriving for the dead pointer after the loss must not pan.
    touch(svg, "pointermove", 1, tagX + 60, tagY + 40);
    fireFrames();
    const afterLoss = view();
    expect(afterLoss.x).toBeCloseTo(mid.x, 3);
    expect(afterLoss.y).toBeCloseTo(mid.y, 3);
    // The next touch is a NEW pointer id: with the stale id retired it
    // is a plain pan (scale unchanged); with the FR1 bug it pairs with
    // the stale id into a phantom pinch and zooms instead of panning.
    touch(tag, "pointerdown", 2, tagX, tagY);
    touch(svg, "pointermove", 2, tagX + 60, tagY + 40);
    touch(svg, "pointerup", 2, tagX + 60, tagY + 40);
    fireFrames();
    const after = view();
    expect(after.scale).toBeCloseTo(before.scale, 4); // no zoom: no phantom pinch
    expect(after.x - mid.x).toBeCloseTo(60, 3);
    expect(after.y - mid.y).toBeCloseTo(40, 3);
  });

  it("losing a driving pinch finger ends the pinch and the survivor cannot drive a phantom pinch (FR2 P1)", () => {
    renderFittedCanvas();
    const before = view();
    touch(svg, "pointerdown", 1, 100, 100);
    touch(svg, "pointerdown", 2, 200, 100); // pinch starts
    touch(svg, "pointermove", 1, 80, 100);
    touch(svg, "pointermove", 2, 220, 100); // 100px -> 140px = 1.4x
    fireFrames();
    const pinched = view();
    expect(pinched.scale).toBeCloseTo(before.scale * 1.4, 3);
    // Finger 1 loses capture mid-pinch and lifts outside: no up/cancel
    // is ever delivered for it.
    pointer(svg, "lostpointercapture", 1, "touch", 80, 100);
    // A move arriving for the dead finger must not drive the pinch
    // (the capture-phase move path must respect the dead guard).
    touch(svg, "pointermove", 1, 60, 100);
    fireFrames();
    const afterDeadMove = view();
    expect(afterDeadMove.scale).toBeCloseTo(pinched.scale, 4);
    expect(afterDeadMove.x).toBeCloseTo(pinched.x, 3);
    expect(afterDeadMove.y).toBeCloseTo(pinched.y, 3);
    // The surviving finger moving alone must not drive a phantom pinch
    // from the stale finger-1 point.
    touch(svg, "pointermove", 2, 260, 100);
    fireFrames();
    const afterSurvivor = view();
    expect(afterSurvivor.scale).toBeCloseTo(pinched.scale, 4);
    expect(afterSurvivor.x).toBeCloseTo(pinched.x, 3);
    expect(afterSurvivor.y).toBeCloseTo(pinched.y, 3);
    // Finger 2 lifts; a fresh touch pans plainly with no zoom.
    touch(svg, "pointerup", 2, 260, 100);
    const { el: tag, x: tagX, y: tagY } = tagPoint();
    touch(tag, "pointerdown", 3, tagX, tagY);
    touch(svg, "pointermove", 3, tagX + 60, tagY + 40);
    touch(svg, "pointerup", 3, tagX + 60, tagY + 40);
    fireFrames();
    const after = view();
    expect(after.scale).toBeCloseTo(pinched.scale, 4);
    expect(after.x - pinched.x).toBeCloseTo(60, 3);
    expect(after.y - pinched.y).toBeCloseTo(40, 3);
  });

  it("losing a non-driving third finger keeps the pinch pair; losing a driving finger rebases onto the surviving pair (FR2 P1)", () => {
    renderFittedCanvas();
    const before = view();
    touch(svg, "pointerdown", 1, 100, 100);
    touch(svg, "pointerdown", 2, 200, 100); // pinch [1,2]
    touch(svg, "pointerdown", 3, 150, 300); // third finger: tracked, not driving
    touch(svg, "pointermove", 1, 80, 100);
    touch(svg, "pointermove", 2, 220, 100); // 100 -> 140 = 1.4x
    fireFrames();
    const pinched = view();
    expect(pinched.scale).toBeCloseTo(before.scale * 1.4, 3);
    // Lose the NON-driving third finger: the [1,2] pair survives
    // untouched — the pinch keeps running from the same baseline.
    pointer(svg, "lostpointercapture", 3, "touch", 150, 300);
    touch(svg, "pointermove", 1, 60, 100);
    touch(svg, "pointermove", 2, 240, 100); // 140 -> 180
    fireFrames();
    const afterThirdLoss = view();
    expect(afterThirdLoss.scale).toBeCloseTo(pinched.scale * (180 / 140), 3);
    // A move from the dead third finger must not touch the pinch.
    touch(svg, "pointermove", 3, 150, 320);
    fireFrames();
    const afterDeadThird = view();
    expect(afterDeadThird.scale).toBeCloseTo(afterThirdLoss.scale, 4);
    expect(afterDeadThird.x).toBeCloseTo(afterThirdLoss.x, 3);
    // A FOURTH finger lands (fresh id) and finger 1 — a driving
    // finger — loses capture: the pinch rebases onto the surviving
    // pair [2,4] with NO zoom step, then keeps pinching from there.
    touch(svg, "pointerdown", 4, 150, 300);
    pointer(svg, "lostpointercapture", 1, "touch", 60, 100);
    const rebased = view();
    expect(rebased.scale).toBeCloseTo(afterThirdLoss.scale, 4); // no jump on rebase
    expect(rebased.x).toBeCloseTo(afterThirdLoss.x, 3);
    // The rebased pair [2,4] pinches on: 2 at (240,100), 4 at
    // (150,300) -> moving 2 to (260,100) grows the pair distance
    // from hypot(90,200) to hypot(110,200) — and ONLY by that factor.
    // With the FR1 bug the pinch still drives on the stale finger-1
    // point, so the same move grows it by 200/180 instead.
    touch(svg, "pointermove", 2, 260, 100);
    fireFrames();
    const afterRebase = view();
    expect(afterRebase.scale).toBeCloseTo(
      rebased.scale * (Math.hypot(110, 200) / Math.hypot(90, 200)),
      3,
    );
    touch(svg, "pointerup", 2, 260, 100);
    touch(svg, "pointerup", 4, 150, 300);
  });

  it("a same-batch capture loss followed by pointerup cannot commit a stale deferred tap (FR2 P1)", () => {
    renderFittedCanvas("room");
    const before = view();
    // Touch down on empty background with a tap-commit tool: the tap
    // is deferred to pointerup (a second finger could still turn it
    // into a pinch). Nothing dispatches yet.
    touch(svg, "pointerdown", 1, 100, 100);
    expect(dispatch).not.toHaveBeenCalled();
    // Capture is lost, then the pointerup arrives in the SAME batch —
    // the loss aborted the gesture, so the up must not run the tap.
    act(() => {
      svg.dispatchEvent(
        new window.PointerEvent("lostpointercapture", {
          bubbles: true, button: 0, pointerId: 1, pointerType: "touch",
          clientX: 100, clientY: 100,
        }),
      );
      svg.dispatchEvent(
        new window.PointerEvent("pointerup", {
          bubbles: true, button: 0, pointerId: 1, pointerType: "touch",
          clientX: 100, clientY: 100,
        }),
      );
    });
    expect(dispatch).not.toHaveBeenCalled();
    const after = view();
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it("a same-batch capture loss followed by pointerup cannot commit a stale wall draw (FR2 P1)", () => {
    renderFittedCanvas("wall");
    // Mouse down starts a draw-wall drag; a move sets the preview.
    mouse(svg, "pointerdown", 100, 100, { button: 0 });
    mouse(svg, "pointermove", 160, 140);
    fireFrames();
    expect(dispatch).not.toHaveBeenCalled();
    // Capture is lost, then the pointerup arrives in the SAME batch —
    // the loss aborted the draw, so the up must not commit the wall
    // (the pre-loss drag state still closes over draw-wall + preview).
    act(() => {
      svg.dispatchEvent(
        new window.PointerEvent("lostpointercapture", {
          bubbles: true, button: 0, pointerId: 1, pointerType: "mouse",
          clientX: 160, clientY: 140,
        }),
      );
      svg.dispatchEvent(
        new window.PointerEvent("pointerup", {
          bubbles: true, button: 0, pointerId: 1, pointerType: "mouse",
          clientX: 160, clientY: 140,
        }),
      );
    });
    expect(dispatch).not.toHaveBeenCalled();
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
