// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ToolPalette, { COLLAPSED_STORAGE_KEY, FAVORITE_STORAGE_KEY } from "./ToolPalette";
import { groupToolsByCategory } from "@/domains/roomDesigner/designerToolbar";

// Mirror the real TOOL_DEFS ids from DesignerScreen.jsx. Icons are stubs;
// the palette only needs id/label/hint/needsUnderlay for these tests.
// Furniture stays in the right panel (leftPalette: false), so it never
// appears in the left palette.
const tool = (id, extra = {}) => ({ id, label: id, icon: () => null, hint: "", ...extra });
const TOOL_DEFS = [
  "select",
  "wall",
  "wallrect",
  "room",
  "door",
  "window",
  "furniture",
  "pipe",
  "piping",
  "orgchart",
  "erase",
  "pan",
  "calibrate",
].map((id) => {
  if (id === "calibrate") return tool(id, { needsUnderlay: true });
  if (id === "furniture") return tool(id, { leftPalette: false });
  return tool(id);
});

const grouped = () => groupToolsByCategory(TOOL_DEFS);

const queryCategoryHeader = (container, label) =>
  container.querySelector(`button[aria-label$="${label} tools"]`);

const queryToolButton = (container, id) =>
  Array.from(container.querySelectorAll("button")).find(
    (b) => !b.hasAttribute("aria-expanded") && !b.hasAttribute("aria-pressed") && b.textContent.trim() === id
  );

const queryFavoriteToggle = (container, id) =>
  container.querySelector(`button[aria-label$="${id} to favorites"], button[aria-label$="${id} from favorites"]`);

const queryPinnedToolButtons = (container) =>
  Array.from(container.querySelectorAll("nav > div.group")).slice(0, 3).map(
    (wrapper) => wrapper.querySelector("button")
  );

