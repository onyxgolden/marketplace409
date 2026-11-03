// @vitest-environment jsdom

// HomePlanImportPanel (H1/G5): preview before commit, cancel leaves the
// prior image intact, replacing needs explicit confirmation, imports
// commit locked, PDFs go raster-only (never editable walls), and SVG/HTML
// are refused as active content. The importer pipeline and the image
// decoder are mocked here; both are covered by their own suites, and
// pdfErrors stays REAL so the PDF gate wording is the one users see.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import HomePlanImportPanel, { HOME_IMPORT_NO_REDRAW_COPY } from "./HomePlanImportPanel";
import {
  listPdfPages,
  preparePdfImport,
} from "@/domains/roomDesigner/importers/pdf/pdfImporter";
import { decodeUnderlayFile } from "./underlayImage";

vi.mock("@/domains/roomDesigner/importers/pdf/pdfImporter", () => ({
  listPdfPages: vi.fn(),
  preparePdfImport: vi.fn(),
}));

vi.mock("./underlayImage", async (importOriginal) => ({
  ...(await importOriginal()),
  decodeUnderlayFile: vi.fn(),
}));

// Warm the real pdfErrors module cache so the panel's dynamic import
// settles in a microtask instead of racing the test's assertions.
import "@/domains/roomDesigner/importers/pdf/pdfErrors";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const rasterPrepared = (over = {}) => ({
  mode: "raster",
  importId: "p1-abc",
  pageNumber: 1,
  pageCount: 1,
  pageSizeIn: { widthIn: 36, heightIn: 24 },
  pageKind: { kind: "raster", reason: "scan" },
  image: {
    name: "plan.pdf — page 1",
    mimeType: "image/png",
    dataUrl: TINY_PNG,
    widthPx: 3600,
    heightPx: 2400,
    pxPerIn: 100,
  },
  plan: { dpi: 150, widthPx: 3600, heightPx: 2400, pageWidthIn: 36, pageHeightIn: 24, pxPerIn: 100 },
  scale: { factor: 1, label: "Full size (1:1)" },
  options: { dpi: 150 },
  issues: [],
  ...over,
});

