// @vitest-environment jsdom

// Phone layout: the tool palette collapses to an icon rail below md.
// Contract:
// - the palette nav is w-12 below md and w-28 at md+
// - tool labels are hidden below md (md:inline) — icons stay tappable
// - search + stencil categories live inside a `hidden md:contents` wrapper,
//   so phones get pinned tools only

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach } from "vitest";
import ToolPalette from "./ToolPalette";

const DummyIcon = () => null;

const grouped = {
  pinned: [
    { id: "select", label: "Select", hint: "Select things", icon: DummyIcon },
    { id: "pan", label: "Pan", hint: "Pan the view", icon: DummyIcon },
  ],
  categories: [
    {
      id: "house",
      label: "House",
      tools: [{ id: "room", label: "Room", hint: "Draw a room", icon: DummyIcon }],
    },
  ],
  ungrouped: [],
};

function renderPalette() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ToolPalette grouped={grouped} activeToolId="select" hasUnderlay={false} onSelect={vi.fn()} />
    );
  });
  return { container, root };
}

describe("ToolPalette phone layout", () => {
  let rendered;
  afterEach(() => {
    act(() => rendered.root.unmount());
    rendered.container.remove();
  });

  it("renders an icon rail below md and the full palette at md+", () => {
    rendered = renderPalette();
    const nav = rendered.container.querySelector('nav[aria-label="Tools"]');
    expect(nav).not.toBeNull();
    expect(nav.className).toContain("w-12");
    expect(nav.className).toContain("md:w-28");
  });

  it("hides tool labels below md while keeping the icon buttons", () => {
    rendered = renderPalette();
    // Pinned tool buttons exist (icons stay tappable on the rail).
    const buttons = Array.from(rendered.container.querySelectorAll("nav button"));
    expect(buttons.length).toBeGreaterThan(0);
    const selectButton = buttons.find((b) => b.textContent.includes("Select"));
    expect(selectButton).not.toBeUndefined();
    // Labels render inside an md-only span, never as bare button text.
    const labelSpans = rendered.container.querySelectorAll("nav span.hidden.md\\:inline");
    expect(labelSpans.length).toBeGreaterThan(0);
    expect(Array.from(labelSpans).map((s) => s.textContent)).toContain("Select");
  });

  it("keeps search and stencil categories out of the phone rail", () => {
    rendered = renderPalette();
    const search = rendered.container.querySelector('input[aria-label="Search shapes"]');
    expect(search).not.toBeNull();
    // Hidden below md via the md:contents wrapper.
    expect(search.closest("div.hidden")).not.toBeNull();
    // Category tools (e.g. the House stencil category) are not reachable on
    // the phone rail: the category toggle lives inside the hidden wrapper.
    const houseToggle = Array.from(rendered.container.querySelectorAll("nav button")).find(
      (b) => b.getAttribute("aria-label") === "Expand House tools"
    );
    expect(houseToggle).not.toBeUndefined();
    expect(houseToggle.closest("div.hidden")).not.toBeNull();
  });
});

describe("ToolPalette phone library drawer", () => {
  let container;
  let root;
  let onSelect;
  let toolsOpen;

  const renderDrawerPalette = (extraProps = {}) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onSelect = vi.fn();
    toolsOpen = false;
    const toggle = () => {
      toolsOpen = !toolsOpen;
      render();
    };
    function render() {
      act(() => {
        root.render(
          <ToolPalette
            grouped={grouped}
            activeToolId="select"
            hasUnderlay={false}
            onSelect={onSelect}
            mobileToolsOpen={toolsOpen}
            onToggleMobileTools={toggle}
            {...extraProps}
          />
        );
      });
    }
    render();
    return { toggle };
  };

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("opens the full library from the rail and selects a non-pinned tool", () => {
    const { toggle } = renderDrawerPalette();
    // The rail's "All tools" button toggles the drawer.
    const railButton = container.querySelector('nav > button[aria-label="All tools"]');
    expect(railButton).not.toBeNull();
    expect(railButton.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      railButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(toolsOpen).toBe(true);

    // The drawer hosts the full library: search + stencil categories.
    const dialog = container.querySelector('[role="dialog"][aria-label="All tools"]');
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector('input[aria-label="Search shapes"]')).not.toBeNull();

    // A non-pinned tool (Room, inside the collapsed House category) is
    // reachable: expand the category, then pick the tool.
    const expand = dialog.querySelector('button[aria-label="Expand House tools"]');
    expect(expand).not.toBeNull();
    act(() => {
      expand.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const roomButton = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === "Room"
    );
    expect(roomButton).not.toBeUndefined();
    act(() => {
      roomButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith("room");
    // Picking a tool from the drawer closes the drawer (one tap back to canvas).
    expect(toolsOpen).toBe(false);
    expect(container.querySelector('[role="dialog"][aria-label="All tools"]')).toBeNull();
    expect(toggle).toBeDefined();
  });

  it("closes the drawer when a furniture piece is armed from drawer search", () => {
    const onPickShape = vi.fn();
    renderDrawerPalette({ onPickShape });
    // Open the drawer from the rail.
    const railButton = container.querySelector('nav > button[aria-label="All tools"]');
    act(() => {
      railButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(toolsOpen).toBe(true);
    const dialog = container.querySelector('[role="dialog"][aria-label="All tools"]');
    expect(dialog).not.toBeNull();

    // Search for a furniture piece inside the drawer.
    const input = dialog.querySelector('input[aria-label="Search shapes"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "toilet");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const furnitureResult = Array.from(
      dialog.querySelectorAll('[data-testid="shape-search-result"]')
    ).find((r) => r.textContent.includes("Toilet"));
    expect(furnitureResult).toBeDefined();
    act(() => {
      furnitureResult.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // The furniture piece arms for placement…
    expect(onPickShape).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "catalog", domain: "furniture", id: "toilet" })
    );
    // …and the drawer closes (one tap back to the canvas).
    expect(toolsOpen).toBe(false);
    expect(container.querySelector('[role="dialog"][aria-label="All tools"]')).toBeNull();
  });

  it("does not render the library drawer until opened", () => {
    renderDrawerPalette();
    expect(container.querySelector('[role="dialog"][aria-label="All tools"]')).toBeNull();
  });

  it("shows tool names inside the drawer (labels stay responsive when docked)", () => {
    renderDrawerPalette();
    const railButton = container.querySelector('nav > button[aria-label="All tools"]');
    act(() => {
      railButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const dialog = container.querySelector('[role="dialog"][aria-label="All tools"]');
    const expand = dialog.querySelector('button[aria-label="Expand House tools"]');
    act(() => {
      expand.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Drawer copy: labels always visible (the drawer is always below md).
    const drawerLabels = Array.from(dialog.querySelectorAll("button span")).filter(
      (s) => s.textContent.trim() === "Room"
    );
    expect(drawerLabels.length).toBeGreaterThan(0);
    drawerLabels.forEach((s) => expect(s.className).not.toMatch(/(^|\s)hidden(\s|$)/));
    // Docked copy (md+): labels keep the responsive hidden-until-md treatment.
    const docked = container.querySelector("div.hidden.md\\:contents, div.hidden");
    const dockedLabels = Array.from(docked.querySelectorAll("button span")).filter(
      (s) => s.textContent.trim() === "Room"
    );
    expect(dockedLabels.length).toBeGreaterThan(0);
    dockedLabels.forEach((s) => expect(s.className).toMatch(/(^|\s)hidden(\s|$)/));
  });
});
