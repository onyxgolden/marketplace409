// SheetPrintView.systems.test.jsx — printed plans carry system colors, a
// dashed underground run, and a systems legend; unassigned items stay ink.

import { renderToStaticMarkup } from "react-dom/server";
import SheetPrintView from "./SheetPrintView";
import { addPipeRun, addSheet, createEmptyDesign, placeSymbol } from "@/domains/roomDesigner/designerDocument";
import { addSystem, setMemberSystem, setPipeUnderground } from "@/domains/roomDesigner/designSystems";

function printed(build) {
  let d = addPipeRun(createEmptyDesign("P"), [{ x: 0, y: 0 }, { x: 120, y: 0 }], { id: "cw" });
  d = addPipeRun(d, [{ x: 0, y: 40 }, { x: 120, y: 40 }], { id: "plain" });
  d = placeSymbol(d, "processEquipment", "centrifugal-pump", 60, 80, { id: "p1" });
  d = build(d);
  d = addSheet(d, "letter", "landscape");
  return renderToStaticMarkup(<SheetPrintView design={d} sheet={d.sheets[0]} dateLabel="2026-09-28" />);
}

describe("printed systems", () => {
  it("unassigned plans print exactly as before: ink only, no legend", () => {
    const html = printed((d) => d);
    expect(html).not.toMatch(/data-print-legend/);
    expect(html).not.toMatch(/#22c55e/);
  });

  it("system members print in the system color with a legend; UG is dashed", () => {
    const html = printed((d) => {
      let x = addSystem(d, { name: "Cooling water", color: "#22c55e" });
      x = setMemberSystem(x, { kind: "pipe", id: "cw" }, "system_1");
      x = setMemberSystem(x, { kind: "symbol", id: "p1" }, "system_1");
      return setPipeUnderground(x, "cw", true);
    });
    expect(html).toMatch(/<polyline[^>]*stroke="#22c55e"[^>]*stroke-dasharray="8 4"/);
    expect(html).toMatch(/<rect[^>]*stroke="#22c55e"/);
    expect(html).toMatch(/data-print-legend="systems"/);
    expect(html).toMatch(/Cooling water/);
    expect(html).toMatch(/Underground/);
  });
});
