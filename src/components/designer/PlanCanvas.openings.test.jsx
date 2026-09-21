// @vitest-environment jsdom

// Placed openings (doors/windows) on the canvas: wall hits take priority
// over opening hits on the shared wall line (CAD-style); an opening hit
// beats room interiors. Clicking an opening selects it and drags it along
// its wall with the pointer grab offset preserved (no jump); a selected
// opening shows end handles that resize it with the far edge anchored.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PlanCanvas from "./PlanCanvas";
import {
  addOpening,
  addWall,
  createEmptyDesign,
} from "@/domains/roomDesigner/designerDocument";

// PlanCanvas uses a ResizeObserver for its wrapper size; jsdom has none.
if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Default view: scale 1.6, offset (60,60) → screen = 60 + 1.6 * plan.
const toScreen = (plan) => ({ x: 60 + 1.6 * plan.x, y: 60 + 1.6 * plan.y });

function pointer(target, type, plan) {
  const { x, y } = toScreen(plan);
  act(() => {
    target.dispatchEvent(
      new window.PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
    );
  });
}

// 144in wall along y=0 with a 36in door cut at offset 36 (gap x in 36..72).
function designWithDoor() {
  let d = createEmptyDesign("Test");
  d = addWall(d, { x: 0, y: 0 }, { x: 144, y: 0 });
  d = addOpening(d, d.walls[0].id, { type: "door", offsetIn: 36 });
  return d;
}

