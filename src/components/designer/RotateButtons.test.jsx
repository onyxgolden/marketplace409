// @vitest-environment jsdom

// RotateButtons — 45-degree rotation both ways from the inspector.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import RotateButtons, { RotateToAngle } from "./RotateButtons";

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

describe("RotateToAngle", () => {
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

  const typeInto = (input, value) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    act(() => {
      setValue.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const submit = () => act(() => {
    container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  it("shows the current angle", () => {
    act(() => root.render(<RotateToAngle rotationDeg={90} onRotate={() => {}} />));
    expect(container.querySelector('[aria-label="Exact angle in degrees"]').value).toBe("90");
  });

  it("sets the exact typed angle, decimals included", () => {
    const onRotate = vi.fn();
    act(() => root.render(<RotateToAngle rotationDeg={0} onRotate={onRotate} />));
    typeInto(container.querySelector('[aria-label="Exact angle in degrees"]'), "37.5");
    submit();
    expect(onRotate).toHaveBeenCalledWith(37.5);
  });

  it("passes negative angles through for the domain to wrap", () => {
    const onRotate = vi.fn();
    act(() => root.render(<RotateToAngle rotationDeg={0} onRotate={onRotate} />));
    typeInto(container.querySelector('[aria-label="Exact angle in degrees"]'), "-90");
    submit();
    expect(onRotate).toHaveBeenCalledWith(-90);
  });

  it("shows the new angle when it changes from outside, dropping an unsaved entry", () => {
    act(() => root.render(<RotateToAngle rotationDeg={90} onRotate={() => {}} />));
    typeInto(container.querySelector('[aria-label="Exact angle in degrees"]'), "12");
    act(() => root.render(<RotateToAngle rotationDeg={135} onRotate={() => {}} />));
    expect(container.querySelector('[aria-label="Exact angle in degrees"]').value).toBe("135");
  });

  it("ignores a blank entry", () => {
    const onRotate = vi.fn();
    act(() => root.render(<RotateToAngle rotationDeg={45} onRotate={onRotate} />));
    typeInto(container.querySelector('[aria-label="Exact angle in degrees"]'), "");
    submit();
    expect(onRotate).not.toHaveBeenCalled();
  });
});
