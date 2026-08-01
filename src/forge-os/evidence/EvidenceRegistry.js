import {
  createAcceptedEvidenceReference,
} from "../contracts/v1/evidence/index.js";

export class EvidenceRegistry {
  constructor() {
    this.evidenceRecords = new Map();
  }

  register(evidenceRecord) {
    if (
      !evidenceRecord ||
      !evidenceRecord.payload ||
      typeof evidenceRecord.payload.evidenceId !== "string"
    ) {
      throw new Error(
        "Evidence record must contain an evidenceId.",
      );
    }

    const evidenceId =
      evidenceRecord.payload.evidenceId;

    if (
      this.evidenceRecords.has(evidenceId)
    ) {
      throw new Error(
        `Evidence already registered: ${evidenceId}`,
      );
    }

    this.evidenceRecords.set(
      evidenceId,
      evidenceRecord,
    );

    return evidenceRecord;
  }

  get(evidenceId) {
    return (
      this.evidenceRecords.get(evidenceId) ||
      null
    );
  }

  has(evidenceId) {
    return this.evidenceRecords.has(
      evidenceId,
    );
  }

  acceptValidationResult(validationResult) {
    if (!validationResult) {
      throw new Error(
        "Evidence validation result is required.",
      );
    }

    if (validationResult.status !== "validated") {
      throw new Error(
        "Only validated evidence can be accepted.",
      );
    }

    const evidenceRecord =
      this.get(validationResult.evidenceId);

    if (!evidenceRecord) {
      throw new Error(
        "Validated evidence must already be registered.",
      );
    }

    return createAcceptedEvidenceReference({
      evidenceId:
        validationResult.evidenceId,
      sourceComponent:
        evidenceRecord.payload.sourceComponent,
      acceptedAt:
        new Date().toISOString(),
    });
  }

  list() {
    return Object.freeze(
      Array.from(
        this.evidenceRecords.values(),
      ),
    );
  }
}
