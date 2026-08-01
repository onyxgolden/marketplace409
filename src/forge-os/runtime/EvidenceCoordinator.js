import {
  EvidenceProductionAdapter,
} from "../evidence/index.js";

import {
  createManagerOutcomeContract,
} from "../contracts/v1/outcomes/index.js";


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


export class EvidenceCoordinator {
  constructor({
    evidenceProductionAdapter =
      new EvidenceProductionAdapter(),
  } = {}) {
    this.evidenceProductionAdapter =
      evidenceProductionAdapter;

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
      return outcome;
    }

    const evidenceRecord =
      this.evidenceProductionAdapter.createEvidenceRecord({
        outcome,
      });

    return createManagerOutcomeContract({
      contractId:
        outcome.metadata.contractId,
      version:
        outcome.metadata.version,
      description:
        outcome.metadata.description,
      provenance:
        outcome.provenance,
      managerIdentity:
        outcome.payload.managerIdentity,
      capabilityInvoked:
        outcome.payload.capabilityInvoked,
      completionStatus:
        outcome.payload.completionStatus,
      stateChanged:
        outcome.payload.stateChanged,
      producedOutput:
        outcome.payload.producedOutput,
      producedEvidence: [
        evidenceRecord.metadata.contractId,
      ],
      resultingRisks:
        outcome.payload.resultingRisks,
      validationRequirements:
        outcome.payload.validationRequirements,
      governanceRequirements:
        outcome.payload.governanceRequirements,
      recoveryRequirements:
        outcome.payload.recoveryRequirements,
      additionalAuthorityRequirements:
        outcome.payload.additionalAuthorityRequirements,
      contextContribution:
        outcome.payload.contextContribution,
      failureClassification:
        outcome.payload.failureClassification,
      timingInformation:
        outcome.payload.timingInformation,
    });
  }
}
