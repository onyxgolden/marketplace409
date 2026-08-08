import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const {
  extractText,
  getDocumentProxy,
} = vi.hoisted(() => ({
  extractText: vi.fn(),
  getDocumentProxy: vi.fn(),
}));

vi.mock(
  "unpdf",
  () => ({
    extractText,
    getDocumentProxy,
  }),
);

import {
  extractHVACInvoiceText,
} from "../extractHVACInvoiceText";

describe(
  "extractHVACInvoiceText",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();

      getDocumentProxy
        .mockResolvedValue({
          id: "pdf-document",
        });
    });

    it(
      "extracts text from a digital PDF",
      async () => {
        extractText
          .mockResolvedValue({
            totalPages: 2,
            text:
              "Invoice 603 contains enough native text for deterministic HVAC parsing.",
          });

        const result =
          await extractHVACInvoiceText({
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
            "Invoice 603 contains enough native text for deterministic HVAC parsing.",
          totalPages: 2,
          extractionMethod:
            "native_pdf",
          requiresOCR: false,
        });

        expect(
          getDocumentProxy,
        ).toHaveBeenCalledOnce();

        expect(
          extractText,
        ).toHaveBeenCalledWith(
          {
            id: "pdf-document",
          },
          {
            mergePages: true,
          },
        );
      },
    );

    it(
      "requests OCR when native PDF text is insufficient",
      async () => {
        extractText
          .mockResolvedValue({
            totalPages: 1,
            text: "",
          });

        const result =
          await extractHVACInvoiceText({
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

        expect(result).toMatchObject({
          extractionMethod:
            "ocr_required",
          requiresOCR: true,
        });
      },
    );

    it(
      "rejects unsupported or empty uploads",
      async () => {
        await expect(
          extractHVACInvoiceText({
            bytes:
              new Uint8Array([
                1,
              ]).buffer,
            contentType:
              "image/png",
          }),
        ).rejects.toThrow(
          "HVAC invoice must be a PDF document.",
        );

        await expect(
          extractHVACInvoiceText({
            bytes:
              new Uint8Array()
                .buffer,
            contentType:
              "application/pdf",
          }),
        ).rejects.toThrow(
          "HVAC invoice PDF is empty.",
        );
      },
    );
  },
);
