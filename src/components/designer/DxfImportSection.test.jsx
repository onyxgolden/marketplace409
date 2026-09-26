// @vitest-environment jsdom

// DxfImportSection — choose .dxf → units + layer roles with live preview → import.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as importer from "@/domains/roomDesigner/importers/dxf/dxfImporter";
import { createEmptyDesign, resetDesignerIds } from "@/domains/roomDesigner/designerDocument";
import { createInitialState, designerReducer } from "./designerReducer";
import DxfImportSection from "./DxfImportSection";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pairs = (...p) => p.flat().join("\n");
const line = (layer, x1, y1, x2, y2) => pairs(["0", "LINE", "8", layer, "10", x1, "20", y1, "11", x2, "21", y2]);
const DXF = pairs(
  ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "1", "0", "ENDSEC"],
  ["0", "SECTION", "2", "ENTITIES"],
  line("A-WALL", 0, 0, 40, 0), line("A-WALL", 76, 0, 120, 0), line("A-WALL", 0, 6, 40, 6), line("A-WALL", 76, 6, 120, 6),
  line("A-DOOR", 40, 0, 40, 6), line("A-DOOR", 76, 0, 76, 6),
  ["0", "ENDSEC", "0", "EOF"],
);

let container;
let root;
beforeEach(() => {
  resetDesignerIds();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const q = (sel) => container.querySelector(sel);
const byLabel = (l) => q(`[aria-label="${l}"]`);
async function choose(name, content) {
  const file = new File([content], name);
  file.arrayBuffer ??= async () => new TextEncoder().encode(content).buffer;
  const input = byLabel("Choose DXF file");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}
function select(el, value) {
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const counts = () => Object.fromEntries([...q('[aria-label="Import preview"]').querySelectorAll("div")].map((d) => [d.children[0].textContent, Number(d.children[1].textContent)]));

function render(dispatch = vi.fn(), design = createEmptyDesign("x")) {
  act(() => root.render(<DxfImportSection dispatch={dispatch} design={design} loadImporter={async () => importer} />));
  return dispatch;
}

describe("DxfImportSection", () => {
  it("explains how to handle a DWG", async () => {
    render();
    await choose("plan.dwg", "AC1032");
    expect(q('[role="alert"]').textContent).toMatch(/Save As \/ Export → DXF/);
  });

  it("previews walls and the door cut into its gap, then imports", async () => {
    const dispatch = render();
    await choose("plan.dxf", DXF);
    expect(byLabel("Role for layer A-WALL").value).toBe("walls");
    expect(byLabel("Role for layer A-DOOR").value).toBe("doors");
    expect(counts()).toMatchObject({ Walls: 1, "Doors & windows": 1 });
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Import plan").click());
    expect(dispatch.mock.calls[0][0]).toMatchObject({ type: "IMPORT_DXF_RESULT", importResult: { counts: { walls: 1, openings: 1 } } });
    expect(q('[role="status"]').textContent).toMatch(/1 walls, 1 doors\/windows/);
  });

  it("updates the preview live when a layer's role or the units change", async () => {
    render();
    await choose("plan.dxf", DXF);
    select(byLabel("Role for layer A-DOOR"), "annotation");
    expect(counts()).toMatchObject({ Walls: 2, "Doors & windows": 0 }); // no door → gap stays open
    expect(q('[data-testid="dxf-size"]').textContent).toBe(`Drawing size: 10' 0" × 0' 6"`);
    select(byLabel("Drawing units"), "cm");
    expect(q('[data-testid="dxf-size"]').textContent).toBe(`Drawing size: 3' 11" × 0' 2"`);
  });

  it("offers to match the design's wall thickness to the drawing's", async () => {
    const dispatch = render();
    await choose("plan.dxf", DXF);
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Use 6″").click());
    expect(dispatch).toHaveBeenCalledWith({ type: "UPDATE_SETTINGS", settings: { wallThicknessIn: 6 } });
  });
});

describe("IMPORT_DXF_RESULT", () => {
  it("merges the whole import as one undo step", () => {
    const prepared = importer.prepareDxfImport(importer.readDxfDrawing(DXF));
    let state = createInitialState(createEmptyDesign("x"));
    state = designerReducer(state, { type: "IMPORT_DXF_RESULT", importResult: prepared });
    expect(state.design.walls).toHaveLength(1);
    expect(state.design.openings).toHaveLength(1);
    state = designerReducer(state, { type: "UNDO" });
    expect(state.design.walls).toHaveLength(0);
  });
});
