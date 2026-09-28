// SheetPrintView + plan symbols: recognizable furniture prints as ink line
// work at plan scale; pieces without a symbol keep the outline + label.

import { renderToStaticMarkup } from "react-dom/server";
import SheetPrintView from "./SheetPrintView";
import { addSheet, createEmptyDesign, placeFurniture } from "@/domains/roomDesigner/designerDocument";

function printed() {
  let design = createEmptyDesign("Furniture print");
  design = placeFurniture(design, "bed-queen", 60, 60, 0);
  design = placeFurniture(design, "toilet", 160, 40, 90);
  design = placeFurniture(design, "sofa-3seat", 80, 200, 0);
  design = addSheet(design, "letter", "landscape");
  return renderToStaticMarkup(<SheetPrintView design={design} sheet={design.sheets[0]} dateLabel="2026-09-27" />);
}

describe("SheetPrintView — furniture plan symbols", () => {
  it("prints the bed and toilet as their plan symbols in ink, placed and rotated", () => {
    const html = printed();
    expect(html).toContain('data-print-plan-symbol="bed-queen"');
    expect((html.match(/data-role="pillow"/g) || []).length).toBe(2);
    expect(html).toContain('data-print-plan-symbol="toilet"');
    expect(html).toContain("translate(160 40) rotate(90)");
    expect(html).not.toContain("#f5f7fa"); // no screen porcelain fill on paper
  });

  it("keeps the outline + label print for a sofa", () => {
    const html = printed();
    expect(html).toContain("Sofa (3-seat)");
    expect(html).not.toContain('data-print-plan-symbol="sofa-3seat"');
  });
});
