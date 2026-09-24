// @vitest-environment jsdom

// SaveAsShapeButton — the "Save as shape" affordance shared by the single-
// selection panel and the multi-select Arrange panel.
//
// Contract: opens an inline name prompt; Save calls onSave(name); a thrown
// CustomShapeError (bad name, duplicate, full library, ...) is shown inline
// and the prompt STAYS OPEN so the user can fix it, never silently closing on
// failure. Escape and Cancel discard the prompt without calling onSave.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach } from "vitest";
import { SaveAsShapeButton } from "./DesignerScreen";
import { CustomShapeError } from "@/domains/roomDesigner/customShapes/customShapeErrors";

let container;
let root;

const render = (onSave) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<SaveAsShapeButton onSave={onSave} />);
  });
};

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const click = (el) => act(() => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));

const typeInto = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
};

describe("SaveAsShapeButton", () => {
  it("starts as a single button, no prompt visible", () => {
    render(vi.fn());
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).toContain("Save as shape");
  });

  it("opens a name prompt on click", () => {
    render(vi.fn());
    click(container.querySelector("button"));
    expect(container.querySelector("input")).not.toBeNull();
    expect(container.textContent).toContain("Shape name");
  });

  it("calls onSave with the typed name and closes on success", () => {
    const onSave = vi.fn();
    render(onSave);
    click(container.querySelector("button"));
    typeInto(container.querySelector("input"), "Bay window");
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Save"));
    expect(onSave).toHaveBeenCalledWith("Bay window");
    expect(container.querySelector("input")).toBeNull();
  });

  it("submits on Enter", () => {
    const onSave = vi.fn();
    render(onSave);
    click(container.querySelector("button"));
    const input = container.querySelector("input");
    typeInto(input, "Dormer");
    act(() => {
      input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSave).toHaveBeenCalledWith("Dormer");
  });

  it("shows the thrown error inline and keeps the prompt open", () => {
    const onSave = vi.fn(() => {
      throw new CustomShapeError('You already have a shape called "Dormer".', { code: "duplicate-name" });
    });
    render(onSave);
    click(container.querySelector("button"));
    typeInto(container.querySelector("input"), "Dormer");
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Save"));
    expect(container.textContent).toContain("already have a shape");
    // Still open: the input is still there and still holds what was typed.
    expect(container.querySelector("input").value).toBe("Dormer");
  });

  it("clears a previous error on a fresh attempt", () => {
    let shouldFail = true;
    const onSave = vi.fn(() => {
      if (shouldFail) throw new CustomShapeError("Give the shape a name before saving it.");
    });
    render(onSave);
    click(container.querySelector("button"));
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Save"));
    expect(container.textContent).toContain("Give the shape a name");

    shouldFail = false;
    typeInto(container.querySelector("input"), "Fixed name");
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Save"));
    expect(container.textContent).not.toContain("Give the shape a name");
  });

  it("Cancel discards the prompt without calling onSave", () => {
    const onSave = vi.fn();
    render(onSave);
    click(container.querySelector("button"));
    typeInto(container.querySelector("input"), "Never saved");
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Cancel"));
    expect(onSave).not.toHaveBeenCalled();
    expect(container.querySelector("input")).toBeNull();
  });

  it("Escape discards the prompt without calling onSave", () => {
    const onSave = vi.fn();
    render(onSave);
    click(container.querySelector("button"));
    const input = container.querySelector("input");
    typeInto(input, "Never saved");
    act(() => {
      input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onSave).not.toHaveBeenCalled();
    expect(container.querySelector("input")).toBeNull();
  });

  it("clears leftover text and error when reopened after a cancel", () => {
    render(vi.fn());
    click(container.querySelector("button"));
    typeInto(container.querySelector("input"), "Stale text");
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Cancel"));
    click(container.querySelector("button"));
    expect(container.querySelector("input").value).toBe("");
  });

  it("shows a generic message when the thrown error has none", () => {
    const onSave = vi.fn(() => {
      throw new Error();
    });
    render(onSave);
    click(container.querySelector("button"));
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Save"));
    expect(container.textContent).toContain("Could not save that shape");
  });
});
