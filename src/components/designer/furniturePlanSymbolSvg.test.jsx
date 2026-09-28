// furniturePlanSymbolSvg.test.jsx — plan symbols on the canvas and in print.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getCatalogEntry } from "@/domains/roomDesigner/furnitureCatalog";
import { renderPlanSymbol, PLAN_SYMBOL_PALETTES } from "./furniturePlanSymbolSvg";
import { drawFurnitureSymbol } from "./symbolDrawRoutines";

const ctx = { toScreen: (p) => p, scale: 2, highlighted: false };
const draw = (catalogId, extra = {}) =>
  renderToStaticMarkup(
    <svg>
      {drawFurnitureSymbol({ symbol: getCatalogEntry(catalogId), instance: { id: "f1", catalogId, x: 0, y: 0, rotationDeg: 0, ...extra }, ...ctx })}
    </svg>,
  );

describe("drawFurnitureSymbol with plan symbols", () => {
  it("draws a queen bed as a bed (pillows, sheet), not a labelled box", () => {
    const m = draw("bed-queen");
    expect(m).toContain('data-plan-symbol="bed-queen"');
    expect((m.match(/data-role="pillow"/g) || []).length).toBe(2);
    expect(m).toContain('data-role="sheet-fold"');
    expect(m).toContain("Queen bed"); // the label is still there
  });

  it("follows rotation and per-piece size", () => {
    const m = draw("bathtub", { rotationDeg: 90, widthIn: 66 });
    expect(m).toContain("rotate(90)");
    expect(m).toContain('width="132"'); // 66 in x scale 2 (the shell)
  });

  it("keeps the existing rectangle drawing for pieces without a symbol", () => {
    const m = draw("sofa-3seat");
    expect(m).not.toContain("data-plan-symbol");
    expect(m).toContain('rx="3"');
    expect(m).toContain("Sofa (3-seat)");
  });

  it("marks the selection with the highlight stroke", () => {
    const m = renderToStaticMarkup(<svg>{drawFurnitureSymbol({ symbol: getCatalogEntry("toilet"), instance: { id: "t", catalogId: "toilet", x: 0, y: 0, rotationDeg: 0 }, ...ctx, highlighted: true })}</svg>);
    expect(m).toContain("#f59e0b");
  });
});

describe("renderPlanSymbol", () => {
  it("renders every primitive kind at the given scale", () => {
    const prims = [
      { kind: "rect", x: 0, y: 0, w: 2, h: 3, rx: 1, role: "shell" },
      { kind: "line", x1: 0, y1: 0, x2: 1, y2: 0, role: "sheet" },
      { kind: "poly", points: [[0, 0], [1, 0], [1, 1]], closed: true, role: "sheet-fold" },
      { kind: "circle", cx: 0, cy: 0, r: 1, role: "drain" },
      { kind: "ellipse", cx: 0, cy: 0, rx: 2, ry: 1, role: "bowl" },
    ];
    const m = renderToStaticMarkup(<svg>{renderPlanSymbol(prims, 3, PLAN_SYMBOL_PALETTES.screen({ color: "#9db8d8", stroke: "#374151" }))}</svg>);
    expect(m).toContain('width="6" height="9"');
    expect(m).toContain("<polygon");
    expect(m).toContain('r="3"');
    expect(m).toContain('rx="6" ry="3"');
  });

  it("has an ink palette for print (no screen fills)", () => {
    const ink = PLAN_SYMBOL_PALETTES.print({ ink: "#1a1a1a" });
    for (const role of ["frame", "pillow", "shell", "basin", "top", "seat"]) {
      expect(ink(role).stroke).toBe("#1a1a1a");
    }
  });
});
