/**
 * schemas.js — runtime validation for the Customer Success Agent
 * prototype. Strict: rejects unknown properties in control-bearing
 * objects, absent required fields, wrong types, invalid enum values,
 * duplicate IDs, nonfinite numbers, invalid dates. Pure Node 24 ESM,
 * zero dependencies.
 */

import { HEX40 } from "./canonical.js";

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaError";
  }
}

const REPO_RE = /^[a-z][a-z0-9-]{0,63}$/;
const PATH_RE = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*\.(md|txt|json)$/;
const TAG_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SLUG_RE = /^[a-z][a-z0-9_-]{0,63}$/;

export const REQUESTED_OPERATION_ALLOWED = "analyze";
export const STATUSES = ["OPEN", "RESOLVED"];
export const IMPACTS = ["NONE", "DEGRADED", "OUTAGE"];
export const SENTIMENTS = ["POSITIVE", "NEUTRAL", "NEGATIVE", "UNKNOWN"];
export const PRIMARY_TAGS = ["ACCOUNT_CLOSURE", "BILLING", "TECHNICAL", "FEATURE_REQUEST"];
export const SECONDARY_TAGS = ["REFUND_REQUEST", "CONTACT_REQUEST", "UPGRADE_REQUEST", "ONBOARDING", "GENERAL_INQUIRY"];
export const KNOWN_TAGS = [...PRIMARY_TAGS, ...SECONDARY_TAGS];
export const PRINCIPAL_ROLES = ["JASON", "MUSE_RELAY"];
export const MAX_TICKETS_PER_BUNDLE_SCHEMA = 4096; // outer array-shape bound only; the 64-object budget gates real processing

function fail(where, msg) {
  throw new SchemaError(`${where}: ${msg}`);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function exactKeys(obj, allowed, where) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) fail(where, `unknown property '${k}'`);
  }
}

function reqStr(obj, key, where, { allowEmpty = false, maxBytes = null } = {}) {
  const v = obj[key];
  if (typeof v !== "string" || (!allowEmpty && v.length === 0)) fail(where, `'${key}' must be a non-empty string`);
  if (maxBytes !== null && Buffer.byteLength(v, "utf8") > maxBytes) fail(where, `'${key}' exceeds ${maxBytes} bytes`);
  return v;
}

function validateRecordId(value, where) {
  const v = reqStr({ v: value }, "v", where);
  if (!RECORD_ID_RE.test(v)) fail(where, `invalid record id '${v}'`);
  return v;
}

/** Real calendar date or finite UTC ISO timestamp with Z. Returns epoch ms. */
export function validateIsoDate(value, where) {
  if (typeof value !== "string") fail(where, "must be a string");
  if (!ISO_RE.test(value)) fail(where, "must be YYYY-MM-DDTHH:MM:SSZ");
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail(where, "not a real calendar date");
  const d = new Date(ms);
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const mo = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const da = d.getUTCDate().toString().padStart(2, "0");
  if (`${y}-${mo}-${da}T` !== value.slice(0, 11)) fail(where, "not a real calendar date");
  return ms;
}

function validateNullableIsoDate(value, where) {
  if (value === null) return null;
  return validateIsoDate(value, where);
}

/** SourceRef = {repo, path, commit, blob, algorithm:"git-sha1", revision}. */
export function validateSourceRef(value, where) {
  if (!isPlainObject(value)) fail(where, "SourceRef must be an object");
  exactKeys(value, ["repo", "path", "commit", "blob", "algorithm", "revision"], where);
  const repo = reqStr(value, "repo", where);
  if (!REPO_RE.test(repo)) fail(where, `invalid repo '${repo}'`);
  const path = reqStr(value, "path", where);
  if (!PATH_RE.test(path)) fail(where, `invalid path '${path}'`);
  const commit = reqStr(value, "commit", where);
  if (!HEX40.test(commit)) fail(where, "commit must be a full 40-hex Git object ID");
  const blob = reqStr(value, "blob", where);
  if (!HEX40.test(blob)) fail(where, "blob must be a full 40-hex Git object ID");
  if (value.algorithm !== "git-sha1") fail(where, "algorithm must be 'git-sha1'");
  const revision = reqStr(value, "revision", where);
  return { repo, path, commit, blob, algorithm: "git-sha1", revision };
}

