// pdfMapper.test.js — classified paths → Designer wall records.
//
// The contract that matters: imported geometry becomes real walls, so it is
// selectable, movable and editable like hand-drawn geometry. Read-only
// annotations are deliberately never produced (they render with pointer
// events disabled and could not be edited).

import { describe, expect, it } from "vitest";
import { MAX_WALLS_PER_IMPORT, buildPdfRecords } from "./pdfMapper";
import { classifyPath } from "./pdfClassifier";
import { validateDesign, createEmptyDesign } from "../../designerDocument";
import { applyImportResult } from "../vsdx/visioMapper";

const wallItem = (points, overrides = {}) => {
  const path = {
    polylines: [{ points, closed: false }],
    stroked: true,
    filled: false,
    dashed: false,
    ...overrides,
  };
  return { path, classification: classifyPath(path, { minSegmentIn: 6 }) };
};

describe("buildPdfRecords", () => {
  it("emits one wall per segment with stable, unique ids", () => {
    const { records, counts } = buildPdfRecords(
      [wallItem([{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 96 }])],
      { importId: "p1-abc", pageNumber: 1 },
    );
    expect(records.walls).toHaveLength(2);
    expect(records.walls.map((w) => w.id)).toEqual(["pdf-p1-abc-w1", "pdf-p1-abc-w2"]);
    expect(counts.walls).toBe(2);
    expect(counts.paths).toBe(1);
  });

  it("produces ONLY walls — never read-only annotations", () => {
    const { records } = buildPdfRecords([wallItem([{ x: 0, y: 0 }, { x: 120, y: 0 }])]);
    expect(records.annotations).toEqual([]);
    expect(records.rooms).toEqual([]);
    expect(records.openings).toEqual([]);
    expect(records.furniture).toEqual([]);
    expect(records.pipes).toEqual([]);
    expect(records.symbols).toEqual([]);
    expect(records.walls.length).toBeGreaterThan(0);
  });

  it("stamps provenance on every wall so an import can be identified later", () => {
    const { records } = buildPdfRecords([wallItem([{ x: 0, y: 0 }, { x: 120, y: 0 }])], {
      importId: "p2-xyz",
      pageNumber: 2,
      scaleFactor: 48,
    });
    expect(records.walls[0].source).toEqual({
      importer: "pdf",
      importId: "p2-xyz",
      pageNumber: 2,
      scaleFactor: 48,
      fromFill: false,
    });
  });

  it("carries a wall's endpoints through exactly, with no rounding drift", () => {
    const { records } = buildPdfRecords([
      wallItem([{ x: 1.5, y: -2.25 }, { x: 121.75, y: -2.25 }]),
    ]);
    expect(records.walls[0].a).toEqual({ x: 1.5, y: -2.25 });
    expect(records.walls[0].b).toEqual({ x: 121.75, y: -2.25 });
  });

  it("sanitizes an id fragment so records stay addressable", () => {
    const { records } = buildPdfRecords([wallItem([{ x: 0, y: 0 }, { x: 120, y: 0 }])], {
      importId: "p1/../weird id!",
    });
    expect(records.walls[0].id).toMatch(/^pdf-p1_.._weird_id_-w1$/);
  });

  it("counts and explains skipped paths, grouping identical reasons", () => {
    const dashed = () => {
      const path = {
        polylines: [{ points: [{ x: 0, y: 0 }, { x: 120, y: 0 }], closed: false }],
        stroked: true, filled: false, dashed: true,
      };
      return { path, classification: classifyPath(path) };
    };
    const { counts, notes } = buildPdfRecords([dashed(), dashed(), dashed()]);
    expect(counts.skippedPaths).toBe(3);
    expect(counts.walls).toBe(0);
    const dashNote = notes.find((n) => /dashed/.test(n.message));
    expect(dashNote.message).toMatch(/^3 paths skipped/);
  });

  it("reports dropped short segments once, with the reason", () => {
    const path = {
      polylines: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 200, y: 0 }], closed: false }],
      stroked: true, filled: false, dashed: false,
    };
    const { counts, notes } = buildPdfRecords([
      { path, classification: classifyPath(path, { minSegmentIn: 12 }) },
    ]);
    expect(counts.droppedShortSegments).toBe(1);
    expect(notes.some((n) => /length floor/.test(n.message))).toBe(true);
  });

  it("explains that a filled region became its outline", () => {
    const path = {
      polylines: [{ points: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 6 }, { x: 0, y: 6 }], closed: true }],
      stroked: false, filled: true, dashed: false,
    };
    const { counts, notes } = buildPdfRecords([
      { path, classification: classifyPath(path) },
    ]);
    expect(counts.filledOutlinePaths).toBe(1);
    expect(records0(notes)).toMatch(/poché|poche/i);
  });

  it("never emits a wall shorter than the document model accepts", () => {
    // Bypass the classifier and hand the mapper a degenerate segment directly.
    const { records } = buildPdfRecords([
      {
        path: {},
        classification: {
          kind: "wall",
          detail: { segments: [{ a: { x: 0, y: 0 }, b: { x: 0.5, y: 0 } }], droppedShort: 0 },
        },
      },
    ]);
    expect(records.walls).toHaveLength(0);
  });

  it("caps a runaway import and says so", () => {
    const longRun = [];
    for (let i = 0; i <= MAX_WALLS_PER_IMPORT + 10; i += 1) {
      longRun.push({ x: i * 12, y: 0 });
    }
    const { records, counts, notes } = buildPdfRecords([wallItem(longRun)]);
    expect(records.walls).toHaveLength(MAX_WALLS_PER_IMPORT);
    expect(counts.cappedAtLimit).toBe(true);
    expect(notes.some((n) => /cap/.test(n.message))).toBe(true);
  });

  it("returns empty records for no input", () => {
    const { records, counts } = buildPdfRecords([]);
    expect(records.walls).toEqual([]);
    expect(counts.paths).toBe(0);
    expect(buildPdfRecords(null).records.walls).toEqual([]);
  });

  it("produces records that merge into a design and pass validation", () => {
    const { records } = buildPdfRecords(
      [wallItem([{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 96 }, { x: 0, y: 96 }])],
      { importId: "p1-abc" },
    );
    const design = applyImportResult(createEmptyDesign("Imported"), records);
    expect(design.walls).toHaveLength(3);
    expect(validateDesign(design)).toEqual([]);
  });

  it("survives a re-import of the same page without id collisions", () => {
    const build = () =>
      buildPdfRecords([wallItem([{ x: 0, y: 0 }, { x: 120, y: 0 }])], { importId: "same" }).records;
    let design = applyImportResult(createEmptyDesign("Imported"), build());
    design = applyImportResult(design, build());
    expect(design.walls).toHaveLength(2);
    expect(new Set(design.walls.map((w) => w.id)).size).toBe(2);
    expect(validateDesign(design)).toEqual([]);
  });
});

function records0(notes) {
  return notes.map((n) => n.message).join(" | ");
}
