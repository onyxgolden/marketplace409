// pdfImport.contract.test.js — the importer contract for the PDF slice.
//
// The review-mandated contract, mirroring the DXF export slice:
//   - prepare NEVER mutates the caller's design; commit is one pure merge;
//   - the result is deterministic for the same input and scale;
//   - a committed vector import leaves validateDesign clean and produces
//     NATIVE, editable walls (not read-only annotations);
//   - scale changes are re-derived purely, with no re-parse;
//   - .ai / .eps are refused at the boundary;
//   - everything runs locally: the pipeline never reaches for the network.
//
// pdf.js is stubbed, so this exercises the real pipeline (operator walking,
// coordinate boundary, flattening, scaling, classification, mapping, merge)
// without a browser.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __setPdfjsForTests,
  applyVectorScale,
  commitPdfImport,
  listPdfPages,
  preparePdfImport,
} from "./pdfImporter";
import { PdfImportError } from "./pdfErrors";
import {
  ARCH_D_PAGE,
  LETTER_PAGE,
  OPS,
  fakePdfjs,
  strokedPolyline,
  strokedRect,
  fakeCanvasFactory,
} from "./testUtils/pdfFixture";
import {
  createEmptyDesign,
  resetDesignerIds,
  validateDesign,
  deleteWall,
  moveWallEndpoint,
} from "../../designerDocument";

/**
 * A 24×18 foot rectangular cabin drawn at 1/4" = 1'-0" on a Letter sheet.
 * At that scale 24 feet of building is 6 paper inches = 432 points, and 18
 * feet is 4.5 paper inches = 324 points. Drawn from PDF (72,72).
 */
const CABIN_PAGE = {
  facts: LETTER_PAGE,
  entries: [
    [OPS.setLineWidth, [1]],
    strokedRect(72, 72, 432, 324),
  ],
};

/** A page with enough paths to read as vector, plus a dashed centerline. */
function densePage(pathCount = 40) {
  const entries = [];
  for (let i = 0; i < pathCount; i += 1) {
    entries.push(strokedPolyline([[72, 72 + i], [504, 72 + i]]));
  }
  entries.push([OPS.setDash, [[3, 2], 0]]);
  entries.push(strokedPolyline([[72, 500], [504, 500]]));
  entries.push([OPS.setDash, [[], 0]]);
  return { facts: LETTER_PAGE, entries };
}

/** A scanned page: one image, no meaningful vector content. */
const SCAN_PAGE = {
  facts: ARCH_D_PAGE,
  entries: [[OPS.paintImageXObject, ["img1"]]],
};

const bytes = () => new Uint8Array([1, 2, 3, 4]);

beforeEach(() => {
  resetDesignerIds();
});

afterEach(() => {
  __setPdfjsForTests(null);
});

describe("page survey", () => {
  it("reports each page's size, kind and content census", async () => {
    __setPdfjsForTests(fakePdfjs([CABIN_PAGE, SCAN_PAGE]));
    const { pageCount, pages } = await listPdfPages(bytes());
    expect(pageCount).toBe(2);
    // The cabin page is a single rectangle: real vector content, but too
    // little of it to call the page a drawing.
    expect(pages[0]).toMatchObject({ pageNumber: 1, widthIn: 8.5, heightIn: 11, kind: "sparse" });
    expect(pages[1]).toMatchObject({ pageNumber: 2, widthIn: 36, heightIn: 24, kind: "raster" });
    expect(pages[1].imageCount).toBe(1);
  });

  it("calls a path-dense page vector", async () => {
    __setPdfjsForTests(fakePdfjs([densePage()]));
    const { pages } = await listPdfPages(bytes());
    expect(pages[0].kind).toBe("vector");
    expect(pages[0].pathCount).toBe(41);
    expect(pages[0].segmentCount).toBe(41);
  });

  it("surfaces an unreadable page as unknown instead of failing the survey", async () => {
    __setPdfjsForTests(fakePdfjs([{ facts: LETTER_PAGE, operatorListError: "broken stream" }]));
    const { pages } = await listPdfPages(bytes());
    expect(pages[0].kind).toBe("unknown");
    expect(pages[0].kindReason).toMatch(/broken stream/);
  });

  it("reports the rotation the Designer will see", async () => {
    __setPdfjsForTests(fakePdfjs([{ facts: { ...LETTER_PAGE, rotation: 90 }, entries: [] }]));
    const { pages } = await listPdfPages(bytes());
    expect(pages[0]).toMatchObject({ rotation: 90, widthIn: 11, heightIn: 8.5 });
  });
});

