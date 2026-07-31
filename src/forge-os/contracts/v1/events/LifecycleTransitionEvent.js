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

export function createLifecycleTransitionEventContract({
  contractId,
  version,
  description,
  provenance,
  eventId,
  eventType,
  transitionId,
  lifecycleDomain,
  contextVersion,
  correlationIdentity,
  evidenceReferences = [],
}) {
  const metadata = createContractMetadata({
    contractId,
    contractType: "lifecycle_transition_event",
    version,
    description,
  });

  const contractProvenance =
    createContractProvenance(provenance);

  const payload = Object.freeze({
    eventId,
    eventType,
    transitionId,
    lifecycleDomain,
    contextVersion,
    correlationIdentity,
    evidenceReferences:
      freezeCollection(evidenceReferences),
  });

  return createBaseContract({
    metadata,
    payload,
    provenance: contractProvenance,
  });
}
