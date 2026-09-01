// FB-UI-3/4: fail-closed contracts for a governed UI improvement proposal, mirroring
// scripts/repair-controller/repairContracts.mjs's validation style (unknown/malformed fields rejected
// at the boundary, frozen return objects, deterministic content hashing) -- the same discipline
// applied to a different domain (UI change proposals, not repairs).

import { hashContent } from "../../engineering-brain/hashContent.mjs";

export const PROPOSAL_CONTRACT_SCHEMA_VERSION = "1.0";

// The ten states the checkpoint spec requires, verbatim.
export const PROPOSAL_STATE = Object.freeze({
  DRAFT: "draft",
  REVIEW_REQUESTED: "review_requested",
  REJECTED: "rejected",
  REVISION_REQUESTED: "revision_requested",
  PREVIEW_APPROVED: "preview_approved",
  PATCH_PREPARED: "patch_prepared",
  VALIDATION_FAILED: "validation_failed",
  VALIDATION_PASSED: "validation_passed",
  PR_APPROVAL_REQUESTED: "pr_approval_requested",
  CLOSED: "closed",
});

// Every legal next state for a given current state. `closed` is reachable from anywhere (an owner can
// abandon a proposal at any point) except from `closed` itself (terminal). `validation_failed` can
// re-enter `patch_prepared` -- this is what "exact retry" means structurally: the same approved,
// non-stale, digest-matched proposal can have patch preparation and validation re-attempted, and must
// produce the same deterministic outcome against the same inputs, not a one-shot dead end.
export const ALLOWED_TRANSITIONS = Object.freeze({
  [PROPOSAL_STATE.DRAFT]: Object.freeze([PROPOSAL_STATE.REVIEW_REQUESTED, PROPOSAL_STATE.CLOSED]),
  [PROPOSAL_STATE.REVIEW_REQUESTED]: Object.freeze([PROPOSAL_STATE.REJECTED, PROPOSAL_STATE.REVISION_REQUESTED, PROPOSAL_STATE.PREVIEW_APPROVED, PROPOSAL_STATE.CLOSED]),
  [PROPOSAL_STATE.REJECTED]: Object.freeze([PROPOSAL_STATE.CLOSED]),
  [PROPOSAL_STATE.REVISION_REQUESTED]: Object.freeze([PROPOSAL_STATE.DRAFT, PROPOSAL_STATE.CLOSED]),
  [PROPOSAL_STATE.PREVIEW_APPROVED]: Object.freeze([PROPOSAL_STATE.PATCH_PREPARED, PROPOSAL_STATE.CLOSED]),
  [PROPOSAL_STATE.PATCH_PREPARED]: Object.freeze([PROPOSAL_STATE.VALIDATION_FAILED, PROPOSAL_STATE.VALIDATION_PASSED, PROPOSAL_STATE.CLOSED]),
  [PROPOSAL_STATE.VALIDATION_FAILED]: Object.freeze([PROPOSAL_STATE.PATCH_PREPARED, PROPOSAL_STATE.CLOSED]),
  [PROPOSAL_STATE.VALIDATION_PASSED]: Object.freeze([PROPOSAL_STATE.PR_APPROVAL_REQUESTED, PROPOSAL_STATE.CLOSED]),
  [PROPOSAL_STATE.PR_APPROVAL_REQUESTED]: Object.freeze([PROPOSAL_STATE.CLOSED]),
  [PROPOSAL_STATE.CLOSED]: Object.freeze([]),
});

export class MalformedProposalError extends Error {
  constructor(reason) {
    super(`Malformed UiChangeProposal: ${reason}`);
    this.name = "MalformedProposalError";
    this.reason = reason;
  }
}

export class IllegalProposalTransitionError extends Error {
  constructor(from, to) {
    super(`Illegal proposal transition: "${from}" -> "${to}"`);
    this.name = "IllegalProposalTransitionError";
    this.from = from;
    this.to = to;
  }
}

