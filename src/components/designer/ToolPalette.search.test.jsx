// @vitest-environment jsdom

// Shape search in the left palette: type to find tools, furniture and
// symbols; click a result to arm it for placement.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ToolPalette from "./ToolPalette";
import ShapeFavoritesSection from "./ShapeFavoritesSection";
import { groupToolsByCategory } from "@/domains/roomDesigner/designerToolbar";
import "@/domains/roomDesigner/furnitureCatalog";
import "@/domains/roomDesigner/processEquipmentCatalog";
import "@/domains/roomDesigner/mepFixturesCatalog";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tool = (id, label = id, extra = {}) => ({ id, label, icon: () => null, hint: "", ...extra });
const grouped = () => groupToolsByCategory([tool("select", "Select"), tool("wall", "Wall"), tool("pipe", "Pipe"), tool("calibrate", "Calibrate", { needsUnderlay: true })]);

function type(input, value) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ToolPalette shape search", () => {
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
  const render = (props = {}) =>
    act(() => root.render(<ToolPalette grouped={grouped()} activeToolId="select" hasUnderlay={false} onSelect={() => {}} {...props} />));
  const box = () => container.querySelector('input[aria-label="Search shapes"]');
  const results = () => Array.from(container.querySelectorAll('[data-testid="shape-search-result"]'));

  it("shows a search box and, while searching, results instead of the categories", () => {
    render();
    expect(box()).not.toBeNull();
    type(box(), "toilet");
    expect(results().map((r) => r.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Toilet")]));
    expect(container.querySelector('button[aria-label$=" tools"]')).toBeNull(); // categories hidden
    type(box(), "");
    expect(results()).toHaveLength(0);
    expect(container.querySelector('button[aria-label$=" tools"]')).not.toBeNull();
  });

  it("arms a furniture or symbol result through onPickShape", () => {
    const onPickShape = vi.fn();
    render({ onPickShape });
    type(box(), "queen bed");
    act(() => results()[0].click());
    expect(onPickShape).toHaveBeenCalledWith(expect.objectContaining({ kind: "catalog", domain: "furniture", id: "bed-queen" }));
    type(box(), "centrifugal pump");
    act(() => results()[0].click());
    expect(onPickShape).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "symbol", domain: "processEquipment", id: "centrifugal-pump" }));
  });

  it("selects a matching tool through onSelect, and respects disabled tools", () => {
    const onSelect = vi.fn();
    render({ onSelect });
    type(box(), "wall");
    act(() => results()[0].click());
    expect(onSelect).toHaveBeenCalledWith("wall");
    type(box(), "calibrate");
    expect(results()[0].disabled).toBe(true);
  });

  it("clears on Escape and says so when nothing matches", () => {
    render();
    type(box(), "zzzz-nothing");
    expect(container.textContent).toMatch(/No shapes match/);
    act(() => box().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(box().value).toBe("");
  });

  it("the favorite shapes section also starts collapsed", () => {
    act(() => root.render(<ShapeFavoritesSection shapes={[{ id: "s1", name: "Dining set" }]} onPlace={() => {}} onMove={() => {}} onRemove={() => {}} />));
    const header = container.querySelector('button[aria-label$="favorite shapes"]');
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Dining set");
  });
});
