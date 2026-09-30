// SheetPrintView.doorSwing.test.jsx — printed doors match the screen: the
// arc swings to the same face as the plan canvas and follows the stored
// hinge side / swing face.

import { renderToStaticMarkup } from "react-dom/server";
import SheetPrintView from "./SheetPrintView";
import { addOpening, addSheet, addWall, createEmptyDesign } from "@/domains/roomDesigner/designerDocument";

// Wall along +x at y=100; door gap x 60..96. Screen/positive face = -y.
function printedDoor(fields = {}) {
  let d = addWall(createEmptyDesign("P"), { x: 0, y: 100 }, { x: 240, y: 100 });
  d = addOpening(d, d.walls[0].id, { type: "door", offsetIn: 60, widthIn: 36 });
  d = { ...d, openings: [{ ...d.openings[0], ...fields }] };
  d = addSheet(d, "letter", "landscape");
  const html = renderToStaticMarkup(<SheetPrintView design={d} sheet={d.sheets[0]} />);
  const arc = /<path d="M ([\d.-]+) ([\d.-]+) A 36 36 0 0 ([01]) ([\d.-]+) ([\d.-]+)"/.exec(html);
  const [, sx, sy, , ex, ey] = arc.map(Number);
  return { start: { x: sx, y: sy }, end: { x: ex, y: ey } };
}

describe("printed door swing", () => {
  it("prints real coordinates for doors and windows (no NaN/undefined)", () => {
    let d = addWall(createEmptyDesign("P"), { x: 0, y: 100 }, { x: 240, y: 100 });
    d = addOpening(d, d.walls[0].id, { type: "door", offsetIn: 60, widthIn: 36 });
    d = addOpening(d, d.walls[0].id, { type: "window", offsetIn: 150, widthIn: 48 });
    d = addSheet(d, "letter", "landscape");
    const html = renderToStaticMarkup(<SheetPrintView design={d} sheet={d.sheets[0]} />);
    expect(html).not.toMatch(/NaN|undefined/);
  });

  it.each([
    [{}, { x: 96, y: 100 }, { x: 60, y: 64 }],
    [{ hinge: "end" }, { x: 60, y: 100 }, { x: 96, y: 64 }],
    [{ swing: "negative" }, { x: 96, y: 100 }, { x: 60, y: 136 }],
    [{ hinge: "end", swing: "negative" }, { x: 60, y: 100 }, { x: 96, y: 136 }],
  ])("%o: arc runs from the latch to the open leaf tip", (fields, latch, tip) => {
    const { start, end } = printedDoor(fields);
    expect(start.x).toBeCloseTo(latch.x, 4);
    expect(start.y).toBeCloseTo(latch.y, 4);
    expect(end.x).toBeCloseTo(tip.x, 4);
    expect(end.y).toBeCloseTo(tip.y, 4);
  });
});
