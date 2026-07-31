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
  createAuthorityDecisionContract,
} from "../AuthorityDecision.js";

function createAuthorityDecision(overrides = {}) {
  return createAuthorityDecisionContract({
    contractId:
      "forge.authority.decision.production-change",
    version: createContractVersion({
      major: 1,
      minor: 0,
      patch: 0,
    }),
    description:
      "Records authority evaluation decision.",
    provenance: {
      requestId: "request-001",
      workflowId: "workflow-001",
      correlationId: "correlation-001",
      causationId: "authority-requirement-001",
      parentContractId: "authority-requirement-001",
      origin: Object.freeze({
        componentType: "governance",
        componentId: "governance-manager",
      }),
      contextVersion: "context-001",
      evidenceReferences: [
        "approval-record",
      ],
    },
    decisionId: "authority-decision-001",
    requirementId: "authority-requirement-001",
    decision: "granted",
    grantedAuthority: Object.freeze({
      scope: "financial-domain",
    }),
    decidedBy: "owner",
    evidence: [
      "approval-record",
    ],
    ...overrides,
  });
}

describe("AuthorityDecisionContract", () => {
  it("creates an immutable authority decision contract", () => {
    const contract = createAuthorityDecision();

    expect(contract.metadata.contractType).toBe(
      "authority_decision",
    );

    expect(contract.payload.decision).toBe(
      "granted",
    );

    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.payload)).toBe(true);
    expect(Object.isFrozen(contract.provenance)).toBe(true);
    expect(
      Object.isFrozen(contract.payload.evidence),
    ).toBe(true);
  });

  it("keeps identity in provenance", () => {
    const contract = createAuthorityDecision();

    expect(contract.provenance.requestId).toBe(
      "request-001",
    );

    expect(contract.payload.requestId).toBeUndefined();
    expect(contract.payload.workflowId).toBeUndefined();
  });

  it("passes universal structural validation", () => {
    expect(
      validateContractStructure(
        createAuthorityDecision(),
      ),
    ).toEqual({
      valid: true,
      findings: [],
    });
  });

  it("isolates mutable collection inputs", () => {
    const evidence = [
      "approval-record",
    ];

    const contract = createAuthorityDecision({
      evidence,
    });

    evidence.push(
      "unexpected-evidence",
    );

    expect(contract.payload.evidence).toEqual([
      "approval-record",
    ]);
  });
});
