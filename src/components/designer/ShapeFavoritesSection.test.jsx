// @vitest-environment jsdom

// ShapeFavoritesSection — the ordered, one-tap Favorites section of the shape library.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShapeFavoritesSection from "./ShapeFavoritesSection";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

const shapes = [
  { id: "a", name: "Dining set" },
  { id: "b", name: "Powder room" },
  { id: "c", name: "Laundry" },
];

function render(props = {}) {
  const handlers = { onPlace: vi.fn(), onMove: vi.fn(), onRemove: vi.fn() };
  act(() => root.render(<ShapeFavoritesSection shapes={shapes} {...handlers} {...props} />));
  return handlers;
}
const byLabel = (label) => container.querySelector(`[aria-label="${label}"]`);
const click = (el) => act(() => el.click());

describe("ShapeFavoritesSection", () => {
  it("lists favorites in the given order", () => {
    render();
    const rows = [...container.querySelectorAll('[data-testid="favorite-shape"]')].map((li) => li.textContent);
    expect(rows.map((t) => t.replace(/\s+/g, " ").trim())).toEqual(["Dining set", "Powder room", "Laundry"]);
  });

  it("places a shape with one tap", () => {
    const h = render();
    click(byLabel("Place Powder room"));
    expect(h.onPlace).toHaveBeenCalledWith("b");
  });

  it("moves up/down, with the ends disabled", () => {
    const h = render();
    expect(byLabel("Move Dining set up").disabled).toBe(true);
    expect(byLabel("Move Laundry down").disabled).toBe(true);
    click(byLabel("Move Laundry up"));
    click(byLabel("Move Dining set down"));
    expect(h.onMove.mock.calls).toEqual([["c", -1], ["a", 1]]);
  });

  it("reorders from the keyboard with Alt+Arrow keys", () => {
    const h = render();
    const place = byLabel("Place Powder room");
    act(() => place.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true })));
    act(() => place.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))); // no Alt: ignored
    expect(h.onMove.mock.calls).toEqual([["b", -1]]);
  });

  it("removes a favorite", () => {
    const h = render();
    click(byLabel("Remove Laundry from favorites"));
    expect(h.onRemove).toHaveBeenCalledWith("c");
  });

  it("shows a hint when there are no favorites", () => {
    render({ shapes: [] });
    expect(container.textContent).toMatch(/Star a shape in My shapes/);
  });
});
