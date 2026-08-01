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

  list() {
    return Object.freeze(
      Array.from(
        this.evidenceRecords.values(),
      ),
    );
  }
}
