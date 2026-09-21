// SheetPrintView: deterministic pure function of (design, sheet) — exact
// physical CSS dimensions, the fixed plan region as the SVG viewBox, and
// clipping so content outside the frame never prints.

import { renderToStaticMarkup } from "react-dom/server";
import SheetPrintView from "./SheetPrintView";
import {
  addOrgChart,
  addPerson,
  addPipeRun,
  addSheet,
  addWall,
  createEmptyDesign,
  placeFurniture,
  addOpening,
  placeSymbol,
  setUnderlay,
  sheetPlanBounds,
} from "@/domains/roomDesigner/designerDocument";

function richDesign() {
  let design = createEmptyDesign("Print test");
  design = addWall(design, { x: 0, y: 0 }, { x: 240, y: 0 });
  const wallId = design.walls[0].id;
  design = addWall(design, { x: 240, y: 0 }, { x: 240, y: 180 });
  design = addOpening(design, wallId, { type: "door", offsetIn: 60, widthIn: 36 });
  design = placeFurniture(design, "bed-queen", 120, 90, 0);
  design = addPipeRun(design, [
    { x: 10, y: 160 },
    { x: 230, y: 160 },
  ]);
  design = placeSymbol(design, "piping", "gate-valve", 60, 160, {});
  let charted = addOrgChart(design, "Ops", 120, 40);
  const chartId = charted.orgCharts[0].id;
  charted = addPerson(charted, chartId, { name: "Ava", title: "Lead" });
  const withUnderlay = setUnderlay(charted, {
    name: "bg.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
    widthPx: 100,
    heightPx: 100,
  });
  return addSheet(withUnderlay, "letter", "landscape");
}

describe("SheetPrintView", () => {
  it("is deterministic: same (design, sheet) renders byte-identical markup", () => {
    const design = richDesign();
    const sheet = design.sheets[0];
    const a = renderToStaticMarkup(
      <SheetPrintView design={design} sheet={sheet} dateLabel="2026-09-21" />
    );
    const b = renderToStaticMarkup(
      <SheetPrintView design={design} sheet={sheet} dateLabel="2026-09-21" />
    );
    expect(a).toBe(b);
  });

  it("uses exact physical CSS dimensions for the paper size", () => {
    const design = richDesign();
    const sheet = design.sheets[0];
    const html = renderToStaticMarkup(
      <SheetPrintView design={design} sheet={sheet} dateLabel="2026-09-21" />
    );
    // Letter landscape: 11in x 8.5in, exact — never rounded.
    expect(html).toContain("width:11in");
    expect(html).toContain("height:8.5in");
  });

  it("maps the fixed sheet plan region to the SVG viewBox and clips outside content", () => {
    const design = richDesign();
    const sheet = design.sheets[0];
    const bounds = sheetPlanBounds(sheet);
    const html = renderToStaticMarkup(
      <SheetPrintView design={design} sheet={sheet} dateLabel="2026-09-21" />
    );
    expect(html).toContain(
      `viewBox="${bounds.x} ${bounds.y} ${bounds.widthIn} ${bounds.heightIn}"`
    );
    expect(html).toContain("<clipPath");
    expect(html).toContain(`url(#forge-print-clip-${sheet.id})`);
  });

  it("labels the exact fit scale in the title strip", () => {
    const design = richDesign();
    const sheet = design.sheets[0];
    const html = renderToStaticMarkup(
      <SheetPrintView design={design} sheet={sheet} dateLabel="2026-09-21" />
    );
    expect(html).toContain("Fit scale:");
    expect(html).toContain("Print test");
    expect(html).toContain("Letter");
    expect(html).toContain("2026-09-21");
  });

  it("renders every content kind without crashing", () => {
    const design = richDesign();
    const sheet = design.sheets[0];
    const html = renderToStaticMarkup(
      <SheetPrintView design={design} sheet={sheet} dateLabel="2026-09-21" />
    );
    // wall segments, door swing, furniture label, pipe run, symbol tag, person name
    expect(html).toContain("<line");
    expect(html).toContain("<polyline");
    expect(html).toContain("<polygon");
    expect(html).toContain("Ava");
  });
});
