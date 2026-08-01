import {
  describe,
  expect,
  it,
} from "vitest";

import {
  EvidenceValidator,
} from "../EvidenceValidator.js";

function createEvidence(overrides = {}) {
  return {
    metadata: {
      contractType:
        "evidence-record",
    },
    payload: {
      evidenceId:
        "evidence-001",
      sourceComponent:
        "repository-manager",
      validationStatus:
        "passed",
      artifacts: [
        "inspection-output",
      ],
      ...overrides,
    },
  };
}

describe("EvidenceValidator", () => {
  it("accepts valid evidence records", () => {
    const validator =
      new EvidenceValidator();

    const result =
      validator.validate(
        createEvidence(),
      );

    expect(
      result.valid,
    ).toBe(true);

    expect(
      result.status,
    ).toBe("validated");

    expect(
      result.findings.length,
    ).toBe(0);
  });

  it("rejects missing evidence identifiers", () => {
    const validator =
      new EvidenceValidator();

    const result =
      validator.validate(
        createEvidence({
          evidenceId:
            "",
        }),
      );

    expect(
      result.valid,
    ).toBe(false);

    expect(
      result.findings[0].code,
    ).toBe(
      "missing_evidence_id",
    );
  });

  it("rejects invalid validation status", () => {
    const validator =
      new EvidenceValidator();

    const result =
      validator.validate(
        createEvidence({
          validationStatus:
            "unknown",
        }),
      );

    expect(
      result.valid,
    ).toBe(false);

    expect(
      result.findings[0].code,
    ).toBe(
      "invalid_validation_status",
    );
  });

  it("rejects malformed artifact collections", () => {
    const validator =
      new EvidenceValidator();

    const result =
      validator.validate(
        createEvidence({
          artifacts:
            "not-an-array",
        }),
      );

    expect(
      result.valid,
    ).toBe(false);

    expect(
      result.findings[0].code,
    ).toBe(
      "invalid_artifacts",
    );
  });
});
