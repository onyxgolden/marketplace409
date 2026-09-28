// SheetPrintView + TEMA: exchangers print their real geometry (in ink, at
// plan scale, in the instance's drawing mode); every other symbol keeps
// the existing labeled-box print.

import { renderToStaticMarkup } from "react-dom/server";
import SheetPrintView from "./SheetPrintView";
import { addSheet, createEmptyDesign, placeSymbol } from "@/domains/roomDesigner/designerDocument";
import { setSymbolDrawingMode, setSymbolTemaConfig } from "@/domains/roomDesigner/temaInstances";
import { TEMA_PRESETS } from "@/domains/roomDesigner/temaTypes";

const D = "processEquipment";
function printed(mode) {
  let design = createEmptyDesign("TEMA print");
  design = placeSymbol(design, D, "tema-exchanger", 120, 60, { id: "hx", tag: "E-101" });
  design = setSymbolTemaConfig(design, "hx", TEMA_PRESETS.BEU);
  if (mode) design = setSymbolDrawingMode(design, "hx", mode);
  design = placeSymbol(design, D, "shell-tube-exchanger", 120, 160, { id: "old", tag: "E-102" });
  design = addSheet(design, "letter", "landscape");
  return renderToStaticMarkup(<SheetPrintView design={design} sheet={design.sheets[0]} dateLabel="2026-09-27" />);
}

describe("SheetPrintView — TEMA exchangers", () => {
  it("prints the detailed TEMA geometry with its tag and designation", () => {
    const html = printed();
    expect(html).toContain('data-print-tema="BEU"');
    expect(html).toContain("E-101");
    expect(html).not.toContain("#0f172a"); // no screen colors on paper
    expect(html).not.toContain("#1e293b");
  });

  it("prints the P&ID drawing when the instance is in P&ID mode", () => {
    expect(printed("pid")).not.toBe(printed());
    expect(printed("pid")).toContain(">BEU<");
  });

  it("keeps the labeled-box print for the simple exchanger", () => {
    const html = printed();
    expect(html).toContain('width="144" height="30"');
    expect(html).toContain("E-102");
  });
});
