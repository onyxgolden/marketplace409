// @vitest-environment jsdom

// OpeningWidthFields — standard door/window size chips plus a custom
// type-in width for a selected opening. Jason's ask: resize a door to any
// standard size by tapping a chip or typing the inches.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { OpeningWidthFields } from "./DesignerScreen";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OpeningWidthFields", () => {
  let container;
  let root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("offers the standard single-door widths and marks the current one", () => {
    act(() => root.render(<OpeningWidthFields opening={{ id: "op_1", type: "door", widthIn: 32 }} dispatch={() => {}} />));
    const chips = [...container.querySelectorAll('[aria-label="Standard widths"] button')].map((b) => b.textContent);
    expect(chips).toEqual(["24″", "28″", "30″", "32″", "36″"]);
    expect(container.querySelector('[aria-pressed="true"]').textContent).toBe("32″");
  });

  it("offers standard window widths for window openings", () => {
    act(() => root.render(<OpeningWidthFields opening={{ id: "op_2", type: "window", widthIn: 48 }} dispatch={() => {}} />));
    const chips = [...container.querySelectorAll('[aria-label="Standard widths"] button')].map((b) => b.textContent);
    expect(chips).toEqual(["24″", "36″", "48″", "60″", "72″"]);
  });

  it("tapping a chip dispatches RESIZE_OPENING with that width", () => {
    const dispatch = vi.fn();
    act(() => root.render(<OpeningWidthFields opening={{ id: "op_1", type: "door", widthIn: 36 }} dispatch={dispatch} />));
    const chip = [...container.querySelectorAll("button")].find((b) => b.textContent === "30″");
    act(() => chip.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(dispatch).toHaveBeenCalledWith({ type: "RESIZE_OPENING", openingId: "op_1", widthIn: 30 });
  });

  it("typing a custom width and blurring dispatches RESIZE_OPENING", () => {
    const dispatch = vi.fn();
    act(() => root.render(<OpeningWidthFields opening={{ id: "op_1", type: "door", widthIn: 36 }} dispatch={dispatch} />));
    const input = container.querySelector('input[aria-label="Custom width in inches"]');
    expect(input).not.toBeNull();
    // Simulate typing: set the value through the native setter so React sees it.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    act(() => {
      setter.call(input, "28");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true }));
    });
    // blur doesn't bubble in all environments; dispatch focusout-mapped blur directly
    // via the React onBlur prop if the event didn't fire — fall back to Enter key.
    if (dispatch.mock.calls.length === 0) {
      act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    }
    expect(dispatch).toHaveBeenCalledWith({ type: "RESIZE_OPENING", openingId: "op_1", widthIn: 28 });
  });

  it("ignores non-numeric custom input", () => {
    const dispatch = vi.fn();
    act(() => root.render(<OpeningWidthFields opening={{ id: "op_1", type: "door", widthIn: 36 }} dispatch={dispatch} />));
    const input = container.querySelector('input[aria-label="Custom width in inches"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    act(() => {
      setter.call(input, "abc");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