function fail(reason) {
  throw new MalformedProposalError(reason);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateFileEdits(fileEdits) {
  if (!Array.isArray(fileEdits) || fileEdits.length === 0) fail("fileEdits must be a non-empty array");
  const seenPaths = new Set();
  return fileEdits.map((edit, index) => {
    if (typeof edit !== "object" || edit === null) fail(`fileEdits[${index}] must be an object`);
    if (!isNonEmptyString(edit.path)) fail(`fileEdits[${index}].path must be a non-empty string`);
    if (typeof edit.content !== "string") fail(`fileEdits[${index}].content must be a string`);
    if (seenPaths.has(edit.path)) fail(`fileEdits contains a duplicate path "${edit.path}"`);
    seenPaths.add(edit.path);
    return Object.freeze({ path: edit.path, content: edit.content });
  });
}

// The fields that make up a proposal's *identity, scope, and exact content* -- everything
// computeProposalDigest hashes. Anything outside this list (status, timestamps) can change freely
// without invalidating an approval; anything inside it changing (including, deliberately, the
// allowedPaths/forbiddenPaths scope -- rule 3: "Any changed scope invalidates the approval" -- and
// fileEdits, the exact content this proposal would apply) changes the digest and so invalidates any
// approval bound to the prior digest. This is why rule 3 needs no separate mechanism from rule 2:
// scope is part of the digest. Including fileEdits means an owner approving a proposal is approving
// the literal content change, not merely "permission to touch these files" -- there is no AI-driven
// patch-generation step in this checkpoint (see the FB-UI-2 boundary this extends): fileEdits are
// supplied when the proposal is drafted, by whoever is preparing it, and never invented afterward.
const DIGEST_FIELDS = Object.freeze(["proposalId", "findingIds", "objective", "allowedPaths", "forbiddenPaths", "fileEdits"]);

export function computeProposalDigest(proposal) {
  const canonical = {};
  for (const field of DIGEST_FIELDS) canonical[field] = proposal[field];
  return `sha256:${hashContent(JSON.stringify(canonical))}`;
}

export function validateUiChangeProposal(proposal) {
  if (typeof proposal !== "object" || proposal === null) fail("proposal must be an object");
  if (!isNonEmptyString(proposal.proposalId)) fail("proposalId must be a non-empty string");
  if (!isStringArray(proposal.findingIds) || proposal.findingIds.length === 0) fail("findingIds must be a non-empty array of strings");
  if (!isNonEmptyString(proposal.objective)) fail("objective must be a non-empty string");
  if (!isStringArray(proposal.allowedPaths) || proposal.allowedPaths.length === 0) fail("allowedPaths must be a non-empty array of strings");
  if (!isStringArray(proposal.forbiddenPaths)) fail("forbiddenPaths must be an array of strings");
  const fileEdits = validateFileEdits(proposal.fileEdits);
  for (const edit of fileEdits) {
    if (!proposal.allowedPaths.some((allowed) => edit.path === allowed || edit.path.startsWith(`${allowed.replace(/\/$/, "")}/`))) {
      fail(`fileEdits path "${edit.path}" is not covered by allowedPaths -- every edit must be in scope from the moment the proposal is created`);
    }
  }
  if (!Object.values(PROPOSAL_STATE).includes(proposal.status)) fail(`status must be one of ${Object.values(PROPOSAL_STATE).join(", ")}`);
  if (!isNonEmptyString(proposal.createdAt) || Number.isNaN(Date.parse(proposal.createdAt))) fail("createdAt must be a valid ISO-8601 timestamp");
  if (!isNonEmptyString(proposal.updatedAt) || Number.isNaN(Date.parse(proposal.updatedAt))) fail("updatedAt must be a valid ISO-8601 timestamp");

  const validated = Object.freeze({
    proposalId: proposal.proposalId, findingIds: Object.freeze([...proposal.findingIds]), objective: proposal.objective,
    allowedPaths: Object.freeze([...proposal.allowedPaths]), forbiddenPaths: Object.freeze([...proposal.forbiddenPaths]),
    fileEdits: Object.freeze(fileEdits), status: proposal.status, createdAt: proposal.createdAt, updatedAt: proposal.updatedAt,
  });
  // digest is derived, never caller-supplied -- a proposal object cannot lie about its own digest.
  return Object.freeze({ ...validated, digest: computeProposalDigest(validated) });
}

// Throws (fail-closed) rather than returning a boolean -- see hostAllowlist.mjs/routeAllowlist.mjs's
// assert* functions in screenshot-evidence/ for the same rationale, applied consistently across every
// FB-UI checkpoint: a caller cannot silently proceed past an illegal transition by forgetting to
// check a boolean.
export function assertValidTransition(fromStatus, toStatus) {
  const allowed = ALLOWED_TRANSITIONS[fromStatus];
  if (!allowed || !allowed.includes(toStatus)) throw new IllegalProposalTransitionError(fromStatus, toStatus);
}

export function transitionProposal(proposal, toStatus, { now = new Date().toISOString() } = {}) {
  assertValidTransition(proposal.status, toStatus);
  return validateUiChangeProposal({ ...proposal, status: toStatus, updatedAt: now });
}