/** Authenticated mock request principal: Jason, or his registered Muse
 *  relay. Arbitrary actor strings supplied elsewhere never carry authority —
 *  only this context-injected, host-authenticated record does. */
export function validatePrincipal(value, where) {
  if (!isPlainObject(value)) fail(where, "principal must be an object");
  exactKeys(value, ["principal_id", "role", "registered_by", "valid_from", "expires_at", "revoked"], where);
  const principal_id = validateRecordId(value.principal_id, where);
  if (!PRINCIPAL_ROLES.includes(value.role)) fail(where, `role must be one of ${PRINCIPAL_ROLES.join(", ")}`);
  const registered_by = reqStr(value, "registered_by", where);
  if (registered_by !== "jason") fail(where, "registered_by must be 'jason'");
  validateIsoDate(value.valid_from, `${where}.valid_from`);
  validateIsoDate(value.expires_at, `${where}.expires_at`);
  if (typeof value.revoked !== "boolean") fail(where, "revoked must be a boolean");
  return { principal_id, role: value.role, registered_by, valid_from: value.valid_from, expires_at: value.expires_at, revoked: value.revoked };
}

/** Trusted criteria: taxonomy version, SLA threshold minutes, and the
 *  pinned policy/taxonomy document SourceRef. Host-injected only — never
 *  supplied or overridable by task content. */
export function validateCriteria(value, where) {
  if (!isPlainObject(value)) fail(where, "criteria must be an object");
  exactKeys(value, ["taxonomy_version", "response_sla_minutes", "policy_ref"], where);
  const taxonomy_version = reqStr(value, "taxonomy_version", where);
  if (!SLUG_RE.test(taxonomy_version)) fail(where, `invalid taxonomy_version '${taxonomy_version}'`);
  const sla = value.response_sla_minutes;
  if (!Number.isInteger(sla) || sla <= 0 || sla > 100000) fail(where, "response_sla_minutes must be a positive integer <= 100000");
  const policy_ref = validateSourceRef(value.policy_ref, `${where}.policy_ref`);
  return { taxonomy_version, response_sla_minutes: sla, policy_ref };
}

export function validateReadGrant(value, where) {
  if (!isPlainObject(value)) fail(where, "read grant must be an object");
  exactKeys(value, ["repo", "path"], where);
  const repo = reqStr(value, "repo", where);
  if (!REPO_RE.test(repo)) fail(where, `invalid repo '${repo}'`);
  const path = reqStr(value, "path", where);
  if (!PATH_RE.test(path)) fail(where, `invalid path '${path}'`);
  return { repo, path };
}

/**
 * validateContext(context, budget) — CS-001 fix: the injected trusted
 * context is itself a candidate population, not a free pre-pass. Every
 * registered source, every revision within it, every read grant, the
 * principal record and the criteria record are each object-charged via
 * budget.countObject() as the FIRST statement before any of that
 * candidate's own fields are read — exactly the same charge-before-read
 * discipline src/index.js already applies to tickets. A revision's text
 * bytes are payload-charged (budget.countPayload) before being accepted,
 * whether or not that revision is ever later resolved/used — an unused
 * oversized revision must still count against the total input budget,
 * not be traversed for free outside it. `budget` is REQUIRED: this
 * function must never be called without the caller's live monotonic
 * budget, or validation becomes an unbudgeted side channel again.
 */
