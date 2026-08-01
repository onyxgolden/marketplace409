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

export function createForgeEventContract({
  contractId,
  version,
  description,
  provenance,
  eventId,
  eventType,
  timestamp,
  actorIdentity,
  correlationIdentity,
  data = {},
}) {
  const metadata = createContractMetadata({
    contractId,
    contractType: "forge_event",
    version,
    description,
  });

  const contractProvenance =
    createContractProvenance(provenance);

  const payload = Object.freeze({
    eventId,
    eventType,
    timestamp,
    actorIdentity,
    correlationIdentity,
    data: Object.freeze({
      ...data,
    }),
  });

  return createBaseContract({
    metadata,
    payload,
    provenance: contractProvenance,
  });
}
