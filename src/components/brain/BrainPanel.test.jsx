import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import BrainPanel from "./BrainPanel.jsx";

describe("BrainPanel", () => {
  it("renders nothing when disabled", () => {
    expect(renderToStaticMarkup(React.createElement(BrainPanel, { enabled: false }))).toBe("");
  });

  it("renders a draggable icon button when enabled and collapsed", () => {
    const html = renderToStaticMarkup(
      React.createElement(BrainPanel, { enabled: true, initialCollapsed: true }),
    );
    expect(html).toContain('aria-label="Open Brain"');
    expect(html).toContain("left:92%");
    expect(html).toContain("top:85%");
  });

  it("renders the panel sections when enabled and expanded", () => {
    const html = renderToStaticMarkup(
      React.createElement(BrainPanel, {
        enabled: true,
        initialCollapsed: false,
        initialPosition: { x: 10, y: 20 },
      }),
    );
    expect(html).toContain('aria-label="Brain panel"');
    expect(html).toContain("History");
    expect(html).toContain("Memories");
    expect(html).toContain("left:10%");
  });
});
