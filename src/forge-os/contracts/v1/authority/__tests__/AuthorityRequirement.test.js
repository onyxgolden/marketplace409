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
  createAuthorityRequirementContract,
} from "../AuthorityRequirement.js";

function createAuthorityRequirement(overrides = {}) {
  return createAuthorityRequirementContract({
    contractId:
      "forge.authority.requirement.production-change",
    version: createContractVersion({
      major: 1,
      minor: 0,
      patch: 0,
    }),
    description:
      "Defines authority required for protected execution.",
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
    requirementId: "authority-requirement-001",
    authorityType: "production-schema-change",
    scope: "financial-domain",
    requestedBy: "execution-manager",
    reason: "Requires elevated authority.",
    requiredEvidence: [
      "approval-record",
    ],
    ...overrides,
  });
}

describe("AuthorityRequirementContract", () => {
  it("creates an immutable authority requirement contract", () => {
    const contract = createAuthorityRequirement();

    expect(contract.metadata.contractType).toBe(
      "authority_requirement",
    );

    expect(contract.payload.requirementId).toBe(
      "authority-requirement-001",
    );

    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.payload)).toBe(true);
    expect(Object.isFrozen(contract.provenance)).toBe(true);
    expect(
      Object.isFrozen(
        contract.payload.requiredEvidence,
      ),
    ).toBe(true);
  });

  it("keeps identity in provenance", () => {
    const contract = createAuthorityRequirement();

    expect(contract.provenance.requestId).toBe(
      "request-001",
    );

    expect(contract.payload.requestId).toBeUndefined();
    expect(contract.payload.workflowId).toBeUndefined();
  });

  it("passes universal structural validation", () => {
    expect(
      validateContractStructure(
        createAuthorityRequirement(),
      ),
    ).toEqual({
      valid: true,
      findings: [],
    });
  });

  it("isolates mutable collection inputs", () => {
    const requiredEvidence = [
      "approval-record",
    ];

    const contract = createAuthorityRequirement({
      requiredEvidence,
    });

    requiredEvidence.push(
      "unexpected-evidence",
    );

    expect(
      contract.payload.requiredEvidence,
    ).toEqual([
      "approval-record",
    ]);
  });
});
