import {
  EvidenceAcceptanceService,
  EvidenceProductionAdapter,
  EvidenceRegistry,
  EvidenceValidationCoordinator,
  EvidenceValidator,
} from "../evidence/index.js";


function requiresEvidence(outcome) {
  const payload =
    outcome.payload;

  return Boolean(
    payload.contextContribution ||
    payload.stateChanged ||
    payload.governanceRequirements?.length ||
    payload.validationRequirements?.length,
  );
}


function createCoordinationResult({
  outcome,
  acceptedEvidenceReferences = [],
}) {
  return Object.freeze({
    outcome,
    acceptedEvidenceReferences:
      Object.freeze([
        ...acceptedEvidenceReferences,
      ]),
  });
}


export class EvidenceCoordinator {
  constructor({
    evidenceProductionAdapter =
      new EvidenceProductionAdapter(),
    evidenceRegistry =
      new EvidenceRegistry(),
    evidenceValidator =
      new EvidenceValidator(),
    evidenceAcceptanceService,
    evidenceValidationCoordinator,
  } = {}) {
    if (!evidenceProductionAdapter) {
      throw new Error(
        "EvidenceCoordinator requires an evidenceProductionAdapter.",
      );
    }

    if (!evidenceRegistry) {
      throw new Error(
        "EvidenceCoordinator requires an evidenceRegistry.",
      );
    }

    if (!evidenceValidator) {
      throw new Error(
        "EvidenceCoordinator requires an evidenceValidator.",
      );
    }

    const acceptanceService =
      evidenceAcceptanceService ??
      new EvidenceAcceptanceService({
        evidenceRegistry,
        evidenceValidator,
      });

    const validationCoordinator =
      evidenceValidationCoordinator ??
      new EvidenceValidationCoordinator({
        evidenceAcceptanceService:
          acceptanceService,
      });

    this.evidenceProductionAdapter =
      evidenceProductionAdapter;

    this.evidenceRegistry =
      evidenceRegistry;

    this.evidenceValidationCoordinator =
      validationCoordinator;

    Object.freeze(this);
  }

  process({
    outcome,
  }) {
    if (!outcome) {
      throw new Error(
        "EvidenceCoordinator requires an outcome.",
      );
    }

    if (!requiresEvidence(outcome)) {
      return createCoordinationResult({
        outcome,
      });
    }

    const evidenceRecord =
      this.evidenceProductionAdapter
        .createEvidenceRecord({
          outcome,
        });

    this.evidenceRegistry.register(
      evidenceRecord,
    );

    const acceptedEvidenceReferences =
      this.evidenceValidationCoordinator
        .validateAndAccept({
          evidenceIds: [
            evidenceRecord.payload.evidenceId,
          ],
        });

    return createCoordinationResult({
      outcome,
      acceptedEvidenceReferences,
    });
  }
}
