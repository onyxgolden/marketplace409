import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createEvidenceRecordContract,
} from "../EvidenceRecord.js";

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

describe("EvidenceRecordContract", () => {
  it("creates an immutable evidence record contract", () => {
    const evidence =
      createEvidenceRecordContract({
        contractId:
          "forge.evidence.execution-001",
        version: {
          major: 1,
          minor: 0,
          patch: 0,
          identifier:
            "1.0.0",
        },
        description:
          "Execution validation evidence.",
        provenance:
          createProvenance(),
        evidenceId:
          "evidence-001",
        evidenceType:
          "execution",
        sourceComponent:
          "repository-manager",
        lifecycleState:
          "executing",
        summary:
          "Repository inspection completed.",
        validationStatus:
          "passed",
        artifacts: [
          "inspection-output",
        ],
      });

    expect(
      evidence.metadata.contractType,
    ).toBe(
      "evidence-record",
    );

    expect(
      evidence.payload.evidenceType,
    ).toBe(
      "execution",
    );

    expect(
      evidence.payload.lifecycleState,
    ).toBe(
      "executing",
    );

    expect(
      evidence.payload.artifacts,
    ).toEqual([
      "inspection-output",
    ]);

    expect(
      Object.isFrozen(evidence),
    ).toBe(true);

    expect(
      Object.isFrozen(evidence.payload),
    ).toBe(true);

    expect(
      Object.isFrozen(evidence.payload.artifacts),
    ).toBe(true);
  });
});
