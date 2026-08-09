const EVIDENCE_BUCKET =
  "property-evidence";

const MAX_EVIDENCE_BYTES =
  10 * 1024 * 1024;

const SIGNED_URL_TTL_SECONDS =
  5 * 60;

const ALLOWED_MIME_TYPES =
  Object.freeze([
    "application/pdf",
    "image/jpeg",
    "image/png",
  ]);

const EXTENSIONS_BY_MIME_TYPE =
  Object.freeze({
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
  });

function requireIdentifier(
  value,
  message,
) {
  if (
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    throw new Error(message);
  }

  return value.trim();
}

function optionalIdentifier(
  value,
) {
  if (
    value == null ||
    String(value).trim() === ""
  ) {
    return null;
  }

  return String(value).trim();
}

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
    "Property evidence bytes are required.",
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
    !ALLOWED_MIME_TYPES.includes(
      mimeType,
    )
  ) {
    throw new Error(
      "Property evidence must be a PDF, JPEG, or PNG file.",
    );
  }

  return mimeType;
}

function sanitizePathSegment(
  value,
  fallback,
) {
  const sanitized =
    String(value || "")
      .normalize("NFKD")
      .replace(
        /[^a-zA-Z0-9._-]+/g,
        "-",
      )
      .replace(
        /^[-._]+|[-._]+$/g,
        "",
      )
      .slice(0, 120);

  return sanitized || fallback;
}

function buildStoredFilename({
  originalFilename,
  mimeType,
}) {
  const extension =
    EXTENSIONS_BY_MIME_TYPE[
      mimeType
    ];

  const originalBase =
    String(
      originalFilename || "",
    )
      .split(/[\\/]/)
      .pop()
      ?.replace(
        /\.[^.]*$/,
        "",
      );

  const base =
    sanitizePathSegment(
      originalBase,
      "evidence",
    );

  return `${base}.${extension}`;
}

function normalizeTimestamp(
  value,
) {
  const timestamp =
    String(value || "").trim();

  if (
    Number.isNaN(
      Date.parse(timestamp),
    )
  ) {
    throw new Error(
      "Property evidence creation date must be valid.",
    );
  }

  return new Date(
    timestamp,
  ).toISOString();
}

function freezeEvidence(
  evidence,
) {
  return Object.freeze({
    ...evidence,
  });
}

export class PropertyEvidenceApplication {
  constructor({
    repository,
    storage,
    clock,
    idFactory,
  } = {}) {
    if (
      !repository ||
      typeof repository.save !==
        "function"
    ) {
      throw new Error(
        "PropertyEvidenceApplication requires a repository.",
      );
    }

    if (
      !storage ||
      typeof storage.from !==
        "function"
    ) {
      throw new Error(
        "PropertyEvidenceApplication requires storage.",
      );
    }

    this.repository =
      repository;

    this.storage =
      storage;

    this.clock =
      clock ??
      (() =>
        new Date().toISOString());

    this.idFactory =
      idFactory ??
      (() =>
        crypto.randomUUID());
  }

  async listEvidence(
    {
      propertyId = null,
      hvacSystemId = null,
      hvacEventId = null,
      reviewStatus = null,
    } = {},
    ownerId,
  ) {
    const authenticatedOwnerId =
      requireIdentifier(
        ownerId,
        "Property evidence owner id is required.",
      );

    if (
      typeof this.repository.list !==
        "function"
    ) {
      throw new Error(
        "Property evidence repository does not support listing.",
      );
    }

    const evidenceRecords =
      await this.repository.list(
        {
          propertyId:
            optionalIdentifier(
              propertyId,
            ),
          hvacSystemId:
            optionalIdentifier(
              hvacSystemId,
            ),
          hvacEventId:
            optionalIdentifier(
              hvacEventId,
            ),
          reviewStatus:
            optionalIdentifier(
              reviewStatus,
            ),
        },
        authenticatedOwnerId,
      );

    const evidence =
      await Promise.all(
        evidenceRecords.map(
          async (record) => {
            const bucket =
              this.storage.from(
                record.bucket,
              );

            if (
              !bucket ||
              typeof bucket
                .createSignedUrl !==
                "function"
            ) {
              throw new Error(
                "Property evidence storage does not support signed URLs.",
              );
            }

            const {
              data,
              error,
            } = await bucket
              .createSignedUrl(
                record.objectPath,
                SIGNED_URL_TTL_SECONDS,
              );

            if (error) {
              throw error;
            }

            const accessUrl =
              requireIdentifier(
                data?.signedUrl,
                "Property evidence signed URL was not returned.",
              );

            return Object.freeze({
              id:
                record.id,
              propertyId:
                record.propertyId,
              hvacSystemId:
                record.hvacSystemId,
              hvacEventId:
                record.hvacEventId,
              originalFilename:
                record.originalFilename,
              mimeType:
                record.mimeType,
              byteSize:
                record.byteSize,
              extractionMethod:
                record.extractionMethod,
              parserVersion:
                record.parserVersion,
              reviewStatus:
                record.reviewStatus,
              createdAt:
                record.createdAt,
              updatedAt:
                record.updatedAt,
              accessUrl,
              accessExpiresInSeconds:
                SIGNED_URL_TTL_SECONDS,
            });
          },
        ),
      );

    return Object.freeze(
      evidence,
    );
  }

