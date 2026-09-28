// @vitest-environment jsdom

// RotateButtons — 45-degree rotation both ways from the inspector.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import RotateButtons from "./RotateButtons";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("RotateButtons", () => {
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

  it("rotates 45 degrees counter-clockwise or clockwise from the current angle", () => {
    const onRotate = vi.fn();
    act(() => root.render(<RotateButtons rotationDeg={90} onRotate={onRotate} />));
    const ccw = container.querySelector('[aria-label="Rotate 45° counter-clockwise"]');
    const cw = container.querySelector('[aria-label="Rotate 45° clockwise"]');
    act(() => ccw.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => cw.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onRotate.mock.calls).toEqual([[45], [135]]);
  });

  it("wraps below zero (the domain normalizes to 0-359)", () => {
    const onRotate = vi.fn();
    act(() => root.render(<RotateButtons rotationDeg={0} onRotate={onRotate} />));
    act(() => container.querySelector('[aria-label="Rotate 45° counter-clockwise"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onRotate).toHaveBeenCalledWith(-45);
  });
});
