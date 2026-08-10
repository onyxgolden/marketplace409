import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(
  () => ({
    authenticate:
      vi.fn(),
    extractDocument:
      vi.fn(),
    parseDocument:
      vi.fn(),
    preserveEvidence:
      vi.fn(),
    extractOCR:
      vi.fn(),
  }),
);

vi.mock(
  "@/lib/supabase/createAuthenticatedPropertyEvidenceApplication",
  () => ({
    createAuthenticatedPropertyEvidenceApplication:
      mocks.authenticate,
  }),
);

vi.mock(
  "@/infrastructure/ocr/GoogleCloudVisionOCRAdapter",
  () => ({
    GoogleCloudVisionOCRAdapter:
      class {
        extractText =
          mocks.extractOCR;
      },
  }),
);

vi.mock(
  "@/application/property-operating-obligation/extractPropertyOperatingDocumentText",
  () => ({
    extractPropertyOperatingDocumentText:
      mocks.extractDocument,
  }),
);

vi.mock(
  "@/application/property-operating-obligation/parsePropertyOperatingDocumentText",
  () => ({
    parsePropertyOperatingDocumentText:
      mocks.parseDocument,
  }),
);

import {
  POST,
  runtime,
} from "./route";

function uploadedDocument({
  name =
    "Insurance declaration.pdf",
  type =
    "application/pdf",
} = {}) {
  return {
    name,
    type,
    arrayBuffer:
      vi.fn()
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

function requestWith(
  document,
  {
    propertyId =
      "420-south-29th",
  } = {},
) {
  const values = {
    document,
    propertyId,
  };

  return {
    formData:
      vi.fn()
        .mockResolvedValue({
          get:
            vi.fn(
              (name) =>
                values[name] ??
                null,
            ),
        }),
  };
}

function proposal() {
  return {
    parserVersion:
      "property-operating-document-v1",
    requiresReview: true,
    confidence: "high",
    documentType:
      "insurance_policy",
    proposal: {
      obligationType:
        "fire_insurance",
      annualAmountCents:
        78668,
      servicePeriodStart:
        "2025-12-16",
      servicePeriodEnd:
        "2026-12-16",
    },
    warnings: [],
  };
}

function evidence(
  overrides = {},
) {
  return {
    id:
      "property_evidence_1",
    propertyId:
      "420-south-29th",
    hvacSystemId: null,
    hvacEventId: null,
    originalFilename:
      "Insurance declaration.pdf",
    reviewStatus:
      "pending_review",
    ...overrides,
  };
}

describe(
  "property operating document proposal route",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();

      mocks.authenticate
        .mockResolvedValue({
          response: null,
          user: {
            id: "owner_1",
          },
          application: {
            preserve:
              mocks.preserveEvidence,
          },
        });

      mocks.extractDocument
        .mockResolvedValue({
          text:
            "Readable insurance declaration text with policy facts.",
          totalPages: 1,
          extractionMethod:
            "native_pdf",
          requiresOCR: false,
        });

      mocks.parseDocument
        .mockReturnValue(
          proposal(),
        );

      mocks.preserveEvidence
        .mockResolvedValue(
          evidence(),
        );

      mocks.extractOCR
        .mockResolvedValue({
          text:
            "Readable OCR insurance declaration text with enough policy facts.",
          extractionMethod:
            "google_cloud_vision",
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
      "preserves readable evidence and returns a review-only proposal",
      async () => {
        const response =
          await POST(
            requestWith(
              uploadedDocument(),
            ),
          );

        expect(response.status)
          .toBe(200);

        await expect(
          response.json(),
        ).resolves.toMatchObject({
          success: true,
          proposal: {
            requiresReview: true,
            documentType:
              "insurance_policy",
          },
          evidence: {
            id:
              "property_evidence_1",
            reviewStatus:
              "pending_review",
          },
          extraction: {
            method:
              "native_pdf",
            totalPages: 1,
          },
        });

        expect(
          mocks.preserveEvidence,
        ).toHaveBeenCalledWith({
          ownerId:
            "owner_1",
          propertyId:
            "420-south-29th",
          bytes:
            expect.any(
              ArrayBuffer,
            ),
          originalFilename:
            "Insurance declaration.pdf",
          mimeType:
            "application/pdf",
          extractionMethod:
            "native_pdf",
          parserVersion:
            "property-operating-document-v1",
          reviewStatus:
            "pending_review",
        });
      },
    );

    it(
      "preserves evidence bytes when extraction detaches its buffer",
      async () => {
        mocks.extractDocument
          .mockImplementation(
            async ({
              bytes,
            }) => {
              structuredClone(
                bytes,
                {
                  transfer: [
                    bytes,
                  ],
                },
              );

              return {
                text:
                  "Readable insurance declaration text with policy facts.",
                totalPages: 1,
                extractionMethod:
                  "native_pdf",
                requiresOCR:
                  false,
              };
            },
          );

        mocks.preserveEvidence
          .mockImplementation(
            async ({
              bytes,
            }) => {
              expect(
                Array.from(
                  new Uint8Array(
                    bytes,
                  ),
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

        const response =
          await POST(
            requestWith(
              uploadedDocument(),
            ),
          );

        expect(response.status)
          .toBe(200);
      },
    );

    it(
      "uses Vision OCR for scanned PDFs",
      async () => {
        mocks.extractDocument
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
              uploadedDocument(),
            ),
          );

        expect(response.status)
          .toBe(200);

        expect(
          mocks.extractOCR,
        ).toHaveBeenCalledWith({
          bytes:
            expect.any(
              ArrayBuffer,
            ),
          mimeType:
            "application/pdf",
        });

        expect(
          mocks.parseDocument,
        ).toHaveBeenCalledWith(
          "Readable OCR insurance declaration text with enough policy facts.",
        );

        expect(
          mocks.preserveEvidence,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            extractionMethod:
              "google_cloud_vision",
            reviewStatus:
              "pending_review",
          }),
        );
      },
    );

    it(
      "uses Vision directly for document photographs",
      async () => {
        const response =
          await POST(
            requestWith(
              uploadedDocument({
                name:
                  "Tax statement.png",
                type:
                  "image/png",
              }),
            ),
          );

        expect(response.status)
          .toBe(200);

        expect(
          mocks.extractDocument,
        ).not.toHaveBeenCalled();

        expect(
          mocks.extractOCR,
        ).toHaveBeenCalledWith({
          bytes:
            expect.any(
              ArrayBuffer,
            ),
          mimeType:
            "image/png",
        });
      },
    );

    it(
      "preserves failed OCR evidence without producing a proposal",
      async () => {
        mocks.extractDocument
          .mockResolvedValue({
            text: "",
            totalPages: 1,
            extractionMethod:
              "ocr_required",
            requiresOCR: true,
          });

        mocks.extractOCR
          .mockRejectedValue(
            new Error(
              "Vision unavailable.",
            ),
          );

        mocks.preserveEvidence
          .mockResolvedValue(
            evidence({
              reviewStatus:
                "extraction_failed",
            }),
          );

        const response =
          await POST(
            requestWith(
              uploadedDocument(),
            ),
          );

        expect(response.status)
          .toBe(422);

        await expect(
          response.json(),
        ).resolves.toMatchObject({
          success: false,
          error:
            "Vision unavailable.",
          evidence: {
            reviewStatus:
              "extraction_failed",
          },
        });

        expect(
          mocks.parseDocument,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "requires property identity and a supported document",
      async () => {
        const missingProperty =
          await POST(
            requestWith(
              uploadedDocument(),
              {
                propertyId: "",
              },
            ),
          );

        expect(
          missingProperty.status,
        ).toBe(400);

        const unsupported =
          await POST(
            requestWith(
              uploadedDocument({
                name:
                  "policy.txt",
                type:
                  "text/plain",
              }),
            ),
          );

        expect(
          unsupported.status,
        ).toBe(400);

        expect(
          mocks.preserveEvidence,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns authentication before reading the document",
      async () => {
        const authenticationResponse =
          Response.json(
            {
              error:
                "Authentication required.",
            },
            {
              status: 401,
            },
          );

        mocks.authenticate
          .mockResolvedValue({
            response:
              authenticationResponse,
          });

        const document =
          uploadedDocument();

        const response =
          await POST(
            requestWith(
              document,
            ),
          );

        expect(response).toBe(
          authenticationResponse,
        );

        expect(
          document.arrayBuffer,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