export function validateContext(context, budget) {
  if (!budget || typeof budget.countObject !== "function") fail("context", "internal: validateContext requires a live budget");
  if (!isPlainObject(context)) fail("context", "must be an object");
  exactKeys(context, ["clock", "sources", "readGrants", "principal", "criteria"], "context");
  const clock = context.clock;
  if (!Number.isFinite(clock)) fail("context", "clock must be a finite number");

  if (!isPlainObject(context.sources)) fail("context", "sources must be an object");
  const sourceKeys = Object.keys(context.sources);
  if (sourceKeys.length === 0 || sourceKeys.length > 64) fail("context", "sources must have 1..64 entries");
  for (const sk of sourceKeys) {
    budget.countObject(`context.sources[${sk}]`);
    const entry = context.sources[sk];
    if (!isPlainObject(entry)) fail("context", `source '${sk}' must be an object`);
    const revs = entry.revisions;
    if (!isPlainObject(revs)) fail("context", `source '${sk}' revisions must be an object`);
    for (const commit of Object.keys(revs)) {
      budget.countObject(`context.sources[${sk}]@${commit}`);
      const rev = revs[commit];
      if (!isPlainObject(rev)) fail("context", `source '${sk}' revision '${commit}' must be an object`);
      if (typeof rev.text !== "string") fail("context", `source '${sk}' revision '${commit}' text must be a string`);
      budget.countPayload(rev.text, `context source ${sk}@${commit}`);
      if (typeof rev.blob !== "string" || !HEX40.test(rev.blob)) fail("context", `source '${sk}' revision '${commit}' blob must be a 40-hex Git object ID`);
    }
  }

  if (!Array.isArray(context.readGrants)) fail("context", "readGrants must be an array");
  const readGrants = context.readGrants.map((g, i) => {
    budget.countObject(`context.readGrants[${i}]`);
    return validateReadGrant(g, `context.readGrants[${i}]`);
  });

  budget.countObject("context.principal");
  const principal = validatePrincipal(context.principal, "context.principal");
  budget.countObject("context.criteria");
  const criteria = validateCriteria(context.criteria, "context.criteria");

  return { clock, sources: context.sources, readGrants, principal, criteria };
}

/** Task input schema. kind: "analyze" | "prohibited". */
export function validateTask(task) {
  if (!isPlainObject(task)) fail("task", "must be an object");
  exactKeys(task, ["schema_version", "task_id", "operation", "fixture_refs", "options"], "task");
  if (task.schema_version !== "1") fail("task", "schema_version must be '1'");
  const task_id = reqStr(task, "task_id", "task", { maxBytes: 2048 });
  const operation = reqStr(task, "operation", "task", { maxBytes: 256 });

  if (!isPlainObject(task.fixture_refs)) fail("task", "fixture_refs must be an object");
  exactKeys(task.fixture_refs, ["ticket_bundle"], "task.fixture_refs");
  const ticket_bundle_ref = validateSourceRef(task.fixture_refs.ticket_bundle, "task.fixture_refs.ticket_bundle");

  if (!isPlainObject(task.options)) fail("task", "options must be an object");
  exactKeys(task.options, ["population", "header_claims"], "task.options");

  const pop = task.options.population;
  if (!isPlainObject(pop)) fail("task.options.population", "must be an object");
  exactKeys(pop, ["declared_total", "complete"], "task.options.population");
  if (!Number.isInteger(pop.declared_total) || pop.declared_total < 0) fail("task.options.population", "declared_total must be a nonnegative integer");
  if (typeof pop.complete !== "boolean") fail("task.options.population", "complete must be a boolean");

  const hc = task.options.header_claims;
  if (!isPlainObject(hc)) fail("task.options.header_claims", "must be an object");
  const HC_KEYS = ["avg_response_minutes", "avg_resolution_minutes", "sla_compliance_pct", "csat_mean", "csat_positive_pct"];
  exactKeys(hc, HC_KEYS, "task.options.header_claims");
  const header_claims = {};
  for (const k of HC_KEYS) {
    const v = hc[k] === undefined ? null : hc[k];
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v))) fail("task.options.header_claims", `'${k}' must be a finite number or null`);
    header_claims[k] = v;
  }

  return {
    task_id,
    operation,
    ticket_bundle_ref,
    population: { declared_total: pop.declared_total, complete: pop.complete },
    header_claims,
    kind: operation === REQUESTED_OPERATION_ALLOWED ? "analyze" : "prohibited",
  };
}

