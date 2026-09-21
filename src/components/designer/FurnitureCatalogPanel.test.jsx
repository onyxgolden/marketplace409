// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import FurnitureCatalogPanel, { COLLAPSED_STORAGE_KEY } from "./FurnitureCatalogPanel";
import { FURNITURE_CATEGORIES } from "@/domains/roomDesigner/furnitureCatalog";

const queryHeader = (container, category) =>
  container.querySelector(`button[aria-label$="${category} category"]`);

const queryItem = (container, label) =>
  Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent.includes(label) && !b.hasAttribute("aria-expanded")
  );

describe("FurnitureCatalogPanel (collapsible categories)", () => {
  let container;
  let root;

  const renderPanel = async (props = {}) => {
    await act(async () => {
      root.render(
        <FurnitureCatalogPanel pendingCatalogId={null} dispatch={() => {}} {...props} />
      );
    });
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.localStorage.clear();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    window.localStorage.clear();
  });

  it("renders all categories expanded by default", () => {
    return renderPanel().then(() => {
      for (const category of FURNITURE_CATEGORIES) {
        const header = queryHeader(container, category);
        expect(header).not.toBeNull();
        expect(header.getAttribute("aria-expanded")).toBe("true");
      }
      // Representative items from two categories are visible.
      expect(queryItem(container, "Sofa (3-seat)")).not.toBeNull();
      expect(queryItem(container, "Coffee table")).not.toBeNull();
    });
  });

  it("collapses a category on header click and leaves other categories open", async () => {
    await renderPanel();
    await act(async () => {
      queryHeader(container, "seating").click();
    });
    const seatingHeader = queryHeader(container, "seating");
    expect(seatingHeader.getAttribute("aria-expanded")).toBe("false");
    expect(seatingHeader.getAttribute("aria-label")).toMatch(/expand seating/i);
    expect(queryItem(container, "Sofa (3-seat)")).toBeUndefined();
    // Other categories are untouched.
    expect(queryHeader(container, "tables").getAttribute("aria-expanded")).toBe("true");
    expect(queryItem(container, "Coffee table")).not.toBeNull();
  });

  it("re-expands a collapsed category on a second click", async () => {
    await renderPanel();
    await act(async () => {
      queryHeader(container, "bath").click();
    });
    expect(queryItem(container, "Pedestal sink")).toBeUndefined();
    await act(async () => {
      queryHeader(container, "bath").click();
    });
    expect(queryHeader(container, "bath").getAttribute("aria-expanded")).toBe("true");
    expect(queryItem(container, "Pedestal sink")).not.toBeNull();
  });

  it("uses native button semantics so Enter/Space toggle in a real browser", async () => {
    await renderPanel();
    const header = queryHeader(container, "lighting");
    // Native buttons get Enter/Space activation from the browser; asserting
    // the element contract is the durable part of keyboard accessibility.
    expect(header.tagName).toBe("BUTTON");
    expect(header.getAttribute("type")).toBe("button");
    // Browser-synthesized activation fires a click; the wiring toggles.
    await act(async () => {
      header.click();
    });
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("persists collapsed state across remounts", async () => {
    await renderPanel();
    await act(async () => {
      queryHeader(container, "storage").click();
    });
    expect(window.localStorage.getItem(COLLAPSED_STORAGE_KEY)).toContain('"storage":true');

    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    await renderPanel();

    expect(queryHeader(container, "storage").getAttribute("aria-expanded")).toBe("false");
    expect(queryItem(container, "Bookshelf")).toBeUndefined();
    expect(queryHeader(container, "seating").getAttribute("aria-expanded")).toBe("true");
  });

  it("falls back to all-expanded when stored state is corrupt", async () => {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, "not-json{{{");
    await renderPanel();
    for (const category of FURNITURE_CATEGORIES) {
      expect(queryHeader(container, category).getAttribute("aria-expanded")).toBe("true");
    }
  });

  it("keeps item clicks dispatching SET_PENDING_CATALOG", async () => {
    const dispatch = vi.fn();
    await renderPanel({ dispatch });
    await act(async () => {
      queryItem(container, "Armchair").click();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_PENDING_CATALOG", catalogId: "armchair" });
  });
});
