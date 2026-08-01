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

  it("preserves evidence lineage in lifecycle transitions", () => {
    const coordinator =
      new LifecycleCoordinator({
        initialState:
          "ready",
      });

    const transition =
      coordinator.transition({
        contractId:
          "forge.lifecycle.evidence-lineage",
        description:
          "Evidence lineage transition test.",
        provenance:
          createProvenance(),
        toState:
          "planning",
        initiatingCause:
          "evidence-validation",
        evidenceReferences: [
          "forge.outcome.manager.repository-inspection.correlation-001.evidence",
        ],
        correlationIdentity:
          "correlation-001",
        contextVersion:
          "context-001",
      });

    expect(
      transition.payload.evidenceReferences,
    ).toEqual([
      "forge.outcome.manager.repository-inspection.correlation-001.evidence",
    ]);

    expect(
      transition.payload.correlationIdentity,
    ).toBe(
      "correlation-001",
    );
  });


  it("records lifecycle transition events through the event sink", () => {
    const events = [];

    const coordinator =
      new LifecycleCoordinator({
        initialState:
          "ready",
        eventSink: {
          record(event) {
            events.push(event);
          },
        },
      });

    coordinator.transition({
      contractId:
        "forge.lifecycle.event-recording",
      description:
        "Records lifecycle event.",
      provenance:
        createProvenance(),
      toState:
        "planning",
      initiatingCause:
        "event-test",
      evidenceReferences: [
        "evidence-001",
      ],
      correlationIdentity:
        "correlation-001",
      contextVersion:
        "context-001",
    });

    expect(
      events.length,
    ).toBe(1);

    expect(
      events[0].metadata.contractType,
    ).toBe(
      "lifecycle_transition_event",
    );

    expect(
      events[0].payload.transitionId,
    ).toBe(
      "ready-planning",
    );

    expect(
      events[0].payload.correlationIdentity,
    ).toBe(
      "correlation-001",
    );

    expect(
      events[0].payload.evidenceReferences,
    ).toEqual([
      "evidence-001",
    ]);

    expect(
      events[0].provenance.workflowId,
    ).toBe(
      "workflow-001",
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
