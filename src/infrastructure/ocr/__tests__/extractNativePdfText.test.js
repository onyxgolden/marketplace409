import { beforeEach, describe, expect, it, vi } from "vitest";

const { extractText, getDocumentProxy } = vi.hoisted(() => ({
  extractText: vi.fn(),
  getDocumentProxy: vi.fn(),
}));

vi.mock("unpdf", () => ({ extractText, getDocumentProxy }));

import { extractNativePdfText } from "../extractNativePdfText";

describe("extractNativePdfText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDocumentProxy.mockResolvedValue({ id: "pdf-document" });
  });

  it("extracts text from a digital PDF", async () => {
    extractText.mockResolvedValue({
      totalPages: 3,
      text: "This survey/plat contains enough native text for full-text search indexing.",
    });

    const result = await extractNativePdfText({
      bytes: new Uint8Array([37, 80, 68, 70]).buffer,
      contentType: "application/pdf",
    });

    expect(result).toEqual({
      text: "This survey/plat contains enough native text for full-text search indexing.",
      totalPages: 3,
      extractionMethod: "native_pdf",
      requiresOCR: false,
    });
    expect(getDocumentProxy).toHaveBeenCalledOnce();
    expect(extractText).toHaveBeenCalledWith({ id: "pdf-document" }, { mergePages: true });
  });

  it("requests OCR when native PDF text is insufficient (e.g. a scanned survey with no text layer)", async () => {
    extractText.mockResolvedValue({ totalPages: 1, text: "" });
    const result = await extractNativePdfText({
      bytes: new Uint8Array([37, 80, 68, 70]).buffer,
      contentType: "application/pdf",
    });
    expect(result).toMatchObject({ extractionMethod: "ocr_required", requiresOCR: true });
  });

  it("rejects a non-PDF content type", async () => {
    await expect(extractNativePdfText({
      bytes: new Uint8Array([1]).buffer, contentType: "image/png",
    })).rejects.toThrow("requires a PDF document");
  });

  it("rejects an empty PDF", async () => {
    await expect(extractNativePdfText({
      bytes: new Uint8Array().buffer, contentType: "application/pdf",
    })).rejects.toThrow("PDF is empty");
  });

  it("rejects a PDF over 10 MB before ever calling unpdf", async () => {
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1).buffer;
    await expect(extractNativePdfText({
      bytes: oversized, contentType: "application/pdf",
    })).rejects.toThrow("must not exceed 10 MB");
    expect(getDocumentProxy).not.toHaveBeenCalled();
  });
});
