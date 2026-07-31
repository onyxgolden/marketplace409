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
  createLifecycleTransitionEventContract,
} from "../LifecycleTransitionEvent.js";

function createLifecycleTransitionEvent(overrides = {}) {
  return createLifecycleTransitionEventContract({
    contractId:
      "forge.event.lifecycle-transition.executing",
    version: createContractVersion({
      major: 1,
      minor: 0,
      patch: 0,
    }),
    description:
      "Records a lifecycle transition event.",
    provenance: {
      requestId: "request-001",
      workflowId: "workflow-001",
      correlationId: "correlation-001",
      causationId: "transition-001",
      parentContractId: "transition-001",
      origin: Object.freeze({
        componentType: "event",
        componentId: "event-coordinator",
      }),
      contextVersion: "context-002",
      evidenceReferences: [
        "evidence-001",
      ],
    },
    eventId:
      "event-001",
    eventType:
      "lifecycle.transition",
    transitionId:
      "transition-001",
    lifecycleDomain:
      "kernel",
    contextVersion:
      "context-002",
    correlationIdentity:
      "correlation-001",
    evidenceReferences: [
      "evidence-001",
    ],
    ...overrides,
  });
}

describe("LifecycleTransitionEventContract", () => {
  it("creates an immutable lifecycle transition event contract", () => {
    const contract =
      createLifecycleTransitionEvent();

    expect(contract.metadata.contractType).toBe(
      "lifecycle_transition_event",
    );

    expect(contract.payload.transitionId).toBe(
      "transition-001",
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
      createLifecycleTransitionEvent();

    expect(
      contract.provenance.workflowId,
    ).toBe("workflow-001");

    expect(
      contract.payload.workflowId,
    ).toBeUndefined();
  });

  it("passes universal structural validation", () => {
    expect(
      validateContractStructure(
        createLifecycleTransitionEvent(),
      ),
    ).toEqual({
      valid: true,
      findings: [],
    });
  });

  it("isolates mutable evidence references", () => {
    const evidenceReferences = [
      "evidence-001",
    ];

    const contract =
      createLifecycleTransitionEvent({
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
