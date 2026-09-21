/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { openVsdxPackage } from "./vsdxPackage";
import { parseXml, firstChild } from "./visioXml";
import {
  buildMasterIndex,
  cellElementMap,
  constantOf,
  mergedCellMap,
  readPageSize,
  resolveCell,
  resolvePageShapes,
} from "./visioResolver";
import { buildVsdx, rectGeometry, shapeXml } from "./testUtils/vsdxFixture";

const MASTER_RECT = shapeXml({
  id: "0",
  nameU: "Rectangle",
  cells: {
    Width: { v: "2" },
    Height: { v: "1" },
    PinX: { v: "9" },
    PinY: { v: "9" },
    LocPinX: { f: "Width*0.5" },
    LocPinY: { f: "Height*0.5" },
  },
  geometry: rectGeometry(0, 0, 2, 1),
});

function ctxFor(pkg, masters) {
  return {
    masterIndex: masters || buildMasterIndex(pkg),
    pageName: "Page-1",
    warnings: [],
    depth: 0,
  };
}

describe("visioResolver cells", () => {
  it("literal V values resolve as constants; formulas stay unsupported", () => {
    const doc = parseXml(
      `<Shape><Cell N="PinX" V="2.5"/><Cell N="PinY" F="Width*0.5"/><Cell N="Angle"/></Shape>`,
      "s.xml",
    );
    const map = cellElementMap(doc.documentElement);
    expect(resolveCell(map.get("PinX"), map)).toEqual({
      state: "constant",
      value: 2.5,
      formula: undefined,
    });
    const pinY = resolveCell(map.get("PinY"), map);
    expect(pinY.state).toBe("unsupported-formula");
    expect(pinY.formula).toBe("Width*0.5");
    expect(constantOf(pinY)).toBeUndefined();
    expect(resolveCell(map.get("Angle"), map).state).toBe("missing");
    expect(resolveCell(map.get("Nope"), map).state).toBe("missing");
  });

  it("resolves bare cell references to constants (e.g. F='BeginX')", () => {
    const doc = parseXml(
      `<Shape><Cell N="BeginX" V="1.25"/><Cell N="EndX" F="BeginX"/></Shape>`,
      "s.xml",
    );
    const map = cellElementMap(doc.documentElement);
    expect(constantOf(resolveCell(map.get("EndX"), map))).toBe(1.25);
  });

  it("does not hang or mis-resolve self-referential formulas", () => {
    const doc = parseXml(`<Shape><Cell N="PinX" F="PinX"/></Shape>`, "s.xml");
    const map = cellElementMap(doc.documentElement);
    expect(resolveCell(map.get("PinX"), map).state).toBe("unsupported-formula");
  });

  it("numeric F literals resolve as constants", () => {
    const doc = parseXml(`<Shape><Cell N="Angle" F="1.5707963"/></Shape>`, "s.xml");
    const map = cellElementMap(doc.documentElement);
    expect(constantOf(resolveCell(map.get("Angle"), map))).toBeCloseTo(1.5707963, 6);
  });
});

