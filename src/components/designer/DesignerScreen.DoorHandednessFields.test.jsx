// @vitest-environment jsdom

// DoorHandednessFields — plain-language Start edge/End edge and Side A/Side B
// companion to the on-canvas door flip handles.

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

  it("defaults to Start edge / Side A when the opening has no stored hinge/swing", () => {
    act(() => root.render(<DoorHandednessFields opening={{ id: "op_1" }} dispatch={() => {}} />));
    expect(container.querySelector('[aria-pressed="true"]').textContent).toBe("Start edge");
    const pressed = [...container.querySelectorAll('[aria-pressed="true"]')].map((el) => el.textContent);
    expect(pressed).toEqual(["Start edge", "Side A"]);
  });

  it("reflects a stored hinge=\"end\", swing=\"negative\" as End edge / Side B", () => {
    act(() => root.render(<DoorHandednessFields opening={{ id: "op_1", hinge: "end", swing: "negative" }} dispatch={() => {}} />));
    const pressed = [...container.querySelectorAll('[aria-pressed="true"]')].map((el) => el.textContent);
    expect(pressed).toEqual(["End edge", "Side B"]);
  });

  it("dispatches FLIP_DOOR only when clicking the side that ISN'T already active", () => {
    const dispatch = vi.fn();
    act(() => root.render(<DoorHandednessFields opening={{ id: "op_1", hinge: "start", swing: "positive" }} dispatch={dispatch} />));

    // Clicking the already-active "Start edge" is a no-op.
    const startEdge = [...container.querySelectorAll("button")].find((b) => b.textContent === "Start edge");
    act(() => startEdge.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(dispatch).not.toHaveBeenCalled();

    // Clicking "End edge" (the inactive side) dispatches a real flip.
    const endEdge = [...container.querySelectorAll("button")].find((b) => b.textContent === "End edge");
    act(() => endEdge.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(dispatch).toHaveBeenCalledWith({ type: "FLIP_DOOR", openingId: "op_1", part: "hinge" });

    // Same for the swing row.
    const sideB = [...container.querySelectorAll("button")].find((b) => b.textContent === "Side B");
    act(() => sideB.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(dispatch).toHaveBeenCalledWith({ type: "FLIP_DOOR", openingId: "op_1", part: "swing" });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("ignores an invalid stored hinge/swing value, falling back to the defaults", () => {
    act(() => root.render(<DoorHandednessFields opening={{ id: "op_1", hinge: "sideways", swing: "diagonally" }} dispatch={() => {}} />));
    const pressed = [...container.querySelectorAll('[aria-pressed="true"]')].map((el) => el.textContent);
    expect(pressed).toEqual(["Start edge", "Side A"]);
  });
});
