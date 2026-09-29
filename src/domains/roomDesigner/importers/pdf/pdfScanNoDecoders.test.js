// A scan whose image cannot be decoded must be reported, never silently
// placed as blank paper. Own file on purpose: pdf.js caches decoder start-up
// per process, so this runs without decoders in isolation.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { __setPdfjsForTests, __setPdfWasmUrlForTests, preparePdfImport } from "./pdfImporter";

const napi = await import("@napi-rs/canvas").catch(() => null);
const SCAN = path.resolve(__dirname, "../../../../../test-fixtures/import-library/pdf/habs-davenport-house-sheet1-scanned.pdf");

describe("scanned page without image decoders", () => {
  it.skipIf(!napi)("warns that the scan could not be decoded", async () => {
    __setPdfjsForTests(await import("pdfjs-dist/legacy/build/pdf.mjs"));
    __setPdfWasmUrlForTests(null);
    try {
      const prep = await preparePdfImport(new Uint8Array(fs.readFileSync(SCAN)), {
        pageNumber: 1, mode: "raster", createCanvas: (w, h) => napi.createCanvas(w, h),
      });
      expect(prep.image.blank).toBe(true);
      expect(prep.issues.map((i) => i.message).join(" ")).toMatch(/scanned image could not be decoded/);
    } finally {
      __setPdfWasmUrlForTests(undefined);
      __setPdfjsForTests(null);
    }
  }, 60_000);
});
