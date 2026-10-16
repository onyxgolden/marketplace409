/**
 * schemas.js — runtime validation for the Maintenance Manager Agent
 * prototype. Strict: rejects unknown properties in control-bearing
 * objects, absent required fields, wrong types, invalid enum values,
 * duplicate IDs, nonfinite numbers, invalid dates. Pure Node 24 ESM,
 * zero dependencies.
 *
 * Design note (dates): the brief requires civil UTC day indices with
 * actual calendar validation — no local DST/business calendar. All date
 * fields are "YYYY-MM-DD" strings validated as a real calendar date and
 * converted to a UTC day index (canonical.js:dayIndexOfMs) for all
 * arithmetic (age, bins, overdue, PM window membership).
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
const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERCENT_RE = /^\d{1,3}\.\d{2}$/;

/** Closed set of header metrics this slice can compare a claim against.
 *  Extending to more metrics is a separate, reviewable schema change. */
export const CLAIM_METRICS = ["pm_compliance_percent"];
export const MAX_CLAIMS = 16;

export const REQUESTED_OPERATION_ALLOWED = "analyze";
export const STATUS_VALUES = ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
export const PRIORITY_VALUES = ["P1", "P2", "P3"];
export const PRINCIPAL_ROLES = ["JASON", "MUSE_RELAY"];

export const MAX_WORK_ORDERS_SCHEMA = 64; // outer array-shape bound only; the 64-object budget gates real processing
export const MAX_PM_OCCURRENCES_SCHEMA = 64;
export const MAX_ASSETS_SCHEMA = 128;
export const MAX_NOTES_BYTES = 2048;

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

export function validateIsoDate(value, where) {
  if (typeof value !== "string") fail(where, "must be a string");
  if (!DATE_RE.test(value)) fail(where, "must be YYYY-MM-DD");
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms)) fail(where, "not a real calendar date");
  const d = new Date(ms);
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const mo = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const da = d.getUTCDate().toString().padStart(2, "0");
  if (`${y}-${mo}-${da}` !== value) fail(where, "not a real calendar date");
  return ms;
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

export function validatePrincipal(value, where) {
  if (!isPlainObject(value)) fail(where, "principal must be an object");
  exactKeys(value, ["principal_id", "role", "registered_by", "valid_from", "expires_at", "revoked"], where);
  const principal_id = validateRecordId(value.principal_id, where);
  if (!PRINCIPAL_ROLES.includes(value.role)) fail(where, `role must be one of ${PRINCIPAL_ROLES.join(", ")}`);
  const registered_by = reqStr(value, "registered_by", where);
  if (registered_by !== "jason") fail(where, "registered_by must be 'jason'");
  validateIsoTimestamp(value.valid_from, `${where}.valid_from`);
  validateIsoTimestamp(value.expires_at, `${where}.expires_at`);
  if (typeof value.revoked !== "boolean") fail(where, "revoked must be a boolean");
  return { principal_id, role: value.role, registered_by, valid_from: value.valid_from, expires_at: value.expires_at, revoked: value.revoked };
}

