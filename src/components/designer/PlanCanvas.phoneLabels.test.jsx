// @vitest-environment jsdom

// Phone label deconfliction (Phone Slice 5): on a phone-width pane the
// fit scale (~0.475 for the 720x360 walkthrough plan) stays above the
// 0.25 hide gate, so adjacent walls' fixed-size labels pile up. The
// PlanCanvas selector admits only labels whose rect sits inside the pane
// and collides with nothing already accepted — selected first, then
// longest span first. A withheld label is never lost: selecting its wall
// makes its label the one that shows, and the selection panel shows its
// length. Desktop panes render every label exactly as before.
//
// jsdom has no layout engine, so this test asserts counts/presence and
// the selected label's position (via the <text x> attribute); the
// Playwright geometry check measures real getBBox rects in Chromium and
// asserts zero intersections and zero outside-pane labels.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import PlanCanvas from "./PlanCanvas";
import { buildSlice5FixtureDesign } from "@/domains/roomDesigner/slice5FixtureDesign";
import { createEmptyDesign, addWall, addDeck, designStructuralBounds } from "@/domains/roomDesigner/designerDocument";

// PlanCanvas measures its wrapper via clientWidth/clientHeight and a
// ResizeObserver callback; jsdom reports 0 for both, so both are stubbed
// (same harness as PlanCanvas.phonefit.test.jsx).
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

// Dimension labels: 12px, fill #9ca3af (ruler ticks are 9px — excluded).
function dimensionLabels(container) {
  return [...container.querySelectorAll('text[fill="#9ca3af"]')].filter(
    (t) => t.getAttribute("font-size") === "12",
  );
}
function deckLabels(container) {
  return [...container.querySelectorAll('text[fill="#a0744a"]')];
}
const texts = (els) => els.map((el) => el.textContent);

