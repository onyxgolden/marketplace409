import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createBaseContract,
} from "../BaseContract.js";

import {
  createContractMetadata,
} from "../ContractMetadata.js";

import {
  createContractProvenance,
} from "../ContractProvenance.js";

import {
  createContractVersion,
} from "../ContractVersion.js";

describe("BaseContract", () => {
  it("creates an immutable universal contract envelope", () => {
    const version = createContractVersion({
      major: 1,
      minor: 0,
      patch: 0,
    });

    const metadata = createContractMetadata({
      contractId: "forge.contract.example",
      contractType: "example",
      version,
      description: "Example platform contract.",
    });

    const payload = Object.freeze({
      value: "example",
    });

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
      evidenceReferences: [
        "evidence-001",
      ],
    });

    const contract = createBaseContract({
      metadata,
      payload,
      provenance,
    });

    expect(contract).toEqual({
      metadata,
      payload,
      provenance,
    });

    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.metadata)).toBe(
      true,
    );
    expect(Object.isFrozen(contract.payload)).toBe(
      true,
    );
    expect(Object.isFrozen(contract.provenance)).toBe(
      true,
    );
  });
});
