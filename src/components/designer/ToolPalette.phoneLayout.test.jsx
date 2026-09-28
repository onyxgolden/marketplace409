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