  async preserve({
    ownerId,
    propertyId,
    hvacSystemId = null,
    hvacEventId = null,
    bytes,
    originalFilename,
    mimeType,
    extractionMethod =
      "pending",
    parserVersion = null,
    reviewStatus =
      "pending_review",
  }) {
    const normalizedOwnerId =
      requireIdentifier(
        ownerId,
        "Property evidence owner id is required.",
      );

    const normalizedPropertyId =
      requireIdentifier(
        propertyId,
        "Property evidence property id is required.",
      );

    const normalizedBytes =
      normalizeBytes(bytes);

    if (
      normalizedBytes.byteLength ===
        0
    ) {
      throw new Error(
        "Property evidence file is empty.",
      );
    }

    if (
      normalizedBytes.byteLength >
        MAX_EVIDENCE_BYTES
    ) {
      throw new Error(
        "Property evidence file must not exceed 10 MB.",
      );
    }

    const normalizedMimeType =
      normalizeMimeType(
        mimeType,
      );

    const normalizedFilename =
      requireIdentifier(
        originalFilename,
        "Property evidence original filename is required.",
      );

    const evidenceId =
      `property_evidence_${requireIdentifier(
        String(
          this.idFactory(),
        ),
        "Property evidence id is required.",
      )}`;

    const storedFilename =
      buildStoredFilename({
        originalFilename:
          normalizedFilename,
        mimeType:
          normalizedMimeType,
      });

    const objectPath = [
      sanitizePathSegment(
        normalizedOwnerId,
        "owner",
      ),
      sanitizePathSegment(
        normalizedPropertyId,
        "property",
      ),
      sanitizePathSegment(
        evidenceId,
        "evidence",
      ),
      storedFilename,
    ].join("/");

    const createdAt =
      normalizeTimestamp(
        this.clock(),
      );

    const bucket =
      this.storage.from(
        EVIDENCE_BUCKET,
      );

    const {
      error: uploadError,
    } = await bucket.upload(
      objectPath,
      normalizedBytes,
      {
        contentType:
          normalizedMimeType,
        upsert: false,
      },
    );

    if (uploadError) {
      throw uploadError;
    }

    const evidence =
      freezeEvidence({
        id:
          evidenceId,
        ownerId:
          normalizedOwnerId,
        propertyId:
          normalizedPropertyId,
        hvacSystemId:
          optionalIdentifier(
            hvacSystemId,
          ),
        hvacEventId:
          optionalIdentifier(
            hvacEventId,
          ),
        bucket:
          EVIDENCE_BUCKET,
        objectPath,
        originalFilename:
          normalizedFilename,
        mimeType:
          normalizedMimeType,
        byteSize:
          normalizedBytes.byteLength,
        extractionMethod:
          requireIdentifier(
            extractionMethod,
            "Property evidence extraction method is required.",
          ),
        parserVersion:
          optionalIdentifier(
            parserVersion,
          ),
        reviewStatus:
          requireIdentifier(
            reviewStatus,
            "Property evidence review status is required.",
          ),
        createdAt,
        updatedAt:
          createdAt,
      });

    const savedEvidence =
      await this.repository.save(
        evidence,
        {
          ownerId:
            normalizedOwnerId,
        },
      );

    return freezeEvidence(
      savedEvidence,
    );
  }
}

export {
  ALLOWED_MIME_TYPES,
  EVIDENCE_BUCKET,
  MAX_EVIDENCE_BYTES,
  SIGNED_URL_TTL_SECONDS,
  buildStoredFilename,
};
