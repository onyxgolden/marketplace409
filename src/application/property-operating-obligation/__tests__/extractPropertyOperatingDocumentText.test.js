import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(
  () => ({
    getDocumentProxy:
      vi.fn(),
    extractText:
      vi.fn(),
  }),
);

vi.mock(
  "unpdf",
  () => ({
    getDocumentProxy:
      mocks.getDocumentProxy,
    extractText:
      mocks.extractText,
  }),
);

import {
  ensurePropertyDocumentPDFRuntimeCompatibility,
  extractPropertyOperatingDocumentText,
} from "../extractPropertyOperatingDocumentText.js";

describe(
  "extractPropertyOperatingDocumentText",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();

      mocks.getDocumentProxy
        .mockResolvedValue({
          id: "pdf",
        });

      mocks.extractText
        .mockResolvedValue({
          text:
            "Readable insurance policy declaration text with coverage facts.",
          totalPages: 2,
        });
    });

    it(
      "extracts readable native PDF text",
      async () => {
        const result =
          await extractPropertyOperatingDocumentText({
            bytes:
              new Uint8Array([
                37,
                80,
                68,
                70,
              ]).buffer,
            contentType:
              "application/pdf",
          });

        expect(result).toEqual({
          text:
            "Readable insurance policy declaration text with coverage facts.",
          totalPages: 2,
          extractionMethod:
            "native_pdf",
          requiresOCR: false,
        });

        expect(
          mocks.getDocumentProxy,
        ).toHaveBeenCalledWith(
          expect.any(
            Uint8Array,
          ),
        );

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(true);
      },
    );

    it(
      "requests OCR for scanned PDFs",
      async () => {
        mocks.extractText
          .mockResolvedValue({
            text: " ",
            totalPages: 1,
          });

        await expect(
          extractPropertyOperatingDocumentText({
            bytes:
              new Uint8Array([
                37,
                80,
                68,
                70,
              ]).buffer,
            contentType:
              "application/pdf",
          }),
        ).resolves.toEqual({
          text: "",
          totalPages: 1,
          extractionMethod:
            "ocr_required",
          requiresOCR: true,
        });
      },
    );

    it(
      "rejects unsupported, empty, and oversized documents",
      async () => {
        await expect(
          extractPropertyOperatingDocumentText({
            bytes:
              new Uint8Array([
                1,
              ]).buffer,
            contentType:
              "image/png",
          }),
        ).rejects.toThrow(
          "must be a PDF document",
        );

        await expect(
          extractPropertyOperatingDocumentText({
            bytes:
              new ArrayBuffer(0),
            contentType:
              "application/pdf",
          }),
        ).rejects.toThrow(
          "PDF is empty",
        );

        await expect(
          extractPropertyOperatingDocumentText({
            bytes:
              new ArrayBuffer(
                10 * 1024 * 1024 +
                  1,
              ),
            contentType:
              "application/pdf",
          }),
        ).rejects.toThrow(
          "must not exceed 10 MB",
        );
      },
    );

    it(
      "provides the PDF runtime compatibility shim",
      () => {
        ensurePropertyDocumentPDFRuntimeCompatibility();

        expect(
          typeof Math.sumPrecise,
        ).toBe("function");

        expect(
          Math.sumPrecise([
            1,
            2,
            3,
          ]),
        ).toBe(6);
      },
    );
  },
);
