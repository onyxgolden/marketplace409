// FB-UI-3/4 rules 1-3, evaluated together as one deterministic, deny-by-default decision -- the same
// "every gate is a structured field check, never confidence/prose" discipline as
// scripts/repair-controller/evaluateRepairAuthority.mjs.
//
// Rule 1: Only the canonical owner may approve preview preparation.
// Rule 2: Approval must reference an immutable proposal digest.
// Rule 3: Any changed scope invalidates the approval.
//
// Rule 3 needs no separate check from rule 2: a proposal's allowedPaths/forbiddenPaths are part of
// what proposalContracts.mjs's computeProposalDigest hashes (see its DIGEST_FIELDS), so *any* change
// to scope already changes the digest the approval must match -- there is exactly one comparison
// (`approval.proposalDigest === proposal.digest`) that enforces both rules 2 and 3 at once.

import { validateProposalApproval } from "./approvalContracts.mjs";

export const AUTHORITY_DECISION = Object.freeze({ APPROVE: "approve", DENY: "deny" });

// Mirrors src/application/developer/ProgrammerAuthorizationApplication.js's own
// DEFAULT_PROGRAMMER_EMAIL constant exactly (not imported directly -- that file lives under src/ and
// is normally only ever loaded through Next.js's bundler; importing it from a plain Node script works
// today via Node's ESM-syntax auto-detection fallback, but couples this security-critical evaluator
// to that loader behavior for no real benefit, since this module only ever needs the one string
// value). If the canonical owner's default email ever changes, both places must change together --
// there is no single source of truth across the src//scripts boundary for this one constant.
const DEFAULT_CANONICAL_OWNER_EMAIL = "jasonmorgan99@gmail.com";

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

// `delegatedApproverEmails` is an explicit, empty-by-default allowlist -- the structural mechanism
// rule 1's "unless separately delegated" exception describes, with nothing delegated by default. No
// delegation-granting capability exists anywhere in this checkpoint; a caller wanting to delegate
// approval authority to a co-owner would need to build and separately approve that mechanism, not get
// it implicitly from this evaluator accepting a list.
export function evaluatePatchPreparationAuthority({
  proposal, approval, callerEmail, now = new Date().toISOString(),
  canonicalOwnerEmail = process.env.FORGE_PROGRAMMER_EMAIL || DEFAULT_CANONICAL_OWNER_EMAIL,
  delegatedApproverEmails = [],
}) {
  const reasonCodes = [];
  const normalizedCaller = normalizeEmail(callerEmail);
  const normalizedOwner = normalizeEmail(canonicalOwnerEmail);
  const normalizedDelegates = new Set(delegatedApproverEmails.map(normalizeEmail));

  // Rule 1, checked first and unconditionally -- an unauthorized caller learns nothing else about
  // why (no digest/expiry detail leaked to someone who was never allowed to approve in the first
  // place).
  if (!normalizedCaller || (normalizedCaller !== normalizedOwner && !normalizedDelegates.has(normalizedCaller))) {
    return Object.freeze({ decision: AUTHORITY_DECISION.DENY, reasonCodes: Object.freeze(["caller_is_not_canonical_owner_or_delegate"]) });
  }

  let validatedApproval;
  try {
    validatedApproval = validateProposalApproval(approval);
  } catch {
    return Object.freeze({ decision: AUTHORITY_DECISION.DENY, reasonCodes: Object.freeze(["approval_malformed"]) });
  }

  if (normalizeEmail(validatedApproval.approverId) !== normalizedCaller) {
    reasonCodes.push("approval_approver_does_not_match_caller");
  }
  if (validatedApproval.proposalId !== proposal.proposalId) {
    reasonCodes.push("approval_proposal_id_mismatch");
  }
  // Rules 2 + 3 in one comparison -- see module header.
  if (validatedApproval.proposalDigest !== proposal.digest) {
    reasonCodes.push("approval_digest_mismatch_or_scope_changed");
  }
  if (Date.parse(validatedApproval.expiresAt) <= Date.parse(now)) {
    reasonCodes.push("approval_expired");
  }

  if (reasonCodes.length > 0) return Object.freeze({ decision: AUTHORITY_DECISION.DENY, reasonCodes: Object.freeze(reasonCodes) });
  return Object.freeze({ decision: AUTHORITY_DECISION.APPROVE, reasonCodes: Object.freeze(["owner_approved_current_digest_not_expired"]) });
}
