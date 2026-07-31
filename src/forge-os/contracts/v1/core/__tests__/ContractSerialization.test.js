import {
  describe,
  expect,
  it,
} from "vitest";

import {
  deserializeContract,
  serializeContract,
} from "../ContractSerialization.js";

describe("ContractSerialization", () => {
  it("serializes object keys deterministically", () => {
    const contract = {
      payload: {
        zebra: "last",
        alpha: "first",
        nested: {
          second: 2,
          first: 1,
        },
      },
      metadata: {
        contractType: "example",
        contractId: "contract-001",
      },
      provenance: {
        workflowId: "workflow-001",
        requestId: "request-001",
      },
    };

    expect(serializeContract(contract)).toBe(
      JSON.stringify({
        metadata: {
          contractId: "contract-001",
          contractType: "example",
        },
        payload: {
          alpha: "first",
          nested: {
            first: 1,
            second: 2,
          },
          zebra: "last",
        },
        provenance: {
          requestId: "request-001",
          workflowId: "workflow-001",
        },
      }),
    );
  });

  it("round-trips the contract as a plain object", () => {
    const contract = {
      metadata: {
        contractId: "contract-001",
      },
      payload: {
        value: 42,
      },
      provenance: {
        requestId: "request-001",
      },
    };

    const result = deserializeContract(
      serializeContract(contract),
    );

    expect(result).toEqual(contract);
    expect(Object.getPrototypeOf(result)).toBe(
      Object.prototype,
    );
    expect(Object.getPrototypeOf(result.payload)).toBe(
      Object.prototype,
    );
  });

  it("does not mutate the source object", () => {
    const contract = {
      metadata: {
        contractId: "contract-001",
      },
      payload: {
        zebra: 2,
        alpha: 1,
      },
      provenance: {},
    };

    const before = JSON.stringify(contract);

    serializeContract(contract);

    expect(JSON.stringify(contract)).toBe(before);
  });
});
