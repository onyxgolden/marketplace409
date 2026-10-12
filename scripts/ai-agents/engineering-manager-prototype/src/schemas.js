/**
 * schemas.js — runtime schema validation for the engineering-manager prototype.
 *
 * Strict by design: unknown properties are rejected in control-bearing
 * objects, enums are enforced, duplicate IDs are rejected, nonfinite numbers
 * are rejected, and Git pins must be full 40-hex lowercase object IDs.
 * A malformed request yields a structured denial, never an exception or a
 * default success.
 */

export const RESTRICTED_SCOPES = Object.freeze(["financial", "tenant", "enrollment", "production"]);
export const RESTRICTED_ACTIONS = Object.freeze([
  "process_payment",
  "send_tenant_notice",
  "enroll_tenant",
  "production_write",
]);
export const PROHIBITED_ACTIONS = Object.freeze(["run_migration", "deploy", "execute_script"]);
export const AUTHORITY_ORIGINS = Object.freeze(["jason", "authorized_muse_relay"]);

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_ID_LEN = 128;
const MAX_TITLE_LEN = 512;
const MAX_STR_LEN = 4096;

export function isHex40(s) {
  return typeof s === "string" && HEX40.test(s);
}
export function isHex64(s) {
  return typeof s === "string" && HEX64.test(s);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isNonEmptyString(v, maxLen = MAX_ID_LEN) {
  return typeof v === "string" && v.length > 0 && v.length <= maxLen;
}

function isStringArray(v, maxLen = MAX_ID_LEN) {
  return Array.isArray(v) && v.every((x) => typeof x === "string" && x.length <= maxLen);
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function validYMD(y, mo, d) {
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return false;
  if (y < 1970 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const t = Date.UTC(y, mo - 1, d);
  const r = new Date(t);
  return r.getUTCFullYear() === y && r.getUTCMonth() === mo - 1 && r.getUTCDate() === d;
}

/** Real YYYY-MM-DD (calendar-valid) or real UTC ISO-8601 instant (Zulu only).
 *  Rollover dates such as 2026-02-30 are rejected via Date.UTC round-trip. */
export function isValidDateString(s) {
  if (typeof s !== "string" || s.length === 0 || s.length > 64) return false;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return validYMD(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?Z$/.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const hh = Number(m[4]);
    const mi = Number(m[5]);
    const ss = Number(m[6]);
    if (!validYMD(y, mo, d)) return false;
    if (hh > 23 || mi > 59 || ss > 59) return false;
    const ms = m[7] ? Math.round(Number(m[7]) * 1000) : 0;
    const t = Date.UTC(y, mo - 1, d, hh, mi, ss, ms);
    const r = new Date(t);
    return (
      r.getUTCFullYear() === y &&
      r.getUTCMonth() === mo - 1 &&
      r.getUTCDate() === d &&
      r.getUTCHours() === hh &&
      r.getUTCMinutes() === mi &&
      r.getUTCSeconds() === ss &&
      r.getUTCMilliseconds() === ms
    );
  }
  return false;
}

/** Canonical repo-relative path: no traversal, no absolute, no backslashes. */
export function isCanonicalPath(p) {
  if (typeof p !== "string" || p.length === 0 || p.length > 512) return false;
  if (p.startsWith("/") || p.includes("\\") || p.startsWith("..")) return false;
  if (p.includes("../") || p.includes("/..")) return false;
  const parts = p.split("/");
  if (parts.some((x) => x === "" || x === "." || x === "..")) return false;
  return true;
}

const SOURCE_REF_KEYS = ["repo", "path", "commit", "blob", "algorithm", "revision"];

/** SourceRef = {repo, path, commit, blob, algorithm:"git-sha1", revision}.
 *  Unknown properties rejected. Returns null when valid, else a reason. */
export function validateSourceRef(ref) {
  if (!isPlainObject(ref)) return "not an object";
  for (const k of Object.keys(ref)) {
    if (!SOURCE_REF_KEYS.includes(k)) return `unknown property: ${k}`;
  }
  if (!isNonEmptyString(ref.repo)) return "repo must be a non-empty string";
  if (!isCanonicalPath(ref.path)) return "path must be a canonical repo-relative path";
  if (!isHex40(ref.commit)) return "commit must be a 40-hex lowercase Git object ID";
  if (!isHex40(ref.blob)) return "blob must be a 40-hex lowercase Git object ID";
  if (ref.algorithm !== "git-sha1") return 'algorithm must be "git-sha1"';
  if (!isNonEmptyString(ref.revision)) return "revision must be a non-empty string";
  return null;
}

const TASK_KEYS = ["brief_ref", "objective_id", "constraints", "requested_action", "related_brief_refs"];
const CONSTRAINT_KEYS = ["budget_units", "max_nodes", "owner_allowlist"];

/** Validate the planner task input. Returns null when valid, else a reason. */
export function validateTask(task) {
  if (!isPlainObject(task)) return "task must be an object";
  for (const k of Object.keys(task)) {
    if (!TASK_KEYS.includes(k)) return `unknown task property: ${k}`;
  }
  const br = validateSourceRef(task.brief_ref);
  if (br) return `brief_ref invalid: ${br}`;
  if (!isNonEmptyString(task.objective_id)) return "objective_id must be a non-empty string";
  if (!isPlainObject(task.constraints)) return "constraints must be an object";
  for (const k of Object.keys(task.constraints)) {
    if (!CONSTRAINT_KEYS.includes(k)) return `unknown constraints property: ${k}`;
  }
  const c = task.constraints;
  if (!Number.isInteger(c.budget_units) || c.budget_units < 0) return "budget_units must be an integer >= 0";
  if (!Number.isInteger(c.max_nodes) || c.max_nodes < 1 || c.max_nodes > 256)
    return "max_nodes must be an integer in [1, 256]";
  if (!Array.isArray(c.owner_allowlist) || !c.owner_allowlist.every((o) => isNonEmptyString(o)))
    return "owner_allowlist must be an array of non-empty strings";
  if (new Set(c.owner_allowlist).size !== c.owner_allowlist.length) return "owner_allowlist has duplicates";
  if (typeof task.requested_action !== "string" || task.requested_action.length === 0 || task.requested_action.length > MAX_ID_LEN)
    return "task.requested_action must be a non-empty string";
  // Note: only "plan" is supported at plan time; other values are refused
  // with UNSUPPORTED_TASK by the planner (not a schema violation).
  if (task.related_brief_refs !== undefined) {
    if (!Array.isArray(task.related_brief_refs)) return "related_brief_refs must be an array";
    for (const r of task.related_brief_refs) {
      const e = validateSourceRef(r);
      if (e) return `related_brief_refs invalid: ${e}`;
    }
  }
  return null;
}

const BRIEF_KEYS = ["objective_id", "scope_ids", "task_specs", "non_goals"];
const SPEC_KEYS = [
  "local_key",
  "title",
  "owner_proposal",
  "action_ids",
  "dependency_keys",
  "acceptance_checks",
  "external_gate_ids",
  "source_spans",
];
const CHECK_KEYS = ["check_id", "expected", "evidence_kind"];

/** Validate the fixture brief. Returns null when valid, else a reason. */
export function validateBrief(brief) {
  if (!isPlainObject(brief)) return "brief must be an object";
  for (const k of Object.keys(brief)) {
    if (!BRIEF_KEYS.includes(k)) return `unknown brief property: ${k}`;
  }
  if (!isNonEmptyString(brief.objective_id)) return "objective_id must be a non-empty string";
  if (!isStringArray(brief.scope_ids)) return "scope_ids must be an array of strings";
  if (!Array.isArray(brief.task_specs)) return "task_specs must be an array";
  if (!isStringArray(brief.non_goals)) return "non_goals must be an array of strings";
  for (let i = 0; i < brief.task_specs.length; i++) {
    const s = brief.task_specs[i];
    if (!isPlainObject(s)) return `task_specs[${i}] must be an object`;
    for (const k of Object.keys(s)) {
      if (!SPEC_KEYS.includes(k)) return `task_specs[${i}] unknown property: ${k}`;
    }
    if (!isNonEmptyString(s.local_key)) return `task_specs[${i}].local_key must be a non-empty string`;
    if (!isNonEmptyString(s.title, MAX_TITLE_LEN)) return `task_specs[${i}].title must be a non-empty string`;
    if (typeof s.owner_proposal !== "string" || s.owner_proposal.length > MAX_ID_LEN)
      return `task_specs[${i}].owner_proposal must be a string (empty is an invalid owner, flagged at plan time)`;
    if (!isStringArray(s.action_ids)) return `task_specs[${i}].action_ids must be an array of strings`;
    if (!isStringArray(s.dependency_keys)) return `task_specs[${i}].dependency_keys must be an array of strings`;
    if (!Array.isArray(s.acceptance_checks)) return `task_specs[${i}].acceptance_checks must be an array`;
    for (let j = 0; j < s.acceptance_checks.length; j++) {
      const a = s.acceptance_checks[j];
      if (!isPlainObject(a)) return `task_specs[${i}].acceptance_checks[${j}] must be an object`;
      for (const k of Object.keys(a)) {
        if (!CHECK_KEYS.includes(k)) return `acceptance_checks[${j}] unknown property: ${k}`;
      }
      if (!isNonEmptyString(a.check_id)) return `acceptance_checks[${j}].check_id must be a non-empty string`;
      if (typeof a.expected !== "string" || a.expected.length > MAX_STR_LEN)
        return `acceptance_checks[${j}].expected must be a string`;
      if (!isNonEmptyString(a.evidence_kind)) return `acceptance_checks[${j}].evidence_kind must be a non-empty string`;
    }
    if (!isStringArray(s.external_gate_ids)) return `task_specs[${i}].external_gate_ids must be an array of strings`;
    if (s.source_spans !== undefined) {
      if (!Array.isArray(s.source_spans)) return `task_specs[${i}].source_spans must be an array`;
    }
  }
  return null;
}

const APPROVAL_KEYS = [
  "record_id",
  "issuer",
  "subject_ref",
  "resource",
  "scope_ids",
  "action_ids",
  "valid_from",
  "expires_at",
  "revoked",
  "nonce",
  "source_ref",
  "brief_blob",
  "approved_scope_ids",
  "approved_action_ids",
  "authority_origin",
  "relay_record_id",
];

/** Validate an approval record's shape. Returns null when valid, else a reason. */
export function validateApprovalRecord(rec) {
  if (!isPlainObject(rec)) return "approval must be an object";
  for (const k of Object.keys(rec)) {
    if (!APPROVAL_KEYS.includes(k)) return `unknown approval property: ${k}`;
  }
  if (!isNonEmptyString(rec.record_id)) return "record_id must be a non-empty string";
  if (!isNonEmptyString(rec.issuer)) return "issuer must be a non-empty string";
  if (!isNonEmptyString(rec.resource, 512)) return "resource must be a non-empty string";
  if (!isStringArray(rec.scope_ids)) return "scope_ids must be an array of strings";
  if (!isStringArray(rec.action_ids)) return "action_ids must be an array of strings";
  if (!isValidDateString(rec.valid_from)) return "valid_from must be a valid date/timestamp";
  if (!isValidDateString(rec.expires_at)) return "expires_at must be a valid date/timestamp";
  if (typeof rec.revoked !== "boolean") return "revoked must be a boolean";
  if (!isNonEmptyString(rec.nonce)) return "nonce must be a non-empty string";
  const sr = validateSourceRef(rec.source_ref);
  if (sr) return `source_ref invalid: ${sr}`;
  if (!isHex40(rec.brief_blob)) return "brief_blob must be a 40-hex lowercase Git object ID";
  if (!isStringArray(rec.approved_scope_ids)) return "approved_scope_ids must be an array of strings";
  if (!isStringArray(rec.approved_action_ids)) return "approved_action_ids must be an array of strings";
  if (!AUTHORITY_ORIGINS.includes(rec.authority_origin))
    return `authority_origin must be one of: ${AUTHORITY_ORIGINS.join(", ")}`;
  if (rec.relay_record_id !== null && !isNonEmptyString(rec.relay_record_id))
    return "relay_record_id must be null or a non-empty string";
  if (rec.subject_ref !== null && rec.subject_ref !== undefined && !isPlainObject(rec.subject_ref))
    return "subject_ref must be an object or null";
  return null;
}

/** Validate the injected clock. Returns null when valid, else a reason. */
export function validateClock(clock) {
  if (!isValidDateString(clock)) return "clock must be a valid YYYY-MM-DD or UTC ISO timestamp";
  return null;
}

export { isPlainObject, isNonEmptyString, isFiniteNumber };
