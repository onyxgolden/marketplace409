/**
 * @vitest-environment jsdom
 */
// Thin-host smoke test: CaptureEditorHost renders without FORGE auth, exposes
// exactly the 11 annotation tools plus Select, and shows the import dropzone
// (no canvas) before a document exists.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CaptureEditorHost from "./CaptureEditorHost.jsx";

function markup() {
  return renderToStaticMarkup(<CaptureEditorHost />);
}

describe("CaptureEditorHost", () => {
  it("renders without FORGE auth and shows the import dropzone before a document exists", () => {
    const html = markup();
    expect(html).toContain('data-testid="capture-host"');
    expect(html).toContain("Open a PNG, JPEG, or WebP");
    // No document yet → the canvas is not mounted.
    expect(html).not.toContain('data-testid="capture-canvas"');
  });

  it("exposes exactly the 11 annotation tools plus Select", () => {
    const html = markup();
    const tools = [...html.matchAll(/data-tool="([^"]+)"/g)].map((m) => m[1]);
    expect(tools).toEqual([
      "select",
      "arrow",
      "line",
      "rectangle",
      "ellipse",
      "freehand",
      "highlight",
      "text",
      "callout",
      "step-marker",
      "blur",
      "blackout",
    ]);
  });

  it("shows the core controls: undo, redo, save, export format, export, fit", () => {
    const html = markup();
    for (const label of ["Undo", "Redo", "Save", "Export", "Fit", "Open image"]) {
      expect(html).toContain(label);
    }
    // Snagit-style format picker offers every supported still-image type.
    for (const label of ["PNG", "JPEG", "WebP", "GIF", "TIFF", "BMP"]) {
      expect(html).toContain(label);
    }
    // Selection-dependent controls (Lock/Delete/z-order) appear only when an
    // annotation is selected; the empty state says so explicitly.
    expect(html).toContain("Nothing selected");
  });

  it("shows the import-metadata notice and redaction guarantee copy", () => {
    const html = markup();
    expect(html).toContain("stripped");
    expect(html).toContain("baked into pixels");
    expect(html).toContain("no layers");
  });
});
