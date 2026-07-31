import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createContractVersion,
  validateContractStructure,
} from "../../core/index.js";

import {
  createManagerRequestContract,
} from "../ManagerRequestContract.js";

function createRequestContract(overrides = {}) {
  return createManagerRequestContract({
    contractId:
      "forge.request.manager.repository-inspection",
    version: createContractVersion({
      major: 1,
      minor: 0,
      patch: 0,
    }),
    description:
      "Requests repository inspection from a manager.",
    provenance: {
      requestId: "request-001",
      workflowId: "workflow-001",
      correlationId: "correlation-001",
      causationId: undefined,
      parentContractId: undefined,
      origin: Object.freeze({
        componentType: "kernel",
        componentId: "forge-os-kernel",
      }),
      contextVersion: "context-001",
      evidenceReferences: [],
    },
    targetWorkspace: "workspace-001",
    requestedCapability: "repository.inspect",
    input: Object.freeze({
      repositoryPath: "/repository",
    }),
    grantedAuthority: Object.freeze({
      scope: "read-only",
    }),
    securityScope: Object.freeze({
      repositoryBoundary: "/repository",
    }),
    requiredEvidence: [
      "repository-status",
    ],
    expectedOutput: Object.freeze({
      type: "repository-inspection",
    }),
    validationExpectations: [
      "structural-validation",
    ],
    interruptionRules: Object.freeze({
      timeoutMilliseconds: 30000,
    }),
    ...overrides,
  });
}

describe("ManagerRequestContract", () => {
  it("creates an immutable manager request contract", () => {
    const contract = createRequestContract();

    expect(contract.metadata.contractType).toBe(
      "request",
    );

    expect(contract.payload).toEqual({
      targetWorkspace: "workspace-001",
      requestedCapability: "repository.inspect",
      input: {
        repositoryPath: "/repository",
      },
      grantedAuthority: {
        scope: "read-only",
      },
      securityScope: {
        repositoryBoundary: "/repository",
      },
      requiredEvidence: [
        "repository-status",
      ],
      expectedOutput: {
        type: "repository-inspection",
      },
      validationExpectations: [
        "structural-validation",
      ],
      interruptionRules: {
        timeoutMilliseconds: 30000,
      },
    });

    expect(Object.isFrozen(contract)).toBe(true);
    expect(
      Object.isFrozen(contract.metadata),
    ).toBe(true);
    expect(
      Object.isFrozen(contract.payload),
    ).toBe(true);
    expect(
      Object.isFrozen(contract.provenance),
    ).toBe(true);
    expect(
      Object.isFrozen(
        contract.payload.requiredEvidence,
      ),
    ).toBe(true);
    expect(
      Object.isFrozen(
        contract.payload.validationExpectations,
      ),
    ).toBe(true);
  });

  it("keeps workflow identity in provenance", () => {
    const contract = createRequestContract();

    expect(contract.provenance.requestId).toBe(
      "request-001",
    );
    expect(contract.provenance.workflowId).toBe(
      "workflow-001",
    );
    expect(contract.provenance.correlationId).toBe(
      "correlation-001",
    );
    expect(contract.provenance.contextVersion).toBe(
      "context-001",
    );

    expect(contract.payload.requestId).toBeUndefined();
    expect(contract.payload.workflowId).toBeUndefined();
    expect(
      contract.payload.correlationId,
    ).toBeUndefined();
    expect(
      contract.payload.contextVersion,
    ).toBeUndefined();
  });

  it("passes universal structural validation", () => {
    expect(
      validateContractStructure(
        createRequestContract(),
      ),
    ).toEqual({
      valid: true,
      findings: [],
    });
  });

  it("isolates mutable collection inputs", () => {
    const requiredEvidence = [
      "repository-status",
    ];

    const validationExpectations = [
      "structural-validation",
    ];

    const contract = createRequestContract({
      requiredEvidence,
      validationExpectations,
    });

    requiredEvidence.push("unexpected-evidence");
    validationExpectations.push(
      "unexpected-validation",
    );

    expect(
      contract.payload.requiredEvidence,
    ).toEqual([
      "repository-status",
    ]);

    expect(
      contract.payload.validationExpectations,
    ).toEqual([
      "structural-validation",
    ]);
  });
});
