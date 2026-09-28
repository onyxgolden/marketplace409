// importLibrary.test.js — FORGE Import Test Library (test-fixtures/import-library).
//
// Real-file baseline for the importers FORGE actually has (ASCII DXF, PDF
// here; VSDX in importLibrary.vsdx.test.js, which needs a DOM). For each
// supported format: a detailed drawing, a difficult file and malformed input.
//
// Two kinds of assertions:
//   it(...)        behaviour that is correct today and must stay correct;
//   it.fails(...)  KNOWN GAPS: written as the CORRECT expectation, currently
//                  failing on purpose. When an importer fix makes one pass,
//                  vitest reports it — flip it to it(...) in that fix. They
//                  never block a fix; they record the baseline honestly.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { readDxfDrawing, prepareDxfImport, commitDxfImport } from "./dxf/dxfImporter";
import { __setPdfjsForTests, preparePdfImport, commitPdfImport } from "./pdf/pdfImporter";
import { createEmptyDesign, parseDesign, serializeDesign, validateDesign } from "../designerDocument";

const LIB = path.resolve(__dirname, "../../../../test-fixtures/import-library");
const bytesOf = (rel) => new Uint8Array(fs.readFileSync(path.join(LIB, rel)));
const manifest = JSON.parse(fs.readFileSync(path.join(LIB, "manifest.json"), "utf8"));

