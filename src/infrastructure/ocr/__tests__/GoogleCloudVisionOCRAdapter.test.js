import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  credentialsFromEnv,
  DOCUMENT_TEXT_DETECTION,
  GoogleCloudVisionOCRAdapter,
} from "../GoogleCloudVisionOCRAdapter";

describe("credentialsFromEnv", () => {
  const originalValue = process.env.GOOGLE_CLOUD_VISION_CREDENTIALS;

  afterEach(() => {
    if (originalValue === undefined) delete process.env.GOOGLE_CLOUD_VISION_CREDENTIALS;
    else process.env.GOOGLE_CLOUD_VISION_CREDENTIALS = originalValue;
  });

  it("returns null when the env var is unset, so the client falls back to default ADC resolution", () => {
    delete process.env.GOOGLE_CLOUD_VISION_CREDENTIALS;
    expect(credentialsFromEnv()).toBeNull();
  });

  it("parses a service-account key JSON from the env var", () => {
    process.env.GOOGLE_CLOUD_VISION_CREDENTIALS = JSON.stringify({
      client_email: "forge-document-ocr@example.iam.gserviceaccount.com",
      project_id: "example-project",
      private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
    });

    expect(credentialsFromEnv()).toEqual({
      client_email: "forge-document-ocr@example.iam.gserviceaccount.com",
      project_id: "example-project",
      private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
    });
  });

  it("throws a clear error when the env var is set but not valid JSON", () => {
    process.env.GOOGLE_CLOUD_VISION_CREDENTIALS = "{not json";
    expect(() => credentialsFromEnv()).toThrow("GOOGLE_CLOUD_VISION_CREDENTIALS is not valid JSON.");
  });
});

