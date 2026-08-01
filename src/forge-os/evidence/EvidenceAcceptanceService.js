export class EvidenceAcceptanceService {
  constructor({
    evidenceRegistry,
    evidenceValidator,
  }) {
    if (!evidenceRegistry) {
      throw new Error(
        "EvidenceAcceptanceService requires an evidenceRegistry.",
      );
    }

    if (!evidenceValidator) {
      throw new Error(
        "EvidenceAcceptanceService requires an evidenceValidator.",
      );
    }

    this.evidenceRegistry =
      evidenceRegistry;

    this.evidenceValidator =
      evidenceValidator;

    Object.freeze(this);
  }

  accept(evidenceId) {
    const evidenceRecord =
      this.evidenceRegistry.get(
        evidenceId,
      );

    if (!evidenceRecord) {
      throw new Error(
        "Evidence record was not found.",
      );
    }

    const validationResult =
      this.evidenceValidator.validate(
        evidenceRecord,
      );

    return this.evidenceRegistry.acceptValidationResult(
      validationResult,
    );
  }
}
