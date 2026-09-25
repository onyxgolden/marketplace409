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
  "door",
  "window",
  "room-living-room",
  "room-bedroom",
  "room-bedroom-small",
  "room-bedroom-12x14",
  "room-kitchen",
  "room-kitchen-12x14",
  "room-dining-room",
  "room-master-bedroom",
  "room-bathroom",
  "room-bathroom-small",
  "room-garage",
  "room-office",
  "structure-container-20",
  "structure-container-40",
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
    (b) =>
      !b.hasAttribute("aria-expanded") &&
      !/favorites$/.test(b.getAttribute("aria-label") || "") &&
      b.textContent.trim() === id
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

  it("renders House, Rooms, Structures, Mechanical and Plan categories expanded by default", async () => {
    await renderPalette();
    for (const label of ["House", "Rooms", "Structures", "Mechanical", "Plan"]) {
      const header = queryCategoryHeader(container, label);
      expect(header).not.toBeNull();
      expect(header.getAttribute("aria-expanded")).toBe("true");
    }
    // Representative tools are visible.
    expect(queryToolButton(container, "room-bedroom")).not.toBeNull();
    expect(queryToolButton(container, "structure-container-40")).not.toBeNull();
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
    expect(queryToolButton(container, "wall")).toBeUndefined();
    // Room presets live in their own Rooms category now, not House.
    expect(queryToolButton(container, "room-bedroom")).not.toBeNull();
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
    expect(queryToolButton(container, "wall")).toBeUndefined();
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

  it("exposes the active tool to assistive tech via aria-pressed", async () => {
    await renderPalette({ activeToolId: "wall" });
    expect(queryToolButton(container, "wall").getAttribute("aria-pressed")).toBe("true");
    expect(queryToolButton(container, "door").getAttribute("aria-pressed")).toBe("false");
  });

  it("treats valid-JSON wrong-typed collapse values as expanded", async () => {
    window.localStorage.setItem(
      COLLAPSED_STORAGE_KEY,
      JSON.stringify({ house: "false", mechanical: 0, plan: {} })
    );
    await renderPalette();
    for (const label of ["House", "Mechanical", "Plan"]) {
      expect(queryCategoryHeader(container, label).getAttribute("aria-expanded")).toBe("true");
    }
  });

  it("associates the disabled calibrate reason as accessible text", async () => {
    await renderPalette({ hasUnderlay: false });
    const calibrate = queryToolButton(container, "calibrate");
    const describedBy = calibrate.getAttribute("aria-describedby");
    expect(describedBy).toBe("calibrate-disabled-reason");
    const reason = document.getElementById(describedBy);
    expect(reason).not.toBeNull();
    expect(reason.textContent).toMatch(/background image/i);
  });
});

describe("ToolPalette (external favorites)", () => {
  let container;
  let root;

  const customTool = (id, favorite) => tool(id, { favorite });

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

  it("shows a tool as favorited from the external map, not the palette's own list", async () => {
    const externalFavorites = new Map([["custom-shape-a", true]]);
    const customGrouped = groupToolsByCategory([
      ...TOOL_DEFS,
      customTool("custom-shape-a", true),
    ], [
      { id: "custom", label: "My shapes", toolIds: ["custom-shape-a"] },
    ]);
    await act(async () => {
      root.render(
        <ToolPalette
          grouped={customGrouped}
          activeToolId="select"
          hasUnderlay={false}
          onSelect={() => {}}
          externalFavorites={externalFavorites}
          onToggleExternalFavorite={() => {}}
        />
      );
    });
    // An externally-owned favorite (a custom shape) is NOT duplicated into
    // the generic Favorites category — the screen's favoritesSection shows
    // favorite shapes in their own ordered section...
    expect(queryCategoryHeader(container, "Favorites")).toBeNull();
    expect(container.textContent).toContain("custom-shape-a");
    // ...but its star in My shapes still renders as filled (aria-pressed true).
    const star = queryFavoriteToggle(container, "custom-shape-a");
    expect(star.getAttribute("aria-pressed")).toBe("true");
  });

  it("calls onToggleExternalFavorite instead of touching localStorage for an external tool", async () => {
    const externalFavorites = new Map([["custom-shape-a", false]]);
    const onToggle = vi.fn();
    const customGrouped = groupToolsByCategory([
      ...TOOL_DEFS,
      customTool("custom-shape-a", false),
    ], [
      { id: "custom", label: "My shapes", toolIds: ["custom-shape-a"] },
    ]);
    await act(async () => {
      root.render(
        <ToolPalette
          grouped={customGrouped}
          activeToolId="select"
          hasUnderlay={false}
          onSelect={() => {}}
          externalFavorites={externalFavorites}
          onToggleExternalFavorite={onToggle}
        />
      );
    });
    const star = queryFavoriteToggle(container, "custom-shape-a");
    await act(async () => {
      star.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(onToggle).toHaveBeenCalledWith("custom-shape-a");
    // Toggling an externally-owned favorite must never ADD it to the
    // palette's own favorite-tool-ids list — the shape record is the only
    // source of truth for its starred state. (The palette still persists its
    // own, unrelated favoriteIds state on mount, which is fine.)
    expect(JSON.parse(window.localStorage.getItem(FAVORITE_STORAGE_KEY) || "[]")).not.toContain(
      "custom-shape-a",
    );
  });

  it("leaves ordinary tools on the palette's own favorites list unaffected", async () => {
    window.localStorage.setItem(FAVORITE_STORAGE_KEY, JSON.stringify(["wall"]));
    const externalFavorites = new Map([["custom-shape-a", false]]);
    const customGrouped = groupToolsByCategory([
      ...TOOL_DEFS,
      customTool("custom-shape-a", false),
    ], [
      { id: "custom", label: "My shapes", toolIds: ["custom-shape-a"] },
    ]);
    await act(async () => {
      root.render(
        <ToolPalette
          grouped={customGrouped}
          activeToolId="select"
          hasUnderlay={false}
          onSelect={() => {}}
          externalFavorites={externalFavorites}
          onToggleExternalFavorite={() => {}}
        />
      );
    });
    const wallStar = queryFavoriteToggle(container, "wall");
    expect(wallStar.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      wallStar.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    // Unstarred ordinary tool -> palette's own storage updates as usual.
    expect(JSON.parse(window.localStorage.getItem(FAVORITE_STORAGE_KEY))).toEqual([]);
  });

  it("behaves exactly as before when no external favorites are given", async () => {
    await renderPalette();
    const star = queryFavoriteToggle(container, "wall");
    await act(async () => {
      star.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(JSON.parse(window.localStorage.getItem(FAVORITE_STORAGE_KEY))).toEqual(["wall"]);
  });
});

describe("ToolPalette (favoritesSection slot)", () => {
  it("renders the favorites section right after the pinned tools", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ToolPalette
          grouped={groupToolsByCategory(TOOL_DEFS)}
          activeToolId="select"
          hasUnderlay={false}
          onSelect={() => {}}
          favoritesSection={<section data-testid="fav-slot">favs</section>}
        />
      );
    });
    const nav = container.querySelector("nav");
    const slot = container.querySelector('[data-testid="fav-slot"]');
    const children = [...nav.children];
    const firstCategory = children.findIndex((el) => el.querySelector?.("[aria-expanded]") && el !== slot);
    expect(children.indexOf(slot)).toBeGreaterThan(-1);
    expect(children.indexOf(slot)).toBeLessThan(firstCategory);
    await act(async () => root.unmount());
    container.remove();
  });
});
