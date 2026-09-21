// @vitest-environment jsdom

// Regression test: Backspace/Delete while editing a name in a field (e.g. the
// org-chart person name input in the panel) must not trigger DELETE_SELECTION.
// The global window keydown listener in PlanCanvas previously deleted the
// selection out from under the user.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PlanCanvas from "./PlanCanvas";
import { createEmptyDesign } from "@/domains/roomDesigner/designerDocument";

// PlanCanvas observes its wrapper size; jsdom has no ResizeObserver.
if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

function pressKey(key, target) {
  const event = new window.KeyboardEvent("keydown", { key, bubbles: true });
  target.dispatchEvent(event);
}

describe("PlanCanvas keyboard shortcuts", () => {
  let container;
  let root;
  let dispatch;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => {
      root.render(
        <PlanCanvas
          design={createEmptyDesign()}
          tool="select"
          selection={null}
          dispatch={dispatch}
        />
      );
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("does not delete the selection on Backspace while typing in an input", () => {
    const input = document.createElement("input");
    container.appendChild(input);
    pressKey("Backspace", input);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not delete the selection on Delete while typing in a textarea", () => {
    const textarea = document.createElement("textarea");
    container.appendChild(textarea);
    pressKey("Delete", textarea);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("still deletes the selection on Backspace when focus is on the canvas", () => {
    const canvasEl = container.querySelector("svg") || container.firstChild;
    pressKey("Backspace", canvasEl);
    expect(dispatch).toHaveBeenCalledWith({ type: "DELETE_SELECTION" });
  });
});