const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
function validateIsoTimestamp(value, where) {
  if (typeof value !== "string" || !ISO_TS_RE.test(value)) fail(where, "must be YYYY-MM-DDTHH:MM:SSZ");
  if (!Number.isFinite(Date.parse(value))) fail(where, "not a real instant");
  return value;
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
 * validateContextShape — OUTER SHAPE PREFLIGHT ONLY. Checks container
 * types and bounded lengths but NEVER descends into reading any
 * individual source/revision/grant/criteria-entry field — that is
 * exactly the unbudgeted walk that let an unused, oversized registry
 * entry bypass the budget entirely in this program's earlier Customer
 * Success (CS-001) and Document Agent (DOC-002) findings. The real
 * per-item validation is called one object at a time by the CHARGED walk
 * in contextGuard.js, via budget.countObject() BEFORE each item's fields
 * are read.
 */
export function validateContextShape(context) {
  if (!isPlainObject(context)) fail("context", "must be an object");
  exactKeys(context, ["clock", "sources", "readGrants", "principal", "criteria"], "context");
  const clock = context.clock;
  if (!Number.isFinite(clock)) fail("context", "clock must be a finite number");

  if (!isPlainObject(context.sources)) fail("context", "sources must be an object");
  const sourceKeys = Object.keys(context.sources);
  if (sourceKeys.length === 0 || sourceKeys.length > 4096) fail("context", "sources must have 1..4096 entries");

  if (!Array.isArray(context.readGrants) || context.readGrants.length > 4096) fail("context", "readGrants must be an array of at most 4096 entries");
  if (!isPlainObject(context.principal)) fail("context", "principal must be an object");
  if (!isPlainObject(context.criteria)) fail("context", "criteria must be an object");

  return { clock, sources: context.sources, sourceKeys, readGrantsRaw: context.readGrants, principalRaw: context.principal, criteriaRaw: context.criteria };
}

export function validateSourceEntryShape(entry, where) {
  if (!isPlainObject(entry)) fail(where, "must be an object");
  if (!isPlainObject(entry.revisions)) fail(where, "revisions must be an object");
  const commits = Object.keys(entry.revisions);
  if (commits.length > 256) fail(where, "revisions must have at most 256 entries");
  return commits;
}

export function validateRevisionEntry(rev, where) {
  if (!isPlainObject(rev)) fail(where, "must be an object");
  if (typeof rev.text !== "string") fail(where, "text must be a string");
  if (typeof rev.blob !== "string" || !HEX40.test(rev.blob)) fail(where, "blob must be a 40-hex Git object ID");
  return { text: rev.text, blob: rev.blob };
}

/** criteria container: just a version slug for this slice — Maintenance
 *  Manager has no disjoint-population pooling rule, so no nested array
 *  to walk one-at-a-time here (unlike Executive Manager's
 *  population_groups). Still charged as one context.criteria object by
 *  the same unified budget as every other registry entry. */
export function validateCriteria(value, where) {
  if (!isPlainObject(value)) fail(where, "criteria must be an object");
  exactKeys(value, ["criteria_version"], where);
  const v = reqStr(value, "criteria_version", where);
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(v)) fail(where, `invalid criteria_version '${v}'`);
  return { criteria_version: v };
}

/**
 * claimed_summary (MM-S1-003): an optional set of header claims the
 * caller asserts, each comparing a claimed value against a metric this
 * agent independently computes. `null` (or the key omitted entirely)
 * means no claims — header_comparisons stays empty, exactly today's
 * behavior. Per the common contract, a header value is a CLAIM, never an
 * input to its own verification: this schema only accepts the claim
 * itself, never a precomputed "match" flag.
 *
 * MM-S1-003: every claim set must carry provenance — a registered,
 * pinned fixture (source_ref + byte span) whose bytes contain the
 * claimed values. The provenance is resolved and span-verified by the
 * caller; the resulting citation is carried into each header comparison.
 * Absent provenance means the claim has no verified support: comparisons
 * are emitted with an explicit UNAVAILABLE claim citation and can never
 * be MATCH.
 */
export function validateClaimedSummary(value, where) {
  if (value === null) return null;
  if (!isPlainObject(value)) fail(where, "must be null or an object");
  exactKeys(value, ["claims", "provenance"], where);
  if (!Array.isArray(value.claims) || value.claims.length > MAX_CLAIMS) fail(where, `claims must be an array of at most ${MAX_CLAIMS} entries`);
  const seen = new Set();
  const claims = [];
  for (let i = 0; i < value.claims.length; i++) {
    const c = value.claims[i];
    const w2 = `${where}.claims[${i}]`;
    if (!isPlainObject(c)) fail(w2, "must be an object");
    exactKeys(c, ["claim_id", "metric", "claimed_value"], w2);
    const claim_id = validateRecordId(c.claim_id, w2);
    if (seen.has(claim_id)) fail(w2, `duplicate claim_id '${claim_id}'`);
    seen.add(claim_id);
    if (!CLAIM_METRICS.includes(c.metric)) fail(w2, `metric must be one of ${CLAIM_METRICS.join(", ")}`);
    const claimed_value = reqStr(c, "claimed_value", w2);
    if (!PERCENT_RE.test(claimed_value)) fail(w2, "claimed_value must be a 2-decimal percent string, e.g. '98.00'");
    claims.push({ claim_id, metric: c.metric, claimed_value });
  }
  // MM-S1-003: optional provenance binding. When present it must be a
  // valid SourceRef + span; the caller resolves and verifies it.
  let provenance = null;
  if (value.provenance !== undefined && value.provenance !== null) {
    const p = value.provenance;
    const w3 = `${where}.provenance`;
    if (!isPlainObject(p)) fail(w3, "must be an object");
    exactKeys(p, ["source_ref", "span"], w3);
    const source_ref = validateSourceRef(p.source_ref, `${w3}.source_ref`);
    const span = validateSpan(p.span, `${w3}.span`);
    provenance = { source_ref, span };
  }
  return { claims, provenance };
}

