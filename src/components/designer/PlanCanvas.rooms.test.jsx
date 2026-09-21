// @vitest-environment jsdom

// Placed rooms on the canvas: clicking the interior selects the room
// (walls still win on the shared edges), and dragging the interior
// dispatches a coalesced MOVE_ROOM that moves the room with the pointer.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PlanCanvas from "./PlanCanvas";
import {
  addRoomFromTemplate,
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

function designWithRoom() {
  // 144x144 bedroom at (60,60); interior point (132,132).
  return addRoomFromTemplate(createEmptyDesign(), "bedroom", { x: 60, y: 60 });
}

describe("PlanCanvas placed rooms", () => {
  let container;
  let root;
  let dispatch;
  let svg;

  const renderCanvas = (design) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => {
      root.render(
        <PlanCanvas design={design} tool="select" selection={null} dispatch={dispatch} />
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

  it("clicking the room interior selects the room", () => {
    const design = designWithRoom();
    const room = design.rooms[0];
    renderCanvas(design);
    pointer(svg, "pointerdown", { x: 132, y: 132 });
    pointer(svg, "pointerup", { x: 132, y: 132 });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SELECT",
      selection: { kind: "room", id: room.id },
    });
  });

  it("walls still win on the shared room edge", () => {
    const design = designWithRoom();
    const room = design.rooms[0];
    renderCanvas(design);
    // Midpoint of the top edge — the wall, not the room, must hit.
    pointer(svg, "pointerdown", { x: 132, y: 60 });
    pointer(svg, "pointerup", { x: 132, y: 60 });
    const selects = dispatch.mock.calls.filter((c) => c[0].type === "SELECT");
    expect(selects.length).toBeGreaterThan(0);
    expect(selects[0][0].selection).toEqual({ kind: "wall", id: room.wallIds[0] });
  });

  it("dragging the room interior dispatches a coalesced MOVE_ROOM", () => {
    const design = designWithRoom();
    const room = design.rooms[0];
    renderCanvas(design);
    pointer(svg, "pointerdown", { x: 132, y: 132 });
    // Grab offset (72,72) from the (60,60) anchor; move to a snapped point.
    pointer(svg, "pointermove", { x: 162, y: 150 });
    pointer(svg, "pointerup", { x: 162, y: 150 });
    const moves = dispatch.mock.calls.filter((c) => c[0].type === "MOVE_ROOM");
    expect(moves.length).toBeGreaterThan(0);
    const keys = new Set(moves.map((c) => c[0].coalesce));
    expect(keys).toEqual(new Set([`move-room:${room.id}`]));
    // (162,150) snaps to the 6" grid already; anchor moved (60,60)->(90,78).
    const last = moves[moves.length - 1][0];
    expect(last.roomId).toBe(room.id);
    expect(last.dx).toBeCloseTo(30, 6);
    expect(last.dy).toBeCloseTo(18, 6);
  });
});
