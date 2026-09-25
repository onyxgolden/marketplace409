// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ObjectLibraryPanel from "./ObjectLibraryPanel";
// Side-effect imports: register the symbol sets and their draw routines so
// the panel discovers them through the registry (as in the app).
import "@/domains/roomDesigner/furnitureCatalog";
import "@/domains/roomDesigner/buildingElementsCatalog";
import "@/domains/roomDesigner/siteOutdoorCatalog";
import "@/domains/roomDesigner/mepFixturesCatalog";
import "@/components/designer/symbolDrawRoutines";

const domainSelect = (container) =>
  container.querySelector('select[aria-label="Object domain"]');
const categorySelect = (container) =>
  container.querySelector('select[aria-label="Object category"]');
const itemButton = (container, label) =>
  Array.from(container.querySelectorAll('button[role="option"]')).find((b) =>
    b.textContent.includes(label)
  );

async function changeSelect(container, select, value) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("ObjectLibraryPanel", () => {
  let container;
  let root;

  const renderPanel = async (props = {}) => {
    await act(async () => {
      root.render(
        <ObjectLibraryPanel dispatch={() => {}} pendingCatalogId={null} pendingSymbol={null} {...props} />
      );
    });
  };

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

  it("discovers the five object domains through the registry", async () => {
    await renderPanel();
    const options = Array.from(domainSelect(container).options).map((o) => o.textContent);
    expect(options).toEqual(["Furniture", "Building elements", "Site & outdoor", "MEP fixtures", "Process equipment"]);
    // Room templates and piping keep their own panels: not listed.
    expect(options.join(" ")).not.toMatch(/room|piping/i);
  });

  it("defaults to furniture and renders icon buttons with live thumbnails", async () => {
    await renderPanel();
    expect(domainSelect(container).value).toBe("furniture");
    const sofa = itemButton(container, "Sofa (3-seat)");
    expect(sofa).not.toBeNull();
    expect(sofa.querySelector("svg")).not.toBeNull();
    expect(sofa.textContent).toMatch(/84.*×.*36/);
  });

  it("switches domains and lists that domain's categories", async () => {
    await renderPanel();
    await changeSelect(container, domainSelect(container), "buildingElements");
    const categories = Array.from(categorySelect(container).options).map((o) => o.value);
    expect(categories).toEqual(["doors", "windows", "stairs", "structure"]);
    expect(itemButton(container, "Single door")).not.toBeNull();
  });

  it("filters the icon grid by category", async () => {
    await renderPanel({ initialDomain: "buildingElements" });
    await changeSelect(container, categorySelect(container), "windows");
    expect(itemButton(container, "Single-hung window")).not.toBeNull();
    expect(itemButton(container, "Single door")).toBeUndefined();
  });

  it("keeps furniture clicks dispatching SET_PENDING_CATALOG (migrated contract)", async () => {
    const dispatch = vi.fn();
    await renderPanel({ dispatch });
    await act(async () => {
      itemButton(container, "Armchair").click();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_PENDING_CATALOG", catalogId: "armchair" });
  });

  it("dispatches SET_PENDING_SYMBOL for building-element icons", async () => {
    const dispatch = vi.fn();
    await renderPanel({ dispatch, initialDomain: "buildingElements" });
    await act(async () => {
      itemButton(container, "Single door").click();
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_PENDING_SYMBOL",
      domain: "buildingElements",
      symbolId: "door-single",
    });
  });

  it("dispatches SET_PENDING_SYMBOL for site and MEP icons", async () => {
    const dispatch = vi.fn();
    await renderPanel({ dispatch, initialDomain: "siteOutdoor" });
    await changeSelect(container, categorySelect(container), "landscape");
    await act(async () => {
      itemButton(container, "Rectangular pool").click();
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_PENDING_SYMBOL",
      domain: "siteOutdoor",
      symbolId: "pool-rect",
    });

    await changeSelect(container, domainSelect(container), "mepFixtures");
    await act(async () => {
      itemButton(container, "Duplex outlet").click();
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_PENDING_SYMBOL",
      domain: "mepFixtures",
      symbolId: "outlet-duplex",
    });
  });

  it("highlights the pending furniture piece and the pending symbol", async () => {
    await renderPanel({ pendingCatalogId: "armchair" });
    expect(itemButton(container, "Armchair").getAttribute("aria-selected")).toBe("true");
    expect(itemButton(container, "Sofa (3-seat)").getAttribute("aria-selected")).toBe("false");

    await renderPanel({
      pendingCatalogId: null,
      pendingSymbol: { domain: "mepFixtures", symbolId: "outlet-duplex" },
    });
    await changeSelect(container, domainSelect(container), "mepFixtures");
    expect(itemButton(container, "Duplex outlet").getAttribute("aria-selected")).toBe("true");
    expect(itemButton(container, "Switch").getAttribute("aria-selected")).toBe("false");
  });

  it("uses native buttons so Enter/Space activate in a real browser", async () => {
    await renderPanel();
    const button = itemButton(container, "Sofa (3-seat)");
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
  });
});