describe(
  "GoogleCloudVisionOCRAdapter",
  () => {
    it(
      "extracts document text from image bytes",
      async () => {
        const client = {
          batchAnnotateImages:
            vi.fn()
              .mockResolvedValue([
                {
                  responses: [
                    {
                      fullTextAnnotation: {
                        text:
                          "HVAC invoice 603",
                      },
                    },
                  ],
                },
              ]),
          batchAnnotateFiles:
            vi.fn(),
        };

        const adapter =
          new GoogleCloudVisionOCRAdapter({
            client,
          });

        const result =
          await adapter.extractText({
            bytes:
              new Uint8Array([
                1,
                2,
                3,
              ]),
            mimeType:
              "image/jpeg",
          });

        expect(
          client.batchAnnotateImages,
        ).toHaveBeenCalledWith({
          requests: [
            {
              image: {
                content:
                  expect.any(
                    Uint8Array,
                  ),
              },
              features: [
                {
                  type:
                    DOCUMENT_TEXT_DETECTION,
                },
              ],
            },
          ],
        });

        expect(result).toEqual({
          text:
            "HVAC invoice 603",
          extractionMethod:
            "google_cloud_vision",
          mimeType:
            "image/jpeg",
          processedPages: 1,
          totalPages: 1,
          truncated: false,
        });

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(true);
      },
    );

    it(
      "extracts and joins synchronous PDF page text",
      async () => {
        const client = {
          batchAnnotateImages:
            vi.fn(),
          batchAnnotateFiles:
            vi.fn()
              .mockResolvedValue([
                {
                  responses: [
                    {
                      totalPages: 2,
                      responses: [
                        {
                          fullTextAnnotation: {
                            text:
                              "Invoice page one",
                          },
                        },
                        {
                          fullTextAnnotation: {
                            text:
                              "Invoice page two",
                          },
                        },
                      ],
                    },
                  ],
                },
              ]),
        };

        const adapter =
          new GoogleCloudVisionOCRAdapter({
            client,
          });

        const result =
          await adapter.extractText({
            bytes:
              new Uint8Array([
                37,
                80,
                68,
                70,
              ]).buffer,
            mimeType:
              "application/pdf",
          });

        expect(
          client.batchAnnotateFiles,
        ).toHaveBeenCalledWith({
          requests: [
            {
              inputConfig: {
                content:
                  expect.any(
                    Uint8Array,
                  ),
                mimeType:
                  "application/pdf",
              },
              features: [
                {
                  type:
                    DOCUMENT_TEXT_DETECTION,
                },
              ],
            },
          ],
        });

        expect(result).toEqual({
          text:
            "Invoice page one\n\nInvoice page two",
          extractionMethod:
            "google_cloud_vision",
          mimeType:
            "application/pdf",
          processedPages: 2,
          totalPages: 2,
          truncated: false,
        });
      },
    );

    it(
      "reports PDFs exceeding the five-page synchronous boundary",
      async () => {
        const client = {
          batchAnnotateImages:
            vi.fn(),
          batchAnnotateFiles:
            vi.fn()
              .mockResolvedValue([
                {
                  responses: [
                    {
                      totalPages: 8,
                      responses: [
                        {
                          fullTextAnnotation: {
                            text:
                              "First pages",
                          },
                        },
                      ],
                    },
                  ],
                },
              ]),
        };

        const result =
          await new GoogleCloudVisionOCRAdapter({
            client,
          }).extractText({
            bytes:
              new Uint8Array([
                1,
              ]),
            mimeType:
              "application/pdf",
          });

        expect(
          result.truncated,
        ).toBe(true);

        expect(
          result.totalPages,
        ).toBe(8);
      },
    );

    it(
      "falls back to text annotations",
      async () => {
        const client = {
          batchAnnotateImages:
            vi.fn()
              .mockResolvedValue([
                {
                  responses: [
                    {
                      textAnnotations: [
                        {
                          description:
                            "Fallback OCR text",
                        },
                      ],
                    },
                  ],
                },
              ]),
          batchAnnotateFiles:
            vi.fn(),
        };

        const result =
          await new GoogleCloudVisionOCRAdapter({
            client,
          }).extractText({
            bytes:
              new Uint8Array([
                1,
              ]),
            mimeType:
              "image/png",
          });

        expect(result.text)
          .toBe(
            "Fallback OCR text",
          );
      },
    );

    it(
      "propagates API response failures",
      async () => {
        const client = {
          batchAnnotateImages:
            vi.fn()
              .mockResolvedValue([
                {
                  responses: [
                    {
                      error: {
                        message:
                          "Permission denied",
                      },
                    },
                  ],
                },
              ]),
          batchAnnotateFiles:
            vi.fn(),
        };

        await expect(
          new GoogleCloudVisionOCRAdapter({
            client,
          }).extractText({
            bytes:
              new Uint8Array([
                1,
              ]),
            mimeType:
              "image/jpeg",
          }),
        ).rejects.toThrow(
          "Google Vision OCR failed: Permission denied",
        );
      },
    );

    it(
      "rejects missing, empty, and unsupported input",
      async () => {
        const adapter =
          new GoogleCloudVisionOCRAdapter({
            client: {
              batchAnnotateImages:
                vi.fn(),
              batchAnnotateFiles:
                vi.fn(),
            },
          });

        await expect(
          adapter.extractText({
            bytes: null,
            mimeType:
              "application/pdf",
          }),
        ).rejects.toThrow(
          "Google Vision OCR bytes are required.",
        );

        await expect(
          adapter.extractText({
            bytes:
              new Uint8Array(),
            mimeType:
              "application/pdf",
          }),
        ).rejects.toThrow(
          "Google Vision OCR file is empty.",
        );

        await expect(
          adapter.extractText({
            bytes:
              new Uint8Array([
                1,
              ]),
            mimeType:
              "text/plain",
          }),
        ).rejects.toThrow(
          "Google Vision OCR supports PDF, JPEG, and PNG files.",
        );
      },
    );

    it(
      "creates and caches the client lazily",
      async () => {
        const client = {
          batchAnnotateImages:
            vi.fn()
              .mockResolvedValue([
                {
                  responses: [
                    {
                      fullTextAnnotation: {
                        text:
                          "OCR text",
                      },
                    },
                  ],
                },
              ]),
          batchAnnotateFiles:
            vi.fn(),
        };

        const clientFactory =
          vi.fn()
            .mockResolvedValue(
              client,
            );

        const adapter =
          new GoogleCloudVisionOCRAdapter({
            clientFactory,
          });

        await adapter.extractText({
          bytes:
            new Uint8Array([
              1,
            ]),
          mimeType:
            "image/jpeg",
        });

        await adapter.extractText({
          bytes:
            new Uint8Array([
              2,
            ]),
          mimeType:
            "image/png",
        });

        expect(
          clientFactory,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  },
);
