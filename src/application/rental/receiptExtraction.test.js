import { describe, expect, it, vi, afterEach } from "vitest";
import {
  extractReceiptData,
  extractReceiptDataStub,
  resolveExtractionProvider,
  isExtractionConnected,
  EXTRACTION_STATUS,
  EXTRACTION_CONTRACT,
} from "./receiptExtraction";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extraction gating (HARD GATE — no paid AI API)", () => {
  it("the stub always reports not_connected", async () => {
    const result = await extractReceiptDataStub({ fileBytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" });
    expect(result.status).toBe(EXTRACTION_STATUS.NOT_CONNECTED);
    expect(result.provider).toBe("stub");
    expect(result.message).toMatch(/not connected/i);
  });

  it("the stub performs zero network calls", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network must never be touched by the stub");
    });
    vi.stubGlobal("fetch", fetchSpy);
    await extractReceiptDataStub({ fileBytes: new Uint8Array([1]), mimeType: "image/jpeg" });
    await extractReceiptData({ fileBytes: new Uint8Array([1]), mimeType: "image/jpeg" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolveExtractionProvider returns only the stub — nothing live", () => {
    expect(resolveExtractionProvider().name).toBe("stub");
    expect(isExtractionConnected()).toBe(false);
  });

  it("extractReceiptData honors the same contract shape", async () => {
    const result = await extractReceiptData({ fileBytes: null, mimeType: null });
    expect(result.status).toBe(EXTRACTION_STATUS.NOT_CONNECTED);
    expect(typeof result.message).toBe("string");
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("the contract is documented for future providers", () => {
    expect(EXTRACTION_CONTRACT.input.length).toBeGreaterThan(0);
    expect(EXTRACTION_CONTRACT.output.join(" ")).toMatch(/not_connected/);
  });
});
