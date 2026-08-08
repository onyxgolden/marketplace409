import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const {
  authenticate,
  extractInvoice,
  parseInvoice,
} = vi.hoisted(() => ({
  authenticate: vi.fn(),
  extractInvoice: vi.fn(),
  parseInvoice: vi.fn(),
}));

vi.mock(
  "@/lib/supabase/createAuthenticatedPropertyHVACApplication",
  () => ({
    createAuthenticatedPropertyHVACApplication:
      authenticate,
  }),
);

vi.mock(
  "@/application/property-hvac/extractHVACInvoiceText",
  () => ({
    extractHVACInvoiceText:
      extractInvoice,
  }),
);

vi.mock(
  "@/application/property-hvac/parseHVACInvoiceText",
  () => ({
    parseHVACInvoiceText:
      parseInvoice,
  }),
);

import {
  POST,
  runtime,
} from "./route";

function requestWith(invoice) {
  return {
    formData: vi.fn()
      .mockResolvedValue({
        get: vi.fn(
          (name) =>
            name === "invoice"
              ? invoice
              : null,
        ),
      }),
  };
}

function invoice() {
  return {
    type: "application/pdf",
    arrayBuffer: vi.fn()
      .mockResolvedValue(
        new Uint8Array([
          37,
          80,
          68,
          70,
        ]).buffer,
      ),
  };
}

describe(
  "property HVAC invoice proposal route",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();

      authenticate
        .mockResolvedValue({
          response: null,
          user: {
            id: "owner_1",
          },
        });

      extractInvoice
        .mockResolvedValue({
          text:
            "Readable HVAC invoice text",
          totalPages: 1,
          extractionMethod:
            "native_pdf",
          requiresOCR: false,
        });

      parseInvoice
        .mockReturnValue({
          parserVersion:
            "hvac-invoice-v1",
          requiresReview: true,
          event: {
            invoiceReference:
              "603",
            componentActions: [
              {
                actionType:
                  "replaced",
                componentType:
                  "contactor",
              },
            ],
          },
        });
    });

    it(
      "uses the Node.js runtime",
      () => {
        expect(runtime).toBe(
          "nodejs",
        );
      },
    );

    it(
      "returns a reviewable bulk invoice proposal",
      async () => {
        const file = invoice();

        const response =
          await POST(
            requestWith(file),
          );

        expect(response.status).toBe(
          200,
        );

        expect(
          await response.json(),
        ).toMatchObject({
          success: true,
          extraction: {
            method:
              "native_pdf",
            totalPages: 1,
          },
          proposal: {
            requiresReview: true,
            event: {
              invoiceReference:
                "603",
            },
          },
        });

        expect(
          extractInvoice,
        ).toHaveBeenCalledWith({
          bytes:
            expect.any(
              ArrayBuffer,
            ),
          contentType:
            "application/pdf",
        });

        expect(
          parseInvoice,
        ).toHaveBeenCalledWith(
          "Readable HVAC invoice text",
        );
      },
    );

    it(
      "returns the authentication response",
      async () => {
        const authenticationResponse =
          new Response(
            JSON.stringify({
              error:
                "Authentication required.",
            }),
            {
              status: 401,
              headers: {
                "Content-Type":
                  "application/json",
              },
            },
          );

        authenticate
          .mockResolvedValue({
            response:
              authenticationResponse,
          });

        const response =
          await POST(
            requestWith(
              invoice(),
            ),
          );

        expect(response).toBe(
          authenticationResponse,
        );

        expect(
          extractInvoice,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "requires an invoice PDF",
      async () => {
        const response =
          await POST(
            requestWith(null),
          );

        expect(response.status).toBe(
          400,
        );

        expect(
          await response.json(),
        ).toMatchObject({
          success: false,
          error:
            "An HVAC invoice PDF is required.",
        });
      },
    );

    it(
      "reports when OCR is required",
      async () => {
        extractInvoice
          .mockResolvedValue({
            text: "",
            totalPages: 1,
            extractionMethod:
              "ocr_required",
            requiresOCR: true,
          });

        const response =
          await POST(
            requestWith(
              invoice(),
            ),
          );

        expect(response.status).toBe(
          422,
        );

        expect(
          await response.json(),
        ).toMatchObject({
          success: false,
          ocrRequired: true,
          extractionMethod:
            "ocr_required",
        });

        expect(
          parseInvoice,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects invalid PDF input",
      async () => {
        extractInvoice
          .mockRejectedValue(
            new Error(
              "HVAC invoice must be a PDF document.",
            ),
          );

        const response =
          await POST(
            requestWith(
              invoice(),
            ),
          );

        expect(response.status).toBe(
          400,
        );
      },
    );
  },
);
