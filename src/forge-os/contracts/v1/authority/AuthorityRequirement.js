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

export function createAuthorityRequirementContract({
  contractId,
  version,
  description,
  provenance,
  requirementId,
  authorityType,
  scope,
  requestedBy,
  reason,
  requiredEvidence = [],
}) {
  const metadata = createContractMetadata({
    contractId,
    contractType: "authority_requirement",
    version,
    description,
  });

  const contractProvenance =
    createContractProvenance(provenance);

  const payload = Object.freeze({
    requirementId,
    authorityType,
    scope,
    requestedBy,
    reason,
    requiredEvidence:
      freezeCollection(requiredEvidence),
  });

  return createBaseContract({
    metadata,
    payload,
    provenance: contractProvenance,
  });
}
