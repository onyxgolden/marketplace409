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

export function createManagerRequestContract({
  contractId,
  version,
  description,
  provenance,
  targetWorkspace,
  requestedCapability,
  input,
  grantedAuthority,
  securityScope,
  requiredEvidence = [],
  expectedOutput,
  validationExpectations,
  interruptionRules,
}) {
  const metadata = createContractMetadata({
    contractId,
    contractType: "request",
    version,
    description,
  });

  const contractProvenance =
    createContractProvenance(provenance);

  const payload = Object.freeze({
    targetWorkspace,
    requestedCapability,
    input,
    grantedAuthority,
    securityScope,
    requiredEvidence:
      freezeCollection(requiredEvidence),
    expectedOutput,
    validationExpectations:
      freezeCollection(validationExpectations),
    interruptionRules,
  });

  return createBaseContract({
    metadata,
    payload,
    provenance: contractProvenance,
  });
}
