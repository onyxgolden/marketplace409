// designerReducerPdf.test.js — IMPORT_PDF_RESULT.
//
// Contract: one dispatch, one undo step, whichever mode the import used.
// A vector import appends native walls; a scanned import replaces the
// background underlay and drops any half-finished calibration clicks.

import { describe, expect, it } from "vitest";
import { createInitialState, designerReducer } from "./designerReducer";
import { createEmptyDesign, validateDesign } from "@/domains/roomDesigner/designerDocument";

const vectorResult = (walls) => ({
  mode: "vector",
  pageNumber: 1,
  records: {
    walls,
    rooms: [], openings: [], pipes: [], symbols: [], furniture: [], annotations: [],
  },
});

const rasterResult = () => ({
  mode: "raster",
  pageNumber: 2,
  image: {
    name: "scan.pdf — page 2",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
    widthPx: 3600,
    heightPx: 2400,
    pxPerIn: 100,
  },
});

const twoWalls = () => [
  { id: "pdf-p1-w1", a: { x: 0, y: 0 }, b: { x: 120, y: 0 }, source: { importer: "pdf" } },
  { id: "pdf-p1-w2", a: { x: 120, y: 0 }, b: { x: 120, y: 96 }, source: { importer: "pdf" } },
];

const start = () => createInitialState(createEmptyDesign("Plan"));

describe("IMPORT_PDF_RESULT — vector", () => {
  it("appends the imported walls as native design walls", () => {
    const next = designerReducer(start(), {
      type: "IMPORT_PDF_RESULT",
      importResult: vectorResult(twoWalls()),
    });
    expect(next.design.walls).toHaveLength(2);
    expect(next.design.walls[0].id).toBe("pdf-p1-w1");
    expect(next.design.annotations).toEqual([]);
    expect(validateDesign(next.design)).toEqual([]);
  });

  it("is a single undoable step that restores the design exactly", () => {
    const state = start();
    const imported = designerReducer(state, {
      type: "IMPORT_PDF_RESULT",
      importResult: vectorResult(twoWalls()),
    });
    expect(imported.past).toHaveLength(1);
    expect(imported.dirty).toBe(true);
    expect(imported.designRevision).toBe(state.designRevision + 1);

    const undone = designerReducer(imported, { type: "UNDO" });
    expect(undone.design.walls).toEqual([]);
    expect(undone.design).toEqual(state.design);
  });

  it("never mutates the previous design", () => {
    const state = start();
    const snapshot = JSON.stringify(state.design);
    designerReducer(state, { type: "IMPORT_PDF_RESULT", importResult: vectorResult(twoWalls()) });
    expect(JSON.stringify(state.design)).toBe(snapshot);
  });

  it("keeps existing geometry and de-collides repeated imports", () => {
    let state = designerReducer(start(), {
      type: "IMPORT_PDF_RESULT",
      importResult: vectorResult(twoWalls()),
    });
    state = designerReducer(state, {
      type: "IMPORT_PDF_RESULT",
      importResult: vectorResult(twoWalls()),
    });
    expect(state.design.walls).toHaveLength(4);
    expect(new Set(state.design.walls.map((w) => w.id)).size).toBe(4);
    expect(validateDesign(state.design)).toEqual([]);
  });

  it("defaults the arrays a pre-annotations document lacks", () => {
    const legacy = createInitialState({ ...createEmptyDesign("Old") });
    delete legacy.design.annotations;
    delete legacy.design.pipes;
    const next = designerReducer(legacy, {
      type: "IMPORT_PDF_RESULT",
      importResult: vectorResult(twoWalls()),
    });
    expect(next.design.annotations).toEqual([]);
    expect(next.design.pipes).toEqual([]);
  });
});

describe("IMPORT_PDF_RESULT — scanned", () => {
  it("sets the underlay at the scale the importer measured", () => {
    const next = designerReducer(start(), {
      type: "IMPORT_PDF_RESULT",
      importResult: rasterResult(),
    });
    expect(next.design.underlay).not.toBeNull();
    expect(next.design.underlay.pxPerIn).toBe(100);
    expect(next.design.underlay.widthPx).toBe(3600);
    // A scan adds no geometry.
    expect(next.design.walls).toEqual([]);
    expect(validateDesign(next.design)).toEqual([]);
  });

  it("discards in-progress calibration clicks, like SET_UNDERLAY does", () => {
    const state = { ...start(), calibration: { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } } };
    const next = designerReducer(state, {
      type: "IMPORT_PDF_RESULT",
      importResult: rasterResult(),
    });
    expect(next.calibration).toBeNull();
  });

  it("is a single undoable step", () => {
    const state = start();
    const next = designerReducer(state, { type: "IMPORT_PDF_RESULT", importResult: rasterResult() });
    expect(next.past).toHaveLength(1);
    const undone = designerReducer(next, { type: "UNDO" });
    expect(undone.design.underlay).toBeNull();
  });

  it("leaves the calibrate tool usable on the imported underlay", () => {
    let state = designerReducer(start(), { type: "IMPORT_PDF_RESULT", importResult: rasterResult() });
    state = designerReducer(state, { type: "SET_TOOL", tool: "calibrate" });
    state = designerReducer(state, { type: "ADD_CALIBRATION_POINT", point: { x: 0, y: 0 } });
    state = designerReducer(state, { type: "ADD_CALIBRATION_POINT", point: { x: 10, y: 0 } });
    state = designerReducer(state, { type: "APPLY_CALIBRATION", realDistanceIn: 120 });
    // Ten plan inches declared to be ten feet → the underlay rescales.
    expect(state.design.underlay.pxPerIn).toBeCloseTo((10 * 100) / 120, 9);
    expect(state.calibration).toBeNull();
    expect(state.tool).toBe("select");
  });
});

describe("IMPORT_PDF_RESULT — refusals", () => {
  it("ignores a missing or malformed result rather than corrupting the design", () => {
    const state = start();
    for (const importResult of [null, undefined, {}, { mode: "vector" }, { mode: "raster" }]) {
      expect(designerReducer(state, { type: "IMPORT_PDF_RESULT", importResult })).toBe(state);
    }
  });
});
