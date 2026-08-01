import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createSessionSnapshotContract,
} from "../SessionSnapshot.js";

function createProvenance() {
  return {
    requestId:
      "request-001",
    workflowId:
      "workflow-001",
    correlationId:
      "correlation-001",
    origin: {
      componentType:
        "kernel",
      componentId:
        "forge-os-kernel",
    },
    contextVersion:
      "context-001",
  };
}

describe("SessionSnapshotContract", () => {
  it("creates an immutable session snapshot contract", () => {
    const snapshot =
      createSessionSnapshotContract({
        contractId:
          "forge.snapshot.session-001",
        version: {
          major: 1,
          minor: 0,
          patch: 0,
          identifier:
            "1.0.0",
        },
        description:
          "Runtime session snapshot.",
        provenance:
          createProvenance(),
        snapshotIdentity:
          "session-001",
        capturedAt:
          "2026-08-01T21:00:00.000Z",
        acceptedEvidence: [
          {
            evidenceId:
              "evidence-001",
            sourceComponent:
              "repository-manager",
            acceptedAt:
              "2026-08-01T20:59:00.000Z",
          },
        ],
        environment: {
          branch:
            "main",
        },
      });

    expect(
      snapshot.metadata.contractType,
    ).toBe(
      "snapshot",
    );

    expect(
      snapshot.payload.snapshotIdentity,
    ).toBe(
      "session-001",
    );

    expect(
      snapshot.payload.acceptedEvidence,
    ).toEqual([
      {
        evidenceId:
          "evidence-001",
        sourceComponent:
          "repository-manager",
        acceptedAt:
          "2026-08-01T20:59:00.000Z",
      },
    ]);

    expect(
      Object.isFrozen(snapshot),
    ).toBe(true);

    expect(
      Object.isFrozen(snapshot.payload),
    ).toBe(true);

    expect(
      Object.isFrozen(snapshot.payload.acceptedEvidence),
    ).toBe(true);
  });
});