describe("PlanCanvas phone label deconfliction", () => {
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
        <PlanCanvas design={design} tool="select" selection={null} dispatch={dispatch} {...props} />,
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

  it("withholds the colliding closet-stack labels on a phone pane (one 16' 0\" shows)", () => {
    mockSize = { w: 390, h: 700 };
    renderCanvas(buildSlice5FixtureDesign(), { autoFitKey: "p1:level1" });
    const labels = texts(dimensionLabels(container));
    expect(labels.filter((t) => t === "16' 0\"").length).toBe(1);
  });

  it("withholds both clipping Wood platform labels on a phone pane", () => {
    mockSize = { w: 390, h: 700 };
    renderCanvas(buildSlice5FixtureDesign(), { autoFitKey: "p1:level1" });
    expect(deckLabels(container).length).toBe(0);
  });

  it("keeps the non-colliding long labels on a phone pane (60' 0\" x2)", () => {
    mockSize = { w: 390, h: 700 };
    renderCanvas(buildSlice5FixtureDesign(), { autoFitKey: "p1:level1" });
    const labels = texts(dimensionLabels(container));
    expect(labels.filter((t) => t === "60' 0\"").length).toBe(2);
    expect(labels).toContain("12' 0\"");
    expect(labels).toContain("18' 0\"");
    expect(labels).toContain("14' 0\"");
    expect(labels.filter((t) => t === "7' 0\"").length).toBe(1);
    // The two 84" segments share a point, so their labels sit 84 plan
    // inches apart — but the conservative width estimate leaves only a
    // 2.7px gap between their padded boxes, so the selector withholds the
    // second (in inches display units the real labels are narrower and
    // both render — see the Chromium geometry check).
    expect(labels).not.toContain("6' 0\"");
    // The 72" segment's label is crowded the same way: in feet-inches
    // form it is wide enough to collide with the outer wall's "30' 0\""
    // label at the left edge, so the selector withholds it (the longer
    // span wins).
    // The 24" segment's label is withheld the same way in feet-inches
    // form: its padded estimate overlaps the first 192" label's padded
    // box by ~4px (the real glyphs would clear by ~13px). In inches
    // display units it renders at 430px (see the Chromium geometry
    // check) — the estimate is conservative by design.
    expect(labels).not.toContain("2' 0\"");
    // The 60" segment's label is the one genuinely crowded label: in
    // feet-inches form ("5' 0\"") it is wide enough to collide with the
    // outer wall's "30' 0\"" label at the left edge, so the selector
    // withholds it (the longer span wins) — exactly the deconfliction.
    expect(labels).not.toContain("5' 0\"");
  });

  it("shows the selected closet wall's label, not the first one's, when tapped", () => {
    mockSize = { w: 390, h: 700 };
    const design = buildSlice5FixtureDesign();
    renderCanvas(design, { autoFitKey: "p1:level1" });
    const unselected = dimensionLabels(container).filter((el) => el.textContent === "16' 0\"");
    expect(unselected.length).toBe(1);
    const firstX = Number(unselected[0].getAttribute("x"));
    const middle = design.walls.find((w) => w.a.x === 180 && w.a.y === 0);
    expect(middle).toBeDefined();
    renderCanvas(design, { autoFitKey: "p1:level1", selection: { kind: "wall", id: middle.id } });
    const labels = dimensionLabels(container).filter((el) => el.textContent === "16' 0\"");
    expect(labels.length).toBe(1);
    // One wall over (12 plan inches at the 0.475 fit scale): the visible
    // label moved from the first wall to the selected middle wall.
    expect(Number(labels[0].getAttribute("x"))).toBeCloseTo(firstX + 12 * 0.475, 0);
  });

  it("renders every label on a desktop pane (phone selector never runs)", () => {
    mockSize = { w: 1200, h: 800 };
    renderCanvas(buildSlice5FixtureDesign(), { autoFitKey: "p1:level1" });
    const labels = texts(dimensionLabels(container));
    expect(labels.filter((t) => t === "16' 0\"").length).toBe(3);
    expect(deckLabels(container).length).toBe(2);
    // And the desktop fit is the walls-only fit, byte-identical to
    // before the slice: scale min(1104/720, 704/360) = 1.533, so the top
    // wall lands at x 48..1152, y 124 — NOT the structural-bounds fit
    // (same scale here, but oy 68.8), which shrank the plan at 1919px
    // and collided the deck label with the 720" label there.
    const topWall = [...container.querySelectorAll("line")].find(
      (l) => l.getAttribute("stroke") === "#e5e7eb" && Number(l.getAttribute("y1")) === Number(l.getAttribute("y2")),
    );
    expect(Number(topWall.getAttribute("x1"))).toBeCloseTo(48, 0);
    expect(Number(topWall.getAttribute("x2"))).toBeCloseTo(1152, 0);
    expect(Number(topWall.getAttribute("y1"))).toBeCloseTo(124, 0);
  });
});

describe("designStructuralBounds", () => {
  it("unions deck outlines into the walls bounds (bottom deck extends past the walls)", () => {
    const design = buildSlice5FixtureDesign();
    const bounds = designStructuralBounds(design);
    expect(bounds).toEqual({ x: 0, y: 0, widthIn: 720, heightIn: 432 });
  });

  it("is the walls bounds when there are no decks", () => {
    let design = createEmptyDesign();
    design = addWall(design, { x: 0, y: 0 }, { x: 200, y: 100 });
    expect(designStructuralBounds(design)).toEqual({ x: 0, y: 0, widthIn: 200, heightIn: 100 });
  });

  it("returns the deck bounds when there are no walls", () => {
    let design = createEmptyDesign();
    design = addDeck(design, { x: 100, y: 50 }, { x: 300, y: 150 }, { material: "wood", dropIn: 4 });
    expect(designStructuralBounds(design)).toEqual({ x: 100, y: 50, widthIn: 200, heightIn: 100 });
  });

  it("returns null for an empty design", () => {
    expect(designStructuralBounds(createEmptyDesign())).toBeNull();
  });
});
