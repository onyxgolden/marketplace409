import {
  describe,
  expect,
  it,
} from "vitest";

import {
  validateContractStructure,
} from "../ContractValidator.js";

function createValidContract() {
  return {
    metadata: {
      contractId: "forge.contract.example",
      contractType: "example",
      version: {
        major: 1,
        minor: 0,
        patch: 0,
        identifier: "1.0.0",
      },
      description: "Example contract.",
    },
    payload: {
      value: "example",
    },
    provenance: {
      requestId: "request-001",
      workflowId: "workflow-001",
      correlationId: "correlation-001",
      causationId: undefined,
      parentContractId: undefined,
      origin: {
        componentType: "kernel",
        componentId: "forge-os-kernel",
      },
      contextVersion: "context-001",
      evidenceReferences: [
        "evidence-001",
      ],
    },
  };
}

describe("ContractValidator", () => {
  it("accepts a structurally valid contract", () => {
    const result = validateContractStructure(
      createValidContract(),
    );

    expect(result).toEqual({
      valid: true,
      findings: [],
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(
      Object.isFrozen(result.findings),
    ).toBe(true);
  });

  it("reports an invalid contract envelope", () => {
    const result = validateContractStructure(
      null,
    );

    expect(result.valid).toBe(false);
    expect(result.findings).toEqual([
      {
        code: "invalid_contract_envelope",
        path: "$",
        message:
          "Contract must be a plain object.",
      },
    ]);
  });

  it("reports missing and malformed fields", () => {
    const contract = createValidContract();

    contract.metadata.contractId = "";
    contract.metadata.version.patch = -1;
    contract.payload = [];
    contract.provenance.origin.componentId = "";
    contract.provenance.evidenceReferences = [
      "evidence-001",
      "",
    ];

    const result = validateContractStructure(
      contract,
    );

    expect(result.valid).toBe(false);

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "metadata.contractId",
        }),
        expect.objectContaining({
          path: "metadata.version.patch",
        }),
        expect.objectContaining({
          path: "payload",
        }),
        expect.objectContaining({
          path:
            "provenance.origin.componentId",
        }),
        expect.objectContaining({
          path:
            "provenance.evidenceReferences[1]",
        }),
      ]),
    );
  });

  it("detects a mismatched version identifier", () => {
    const contract = createValidContract();

    contract.metadata.version.identifier =
      "1.0.1";

    const result = validateContractStructure(
      contract,
    );

    expect(result.valid).toBe(false);
    expect(result.findings).toEqual([
      {
        code: "version_identifier_mismatch",
        path: "metadata.version.identifier",
        message:
          "metadata.version.identifier must match major.minor.patch.",
      },
    ]);
  });

  it("allows optional provenance identifiers to be undefined", () => {
    const contract = createValidContract();

    contract.provenance.causationId =
      undefined;

    contract.provenance.parentContractId =
      undefined;

    expect(
      validateContractStructure(contract),
    ).toEqual({
      valid: true,
      findings: [],
    });
  });
});
