/**
 * approvals.js — mock trusted approval store resolution.
 *
 * The approval store is SEPARATELY INJECTED via context (context.approvals),
 * never authored by the task input. Approval records are AuthenticatedRecord
 * shapes plus brief_blob / approved_scope_ids / approved_action_ids /
 * authority_origin / relay_record_id.
 *
 * Validity requires ALL of:
 *  - shape-valid per schemas.validateApprovalRecord
 *  - issuer is "jason", or issuer is "authorized_muse_relay" with a
 *    non-null relay_record_id (Jason's established Muse relay counts as
 *    Jason-origin)
 *  - authority_origin matches the issuer
 *  - brief_blob equals the resolved brief's registered blob (revision binding)
 *  - resource equals the brief_ref path (resource binding)
 *  - approved_scope_ids is a superset of the required scope set (exact set
 *    semantics — never substring matching)
 *  - approved_action_ids is a superset of the required action set (exact set)
 *  - valid_from <= clock < expires_at (injected, validated clock)
 *  - revoked === false
 *  - nonce is non-empty
 *
 * A valid approval is a positive ROUTING test only — it never creates an
 * operational capability. The planner only ever emits simulated_approved
 * routing flags.
 */

import { validateApprovalRecord } from "./schemas.js";

function isSuperset(have, need) {
  const set = new Set(have);
  return need.every((x) => set.has(x));
}

/**
 * Check one approval record against the planning requirement.
 * Returns {ok:true, record} or {ok:false, code, reason}.
 */
export function checkApproval(rec, requirement, clockMs) {
  const shapeErr = validateApprovalRecord(rec);
  if (shapeErr) return { ok: false, code: "AUTH_UNVERIFIED", reason: `approval shape invalid: ${shapeErr}` };

  const jasonOrigin =
    rec.issuer === "jason" ||
    (rec.issuer === "authorized_muse_relay" && rec.relay_record_id !== null);
  if (!jasonOrigin) {
    return { ok: false, code: "AUTH_UNVERIFIED", reason: "issuer is not Jason-origin (jason or authorized_muse_relay with relay_record_id)" };
  }
  if (
    (rec.issuer === "jason" && rec.authority_origin !== "jason") ||
    (rec.issuer === "authorized_muse_relay" && rec.authority_origin !== "authorized_muse_relay")
  ) {
    return { ok: false, code: "AUTH_UNVERIFIED", reason: "authority_origin does not match issuer" };
  }
  if (rec.brief_blob !== requirement.briefBlob) {
    return { ok: false, code: "STALE_APPROVAL", reason: "approval brief_blob does not match the resolved brief revision" };
  }
  if (rec.resource !== requirement.resource) {
    return { ok: false, code: "TARGET_MISMATCH", reason: "approval resource does not match the brief path" };
  }
  if (!isSuperset(rec.approved_scope_ids, requirement.scopeIds)) {
    return { ok: false, code: "SCOPE_MISMATCH", reason: "approval does not cover the required scope set" };
  }
  if (!isSuperset(rec.approved_action_ids, requirement.actionIds)) {
    return { ok: false, code: "SCOPE_MISMATCH", reason: "approval does not cover the required action set" };
  }
  const from = Date.parse(rec.valid_from);
  const until = Date.parse(rec.expires_at);
  if (!(from <= clockMs && clockMs < until)) {
    return { ok: false, code: "APPROVAL_EXPIRED", reason: "approval is not valid at the injected clock" };
  }
  if (rec.revoked === true) {
    return { ok: false, code: "APPROVAL_REVOKED", reason: "approval has been revoked" };
  }
  return { ok: true, record: rec };
}

/**
 * Resolve approvals for a restricted planning requirement from the injected
 * store. Returns the first valid approval or {ok:false, code, reason} from
 * the best (most specific) failure.
 */
export function resolveApproval(approvals, requirement, clockMs) {
  if (!Array.isArray(approvals) || approvals.length === 0) {
    return { ok: false, code: "APPROVAL_MISSING", reason: "no approvals in the injected store" };
  }
  let first = null;
  for (const rec of approvals) {
    const r = checkApproval(rec, requirement, clockMs);
    if (r.ok) return r;
    if (!first) first = r;
  }
  return first;
}
