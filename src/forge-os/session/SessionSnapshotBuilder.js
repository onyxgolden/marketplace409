import {
  createSessionSnapshotContract,
} from "../contracts/v1/index.js";

const SESSION_SNAPSHOT_VERSION = Object.freeze({
  major: 1,
  minor: 0,
  patch: 0,
  identifier: "1.0.0",
});

export function buildSessionSnapshot({
  snapshotIdentity,
  provenance,
  acceptedEvidence = [],
  environment = {},
  capturedAt = new Date().toISOString(),
}) {
  return createSessionSnapshotContract({
    contractId:
      "forge.snapshot.session",
    version:
      SESSION_SNAPSHOT_VERSION,
    description:
      "FORGE session snapshot.",
    provenance,
    snapshotIdentity,
    capturedAt,
    acceptedEvidence,
    environment,
  });
}
