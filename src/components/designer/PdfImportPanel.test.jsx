// @vitest-environment jsdom

// PdfImportPanel: staged PDF import — choose/drop a file → (page picker) →
// prepare → preview + scale calibration → explicit commit.
//
// The importer pipeline is mocked here; these tests pin the UI contract. The
// pipeline itself is covered by pdfImport.contract.test.js. pdfErrors and
// pdfScale are left REAL, so the .ai/.eps refusal wording and the plot-scale
// presets are the ones users actually see.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import PdfImportPanel from "./PdfImportPanel";
import {
  applyVectorScale,
  listPdfPages,
  preparePdfImport,
} from "@/domains/roomDesigner/importers/pdf/pdfImporter";

vi.mock("@/domains/roomDesigner/importers/pdf/pdfImporter", () => ({
  listPdfPages: vi.fn(),
  preparePdfImport: vi.fn(),
  applyVectorScale: vi.fn(),
}));

// The panel reaches pdfErrors and pdfScale through dynamic import(). Importing
// them statically here warms the module cache, so those imports settle in a
// microtask instead of taking a first-load transform — otherwise assertions
// race the panel's own async chain.
import "@/domains/roomDesigner/importers/pdf/pdfErrors";
import "@/domains/roomDesigner/importers/pdf/pdfScale";

const emptyRecords = () => ({
  walls: [], rooms: [], openings: [], pipes: [], symbols: [], furniture: [], annotations: [],
});

const vectorPrepared = (over = {}) => ({
  mode: "vector",
  importId: "p1-abc",
  pageNumber: 1,
  pageCount: 1,
  pageSizeIn: { widthIn: 8.5, heightIn: 11 },
  pageKind: { kind: "vector", reason: "400 vector paths and no images." },
  records: { ...emptyRecords(), walls: [{ id: "w1" }, { id: "w2" }] },
  counts: { paths: 3, walls: 2, skippedPaths: 1, droppedShortSegments: 0, filledOutlinePaths: 0 },
  bounds: { minX: 0, minY: 0, maxX: 288, maxY: 216, width: 288, height: 216 },
  paperBounds: { minX: 0, minY: 0, maxX: 6, maxY: 4.5, width: 6, height: 4.5 },
  longestRun: { lengthIn: 6, a: { x: 0, y: 0 }, b: { x: 6, y: 0 } },
  scale: { factor: 48, label: '1/4" = 1\'-0"' },
  options: { minSegmentIn: 6, includeDashed: false },
  paperPaths: [],
  parseIssues: [],
  issues: [],
  ...over,
});

const rasterPrepared = (over = {}) => ({
  mode: "raster",
  importId: "p2-xyz",
  pageNumber: 2,
  pageCount: 2,
  pageSizeIn: { widthIn: 36, heightIn: 24 },
  pageKind: { kind: "raster", reason: "1 image and only 0 vector paths — this page is a scan." },
  image: { name: "scan.pdf — page 2", mimeType: "image/png", dataUrl: "data:image/png;base64,x", widthPx: 3600, heightPx: 2400, pxPerIn: 100 },
  plan: { dpi: 100, requestedDpi: 150, downgraded: true, widthPx: 3600, heightPx: 2400, pageWidthIn: 36, pageHeightIn: 24, pxPerIn: 100 },
  scale: { factor: 1, label: "Full size (1:1)" },
  options: { dpi: 150 },
  issues: [],
  ...over,
});

