import {
  createEvidenceRecordContract,
} from "../contracts/v1/evidence/index.js";

function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

export class EvidenceProductionAdapter {
  createEvidenceRecord({
    outcome,
  }) {
    if (!outcome) {
      throw new Error(
        "EvidenceProductionAdapter requires an outcome.",
      );
    }

    if (!outcome.metadata) {
      throw new Error(
        "EvidenceProductionAdapter requires outcome metadata.",
      );
    }

    if (!outcome.provenance) {
      throw new Error(
        "EvidenceProductionAdapter requires outcome provenance.",
      );
    }

    if (!outcome.payload) {
      throw new Error(
        "EvidenceProductionAdapter requires outcome payload.",
      );
    }

    const {
      managerIdentity,
      capabilityInvoked,
      producedOutput,
    } = outcome.payload;

    if (!isNonEmptyString(managerIdentity)) {
      throw new Error(
        "EvidenceProductionAdapter requires manager identity.",
      );
    }

    if (!isNonEmptyString(capabilityInvoked)) {
      throw new Error(
        "EvidenceProductionAdapter requires capability invoked.",
      );
    }

    return createEvidenceRecordContract({
      contractId:
        `${outcome.metadata.contractId}.evidence`,
      version:
        outcome.metadata.version,
      description:
        "Evidence generated from manager outcome.",
      provenance:
        outcome.provenance,
      evidenceId:
        `${outcome.metadata.contractId}.evidence`,
      evidenceType:
        capabilityInvoked,
      sourceComponent:
        managerIdentity,
      lifecycleState:
        "produced",
      summary:
        producedOutput,
      validationStatus:
        "pending",
      artifacts: [],
    });
  }
}