/** One ticket record, as read from the resolved ticket-bundle fixture.
 *  subject/body/notes are UNTRUSTED free text — never echoed into drafts,
 *  only scanned for injection and never truncated silently (over-length
 *  is a schema failure, not quiet clipping). */
export function validateTicket(value, where) {
  if (!isPlainObject(value)) fail(where, "ticket must be an object");
  exactKeys(value, ["ticket_id", "created_at", "first_response_at", "resolved_at", "status", "issue_tags", "impact", "sentiment_signal", "rating", "subject", "body", "notes"], where);
  const ticket_id = validateRecordId(value.ticket_id, where);
  validateIsoDate(value.created_at, `${where}.created_at`);
  validateNullableIsoDate(value.first_response_at, `${where}.first_response_at`);
  validateNullableIsoDate(value.resolved_at, `${where}.resolved_at`);
  if (!STATUSES.includes(value.status)) fail(where, `status must be one of ${STATUSES.join(", ")}`);
  if (!Array.isArray(value.issue_tags) || value.issue_tags.length === 0 || value.issue_tags.length > 8) {
    fail(where, "issue_tags must be a non-empty array of at most 8 entries");
  }
  const issue_tags = value.issue_tags.map((t, i) => {
    if (typeof t !== "string" || !TAG_RE.test(t)) fail(`${where}.issue_tags[${i}]`, `invalid tag '${t}'`);
    return t;
  });
  if (new Set(issue_tags).size !== issue_tags.length) fail(where, "issue_tags contains duplicate entries");
  if (!IMPACTS.includes(value.impact)) fail(where, `impact must be one of ${IMPACTS.join(", ")}`);
  if (!SENTIMENTS.includes(value.sentiment_signal)) fail(where, `sentiment_signal must be one of ${SENTIMENTS.join(", ")}`);
  if (value.rating !== null) {
    if (!Number.isInteger(value.rating) || value.rating < 1 || value.rating > 5) fail(where, "rating must be an integer 1..5 or null");
  }
  const subject = reqStr(value, "subject", where, { allowEmpty: true, maxBytes: 4096 });
  const body = reqStr(value, "body", where, { allowEmpty: true, maxBytes: 16384 });
  const notes = reqStr(value, "notes", where, { allowEmpty: true, maxBytes: 8192 });
  return {
    ticket_id,
    created_at: value.created_at,
    first_response_at: value.first_response_at,
    resolved_at: value.resolved_at,
    status: value.status,
    issue_tags,
    impact: value.impact,
    sentiment_signal: value.sentiment_signal,
    rating: value.rating,
    subject,
    body,
    notes,
  };
}

/** Outer ticket-bundle shape: a JSON array of ticket records. Only the
 *  array shape and per-element byte bound are checked here — this is the
 *  "bounded preflight may inspect containers/lengths" step; it must never
 *  walk an UNCHARGED candidate's own fields (see src/index.js). */
export function validateTicketBundleShape(parsed, where) {
  if (!Array.isArray(parsed)) fail(where, "ticket bundle must be a JSON array");
  if (parsed.length > MAX_TICKETS_PER_BUNDLE_SCHEMA) fail(where, `ticket bundle exceeds ${MAX_TICKETS_PER_BUNDLE_SCHEMA} entries`);
  return parsed;
}

export { REPO_RE, PATH_RE, RECORD_ID_RE, SLUG_RE, TAG_RE };