describe("PdfImportPanel", () => {
  let container;
  let root;
  let dispatch;

  const renderPanel = (design = { underlay: null }) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => {
      root.render(<PdfImportPanel design={design} dispatch={dispatch} />);
    });
  };

  // The panel loads its modules with dynamic import(), so a single act()
  // flush is not enough: the promise chain needs real ticks to settle.
  const flush = async (ticks = 6) => {
    for (let i = 0; i < ticks; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };

  /** Flush until `predicate` holds, so a slow import cannot make a test flaky. */
  const waitFor = async (predicate, what = "condition") => {
    for (let i = 0; i < 40; i += 1) {
      if (predicate()) return;
      await flush(1);
    }
    throw new Error(`Timed out waiting for ${what}. Rendered: ${container.textContent}`);
  };

  const waitForText = (text) =>
    waitFor(() => container.textContent.includes(text), `text "${text}"`);

  const chooseFile = async (name, type = "application/pdf") => {
    const file = new File(["fake-pdf-bytes"], name, { type });
    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await flush();
  };

  const dropFile = async (name, type = "application/pdf") => {
    const file = new File(["bytes"], name, { type });
    const zone = container.querySelector('[data-testid="pdf-dropzone"]');
    const event = new window.MouseEvent("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    await act(async () => {
      zone.dispatchEvent(event);
    });
    await flush();
  };

  const clickText = async (text) => {
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent.includes(text));
    expect(button, `button "${text}"`).toBeTruthy();
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flush();
  };

  /**
   * Set a controlled field's value. React tracks the DOM value it last wrote,
   * so assigning `element.value` directly is swallowed; the value has to go
   * through the prototype's native setter for React to see a change.
   */
  const setField = async (label, value) => {
    const field = container.querySelector(`[aria-label="${label}"]`);
    expect(field, `field "${label}"`).toBeTruthy();
    const prototype =
      field.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
    await act(async () => {
      setter.call(field, String(value));
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
      field.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await flush();
  };

  /** React drives radio/checkbox onChange from the click event. */
  const toggle = async (element) => {
    await act(async () => {
      element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flush();
  };

  const pickKnownDimensionMode = async () => {
    const radios = [...container.querySelectorAll('input[type="radio"]')];
    expect(radios).toHaveLength(2);
    await toggle(radios[1]);
    return radios;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
  });

  // ---- format scope: .ai / .eps are out of scope and must say so ----

  it("refuses a dropped .ai file by name, with what to do instead", async () => {
    renderPanel();
    await dropFile("artwork.ai", "application/illustrator");
    await waitForText("Illustrator");
    expect(container.textContent).toContain("Save As");
    expect(vi.mocked(listPdfPages)).not.toHaveBeenCalled();
  });

  it("refuses a dropped .eps file by name, with what to do instead", async () => {
    renderPanel();
    await dropFile("detail.eps", "application/postscript");
    await waitForText("PostScript");
    expect(container.textContent).toContain("to PDF");
    expect(vi.mocked(listPdfPages)).not.toHaveBeenCalled();
  });

  it("refuses a chosen .ai file too, not just a dropped one", async () => {
    renderPanel();
    await chooseFile("artwork.ai", "");
    await waitForText("Illustrator");
  });

  it("refuses a non-PDF plainly", async () => {
    renderPanel();
    await chooseFile("plan.dwg", "");
    await waitForText("Only PDF files");
  });

  it("says up front that .ai and .eps are not supported", () => {
    renderPanel();
    expect(container.textContent).toContain(".ai and .eps are not supported");
  });

  it("recovers to the idle state after a refusal", async () => {
    renderPanel();
    await dropFile("artwork.ai");
    await waitForText("Illustrator");
    await clickText("Try another file");
    expect(container.querySelector('[data-testid="pdf-dropzone"]')).toBeTruthy();
  });

  // ---- page picker ----

  it("skips the picker for a single-page PDF and lands on preview", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 1, surveyedCount: 1,
      pages: [{ pageNumber: 1, widthIn: 8.5, heightIn: 11, kind: "vector", kindReason: "vector", pathCount: 400, imageCount: 0 }],
    });
    vi.mocked(preparePdfImport).mockResolvedValue(vectorPrepared());
    renderPanel();
    await chooseFile("plan.pdf");
    await waitForText("Editable wall segments");
    expect(container.textContent).not.toContain("which one should be imported?");
    expect(container.textContent).toContain("Page 1");
    expect(vi.mocked(preparePdfImport)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(preparePdfImport).mock.calls[0][1]).toMatchObject({ pageNumber: 1, mode: "vector" });
  });

  it("shows a picker for a multi-page PDF, labelling each page's kind", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 2, surveyedCount: 2,
      pages: [
        { pageNumber: 1, widthIn: 36, heightIn: 24, kind: "vector", kindReason: "900 vector paths and no images.", pathCount: 900, imageCount: 0 },
        { pageNumber: 2, widthIn: 36, heightIn: 24, kind: "raster", kindReason: "1 image and only 0 vector paths — this page is a scan.", pathCount: 0, imageCount: 1 },
      ],
    });
    renderPanel();
    await chooseFile("set.pdf");
    await waitForText("which one should be imported?");
    expect(container.textContent).toContain("vector");
    expect(container.textContent).toContain("scanned");
    expect(container.textContent).toContain("this page is a scan");
    expect(vi.mocked(preparePdfImport)).not.toHaveBeenCalled();
  });

  it("offers a scanned page only as an underlay, never as editable walls", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 2, surveyedCount: 2,
      pages: [
        { pageNumber: 1, widthIn: 36, heightIn: 24, kind: "raster", kindReason: "scan", pathCount: 0, imageCount: 1 },
        { pageNumber: 2, widthIn: 36, heightIn: 24, kind: "raster", kindReason: "scan", pathCount: 0, imageCount: 1 },
      ],
    });
    renderPanel();
    await chooseFile("scans.pdf");
    await waitForText("which one should be imported?");
    const labels = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels.filter((l) => l.includes("As editable walls"))).toHaveLength(0);
    expect(labels.filter((l) => l.includes("As image underlay"))).toHaveLength(2);
  });

  it("prepares the page and mode the user picked", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 2, surveyedCount: 2,
      pages: [
        { pageNumber: 1, widthIn: 8.5, heightIn: 11, kind: "vector", kindReason: "v", pathCount: 900, imageCount: 0 },
        { pageNumber: 2, widthIn: 8.5, heightIn: 11, kind: "mixed", kindReason: "m", pathCount: 900, imageCount: 1 },
      ],
    });
    vi.mocked(preparePdfImport).mockResolvedValue(rasterPrepared());
    renderPanel();
    await chooseFile("set.pdf");
    await waitForText("which one should be imported?");
    const buttons = [...container.querySelectorAll("button")].filter((b) => b.textContent.includes("As image underlay"));
    await act(async () => {
      buttons[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(vi.mocked(preparePdfImport).mock.calls[0][1]).toMatchObject({ pageNumber: 2, mode: "raster" });
  });

  it("says when only some pages of a long PDF were surveyed", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 400, surveyedCount: 100,
      pages: [
        { pageNumber: 1, widthIn: 8.5, heightIn: 11, kind: "vector", kindReason: "v", pathCount: 900, imageCount: 0 },
        { pageNumber: 2, widthIn: 8.5, heightIn: 11, kind: "vector", kindReason: "v", pathCount: 900, imageCount: 0 },
      ],
    });
    renderPanel();
    await chooseFile("big.pdf");
    await waitForText("first 100 surveyed");
  });

  // ---- vector preview + scale calibration ----

  it("previews the editable wall count, the applied scale and the real extent", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 1, surveyedCount: 1,
      pages: [{ pageNumber: 1, widthIn: 8.5, heightIn: 11, kind: "vector", kindReason: "v", pathCount: 900, imageCount: 0 }],
    });
    vi.mocked(preparePdfImport).mockResolvedValue(vectorPrepared());
    renderPanel();
    await chooseFile("plan.pdf");
    await waitForText("Editable wall segments");
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("1/4\" = 1'-0\"");
    // 288 x 216 inches is 24' x 18'.
    expect(container.textContent).toContain("24'");
    expect(container.textContent).toContain("18'");
  });

  it("re-derives the preview when a different plot scale is chosen", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 1, surveyedCount: 1,
      pages: [{ pageNumber: 1, widthIn: 8.5, heightIn: 11, kind: "vector", kindReason: "v", pathCount: 900, imageCount: 0 }],
    });
    vi.mocked(preparePdfImport).mockResolvedValue(vectorPrepared());
    vi.mocked(applyVectorScale).mockImplementation((prep, opts) => ({
      ...prep,
      scale: { factor: opts.scaleFactor, label: `1:${opts.scaleFactor}` },
    }));
    renderPanel();
    await chooseFile("plan.pdf");
    await waitForText("Editable wall segments");
    await setField("Plot scale", "arch-1-8");
    await waitFor(() => vi.mocked(applyVectorScale).mock.calls.length > 0, "a re-scale");
    // 1/8" = 1'-0" is 96 real inches per paper inch.
    expect(vi.mocked(applyVectorScale).mock.calls[0][1]).toEqual({ scaleFactor: 96 });
    // Re-scaling must never re-parse the file.
    expect(vi.mocked(preparePdfImport)).toHaveBeenCalledTimes(1);
  });

  it("calibrates from a known real-world dimension", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 1, surveyedCount: 1,
      pages: [{ pageNumber: 1, widthIn: 8.5, heightIn: 11, kind: "vector", kindReason: "v", pathCount: 900, imageCount: 0 }],
    });
    vi.mocked(preparePdfImport).mockResolvedValue(vectorPrepared());
    vi.mocked(applyVectorScale).mockImplementation((prep, opts) => ({
      ...prep,
      scale: { factor: opts.scaleFactor, label: `1:${opts.scaleFactor}` },
    }));
    renderPanel();
    await chooseFile("plan.pdf");
    await waitForText("Editable wall segments");

    // Switch to the known-dimension mode and say the 6" paper run is 24 feet.
    await pickKnownDimensionMode();
    expect(container.textContent).toContain("6.000″");
    await setField("Known real-world length", "24");
    await clickText("Apply");
    await waitFor(() => vi.mocked(applyVectorScale).mock.calls.length > 0, "a re-scale");
    // 24 feet = 288 inches over a 6-inch paper run → 48×.
    expect(vi.mocked(applyVectorScale).mock.calls.at(-1)[1]).toEqual({ scaleFactor: 48 });
  });

  it("reports a bad known dimension instead of applying it", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 1, surveyedCount: 1,
      pages: [{ pageNumber: 1, widthIn: 8.5, heightIn: 11, kind: "vector", kindReason: "v", pathCount: 900, imageCount: 0 }],
    });
    vi.mocked(preparePdfImport).mockResolvedValue(vectorPrepared());
    renderPanel();
    await chooseFile("plan.pdf");
    await waitForText("Editable wall segments");
    await pickKnownDimensionMode();
    await setField("Known real-world length", "0");
    await clickText("Apply");
    await waitForText("positive");
    expect(vi.mocked(applyVectorScale)).not.toHaveBeenCalled();
  });

  it("disables known-dimension calibration when nothing can be measured", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 1, surveyedCount: 1,
      pages: [{ pageNumber: 1, widthIn: 8.5, heightIn: 11, kind: "vector", kindReason: "v", pathCount: 900, imageCount: 0 }],
    });
    vi.mocked(preparePdfImport).mockResolvedValue(vectorPrepared({ longestRun: null }));
    renderPanel();
    await chooseFile("plan.pdf");
    await waitForText("Editable wall segments");
    const radios = [...container.querySelectorAll('input[type="radio"]')];
    expect(radios[1].disabled).toBe(true);
  });

  it("re-derives the preview when the noise filter or dashed option changes", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 1, surveyedCount: 1,
      pages: [{ pageNumber: 1, widthIn: 8.5, heightIn: 11, kind: "vector", kindReason: "v", pathCount: 900, imageCount: 0 }],
    });
    vi.mocked(preparePdfImport).mockResolvedValue(vectorPrepared());
    vi.mocked(applyVectorScale).mockImplementation((prep) => prep);
    renderPanel();
    await chooseFile("plan.pdf");
    await waitForText("Editable wall segments");

    await setField("Minimum line length", "24");
    await waitFor(() => vi.mocked(applyVectorScale).mock.calls.length > 0, "a re-derive");
    expect(vi.mocked(applyVectorScale).mock.calls.at(-1)[1]).toEqual({ minSegmentIn: 24 });

    const callsBefore = vi.mocked(applyVectorScale).mock.calls.length;
    await toggle(container.querySelector('input[type="checkbox"]'));
    await waitFor(
      () => vi.mocked(applyVectorScale).mock.calls.length > callsBefore,
      "a dashed-option re-derive",
    );
    expect(vi.mocked(applyVectorScale).mock.calls.at(-1)[1]).toEqual({ includeDashed: true });
  });

  // ---- commit ----

  it("commits a vector import as one dispatched result and reports what landed", async () => {
    const prepared = vectorPrepared();
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 1, surveyedCount: 1,
      pages: [{ pageNumber: 1, widthIn: 8.5, heightIn: 11, kind: "vector", kindReason: "v", pathCount: 900, imageCount: 0 }],
    });
    vi.mocked(preparePdfImport).mockResolvedValue(prepared);
    renderPanel();
    await chooseFile("plan.pdf");
    await waitForText("Editable wall segments");
    await clickText("Import this page");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "IMPORT_PDF_RESULT", importResult: prepared });
    expect(container.textContent).toContain("Imported 2 editable wall segments");
    expect(container.textContent).toContain("1/4\" = 1'-0\"");
  });

  it("does not commit anything while previewing", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 1, surveyedCount: 1,
      pages: [{ pageNumber: 1, widthIn: 8.5, heightIn: 11, kind: "vector", kindReason: "v", pathCount: 900, imageCount: 0 }],
    });
    vi.mocked(preparePdfImport).mockResolvedValue(vectorPrepared());
    renderPanel();
    await chooseFile("plan.pdf");
    await waitForText("Editable wall segments");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("discards a preview without dispatching", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 1, surveyedCount: 1,
      pages: [{ pageNumber: 1, widthIn: 8.5, heightIn: 11, kind: "vector", kindReason: "v", pathCount: 900, imageCount: 0 }],
    });
    vi.mocked(preparePdfImport).mockResolvedValue(vectorPrepared());
    renderPanel();
    await chooseFile("plan.pdf");
    await waitForText("Editable wall segments");
    await clickText("Discard");
    expect(dispatch).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="pdf-dropzone"]')).toBeTruthy();
  });

  // ---- scanned page ----

  it("previews a scanned page's resolution and plan width", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 1, surveyedCount: 1,
      pages: [{ pageNumber: 1, widthIn: 36, heightIn: 24, kind: "raster", kindReason: "scan", pathCount: 0, imageCount: 1 }],
    });
    vi.mocked(preparePdfImport).mockResolvedValue(rasterPrepared());
    renderPanel();
    await chooseFile("scan.pdf");
    await waitForText("3600 × 2400 px @ 100 DPI");
    expect(container.textContent).toContain("Calibrate scale");
    expect(container.textContent).toContain("Place this page");
  });

  it("re-renders a scanned page when the resolution changes", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 1, surveyedCount: 1,
      pages: [{ pageNumber: 1, widthIn: 36, heightIn: 24, kind: "raster", kindReason: "scan", pathCount: 0, imageCount: 1 }],
    });
    vi.mocked(preparePdfImport).mockResolvedValue(rasterPrepared());
    renderPanel();
    await chooseFile("scan.pdf");
    await waitForText("3600 × 2400 px @ 100 DPI");
    await setField("Render resolution", "300");
    await waitFor(() => vi.mocked(preparePdfImport).mock.calls.length === 2, "a re-render");
    expect(vi.mocked(preparePdfImport).mock.calls[1][1]).toMatchObject({ mode: "raster", dpi: 300 });
  });

  it("commits a scanned page as an underlay and then offers the calibrate tool", async () => {
    const prepared = rasterPrepared();
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 1, surveyedCount: 1,
      pages: [{ pageNumber: 1, widthIn: 36, heightIn: 24, kind: "raster", kindReason: "scan", pathCount: 0, imageCount: 1 }],
    });
    vi.mocked(preparePdfImport).mockResolvedValue(prepared);
    // The design now has the underlay the commit just set.
    renderPanel({ underlay: { id: "u1", name: "scan", pxPerIn: 100, widthPx: 3600, heightPx: 2400 } });
    await chooseFile("scan.pdf");
    await waitForText("Place this page");
    await clickText("Place this page");
    expect(dispatch).toHaveBeenCalledWith({ type: "IMPORT_PDF_RESULT", importResult: prepared });
    expect(container.textContent).toContain("Placed page 2");

    await clickText("Calibrate scale");
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_TOOL", tool: "calibrate" });
  });

  // ---- notes and failures ----

  it("surfaces import notes for review", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 1, surveyedCount: 1,
      pages: [{ pageNumber: 1, widthIn: 8.5, heightIn: 11, kind: "vector", kindReason: "v", pathCount: 900, imageCount: 0 }],
    });
    vi.mocked(preparePdfImport).mockResolvedValue(
      vectorPrepared({
        issues: [{ provenance: "Page 1", message: "3 paths skipped: dashed stroke." }],
      }),
    );
    renderPanel();
    await chooseFile("plan.pdf");
    await waitForText("1 note");
    expect(container.textContent).toContain("dashed stroke");
  });

  it("reports a survey failure without crashing", async () => {
    vi.mocked(listPdfPages).mockRejectedValue(new Error("This PDF is password-protected."));
    renderPanel();
    await chooseFile("locked.pdf");
    await waitForText("password-protected");
  });

  it("reports a prepare failure without crashing", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 1, surveyedCount: 1,
      pages: [{ pageNumber: 1, widthIn: 8.5, heightIn: 11, kind: "vector", kindReason: "v", pathCount: 900, imageCount: 0 }],
    });
    vi.mocked(preparePdfImport).mockRejectedValue(new Error("A path exceeds the flattened-point cap."));
    renderPanel();
    await chooseFile("evil.pdf");
    await waitForText("flattened-point cap");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("states that the import is local and that a PDF has no wall semantics", () => {
    renderPanel();
    expect(container.textContent).toContain("nothing is uploaded");
    expect(container.textContent).toContain("A PDF carries no wall/door information");
    expect(container.textContent).toContain("title block and dimension line included");
  });
});
