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
  createLifecycleTransitionContract,
} from "../LifecycleTransition.js";

function createLifecycleTransition(overrides = {}) {
  return createLifecycleTransitionContract({
    contractId:
      "forge.lifecycle.transition.awaiting-authority-executing",
    version: createContractVersion({
      major: 1,
      minor: 0,
      patch: 0,
    }),
    description:
      "Records a controlled lifecycle transition.",
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
    transitionId:
      "transition-001",
    lifecycleDomain:
      "kernel",
    fromState:
      "Awaiting Authority",
    toState:
      "Executing",
    initiatingCause:
      "authority-approved-plan",
    authorityDecision: Object.freeze({
      decisionId:
        "authority-decision-001",
      decision:
        "granted",
    }),
    governanceDecision: Object.freeze({
      decision:
        "accepted",
    }),
    evidenceReferences: [
      "evidence-001",
    ],
    correlationIdentity:
      "correlation-001",
    contextVersion:
      "context-002",
    ...overrides,
  });
}

describe("LifecycleTransitionContract", () => {
  it("creates an immutable lifecycle transition contract", () => {
    const contract =
      createLifecycleTransition();

    expect(contract.metadata.contractType).toBe(
      "lifecycle_transition",
    );

    expect(contract.payload.fromState).toBe(
      "Awaiting Authority",
    );

    expect(contract.payload.toState).toBe(
      "Executing",
    );

    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.payload)).toBe(true);
    expect(Object.isFrozen(contract.provenance)).toBe(true);
    expect(
      Object.isFrozen(
        contract.payload.evidenceReferences,
      ),
    ).toBe(true);
  });

  it("keeps workflow identity in provenance", () => {
    const contract =
      createLifecycleTransition();

    expect(
      contract.provenance.requestId,
    ).toBe("request-001");

    expect(
      contract.payload.requestId,
    ).toBeUndefined();

    expect(
      contract.payload.workflowId,
    ).toBeUndefined();
  });

  it("passes universal structural validation", () => {
    expect(
      validateContractStructure(
        createLifecycleTransition(),
      ),
    ).toEqual({
      valid: true,
      findings: [],
    });
  });

  it("isolates mutable collection inputs", () => {
    const evidenceReferences = [
      "evidence-001",
    ];

    const contract =
      createLifecycleTransition({
        evidenceReferences,
      });

    evidenceReferences.push(
      "unexpected-evidence",
    );

    expect(
      contract.payload.evidenceReferences,
    ).toEqual([
      "evidence-001",
    ]);
  });
});
