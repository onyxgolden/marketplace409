import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildSessionSnapshot,
} from "../SessionSnapshotBuilder.js";

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

describe("SessionSnapshotBuilder", () => {
  it("builds a session snapshot contract from accepted evidence", () => {
    const snapshot =
      buildSessionSnapshot({
        snapshotIdentity:
          "session-001",
        provenance:
          createProvenance(),
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
        capturedAt:
          "2026-08-01T21:00:00.000Z",
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
    ).toHaveLength(
      1,
    );

    expect(
      snapshot.payload.environment.branch,
    ).toBe(
      "main",
    );
  });
});
