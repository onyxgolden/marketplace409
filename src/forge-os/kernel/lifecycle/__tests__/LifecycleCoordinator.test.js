import {
  describe,
  expect,
  it,
} from "vitest";

import {
  LifecycleCoordinator,
} from "../LifecycleCoordinator.js";

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

describe("LifecycleCoordinator", () => {
  it("creates lifecycle transition contracts", () => {
    const coordinator =
      new LifecycleCoordinator({
        initialState:
          "ready",
      });

    const transition =
      coordinator.transition({
        contractId:
          "forge.lifecycle.ready-planning",
        description:
          "Moves lifecycle into planning.",
        provenance:
          createProvenance(),
        toState:
          "planning",
        initiatingCause:
          "engineering-request",
        correlationIdentity:
          "correlation-001",
        contextVersion:
          "context-001",
      });

    expect(
      transition.metadata.contractType,
    ).toBe(
      "lifecycle_transition",
    );

    expect(
      transition.payload.fromState,
    ).toBe(
      "ready",
    );

    expect(
      transition.payload.toState,
    ).toBe(
      "planning",
    );

    expect(
      coordinator.getCurrentState(),
    ).toBe(
      "planning",
    );
  });

  it("rejects invalid lifecycle transitions", () => {
    const coordinator =
      new LifecycleCoordinator({
        initialState:
          "ready",
      });

    expect(() =>
      coordinator.transition({
        contractId:
          "forge.lifecycle.invalid",
        description:
          "Invalid transition.",
        provenance:
          createProvenance(),
        toState:
          "executing",
      }),
    ).toThrow();
  });

  it("keeps workflow identity in provenance", () => {
    const coordinator =
      new LifecycleCoordinator();

    const transition =
      coordinator.transition({
        contractId:
          "forge.lifecycle.ready-planning",
        description:
          "Transition test.",
        provenance:
          createProvenance(),
        toState:
          "planning",
      });

    expect(
      transition.provenance.workflowId,
    ).toBe(
      "workflow-001",
    );

    expect(
      transition.payload.workflowId,
    ).toBeUndefined();
  });
});
