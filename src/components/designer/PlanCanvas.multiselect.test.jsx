// @vitest-environment jsdom

// Ctrl/Cmd multi-select and group drag: ctrl+click / cmd+click toggles any
// plan object in or out of the cross-type selection group; pressing a member
// of an existing group drags the whole group as one coalesced move (a single
// undo entry). Plain-click and shift-click behavior is unchanged.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PlanCanvas from "./PlanCanvas";
import {
  addWall,
  createEmptyDesign,
  placeFurniture,
  resetDesignerIds,
} from "@/domains/roomDesigner/designerDocument";

// PlanCanvas observes its wrapper size; jsdom has no ResizeObserver.
if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Default view: scale 1.6, offset (60,60) → screen = 60 + 1.6 * plan.
const toScreen = (plan) => ({ x: 60 + 1.6 * plan.x, y: 60 + 1.6 * plan.y });

function pointer(target, type, plan, modifiers = {}) {
  const { x, y } = toScreen(plan);
  act(() => {
    target.dispatchEvent(
      new window.PointerEvent(type, {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: y,
        ctrlKey: !!modifiers.ctrlKey,
        metaKey: !!modifiers.metaKey,
        shiftKey: !!modifiers.shiftKey,
      }),
    );
  });
}

function groupDesign() {
  resetDesignerIds();
  let d = createEmptyDesign("Test");
  d = addWall(d, { x: 0, y: 0 }, { x: 144, y: 0 });
  d = placeFurniture(d, "desk", 100, 100);
  d = placeFurniture(d, "armchair", 300, 100);
  return d;
}

