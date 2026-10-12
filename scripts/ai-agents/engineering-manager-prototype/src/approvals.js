/**
 * approvals.js — approval-record resolution for the engineering-manager
 * prototype.
 *
 * The approval store is SEPARATELY INJECTED via context (context.approvals),
 * never authored by the task input. A single approval may gate restricted
 * (financial / tenant / enrollment / production) scopes or actions.
 * Verification (EM-002):
 *
 *  - the record must carry a valid subject_ref that EXACTLY matches the
 *    resolved brief source (repo + path + commit + recomputed blob). The
 *    same blob/path in another repo or at another head cannot reuse the
 *    approval;
 *  - coverage is checked against the authenticated scope_ids / action_ids;
 *    the supplemental approved_* sets may only narrow that coverage —
 *    they can never contradict or expand it;
 *  - a relay issuer (authorized_muse_relay) must present a relay_record_id
 *    that exists in the separately injected registered relay registry, is
 *    registered by jason, is unrevoked, and is valid at the task clock;
 *  - clock window, revocation, and nonce checks are retained.
 *
 * checkApproval stays pure; resolveApproval walks the injected store and
 * budgets every inspected record through the host counter.
 */

import { validateApprovalRecord } from "./schemas.js";

/** Jason-origin issuers. No aliases, no inference. */
const TRUSTED_ISSUERS = ["jason", "authorized_muse_relay"];

/**
 * Check one approval record against the planning requirement.
 *
 * requirement = {
 *   briefBlob,            // recomputed Git blob SHA-1 of the resolved brief bytes
 *   resource,             // brief path the record must name
 *   subject,              // {repo, path, commit, blob} exact binding target
 *   scopeIds,             // restricted scope IDs the plan needs covered
 *   actionIds,            // restricted action IDs the plan needs covered
 * }
 * relays = registered relay registry entries:
 *   [{relay_record_id, registered_by, valid_from, expires_at, revoked}]
 */