describe("vector import geometry", () => {
  it("converts PDF points to plan inches through the Y-down boundary", async () => {
    __setPdfjsForTests(fakePdfjs([CABIN_PAGE]));
    const prepared = await preparePdfImport(bytes(), { pageNumber: 1, mode: "vector" });
    expect(prepared.mode).toBe("vector");
    // Paper-true: the rectangle is 6 × 4.5 paper inches.
    expect(prepared.paperBounds.width).toBeCloseTo(6, 6);
    expect(prepared.paperBounds.height).toBeCloseTo(4.5, 6);
    // PDF y=72 is one inch up from the bottom → 10 inches down in Designer space.
    expect(prepared.paperBounds.maxY).toBeCloseTo(10, 6);
    expect(prepared.paperBounds.minY).toBeCloseTo(5.5, 6);
  });

  it("produces four editable walls for a closed rectangle", async () => {
    __setPdfjsForTests(fakePdfjs([CABIN_PAGE]));
    const prepared = await preparePdfImport(bytes(), {
      pageNumber: 1, mode: "vector", scaleFactor: 48, minSegmentIn: 6,
    });
    expect(prepared.records.walls).toHaveLength(4);
    expect(prepared.records.annotations).toEqual([]);
  });

  it("is true to scale at the chosen plot scale", async () => {
    __setPdfjsForTests(fakePdfjs([CABIN_PAGE]));
    const prepared = await preparePdfImport(bytes(), {
      pageNumber: 1, mode: "vector", scaleFactor: 48,
    });
    // 6 paper inches × 48 = 288 inches = 24 feet.
    expect(prepared.bounds.width).toBeCloseTo(288, 4);
    expect(prepared.bounds.height).toBeCloseTo(216, 4);
    const lengths = prepared.records.walls
      .map((w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y))
      .sort((a, b) => a - b);
    expect(lengths).toEqual([216, 216, 288, 288].sort((a, b) => a - b).map((v) => expect.closeTo(v, 4)));
    expect(prepared.scale.label).toBe('1/4" = 1\'-0"');
  });

  it("excludes dashed drafting lines by default and includes them on request", async () => {
    __setPdfjsForTests(fakePdfjs([densePage(4)]));
    const withoutDashed = await preparePdfImport(bytes(), {
      pageNumber: 1, mode: "vector", scaleFactor: 48,
    });
    expect(withoutDashed.records.walls).toHaveLength(4);
    const withDashed = applyVectorScale(withoutDashed, { includeDashed: true });
    expect(withDashed.records.walls).toHaveLength(5);
  });

  it("notes when a page has no vector paths at all", async () => {
    __setPdfjsForTests(fakePdfjs([{ facts: LETTER_PAGE, entries: [] }]));
    const prepared = await preparePdfImport(bytes(), { pageNumber: 1, mode: "vector" });
    expect(prepared.records.walls).toEqual([]);
    expect(prepared.issues.some((i) => /No vector paths/.test(i.message))).toBe(true);
  });
});