describe("PlanCanvas ctrl/cmd multi-select", () => {
  let container;
  let root;
  let dispatch;
  let svg;

  const renderCanvas = (design, props = {}) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => {
      root.render(
        <PlanCanvas
          design={design}
          tool="select"
          selection={null}
          multiSelection={[]}
          dispatch={dispatch}
          {...props}
        />,
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

  it("ctrl+click toggles a furniture piece via TOGGLE_GROUP_SELECT (not SELECT)", () => {
    const d = groupDesign();
    const piece = d.furniture[0];
    renderCanvas(d);
    pointer(svg, "pointerdown", { x: 100, y: 100 }, { ctrlKey: true });
    pointer(svg, "pointerup", { x: 100, y: 100 }, { ctrlKey: true });
    expect(dispatch).toHaveBeenCalledWith({
      type: "TOGGLE_GROUP_SELECT",
      target: { kind: "furniture", id: piece.id },
    });
    expect(dispatch.mock.calls.some((c) => c[0].type === "SELECT")).toBe(false);
  });

  it("cmd+click (metaKey) toggles a wall the same way", () => {
    const d = groupDesign();
    const wall = d.walls[0];
    renderCanvas(d);
    // Midpoint of the wall, away from the furniture.
    pointer(svg, "pointerdown", { x: 72, y: 0 }, { metaKey: true });
    pointer(svg, "pointerup", { x: 72, y: 0 }, { metaKey: true });
    expect(dispatch).toHaveBeenCalledWith({
      type: "TOGGLE_GROUP_SELECT",
      target: { kind: "wall", id: wall.id },
    });
  });

  it("plain click still selects a single object (no group action)", () => {
    const d = groupDesign();
    const piece = d.furniture[0];
    renderCanvas(d);
    pointer(svg, "pointerdown", { x: 100, y: 100 });
    pointer(svg, "pointerup", { x: 100, y: 100 });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SELECT",
      selection: { kind: "furniture", id: piece.id },
    });
    expect(
      dispatch.mock.calls.some((c) => c[0].type === "TOGGLE_GROUP_SELECT"),
    ).toBe(false);
    expect(
      dispatch.mock.calls.some((c) => c[0].type === "MOVE_SELECTION_GROUP"),
    ).toBe(false);
  });

  it("shift+click still uses the furniture-only TOGGLE_MULTI_SELECT path", () => {
    const d = groupDesign();
    const piece = d.furniture[0];
    renderCanvas(d);
    pointer(svg, "pointerdown", { x: 100, y: 100 }, { shiftKey: true });
    pointer(svg, "pointerup", { x: 100, y: 100 }, { shiftKey: true });
    expect(dispatch).toHaveBeenCalledWith({
      type: "TOGGLE_MULTI_SELECT",
      target: { kind: "furniture", id: piece.id },
    });
    expect(
      dispatch.mock.calls.some((c) => c[0].type === "TOGGLE_GROUP_SELECT"),
    ).toBe(false);
  });

  it("ctrl+click on empty canvas clears the selection", () => {
    const d = groupDesign();
    renderCanvas(d, { multiSelection: [{ kind: "furniture", id: d.furniture[0].id }] });
    pointer(svg, "pointerdown", { x: 500, y: 500 }, { ctrlKey: true });
    pointer(svg, "pointerup", { x: 500, y: 500 }, { ctrlKey: true });
    expect(dispatch).toHaveBeenCalledWith({ type: "CLEAR_SELECTION" });
  });

  it("pressing a group member drags the whole group as one coalesced move", () => {
    const d = groupDesign();
    const [a, b] = d.furniture;
    renderCanvas(d, {
      multiSelection: [
        { kind: "furniture", id: a.id },
        { kind: "furniture", id: b.id },
      ],
    });
    // Plain press on a member: no SELECT, group drag starts.
    pointer(svg, "pointerdown", { x: 100, y: 100 });
    // (100,100) snaps to (102,102); (130,130) snaps to (132,132).
    pointer(svg, "pointermove", { x: 130, y: 130 });
    pointer(svg, "pointermove", { x: 142, y: 130 });
    pointer(svg, "pointerup", { x: 142, y: 130 });
    expect(dispatch.mock.calls.some((c) => c[0].type === "SELECT")).toBe(false);
    const moves = dispatch.mock.calls.filter((c) => c[0].type === "MOVE_SELECTION_GROUP");
    expect(moves.length).toBe(2);
    // Both members move together with the same delta.
    expect(moves[0][0].moves).toEqual([
      { kind: "furniture", id: a.id, dx: 30, dy: 30 },
      { kind: "furniture", id: b.id, dx: 30, dy: 30 },
    ]);
    // One gesture: a single coalesce key across the whole drag.
    const keys = new Set(moves.map((c) => c[0].coalesce));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toMatch(/^move-selection-group:/);
  });

  it("ctrl+click toggle-in starts a group drag covering the previous selection", () => {
    const d = groupDesign();
    const [a, b] = d.furniture;
    renderCanvas(d, { selection: { kind: "furniture", id: a.id } });
    // Ctrl+click the second piece, then move: the group is [a, b].
    pointer(svg, "pointerdown", { x: 300, y: 100 }, { ctrlKey: true });
    pointer(svg, "pointermove", { x: 330, y: 100 });
    pointer(svg, "pointerup", { x: 330, y: 100 });
    expect(dispatch).toHaveBeenCalledWith({
      type: "TOGGLE_GROUP_SELECT",
      target: { kind: "furniture", id: b.id },
    });
    const moves = dispatch.mock.calls.filter((c) => c[0].type === "MOVE_SELECTION_GROUP");
    expect(moves.length).toBeGreaterThan(0);
    const memberIds = moves[0][0].moves.map((m) => m.id).sort();
    expect(memberIds).toEqual([a.id, b.id].sort());
  });

  it("a lone selected object keeps its single-object drag (no group move)", () => {
    const d = groupDesign();
    const [a] = d.furniture;
    renderCanvas(d, { selection: { kind: "furniture", id: a.id } });
    pointer(svg, "pointerdown", { x: 100, y: 100 });
    pointer(svg, "pointermove", { x: 130, y: 130 });
    pointer(svg, "pointerup", { x: 130, y: 130 });
    expect(
      dispatch.mock.calls.some((c) => c[0].type === "MOVE_SELECTION_GROUP"),
    ).toBe(false);
    expect(dispatch.mock.calls.some((c) => c[0].type === "MOVE_FURNITURE")).toBe(true);
  });

  it("ctrl+click toggling a member out does not start a drag", () => {
    const d = groupDesign();
    const [a, b] = d.furniture;
    renderCanvas(d, {
      multiSelection: [
        { kind: "furniture", id: a.id },
        { kind: "furniture", id: b.id },
      ],
    });
    // Ctrl+click a member: toggled out, and a pure click moves nothing.
    pointer(svg, "pointerdown", { x: 100, y: 100 }, { ctrlKey: true });
    pointer(svg, "pointerup", { x: 100, y: 100 }, { ctrlKey: true });
    expect(dispatch).toHaveBeenCalledWith({
      type: "TOGGLE_GROUP_SELECT",
      target: { kind: "furniture", id: a.id },
    });
    expect(
      dispatch.mock.calls.some((c) => c[0].type === "MOVE_SELECTION_GROUP"),
    ).toBe(false);
  });
});
