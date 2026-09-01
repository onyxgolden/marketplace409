import { describe, expect, it } from "vitest";
import { AUTHORITY_DECISION, evaluatePatchPreparationAuthority } from "../evaluatePatchPreparationAuthority.mjs";
import { computeProposalDigest } from "../proposalContracts.mjs";

const OWNER = "jasonmorgan99@gmail.com";
const NOW = "2026-09-01T12:00:00.000Z";

function proposal(overrides = {}) {
  const base = {
    proposalId: "proposal_1", findingIds: ["finding_1"], objective: "Fix it.",
    allowedPaths: ["src/components/x.jsx"], forbiddenPaths: [],
    fileEdits: [{ path: "src/components/x.jsx", content: "export default function X() {}" }],
  };
  const merged = { ...base, ...overrides };
  return { ...merged, digest: computeProposalDigest(merged) };
}

function approvalFor(p, overrides = {}) {
  return {
    approverId: OWNER, proposalId: p.proposalId, proposalDigest: p.digest,
    grantedAt: "2026-09-01T11:00:00.000Z", expiresAt: "2026-09-01T12:30:00.000Z", ...overrides,
  };
}

describe("evaluatePatchPreparationAuthority", () => {
  it("approves the canonical owner with a valid, current, unexpired approval", () => {
    const p = proposal();
    const decision = evaluatePatchPreparationAuthority({ proposal: p, approval: approvalFor(p), callerEmail: OWNER, now: NOW });
    expect(decision.decision).toBe(AUTHORITY_DECISION.APPROVE);
  });

  // Required test: owner-only approval
  it("owner-only: the canonical owner's own request is the only one that can succeed", () => {
    const p = proposal();
    const decision = evaluatePatchPreparationAuthority({ proposal: p, approval: approvalFor(p), callerEmail: OWNER, now: NOW });
    expect(decision.decision).toBe(AUTHORITY_DECISION.APPROVE);
  });

  // Required test: unrelated-user and co-owner denial unless separately delegated
  it("denies a completely unrelated user", () => {
    const p = proposal();
    const decision = evaluatePatchPreparationAuthority({ proposal: p, approval: approvalFor(p, { approverId: "stranger@example.com" }), callerEmail: "stranger@example.com", now: NOW });
    expect(decision.decision).toBe(AUTHORITY_DECISION.DENY);
    expect(decision.reasonCodes).toContain("caller_is_not_canonical_owner_or_delegate");
  });

  it("denies a co-owner of the workspace who is not the canonical owner and not delegated", () => {
    const p = proposal();
    const coOwnerEmail = "co-owner@example.com";
    const decision = evaluatePatchPreparationAuthority({ proposal: p, approval: approvalFor(p, { approverId: coOwnerEmail }), callerEmail: coOwnerEmail, now: NOW });
    expect(decision.decision).toBe(AUTHORITY_DECISION.DENY);
    expect(decision.reasonCodes).toContain("caller_is_not_canonical_owner_or_delegate");
  });

  it("approves a co-owner when they are explicitly, separately delegated", () => {
    const p = proposal();
    const delegate = "delegate@example.com";
    const decision = evaluatePatchPreparationAuthority({
      proposal: p, approval: approvalFor(p, { approverId: delegate }), callerEmail: delegate, now: NOW,
      delegatedApproverEmails: [delegate],
    });
    expect(decision.decision).toBe(AUTHORITY_DECISION.APPROVE);
  });

  it("denies an empty/missing caller email", () => {
    const p = proposal();
    const decision = evaluatePatchPreparationAuthority({ proposal: p, approval: approvalFor(p), callerEmail: "", now: NOW });
    expect(decision.decision).toBe(AUTHORITY_DECISION.DENY);
  });

  it("is case-insensitive on email comparison (cannot be bypassed by case variation)", () => {
    const p = proposal();
    const decision = evaluatePatchPreparationAuthority({ proposal: p, approval: approvalFor(p, { approverId: OWNER.toUpperCase() }), callerEmail: OWNER.toUpperCase(), now: NOW });
    expect(decision.decision).toBe(AUTHORITY_DECISION.APPROVE);
  });

  // Required test: digest mismatch
  it("denies when the approval's digest does not match the proposal's current digest", () => {
    const p = proposal();
    const staleDigestApproval = approvalFor(p, { proposalDigest: `sha256:${"f".repeat(64)}` });
    const decision = evaluatePatchPreparationAuthority({ proposal: p, approval: staleDigestApproval, callerEmail: OWNER, now: NOW });
    expect(decision.decision).toBe(AUTHORITY_DECISION.DENY);
    expect(decision.reasonCodes).toContain("approval_digest_mismatch_or_scope_changed");
  });

  it("digest mismatch: an approval granted before the proposal's scope (allowedPaths) widened is invalidated -- rule 3", () => {
    const original = proposal();
    const approval = approvalFor(original);
    const widened = proposal({ allowedPaths: [...original.allowedPaths, "src/components/y.jsx"], fileEdits: [...original.fileEdits, { path: "src/components/y.jsx", content: "x" }] });
    const decision = evaluatePatchPreparationAuthority({ proposal: widened, approval, callerEmail: OWNER, now: NOW });
    expect(decision.decision).toBe(AUTHORITY_DECISION.DENY);
    expect(decision.reasonCodes).toContain("approval_digest_mismatch_or_scope_changed");
  });

  it("digest mismatch: an approval granted before the fileEdits content changed is invalidated", () => {
    const original = proposal();
    const approval = approvalFor(original);
    const contentChanged = proposal({ fileEdits: [{ path: original.allowedPaths[0], content: "a completely different implementation" }] });
    const decision = evaluatePatchPreparationAuthority({ proposal: contentChanged, approval, callerEmail: OWNER, now: NOW });
    expect(decision.decision).toBe(AUTHORITY_DECISION.DENY);
  });

  // Required test: stale approval
  it("denies an approval that has expired even though the digest still matches", () => {
    const p = proposal();
    const expired = approvalFor(p, { grantedAt: "2026-09-01T09:00:00.000Z", expiresAt: "2026-09-01T10:00:00.000Z" });
    const decision = evaluatePatchPreparationAuthority({ proposal: p, approval: expired, callerEmail: OWNER, now: NOW });
    expect(decision.decision).toBe(AUTHORITY_DECISION.DENY);
    expect(decision.reasonCodes).toContain("approval_expired");
  });

  it("denies an approval that expires at exactly `now` (boundary is exclusive)", () => {
    const p = proposal();
    const boundary = approvalFor(p, { expiresAt: NOW });
    const decision = evaluatePatchPreparationAuthority({ proposal: p, approval: boundary, callerEmail: OWNER, now: NOW });
    expect(decision.decision).toBe(AUTHORITY_DECISION.DENY);
    expect(decision.reasonCodes).toContain("approval_expired");
  });

  it("denies a malformed approval object rather than throwing", () => {
    const p = proposal();
    const decision = evaluatePatchPreparationAuthority({ proposal: p, approval: { not: "an approval" }, callerEmail: OWNER, now: NOW });
    expect(decision.decision).toBe(AUTHORITY_DECISION.DENY);
    expect(decision.reasonCodes).toContain("approval_malformed");
  });

  it("denies when the approval's own approverId does not match the current caller, even if the caller is the owner", () => {
    const p = proposal();
    // Simulates an approval record being replayed by someone other than who it was granted to.
    const decision = evaluatePatchPreparationAuthority({ proposal: p, approval: approvalFor(p, { approverId: "someone-else@example.com" }), callerEmail: OWNER, now: NOW });
    expect(decision.decision).toBe(AUTHORITY_DECISION.DENY);
    expect(decision.reasonCodes).toContain("approval_approver_does_not_match_caller");
  });

  it("denies when the approval references a different proposalId", () => {
    const p = proposal();
    const decision = evaluatePatchPreparationAuthority({ proposal: p, approval: approvalFor(p, { proposalId: "some_other_proposal" }), callerEmail: OWNER, now: NOW });
    expect(decision.decision).toBe(AUTHORITY_DECISION.DENY);
    expect(decision.reasonCodes).toContain("approval_proposal_id_mismatch");
  });
});
