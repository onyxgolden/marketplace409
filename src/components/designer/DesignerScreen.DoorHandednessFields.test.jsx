// @vitest-environment jsdom

// DoorHandednessFields — plain-language Left-handed/Right-handed and
// Opens-in/Opens-out companion to the on-canvas door flip handles.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { DoorHandednessFields } from "./DesignerScreen";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("DoorHandednessFields", () => {
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

  it("defaults to Left-handed / Opens in when the opening has no stored hinge/swing", () => {
    act(() => root.render(<DoorHandednessFields opening={{ id: "op_1" }} dispatch={() => {}} />));
    expect(container.querySelector('[aria-pressed="true"]').textContent).toBe("Left-handed");
    const pressed = [...container.querySelectorAll('[aria-pressed="true"]')].map((el) => el.textContent);
    expect(pressed).toEqual(["Left-handed", "Opens in"]);
  });

  it("reflects a stored hinge=\"end\", swing=\"negative\" as Right-handed / Opens out", () => {
    act(() => root.render(<DoorHandednessFields opening={{ id: "op_1", hinge: "end", swing: "negative" }} dispatch={() => {}} />));
    const pressed = [...container.querySelectorAll('[aria-pressed="true"]')].map((el) => el.textContent);
    expect(pressed).toEqual(["Right-handed", "Opens out"]);
  });

  it("dispatches FLIP_DOOR only when clicking the side that ISN'T already active", () => {
    const dispatch = vi.fn();
    act(() => root.render(<DoorHandednessFields opening={{ id: "op_1", hinge: "start", swing: "positive" }} dispatch={dispatch} />));

    // Clicking the already-active "Left-handed" is a no-op.
    const leftHanded = [...container.querySelectorAll("button")].find((b) => b.textContent === "Left-handed");
    act(() => leftHanded.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(dispatch).not.toHaveBeenCalled();

    // Clicking "Right-handed" (the inactive side) dispatches a real flip.
    const rightHanded = [...container.querySelectorAll("button")].find((b) => b.textContent === "Right-handed");
    act(() => rightHanded.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(dispatch).toHaveBeenCalledWith({ type: "FLIP_DOOR", openingId: "op_1", part: "hinge" });

    // Same for the swing row.
    const opensOut = [...container.querySelectorAll("button")].find((b) => b.textContent === "Opens out");
    act(() => opensOut.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(dispatch).toHaveBeenCalledWith({ type: "FLIP_DOOR", openingId: "op_1", part: "swing" });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("ignores an invalid stored hinge/swing value, falling back to the defaults", () => {
    act(() => root.render(<DoorHandednessFields opening={{ id: "op_1", hinge: "sideways", swing: "diagonally" }} dispatch={() => {}} />));
    const pressed = [...container.querySelectorAll('[aria-pressed="true"]')].map((el) => el.textContent);
    expect(pressed).toEqual(["Left-handed", "Opens in"]);
  });
});
