import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createContractVersion,
} from "../ContractVersion.js";

describe("ContractVersion", () => {
  it("creates immutable semantic-version metadata", () => {
    const version = createContractVersion({
      major: 1,
      minor: 0,
      patch: 0,
    });

    expect(version).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      identifier: "1.0.0",
    });

    expect(Object.isFrozen(version)).toBe(true);
  });
});
