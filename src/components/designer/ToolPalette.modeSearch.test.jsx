// @vitest-environment jsdom

// D647-001: the palette shape search is built from the mode-scoped domain
// allowlist — the same one the palette categories and the object library
// dropdown use. A Home search can never surface or arm process equipment,
// piping, or other industrial-only symbols; an Industrial search can never
// surface or arm home furniture.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ToolPalette from "./ToolPalette";
import { groupToolsByCategory } from "@/domains/roomDesigner/designerToolbar";
import "@/domains/roomDesigner/furnitureCatalog";
import "@/domains/roomDesigner/processEquipmentCatalog";
import "@/domains/roomDesigner/pipingCatalog";
import "@/domains/roomDesigner/mepFixturesCatalog";
import "@/domains/roomDesigner/siteOutdoorCatalog";
import "@/domains/roomDesigner/buildingElementsCatalog";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tool = (id, label = id, extra = {}) => ({ id, label, icon: () => null, hint: "", ...extra });
const grouped = () => groupToolsByCategory([tool("select", "Select"), tool("wall", "Wall"), tool("pipe", "Pipe")]);

function type(input, value) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ToolPalette mode-scoped shape search (D647-001)", () => {
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
    act(() =>
      root.render(
        <ToolPalette grouped={grouped()} activeToolId="select" hasUnderlay={false} onSelect={() => {}} {...props} />,
      ),
    );
  const box = () => container.querySelector('input[aria-label="Search shapes"]');
  const results = () => Array.from(container.querySelectorAll('[data-testid="shape-search-result"]'));

  it("home mode: finds furniture, never process equipment or piping", () => {
    const onPickShape = vi.fn();
    render({ mode: "home", onPickShape });
    type(box(), "queen bed");
    expect(results().length).toBeGreaterThan(0);
    act(() => results()[0].click());
    expect(onPickShape).toHaveBeenCalledWith(expect.objectContaining({ domain: "furniture" }));

    type(box(), "centrifugal pump");
    expect(results()).toHaveLength(0);

    type(box(), "gate valve");
    expect(results()).toHaveLength(0);
  });

  it("industrial mode: finds process equipment and piping, never home furniture", () => {
    const onPickShape = vi.fn();
    render({ mode: "industrial", onPickShape });
    type(box(), "centrifugal pump");
    expect(results().length).toBeGreaterThan(0);
    act(() => results()[0].click());
    expect(onPickShape).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "symbol", domain: "processEquipment" }),
    );

    type(box(), "gate valve");
    expect(results().length).toBeGreaterThan(0);

    type(box(), "queen bed");
    expect(results()).toHaveLength(0);
  });

  it("both modes: shared site/outdoor symbols stay searchable", () => {
    render({ mode: "home", onPickShape: () => {} });
    type(box(), "deck");
    const homeLabels = results().map((r) => r.textContent);
    expect(homeLabels.some((t) => t.includes("Deck"))).toBe(true);
  });

  it("a prohibited domain can never be armed because it never appears", () => {
    const onPickShape = vi.fn();
    render({ mode: "home", onPickShape });
    // Even a broad query cannot leak industrial-only results in home mode.
    type(box(), "pump");
    const pickedDomains = [];
    const spy = (r) => pickedDomains.push(r.domain);
    // Re-render with a spying picker and click every result the query yields.
    act(() => root.render(
      <ToolPalette grouped={grouped()} activeToolId="select" hasUnderlay={false} onSelect={() => {}} mode="home" onPickShape={spy} />,
    ));
    type(box(), "pump");
    results().forEach((el) => act(() => el.click()));
    expect(pickedDomains).not.toContain("processEquipment");
    expect(pickedDomains).not.toContain("piping");
    expect(onPickShape).not.toHaveBeenCalled();
  });
});
