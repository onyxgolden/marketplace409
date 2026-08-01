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
  createForgeEventContract,
} from "../ForgeEvent.js";

function createForgeEvent(overrides = {}) {
  return createForgeEventContract({
    contractId:
      "forge.event.execution.started",
    version:
      createContractVersion({
        major: 1,
        minor: 0,
        patch: 0,
      }),
    description:
      "Records a FORGE execution event.",
    provenance: {
      requestId:
        "request-001",
      workflowId:
        "workflow-001",
      correlationId:
        "correlation-001",
      causationId:
        "event-001",
      parentContractId:
        "request-001",
      origin:
        Object.freeze({
          componentType:
            "runtime",
          componentId:
            "forge-runtime",
        }),
      contextVersion:
        "context-001",
      evidenceReferences: [
        "evidence-001",
      ],
    },
    eventId:
      "event-001",
    eventType:
      "execution.started",
    timestamp:
      "2026-08-01T20:00:00Z",
    actorIdentity:
      "manager-001",
    correlationIdentity:
      "correlation-001",
    data:
      Object.freeze({
        status:
          "started",
      }),
    ...overrides,
  });
}

describe("ForgeEventContract", () => {
  it("creates an immutable forge event contract", () => {
    const contract =
      createForgeEvent();

    expect(
      contract.metadata.contractType,
    ).toBe(
      "forge_event",
    );

    expect(
      contract.payload.eventType,
    ).toBe(
      "execution.started",
    );

    expect(
      Object.isFrozen(contract),
    ).toBe(true);

    expect(
      Object.isFrozen(contract.payload),
    ).toBe(true);

    expect(
      Object.isFrozen(contract.provenance),
    ).toBe(true);
  });

  it("keeps workflow identity in provenance", () => {
    const contract =
      createForgeEvent();

    expect(
      contract.provenance.workflowId,
    ).toBe(
      "workflow-001",
    );

    expect(
      contract.payload.workflowId,
    ).toBeUndefined();
  });

  it("passes universal structural validation", () => {
    expect(
      validateContractStructure(
        createForgeEvent(),
      ),
    ).toEqual({
      valid: true,
      findings: [],
    });
  });

  it("isolates mutable event data", () => {
    const data = {
      status:
        "started",
    };

    const contract =
      createForgeEvent({
        data,
      });

    data.status =
      "changed";

    expect(
      contract.payload.data.status,
    ).toBe(
      "started",
    );
  });
});
