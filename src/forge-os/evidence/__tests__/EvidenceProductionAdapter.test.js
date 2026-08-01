import {
  describe,
  expect,
  it,
} from "vitest";

import {
  EvidenceProductionAdapter,
} from "../EvidenceProductionAdapter.js";

function createOutcome() {
  return {
    metadata: {
      contractId:
        "forge.outcome.test",
      version: {
        major: 1,
        minor: 0,
        patch: 0,
      },
    },
    provenance: {
      workflowId:
        "workflow-001",
    },
    payload: {
      managerIdentity:
        "test-manager",
      capabilityInvoked:
        "test.execute",
      producedOutput: {
        completed:
          true,
      },
    },
  };
}

describe("EvidenceProductionAdapter", () => {
  it("creates evidence records from manager outcomes", () => {
    const adapter =
      new EvidenceProductionAdapter();

    const evidence =
      adapter.createEvidenceRecord({
        outcome:
          createOutcome(),
      });

    expect(
      evidence.payload.sourceComponent,
    ).toBe(
      "test-manager",
    );

    expect(
      evidence.payload.evidenceType,
    ).toBe(
      "test.execute",
    );

    expect(
      evidence.payload.validationStatus,
    ).toBe(
      "pending",
    );
  });

  it("preserves outcome provenance", () => {
    const adapter =
      new EvidenceProductionAdapter();

    const evidence =
      adapter.createEvidenceRecord({
        outcome:
          createOutcome(),
      });

    expect(
      evidence.provenance.workflowId,
    ).toBe(
      "workflow-001",
    );
  });

  it("rejects missing outcomes", () => {
    const adapter =
      new EvidenceProductionAdapter();

    expect(() =>
      adapter.createEvidenceRecord({}),
    ).toThrow();
  });

  it("rejects outcomes without payloads", () => {
    const adapter =
      new EvidenceProductionAdapter();

    expect(() =>
      adapter.createEvidenceRecord({
        outcome: {
          metadata: {},
          provenance: {},
        },
      }),
    ).toThrow(
      "EvidenceProductionAdapter requires outcome payload.",
    );
  });

  it("rejects outcomes without manager identity", () => {
    const adapter =
      new EvidenceProductionAdapter();

    expect(() =>
      adapter.createEvidenceRecord({
        outcome: {
          metadata: {
            contractId:
              "forge.outcome.test",
            version: {
              major: 1,
              minor: 0,
              patch: 0,
            },
          },
          provenance: {
            workflowId:
              "workflow-001",
          },
          payload: {
            capabilityInvoked:
              "test.execute",
          },
        },
      }),
    ).toThrow(
      "EvidenceProductionAdapter requires manager identity.",
    );
  });

});