/** Task input schema. kind: "analyze" | "prohibited". */
export function validateTask(task) {
  if (!isPlainObject(task)) fail("task", "must be an object");
  exactKeys(task, ["schema_version", "task_id", "operation", "fixture_refs", "options"], "task");
  if (task.schema_version !== "1") fail("task", "schema_version must be '1'");
  const task_id = reqStr(task, "task_id", "task", { maxBytes: 2048 });
  const operation = reqStr(task, "operation", "task", { maxBytes: 256 });

  if (!isPlainObject(task.fixture_refs)) fail("task", "fixture_refs must be an object");
  exactKeys(task.fixture_refs, ["register"], "task.fixture_refs");
  const register_ref = validateSourceRef(task.fixture_refs.register, "task.fixture_refs.register");

  if (!isPlainObject(task.options)) fail("task", "options must be an object");
  exactKeys(task.options, ["as_of_date", "window", "population", "claimed_summary"], "task.options");

  const as_of_ms = validateIsoDate(task.options.as_of_date, "task.options.as_of_date");

  const win = task.options.window;
  if (!isPlainObject(win)) fail("task.options.window", "must be an object");
  exactKeys(win, ["start_date", "end_date"], "task.options.window");
  const win_start_ms = validateIsoDate(win.start_date, "task.options.window.start_date");
  const win_end_ms = validateIsoDate(win.end_date, "task.options.window.end_date");
  if (win_end_ms < win_start_ms) fail("task.options.window", "end_date must not precede start_date");

  const pop = task.options.population;
  if (!isPlainObject(pop)) fail("task.options.population", "must be an object");
  exactKeys(pop, ["declared_total", "complete"], "task.options.population");
  if (!Number.isInteger(pop.declared_total) || pop.declared_total < 0) fail("task.options.population", "declared_total must be a nonnegative integer");
  if (typeof pop.complete !== "boolean") fail("task.options.population", "complete must be a boolean");

  const claimedSummaryRaw = task.options.claimed_summary === undefined ? null : task.options.claimed_summary;
  const claimed_summary = validateClaimedSummary(claimedSummaryRaw, "task.options.claimed_summary");

  return {
    task_id,
    operation,
    register_ref,
    as_of_date: task.options.as_of_date,
    as_of_ms,
    window: { start_date: win.start_date, end_date: win.end_date, start_ms: win_start_ms, end_ms: win_end_ms },
    population: { declared_total: pop.declared_total, complete: pop.complete },
    claimed_summary,
    kind: operation === REQUESTED_OPERATION_ALLOWED ? "analyze" : "prohibited",
  };
}

function validateSpan(value, where) {
  if (!isPlainObject(value)) fail(where, "span must be an object");
  exactKeys(value, ["start_byte", "end_byte"], where);
  if (!Number.isInteger(value.start_byte) || value.start_byte < 0) fail(where, "start_byte must be a nonnegative integer");
  if (!Number.isInteger(value.end_byte) || value.end_byte <= value.start_byte) fail(where, "end_byte must be an integer greater than start_byte");
  return { start_byte: value.start_byte, end_byte: value.end_byte };
}

/** One work order record. Container-level preflight only for date
 *  FORMAT (not chronology — chronology/integrity rules are domain logic
 *  in audit.js, since "missing/future completion is an integrity
 *  finding, not a schema rejection" per the brief). notes is untrusted
 *  free text, scanned for injection, never a citation target and never
 *  influencing structured state. */
