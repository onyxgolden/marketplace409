// @vitest-environment jsdom

// Arrow keys nudge the selection one grid square — only with a selection,
// only in the select tool, never while typing in a field, never with
// modifier keys, and never when a focused control already handled the key
// (split-view divider, favorites reorder).

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

function press(key, target = window, init = {}) {
  const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("PlanCanvas arrow-key nudge", () => {
  let container;
  let root;
  let dispatch;
  const render = (props) => {
    act(() => {
      root.render(<PlanCanvas design={createEmptyDesign()} tool="select" selection={null} dispatch={dispatch} {...props} />);
    });
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("maps each arrow to a one-square nudge and stops the page from scrolling", () => {
    render({ selection: { kind: "furniture", id: "f1" } });
    const cases = [["ArrowLeft", -1, 0], ["ArrowRight", 1, 0], ["ArrowUp", 0, -1], ["ArrowDown", 0, 1]];
    for (const [key, dx, dy] of cases) {
      dispatch.mockClear();
      const e = press(key, document.body);
      expect(dispatch).toHaveBeenCalledWith({ type: "NUDGE_SELECTION", dx, dy });
      expect(e.defaultPrevented).toBe(true);
    }
  });

  it("works for a shift-multi-selection too", () => {
    render({ selection: null, multiSelection: [{ kind: "furniture", id: "a" }, { kind: "furniture", id: "b" }] });
    press("ArrowRight", document.body);
    expect(dispatch).toHaveBeenCalledWith({ type: "NUDGE_SELECTION", dx: 1, dy: 0 });
  });

  it("does nothing (and lets the page scroll) without a selection", () => {
    render({ selection: null });
    const e = press("ArrowDown", document.body);
    expect(dispatch).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("never fires while typing in a field", () => {
    render({ selection: { kind: "furniture", id: "f1" } });
    for (const tag of ["input", "textarea", "select"]) {
      const el = document.createElement(tag);
      container.appendChild(el);
      press("ArrowLeft", el);
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("ignores modifier combos (Alt+arrow reorders favorites) and keys a focused control already handled", () => {
    render({ selection: { kind: "furniture", id: "f1" } });
    press("ArrowUp", document.body, { altKey: true });
    press("ArrowUp", document.body, { ctrlKey: true });
    press("ArrowUp", document.body, { metaKey: true });
    const divider = document.createElement("div");
    divider.tabIndex = 0;
    divider.addEventListener("keydown", (e) => e.preventDefault()); // like the split-view divider
    container.appendChild(divider);
    press("ArrowLeft", divider);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("only nudges in the select tool", () => {
    render({ tool: "pipe", selection: { kind: "pipe", id: "p1" } });
    press("ArrowRight", document.body);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
