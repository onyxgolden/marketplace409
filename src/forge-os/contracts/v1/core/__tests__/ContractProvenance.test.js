import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createContractProvenance,
} from "../ContractProvenance.js";

describe("ContractProvenance", () => {
  it("creates immutable contract provenance", () => {
    const origin = Object.freeze({
      componentType: "manager",
      componentId: "repository-intelligence-manager",
    });

    const provenance = createContractProvenance({
      requestId: "request-001",
      workflowId: "workflow-001",
      correlationId: "correlation-001",
      causationId: "contract-000",
      parentContractId: "contract-parent-001",
      origin,
      contextVersion: "context-001",
      evidenceReferences: [
        "evidence-001",
        "evidence-002",
      ],
    });

    expect(provenance).toEqual({
      requestId: "request-001",
      workflowId: "workflow-001",
      correlationId: "correlation-001",
      causationId: "contract-000",
      parentContractId: "contract-parent-001",
      origin,
      contextVersion: "context-001",
      evidenceReferences: [
        "evidence-001",
        "evidence-002",
      ],
    });

    expect(Object.isFrozen(provenance)).toBe(true);
    expect(
      Object.isFrozen(provenance.evidenceReferences),
    ).toBe(true);
  });

  it("creates an isolated evidence-reference collection", () => {
    const evidenceReferences = [
      "evidence-001",
    ];

    const provenance = createContractProvenance({
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
      evidenceReferences,
    });

    evidenceReferences.push("evidence-002");

    expect(provenance.evidenceReferences).toEqual([
      "evidence-001",
    ]);
  });
});
