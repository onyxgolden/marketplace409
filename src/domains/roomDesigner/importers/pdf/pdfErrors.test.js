// pdfErrors.test.js — the format gate, including the .ai / .eps refusal.

import { describe, expect, it } from "vitest";
import {
  PdfImportError,
  UNSUPPORTED_VECTOR_FORMATS,
  checkPdfFileSupported,
  pageProvenance,
} from "./pdfErrors";

describe("checkPdfFileSupported", () => {
  it("accepts a PDF by extension or MIME type", () => {
    expect(checkPdfFileSupported({ name: "plan.pdf" }).ok).toBe(true);
    expect(checkPdfFileSupported({ name: "PLAN.PDF" }).ok).toBe(true);
    expect(checkPdfFileSupported({ name: "blob", type: "application/pdf" }).ok).toBe(true);
  });

  it("refuses .ai and says what to do instead", () => {
    const result = checkPdfFileSupported({ name: "logo.ai" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("unsupported-format");
    expect(result.message).toMatch(/Illustrator/);
    expect(result.message).toMatch(/Save As/);
  });

  it("refuses .eps and says what to do instead", () => {
    const result = checkPdfFileSupported({ name: "detail.eps" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("unsupported-format");
    expect(result.message).toMatch(/PostScript/);
    expect(result.message).toMatch(/to PDF/);
  });

  it("refuses .ai and .eps by MIME type even when the name is unhelpful", () => {
    expect(checkPdfFileSupported({ name: "drop", type: "application/illustrator" }).code)
      .toBe("unsupported-format");
    expect(checkPdfFileSupported({ name: "drop", type: "application/postscript" }).code)
      .toBe("unsupported-format");
  });

  it("refuses a PDF-compatible .ai rather than half-reading it", () => {
    // Illustrator files are often internally PDF; the extension still wins,
    // because an .ai saved without PDF compatibility parses as garbage.
    const result = checkPdfFileSupported({ name: "sheet.ai", type: "application/pdf" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("unsupported-format");
  });

  it("refuses anything else with a plain message", () => {
    const result = checkPdfFileSupported({ name: "plan.dwg" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("not-a-pdf");
    expect(result.message).toMatch(/Only PDF files/);
  });

  it("never throws on missing input", () => {
    expect(checkPdfFileSupported().ok).toBe(false);
    expect(checkPdfFileSupported({}).ok).toBe(false);
    expect(checkPdfFileSupported({ name: null, type: null }).ok).toBe(false);
  });

  it("documents every refused format with a reason", () => {
    expect(UNSUPPORTED_VECTOR_FORMATS.map((f) => f.extension)).toEqual([".ai", ".eps"]);
    for (const format of UNSUPPORTED_VECTOR_FORMATS) {
      expect(format.reason.length).toBeGreaterThan(20);
      expect(format.label.length).toBeGreaterThan(0);
    }
  });
});

describe("PdfImportError", () => {
  it("carries a code and appends provenance to the message", () => {
    const error = new PdfImportError("Broke", { provenance: "Page 3", code: "unreadable" });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("PdfImportError");
    expect(error.message).toBe("Broke (Page 3)");
    expect(error.provenance).toBe("Page 3");
    expect(error.code).toBe("unreadable");
  });

  it("defaults the code and omits empty provenance", () => {
    const error = new PdfImportError("Broke");
    expect(error.message).toBe("Broke");
    expect(error.code).toBe("import-error");
    expect(error.provenance).toBeNull();
  });

  it("formats page provenance", () => {
    expect(pageProvenance(4)).toBe("Page 4");
  });
});