export function checkApproval(rec, requirement, clockMs, relays = []) {
  const shapeErr = validateApprovalRecord(rec);
  if (shapeErr) return { ok: false, code: "AUTH_UNVERIFIED", reason: `malformed approval record: ${shapeErr}` };
  if (typeof rec.issuer !== "string" || !TRUSTED_ISSUERS.includes(rec.issuer))
    return { ok: false, code: "AUTH_UNVERIFIED", reason: "issuer is not a Jason-origin principal" };
  if (rec.issuer !== rec.authority_origin)
    return { ok: false, code: "AUTH_UNVERIFIED", reason: "issuer/authority_origin mismatch" };

  // EM-002: exact subject version binding. The approval names the brief it
  // was issued for; anything else (another repo, another head, changed
  // bytes) must not reuse it.
  const sr = rec.subject_ref ?? {};
  const subj = requirement.subject ?? {};
  if (sr.repo !== subj.repo || sr.path !== subj.path || sr.commit !== subj.commit || sr.blob !== subj.blob)
    return {
      ok: false,
      code: "TARGET_MISMATCH",
      reason: "approval subject_ref does not exactly match the resolved brief source (repo/path/commit/blob)",
    };
  if (rec.brief_blob !== requirement.briefBlob)
    return { ok: false, code: "STALE_APPROVAL", reason: "approval brief_blob does not match the resolved brief" };
  if (rec.resource !== requirement.resource)
    return { ok: false, code: "TARGET_MISMATCH", reason: "approval resource does not match the brief path" };

  // EM-002: registered relay validation. A non-null relay_record_id alone is
  // never sufficient — it must be a live registration in the injected
  // registry.
  if (rec.issuer === "authorized_muse_relay") {
    if (typeof rec.relay_record_id !== "string" || rec.relay_record_id.length === 0)
      return { ok: false, code: "AUTH_UNVERIFIED", reason: "relay issuer requires a relay_record_id" };
    const reg = (Array.isArray(relays) ? relays : []).find(
      (r) => r && r.relay_record_id === rec.relay_record_id
    );
    if (!reg)
      return {
        ok: false,
        code: "RELAY_UNREGISTERED",
        reason: `relay_record_id ${rec.relay_record_id} is not a registered relay`,
      };
    if (reg.registered_by !== "jason")
      return { ok: false, code: "RELAY_UNREGISTERED", reason: "relay registration is not Jason-registered" };
    if (reg.revoked)
      return { ok: false, code: "RELAY_UNREGISTERED", reason: "relay registration is revoked" };
    const from = Date.parse(reg.valid_from);
    const until = Date.parse(reg.expires_at);
    if (!Number.isFinite(from) || !Number.isFinite(until) || clockMs < from || clockMs >= until)
      return { ok: false, code: "RELAY_UNREGISTERED", reason: "relay registration is not valid at the task clock" };
  }

  // EM-002: the supplemental approved_* fields may only narrow — never
  // contradict or expand — the authenticated coverage. The effective grant
  // is the approved_* set; required scopes/actions must be covered by it.
  const scopeIds = new Set(rec.scope_ids);
  const actionIds = new Set(rec.action_ids);
  for (const s of rec.approved_scope_ids) {
    if (!scopeIds.has(s))
      return {
        ok: false,
        code: "AUTH_CONTRADICTORY",
        reason: `approved_scope_ids expands the authenticated scope_ids (${s})`,
      };
  }
  for (const a of rec.approved_action_ids) {
    if (!actionIds.has(a))
      return {
        ok: false,
        code: "AUTH_CONTRADICTORY",
        reason: `approved_action_ids expands the authenticated action_ids (${a})`,
      };
  }
  const effScopes = new Set(rec.approved_scope_ids);
  const effActions = new Set(rec.approved_action_ids);
  for (const s of requirement.scopeIds ?? []) {
    if (!effScopes.has(s))
      return { ok: false, code: "SCOPE_MISMATCH", reason: `approved scope_ids do not cover restricted scope ${s}` };
  }
  for (const a of requirement.actionIds ?? []) {
    if (!effActions.has(a))
      return { ok: false, code: "SCOPE_MISMATCH", reason: `approved action_ids do not cover restricted action ${a}` };
  }

  const from = Date.parse(rec.valid_from);
  const until = Date.parse(rec.expires_at);
  if (!Number.isFinite(from) || !Number.isFinite(until) || clockMs < from || clockMs >= until)
    return { ok: false, code: "APPROVAL_EXPIRED", reason: "approval is outside its validity window" };
  if (rec.revoked) return { ok: false, code: "APPROVAL_REVOKED", reason: "approval is revoked" };
  if (typeof rec.nonce !== "string" || rec.nonce.length === 0)
    return { ok: false, code: "AUTH_UNVERIFIED", reason: "approval nonce is missing" };
  return { ok: true, code: "APPROVAL_VERIFIED", reason: "approval verified" };
}

/**
 * Walk the injected approval store. Every inspected record is budgeted
 * through the host counters (EM-005): an unbounded store cannot be
 * silently scanned. Returns the first valid approval as
 * {ok:true, record}, or the best (first) failure as {ok:false, code,
 * reason} — APPROVAL_MISSING when the store is empty.
 */
export function resolveApproval(
  approvals,
  requirement,
  clockMs,
  relays = [],
  countObject = () => {},
  countPayload = () => {}
) {
  if (!Array.isArray(approvals) || approvals.length === 0) {
    return { ok: false, code: "APPROVAL_MISSING", reason: "no approvals in the injected store" };
  }
  let first = null;
  for (const rec of approvals) {
    countObject();
    countPayload(rec, "approval record");
    const r = checkApproval(rec, requirement, clockMs, relays);
    if (r.ok) return { ok: true, record: rec };
    if (!first) first = r;
  }
  return first;
}
