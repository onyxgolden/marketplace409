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

export function createLifecycleTransitionContract({
  contractId,
  version,
  description,
  provenance,
  transitionId,
  lifecycleDomain,
  fromState,
  toState,
  initiatingCause,
  authorityDecision,
  governanceDecision,
  evidenceReferences = [],
  correlationIdentity,
  contextVersion,
}) {
  const metadata = createContractMetadata({
    contractId,
    contractType: "lifecycle_transition",
    version,
    description,
  });

  const contractProvenance =
    createContractProvenance(provenance);

  const payload = Object.freeze({
    transitionId,
    lifecycleDomain,
    fromState,
    toState,
    initiatingCause,
    authorityDecision,
    governanceDecision,
    evidenceReferences:
      freezeCollection(evidenceReferences),
    correlationIdentity,
    contextVersion,
  });

  return createBaseContract({
    metadata,
    payload,
    provenance: contractProvenance,
  });
}
