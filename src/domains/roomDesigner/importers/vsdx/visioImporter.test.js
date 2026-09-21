/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  cellXml,
  cellsXml,
  rectGeometry,
  shapeXml,
  buildVsdx,
} from "./testUtils/vsdxFixture.js";
import {
  IMPORT_PHASES,
  commitVsdxImport,
  listVsdxPages,
  prepareVsdxImport,
} from "./visioImporter.js";
import { createEmptyDesign } from "../../designerDocument.js";

const placeCells = (pinX, pinY) =>
  cellsXml({ PinX: { v: pinX }, PinY: { v: pinY }, LocPinX: { v: 0 }, LocPinY: { v: 0 } });

const lineGeometry = (x0, y0, x1, y1) =>
  `<Section N="Geometry" IX="1">` +
  `<Row T="MoveTo">${cellXml("X", { v: x0 })}${cellXml("Y", { v: y0 })}</Row>` +
  `<Row T="LineTo">${cellXml("X", { v: x1 })}${cellXml("Y", { v: y1 })}</Row>` +
  `</Section>`;

/** A one-page drawing: a wall-master line, a plain rectangle, a text note. */
function mixedDrawing() {
  const masters = [
    {
      id: 1,
      nameU: "Wall",
      shapes: `<Shape ID="1" NameU="Wall">${lineGeometry(0, 0, 10, 0)}</Shape>`,
    },
  ];
  const wall = shapeXml({ id: 5, nameU: "Wall A", master: 1, cells: { PinX: { v: 2 }, PinY: { v: 3 }, LocPinX: { v: 0 }, LocPinY: { v: 0 } } });
  const box = shapeXml({ id: 6, nameU: "Box", cells: {}, geometry: "" });
  const boxWithGeom = `<Shape ID="6" NameU="Box">${placeCells(5, 5)}${rectGeometry(0, 0, 4, 3)}</Shape>`;
  const note = `<Shape ID="7" NameU="Note">${placeCells(1, 1)}<Text>Hello</Text></Shape>`;
  void box;
  return buildVsdx({
    pages: [{ name: "Page-1", file: "page1.xml", shapes: wall + boxWithGeom + note, pageHeight: 8.5 }],
    masters,
  });
}

describe("visioImporter end to end", () => {
  it("emits named phases in order, not fake percentages", async () => {
    const seen = [];
    await prepareVsdxImport(mixedDrawing(), { onPhase: (p) => seen.push(p) });
    expect(seen).toEqual([...IMPORT_PHASES]);
  });

  it("prepares a full one-page import: wall + annotation + label", async () => {
    const prepared = await prepareVsdxImport(mixedDrawing());
    expect(prepared.page.name).toBe("Page-1");
    expect(prepared.pageHeightIn).toBe(8.5);

    // Wall: local (0,0)→(10,0) at Pin (2,3) → page (2,3)→(12,3) → designer y = 8.5−3 = 5.5.
    expect(prepared.records.walls).toHaveLength(1);
    const wall = prepared.records.walls[0];
    expect(wall.a).toMatchObject({ x: 2, y: 5.5 });
    expect(wall.b).toMatchObject({ x: 12, y: 5.5 });

    // Plain rectangle → annotation path; text note → label.
    expect(prepared.records.annotations.filter((a) => a.kind === "path")).toHaveLength(1);
    expect(prepared.records.annotations.filter((a) => a.kind === "label")).toHaveLength(1);
    expect(prepared.records.rooms).toHaveLength(0);

    expect(prepared.counts.mapped).toBe(3);
    expect(Array.isArray(prepared.issues)).toBe(true);
  });

  it("annotation path carries vsdx source provenance", async () => {
    const prepared = await prepareVsdxImport(mixedDrawing());
    const path = prepared.records.annotations.find((a) => a.kind === "path");
    expect(path.source).toMatchObject({ importer: "vsdx", pageName: "Page-1", shapeId: "6" });
    expect(path.points.length).toBeGreaterThanOrEqual(4);
  });

  it("places the same master twice at different Pins independently", async () => {
    const masters = [
      { id: 1, nameU: "Wall", shapes: `<Shape ID="1" NameU="Wall">${lineGeometry(0, 0, 10, 0)}</Shape>` },
    ];
    const a = shapeXml({ id: 5, nameU: "A", master: 1, cells: { PinX: { v: 0 }, PinY: { v: 1 }, LocPinX: { v: 0 }, LocPinY: { v: 0 } } });
    const b = shapeXml({ id: 6, nameU: "B", master: 1, cells: { PinX: { v: 20 }, PinY: { v: 1 }, LocPinX: { v: 0 }, LocPinY: { v: 0 } } });
    const bytes = buildVsdx({ pages: [{ name: "P", file: "page1.xml", shapes: a + b }], masters });
    const prepared = await prepareVsdxImport(bytes);
    expect(prepared.records.walls).toHaveLength(2);
    const xs = prepared.records.walls.map((w) => w.a.x).sort((x, y) => x - y);
    expect(xs).toEqual([0, 20]);
  });

  it("honors multi-page display order independent of filenames", async () => {
    const mkWall = (id, pinX) =>
      shapeXml({ id, nameU: `W${id}`, cells: { PinX: { v: pinX }, PinY: { v: 1 }, LocPinX: { v: 0 }, LocPinY: { v: 0 } }, geometry: lineGeometry(0, 0, 5, 0) });
    const bytes = buildVsdx({
      pages: [
        { name: "First", file: "page2.xml", shapes: mkWall(5, 1) },
        { name: "Second", file: "page1.xml", shapes: mkWall(6, 9) },
      ],
    });
    const pages = await listVsdxPages(bytes);
    expect(pages.map((p) => p.name)).toEqual(["First", "Second"]);

    const second = await prepareVsdxImport(bytes, { pageIndex: 1 });
    expect(second.page.name).toBe("Second");
    expect(second.records.annotations[0].source.shapeId).toBe("6");

    await expect(prepareVsdxImport(bytes, { pageIndex: 2 })).rejects.toThrow(/out of range/);
  });

  it("commits atomically: original design untouched, one pure merge", async () => {
    const design = createEmptyDesign("before");
    const prepared = await prepareVsdxImport(mixedDrawing());
    const next = commitVsdxImport(design, prepared);

    expect(next).not.toBe(design);
    expect(design.walls).toHaveLength(0);
    expect(design.annotations).toHaveLength(0);
    expect(next.walls).toHaveLength(1);
    expect(next.annotations).toHaveLength(2);
    expect(next.name).toBe("before");
  });

  it("a failed preparation throws before touching the design", async () => {
    const design = createEmptyDesign("pristine");
    await expect(prepareVsdxImport(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    expect(design.walls).toHaveLength(0);
    expect(design.annotations).toHaveLength(0);
    expect(design.name).toBe("pristine");
  });

  it("commit requires a prepared result", () => {
    expect(() => commitVsdxImport(createEmptyDesign(), null)).toThrow(/nothing prepared/i);
  });
});
