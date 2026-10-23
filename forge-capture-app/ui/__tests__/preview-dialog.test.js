// Tests for the capture preview dialog logic (forge-capture-app/ui/main.js).
//
// The preview functions are DOM-coupled, so this file tests the pure
// decision logic extracted for testability: metadata text formatting and
// the preview-open preconditions. The full openPreview flow (Tauri invoke,
// dialog.showModal) is exercised on-machine.

import { describe, it, expect } from "vitest";

// Mirrors the metadata line built in openPreview():
// `${ref.kind} — ${ref.width}×${ref.height} — ${ref.png_path || ""}`
function previewMetaText(ref) {
  return `${ref.kind} — ${ref.width}×${ref.height} — ${ref.png_path || ""}`;
}

// Mirrors the openPreview guard: needs a ref with an id.
function canOpenPreview(ref) {
  return !!(ref && ref.id);
}

// Mirrors the warning-surfacing logic: sidecar.warnings joined, if any.
function previewWarningText(sidecar) {
  const warnings = (sidecar && sidecar.warnings) || [];
  return warnings.length > 0 ? `Warning: ${warnings.join("; ")}` : "";
}

describe("previewMetaText", () => {
  it("formats kind, dimensions, and path", () => {
    expect(
      previewMetaText({
        kind: "full-monitor",
        width: 1920,
        height: 1080,
        png_path: "C:\\captures\\shot.png",
      })
    ).toBe("full-monitor — 1920×1080 — C:\\captures\\shot.png");
  });

  it("handles a missing path", () => {
    expect(previewMetaText({ kind: "region", width: 800, height: 600 })).toBe(
      "region — 800×600 — "
    );
  });
});

describe("canOpenPreview", () => {
  it("opens for a ref with an id", () => {
    expect(canOpenPreview({ id: "abc123" })).toBe(true);
  });

  it("refuses null, undefined, or id-less refs", () => {
    expect(canOpenPreview(null)).toBe(false);
    expect(canOpenPreview(undefined)).toBe(false);
    expect(canOpenPreview({})).toBe(false);
    expect(canOpenPreview({ id: "" })).toBe(false);
  });
});

describe("previewWarningText", () => {
  it("returns empty when there are no warnings", () => {
    expect(previewWarningText({})).toBe("");
    expect(previewWarningText({ warnings: [] })).toBe("");
    expect(previewWarningText(null)).toBe("");
  });

  it("joins multiple warnings", () => {
    expect(
      previewWarningText({
        warnings: ["solid-color frame", "cursor not captured"],
      })
    ).toBe("Warning: solid-color frame; cursor not captured");
  });

  it("surfaces the solid-frame warning text the engine emits", () => {
    const engineWarning =
      "captured frame is a single solid color — the capture pipeline " +
      "may have produced a blank frame; verify the saved PNG";
    expect(previewWarningText({ warnings: [engineWarning] })).toContain(
      "single solid color"
    );
  });
});
