import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS, IllegalProposalTransitionError, MalformedProposalError, PROPOSAL_STATE,
  assertValidTransition, computeProposalDigest, transitionProposal, validateUiChangeProposal,
} from "../proposalContracts.mjs";

function validDraft(overrides = {}) {
  return {
    proposalId: "proposal_1", findingIds: ["finding_abc123"], objective: "Increase the touch target size.",
    allowedPaths: ["src/components/forge/financial/FinancialAccountBalancesPanel.jsx"], forbiddenPaths: [],
    fileEdits: [{ path: "src/components/forge/financial/FinancialAccountBalancesPanel.jsx", content: "export default function X() {}" }],
    status: PROPOSAL_STATE.DRAFT, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("validateUiChangeProposal", () => {
  it("accepts a well-formed draft and computes a digest", () => {
    const proposal = validateUiChangeProposal(validDraft());
    expect(proposal.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("rejects a proposal with no findingIds", () => {
    expect(() => validateUiChangeProposal(validDraft({ findingIds: [] }))).toThrow(MalformedProposalError);
  });

  it("rejects a proposal with no allowedPaths", () => {
    expect(() => validateUiChangeProposal(validDraft({ allowedPaths: [] }))).toThrow(/allowedPaths/);
  });

  it("rejects a proposal with no fileEdits", () => {
    expect(() => validateUiChangeProposal(validDraft({ fileEdits: [] }))).toThrow(/fileEdits/);
  });

  it("rejects a fileEdits entry for a path not covered by allowedPaths", () => {
    const draft = validDraft({ fileEdits: [{ path: "src/somewhere/else.js", content: "x" }] });
    expect(() => validateUiChangeProposal(draft)).toThrow(/not covered by allowedPaths/);
  });

  it("rejects duplicate fileEdits paths", () => {
    const edit = { path: "src/components/forge/financial/FinancialAccountBalancesPanel.jsx", content: "x" };
    expect(() => validateUiChangeProposal(validDraft({ fileEdits: [edit, edit] }))).toThrow(/duplicate path/);
  });

  it("rejects an unknown status", () => {
    expect(() => validateUiChangeProposal(validDraft({ status: "in_progress" }))).toThrow(/status must be one of/);
  });

  it("returns a frozen object", () => {
    const proposal = validateUiChangeProposal(validDraft());
    expect(() => { proposal.objective = "hacked"; }).toThrow();
  });
});

describe("computeProposalDigest", () => {
  it("is deterministic for identical content", () => {
    expect(computeProposalDigest(validDraft())).toBe(computeProposalDigest(validDraft()));
  });

  it("changes when the objective changes", () => {
    expect(computeProposalDigest(validDraft())).not.toBe(computeProposalDigest(validDraft({ objective: "Different objective." })));
  });

  it("changes when allowedPaths (scope) changes -- rule 3: any changed scope invalidates the approval", () => {
    const wider = validDraft({ allowedPaths: [...validDraft().allowedPaths, "src/components/forge/financial/Other.jsx"] });
    expect(computeProposalDigest(validDraft())).not.toBe(computeProposalDigest(wider));
  });

  it("changes when fileEdits content changes -- approving a proposal approves the exact content, not just the file list", () => {
    const edited = validDraft({ fileEdits: [{ ...validDraft().fileEdits[0], content: "different content" }] });
    expect(computeProposalDigest(validDraft())).not.toBe(computeProposalDigest(edited));
  });

  it("does not change when status or timestamps change", () => {
    const later = validDraft({ status: PROPOSAL_STATE.REVIEW_REQUESTED, updatedAt: "2026-09-02T00:00:00.000Z" });
    expect(computeProposalDigest(validDraft())).toBe(computeProposalDigest(later));
  });
});

describe("state machine transitions", () => {
  it("permits the full happy path through every required state", () => {
    let proposal = validateUiChangeProposal(validDraft());
    const path = [
      PROPOSAL_STATE.REVIEW_REQUESTED, PROPOSAL_STATE.PREVIEW_APPROVED, PROPOSAL_STATE.PATCH_PREPARED,
      PROPOSAL_STATE.VALIDATION_PASSED, PROPOSAL_STATE.PR_APPROVAL_REQUESTED, PROPOSAL_STATE.CLOSED,
    ];
    for (const next of path) {
      proposal = transitionProposal(proposal, next);
      expect(proposal.status).toBe(next);
    }
  });

  it("permits the rejection path", () => {
    let proposal = validateUiChangeProposal(validDraft());
    proposal = transitionProposal(proposal, PROPOSAL_STATE.REVIEW_REQUESTED);
    proposal = transitionProposal(proposal, PROPOSAL_STATE.REJECTED);
    expect(proposal.status).toBe(PROPOSAL_STATE.REJECTED);
  });

  it("permits the validation_failed retry path back into patch_prepared", () => {
    let proposal = validateUiChangeProposal(validDraft({ status: PROPOSAL_STATE.VALIDATION_FAILED }));
    proposal = transitionProposal(proposal, PROPOSAL_STATE.PATCH_PREPARED);
    expect(proposal.status).toBe(PROPOSAL_STATE.PATCH_PREPARED);
  });

  it("rejects skipping straight from draft to patch_prepared", () => {
    const proposal = validateUiChangeProposal(validDraft());
    expect(() => transitionProposal(proposal, PROPOSAL_STATE.PATCH_PREPARED)).toThrow(IllegalProposalTransitionError);
  });

  it("rejects skipping validation to reach pr_approval_requested directly from patch_prepared", () => {
    const proposal = validateUiChangeProposal(validDraft({ status: PROPOSAL_STATE.PATCH_PREPARED }));
    expect(() => transitionProposal(proposal, PROPOSAL_STATE.PR_APPROVAL_REQUESTED)).toThrow(IllegalProposalTransitionError);
  });

  it("rejects any transition out of closed -- terminal", () => {
    const proposal = validateUiChangeProposal(validDraft({ status: PROPOSAL_STATE.CLOSED }));
    expect(() => transitionProposal(proposal, PROPOSAL_STATE.DRAFT)).toThrow(IllegalProposalTransitionError);
  });

  it("permits closing from every non-terminal state", () => {
    for (const state of Object.values(PROPOSAL_STATE)) {
      if (state === PROPOSAL_STATE.CLOSED) continue;
      expect(ALLOWED_TRANSITIONS[state]).toContain(PROPOSAL_STATE.CLOSED);
    }
  });

  it("assertValidTransition throws for an unknown from-state", () => {
    expect(() => assertValidTransition("made_up_state", PROPOSAL_STATE.CLOSED)).toThrow(IllegalProposalTransitionError);
  });
});
