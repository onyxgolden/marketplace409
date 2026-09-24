// @vitest-environment jsdom

// Dragging a wall BODY moves the whole wall (the reported bug: click-hold on
// a wall did nothing, because only endpoint handles had a drag).
//
// The two behaviours must not collide: a hit on the body translates the wall
// rigidly, a hit on an endpoint handle still stretches it.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PlanCanvas from "./PlanCanvas";
import { addWall, createEmptyDesign } from "@/domains/roomDesigner/designerDocument";

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
      new window.PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }),
    );
  });
}

/** A single horizontal wall from (60,60) to (180,60). */
function designWithWall() {
  return addWall(createEmptyDesign(), { x: 60, y: 60 }, { x: 180, y: 60 }, { id: "w1" });
}

describe("PlanCanvas wall body drag", () => {
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
        <PlanCanvas design={design} tool="select" selection={selection} dispatch={dispatch} />,
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

  it("clicking a wall body still selects it", () => {
    renderCanvas(designWithWall());
    pointer(svg, "pointerdown", { x: 120, y: 60 });
    pointer(svg, "pointerup", { x: 120, y: 60 });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SELECT",
      selection: { kind: "wall", id: "w1" },
    });
  });

  it("dragging a wall body dispatches a coalesced MOVE_WALL", () => {
    renderCanvas(designWithWall());
    // Grab the wall at its midpoint: 60 inches along from endpoint a.
    pointer(svg, "pointerdown", { x: 120, y: 60 });
    pointer(svg, "pointermove", { x: 150, y: 78 });
    pointer(svg, "pointerup", { x: 150, y: 78 });

    const moves = dispatch.mock.calls.filter((c) => c[0].type === "MOVE_WALL");
    expect(moves.length).toBeGreaterThan(0);
    expect(new Set(moves.map((c) => c[0].coalesce))).toEqual(new Set(["move-wall:w1"]));
    const last = moves[moves.length - 1][0];
    expect(last.wallId).toBe("w1");
    // Grab offset (60,0) from endpoint a; pointer (150,78) is on the 6" grid,
    // so a moves (60,60) -> (90,78): delta (30,18).
    expect(last.dx).toBeCloseTo(30, 6);
    expect(last.dy).toBeCloseTo(18, 6);
  });

  it("keeps the grab offset, so the wall does not jump to the cursor", () => {
    renderCanvas(designWithWall());
    pointer(svg, "pointerdown", { x: 120, y: 60 });
    pointer(svg, "pointermove", { x: 126, y: 60 });
    const moves = dispatch.mock.calls.filter((c) => c[0].type === "MOVE_WALL");
    // A 6-inch pointer move is a 6-inch wall move — not a jump of the
    // wall's endpoint onto the pointer (which would be dx = 66).
    expect(moves[moves.length - 1][0].dx).toBeCloseTo(6, 6);
    expect(moves[moves.length - 1][0].dy).toBeCloseTo(0, 6);
  });

  it("emits no MOVE_WALL for a click without movement", () => {
    renderCanvas(designWithWall());
    pointer(svg, "pointerdown", { x: 120, y: 60 });
    pointer(svg, "pointerup", { x: 120, y: 60 });
    expect(dispatch.mock.calls.filter((c) => c[0].type === "MOVE_WALL")).toHaveLength(0);
  });

  it("still stretches the wall when an ENDPOINT handle is grabbed", () => {
    // Endpoint handles only exist on the selected wall.
    renderCanvas(designWithWall(), { kind: "wall", id: "w1" });
    pointer(svg, "pointerdown", { x: 180, y: 60 });
    pointer(svg, "pointermove", { x: 210, y: 90 });

    const endpointMoves = dispatch.mock.calls.filter((c) => c[0].type === "MOVE_WALL_ENDPOINT");
    expect(endpointMoves.length).toBeGreaterThan(0);
    expect(endpointMoves[0][0].end).toBe("b");
    // The body drag must NOT also fire — that would move and stretch at once.
    expect(dispatch.mock.calls.filter((c) => c[0].type === "MOVE_WALL")).toHaveLength(0);
  });

  it("moves the body when the selected wall is grabbed away from its handles", () => {
    renderCanvas(designWithWall(), { kind: "wall", id: "w1" });
    pointer(svg, "pointerdown", { x: 120, y: 60 });
    pointer(svg, "pointermove", { x: 126, y: 60 });
    expect(dispatch.mock.calls.filter((c) => c[0].type === "MOVE_WALL").length).toBeGreaterThan(0);
    expect(dispatch.mock.calls.filter((c) => c[0].type === "MOVE_WALL_ENDPOINT")).toHaveLength(0);
  });
});
