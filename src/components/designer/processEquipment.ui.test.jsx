// @vitest-environment jsdom

// Process equipment in the UI: palette category, object library, glyphs,
// the reducer's OPEN_OBJECT_LIBRARY, and the equipment list section.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDesign, placeSymbol } from "@/domains/roomDesigner/designerDocument";
import { PROCESS_EQUIPMENT } from "@/domains/roomDesigner/processEquipmentCatalog";
import { groupToolsByCategory } from "@/domains/roomDesigner/designerToolbar";
import { autoTagFor } from "@/domains/roomDesigner/equipmentTags";
import { findSymbol } from "@/domains/roomDesigner/symbolRegistry";
import { createInitialState, designerReducer } from "./designerReducer";
import { renderSymbol2D } from "./symbolDrawRoutines";
import ObjectLibraryPanel from "./ObjectLibraryPanel";
import EquipmentScheduleSection from "./EquipmentScheduleSection";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const D = "processEquipment";
const withEquipment = (ids) =>
  ids.reduce((d, id) => placeSymbol(d, D, id, 50, 50, { tag: autoTagFor(d, D, id) }), createEmptyDesign("Plant"));

describe("palette", () => {
  it("shows a Process category holding the Equipment tool", () => {
    const tool = (id) => ({ id, label: id, icon: () => null });
    const { categories } = groupToolsByCategory([tool("select"), tool("process-equipment")]);
    expect(categories.find((c) => c.id === "process").tools.map((t) => t.id)).toEqual(["process-equipment"]);
  });
});

describe("OPEN_OBJECT_LIBRARY", () => {
  it("switches to the symbol tool on that domain without arming a symbol", () => {
    const state = designerReducer(createInitialState(), { type: "OPEN_OBJECT_LIBRARY", domain: D });
    expect(state).toMatchObject({ tool: "symbol", pendingSymbol: null, libraryDomain: D });
  });

  it("ignores an unknown domain", () => {
    const start = createInitialState();
    expect(designerReducer(start, { type: "OPEN_OBJECT_LIBRARY", domain: "nope" })).toBe(start);
  });
});

describe("object library on process equipment", () => {
  it("opens on the Process equipment domain and arms a pick", () => {
    const dispatch = vi.fn();
    act(() => root.render(<ObjectLibraryPanel dispatch={dispatch} pendingCatalogId={null} pendingSymbol={null} initialDomain={D} />));
    expect(container.querySelector('[aria-label="Object domain"]').value).toBe(D);
    const pump = [...container.querySelectorAll('[role="option"]')].find((b) => b.textContent.includes("Centrifugal pump"));
    act(() => pump.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_PENDING_SYMBOL", domain: D, symbolId: "centrifugal-pump" });
  });
});

describe("2D glyphs", () => {
  const toScreen = (p) => p;
  const draw = (id, instance = {}) =>
    renderToStaticMarkup(
      <svg>{renderSymbol2D(D, id, { id: "i1", x: 0, y: 0, rotationDeg: 0, ...instance }, { toScreen, scale: 1, highlighted: false })}</svg>,
    );

  it("gives every item its own glyph (never the placeholder rectangle)", () => {
    const fallback = draw("__missing__");
    const markups = PROCESS_EQUIPMENT.map((e) => draw(e.id));
    for (const [i, m] of markups.entries()) {
      expect(m, PROCESS_EQUIPMENT[i].id).not.toBe(fallback);
      expect(m).toContain(PROCESS_EQUIPMENT[i].label.replace(/&/g, "&amp;"));
    }
    // Glyph bodies differ from each other (labels stripped).
    const bodies = markups.map((m) => m.replace(/<text[\s\S]*?<\/text>/g, ""));
    expect(new Set(bodies).size).toBe(PROCESS_EQUIPMENT.length);
  });

  it("shows the equipment tag under the symbol", () => {
    expect(draw("centrifugal-pump", { tag: "P-101" })).toContain("P-101");
    expect(findSymbol(D, "pressure-gauge").tagPrefix).toBe("PI");
    expect(draw("pressure-gauge")).toContain(">PI<"); // ISA bubble carries its letter code
  });
});

describe("EquipmentScheduleSection", () => {
  it("renders nothing without process equipment", () => {
    act(() => root.render(<EquipmentScheduleSection design={createEmptyDesign()} dispatch={vi.fn()} />));
    expect(container.innerHTML).toBe("");
  });

  it("lists equipment by tag and selects a piece when its row is clicked", () => {
    const design = withEquipment(["vertical-vessel", "centrifugal-pump", "centrifugal-pump"]);
    const dispatch = vi.fn();
    act(() => root.render(<EquipmentScheduleSection design={design} dispatch={dispatch} />));
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows.map((r) => r.cells[0].textContent)).toEqual(["P-101", "P-102", "V-101"]);
    act(() => rows[2].click());
    expect(dispatch).toHaveBeenCalledWith({ type: "SELECT", selection: { kind: "symbol", id: design.symbols[0].id } });
  });
});
