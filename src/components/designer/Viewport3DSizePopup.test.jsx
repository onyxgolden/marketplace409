// @vitest-environment jsdom

// Viewport3DSizePopup — P1-B "change size" popup in the 3D view.
//
// What matters: a typed dimension dispatches exactly one valid action; bad
// input shows an error and dispatches nothing; Escape and an untouched blur
// dispatch nothing (the label rounds to whole inches, so re-committing it
// would silently change the design).

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addWall,
  createEmptyDesign,
  placeFurniture,
  resetDesignerIds,
} from "@/domains/roomDesigner/designerDocument";
import Viewport3DSizePopup from "./Viewport3DSizePopup";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  resetDesignerIds();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function wallDesign(bx = 120) {
  return addWall(createEmptyDesign("Plan"), { x: 0, y: 0 }, { x: bx, y: 0 });
}

function render(props) {
  act(() => root.render(<Viewport3DSizePopup {...props} />));
}

/** Set a controlled input's value the way React listens for it. */
function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function key(input, k) {
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
}

describe("Viewport3DSizePopup", () => {
  it("renders nothing for a selection with no editable size", () => {
    render({ selection: { kind: "room", id: "r" }, design: wallDesign(), dispatch: vi.fn() });
    expect(container.innerHTML).toBe("");
  });

  it("shows the wall length and dispatches a new length on Enter", () => {
    const design = wallDesign();
    const dispatch = vi.fn();
    render({ selection: { kind: "wall", id: design.walls[0].id }, design, dispatch });
    const input = container.querySelector('input[aria-label="Length"]');
    expect(input.value).toBe(`10' 0"`);
    type(input, `12'6"`);
    key(input, "Enter");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toMatchObject({ type: "MOVE_WALL_ENDPOINT", end: "b", point: { x: 150, y: 0 } });
  });

  it("shows an error and dispatches nothing for bad input", () => {
    const design = wallDesign();
    const dispatch = vi.fn();
    render({ selection: { kind: "wall", id: design.walls[0].id }, design, dispatch });
    const input = container.querySelector('input[aria-label="Length"]');
    type(input, "lots");
    key(input, "Enter");
    expect(dispatch).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]').textContent).toMatch(/Couldn't read/);
  });

  it("does not dispatch on an untouched blur (would round 120.5\" to 120\")", () => {
    const design = wallDesign(120.5);
    const dispatch = vi.fn();
    render({ selection: { kind: "wall", id: design.walls[0].id }, design, dispatch });
    const input = container.querySelector('input[aria-label="Length"]');
    act(() => input.focus());
    act(() => input.blur());
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("Escape reverts the text and the blur it causes dispatches nothing", () => {
    const design = wallDesign();
    const dispatch = vi.fn();
    render({ selection: { kind: "wall", id: design.walls[0].id }, design, dispatch });
    const input = container.querySelector('input[aria-label="Length"]');
    act(() => input.focus());
    type(input, "20'");
    key(input, "Escape");
    expect(dispatch).not.toHaveBeenCalled();
    expect(input.value).toBe(`10' 0"`);
  });

  it("offers width and depth for furniture and keeps the untouched axis", () => {
    const design = placeFurniture(createEmptyDesign("Plan"), "sofa-3seat", 60, 60);
    const dispatch = vi.fn();
    render({ selection: { kind: "furniture", id: design.furniture[0].id }, design, dispatch });
    const depth = container.querySelector('input[aria-label="Depth"]');
    expect(container.querySelector('input[aria-label="Width"]').value).toBe(`7' 0"`);
    type(depth, "40");
    key(depth, "Enter");
    expect(dispatch.mock.calls[0][0]).toMatchObject({ type: "RESIZE_FURNITURE", widthIn: 84, depthIn: 40 });
  });
});
