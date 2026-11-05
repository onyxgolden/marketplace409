// H1/G5 — print inclusion for the underlay: explicit on/off, hidden
// means printed nowhere, quarter-turn rotation renders, the frozen
// preview snapshot wins over later screen toggles, and a printed sheet
// that shows the reference image labels it as reference artwork.

import { renderToStaticMarkup } from "react-dom/server";
import SheetPrintView, { sheetShowsUnderlay } from "./SheetPrintView";
import {
  addSheet,
  createEmptyDesign,
  setUnderlay,
  updateUnderlay,
} from "@/domains/roomDesigner/designerDocument";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function designWithUnderlay(patch = {}) {
  let design = setUnderlay(createEmptyDesign("Print H1"), {
    name: "ref.png",
    mimeType: "image/png",
    dataUrl: TINY_PNG,
    widthPx: 100,
    heightPx: 100,
  });
  if (Object.keys(patch).length > 0) design = updateUnderlay(design, patch);
  return addSheet(design, "letter", "landscape");
}

function printHtml(design, extraProps = {}) {
  return renderToStaticMarkup(
    <SheetPrintView design={design} sheet={design.sheets[0]} dateLabel="2026-11-02" {...extraProps} />,
  );
}

describe("H1 print inclusion", () => {
  it("prints the underlay by default, with the reference-artwork caption", () => {
    const design = designWithUnderlay();
    const html = printHtml(design);
    expect(html).toContain(TINY_PNG);
    expect(html).toContain("Reference artwork");
    expect(html).toContain("not FORGE measurements");
    expect(sheetShowsUnderlay(design)).toBe(true);
  });

  it("printInclude off removes the underlay AND the caption from print", () => {
    const design = designWithUnderlay({ printInclude: false });
    const html = printHtml(design);
    expect(html).not.toContain(TINY_PNG);
    expect(html).not.toContain("Reference artwork");
    expect(sheetShowsUnderlay(design)).toBe(false);
  });

  it("hidden removes the underlay from print without deleting it", () => {
    const design = designWithUnderlay({ visible: false });
    const html = printHtml(design);
    expect(html).not.toContain(TINY_PNG);
    expect(design.underlay).not.toBeNull();
    expect(design.underlay.dataUrl).toBe(TINY_PNG);
    expect(sheetShowsUnderlay(design)).toBe(false);
  });

  it("renders a quarter-turn rotation about the image center", () => {
    const design = designWithUnderlay({ rotationDeg: 90 });
    const html = printHtml(design);
    expect(html).toContain("rotate(90");
    expect(html).toContain(TINY_PNG);
  });

  it("a frozen preview snapshot beats later screen toggles", () => {
    const frozen = designWithUnderlay();
    const frozenRecord = { ...frozen.underlay };
    // Screen toggles after the preview opened: hidden + excluded.
    const later = designWithUnderlay({ visible: false, printInclude: false });
    const html = printHtml(later, { underlaySnapshot: frozenRecord });
    expect(html).toContain(TINY_PNG);
    expect(html).toContain("Reference artwork");
    expect(sheetShowsUnderlay(later, frozenRecord)).toBe(true);
    // And the reverse: frozen off stays off even if the screen turns it on.
    const frozenOff = { ...frozenRecord, printInclude: false };
    const htmlOff = printHtml(frozen, { underlaySnapshot: frozenOff });
    expect(htmlOff).not.toContain(TINY_PNG);
  });

  it("legacy records without the new fields still print (fail-soft defaults)", () => {
    let design = designWithUnderlay();
    const legacy = { ...design.underlay };
    delete legacy.visible;
    delete legacy.printInclude;
    delete legacy.rotationDeg;
    design = { ...design, underlay: legacy };
    const html = printHtml(design);
    expect(html).toContain(TINY_PNG);
    expect(sheetShowsUnderlay(design)).toBe(true);
  });

  it("no underlay prints no image and no caption", () => {
    const design = addSheet(createEmptyDesign("Empty"), "letter", "landscape");
    const html = printHtml(design);
    expect(html).not.toContain("Reference artwork");
    expect(sheetShowsUnderlay(design)).toBe(false);
  });
});
