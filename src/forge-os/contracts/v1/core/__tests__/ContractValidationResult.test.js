import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createContractValidationResult,
} from "../ContractValidationResult.js";

describe("ContractValidationResult", () => {
  it("creates a valid immutable result", () => {
    const result =
      createContractValidationResult();

    expect(result).toEqual({
      valid: true,
      findings: [],
    });

    expect(
      Object.isFrozen(result),
    ).toBe(true);

    expect(
      Object.isFrozen(result.findings),
    ).toBe(true);
  });

  it("creates an invalid immutable result", () => {
    const finding = {
      code: "invalid_object",
      path: "payload",
      message:
        "payload must be a plain object.",
    };

    const result =
      createContractValidationResult({
        findings: [finding],
      });

    expect(result).toEqual({
      valid: false,
      findings: [finding],
    });

    expect(
      Object.isFrozen(result.findings[0]),
    ).toBe(true);
  });

  it("does not retain mutable finding references", () => {
    const finding = {
      code: "invalid_object",
      path: "payload",
      message:
        "payload must be a plain object.",
    };

    const result =
      createContractValidationResult({
        findings: [finding],
      });

    finding.path = "metadata";

    expect(
      result.findings[0].path,
    ).toBe("payload");
  });

  it("rejects non-array findings", () => {
    expect(() =>
      createContractValidationResult({
        findings: null,
      }),
    ).toThrow(
      "findings must be an array.",
    );
  });
});
