// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import SymbolThumbnail from "./SymbolThumbnail";
// Side-effect imports: register the symbol sets and their draw routines.
import "@/domains/roomDesigner/furnitureCatalog";
import "@/domains/roomDesigner/buildingElementsCatalog";
import "@/domains/roomDesigner/siteOutdoorCatalog";
import "@/domains/roomDesigner/mepFixturesCatalog";
import "@/components/designer/symbolDrawRoutines";

describe("SymbolThumbnail", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  const renderThumb = async (props) => {
    await act(async () => {
      root.render(<SymbolThumbnail {...props} />);
    });
  };

  it("renders the symbol's existing draw routine into a 48px svg", async () => {
    await renderThumb({ domain: "buildingElements", symbolId: "door-single" });
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("width")).toBe("48");
    expect(svg.getAttribute("height")).toBe("48");
    // The routine's <g> output is inside — no parallel icon renderer.
    expect(svg.querySelector("g")).not.toBeNull();
  });

  it("renders furniture symbols through the furniture routine", async () => {
    await renderThumb({ domain: "furniture", symbolId: "sofa-3seat" });
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg.querySelector("rect")).not.toBeNull();
  });

  it("renders mep and site symbols through their domain routines", async () => {
    await renderThumb({ domain: "mepFixtures", symbolId: "outlet-duplex" });
    expect(container.querySelector("svg circle")).not.toBeNull();
    await renderThumb({ domain: "siteOutdoor", symbolId: "pool-rect" });
    expect(container.querySelector("svg rect")).not.toBeNull();
  });

  it("shows a dashed placeholder for an unknown symbol, not a crash", async () => {
    await renderThumb({ domain: "buildingElements", symbolId: "nope-not-real" });
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    const placeholder = svg.querySelector("rect[stroke-dasharray]");
    expect(placeholder).not.toBeNull();
  });
});
