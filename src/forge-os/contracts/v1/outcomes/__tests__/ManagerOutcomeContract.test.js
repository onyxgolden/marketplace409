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
  createManagerOutcomeContract,
} from "../ManagerOutcomeContract.js";

function createOutcomeContract(overrides = {}) {
  return createManagerOutcomeContract({
    contractId:
      "forge.outcome.manager.repository-inspection",
    version: createContractVersion({
      major: 1,
      minor: 0,
      patch: 0,
    }),
    description:
      "Reports repository inspection outcome.",
    provenance: {
      requestId: "request-001",
      workflowId: "workflow-001",
      correlationId: "correlation-001",
      causationId: "request-contract-001",
      parentContractId: "request-contract-001",
      origin: Object.freeze({
        componentType: "manager",
        componentId:
          "repository-intelligence-manager",
      }),
      contextVersion: "context-001",
      evidenceReferences: [
        "evidence-001",
      ],
    },
    managerIdentity:
      "repository-intelligence-manager",
    capabilityInvoked: "repository.inspect",
    completionStatus: "completed",
    stateChanged: false,
    producedOutput: Object.freeze({
      branch: "main",
    }),
    producedEvidence: [
      "evidence-001",
    ],
    resultingRisks: [],
    validationRequirements: [
      "structural-validation",
    ],
    governanceRequirements: [],
    recoveryRequirements: [],
    additionalAuthorityRequirements: [],
    contextContribution: Object.freeze({
      repositoryBranch: "main",
    }),
    failureClassification: undefined,
    timingInformation: Object.freeze({
      durationMilliseconds: 25,
    }),
    ...overrides,
  });
}

describe("ManagerOutcomeContract", () => {
  it("creates an immutable manager outcome contract", () => {
    const contract = createOutcomeContract();

    expect(contract.metadata.contractType).toBe(
      "outcome",
    );

    expect(contract.payload).toEqual({
      managerIdentity:
        "repository-intelligence-manager",
      capabilityInvoked: "repository.inspect",
      completionStatus: "completed",
      stateChanged: false,
      producedOutput: {
        branch: "main",
      },
      producedEvidence: [
        "evidence-001",
      ],
      resultingRisks: [],
      validationRequirements: [
        "structural-validation",
      ],
      governanceRequirements: [],
      recoveryRequirements: [],
      additionalAuthorityRequirements: [],
      contextContribution: {
        repositoryBranch: "main",
      },
      failureClassification: undefined,
      timingInformation: {
        durationMilliseconds: 25,
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
        contract.payload.producedEvidence,
      ),
    ).toBe(true);
  });

  it("keeps request and workflow identity in provenance", () => {
    const contract = createOutcomeContract();

    expect(contract.provenance.requestId).toBe(
      "request-001",
    );
    expect(contract.provenance.workflowId).toBe(
      "workflow-001",
    );
    expect(contract.provenance.correlationId).toBe(
      "correlation-001",
    );

    expect(contract.payload.requestId).toBeUndefined();
    expect(contract.payload.workflowId).toBeUndefined();
    expect(
      contract.payload.correlationId,
    ).toBeUndefined();
  });

  it("passes universal structural validation", () => {
    expect(
      validateContractStructure(
        createOutcomeContract(),
      ),
    ).toEqual({
      valid: true,
      findings: [],
    });
  });

  it("isolates mutable collection inputs", () => {
    const producedEvidence = [
      "evidence-001",
    ];

    const resultingRisks = [
      "risk-001",
    ];

    const contract = createOutcomeContract({
      producedEvidence,
      resultingRisks,
    });

    producedEvidence.push("unexpected-evidence");
    resultingRisks.push("unexpected-risk");

    expect(
      contract.payload.producedEvidence,
    ).toEqual([
      "evidence-001",
    ]);

    expect(
      contract.payload.resultingRisks,
    ).toEqual([
      "risk-001",
    ]);
  });
});
