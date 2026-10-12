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
 *    that resolves to a registration which passes a strict runtime schema
 *    BEFORE use (required revoked boolean, calendar-valid dates, known
 *    properties only, no duplicate conflicting IDs), is registered by
 *    jason, is unrevoked, and is valid at the task clock;
 *  - the relay registry is consulted (budgeted) input: its envelope is
 *    bounded before scanning and every inspected record is counted, so a
 *    padded registry cannot silently authorize restricted routing;
 *  - clock window, revocation, and nonce checks are retained.
 *
 * checkApproval stays pure; resolveApproval walks the injected store and
 * budgets every inspected record through the host counter.
 */

import { validateApprovalRecord, validateRelayRegistration, strictDateMs } from "./schemas.js";
import { canonicalJson } from "./canonical.js";

/** Jason-origin issuers. No aliases, no inference. */
const TRUSTED_ISSUERS = ["jason", "authorized_muse_relay"];

/**
 * Find a registration by ID in the injected relay registry (EM-002 +
 * EM-005). Every inspected record is a consulted object and is budgeted
 * through the host counters: registry envelope (one serialized store
 * read) plus each inspected record (distinct returned reads) — the same
 * charging model as the approval store. Duplicate relay_record_id values
 * whose contents conflict are rejected; a full scan is required to detect
 * them, and the scan is bounded by the object budget.
 * Returns {ok:true, found} or {ok:false, code, reason}.
 */
function matchRelayRegistration(relays, relayRecordId, countObject, countPayload) {
  const list = Array.isArray(relays) ? relays : [];
  let found = null;
  const seen = new Map();
  for (const r of list) {
    countObject();
    countPayload(r, "relay registration record");
    const id = r !== null && typeof r === "object" ? r.relay_record_id : undefined;
    if (typeof id === "string" && seen.has(id)) {
      if (canonicalJson(seen.get(id)) !== canonicalJson(r)) {
        return {
          ok: false,
          code: "RELAY_UNREGISTERED",
          reason: `duplicate conflicting relay_record_id ${JSON.stringify(id)} in the relay registry`,
        };
      }
      continue;
    }
    seen.set(id, r);
    if (id === relayRecordId) found = r;
  }
  return { ok: true, found };
}

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
 * relays = registered relay registry entries. countObject/countPayload are
 * the host budget counters: the relay registry is consulted (budgeted)
 * input like the approval store itself.
 */
export function checkApproval(rec, requirement, clockMs, relays = [], countObject = () => {}, countPayload = () => {}) {
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
  // never sufficient — it must resolve to a live registration in the
  // injected registry. The registration's runtime schema is validated
  // BEFORE use: required `revoked` boolean (missing never defaults to
  // unrevoked), calendar-valid dates (2026-02-30 is rejected), known
  // properties only, and no duplicate conflicting registration IDs.
  if (rec.issuer === "authorized_muse_relay") {
    if (typeof rec.relay_record_id !== "string" || rec.relay_record_id.length === 0)
      return { ok: false, code: "AUTH_UNVERIFIED", reason: "relay issuer requires a relay_record_id" };
    // EM-005: the relay registry is consulted input — its envelope is
    // bounded before any record is scanned, so a padded registry cannot
    // authorize restricted routing.
    countPayload(relays, "relay registry");
    const match = matchRelayRegistration(relays, rec.relay_record_id, countObject, countPayload);
    if (!match.ok) return match;
    const reg = match.found;
    if (!reg)
      return {
        ok: false,
        code: "RELAY_UNREGISTERED",
        reason: `relay_record_id ${rec.relay_record_id} is not a registered relay`,
      };
    const regErr = validateRelayRegistration(reg);
    if (regErr)
      return { ok: false, code: "RELAY_UNREGISTERED", reason: `malformed relay registration: ${regErr}` };
    if (reg.registered_by !== "jason")
      return { ok: false, code: "RELAY_UNREGISTERED", reason: "relay registration is not Jason-registered" };
    if (reg.revoked)
      return { ok: false, code: "RELAY_UNREGISTERED", reason: "relay registration is revoked" };
    const from = strictDateMs(reg.valid_from);
    const until = strictDateMs(reg.expires_at);
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
    const r = checkApproval(rec, requirement, clockMs, relays, countObject, countPayload);
    if (r.ok) return { ok: true, record: rec };
    if (!first) first = r;
  }
  return first;
}
