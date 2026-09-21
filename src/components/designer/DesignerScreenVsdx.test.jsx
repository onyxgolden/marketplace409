// @vitest-environment jsdom

// VsdxImportSection: staged .vsdx import — choose file → (page picker) →
// prepare → preview → explicit commit. The importer module is mocked; these
// tests pin the UI contract, not the pipeline.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { VsdxImportSection } from "./DesignerScreen";
import {
  listVsdxPages,
  prepareVsdxImport,
} from "@/domains/roomDesigner/importers/vsdx/visioImporter";

vi.mock("@/domains/roomDesigner/importers/vsdx/visioImporter", () => ({
  listVsdxPages: vi.fn(),
  prepareVsdxImport: vi.fn(),
}));

const emptyRecords = () => ({
  walls: [],
  rooms: [],
  openings: [],
  pipes: [],
  symbols: [],
  furniture: [],
  annotations: [],
});

const preparedFixture = (over = {}) => ({
  page: { id: "p1", name: "Page-1", index: 0 },
  pageHeightIn: 8.5,
  shapeCount: 2,
  records: { ...emptyRecords(), walls: [{ id: "w1" }], ...over.records },
  counts: { mapped: 1, annotationShapes: 0, annotations: 0, skipped: 0 },
  issues: [],
  ...over,
});

describe("VsdxImportSection", () => {
  let container;
  let root;
  let dispatch;

  const renderSection = () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    dispatch = vi.fn();
    act(() => {
      root.render(<VsdxImportSection dispatch={dispatch} />);
    });
  };

  const chooseFile = async (name) => {
    const file = new File(["fake-vsdx-bytes"], name, {
      type: "application/vnd.ms-visio.drawing",
    });
    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
  };

  const clickText = async (text) => {
    const btn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent.includes(text),
    );
    expect(btn, `button "${text}"`).toBeTruthy();
    await act(async () => {
      btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("single page skips the picker and lands on preview", async () => {
    vi.mocked(listVsdxPages).mockResolvedValue([{ id: "p1", name: "Page-1", index: 0 }]);
    vi.mocked(prepareVsdxImport).mockResolvedValue(preparedFixture());
    renderSection();

    await chooseFile("drawing.vsdx");

    expect(container.textContent).not.toContain("which one should be imported?");
    expect(container.textContent).toContain("Page 'Page-1'");
    expect(vi.mocked(prepareVsdxImport)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prepareVsdxImport).mock.calls[0][1].pageIndex).toBe(0);
  });

  it("multiple pages show a picker; choosing one prepares that page", async () => {
    vi.mocked(listVsdxPages).mockResolvedValue([
      { id: "p1", name: "First", index: 0 },
      { id: "p2", name: "Second", index: 1 },
    ]);
    vi.mocked(prepareVsdxImport).mockResolvedValue(
      preparedFixture({ page: { id: "p2", name: "Second", index: 1 } }),
    );
    renderSection();

    await chooseFile("drawing.vsdx");

    expect(container.textContent).toContain("has 2 pages");
    expect(container.textContent).toContain("First");
    expect(container.textContent).toContain("Second");
    expect(vi.mocked(prepareVsdxImport)).not.toHaveBeenCalled();

    await clickText("Second");
    expect(vi.mocked(prepareVsdxImport)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prepareVsdxImport).mock.calls[0][1].pageIndex).toBe(1);
    expect(container.textContent).toContain("Page 'Second'");
  });

  it("explicit commit dispatches IMPORT_VSDX_RESULT once and shows the report", async () => {
    const prepared = preparedFixture();
    vi.mocked(listVsdxPages).mockResolvedValue([{ id: "p1", name: "Page-1", index: 0 }]);
    vi.mocked(prepareVsdxImport).mockResolvedValue(prepared);
    renderSection();

    await chooseFile("drawing.vsdx");
    // Preview is shown; nothing dispatched yet — the import is not applied
    // until the user explicitly commits.
    expect(dispatch).not.toHaveBeenCalled();

    await clickText("Import this page");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "IMPORT_VSDX_RESULT",
      importResult: prepared,
    });
    expect(container.textContent).toContain("Imported 2 shapes");
  });

  it("rejects non-.vsdx files with a clear error", async () => {
    renderSection();
    await chooseFile("drawing.vsd");
    expect(container.textContent).toContain("Only .vsdx files are supported");
    expect(vi.mocked(listVsdxPages)).not.toHaveBeenCalled();
  });

  it("shows importer failures as an error, not a half-applied import", async () => {
    vi.mocked(listVsdxPages).mockRejectedValue(new Error("Not a zip file"));
    renderSection();
    await chooseFile("drawing.vsdx");
    expect(container.textContent).toContain("Not a zip file");
    expect(dispatch).not.toHaveBeenCalled();
  });
});
