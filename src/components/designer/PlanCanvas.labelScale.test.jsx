// @vitest-environment jsdom

// Scale-gated plan labels (FCCU label-overlap fix): at a fit-to-view
// scale the long "detail" labels (pipe/wall dimensions, equipment
// descriptions) hide and, lower still, the short equipment tags hide —
// so the FCCU central cluster stops rendering as an unreadable pile.
// The SYSTEMS legend collapses by default on narrow (phone) canvases
// and opens on tap. Labels return as the user zooms in. Thresholds are
// sized from the FCCU sample's measured fit scales: desktop 1400x800 =
// 0.139, phone 390x700 = 0.0445 (bounds 7680x5064 in); detail hides
// below 0.25, tags below 0.09; interactive zoom never goes below 0.35,
// so normal working zoom is unchanged.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import PlanCanvas from "./PlanCanvas";
import {
  addPipeRun,
  addWall,
  createEmptyDesign,
  placeSymbol,
} from "@/domains/roomDesigner/designerDocument";
import {
  addSystem,
  setMemberSystem,
} from "@/domains/roomDesigner/designSystems";

// PlanCanvas measures its wrapper via clientWidth/clientHeight (read once
// in an effect) and a ResizeObserver callback. jsdom reports 0 for every
// element, so both are stubbed: the size comes from a mutable mock the
// tests set before rendering, and ResizeObserver callbacks are captured
// so a test can fire a "resize" by hand.
let mockSize = { w: 0, h: 0 };
const roCallbacks = [];
window.ResizeObserver = class {
  constructor(cb) {
    roCallbacks.push(cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
};
const widthDesc = Object.getOwnPropertyDescriptor(window.Element.prototype, "clientWidth");
const heightDesc = Object.getOwnPropertyDescriptor(window.Element.prototype, "clientHeight");
Object.defineProperty(window.Element.prototype, "clientWidth", {
  configurable: true,
  get() {
    return mockSize.w;
  },
});
Object.defineProperty(window.Element.prototype, "clientHeight", {
  configurable: true,
  get() {
    return mockSize.h;
  },
});
afterAll(() => {
  if (widthDesc) Object.defineProperty(window.Element.prototype, "clientWidth", widthDesc);
  else delete window.Element.prototype.clientWidth;
  if (heightDesc) Object.defineProperty(window.Element.prototype, "clientHeight", heightDesc);
  else delete window.Element.prototype.clientHeight;
});

// FCCU-like bounds: 7680 x 5064 in of content. A 1200-in pipe run
// (label "⌀6″"), a tagged pump ("P-101" / "Centrifugal pump"),
// and a system so the legend renders.
function largeDesign() {
  let d = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 7680, y: 0 });
  d = addWall(d, { x: 0, y: 5064 }, { x: 7680, y: 5064 });
  d = addPipeRun(d, [{ x: 0, y: 2500 }, { x: 1200, y: 2500 }], { id: "run1", diameterIn: 6 });
  d = placeSymbol(d, "processEquipment", "centrifugal-pump", 3000, 2500, { id: "p1", tag: "P-101" });
  d = addSystem(d, { name: "Cooling water", color: "#22c55e" });
  d = setMemberSystem(d, { kind: "pipe", id: "run1" }, "system_1");
  return d;
}

// <text> contents by (font-size, fill) — the four label kinds this fix
// gates each have a distinct pair:
//   pipe dimension: 11px #e0f2fe   | wall dimension: 12px #9ca3af
//   equipment tag:  11px #fde68a   | equipment description: 10px #9ca3af
function labelTexts(container, fontSize, fill) {
  return [...container.querySelectorAll("text")]
    .filter(
      (t) =>
        Number(t.getAttribute("font-size")) === fontSize && t.getAttribute("fill") === fill,
    )
    .map((t) => t.textContent);
}

// Joined label text for substring assertions (toContain on an array
// would demand an exact element match).
function labelText(container, fontSize, fill) {
  return labelTexts(container, fontSize, fill).join("\n");
}

