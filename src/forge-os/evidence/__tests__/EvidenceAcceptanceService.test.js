import {
  describe,
  expect,
  it,
} from "vitest";

import {
  EvidenceAcceptanceService,
} from "../EvidenceAcceptanceService.js";

import {
  EvidenceRegistry,
} from "../EvidenceRegistry.js";

import {
  EvidenceValidator,
} from "../EvidenceValidator.js";

function createEvidence({
  evidenceId = "evidence-001",
  sourceComponent = "test-component",
  validationStatus = "passed",
} = {}) {
  return {
    metadata: {
      contractType:
        "evidence-record",
    },
    payload: {
      evidenceId,
      sourceComponent,
      validationStatus,
      artifacts: [],
    },
    provenance: {
      workflowId:
        "workflow-001",
    },
  };
}

describe("EvidenceAcceptanceService", () => {
  it("accepts valid evidence through the evidence boundary", () => {
    const registry =
      new EvidenceRegistry();

    registry.register(
      createEvidence(),
    );

    const service =
      new EvidenceAcceptanceService({
        evidenceRegistry:
          registry,
        evidenceValidator:
          new EvidenceValidator(),
      });

    const reference =
      service.accept(
        "evidence-001",
      );

    expect(
      reference.evidenceId,
    ).toBe(
      "evidence-001",
    );

    expect(
      Object.isFrozen(reference),
    ).toBe(true);
  });

  it("rejects invalid evidence", () => {
    const registry =
      new EvidenceRegistry();

    registry.register(
      createEvidence({
        sourceComponent:
          "",
      }),
    );

    const service =
      new EvidenceAcceptanceService({
        evidenceRegistry:
          registry,
        evidenceValidator:
          new EvidenceValidator(),
      });

    expect(() =>
      service.accept(
        "evidence-001",
      ),
    ).toThrow();
  });

  it("rejects missing evidence", () => {
    const service =
      new EvidenceAcceptanceService({
        evidenceRegistry:
          new EvidenceRegistry(),
        evidenceValidator:
          new EvidenceValidator(),
      });

    expect(() =>
      service.accept(
        "missing",
      ),
    ).toThrow();
  });

  it("requires dependencies", () => {
    expect(() =>
      new EvidenceAcceptanceService({}),
    ).toThrow();
  });
});
