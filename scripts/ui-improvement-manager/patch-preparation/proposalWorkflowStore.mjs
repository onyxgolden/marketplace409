// Local-filesystem-only persistence for the FB-UI-3/4 proposal workflow -- same deliberate scope
// decision as FB-UI-2's proposalStore.mjs: no Supabase table, no migration (a migration stays a
// permanently protected operation requiring its own separate approval, per the FB-UI-0 checkpoint's
// findings). This store only ever enforces `proposalContracts.mjs`'s own state machine and persists
// what other modules in this directory already produce -- it invents no new business rule of its own.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PROPOSAL_STATE, transitionProposal, validateUiChangeProposal } from "./proposalContracts.mjs";
import { validateProposalApproval } from "./approvalContracts.mjs";
import { evaluatePatchPreparationAuthority, AUTHORITY_DECISION } from "./evaluatePatchPreparationAuthority.mjs";

export class WorkflowStoreError extends Error {
  constructor(reasonCode, detail) {
    super(detail);
    this.name = "WorkflowStoreError";
    this.reasonCode = reasonCode;
  }
}

function proposalsPath(evidenceDir) { return path.join(evidenceDir, "ui-change-proposals.json"); }
function approvalsPath(evidenceDir) { return path.join(evidenceDir, "ui-change-approvals.json"); }

function readJsonArray(filePath) {
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return parsed;
  } catch (cause) {
    throw new WorkflowStoreError("malformed", `"${filePath}" is not a valid JSON array: ${cause.message}`);
  }
}

function writeJsonArray(filePath, items) {
  writeFileSync(filePath, JSON.stringify(items, null, 2));
}

export function createProposal(evidenceDir, draft, { now = new Date().toISOString() } = {}) {
  const proposal = validateUiChangeProposal({ ...draft, status: PROPOSAL_STATE.DRAFT, createdAt: now, updatedAt: now });
  const proposals = readJsonArray(proposalsPath(evidenceDir));
  if (proposals.some((p) => p.proposalId === proposal.proposalId)) {
    throw new WorkflowStoreError("duplicate_proposal_id", `Proposal "${proposal.proposalId}" already exists.`);
  }
  writeJsonArray(proposalsPath(evidenceDir), [...proposals, proposal]);
  return proposal;
}

export function readProposal(evidenceDir, proposalId) {
  const proposals = readJsonArray(proposalsPath(evidenceDir));
  const proposal = proposals.find((p) => p.proposalId === proposalId);
  if (!proposal) throw new WorkflowStoreError("not_found", `No proposal with id "${proposalId}".`);
  return validateUiChangeProposal(proposal);
}

function writeProposal(evidenceDir, updated) {
  const proposals = readJsonArray(proposalsPath(evidenceDir));
  const index = proposals.findIndex((p) => p.proposalId === updated.proposalId);
  if (index === -1) throw new WorkflowStoreError("not_found", `No proposal with id "${updated.proposalId}".`);
  const next = proposals.map((p, i) => (i === index ? updated : p));
  writeJsonArray(proposalsPath(evidenceDir), next);
  return updated;
}

// Any state -> next state, enforced by proposalContracts.mjs's own ALLOWED_TRANSITIONS table (not
// re-implemented here). Used for the transitions that carry no extra business rule of their own
// (request review, reject, request revision, close).
export function advanceProposal(evidenceDir, proposalId, toStatus, { now = new Date().toISOString() } = {}) {
  const current = readProposal(evidenceDir, proposalId);
  const next = transitionProposal(current, toStatus, { now });
  return writeProposal(evidenceDir, next);
}

// The one transition with a real gate: rule 1 applies at the moment approval is *granted*, not only
// when it's later consumed by preparePatch.mjs -- an unrelated user or an unapproved co-owner cannot
// grant themselves a preview_approved state no matter what they claim their email is, because this
// function is the only place a ProposalApproval record is ever created and persisted.
export function grantPreviewApproval(evidenceDir, proposalId, { approverId, now = new Date().toISOString(), expiresInMs = 60 * 60 * 1000, canonicalOwnerEmail, delegatedApproverEmails } = {}) {
  const proposal = readProposal(evidenceDir, proposalId);
  const approval = validateProposalApproval({
    approverId, proposalId, proposalDigest: proposal.digest, grantedAt: now, expiresAt: new Date(Date.parse(now) + expiresInMs).toISOString(),
  });

  // Self-check with the same evaluator preparePatch.mjs will later use -- an approval that wouldn't
  // itself pass evaluatePatchPreparationAuthority is never persisted in the first place. This is what
  // makes "only the canonical owner may approve" true at grant time, not merely enforced later.
  const authority = evaluatePatchPreparationAuthority({ proposal, approval, callerEmail: approverId, now, canonicalOwnerEmail, delegatedApproverEmails });
  if (authority.decision !== AUTHORITY_DECISION.APPROVE) {
    throw new WorkflowStoreError("approval_denied", `Preview approval denied: ${authority.reasonCodes.join(", ")}`);
  }

  const approvals = readJsonArray(approvalsPath(evidenceDir));
  writeJsonArray(approvalsPath(evidenceDir), [...approvals, approval]);
  const next = transitionProposal(proposal, PROPOSAL_STATE.PREVIEW_APPROVED, { now });
  return { proposal: writeProposal(evidenceDir, next), approval };
}

export function readLatestApproval(evidenceDir, proposalId) {
  const approvals = readJsonArray(approvalsPath(evidenceDir)).filter((a) => a.proposalId === proposalId);
  if (approvals.length === 0) throw new WorkflowStoreError("not_found", `No approval recorded for proposal "${proposalId}".`);
  return validateProposalApproval(approvals[approvals.length - 1]);
}

export function recordPatchPrepared(evidenceDir, proposalId, { now = new Date().toISOString() } = {}) {
  const current = readProposal(evidenceDir, proposalId);
  return writeProposal(evidenceDir, transitionProposal(current, PROPOSAL_STATE.PATCH_PREPARED, { now }));
}

// Rule 10, enforced structurally: the only way to reach validation_passed is for
// `validationResult.passed` to be true, and the only way to reach validation_failed is for it to be
// false -- there is no code path here that lets a caller pick validation_passed while validation
// actually failed.
export function recordValidationResult(evidenceDir, proposalId, validationResult, { now = new Date().toISOString() } = {}) {
  const current = readProposal(evidenceDir, proposalId);
  const toStatus = validationResult.passed ? PROPOSAL_STATE.VALIDATION_PASSED : PROPOSAL_STATE.VALIDATION_FAILED;
  return writeProposal(evidenceDir, transitionProposal(current, toStatus, { now }));
}

export function generateAuditId() {
  return `audit_${randomUUID()}`;
}
