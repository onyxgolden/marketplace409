import { describe, it, expect } from "vitest";
import { formatCaptureFailedStatus, previewDataUrl } from "../main-core.js";

describe("formatCaptureFailedStatus", () => {
  it("formats a plain string reason (capture-failed event payload shape)", () => {
    expect(formatCaptureFailedStatus("cannot write PNG: disk full")).toEqual({
      text: "Capture failed: cannot write PNG: disk full",
      kind: "error",
    });
  });

  it("stringifies a non-string reason (a rejected invoke() can throw anything)", () => {
    expect(formatCaptureFailedStatus(new Error("boom")).text).toBe("Capture failed: Error: boom");
  });

  it("falls back to a generic message for a missing/empty reason, never 'Capture failed: undefined'", () => {
    expect(formatCaptureFailedStatus(undefined).text).toBe("Capture failed: unknown error");
    expect(formatCaptureFailedStatus(null).text).toBe("Capture failed: unknown error");
    expect(formatCaptureFailedStatus("").text).toBe("Capture failed: unknown error");
  });

  it("always reports kind: error", () => {
    expect(formatCaptureFailedStatus("x").kind).toBe("error");
  });
});

describe("previewDataUrl", () => {
  it("builds a data: URL from a bytes_b64/mime payload", () => {
    expect(previewDataUrl({ bytes_b64: "QUJD", mime: "image/png" })).toBe(
      "data:image/png;base64,QUJD",
    );
  });

  it("returns null for a missing or malformed payload, never a broken src", () => {
    expect(previewDataUrl(null)).toBeNull();
    expect(previewDataUrl(undefined)).toBeNull();
    expect(previewDataUrl({})).toBeNull();
    expect(previewDataUrl({ bytes_b64: "QUJD" })).toBeNull();
    expect(previewDataUrl({ mime: "image/png" })).toBeNull();
  });
});