describe("scale re-derivation", () => {
  it("re-scales a prepared import purely, with no re-parse", async () => {
    __setPdfjsForTests(fakePdfjs([CABIN_PAGE]));
    const paperTrue = await preparePdfImport(bytes(), { pageNumber: 1, mode: "vector", minSegmentIn: 1 });
    expect(paperTrue.bounds.width).toBeCloseTo(6, 6);

    // Swap pdf.js out entirely: re-scaling must not touch it.
    __setPdfjsForTests({ OPS, GlobalWorkerOptions: {}, getDocument: () => { throw new Error("must not re-parse"); } });
    const quarterInch = applyVectorScale(paperTrue, { scaleFactor: 48 });
    expect(quarterInch.bounds.width).toBeCloseTo(288, 4);
    const eighthInch = applyVectorScale(paperTrue, { scaleFactor: 96 });
    expect(eighthInch.bounds.width).toBeCloseTo(576, 4);
  });

  it("does not mutate the prepared import it re-scales", async () => {
    __setPdfjsForTests(fakePdfjs([CABIN_PAGE]));
    const prepared = await preparePdfImport(bytes(), { pageNumber: 1, mode: "vector", minSegmentIn: 1 });
    const before = JSON.stringify(prepared.paperPaths);
    const rescaled = applyVectorScale(prepared, { scaleFactor: 96 });
    expect(JSON.stringify(prepared.paperPaths)).toBe(before);
    expect(prepared.scale.factor).toBe(1);
    expect(rescaled.scale.factor).toBe(96);
  });

  it("anchors scaling at the drawing's own corner so it grows in place", async () => {
    __setPdfjsForTests(fakePdfjs([CABIN_PAGE]));
    const prepared = await preparePdfImport(bytes(), { pageNumber: 1, mode: "vector", minSegmentIn: 1 });
    const anchorX = prepared.paperBounds.minX;
    const anchorY = prepared.paperBounds.minY;
    const scaled = applyVectorScale(prepared, { scaleFactor: 48 });
    expect(scaled.bounds.minX).toBeCloseTo(anchorX, 6);
    expect(scaled.bounds.minY).toBeCloseTo(anchorY, 6);
  });

  it("refuses to re-scale a raster import", async () => {
    __setPdfjsForTests(fakePdfjs([SCAN_PAGE]));
    const prepared = await preparePdfImport(bytes(), {
      pageNumber: 1, mode: "raster", dpi: 96, createCanvas: fakeCanvasFactory({}),
    });
    expect(prepared.mode).toBe("raster");
    expect(() => applyVectorScale(prepared, { scaleFactor: 2 })).toThrow(PdfImportError);
    expect(() => applyVectorScale(prepared, { scaleFactor: 2 })).toThrow(/vector import/);
  });

  it("rejects an absurd scale factor", async () => {
    __setPdfjsForTests(fakePdfjs([CABIN_PAGE]));
    const prepared = await preparePdfImport(bytes(), { pageNumber: 1, mode: "vector" });
    expect(() => applyVectorScale(prepared, { scaleFactor: 1e9 })).toThrow(/range/);
    expect(() => applyVectorScale(prepared, { scaleFactor: 0 })).toThrow(/positive/);
  });
});

describe("commit", () => {
  it("never mutates the design and merges in one step", async () => {
    __setPdfjsForTests(fakePdfjs([CABIN_PAGE]));
    const prepared = await preparePdfImport(bytes(), {
      pageNumber: 1, mode: "vector", scaleFactor: 48,
    });
    const design = createEmptyDesign("Cabin");
    const snapshot = JSON.stringify(design);
    const merged = commitPdfImport(design, prepared);
    expect(JSON.stringify(design)).toBe(snapshot);
    expect(merged).not.toBe(design);
    expect(merged.walls).toHaveLength(4);
  });

  it("leaves the design valid", async () => {
    __setPdfjsForTests(fakePdfjs([CABIN_PAGE]));
    const prepared = await preparePdfImport(bytes(), {
      pageNumber: 1, mode: "vector", scaleFactor: 48,
    });
    const merged = commitPdfImport(createEmptyDesign("Cabin"), prepared);
    expect(validateDesign(merged)).toEqual([]);
  });

  it("produces walls that behave like natively drawn ones", async () => {
    __setPdfjsForTests(fakePdfjs([CABIN_PAGE]));
    const prepared = await preparePdfImport(bytes(), {
      pageNumber: 1, mode: "vector", scaleFactor: 48,
    });
    let design = commitPdfImport(createEmptyDesign("Cabin"), prepared);
    const wall = design.walls[0];

    // Editable: an endpoint moves through the ordinary document operation.
    design = moveWallEndpoint(design, wall.id, "a", { x: 12, y: 34 });
    expect(design.walls.find((w) => w.id === wall.id).a).toEqual({ x: 12, y: 34 });

    // Deletable: the ordinary delete removes it.
    design = deleteWall(design, wall.id);
    expect(design.walls.find((w) => w.id === wall.id)).toBeUndefined();
    expect(validateDesign(design)).toEqual([]);
  });

  it("is deterministic for the same bytes and scale", async () => {
    __setPdfjsForTests(fakePdfjs([CABIN_PAGE]));
    const run = async () => {
      const prepared = await preparePdfImport(bytes(), {
        pageNumber: 1, mode: "vector", scaleFactor: 48,
      });
      // importId carries a timestamp by design; geometry must not.
      return prepared.records.walls.map(({ id, source, ...rest }) => rest);
    };
    expect(await run()).toEqual(await run());
  });

  it("refuses to commit nothing", () => {
    expect(() => commitPdfImport(createEmptyDesign("x"), null)).toThrow(/Nothing prepared/);
    expect(() => commitPdfImport(createEmptyDesign("x"), { mode: "vector" })).toThrow(/Nothing prepared/);
    expect(() => commitPdfImport(createEmptyDesign("x"), { mode: "sideways" })).toThrow(/Unknown import mode/);
  });
});

