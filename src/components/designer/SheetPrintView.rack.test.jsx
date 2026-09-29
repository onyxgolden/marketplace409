import { renderToStaticMarkup } from "react-dom/server";
import SheetPrintView from "./SheetPrintView";
import { addSheet, createEmptyDesign, placeSymbol } from "@/domains/roomDesigner/designerDocument";
import { setRackParams } from "@/domains/roomDesigner/rackGeometry";

describe("printed racks", () => {
  it("prints the rack as steel (no white fill) with its TOS note", () => {
    let d = placeSymbol(createEmptyDesign("P"), "processEquipment", "pipe-rack", 300, 200, { id: "r1", tag: "PR-1" });
    d = setRackParams(d, "r1", { elevationIn: 240, tiers: 1 });
    d = placeSymbol(d, "processEquipment", "sleeper-rack", 300, 450, { id: "s1" });
    d = addSheet(d, "letter", "landscape");
    const html = renderToStaticMarkup(<SheetPrintView design={d} sheet={d.sheets[0]} dateLabel="2026-09-28" />);
    expect(html).toMatch(/data-print-rack="pipe"/);
    expect(html).toMatch(/data-print-rack="sleeper"/);
    expect(html).toMatch(/PR-1 · TOS EL 20&#x27; 0&quot; · 1 tier|PR-1 · TOS EL 20' 0" · 1 tier/);
    const rackBlock = html.slice(html.indexOf('data-print-rack="pipe"'), html.indexOf('data-print-rack="sleeper"'));
    expect(rackBlock).not.toMatch(/fill="#ffffff"/);
  });
});
