import {
  describe,
  expect,
  it,
} from "vitest";

import {
  EvidenceRegistry,
} from "../EvidenceRegistry.js";

function createEvidence(evidenceId) {
  return {
    metadata: {
      contractType:
        "evidence-record",
    },
    payload: {
      evidenceId,
    },
    provenance: {
      workflowId:
        "workflow-001",
    },
  };
}


function createValidatedEvidence(evidenceId) {
  return {
    metadata: {
      contractType:
        "evidence-record",
    },
    payload: {
      evidenceId,
      sourceComponent:
        "test-validator",
    },
    provenance: {
      workflowId:
        "workflow-001",
    },
  };
}

describe("EvidenceRegistry", () => {
  it("registers and resolves evidence records", () => {
    const registry =
      new EvidenceRegistry();

    const evidence =
      createEvidence(
        "evidence-001",
      );

    registry.register(
      evidence,
    );

    expect(
      registry.get(
        "evidence-001",
      ),
    ).toBe(
      evidence,
    );

    expect(
      registry.has(
        "evidence-001",
      ),
    ).toBe(true);
  });

  it("rejects duplicate evidence identifiers", () => {
    const registry =
      new EvidenceRegistry();

    registry.register(
      createEvidence(
        "evidence-001",
      ),
    );

    expect(() =>
      registry.register(
        createEvidence(
          "evidence-001",
        ),
      ),
    ).toThrow();
  });

  it("returns immutable evidence listings", () => {
    const registry =
      new EvidenceRegistry();

    registry.register(
      createEvidence(
        "evidence-001",
      ),
    );

    const records =
      registry.list();

    expect(
      records.length,
    ).toBe(1);

    expect(
      Object.isFrozen(records),
    ).toBe(true);
  });
  it("creates accepted references from validated evidence", () => {
    const registry =
      new EvidenceRegistry();

    registry.register(
      createValidatedEvidence(
        "evidence-001",
      ),
    );

    const reference =
      registry.acceptValidationResult({
        evidenceId:
          "evidence-001",
        status:
          "validated",
      });

    expect(
      reference.evidenceId,
    ).toBe(
      "evidence-001",
    );

    expect(
      reference.sourceComponent,
    ).toBe(
      "test-validator",
    );

    expect(
      Object.isFrozen(reference),
    ).toBe(true);
  });

  it("rejects non-validated evidence acceptance", () => {
    const registry =
      new EvidenceRegistry();

    registry.register(
      createValidatedEvidence(
        "evidence-001",
      ),
    );

    expect(() =>
      registry.acceptValidationResult({
        evidenceId:
          "evidence-001",
        status:
          "rejected",
      }),
    ).toThrow();
  });

  it("rejects acceptance for unknown evidence", () => {
    const registry =
      new EvidenceRegistry();

    expect(() =>
      registry.acceptValidationResult({
        evidenceId:
          "missing-evidence",
        status:
          "validated",
      }),
    ).toThrow();
  });

});
