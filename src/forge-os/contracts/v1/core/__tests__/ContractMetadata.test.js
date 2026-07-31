import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createContractMetadata,
} from "../ContractMetadata.js";

import {
  createContractVersion,
} from "../ContractVersion.js";

describe("ContractMetadata", () => {
  it("creates immutable contract metadata", () => {
    const version = createContractVersion({
      major: 1,
      minor: 0,
      patch: 0,
    });

    const metadata = createContractMetadata({
      contractId: "forge.request.repository-inspection",
      contractType: "request",
      version,
      description:
        "Requests repository inspection.",
    });

    expect(metadata).toEqual({
      contractId:
        "forge.request.repository-inspection",
      contractType: "request",
      version,
      description:
        "Requests repository inspection.",
    });

    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.version)).toBe(
      true,
    );
  });
});