describe("HomePlanImportPanel", () => {
  let container;
  let root;
  let dispatch;

  const renderPanel = (design = { underlay: null }) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => {
      root.render(<HomePlanImportPanel design={design} dispatch={dispatch} onClose={() => {}} />);
    });
  };

  const flush = async (ticks = 6) => {
    for (let i = 0; i < ticks; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };

  const waitFor = async (predicate, what = "condition") => {
    for (let i = 0; i < 40; i += 1) {
      if (predicate()) return;
      await flush(1);
    }
    throw new Error(`Timed out waiting for ${what}. Rendered: ${container.textContent}`);
  };

  const waitForText = (text) =>
    waitFor(() => container.textContent.includes(text), `text "${text}"`);

  const chooseFile = async (name, type) => {
    const file = new File(["fake-bytes"], name, { type });
    const input = container.querySelector('[data-testid="home-import-file"]');
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await flush();
  };

  const clickTestId = async (testId) => {
    const el = container.querySelector(`[data-testid="${testId}"]`);
    expect(el, `element ${testId}`).toBeTruthy();
    await act(async () => {
      el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flush();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(decodeUnderlayFile).mockResolvedValue({
      dataUrl: TINY_PNG,
      widthPx: 800,
      heightPx: 600,
      mimeType: "image/png",
    });
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
  });

  it("states the no-redraw distinction in the UI itself", () => {
    renderPanel();
    expect(container.textContent).toContain(HOME_IMPORT_NO_REDRAW_COPY);
    expect(container.textContent).toContain("does not become editable FORGE walls or rooms");
  });

  it("previews an image and commits it locked with print inclusion on", async () => {
    renderPanel();
    await chooseFile("plan.png", "image/png");
    await waitForText("Preview — inspect before committing");
    await clickTestId("home-import-commit");
    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.mock.calls[0][0];
    expect(action.type).toBe("SET_UNDERLAY");
    expect(action.underlay.locked).toBe(true);
    expect(action.underlay.printInclude).toBe(true);
    expect(action.underlay.widthPx).toBe(800);
    await waitForText("Calibrate its scale");
  });

  it("cancel leaves the prior image intact: no dispatch at all", async () => {
    renderPanel({ underlay: { name: "old.png", dataUrl: TINY_PNG } });
    await chooseFile("plan.png", "image/png");
    await waitForText("Preview — inspect before committing");
    await clickTestId("home-import-cancel");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("replacing an existing underlay needs explicit confirmation", async () => {
    renderPanel({ underlay: { name: "old.png", dataUrl: TINY_PNG } });
    await chooseFile("plan.png", "image/png");
    await waitForText("Replace the existing reference plan");
    const commit = container.querySelector('[data-testid="home-import-commit"]');
    expect(commit.disabled).toBe(true);
    await clickTestId("home-import-replace-confirm");
    expect(container.querySelector('[data-testid="home-import-commit"]').disabled).toBe(false);
    await clickTestId("home-import-commit");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].type).toBe("SET_UNDERLAY");
  });

  it("refuses an SVG upload as active content, never rendering it", async () => {
    renderPanel();
    await chooseFile("plan.svg", "image/svg+xml");
    await waitForText("never used as underlays");
    expect(vi.mocked(decodeUnderlayFile)).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("places a single-page PDF as a locked raster underlay, never walls", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 1,
      surveyedCount: 1,
      pages: [{ pageNumber: 1, widthIn: 36, heightIn: 24, kind: "raster", kindReason: "scan" }],
    });
    vi.mocked(preparePdfImport).mockResolvedValue(rasterPrepared());
    renderPanel();
    await chooseFile("plan.pdf", "application/pdf");
    await waitForText("Preview — inspect before committing");
    expect(vi.mocked(preparePdfImport)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: "raster", pageNumber: 1 }),
    );
    expect(container.textContent).not.toContain("editable walls");
    await clickTestId("home-import-commit");
    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.mock.calls[0][0];
    expect(action.type).toBe("SET_UNDERLAY");
    expect(action.underlay.locked).toBe(true);
    expect(action.underlay.pxPerIn).toBe(100);
  });

  it("lets the user pick one page of a multi-page PDF", async () => {
    vi.mocked(listPdfPages).mockResolvedValue({
      pageCount: 2,
      surveyedCount: 2,
      pages: [
        { pageNumber: 1, widthIn: 36, heightIn: 24, kind: "raster", kindReason: "scan" },
        { pageNumber: 2, widthIn: 36, heightIn: 24, kind: "mixed", kindReason: "both" },
      ],
    });
    vi.mocked(preparePdfImport).mockResolvedValue(
      rasterPrepared({ pageNumber: 2, pageKind: { kind: "mixed", reason: "both" } }),
    );
    renderPanel();
    await chooseFile("plan.pdf", "application/pdf");
    await waitForText("which one should be placed");
    const pageButtons = [...container.querySelectorAll("button")].filter((b) =>
      b.textContent.includes("Preview this page as reference image"),
    );
    expect(pageButtons).toHaveLength(2);
    await act(async () => {
      pageButtons[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flush();
    await waitForText("Preview — inspect before committing");
    expect(vi.mocked(preparePdfImport)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: "raster", pageNumber: 2 }),
    );
    // A mixed page is flattened to one reference image, and the UI says so.
    await waitForText("mixes vector lines");
  });

  it("refuses a password-protected PDF with the importer's named error", async () => {
    vi.mocked(listPdfPages).mockRejectedValue(
      new Error("This PDF is password-protected — open it and re-save it without a password first."),
    );
    renderPanel();
    await chooseFile("locked.pdf", "application/pdf");
    await waitForText("password-protected");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("refuses a corrupt image with the decoder's named error", async () => {
    vi.mocked(decodeUnderlayFile).mockRejectedValue(
      new Error("Could not read that image — the format may be unsupported."),
    );
    renderPanel();
    await chooseFile("broken.png", "image/png");
    await waitForText("Could not read that image");
    expect(dispatch).not.toHaveBeenCalled();
  });
});