describe("scanned-page import", () => {
  it("places the chosen page as a scaled underlay beneath the drawing layer", async () => {
    __setPdfjsForTests(fakePdfjs([SCAN_PAGE]));
    const record = {};
    const prepared = await preparePdfImport(bytes(), {
      pageNumber: 1,
      mode: "raster",
      dpi: 150,
      scaleFactor: 48,
      fileName: "survey.pdf",
      createCanvas: fakeCanvasFactory(record),
    });
    expect(prepared.mode).toBe("raster");
    expect(prepared.pageKind.kind).toBe("raster");
    expect(prepared.image.dataUrl.startsWith("data:image/png")).toBe(true);
    expect(prepared.image.name).toBe("survey.pdf — page 1");
    // 36x24 inch sheet, downgraded from 150 DPI to fit the pixel budget.
    expect(prepared.plan.pageWidthIn).toBe(36);
    expect(record.width).toBe(prepared.plan.widthPx);

    const design = createEmptyDesign("Scan");
    const snapshot = JSON.stringify(design);
    const merged = commitPdfImport(design, prepared);
    expect(JSON.stringify(design)).toBe(snapshot);
    expect(merged.underlay).not.toBeNull();
    expect(merged.underlay.pxPerIn).toBeCloseTo(prepared.plan.dpi / 48, 9);
    // Real-world span: 36 paper inches at 1/4" = 1'-0" is 144 feet.
    expect(merged.underlay.widthPx / merged.underlay.pxPerIn / 12).toBeCloseTo(144, 1);
    // The import adds no geometry: the scan is a trace-over underlay only.
    expect(merged.walls).toEqual([]);
    expect(validateDesign(merged)).toEqual([]);
  });

  it("lands paper-true when no plot scale is given", async () => {
    __setPdfjsForTests(fakePdfjs([SCAN_PAGE]));
    const prepared = await preparePdfImport(bytes(), {
      pageNumber: 1, mode: "raster", dpi: 96, createCanvas: fakeCanvasFactory({}),
    });
    const merged = commitPdfImport(createEmptyDesign("Scan"), prepared);
    expect(merged.underlay.widthPx / merged.underlay.pxPerIn).toBeCloseTo(36, 1);
  });

  it("warns when a large sheet forces a lower render resolution", async () => {
    __setPdfjsForTests(fakePdfjs([SCAN_PAGE]));
    const prepared = await preparePdfImport(bytes(), {
      pageNumber: 1, mode: "raster", dpi: 300, createCanvas: fakeCanvasFactory({}),
    });
    expect(prepared.plan.downgraded).toBe(true);
    expect(prepared.issues.some((i) => /Rendered at/.test(i.message))).toBe(true);
  });

  it("reports raster phases in order", async () => {
    __setPdfjsForTests(fakePdfjs([SCAN_PAGE]));
    const phases = [];
    await preparePdfImport(bytes(), {
      pageNumber: 1, mode: "raster", createCanvas: fakeCanvasFactory({}),
      onPhase: (p) => phases.push(p),
    });
    expect(phases).toEqual(["opening", "surveying", "rendering", "preparing"]);
  });
});

