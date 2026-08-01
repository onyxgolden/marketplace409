export class EvidenceValidationCoordinator {
  constructor({
    evidenceAcceptanceService,
  }) {
    if (!evidenceAcceptanceService) {
      throw new Error(
        "EvidenceValidationCoordinator requires an evidenceAcceptanceService.",
      );
    }

    this.evidenceAcceptanceService =
      evidenceAcceptanceService;

    Object.freeze(this);
  }

  validateAndAccept({
    evidenceIds,
  }) {
    if (!Array.isArray(evidenceIds)) {
      throw new Error(
        "EvidenceValidationCoordinator requires evidenceIds.",
      );
    }

    return evidenceIds.map(
      (evidenceId) =>
        this.evidenceAcceptanceService.accept(
          evidenceId,
        ),
    );
  }
}