describe("ToolPalette (collapsible Visio-style categories)", () => {
  let container;
  let root;

  const renderPalette = async (props = {}) => {
    await act(async () => {
      root.render(
        <ToolPalette
          grouped={grouped()}
          activeToolId="select"
          hasUnderlay={false}
          onSelect={() => {}}
          {...props}
        />
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

  it("keeps Select, Erase and Pan pinned above the categories", async () => {
    await renderPalette();
    const buttons = queryPinnedToolButtons(container);
    expect(buttons.map((b) => b.textContent.trim())).toEqual(["select", "erase", "pan"]);
  });

  it("does not render furniture in the left palette (it stays in the right panel)", async () => {
    await renderPalette();
    expect(queryToolButton(container, "furniture")).toBeUndefined();
    // No button anywhere in the palette mentions furniture.
    const labels = Array.from(container.querySelectorAll("button")).map((b) =>
      b.textContent.trim()
    );
    expect(labels).not.toContain("furniture");
  });

  it("hides the Favorites category until a tool is starred", async () => {
    await renderPalette();
    expect(queryCategoryHeader(container, "Favorites")).toBeNull();
  });

  it("starring a tool creates a Favorites category above the stencil groups", async () => {
    await renderPalette();
    await act(async () => {
      queryFavoriteToggle(container, "wall").click();
    });
    const favoritesHeader = queryCategoryHeader(container, "Favorites");
    expect(favoritesHeader).not.toBeNull();
    expect(favoritesHeader.getAttribute("aria-expanded")).toBe("true");
    // Favorites renders before House in the nav.
    const headers = Array.from(
      container.querySelectorAll('button[aria-label$="tools"]')
    ).map((b) => b.getAttribute("aria-label"));
    expect(headers[0]).toMatch(/Favorites/);
    expect(headers[1]).toMatch(/House/);
    // The starred tool appears in Favorites and still in its home category.
    expect(window.localStorage.getItem(FAVORITE_STORAGE_KEY)).toContain('"wall"');
  });

  it("un-starring the last favorite removes the Favorites category", async () => {
    await renderPalette();
    await act(async () => {
      queryFavoriteToggle(container, "pipe").click();
    });
    expect(queryCategoryHeader(container, "Favorites")).not.toBeNull();
    await act(async () => {
      queryFavoriteToggle(container, "pipe").click();
    });
    expect(queryCategoryHeader(container, "Favorites")).toBeNull();
    expect(window.localStorage.getItem(FAVORITE_STORAGE_KEY)).toBe("[]");
  });

  it("star toggle does not select the tool", async () => {
    const onSelect = vi.fn();
    await renderPalette({ onSelect });
    await act(async () => {
      queryFavoriteToggle(container, "wall").click();
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("restores favorites across remounts and ignores stale ids", async () => {
    window.localStorage.setItem(FAVORITE_STORAGE_KEY, JSON.stringify(["wall", "gone-tool"]));
    await renderPalette();
    const favoritesHeader = queryCategoryHeader(container, "Favorites");
    expect(favoritesHeader).not.toBeNull();
    // Only the still-existing tool renders in Favorites.
    const favoritesSection = favoritesHeader.parentElement;
    expect(favoritesSection.textContent).toContain("wall");
    expect(favoritesSection.textContent).not.toContain("gone-tool");
  });

  it("falls back to no favorites when stored data is corrupt", async () => {
    window.localStorage.setItem(FAVORITE_STORAGE_KEY, "not-json{{{");
    await renderPalette();
    expect(queryCategoryHeader(container, "Favorites")).toBeNull();
  });

  it("renders House, Mechanical and Plan categories expanded by default", async () => {
    await renderPalette();
    for (const label of ["House", "Mechanical", "Plan"]) {
      const header = queryCategoryHeader(container, label);
      expect(header).not.toBeNull();
      expect(header.getAttribute("aria-expanded")).toBe("true");
    }
    // Representative tools are visible.
    expect(queryToolButton(container, "room")).not.toBeNull();
    expect(queryToolButton(container, "pipe")).not.toBeNull();
    expect(queryToolButton(container, "orgchart")).not.toBeNull();
  });

  it("hides the empty Process category until process tools exist", async () => {
    await renderPalette();
    expect(queryCategoryHeader(container, "Process")).toBeNull();
  });

  it("collapses a category on header click and leaves others open", async () => {
    await renderPalette();
    await act(async () => {
      queryCategoryHeader(container, "House").click();
    });
    expect(queryCategoryHeader(container, "House").getAttribute("aria-expanded")).toBe("false");
    expect(queryToolButton(container, "room")).toBeUndefined();
    // Other categories are untouched.
    expect(queryCategoryHeader(container, "Mechanical").getAttribute("aria-expanded")).toBe("true");
    expect(queryToolButton(container, "pipe")).not.toBeNull();
    // Pinned tools stay visible regardless.
    expect(queryToolButton(container, "select")).not.toBeNull();
  });

  it("re-expands a collapsed category on a second click", async () => {
    await renderPalette();
    await act(async () => {
      queryCategoryHeader(container, "Mechanical").click();
    });
    expect(queryToolButton(container, "pipe")).toBeUndefined();
    await act(async () => {
      queryCategoryHeader(container, "Mechanical").click();
    });
    expect(queryCategoryHeader(container, "Mechanical").getAttribute("aria-expanded")).toBe("true");
    expect(queryToolButton(container, "pipe")).not.toBeNull();
  });

  it("persists collapsed state across remounts", async () => {
    await renderPalette();
    await act(async () => {
      queryCategoryHeader(container, "House").click();
    });
    expect(window.localStorage.getItem(COLLAPSED_STORAGE_KEY)).toContain('"house":true');

    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    await renderPalette();

    expect(queryCategoryHeader(container, "House").getAttribute("aria-expanded")).toBe("false");
    expect(queryToolButton(container, "room")).toBeUndefined();
    expect(queryCategoryHeader(container, "Mechanical").getAttribute("aria-expanded")).toBe("true");
  });

  it("falls back to all-expanded when stored state is corrupt", async () => {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, "not-json{{{");
    await renderPalette();
    for (const label of ["House", "Mechanical", "Plan"]) {
      expect(queryCategoryHeader(container, label).getAttribute("aria-expanded")).toBe("true");
    }
  });

  it("marks the active tool and dispatches SET_TOOL through onSelect", async () => {
    const onSelect = vi.fn();
    await renderPalette({ onSelect, activeToolId: "wall" });
    const wallButton = queryToolButton(container, "wall");
    expect(wallButton.className).toMatch(/bg-emerald-600/);
    await act(async () => {
      queryToolButton(container, "door").click();
    });
    expect(onSelect).toHaveBeenCalledWith("door");
  });

  it("disables the calibrate tool when there is no background underlay", async () => {
    await renderPalette({ hasUnderlay: false });
    const calibrate = queryToolButton(container, "calibrate");
    expect(calibrate.disabled).toBe(true);
    expect(calibrate.getAttribute("title")).toBe("Import a background image first");
  });

  it("enables the calibrate tool when a background underlay exists", async () => {
    await renderPalette({ hasUnderlay: true });
    expect(queryToolButton(container, "calibrate").disabled).toBe(false);
  });
});
