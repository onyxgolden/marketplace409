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

export function createCanonicalEngineeringContextContract({
  contractId,
  version,
  description,
  provenance,
  contextIdentity,
  repositoryState,
  memoryState,
  governanceState,
  executionState,
  validationState,
  authorityState,
  evidenceReferences = [],
}) {
  const metadata = createContractMetadata({
    contractId,
    contractType: "context",
    version,
    description,
  });

  const contractProvenance =
    createContractProvenance(provenance);

  const payload = Object.freeze({
    contextIdentity,
    repositoryState,
    memoryState,
    governanceState,
    executionState,
    validationState,
    authorityState,
    evidenceReferences:
      freezeCollection(evidenceReferences),
  });

  return createBaseContract({
    metadata,
    payload,
    provenance: contractProvenance,
  });
}
