// uprightLabels.test.jsx — names and tags stay readable when a piece is
// turned past 90 degrees (flipped 180 about their own anchor).

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getCatalogEntry } from "@/domains/roomDesigner/furnitureCatalog";
import { findSymbol } from "@/domains/roomDesigner/symbolRegistry";
import "@/domains/roomDesigner/processEquipmentCatalog";
import "@/domains/roomDesigner/pipingCatalog";
import {
  drawDefaultSymbol,
  drawFurnitureSymbol,
  drawProcessEquipmentSymbol,
  renderSymbol2D,
  uprightTextTransform,
} from "./symbolDrawRoutines";

const ctx = { toScreen: (p) => p, scale: 1, highlighted: false };
const svg = (node) => renderToStaticMarkup(<svg>{node}</svg>);
const flips = (markup) => (markup.match(/transform="rotate\(180 /g) || []).length;

describe("uprightTextTransform", () => {
  it("flips text only for rotations past 90 up to 270 degrees", () => {
    for (const r of [0, 45, 90, 360, 405, -45, -270]) expect(uprightTextTransform(r, 0, 10), String(r)).toBeUndefined();
    for (const r of [135, 180, 225, 270, -135, -180, 540]) expect(uprightTextTransform(r, 0, 10), String(r)).toBe("rotate(180 0 10)");
    expect(uprightTextTransform(undefined, 0, 0)).toBeUndefined();
  });
});

describe("labels on placed pieces", () => {
  const furniture = (rotationDeg) =>
    svg(drawFurnitureSymbol({ symbol: getCatalogEntry("sofa-3seat"), instance: { id: "f", catalogId: "sofa-3seat", x: 0, y: 0, rotationDeg }, ...ctx }));

  it("furniture name reads upright at 180 and 270, unchanged at 0 and 90", () => {
    expect(flips(furniture(0))).toBe(0);
    expect(flips(furniture(90))).toBe(0);
    expect(flips(furniture(180))).toBe(1);
    expect(flips(furniture(270))).toBe(1);
    expect(furniture(180)).toContain("Sofa (3-seat)");
  });

  it("process equipment tag and name both flip at 180", () => {
    const pump = findSymbol("processEquipment", "centrifugal-pump");
    const m = svg(drawProcessEquipmentSymbol({ symbol: pump, instance: { id: "p", x: 0, y: 0, rotationDeg: 180, tag: "P-101" }, ...ctx }));
    expect(flips(m)).toBe(2);
    const upright = svg(drawProcessEquipmentSymbol({ symbol: pump, instance: { id: "p", x: 0, y: 0, rotationDeg: 0, tag: "P-101" }, ...ctx }));
    expect(flips(upright)).toBe(0);
  });

  it("TEMA exchanger tag and label flip at 180", () => {
    const hx = findSymbol("processEquipment", "tema-exchanger");
    const m = svg(drawProcessEquipmentSymbol({ symbol: hx, instance: { id: "e", x: 0, y: 0, rotationDeg: 180, tag: "E-101" }, ...ctx }));
    expect(flips(m)).toBeGreaterThanOrEqual(2);
  });

  it("piping tag bubbles and the default fallback flip too", () => {
    const tagged = svg(renderSymbol2D("piping", "equipment-tag", { id: "t", x: 0, y: 0, rotationDeg: 180, tag: "P-101" }, ctx));
    expect(tagged).toContain("P-101");
    expect(flips(tagged)).toBeGreaterThanOrEqual(1);
    const fallback = svg(drawDefaultSymbol({ symbol: { id: "x", label: "Thing", widthIn: 24, depthIn: 24 }, instance: { id: "x", x: 0, y: 0, rotationDeg: 225 }, ...ctx }));
    expect(flips(fallback)).toBe(1);
  });
});