function box(points) {
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
const wallBox = (design) => box(design.walls.flatMap((w) => [w.a, w.b]));
const reopensClean = (design) => validateDesign(parseDesign(serializeDesign(design)));
const napi = await import("@napi-rs/canvas").catch(() => null);

describe("import library manifest", () => {
  it("lists every fixture file, with matching size and sha256", () => {
    const listed = new Set(manifest.fixtures.map((f) => f.path));
    for (const dir of ["dxf", "vsdx", "pdf"]) {
      for (const name of fs.readdirSync(path.join(LIB, dir))) expect(listed, `${dir}/${name} is in manifest.json`).toContain(`${dir}/${name}`);
    }
    for (const f of manifest.fixtures) {
      const data = fs.readFileSync(path.join(LIB, f.path));
      expect(data.length, f.path).toBe(f.bytes);
      expect(createHash("sha256").update(data).digest("hex"), f.path).toBe(f.sha256);
    }
  });

  it("records provenance and license evidence for every fixture", () => {
    for (const f of manifest.fixtures) {
      for (const key of ["format", "role", "source", "author", "license", "licenseEvidence", "why"]) expect(f[key], `${f.path}.${key}`).toBeTruthy();
      expect(["detailed", "difficult", "malformed"]).toContain(f.role);
      // Local evidence files (licence texts, generators) must exist.
      for (const ref of f.licenseEvidence.split(";").map((s) => s.trim())) {
        if (/^(licenses|generators)\//.test(ref)) expect(fs.existsSync(path.join(LIB, ref)), ref).toBe(true);
      }
      if (!/original work/i.test(f.license)) expect(f.attribution, `${f.path} third-party attribution`).toBeTruthy();
    }
  });

  it("covers detailed, difficult and malformed input for each supported format", () => {
    const roles = (fmt) => new Set(manifest.fixtures.filter((f) => f.format === fmt || (fmt === "dxf" && f.format === "dwg")).map((f) => f.role));
    expect([...roles("dxf")].sort()).toEqual(["detailed", "difficult", "malformed"]);
    expect([...roles("vsdx")].sort()).toEqual(["detailed", "difficult", "malformed"]);
    expect([...roles("pdf")].sort()).toEqual(["detailed", "malformed"]); // the scanned HABS sheet is the second detailed PDF
  });
});

describe("DXF: forge-test-house.dxf (detailed)", () => {
  let drawing;
  let prep;
  let design;
  beforeAll(() => {
    drawing = readDxfDrawing(bytesOf("dxf/forge-test-house.dxf"));
    prep = prepareDxfImport(drawing);
    design = commitDxfImport(createEmptyDesign("dxf"), prep);
  });

  it("reads inches, suggests roles from AIA layer names, and lands at true size", () => {
    expect(drawing.units).toEqual({ unit: "in", known: true });
    const role = (name) => drawing.layers.find((l) => l.name === name)?.suggestedRole;
    expect(role("A-WALL")).toBe("walls");
    expect(role("A-DOOR")).toBe("doors");
    expect(role("A-GLAZ")).toBe("windows");
    expect(role("A-AREA")).toBe("rooms");
    const b = wallBox(design); // 480 x 336 outside, wall centerlines are 6" in from the faces
    expect(b.w).toBeGreaterThan(465);
    expect(b.w).toBeLessThan(485);
    expect(b.h).toBeGreaterThan(320);
    expect(b.h).toBeLessThan(340);
  });

  it("imports the walls and all five named rooms, and reopens clean", () => {
    expect(design.walls.length).toBeGreaterThanOrEqual(12);
    expect(design.rooms.map((r) => r.label).sort()).toEqual(["BATH", "BEDROOM 1", "BEDROOM 2", "KITCHEN", "LIVING"]);
    expect(reopensClean(design)).toEqual([]);
  });

  it("reports what it skipped instead of dropping it silently", () => {
    const text = prep.issues.map((i) => i.message).join("\n");
    expect(text).toMatch(/HATCH/);
  });

  it.fails("KNOWN GAP: cuts all 11 doors/windows (drawn in wall gaps) into the walls", () => {
    expect(design.openings.length).toBe(11);
  });
});

describe("DXF: difficult and malformed input", () => {
  it("nortier-blocks1.dxf (non-architectural blocks, mm): imports safely and invents no walls", () => {
    const drawing = readDxfDrawing(bytesOf("dxf/nortier-blocks1.dxf"));
    const prep = prepareDxfImport(drawing);
    const design = commitDxfImport(createEmptyDesign("x"), prep);
    expect(drawing.units.unit).toBe("mm");
    expect(design.walls).toHaveLength(0);
    expect(design.annotations.length).toBeGreaterThan(0);
    expect(prep.issues.map((i) => i.message).join(" ")).toMatch(/No layer is set to Walls/);
    expect(reopensClean(design)).toEqual([]);
  });

  it("malformed-fake.dwg: refused with the DWG → export-as-DXF message", () => {
    expect(() => readDxfDrawing(bytesOf("dxf/malformed-fake.dwg"))).toThrow(/DWG file\. Save or export it as DXF/);
  });

  it("malformed-truncated.dxf: never crashes and keeps the design valid", () => {
    const prep = prepareDxfImport(readDxfDrawing(bytesOf("dxf/malformed-truncated.dxf")));
    const design = commitDxfImport(createEmptyDesign("x"), prep);
    expect(reopensClean(design)).toEqual([]);
  });

  it.fails("KNOWN GAP: malformed-truncated.dxf warns that the file is incomplete (no EOF)", () => {
    const prep = prepareDxfImport(readDxfDrawing(bytesOf("dxf/malformed-truncated.dxf")));
    expect(prep.issues.map((i) => i.message).join(" ")).toMatch(/truncat|incomplete|end of file|EOF/i);
  });
});

describe("PDF (real pdf.js, legacy build for Node)", () => {
  beforeAll(async () => {
    __setPdfjsForTests(await import("pdfjs-dist/legacy/build/pdf.mjs"));
  });

  it("forge-test-house-vector.pdf at 1/4\" = 1'-0\": imports vector geometry and reopens clean", async () => {
    const prep = await preparePdfImport(bytesOf("pdf/forge-test-house-vector.pdf"), { pageNumber: 1, mode: "vector", scaleFactor: 48 });
    const design = commitPdfImport(createEmptyDesign("pdf"), prep);
    expect(prep.counts.paths).toBeGreaterThan(100);
    expect(design.walls.length).toBeGreaterThan(0);
    expect(reopensClean(design)).toEqual([]);
  });

  it.fails("KNOWN GAP: vector PDF keeps only real walls (not furniture, text, dimensions, hatch or the page background) at house size", async () => {
    const prep = await preparePdfImport(bytesOf("pdf/forge-test-house-vector.pdf"), { pageNumber: 1, mode: "vector", scaleFactor: 48 });
    const design = commitPdfImport(createEmptyDesign("pdf"), prep);
    expect(design.walls.length).toBeLessThan(80); // today: about 400 "walls"
    const b = wallBox(design); // today: the whole 528 x 408 sheet
    expect(b.w).toBeLessThan(500);
    expect(b.h).toBeLessThan(360);
  });

  it("habs-davenport-house-sheet1-scanned.pdf in vector mode: finds no paths and points the user to the scan path", async () => {
    const prep = await preparePdfImport(bytesOf("pdf/habs-davenport-house-sheet1-scanned.pdf"), { pageNumber: 1, mode: "vector" });
    expect(prep.counts.paths).toBe(0);
    expect(prep.issues.map((i) => i.message).join(" ")).toMatch(/No vector paths were found/);
  });

  // The scanned-page path, rendered through FORGE's own raster code with a
  // Node canvas (@napi-rs/canvas ships with pdfjs-dist; skipped if absent).
  async function rasterInk() {
    const prep = await preparePdfImport(bytesOf("pdf/habs-davenport-house-sheet1-scanned.pdf"), {
      pageNumber: 1, mode: "raster", createCanvas: (w, h) => napi.createCanvas(w, h),
    });
    const img = await napi.loadImage(Buffer.from(prep.image.dataUrl.split(",")[1], "base64"));
    const c = napi.createCanvas(img.width, img.height);
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let dark = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 7, n++) if ((d[i] + d[i + 1] + d[i + 2]) / 3 < 128) dark++;
    return { prep, inkPct: (100 * dark) / n };
  }

  it.skipIf(!napi)("habs-davenport-house-sheet1-scanned.pdf as an image underlay: places the whole sheet at 150 DPI", async () => {
    const { prep } = await rasterInk();
    expect(prep.image.widthPx).toBe(3499);
    expect(prep.image.heightPx).toBe(2676);
  });

  it.skipIf(!napi).fails("KNOWN GAP: the scanned sheet's linework survives rasterization (CCITT fax image decoded, not blank white)", async () => {
    const { inkPct } = await rasterInk(); // today 0.00%: pdf.js 5 needs wasmUrl to decode CCITT/JBIG2; poppler shows ~5%
    expect(inkPct).toBeGreaterThan(1);
  });

  it("malformed-truncated.pdf: refused as unreadable", async () => {
    await expect(preparePdfImport(bytesOf("pdf/malformed-truncated.pdf"), { pageNumber: 1, mode: "vector" })).rejects.toMatchObject({ code: "unreadable" });
  });
});