describe("PlanCanvas scale-gated labels", () => {
  let container;
  let root;
  let dispatch;

  const renderCanvas = (design, props = {}) => {
    if (!root) {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      dispatch = vi.fn();
    }
    act(() => {
      root.render(
        <PlanCanvas
          design={design}
          tool="select"
          selection={null}
          dispatch={dispatch}
          {...props}
        />,
      );
    });
  };

  afterEach(() => {
    if (root) act(() => root.unmount());
    root = null;
    container?.remove();
    container = null;
    roCallbacks.length = 0;
    mockSize = { w: 0, h: 0 };
  });

  it("hides detail labels AND short tags at a phone fit (scale 0.0445)", () => {
    mockSize = { w: 390, h: 700 };
    renderCanvas(largeDesign(), { autoFitKey: "p1:level1" });
    expect(labelText(container, 11, "#e0f2fe")).not.toContain("⌀6″");
    expect(labelText(container, 12, "#9ca3af")).not.toContain("640' 0\"");
    expect(labelText(container, 11, "#fde68a")).not.toContain("P-101");
    expect(labelText(container, 10, "#9ca3af")).not.toContain("Centrifugal pump");
  });

  it("hides detail labels but keeps short tags at a desktop fit (scale 0.139)", () => {
    mockSize = { w: 1400, h: 800 };
    renderCanvas(largeDesign(), { autoFitKey: "p1:level1" });
    expect(labelText(container, 11, "#e0f2fe")).not.toContain("⌀6″");
    expect(labelText(container, 12, "#9ca3af")).not.toContain("640' 0\"");
    expect(labelText(container, 11, "#fde68a")).toContain("P-101");
    expect(labelText(container, 10, "#9ca3af")).not.toContain("Centrifugal pump");
  });

  it("shows every label at normal working zoom", () => {
    // A small design fits at ~4.6 on a desktop canvas — well above both
    // thresholds — so every label renders, exactly as today.
    mockSize = { w: 1200, h: 800 };
    let d = addWall(createEmptyDesign(), { x: 0, y: 0 }, { x: 240, y: 0 });
    d = addPipeRun(d, [{ x: 0, y: 120 }, { x: 120, y: 120 }], { id: "run1", diameterIn: 6 });
    d = placeSymbol(d, "processEquipment", "centrifugal-pump", 180, 60, { id: "p1", tag: "P-101" });
    d = addSystem(d, { name: "Cooling water", color: "#22c55e" });
    d = setMemberSystem(d, { kind: "pipe", id: "run1" }, "system_1");
    renderCanvas(d, { autoFitKey: "p1:level1" });
    expect(labelText(container, 11, "#e0f2fe")).toContain("⌀6″");
    expect(labelText(container, 12, "#9ca3af")).toContain("20' 0\"");
    expect(labelText(container, 11, "#fde68a")).toContain("P-101");
    expect(labelText(container, 10, "#9ca3af")).toContain("Centrifugal pump");
  });

  it("collapses the SYSTEMS legend by default on a phone canvas, and it opens on tap", () => {
    mockSize = { w: 390, h: 700 };
    renderCanvas(largeDesign(), { autoFitKey: "p1:level1" });
    expect(container.querySelector('[data-testid="systems-legend"]')).toBeNull();
    const toggle = container.querySelector('[data-testid="systems-legend-toggle"]');
    expect(toggle).not.toBeNull();
    act(() => {
      toggle.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    const legend = container.querySelector('[data-testid="systems-legend"]');
    expect(legend).not.toBeNull();
    expect(legend.textContent).toMatch(/Cooling water/);
  });

  it("keeps the SYSTEMS legend open by default on a desktop canvas", () => {
    mockSize = { w: 1400, h: 800 };
    renderCanvas(largeDesign(), { autoFitKey: "p1:level1" });
    const legend = container.querySelector('[data-testid="systems-legend"]');
    expect(legend).not.toBeNull();
    expect(legend.textContent).toMatch(/Cooling water/);
    expect(container.querySelector('[data-testid="systems-legend-toggle"]')).toBeNull();
  });

  it("brings the detail labels back when the user zooms in from a phone fit", () => {
    mockSize = { w: 390, h: 700 };
    renderCanvas(largeDesign(), { autoFitKey: "p1:level1" });
    expect(labelText(container, 11, "#e0f2fe")).not.toContain("⌀6″");
    const svg = container.querySelector("svg");
    // Fit scale 0.0445; each wheel-in multiplies by 1.12. Sixteen steps
    // reach ~0.27 — past the 0.25 detail threshold.
    for (let i = 0; i < 16; i += 1) {
      act(() => {
        svg.dispatchEvent(
          new window.WheelEvent("wheel", {
            bubbles: true,
            deltaY: -100,
            clientX: 195,
            clientY: 350,
          }),
        );
      });
    }
    expect(labelText(container, 11, "#e0f2fe")).toContain("⌀6″");
    expect(labelText(container, 11, "#fde68a")).toContain("P-101");
  });
});