describe("visioResolver masters", () => {
  it("places the same master twice with different Pins; master cells are never mutated", () => {
    const masterBefore = MASTER_RECT;
    const bytes = buildVsdx({
      masters: [{ id: "0", nameU: "Rectangle", shapes: MASTER_RECT }],
      pages: [
        {
          name: "Page-1",
          file: "page1.xml",
          shapes:
            shapeXml({ id: "1", master: "0", cells: { PinX: { v: "1" }, PinY: { v: "1" } } }) +
            shapeXml({ id: "2", master: "0", cells: { PinX: { v: "5" }, PinY: { v: "5" } } }),
        },
      ],
    });
    const pkg = openVsdxPackage(bytes);
    const masterIndex = buildMasterIndex(pkg);
    const pageDoc = parseXml(pkg.getText("visio/pages/page1.xml"), "page1.xml");
    const { shapes } = resolvePageShapes(pageDoc, ctxFor(pkg, masterIndex));

    expect(shapes).toHaveLength(2);
    expect(constantOf(resolveCell(shapes[0].cells.get("PinX"), shapes[0].cells))).toBe(1);
    expect(constantOf(resolveCell(shapes[1].cells.get("PinX"), shapes[1].cells))).toBe(5);
    // Inherited (non-overridden) cells come from the master.
    expect(constantOf(resolveCell(shapes[0].cells.get("Width"), shapes[0].cells))).toBe(2);
    // Formula cells stay unsupported, never silently zero.
    expect(resolveCell(shapes[0].cells.get("LocPinX"), shapes[0].cells).state).toBe("unsupported-formula");
    // The master definition itself is unchanged.
    expect(masterIndex.get("0").shapeEl).toBeTruthy();
    expect(MASTER_RECT).toBe(masterBefore);
  });

  it("resolves masters by relationship id when .rels order is reversed", () => {
    // Two masters whose rels entries are reordered: master id "0" must still
    // resolve to the Rectangle definition, not to Circle's.
    const bytes = buildVsdx({
      masters: [
        { id: "0", nameU: "Rectangle", shapes: MASTER_RECT },
        { id: "1", nameU: "Circle", shapes: shapeXml({ id: "0", nameU: "Oval", cells: { Width: { v: "3" } } }) },
      ],
      pages: [{ name: "Page-1", file: "page1.xml", shapes: "" }],
      reversedRels: true,
    });
    const pkg = openVsdxPackage(bytes);
    const masterIndex = buildMasterIndex(pkg);
    expect(masterIndex.get("0").nameU).toBe("Rectangle");
    expect(masterIndex.get("1").nameU).toBe("Circle");
    const rectCells = cellElementMap(masterIndex.get("0").shapeEl);
    expect(constantOf(resolveCell(rectCells.get("Width"), rectCells))).toBe(2);
    const circleCells = cellElementMap(masterIndex.get("1").shapeEl);
    expect(constantOf(resolveCell(circleCells.get("Width"), circleCells))).toBe(3);
  });

  it("warns on unknown master references and keeps local geometry", () => {
    const bytes = buildVsdx({
      pages: [
        {
          name: "Page-1",
          file: "page1.xml",
          shapes: shapeXml({
            id: "3",
            master: "99",
            cells: { PinX: { v: "1" } },
            geometry: rectGeometry(0, 0, 1, 1),
          }),
        },
      ],
    });
    const pkg = openVsdxPackage(bytes);
    const warnings = [];
    const pageDoc = parseXml(pkg.getText("visio/pages/page1.xml"), "page1.xml");
    const { shapes } = resolvePageShapes(pageDoc, { ...ctxFor(pkg), warnings });
    expect(shapes).toHaveLength(1);
    expect(shapes[0].geometrySections).toHaveLength(1);
    expect(warnings.some((w) => /unknown master '99'/.test(w.message))).toBe(true);
  });

  it("merges placed geometry sections over master sections by IX", () => {
    const bytes = buildVsdx({
      masters: [{ id: "0", nameU: "Rectangle", shapes: MASTER_RECT }],
      pages: [
        {
          name: "Page-1",
          file: "page1.xml",
          shapes: shapeXml({
            id: "4",
            master: "0",
            geometry: rectGeometry(0, 0, 3, 3),
          }),
        },
      ],
    });
    const pkg = openVsdxPackage(bytes);
    const pageDoc = parseXml(pkg.getText("visio/pages/page1.xml"), "page1.xml");
    const { shapes } = resolvePageShapes(pageDoc, ctxFor(pkg));
    const rows = shapes[0].geometrySections[0].rows;
    // Placed 3x3 rect wins over the master's 2x1 rect: find the max X cell.
    const xs = [];
    for (const row of rows) {
      for (const cell of cellElementMap(row.el).values()) void cell;
      const xCell = [...cellElementMap(row.el).entries()].find(([n]) => n === "X");
      if (xCell) xs.push(Number(xCell[1].getAttribute("V")));
    }
    expect(Math.max(...xs)).toBe(3);
  });

  it("reads page size constants; flags non-constant size", () => {
    const doc = parseXml(
      `<PageContents><PageSheet><Cell N="PageWidth" V="11"/><Cell N="PageHeight" F="Width*2"/></PageSheet></PageContents>`,
      "p.xml",
    );
    const size = readPageSize(cellElementMap(firstChild(doc.documentElement, "PageSheet")));
    expect(size.widthIn).toBe(11);
    expect(size.heightIn).toBeUndefined();
    expect(size.heightState).toBe("unsupported-formula");
  });

  it("resolves nested groups with depth guard intact", () => {
    const inner = shapeXml({ id: "2", cells: { PinX: { v: "1" } }, geometry: rectGeometry(0, 0, 1, 1) });
    const outer = shapeXml({ id: "1", nameU: "Group", cells: { PinX: { v: "2" } }, children: inner });
    const bytes = buildVsdx({ pages: [{ name: "P", file: "page1.xml", shapes: outer }] });
    const pkg = openVsdxPackage(bytes);
    const pageDoc = parseXml(pkg.getText("visio/pages/page1.xml"), "page1.xml");
    const { shapes } = resolvePageShapes(pageDoc, ctxFor(pkg));
    expect(shapes[0].isGroup).toBe(true);
    expect(shapes[0].children[0].id).toBe("2");
    expect(shapes[0].children[0].provenance).toContain("Group 1");
  });

  it("mergedCellMap does not mutate the master map", () => {
    const doc = parseXml(
      `<a><Shape><Cell N="A" V="1"/></Shape><Shape><Cell N="A" V="2"/></Shape></a>`,
      "m.xml",
    );
    const [masterEl, placedEl] = doc.documentElement.childNodes;
    const merged = mergedCellMap(masterEl, placedEl);
    expect(merged.get("A").getAttribute("V")).toBe("2");
    expect(cellElementMap(masterEl).get("A").getAttribute("V")).toBe("1");
  });
});
