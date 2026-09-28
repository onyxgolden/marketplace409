// @vitest-environment jsdom

// On-canvas handles: a selected door shows ⇅ (flip swing) and ⇄ (flip
// hinge) handles; a selected furniture piece or symbol shows a Visio-style
// rotation handle that sets its angle (15° snap, Shift = 45°) as one
// coalesced drag.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PlanCanvas from "./PlanCanvas";
import { addOpening, addWall, createEmptyDesign, pieceSize, placeFurniture, placeSymbol } from "@/domains/roomDesigner/designerDocument";
import { doorHandlePoints, doorSwingFrame, rotationHandlePoint } from "@/domains/roomDesigner/designerHandles";

if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Default view: scale 1.6, offset (60,60) → screen = 60 + 1.6 * plan.
const SCALE = 1.6;
const toScreen = (plan) => ({ x: 60 + SCALE * plan.x, y: 60 + SCALE * plan.y });

describe("PlanCanvas handles", () => {
  let container;
  let root;
  let dispatch;
  let svg;

  const renderCanvas = (design, selection) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => {
      root.render(<PlanCanvas design={design} tool="select" selection={selection} dispatch={dispatch} />);
    });
    svg = container.querySelector("svg");
  };
  const pointer = (type, plan, init = {}) => {
    const { x, y } = toScreen(plan);
    act(() => {
      svg.dispatchEvent(new window.PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, ...init }));
    });
  };

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function doorDesign() {
    let d = addWall(createEmptyDesign("T"), { x: 0, y: 0 }, { x: 144, y: 0 });
    d = addOpening(d, d.walls[0].id, { type: "door", offsetIn: 36 });
    return d;
  }

  it("shows flip handles only for a selected door", () => {
    const d = doorDesign();
    renderCanvas(d, null);
    expect(container.querySelector('[data-testid="door-flip-handles"]')).toBeNull();
    act(() => root.render(<PlanCanvas design={d} tool="select" selection={{ kind: "opening", id: d.openings[0].id }} dispatch={dispatch} />));
    expect(container.querySelector('[data-testid="door-flip-handles"]')).not.toBeNull();
  });

  it("clicking ⇅ flips the swing and ⇄ flips the hinge", () => {
    const d = doorDesign();
    const door = d.openings[0];
    renderCanvas(d, { kind: "opening", id: door.id });
    const pts = doorHandlePoints(doorSwingFrame(d.walls[0], door), SCALE);
    pointer("pointerdown", pts.flipSwing);
    pointer("pointerup", pts.flipSwing);
    pointer("pointerdown", pts.flipHinge);
    pointer("pointerup", pts.flipHinge);
    const flips = dispatch.mock.calls.map((c) => c[0]).filter((a) => a.type === "FLIP_DOOR");
    expect(flips).toEqual([
      { type: "FLIP_DOOR", openingId: door.id, part: "swing" },
      { type: "FLIP_DOOR", openingId: door.id, part: "hinge" },
    ]);
  });

  it("draws an end-hinged, negative-swing door leaf from the far jamb into the other face", () => {
    const d = doorDesign();
    const flipped = { ...d, openings: [{ ...d.openings[0], hinge: "end", swing: "negative" }] };
    renderCanvas(flipped, null);
    // leaf: hinge at plan (72, 0) → open along +y (negative face) to (72, 36)
    const h = toScreen({ x: 72, y: 0 });
    const tip = toScreen({ x: 72, y: 36 });
    const leaf = [...container.querySelectorAll("line")].find((l) =>
      Math.abs(Number(l.getAttribute("x1")) - h.x) < 0.01 && Math.abs(Number(l.getAttribute("y1")) - h.y) < 0.01
      && Math.abs(Number(l.getAttribute("x2")) - tip.x) < 0.01 && Math.abs(Number(l.getAttribute("y2")) - tip.y) < 0.01);
    expect(leaf).toBeTruthy();
  });

  it("dragging the rotation handle rotates the selected furniture, snapped, as one coalesced gesture", () => {
    const d = placeFurniture(createEmptyDesign("T"), "bed-queen", 200, 200, 0);
    const piece = d.furniture[0];
    renderCanvas(d, { kind: "furniture", id: piece.id });
    expect(container.querySelector('[data-testid="rotation-handle"]')).not.toBeNull();
    const h = rotationHandlePoint({ x: 200, y: 200, depthIn: pieceSize(piece).depthIn, rotationDeg: 0 }, SCALE);
    pointer("pointerdown", h);
    pointer("pointermove", { x: 300, y: 205 }); // ~93° → 90
    pointer("pointermove", { x: 260, y: 150 }, { shiftKey: true }); // ~50° → 45 with Shift
    pointer("pointerup", { x: 260, y: 150 });
    const rotates = dispatch.mock.calls.map((c) => c[0]).filter((a) => a.type === "ROTATE_FURNITURE");
    expect(rotates.map((a) => a.rotationDeg)).toEqual([90, 45]);
    expect(new Set(rotates.map((a) => a.coalesce))).toEqual(new Set([`rotate:${piece.id}`]));
    expect(dispatch.mock.calls.some((c) => c[0].type === "MOVE_FURNITURE")).toBe(false);
  });

  it("process-equipment symbols get the rotation handle too", () => {
    const d = placeSymbol(createEmptyDesign("T"), "processEquipment", "centrifugal-pump", 200, 200, { id: "p1" });
    renderCanvas(d, { kind: "symbol", id: "p1" });
    expect(container.querySelector('[data-testid="rotation-handle"]')).not.toBeNull();
  });
});
