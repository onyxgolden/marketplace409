// @vitest-environment jsdom

// Crosshair HUD regression (PR #828 fix round 1, ChatGPT NEEDS CHANGES P1):
// the phone Slice 5 follow-up's HUD classification (data-hud="crosshair")
// dropped the vertical crosshair line — only the horizontal line rendered,
// at every viewport including desktop. Both axes must render inside the
// classified HUD group.
//
// The pre-existing pinchRaf crosshairX assertions caught the vertical
// line's absence indirectly (first #7dd3fc line's x1 must equal the
// cursor x — it read 0, the horizontal line's x1, on the broken head).
// This test pins both axes explicitly, by geometry, so a one-axis
// regression fails by name instead of by coincidence.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import PlanCanvas from "./PlanCanvas";
import { createEmptyDesign } from "@/domains/roomDesigner/designerDocument";

// PlanCanvas uses a ResizeObserver for its wrapper size; jsdom has none.
if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

describe("PlanCanvas crosshair HUD axes (PR #828 fix round 1)", () => {
  let container;
  let root;
  let svg;

  const renderCanvas = () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <PlanCanvas design={createEmptyDesign()} tool="select" selection={null} dispatch={vi.fn()} />,
      );
    });
    svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  };

  // jsdom reports clientWidth/Height as 0, which suppresses the crosshair
  // HUD (renderCrosshair returns null when w or h < 80); shadow them just
  // long enough to observe it. (Same harness as PlanCanvas.pinchRaf.test.jsx.)
  const withViewport = (fn) => {
    const proto = window.HTMLElement.prototype;
    Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => 1200 });
    Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => 800 });
    try {
      fn();
    } finally {
      delete proto.clientWidth;
      delete proto.clientHeight;
    }
  };

  // clientX/Y map 1:1 to svg coords in jsdom (getBoundingClientRect is zeros).
  const mouseMove = (x, y) => {
    act(() => {
      svg.dispatchEvent(
        new window.PointerEvent("pointermove", {
          bubbles: true,
          button: 0,
          pointerId: 1,
          pointerType: "mouse",
          clientX: x,
          clientY: y,
        }),
      );
    });
  };

  afterEach(() => {
    if (root) act(() => root.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  it("renders both crosshair axes inside the classified HUD group", () => {
    withViewport(() => {
      renderCanvas();
      mouseMove(400, 300);
      const hud = svg.querySelector('g[data-hud="crosshair"]');
      expect(hud).not.toBeNull();
      const lines = [...hud.querySelectorAll('line[stroke="#7dd3fc"]')];
      expect(lines).toHaveLength(2);
      const [vertical, horizontal] = lines;
      // Vertical axis: full-height line through the cursor x.
      expect(vertical.getAttribute("x1")).toBe("400");
      expect(vertical.getAttribute("x2")).toBe("400");
      expect(vertical.getAttribute("y1")).toBe("0");
      expect(vertical.getAttribute("y2")).toBe("800");
      // Horizontal axis: full-width line through the cursor y.
      expect(horizontal.getAttribute("x1")).toBe("0");
      expect(horizontal.getAttribute("x2")).toBe("1200");
      expect(horizontal.getAttribute("y1")).toBe("300");
      expect(horizontal.getAttribute("y2")).toBe("300");
    });
  });

  it("renders no crosshair HUD before any pointer move", () => {
    withViewport(() => {
      renderCanvas();
      expect(svg.querySelector('g[data-hud="crosshair"]')).toBeNull();
    });
  });
});