describe("boundary refusals", () => {
  it("refuses .ai and .eps before parsing anything", async () => {
    __setPdfjsForTests(fakePdfjs([CABIN_PAGE]));
    const ai = new Blob([bytes()]);
    Object.defineProperty(ai, "name", { value: "artwork.ai" });
    await expect(preparePdfImport(ai, {})).rejects.toThrow(/Illustrator/);

    const eps = new Blob([bytes()]);
    Object.defineProperty(eps, "name", { value: "detail.eps" });
    await expect(preparePdfImport(eps, {})).rejects.toThrow(/PostScript/);
  });

  it("refuses a page number outside the document", async () => {
    __setPdfjsForTests(fakePdfjs([CABIN_PAGE]));
    await expect(preparePdfImport(bytes(), { pageNumber: 7 })).rejects.toThrow(/out of range/);
    await expect(preparePdfImport(bytes(), { pageNumber: 0 })).rejects.toThrow(/out of range/);
    await expect(preparePdfImport(bytes(), { pageNumber: 1.5 })).rejects.toThrow(/out of range/);
  });

  it("refuses input that is not bytes", async () => {
    __setPdfjsForTests(fakePdfjs([CABIN_PAGE]));
    await expect(preparePdfImport(null, {})).rejects.toThrow(/file bytes/);
    await expect(preparePdfImport("plan.pdf", {})).rejects.toThrow(/file bytes/);
  });

  it("reports a password-protected PDF in plain language", async () => {
    __setPdfjsForTests({
      OPS,
      GlobalWorkerOptions: {},
      getDocument: () => ({ promise: Promise.reject(new Error("No password given")) }),
    });
    await expect(preparePdfImport(bytes(), {})).rejects.toThrow(/password-protected/);
  });

  it("reports an unreadable file in plain language", async () => {
    __setPdfjsForTests({
      OPS,
      GlobalWorkerOptions: {},
      getDocument: () => ({ promise: Promise.reject(new Error("Invalid PDF structure")) }),
    });
    await expect(preparePdfImport(bytes(), {})).rejects.toThrow(/could not be read as a PDF/);
  });
});

describe("auto mode", () => {
  it("chooses the raster path for a scan and the vector path for a drawing", async () => {
    __setPdfjsForTests(fakePdfjs([densePage()]));
    const vector = await preparePdfImport(bytes(), { pageNumber: 1, mode: "auto" });
    expect(vector.mode).toBe("vector");
    expect(vector.pageKind.kind).toBe("vector");

    __setPdfjsForTests(fakePdfjs([SCAN_PAGE]));
    const scanKind = await listPdfPages(bytes());
    expect(scanKind.pages[0].kind).toBe("raster");
  });

  it("prefers the vector path for a mixed page, leaving the choice to the user", async () => {
    const mixed = {
      facts: LETTER_PAGE,
      entries: [...densePage(30).entries, [OPS.paintImageXObject, ["logo"]]],
    };
    __setPdfjsForTests(fakePdfjs([mixed]));
    const prepared = await preparePdfImport(bytes(), { pageNumber: 1, mode: "auto" });
    expect(prepared.pageKind.kind).toBe("mixed");
    expect(prepared.mode).toBe("vector");
  });
});

describe("progress phases", () => {
  it("reports phases in order, without inventing percentages", async () => {
    __setPdfjsForTests(fakePdfjs([CABIN_PAGE]));
    const phases = [];
    await preparePdfImport(bytes(), { pageNumber: 1, mode: "vector", onPhase: (p) => phases.push(p) });
    expect(phases).toEqual([
      "opening", "surveying", "reading-geometry", "converting", "scaling", "preparing",
    ]);
  });
});
