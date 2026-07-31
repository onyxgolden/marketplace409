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

export function createAuthorityDecisionContract({
  contractId,
  version,
  description,
  provenance,
  decisionId,
  requirementId,
  decision,
  grantedAuthority,
  decidedBy,
  evidence = [],
}) {
  const metadata = createContractMetadata({
    contractId,
    contractType: "authority_decision",
    version,
    description,
  });

  const contractProvenance =
    createContractProvenance(provenance);

  const payload = Object.freeze({
    decisionId,
    requirementId,
    decision,
    grantedAuthority,
    decidedBy,
    evidence:
      freezeCollection(evidence),
  });

  return createBaseContract({
    metadata,
    payload,
    provenance: contractProvenance,
  });
}
