// @vitest-environment jsdom

// importLibrary.vsdx.test.js — VSDX part of the FORGE Import Test Library
// (the importer parses XML with the browser's DOMParser, hence jsdom).
// Conventions as in importLibrary.test.js: it.fails = KNOWN GAP, written as
// the correct expectation.

import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { prepareVsdxImport, commitVsdxImport } from "./vsdx/visioImporter";
import { createEmptyDesign, parseDesign, serializeDesign, validateDesign } from "../designerDocument";

const LIB = path.resolve(__dirname, "../../../../test-fixtures/import-library");
const bytesOf = (rel) => new Uint8Array(fs.readFileSync(path.join(LIB, rel)));
const reopensClean = (design) => validateDesign(parseDesign(serializeDesign(design)));

describe("VSDX: forge-test-house.vsdx (detailed)", () => {
  let prep;
  let design;
  beforeAll(async () => {
    prep = await prepareVsdxImport(bytesOf("vsdx/forge-test-house.vsdx"), { pageIndex: 0 });
    design = commitVsdxImport(createEmptyDesign("vsdx"), prep);
  });

  it("imports walls at true size from a 1/4\" = 1'-0\" page", () => {
    // 8 wall runs (exterior + 4 interior partitions) once door/window gaps
    // correctly rejoin into one wall each, instead of fragmenting into a
    // separate piece per span the way each Wall shape is individually drawn.
    expect(design.walls.length).toBe(8);
    const pts = design.walls.flatMap((w) => [w.a, w.b]);
    const w = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    const h = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    // 480 x 336 outside, but these are wall CENTERLINES: 6" exterior walls
    // put the centerline 3" in from each face, same as the DXF importer's
    // equivalent assertion (dxfImporter.test.js) for the identical house.
    expect(w).toBeCloseTo(474, -1);
    expect(h).toBeCloseTo(330, -1);
  });

  it("names all five rooms from the Space shapes and maps the furniture masters", () => {
    expect(design.rooms.map((r) => r.label).sort()).toEqual(["Bath", "Bedroom 1", "Bedroom 2", "Kitchen", "Living"]);
    expect(design.furniture.map((f) => f.catalogId).sort()).toEqual(["bed-queen", "bed-queen", "dining-table-rect", "sofa-3seat"]);
    expect(reopensClean(design)).toEqual([]);
  });

  it("turns the 11 Door/Window shapes (sitting in wall gaps) into openings", () => {
    expect(design.openings.length).toBe(11);
    expect(design.openings.filter((o) => o.type === "door")).toHaveLength(5);
    expect(design.openings.filter((o) => o.type === "window")).toHaveLength(6);
  });
});

describe("VSDX: difficult and malformed input", () => {
  it("generic-diagram.vsdx (an original, non-architectural org-chart diagram): imports safely, invents no architecture, reports skips", async () => {
    const prep = await prepareVsdxImport(bytesOf("vsdx/generic-diagram.vsdx"), { pageIndex: 0 });
    const design = commitVsdxImport(createEmptyDesign("x"), prep);
    expect(design.walls).toHaveLength(0);
    expect(design.rooms).toHaveLength(0);
    expect(design.annotations.length).toBeGreaterThan(0);
    expect(prep.counts.skipped).toBeGreaterThan(0);
    expect(reopensClean(design)).toEqual([]);
  });

  it("malformed-not-a-zip.vsdx: refused as not a ZIP", async () => {
    await expect(prepareVsdxImport(bytesOf("vsdx/malformed-not-a-zip.vsdx"))).rejects.toMatchObject({ code: "bad-zip" });
  });

  it("malformed-missing-pages.vsdx: refused, naming the missing part", async () => {
    await expect(prepareVsdxImport(bytesOf("vsdx/malformed-missing-pages.vsdx"))).rejects.toMatchObject({ code: "missing-part" });
  });
});
