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
  preserveEvidence,
  extractOCR,
} = vi.hoisted(() => ({
  authenticate:
    vi.fn(),
  extractInvoice:
    vi.fn(),
  parseInvoice:
    vi.fn(),
  preserveEvidence:
    vi.fn(),
  extractOCR:
    vi.fn(),
}));

vi.mock(
  "@/lib/supabase/createAuthenticatedPropertyEvidenceApplication",
  () => ({
    createAuthenticatedPropertyEvidenceApplication:
      authenticate,
  }),
);

vi.mock(
  "@/infrastructure/ocr/GoogleCloudVisionOCRAdapter",
  () => ({
    GoogleCloudVisionOCRAdapter:
      class {
        extractText =
          extractOCR;
      },
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

function requestWith(
  invoice,
  {
    propertyId =
      "1214-wagner",
    systemId =
      "system_1",
  } = {},
) {
  const values = {
    invoice,
    propertyId,
    systemId,
  };

  return {
    formData: vi.fn()
      .mockResolvedValue({
        get: vi.fn(
          (name) =>
            values[name] ??
            null,
        ),
      }),
  };
}

function invoice() {
  return {
    name:
      "Invoice #603.pdf",
    type:
      "application/pdf",
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

function image() {
  return {
    name:
      "HVAC service photo.jpg",
    type:
      "image/jpeg",
    arrayBuffer: vi.fn()
      .mockResolvedValue(
        new Uint8Array([
          255,
          216,
          255,
        ]).buffer,
      ),
  };
}

function evidence() {
  return {
    id:
      "property_evidence_1",
    originalFilename:
      "Invoice #603.pdf",
    reviewStatus:
      "pending_review",
    objectPath:
      "owner_1/1214-wagner/property_evidence_1/Invoice-603.pdf",
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
          application: {
            preserve:
              preserveEvidence,
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

      preserveEvidence
        .mockResolvedValue(
          evidence(),
        );

      extractOCR
        .mockResolvedValue({
          text:
            "Readable OCR HVAC invoice text with enough characters to parse safely.",
          extractionMethod:
            "google_cloud_vision",
          mimeType:
            "application/pdf",
          processedPages: 1,
          totalPages: 1,
          truncated: false,
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
      "preserves a readable invoice and returns its review reference",
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
          evidence: {
            id:
              "property_evidence_1",
            originalFilename:
              "Invoice #603.pdf",
            reviewStatus:
              "pending_review",
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
          preserveEvidence,
        ).toHaveBeenCalledWith({
          ownerId:
            "owner_1",
          propertyId:
            "1214-wagner",
          hvacSystemId:
            "system_1",
          bytes:
            expect.any(
              ArrayBuffer,
            ),
          originalFilename:
            "Invoice #603.pdf",
          mimeType:
            "application/pdf",
          extractionMethod:
            "native_pdf",
          parserVersion:
            "hvac-invoice-v1",
          reviewStatus:
            "pending_review",
        });
      },
    );

    it(
      "preserves evidence when extraction detaches its buffer",
      async () => {
        extractInvoice.mockImplementation(
          async ({ bytes }) => {
            structuredClone(
              bytes,
              { transfer: [bytes] },
            );

            return {
              text: "Readable HVAC invoice text",
              totalPages: 1,
              extractionMethod: "native_pdf",
              requiresOCR: false,
            };
          },
        );

        preserveEvidence.mockImplementation(
          async ({ bytes }) => {
            expect(
              Array.from(
                new Uint8Array(bytes),
              ),
            ).toEqual([
              37,
              80,
              68,
              70,
            ]);

            return evidence();
          },
        );

        const response = await POST(
          requestWith(invoice()),
        );

        expect(response.status).toBe(200);
        expect(preserveEvidence)
          .toHaveBeenCalledTimes(1);
      },
    );

    it(
      "uses Vision OCR for scanned PDFs and returns a proposal",
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
          200,
        );

        expect(
          await response.json(),
        ).toMatchObject({
          success: true,
          evidence: {
            id:
              "property_evidence_1",
          },
          extraction: {
            method:
              "google_cloud_vision",
            processedPages: 1,
            totalPages: 1,
            truncated: false,
          },
        });

        expect(
          extractOCR,
        ).toHaveBeenCalledWith({
          bytes:
            expect.any(
              ArrayBuffer,
            ),
          mimeType:
            "application/pdf",
        });

        expect(
          parseInvoice,
        ).toHaveBeenCalledWith(
          "Readable OCR HVAC invoice text with enough characters to parse safely.",
        );

        expect(
          preserveEvidence,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            extractionMethod:
              "google_cloud_vision",
            parserVersion:
              "hvac-invoice-v1",
            reviewStatus:
              "pending_review",
          }),
        );
      },
    );

    it(
      "preserves failed OCR evidence without creating a proposal",
      async () => {
        extractInvoice
          .mockResolvedValue({
            text: "",
            totalPages: 1,
            extractionMethod:
              "ocr_required",
            requiresOCR: true,
          });

        extractOCR
          .mockRejectedValue(
            new Error(
              "Vision service unavailable.",
            ),
          );

        preserveEvidence
          .mockResolvedValue({
            ...evidence(),
            reviewStatus:
              "extraction_failed",
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
            "google_cloud_vision",
          error:
            "Vision service unavailable.",
          evidence: {
            id:
              "property_evidence_1",
            reviewStatus:
              "extraction_failed",
          },
        });

        expect(
          preserveEvidence,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            extractionMethod:
              "pending",
            parserVersion:
              null,
            reviewStatus:
              "extraction_failed",
          }),
        );

        expect(
          parseInvoice,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "uses Vision directly for JPEG invoice photographs",
      async () => {
        const response =
          await POST(
            requestWith(
              image(),
            ),
          );

        expect(response.status).toBe(
          200,
        );

        expect(
          extractInvoice,
        ).not.toHaveBeenCalled();

        expect(
          extractOCR,
        ).toHaveBeenCalledWith({
          bytes:
            expect.any(
              ArrayBuffer,
            ),
          mimeType:
            "image/jpeg",
        });

        expect(
          preserveEvidence,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            originalFilename:
              "HVAC service photo.jpg",
            mimeType:
              "image/jpeg",
            extractionMethod:
              "google_cloud_vision",
          }),
        );
      },
    );

    it(
      "requires property and system identity",
      async () => {
        const missingProperty =
          await POST(
            requestWith(
              invoice(),
              {
                propertyId: "",
              },
            ),
          );

        expect(
          missingProperty.status,
        ).toBe(400);

        const missingSystem =
          await POST(
            requestWith(
              invoice(),
              {
                systemId: "",
              },
            ),
          );

        expect(
          missingSystem.status,
        ).toBe(400);

        expect(
          extractInvoice,
        ).not.toHaveBeenCalled();

        expect(
          preserveEvidence,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns the authentication response before reading the invoice",
      async () => {
        const response =
          Response.json(
            {
              error:
                "Authentication required.",
            },
            {
              status: 401,
            },
          );

        authenticate
          .mockResolvedValue({
            response,
          });

        const result =
          await POST(
            requestWith(
              invoice(),
            ),
          );

        expect(result).toBe(
          response,
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
      "rejects invalid PDF input without preserving it",
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

        expect(
          preserveEvidence,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
