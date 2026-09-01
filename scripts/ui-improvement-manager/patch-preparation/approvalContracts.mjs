// FB-UI-3/4: fail-closed contract for a preview-preparation approval, mirroring
// scripts/repair-controller/repairContracts.mjs's RepairApproval shape and rationale almost exactly
// (Section 10: "Approval records must bind the approver, manifest hash, base SHA, maximum authority,
// and expiration") -- the same binding discipline, applied to a UiChangeProposal's digest instead of
// a repair manifest's hash.

const REQUIRED_STRING_FIELDS = Object.freeze(["approverId", "proposalId", "proposalDigest", "grantedAt", "expiresAt"]);

export class MalformedProposalApprovalError extends Error {
  constructor(reason) {
    super(`Malformed ProposalApproval: ${reason}`);
    this.name = "MalformedProposalApprovalError";
    this.reason = reason;
  }
}

function fail(reason) {
  throw new MalformedProposalApprovalError(reason);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateProposalApproval(approval) {
  if (typeof approval !== "object" || approval === null) fail("approval must be an object");
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isNonEmptyString(approval[field])) fail(`${field} must be a non-empty string`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(approval.proposalDigest)) fail("proposalDigest must be a sha256:<hex> digest");
  if (Number.isNaN(Date.parse(approval.grantedAt))) fail("grantedAt must be a valid ISO-8601 timestamp");
  if (Number.isNaN(Date.parse(approval.expiresAt))) fail("expiresAt must be a valid ISO-8601 timestamp");
  if (Date.parse(approval.expiresAt) <= Date.parse(approval.grantedAt)) fail("expiresAt must be after grantedAt");

  return Object.freeze({
    approverId: approval.approverId, proposalId: approval.proposalId, proposalDigest: approval.proposalDigest,
    grantedAt: approval.grantedAt, expiresAt: approval.expiresAt,
  });
}
