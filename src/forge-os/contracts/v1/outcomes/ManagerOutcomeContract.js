import {
  createBaseContract,
  createContractMetadata,
  createContractProvenance,
} from "../core/index.js";

function freezeCollection(value) {
  return Array.isArray(value)
    ? Object.freeze([...value])
    : value;
}

export function createManagerOutcomeContract({
  contractId,
  version,
  description,
  provenance,
  managerIdentity,
  capabilityInvoked,
  completionStatus,
  stateChanged,
  producedOutput,
  producedEvidence = [],
  resultingRisks = [],
  validationRequirements = [],
  governanceRequirements = [],
  recoveryRequirements = [],
  additionalAuthorityRequirements = [],
  contextContribution,
  failureClassification,
  timingInformation,
}) {
  const metadata = createContractMetadata({
    contractId,
    contractType: "outcome",
    version,
    description,
  });

  const contractProvenance =
    createContractProvenance(provenance);

  const payload = Object.freeze({
    managerIdentity,
    capabilityInvoked,
    completionStatus,
    stateChanged,
    producedOutput,
    producedEvidence:
      freezeCollection(producedEvidence),
    resultingRisks:
      freezeCollection(resultingRisks),
    validationRequirements:
      freezeCollection(validationRequirements),
    governanceRequirements:
      freezeCollection(governanceRequirements),
    recoveryRequirements:
      freezeCollection(recoveryRequirements),
    additionalAuthorityRequirements:
      freezeCollection(
        additionalAuthorityRequirements,
      ),
    contextContribution,
    failureClassification,
    timingInformation,
  });

  return createBaseContract({
    metadata,
    payload,
    provenance: contractProvenance,
  });
}
