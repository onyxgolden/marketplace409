import { describe, expect, it } from "vitest";
import { MalformedProposalApprovalError, validateProposalApproval } from "../approvalContracts.mjs";

function validApproval(overrides = {}) {
  return {
    approverId: "jasonmorgan99@gmail.com", proposalId: "proposal_1", proposalDigest: `sha256:${"a".repeat(64)}`,
    grantedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-01T01:00:00.000Z", ...overrides,
  };
}

describe("validateProposalApproval", () => {
  it("accepts a well-formed approval", () => {
    expect(validateProposalApproval(validApproval()).approverId).toBe("jasonmorgan99@gmail.com");
  });

  it("rejects a malformed digest", () => {
    expect(() => validateProposalApproval(validApproval({ proposalDigest: "not-a-digest" }))).toThrow(MalformedProposalApprovalError);
  });

  it("rejects an expiresAt at or before grantedAt", () => {
    expect(() => validateProposalApproval(validApproval({ expiresAt: validApproval().grantedAt }))).toThrow(/expiresAt must be after grantedAt/);
  });

  it("rejects a missing approverId", () => {
    expect(() => validateProposalApproval(validApproval({ approverId: "" }))).toThrow(/approverId/);
  });

  it("returns a frozen object", () => {
    const approval = validateProposalApproval(validApproval());
    expect(() => { approval.approverId = "hacked@example.com"; }).toThrow();
  });
});
