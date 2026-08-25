const PDF_MIME_TYPE =
  "application/pdf";

const IMAGE_MIME_TYPES =
  Object.freeze([
    "image/jpeg",
    "image/png",
  ]);

const DOCUMENT_TEXT_DETECTION =
  "DOCUMENT_TEXT_DETECTION";

const MAX_SYNCHRONOUS_PDF_PAGES =
  5;

function normalizeBytes(bytes) {
  if (
    bytes instanceof
      ArrayBuffer
  ) {
    return new Uint8Array(
      bytes,
    );
  }

  if (
    ArrayBuffer.isView(bytes)
  ) {
    return new Uint8Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
  }

  throw new Error(
    "Google Vision OCR bytes are required.",
  );
}

function normalizeMimeType(
  value,
) {
  const mimeType =
    String(value || "")
      .trim()
      .toLowerCase();

  if (
    mimeType !==
      PDF_MIME_TYPE &&
    !IMAGE_MIME_TYPES.includes(
      mimeType,
    )
  ) {
    throw new Error(
      "Google Vision OCR supports PDF, JPEG, and PNG files.",
    );
  }

  return mimeType;
}

function requireContent(bytes) {
  const normalized =
    normalizeBytes(bytes);

  if (
    normalized.byteLength ===
      0
  ) {
    throw new Error(
      "Google Vision OCR file is empty.",
    );
  }

  return normalized;
}

function responseError(
  response,
) {
  const message =
    response?.error?.message;

  if (
    typeof message ===
      "string" &&
    message.trim()
  ) {
    return new Error(
      `Google Vision OCR failed: ${message.trim()}`,
    );
  }

  return null;
}

function annotationText(
  response,
) {
  return String(
    response
      ?.fullTextAnnotation
      ?.text ||
    response
      ?.textAnnotations
      ?.[0]
      ?.description ||
    "",
  ).trim();
}

// Vercel Functions have no persistent filesystem to point GOOGLE_APPLICATION_CREDENTIALS at, so
// the default (no-args) ImageAnnotatorClient() constructor -- which only resolves credentials via
// that file path, the GCE/GKE metadata server, or a local gcloud SDK login -- can never
// authenticate there. GOOGLE_CLOUD_VISION_CREDENTIALS holds the full service-account key JSON
// directly (as a Vercel env var), parsed and passed to the client explicitly instead.
function credentialsFromEnv() {
  const raw = process.env.GOOGLE_CLOUD_VISION_CREDENTIALS;

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      "GOOGLE_CLOUD_VISION_CREDENTIALS is not valid JSON.",
    );
  }
}

async function createDefaultClient() {
  const vision =
    await import(
      "@google-cloud/vision"
    );

  const ImageAnnotatorClient =
    vision.ImageAnnotatorClient ??
    vision.default
      ?.ImageAnnotatorClient;

  if (!ImageAnnotatorClient) {
    throw new Error(
      "Google Cloud Vision client is unavailable.",
    );
  }

  const credentials = credentialsFromEnv();

  return credentials
    ? new ImageAnnotatorClient({
        credentials,
        projectId: credentials.project_id,
      })
    : new ImageAnnotatorClient();
}

export class GoogleCloudVisionOCRAdapter {
  constructor({
    client = null,
    clientFactory =
      createDefaultClient,
  } = {}) {
    if (
      clientFactory &&
      typeof clientFactory !==
        "function"
    ) {
      throw new Error(
        "Google Vision OCR client factory must be a function.",
      );
    }

    this.client =
      client;

    this.clientFactory =
      clientFactory;

    this.clientPromise =
      null;
  }

  async getClient() {
    if (this.client) {
      return this.client;
    }

    if (!this.clientPromise) {
      this.clientPromise =
        Promise.resolve(
          this.clientFactory(),
        );
    }

    const client =
      await this.clientPromise;

    if (
      !client ||
      typeof client
        .batchAnnotateImages !==
        "function" ||
      typeof client
        .batchAnnotateFiles !==
        "function"
    ) {
      throw new Error(
        "Google Vision OCR client is invalid.",
      );
    }

    return client;
  }

  async extractText({
    bytes,
    mimeType,
  }) {
    const content =
      requireContent(bytes);

    const normalizedMimeType =
      normalizeMimeType(
        mimeType,
      );

    return normalizedMimeType ===
      PDF_MIME_TYPE
      ? this.extractPDFText({
          content,
        })
      : this.extractImageText({
          content,
          mimeType:
            normalizedMimeType,
        });
  }

  async extractImageText({
    content,
    mimeType,
  }) {
    const client =
      await this.getClient();

    const [
      result,
    ] = await client
      .batchAnnotateImages({
        requests: [
          {
            image: {
              content,
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

    const response =
      result?.responses?.[0];

    const failure =
      responseError(
        response,
      );

    if (failure) {
      throw failure;
    }

    return Object.freeze({
      text:
        annotationText(
          response,
        ),
      extractionMethod:
        "google_cloud_vision",
      mimeType,
      processedPages: 1,
      totalPages: 1,
      truncated: false,
    });
  }

  async extractPDFText({
    content,
  }) {
    const client =
      await this.getClient();

    const [
      result,
    ] = await client
      .batchAnnotateFiles({
        requests: [
          {
            inputConfig: {
              content,
              mimeType:
                PDF_MIME_TYPE,
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

    const fileResponse =
      result?.responses?.[0];

    const fileFailure =
      responseError(
        fileResponse,
      );

    if (fileFailure) {
      throw fileFailure;
    }

    const pageResponses =
      fileResponse
        ?.responses ?? [];

    const text = [];

    for (
      const pageResponse of
      pageResponses
    ) {
      const pageFailure =
        responseError(
          pageResponse,
        );

      if (pageFailure) {
        throw pageFailure;
      }

      const pageText =
        annotationText(
          pageResponse,
        );

      if (pageText) {
        text.push(
          pageText,
        );
      }
    }

    const totalPages =
      Number(
        fileResponse
          ?.totalPages ||
        pageResponses.length,
      );

    return Object.freeze({
      text:
        text.join(
          "\n\n",
        ).trim(),
      extractionMethod:
        "google_cloud_vision",
      mimeType:
        PDF_MIME_TYPE,
      processedPages:
        pageResponses.length,
      totalPages,
      truncated:
        totalPages >
          MAX_SYNCHRONOUS_PDF_PAGES,
    });
  }
}

export {
  credentialsFromEnv,
  DOCUMENT_TEXT_DETECTION,
  IMAGE_MIME_TYPES,
  MAX_SYNCHRONOUS_PDF_PAGES,
  PDF_MIME_TYPE,
};
