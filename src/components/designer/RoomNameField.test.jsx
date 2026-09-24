// @vitest-environment jsdom

// RoomNameField — naming a room.
//
// Regression: renameRoom trims (its documented contract), so a field bound
// straight to the stored label cannot be typed into — after "Great " the
// store holds "Great" and the next keystroke yields "Greatr", making a space
// unenterable. The field keeps the in-progress text locally and re-syncs only
// on a genuine external change.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach } from "vitest";
import { RoomNameField } from "./DesignerScreen";

let container;
let root;

const render = (room, dispatch) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<RoomNameField room={room} dispatch={dispatch} />);
  });
  return container.querySelector("input");
};

const rerender = (room, dispatch) => {
  act(() => {
    root.render(<RoomNameField room={room} dispatch={dispatch} />);
  });
  return container.querySelector("input");
};

/** Type one character, the way a controlled React input receives it. */
const typeChar = (input, nextValue) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  act(() => {
    setter.call(input, nextValue);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
};

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("RoomNameField", () => {
  it("shows the stored label", () => {
    const input = render({ id: "r1", label: "Kitchen" }, vi.fn());
    expect(input.value).toBe("Kitchen");
  });

  it("shows an empty field for an unnamed room", () => {
    const input = render({ id: "r1", label: "" }, vi.fn());
    expect(input.value).toBe("");
    expect(input.placeholder).toMatch(/bedroom/i);
  });

  it("dispatches a coalesced RENAME_ROOM as the user types", () => {
    const dispatch = vi.fn();
    const input = render({ id: "r1", label: "" }, dispatch);
    typeChar(input, "K");
    expect(dispatch).toHaveBeenCalledWith({
      type: "RENAME_ROOM",
      roomId: "r1",
      label: "K",
      coalesce: "rename-room:r1",
    });
  });

  it("lets a space be typed even though the store trims — the reported bug", () => {
    // Simulate the real loop: each keystroke dispatches, the store trims, and
    // the trimmed value comes back as a prop on the next render.
    let stored = "";
    const dispatch = vi.fn((action) => {
      stored = action.label.trim();
    });
    let room = { id: "r1", label: stored };
    let input = render(room, dispatch);

    for (const next of ["G", "Gr", "Gre", "Grea", "Great", "Great ", "Great r"]) {
      typeChar(input, next);
      room = { id: "r1", label: stored };
      input = rerender(room, dispatch);
    }

    // The field still holds what was typed, space intact...
    expect(input.value).toBe("Great r");
    // ...and the store holds its trimmed form.
    expect(stored).toBe("Great r");
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "Great r" }),
    );
  });

  it("re-syncs when a different room is selected", () => {
    const dispatch = vi.fn();
    let input = render({ id: "r1", label: "Kitchen" }, dispatch);
    expect(input.value).toBe("Kitchen");
    input = rerender({ id: "r2", label: "Garage" }, dispatch);
    expect(input.value).toBe("Garage");
  });

  it("re-syncs when the stored label changes externally, as on undo", () => {
    // The store must really move first, otherwise "undo" restores a value it
    // already held and there is nothing for the field to re-sync from.
    let stored = "Kitchen";
    const dispatch = vi.fn((action) => {
      stored = action.label.trim();
    });
    let input = render({ id: "r1", label: stored }, dispatch);
    typeChar(input, "Kitchenette");
    input = rerender({ id: "r1", label: stored }, dispatch);
    expect(input.value).toBe("Kitchenette");
    expect(stored).toBe("Kitchenette");

    // Undo puts the old label back from outside the field.
    stored = "Kitchen";
    input = rerender({ id: "r1", label: stored }, dispatch);
    expect(input.value).toBe("Kitchen");
  });

  it("does not fight a trailing space that the store trimmed away", () => {
    const dispatch = vi.fn();
    let input = render({ id: "r1", label: "" }, dispatch);
    typeChar(input, "Den ");
    // Store trimmed to "Den"; the field must keep the trailing space.
    input = rerender({ id: "r1", label: "Den" }, dispatch);
    expect(input.value).toBe("Den ");
  });
});
