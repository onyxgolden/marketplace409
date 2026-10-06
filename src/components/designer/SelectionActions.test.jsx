// @vitest-environment jsdom

// SelectionActions — copy, paste, duplicate, and flip buttons. Each one
// dispatches the same action as its keyboard shortcut.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import SelectionActions from "./SelectionActions";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("SelectionActions", () => {
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

  const click = (label) =>
    act(() => container.querySelector(`[aria-label="${label}"]`).dispatchEvent(new MouseEvent("click", { bubbles: true })));

  it("dispatches the same action as each keyboard shortcut", () => {
    const dispatch = vi.fn();
    act(() => root.render(<SelectionActions dispatch={dispatch} canPaste />));
    click("Copy");
    click("Paste");
    click("Duplicate");
    click("Flip left-right");
    click("Flip up-down");
    expect(dispatch.mock.calls).toEqual([
      [{ type: "COPY_SELECTION" }],
      [{ type: "PASTE_CLIPBOARD" }],
      [{ type: "DUPLICATE_SELECTION" }],
      [{ type: "FLIP_SELECTION", axis: "horizontal" }],
      [{ type: "FLIP_SELECTION", axis: "vertical" }],
    ]);
  });

  it("disables Paste until something has been copied", () => {
    act(() => root.render(<SelectionActions dispatch={() => {}} canPaste={false} />));
    expect(container.querySelector('[aria-label="Paste"]').disabled).toBe(true);
    expect(container.querySelector('[aria-label="Copy"]').disabled).toBe(false);
  });
});