export function validateWorkOrder(value, where) {
  if (!isPlainObject(value)) fail(where, "work order must be an object");
  exactKeys(value, ["work_order_id", "asset_id", "created_date", "status", "priority", "completed_date", "due_date", "notes", "content_ref", "span"], where);
  const work_order_id = validateRecordId(value.work_order_id, where);
  const asset_id = validateRecordId(value.asset_id, where);
  if (!STATUS_VALUES.includes(value.status)) fail(where, `status must be one of ${STATUS_VALUES.join(", ")}`);
  if (!PRIORITY_VALUES.includes(value.priority)) fail(where, `priority must be one of ${PRIORITY_VALUES.join(", ")}`);
  const created_ms = validateIsoDate(value.created_date, `${where}.created_date`);
  let completed_ms = null;
  if (value.completed_date !== null) completed_ms = validateIsoDate(value.completed_date, `${where}.completed_date`);
  let due_ms = null;
  if (value.due_date !== null) due_ms = validateIsoDate(value.due_date, `${where}.due_date`);
  const notes = reqStr(value, "notes", where, { allowEmpty: true, maxBytes: MAX_NOTES_BYTES });
  const content_ref = validateSourceRef(value.content_ref, `${where}.content_ref`);
  const span = validateSpan(value.span, `${where}.span`);
  return {
    work_order_id, asset_id,
    created_date: value.created_date, created_ms,
    status: value.status, priority: value.priority,
    completed_date: value.completed_date, completed_ms,
    due_date: value.due_date, due_ms,
    notes, content_ref, span,
  };
}

/** One PM occurrence record. */
export function validatePmOccurrence(value, where) {
  if (!isPlainObject(value)) fail(where, "PM occurrence must be an object");
  exactKeys(value, ["occurrence_id", "asset_id", "due_date", "window_start", "window_end", "linked_work_order_id", "content_ref", "span"], where);
  const occurrence_id = validateRecordId(value.occurrence_id, where);
  const asset_id = validateRecordId(value.asset_id, where);
  const due_ms = validateIsoDate(value.due_date, `${where}.due_date`);
  const window_start_ms = validateIsoDate(value.window_start, `${where}.window_start`);
  const window_end_ms = validateIsoDate(value.window_end, `${where}.window_end`);
  if (window_end_ms < window_start_ms) fail(where, "window_end must not precede window_start");
  let linked_work_order_id = null;
  if (value.linked_work_order_id !== null) linked_work_order_id = validateRecordId(value.linked_work_order_id, `${where}.linked_work_order_id`);
  const content_ref = validateSourceRef(value.content_ref, `${where}.content_ref`);
  const span = validateSpan(value.span, `${where}.span`);
  return {
    occurrence_id, asset_id,
    due_date: value.due_date, due_ms,
    window_start: value.window_start, window_start_ms,
    window_end: value.window_end, window_end_ms,
    linked_work_order_id,
    content_ref, span,
  };
}

/** Outer register shape: {assets:[...], work_orders:[...],
 *  pm_occurrences:[...]}. Only the array shape and outer bound are
 *  checked here — "a bounded preflight may inspect containers/lengths"
 *  — it must never walk an UNCHARGED candidate's own fields (see
 *  src/index.js, which charges each work order / PM occurrence one at a
 *  time before calling validateWorkOrder/validatePmOccurrence on it). */
export function validateRegisterShape(parsed, where) {
  if (!isPlainObject(parsed)) fail(where, "register must be an object");
  exactKeys(parsed, ["assets", "work_orders", "pm_occurrences"], where);
  if (!Array.isArray(parsed.assets) || parsed.assets.length > MAX_ASSETS_SCHEMA) fail(where, `assets must be an array of at most ${MAX_ASSETS_SCHEMA} entries`);
  if (!Array.isArray(parsed.work_orders) || parsed.work_orders.length > MAX_WORK_ORDERS_SCHEMA) fail(where, `work_orders must be an array of at most ${MAX_WORK_ORDERS_SCHEMA} entries`);
  if (!Array.isArray(parsed.pm_occurrences) || parsed.pm_occurrences.length > MAX_PM_OCCURRENCES_SCHEMA) fail(where, `pm_occurrences must be an array of at most ${MAX_PM_OCCURRENCES_SCHEMA} entries`);
  return parsed;
}

export { REPO_RE, PATH_RE, RECORD_ID_RE, DATE_RE };
