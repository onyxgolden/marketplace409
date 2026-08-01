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

export function createSessionSnapshotContract({
  contractId,
  version,
  description,
  provenance,
  snapshotIdentity,
  capturedAt,
  acceptedEvidence = [],
  environment = {},
}) {
  const metadata = createContractMetadata({
    contractId,
    contractType: "snapshot",
    version,
    description,
  });

  const contractProvenance =
    createContractProvenance(provenance);

  const payload = Object.freeze({
    snapshotIdentity,
    capturedAt,
    acceptedEvidence:
      freezeCollection(acceptedEvidence),
    environment,
  });

  return createBaseContract({
    metadata,
    payload,
    provenance: contractProvenance,
  });
}
