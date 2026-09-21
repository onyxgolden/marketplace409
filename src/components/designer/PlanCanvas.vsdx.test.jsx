// @vitest-environment jsdom

// PlanCanvas: VSDX annotation rendering — read-only paths/labels render in
// the annotation layer; the empty-canvas state accounts for annotations.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach } from "vitest";
import PlanCanvas from "./PlanCanvas";
import { createEmptyDesign } from "@/domains/roomDesigner/designerDocument";

if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

describe("PlanCanvas VSDX annotations", () => {
  let container;
  let root;

  const renderCanvas = (design) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <PlanCanvas design={design} tool="select" selection={null} dispatch={vi.fn()} />,
      );
    });
    return container.querySelector("svg");
  };

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const designWithAnnotations = () => {
    const design = createEmptyDesign();
    design.annotations = [
      {
        id: "a1",
        kind: "path",
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      },
      {
        id: "a2",
        kind: "label",
        points: [{ x: 5, y: 5 }],
        text: "Imported note",
      },
    ];
    return design;
  };

  it("renders annotation paths as dashed strokes and labels as text", () => {
    const svg = renderCanvas(designWithAnnotations());
    const paths = svg.querySelectorAll('path[stroke-dasharray="7 5"]');
    expect(paths.length).toBe(1);
    const texts = [...svg.querySelectorAll("text")].filter((t) =>
      t.textContent.includes("Imported note"),
    );
    expect(texts.length).toBe(1);
  });

  it("renders nothing annotation-like on an empty design", () => {
    const svg = renderCanvas(createEmptyDesign());
    expect(svg.querySelectorAll('path[stroke-dasharray="7 5"]').length).toBe(0);
  });

  it("annotation layer is non-interactive (pointer events disabled)", () => {
    const svg = renderCanvas(designWithAnnotations());
    const layer = svg.querySelector('g[pointer-events="none"]');
    expect(layer).not.toBeNull();
    expect(layer.querySelector('path[stroke-dasharray="7 5"]')).not.toBeNull();
  });
});