describe("PlanCanvas placed openings", () => {
  let container;
  let root;
  let dispatch;
  let svg;

  const renderCanvas = (design, selection = null) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => {
      root.render(
        <PlanCanvas design={design} tool="select" selection={selection} dispatch={dispatch} />
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

  it("a wall hit beats an opening hit on the shared wall line", () => {
    const design = designWithDoor();
    const wallId = design.walls[0].id;
    renderCanvas(design);
    // Directly on the wall over the door gap — the wall must win.
    pointer(svg, "pointerdown", { x: 54, y: 0 });
    pointer(svg, "pointerup", { x: 54, y: 0 });
    const selects = dispatch.mock.calls.filter((c) => c[0].type === "SELECT");
    expect(selects.length).toBeGreaterThan(0);
    expect(selects[0][0].selection).toEqual({ kind: "wall", id: wallId });
  });

  it("clicking just off the wall over the opening selects the opening", () => {
    const design = designWithDoor();
    const openingId = design.openings[0].id;
    renderCanvas(design);
    // 9in off the wall: outside the wall band (6.25in) but inside the
    // opening band (12.25in) over the gap.
    pointer(svg, "pointerdown", { x: 54, y: 9 });
    pointer(svg, "pointerup", { x: 54, y: 9 });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SELECT",
      selection: { kind: "opening", id: openingId },
    });
  });

  it("the nearest opening wins when two gaps are in range", () => {
    let d = createEmptyDesign("Test");
    d = addWall(d, { x: 0, y: 0 }, { x: 144, y: 0 });
    // Window first (farther from the click), door second (nearer).
    d = addOpening(d, d.walls[0].id, { type: "window", offsetIn: 84 }); // 84..132
    d = addOpening(d, d.walls[0].id, { type: "door", offsetIn: 36 }); // 36..72
    const doorId = d.openings[1].id;
    renderCanvas(d);
    // (76,9) is in range of both gaps; the door gap is nearer.
    pointer(svg, "pointerdown", { x: 76, y: 9 });
    pointer(svg, "pointerup", { x: 76, y: 9 });
    const selects = dispatch.mock.calls.filter((c) => c[0].type === "SELECT");
    expect(selects.length).toBeGreaterThan(0);
    expect(selects[0][0].selection).toEqual({ kind: "opening", id: doorId });
  });

  it("dragging an opening dispatches a coalesced MOVE_OPENING with the grab offset preserved", () => {
    const design = designWithDoor();
    const openingId = design.openings[0].id;
    renderCanvas(design);
    pointer(svg, "pointerdown", { x: 54, y: 9 });
    // Grab offset along the wall: 54 - 36 = 18.
    pointer(svg, "pointermove", { x: 60, y: 9 });
    pointer(svg, "pointermove", { x: 66, y: 9 });
    pointer(svg, "pointerup", { x: 66, y: 9 });
    const moves = dispatch.mock.calls.filter((c) => c[0].type === "MOVE_OPENING");
    expect(moves.length).toBeGreaterThan(0);
    const keys = new Set(moves.map((c) => c[0].coalesce));
    expect(keys).toEqual(new Set([`move-opening:${openingId}`]));
    // No jump: the opening follows pointer-minus-grab (60-18=42), snapped
    // to the 6" grid — not the raw pointer offset.
    expect(moves[0][0].offsetIn).toBe(42);
    expect(moves[moves.length - 1][0].offsetIn).toBe(48);
  });

  it("a selected opening renders two resize handles", () => {
    const design = designWithDoor();
    const openingId = design.openings[0].id;
    renderCanvas(design, { kind: "opening", id: openingId });
    const handles = [...svg.querySelectorAll('rect[fill="#f59e0b"]')];
    expect(handles).toHaveLength(2);
  });

  it("dragging the end handle resizes the opening with the start edge anchored", () => {
    const design = designWithDoor();
    const openingId = design.openings[0].id;
    renderCanvas(design, { kind: "opening", id: openingId });
    // End handle at (72,0); drag to (90,0): width 90-36=54.
    pointer(svg, "pointerdown", { x: 72, y: 0 });
    pointer(svg, "pointermove", { x: 90, y: 0 });
    pointer(svg, "pointerup", { x: 90, y: 0 });
    const resizes = dispatch.mock.calls.filter((c) => c[0].type === "RESIZE_OPENING");
    expect(resizes.length).toBeGreaterThan(0);
    const keys = new Set(resizes.map((c) => c[0].coalesce));
    expect(keys).toEqual(new Set([`resize-opening:${openingId}`]));
    expect(resizes[resizes.length - 1][0].widthIn).toBe(54);
  });

  it("dragging the start handle moves the start edge with the end edge anchored", () => {
    const design = designWithDoor();
    const openingId = design.openings[0].id;
    renderCanvas(design, { kind: "opening", id: openingId });
    // Start handle at (36,0); drag to (48,0): end edge stays at 72.
    pointer(svg, "pointerdown", { x: 36, y: 0 });
    pointer(svg, "pointermove", { x: 48, y: 0 });
    pointer(svg, "pointerup", { x: 48, y: 0 });
    const moves = dispatch.mock.calls.filter((c) => c[0].type === "MOVE_OPENING_START");
    expect(moves.length).toBeGreaterThan(0);
    const keys = new Set(moves.map((c) => c[0].coalesce));
    expect(keys).toEqual(new Set([`resize-opening:${openingId}`]));
    expect(moves[moves.length - 1][0].offsetIn).toBe(48);
  });

  it("the end handle ignores drags below the 12in minimum and past the wall end", () => {
    const design = designWithDoor();
    const openingId = design.openings[0].id;
    renderCanvas(design, { kind: "opening", id: openingId });
    // End handle at (72,0); (40,0) snaps to 42 → width 6 < 12: ignored.
    pointer(svg, "pointerdown", { x: 72, y: 0 });
    pointer(svg, "pointermove", { x: 40, y: 0 });
    // (200,0) would need width 162 > 144-36-1: ignored (start must stay put).
    pointer(svg, "pointermove", { x: 200, y: 0 });
    pointer(svg, "pointerup", { x: 200, y: 0 });
    const resizes = dispatch.mock.calls.filter((c) => c[0].type === "RESIZE_OPENING");
    expect(resizes).toHaveLength(0);
  });
});
