/**
 * schemas.js — runtime validation for the Scheduler Agent prototype.
 * Strict: rejects unknown properties in control-bearing objects, absent
 * required fields, wrong types, invalid enum values, duplicate IDs,
 * nonfinite numbers, invalid dates. Pure Node 24 ESM, zero dependencies.
 *
 * validateContext() treats the injected trusted context as a CANDIDATE
 * POPULATION: every source, every revision, every read grant, the
 * principal and the criteria are object-charged BEFORE any of their
 * fields are read. Revision text bytes are payload-charged before
 * acceptance. `budget` is REQUIRED.
 *
 * splitTopLevelArray() is the bounded-container preflight: it yields raw
 * per-element source spans of the network bundle WITHOUT decoding any
 * candidate's fields; the caller charges each candidate before
 * JSON.parse on its span.
 */

import { HEX40, isRealDate, isRealInstant } from "./canonical.js";

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaError";
  }
}

const REPO_RE = /^[a-z][a-z0-9-]{0,63}$/;
const PATH_RE = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*\.(md|txt|json)$/;
const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SLUG_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const COMPONENT_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const TIE_TYPES = ["FS", "SS", "FF", "SF"];
const CONSTRAINT_KINDS = ["START_NO_EARLIER_THAN", "MUST_FINISH_ON", "FINISH_NO_LATER_THAN", "ALAP"];
export const REQUESTED_OPERATION_ALLOWED = "analyze";
export const PRINCIPAL_ROLES = ["JASON", "MUSE_RELAY"];
export const MAX_RECORDS_PER_BUNDLE_SCHEMA = 4096; // outer array-shape bound only; the 64-object budget gates real processing
export const ABS_TICK_LIMIT = 366;

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

function reqInt(obj, key, where, { min = null, max = null } = {}) {
  const v = obj[key];
  if (!Number.isInteger(v)) fail(where, `'${key}' must be an integer`);
  if (min !== null && v < min) fail(where, `'${key}' must be >= ${min}`);
  if (max !== null && v > max) fail(where, `'${key}' must be <= ${max}`);
  return v;
}

/** Real calendar date (YYYY-MM-DD) or full UTC instant. Returns the string.
 * S648A-001: instants are validated by real round-trip semantics —
 * Date.parse normalizes impossible dates (2026-02-30 -> 2026-03-02),
 * so the components are reconstructed and compared exactly. */
export function validateDate(value, where) {
  if (typeof value !== "string") fail(where, "must be a string");
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (!isRealDate(value)) fail(where, "not a real calendar date");
    return value;
  }
  if (ISO_RE.test(value)) {
    if (!isRealInstant(value)) fail(where, "not a real UTC instant");
    return value;
  }
  fail(where, "must be YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ");
}

/**
 * S648A-001: descriptor-safe closed admission. Rejects objects carrying
 * accessor properties (getters/setters) — they are not plain data, and
 * reading them would execute request-supplied code during validation.
 * Uses getOwnPropertyDescriptor so the check itself never invokes accessors.
 */
export function assertNoAccessors(obj, where) {
  if (obj === null || typeof obj !== "object") return;
  for (const k of Object.keys(obj)) {
    const desc = Object.getOwnPropertyDescriptor(obj, k);
    if (desc && (typeof desc.get === "function" || typeof desc.set === "function")) {
      fail(where, `accessor property '${k}' is not plain data; refusing`);
    }
  }
}

/** SourceRef = {repo, path, commit, blob, algorithm:"git-sha1", revision}. */
export function validateSourceRef(value, where) {
  if (!isPlainObject(value)) fail(where, "SourceRef must be an object");
  assertNoAccessors(value, where);
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
  assertNoAccessors(value, where);
  exactKeys(value, ["principal_id", "role", "registered_by", "valid_from", "expires_at", "revoked"], where);
  const pid = reqStr(value, "principal_id", where);
  if (!RECORD_ID_RE.test(pid)) fail(where, `invalid principal_id '${pid}'`);
  if (!PRINCIPAL_ROLES.includes(value.role)) fail(where, `role must be one of ${PRINCIPAL_ROLES.join(", ")}`);
  const registered_by = reqStr(value, "registered_by", where);
  if (registered_by !== "jason") fail(where, "registered_by must be 'jason'");
  validateDate(value.valid_from, `${where}.valid_from`);
  validateDate(value.expires_at, `${where}.expires_at`);
  if (typeof value.revoked !== "boolean") fail(where, "revoked must be a boolean");
  return { principal_id: pid, role: value.role, registered_by, valid_from: value.valid_from, expires_at: value.expires_at, revoked: value.revoked };
}

/** Trusted criteria: versioned policy record. Host-injected only. */
export function validateCriteria(value, where, budget) {
  if (!budget || typeof budget.countObject !== "function") fail(where, "internal: validateCriteria requires a live budget");
  if (!isPlainObject(value)) fail(where, "criteria must be an object");
  exactKeys(value, ["criteria_version", "max_horizon_days"], where);
  const criteria_version = reqStr(value, "criteria_version", where);
  if (!SLUG_RE.test(criteria_version)) fail(where, `invalid criteria_version '${criteria_version}'`);
  const max_horizon_days = reqInt(value, "max_horizon_days", where, { min: 1, max: ABS_TICK_LIMIT });
  return { criteria_version, max_horizon_days };
}

export function validateReadGrant(value, where) {
  if (!isPlainObject(value)) fail(where, "read grant must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["repo", "path"], where);
  const repo = reqStr(value, "repo", where);
  if (!REPO_RE.test(repo)) fail(where, `invalid repo '${repo}'`);
  const path = reqStr(value, "path", where);
  if (!PATH_RE.test(path)) fail(where, `invalid path '${path}'`);
  return { repo, path };
}

export function validateContext(context, budget) {
  if (!budget || typeof budget.countObject !== "function") fail("context", "internal: validateContext requires a live budget");
  if (!isPlainObject(context)) fail("context", "must be an object");
  assertNoAccessors(context, "context");
  exactKeys(context, ["clock", "sources", "readGrants", "principal", "criteria"], "context");
  const clock = context.clock;
  if (!Number.isFinite(clock)) fail("context", "clock must be a finite number");

  if (!isPlainObject(context.sources)) fail("context", "sources must be an object");
  assertNoAccessors(context.sources, "context.sources");
  const sourceKeys = Object.keys(context.sources);
  if (sourceKeys.length === 0 || sourceKeys.length > 64) fail("context", "sources must have 1..64 entries");
  for (const sk of sourceKeys) {
    budget.countObject(`context.sources[${sk}]`);
    const entry = context.sources[sk];
    if (!isPlainObject(entry)) fail("context", `source '${sk}' must be an object`);
    assertNoAccessors(entry, `context.sources[${sk}]`);
    const revs = entry.revisions;
    if (!isPlainObject(revs)) fail("context", `source '${sk}' revisions must be an object`);
    assertNoAccessors(revs, `context.sources[${sk}].revisions`);
    for (const commit of Object.keys(revs)) {
      budget.countObject(`context.sources[${sk}]@${commit}`);
      const rev = revs[commit];
      if (!isPlainObject(rev)) fail("context", `source '${sk}' revision '${commit}' must be an object`);
      assertNoAccessors(rev, `context.sources[${sk}]@${commit}`);
      // S648A-002: grants precede bytes. The revision TEXT is not read,
      // payload-charged, or inspected here — only its descriptor is
      // checked (data property, string-typed, no accessor invocation).
      // The text is read by resolveSourceRef() after hasReadGrant passes.
      const textDesc = Object.getOwnPropertyDescriptor(rev, "text");
      if (!textDesc || typeof textDesc.get === "function" || typeof textDesc.set === "function") {
        fail("context", `source '${sk}' revision '${commit}' text must be a plain data property`);
      }
      if (typeof textDesc.value !== "string") fail("context", `source '${sk}' revision '${commit}' text must be a string`);
      if (typeof rev.blob !== "string" || !HEX40.test(rev.blob)) fail("context", `source '${sk}' revision '${commit}' blob must be a 40-hex Git object ID`);
      // S648A-002: revision label binding. The declared revision label in
      // the task's SourceRef must match the host-registered label for this
      // commit; tuple spoofing (invented revision on a real commit) is
      // rejected at resolve time.
      if (typeof rev.label !== "string" || rev.label.length === 0) {
        fail("context", `source '${sk}' revision '${commit}' must carry a registered label`);
      }
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
  const criteria = validateCriteria(context.criteria, "context.criteria", budget);

  return { clock, sources: context.sources, readGrants, principal, criteria };
}

/** One network record: activity | tie | calendar. All carry `component`. */
export function validateNetworkRecord(value, where) {
  if (!isPlainObject(value)) fail(where, "network record must be an object");
  assertNoAccessors(value, where);
  const kind = value.record;
  if (kind !== "activity" && kind !== "tie" && kind !== "calendar") {
    fail(where, `record must be one of activity|tie|calendar, got '${String(kind)}'`);
  }
  const component = reqStr(value, "component", where);
  if (!COMPONENT_RE.test(component)) fail(where, `invalid component '${component}'`);
  const note = value.note === undefined ? "" : reqStr(value, "note", where, { allowEmpty: true, maxBytes: 512 });

  if (kind === "activity") {
    exactKeys(value, ["record", "id", "component", "duration_workdays", "release_tick", "note"], where);
    const id = reqStr(value, "id", where);
    if (!RECORD_ID_RE.test(id)) fail(where, `invalid activity id '${id}'`);
    const duration_workdays = reqInt(value, "duration_workdays", where, { min: 0, max: ABS_TICK_LIMIT });
    const release_tick = reqInt(value, "release_tick", where, { min: 0, max: ABS_TICK_LIMIT });
    return { record: "activity", id, component, duration_workdays, release_tick, note };
  }
  if (kind === "tie") {
    exactKeys(value, ["record", "id", "component", "predecessor", "successor", "type", "lag_workdays", "note"], where);
    const id = reqStr(value, "id", where);
    if (!RECORD_ID_RE.test(id)) fail(where, `invalid tie id '${id}'`);
    const predecessor = reqStr(value, "predecessor", where);
    if (!RECORD_ID_RE.test(predecessor)) fail(where, `invalid predecessor '${predecessor}'`);
    const successor = reqStr(value, "successor", where);
    if (!RECORD_ID_RE.test(successor)) fail(where, `invalid successor '${successor}'`);
    if (predecessor === successor) fail(where, "tie predecessor and successor must differ");
    const type = reqStr(value, "type", where);
    if (!TIE_TYPES.includes(type)) fail(where, `tie type must be one of ${TIE_TYPES.join(",")}`);
    const lag_workdays = reqInt(value, "lag_workdays", where, { min: -ABS_TICK_LIMIT, max: ABS_TICK_LIMIT });
    return { record: "tie", id, component, predecessor, successor, type, lag_workdays, note };
  }
  // calendar
  exactKeys(value, ["record", "component", "working_weekdays", "excluded_dates", "note"], where);
  const ww = value.working_weekdays;
  if (!Array.isArray(ww) || ww.length === 0 || ww.length > 7) fail(where, "working_weekdays must be a non-empty array of at most 7 ISO weekdays");
  const seen = new Set();
  for (const d of ww) {
    if (!Number.isInteger(d) || d < 1 || d > 7) fail(where, "working_weekdays entries must be integers 1..7");
    if (seen.has(d)) fail(where, "working_weekdays must not repeat a weekday");
    seen.add(d);
  }
  const ed = value.excluded_dates;
  if (!Array.isArray(ed) || ed.length > 366) fail(where, "excluded_dates must be an array of at most 366 dates");
  const excluded_dates = ed.map((x, i) => {
    if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x) || !isRealDate(x)) {
      fail(where, `excluded_dates[${i}] must be a real YYYY-MM-DD date`);
    }
    return x;
  });
  return { record: "calendar", component, working_weekdays: [...ww].sort((a, b) => a - b), excluded_dates, note };
}

/** Task input schema. kind: "analyze" | "prohibited".
 *
 * Budget discipline (S648-001): when a live `budget` is supplied, every
 * task/control candidate is charged with budget.countObject() BEFORE any
 * of its own fields are read, under the same monotonic 64-object counter
 * as context and network records. A bounded preflight may inspect
 * containers/lengths, but attempt 65 refuses before that candidate (or
 * any later one) is inspected at all. Candidates charged: task root,
 * fixture_refs.network_bundle, options.population, each anchor, each
 * deadline entry, each constraint, each claimed activity, each claimed
 * critical path. Without a budget (legacy direct calls), validation is
 * unchanged.
 */
export function validateTask(task, budget = null) {
  const charge = (what) => { if (budget) budget.countObject(what); };
  charge("task");
  if (!isPlainObject(task)) fail("task", "must be an object");
  assertNoAccessors(task, "task");
  exactKeys(task, ["schema_version", "task_id", "operation", "fixture_refs", "options"], "task");
  if (task.schema_version !== "1") fail("task", "schema_version must be '1'");
  const task_id = reqStr(task, "task_id", "task", { maxBytes: 2048 });
  const operation = reqStr(task, "operation", "task", { maxBytes: 256 });

  if (!isPlainObject(task.fixture_refs)) fail("task", "fixture_refs must be an object");
  exactKeys(task.fixture_refs, ["network_bundle"], "task.fixture_refs");
  charge("task.fixture_refs.network_bundle");
  const network_bundle_ref = validateSourceRef(task.fixture_refs.network_bundle, "task.fixture_refs.network_bundle");

  if (!isPlainObject(task.options)) fail("task", "options must be an object");
  exactKeys(task.options, ["population", "anchors", "horizon_days", "deadlines", "constraints", "claimed"], "task.options");

  const pop = task.options.population;
  if (!isPlainObject(pop)) fail("task.options.population", "must be an object");
  charge("task.options.population");
  exactKeys(pop, ["declared_total", "complete"], "task.options.population");
  if (!Number.isInteger(pop.declared_total) || pop.declared_total < 0) fail("task.options.population", "declared_total must be a nonnegative integer");
  if (typeof pop.complete !== "boolean") fail("task.options.population", "complete must be a boolean");

  const anchors = task.options.anchors;
  if (!isPlainObject(anchors)) fail("task.options.anchors", "must be an object");
  const anchorKeys = Object.keys(anchors);
  if (anchorKeys.length === 0 || anchorKeys.length > 16) fail("task.options.anchors", "must have 1..16 component anchors");
  const anchorsOut = {};
  for (const c of anchorKeys) {
    charge(`task.options.anchors[${c}]`);
    if (!COMPONENT_RE.test(c)) fail("task.options.anchors", `invalid component '${c}'`);
    const dv = anchors[c];
    if (typeof dv !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dv) || !isRealDate(dv)) {
      fail("task.options.anchors", `anchor for '${c}' must be a real YYYY-MM-DD date`);
    }
    anchorsOut[c] = dv;
  }

  const horizon_days = reqInt(task.options, "horizon_days", "task.options", { min: 1, max: ABS_TICK_LIMIT });

  const deadlinesIn = task.options.deadlines === undefined ? {} : task.options.deadlines;
  if (!isPlainObject(deadlinesIn)) fail("task.options.deadlines", "must be an object");
  const deadlines = {};
  for (const c of Object.keys(deadlinesIn)) {
    charge(`task.options.deadlines[${c}]`);
    if (!COMPONENT_RE.test(c)) fail("task.options.deadlines", `invalid component '${c}'`);
    const v = deadlinesIn[c];
    if (!Number.isInteger(v) || v < 0 || v > ABS_TICK_LIMIT) fail("task.options.deadlines", `deadline for '${c}' must be an integer 0..366`);
    deadlines[c] = v;
  }

  const constraintsIn = task.options.constraints === undefined ? [] : task.options.constraints;
  if (!Array.isArray(constraintsIn) || constraintsIn.length > 256) fail("task.options.constraints", "must be an array of at most 256 constraints");
  const constraints = constraintsIn.map((c, i) => {
    charge(`task.options.constraints[${i}]`);
    const where = `task.options.constraints[${i}]`;
    if (!isPlainObject(c)) fail(where, "must be an object");
    assertNoAccessors(c, where);
    exactKeys(c, ["activity_id", "kind", "tick"], where);
    const activity_id = reqStr(c, "activity_id", where);
    if (!RECORD_ID_RE.test(activity_id)) fail(where, `invalid activity_id '${activity_id}'`);
    const kind = reqStr(c, "kind", where);
    if (!CONSTRAINT_KINDS.includes(kind)) fail(where, `kind must be one of ${CONSTRAINT_KINDS.join(",")}`);
    const tick = reqInt(c, "tick", where, { min: -ABS_TICK_LIMIT, max: ABS_TICK_LIMIT });
    return { activity_id, kind, tick };
  });

  const claimedIn = task.options.claimed === undefined ? {} : task.options.claimed;
  if (!isPlainObject(claimedIn)) fail("task.options.claimed", "must be an object");
  exactKeys(claimedIn, ["activities", "critical_paths"], "task.options.claimed");
  const claimedActivitiesIn = claimedIn.activities === undefined ? {} : claimedIn.activities;
  if (!isPlainObject(claimedActivitiesIn)) fail("task.options.claimed.activities", "must be an object");
  const claimedActivities = {};
  for (const id of Object.keys(claimedActivitiesIn)) {
    charge(`task.options.claimed.activities[${id}]`);
    const where = `task.options.claimed.activities.${id}`;
    if (!RECORD_ID_RE.test(id)) fail("task.options.claimed.activities", `invalid activity id '${id}'`);
    const v = claimedActivitiesIn[id];
    if (!isPlainObject(v)) fail(where, "must be an object");
    assertNoAccessors(v, where);
    exactKeys(v, ["es", "ef", "ls", "lf", "total_float"], where);
    const out = {};
    for (const k of ["es", "ef", "ls", "lf", "total_float"]) {
      const n = v[k];
      if (!Number.isInteger(n) || n < -ABS_TICK_LIMIT || n > ABS_TICK_LIMIT) fail(where, `'${k}' must be an integer -366..366`);
      out[k] = n;
    }
    claimedActivities[id] = out;
  }
  const claimedPathsIn = claimedIn.critical_paths === undefined ? {} : claimedIn.critical_paths;
  if (!isPlainObject(claimedPathsIn)) fail("task.options.claimed.critical_paths", "must be an object");
  const claimedPaths = {};
  for (const c of Object.keys(claimedPathsIn)) {
    charge(`task.options.claimed.critical_paths[${c}]`);
    if (!COMPONENT_RE.test(c)) fail("task.options.claimed.critical_paths", `invalid component '${c}'`);
    const p = claimedPathsIn[c];
    if (!Array.isArray(p) || p.length === 0 || p.length > 256) fail("task.options.claimed.critical_paths", `path for '${c}' must be a non-empty array of at most 256 activity ids`);
    for (const id of p) {
      if (typeof id !== "string" || !RECORD_ID_RE.test(id)) fail("task.options.claimed.critical_paths", `invalid activity id in path for '${c}'`);
    }
    claimedPaths[c] = [...p];
  }

  return {
    task_id,
    operation,
    network_bundle_ref,
    population: { declared_total: pop.declared_total, complete: pop.complete },
    anchors: anchorsOut,
    horizon_days,
    deadlines,
    constraints,
    claimed: { activities: claimedActivities, critical_paths: claimedPaths },
    kind: operation === REQUESTED_OPERATION_ALLOWED ? "analyze" : "prohibited",
  };
}

const WS_CHARS = new Set([" ", "\t", "\n", "\r"]);

function scanScalar(text, i, where) {
  const n = text.length;
  for (const lit of ["true", "false", "null"]) {
    if (text.startsWith(lit, i)) {
      const after = i + lit.length;
      if (after < n && /[A-Za-z0-9_$]/.test(text[after])) fail(where, "network bundle is not a valid JSON array");
      return after;
    }
  }
  let j = i;
  while (j < n && /[-+0-9.eE]/.test(text[j])) j++;
  if (j === i) fail(where, "network bundle is not a valid JSON array");
  return j;
}

/** Scan one complete composite value starting at i; return index past it.
 *  Structural only — strings are skipped by boundary, never unescaped. */
function scanComposite(text, i, where) {
  const n = text.length;
  if (text[i] === '"') {
    i++;
    while (i < n) {
      if (text[i] === "\\") { i += 2; continue; }
      if (text[i] === '"') return i + 1;
      if (text[i] < " ") fail(where, "network bundle is not a valid JSON array");
      i++;
    }
    fail(where, "network bundle is not a valid JSON array");
  }
  const stack = [];
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      i++;
      while (i < n) {
        if (text[i] === "\\") { i += 2; continue; }
        if (text[i] === '"') break;
        if (text[i] < " ") fail(where, "network bundle is not a valid JSON array");
        i++;
      }
      if (i >= n) fail(where, "network bundle is not a valid JSON array");
      i++;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      const open = stack.pop();
      if ((ch === "}" && open !== "{") || (ch === "]" && open !== "[")) {
        fail(where, "network bundle is not a valid JSON array");
      }
      if (stack.length === 0) return i + 1;
    }
    i++;
  }
  fail(where, "network bundle is not a valid JSON array");
}

/**
 * splitTopLevelArray(text, where) — bounded-container preflight for the
 * network bundle. Returns raw per-element source spans WITHOUT decoding
 * any candidate's fields. Each entry is {text, startByte, endByte} where
 * the byte offsets are half-open UTF-8 ranges into the source text, so the
 * caller can preserve and verify exact byte spans under the span budget.
 * The caller must budget.countObject() each candidate FIRST, then verify
 * its span, then JSON.parse only that candidate's span text.
 */
export function splitTopLevelArray(text, where) {
  if (typeof text !== "string") fail(where, "network bundle must be a JSON array");
  const n = text.length;
  let i = 0;
  while (i < n && WS_CHARS.has(text[i])) i++;
  if (i >= n || text[i] !== "[") fail(where, "network bundle must be a JSON array");
  i++;
  // Byte offset tracker: spans are sequential, so accumulate UTF-8 bytes.
  let bytePos = Buffer.byteLength(text.slice(0, i), "utf8");
  const spanAt = (startChar, endChar) => {
    const spanText = text.slice(startChar, endChar);
    const startByte = bytePos;
    const endByte = startByte + Buffer.byteLength(spanText, "utf8");
    return { text: spanText, startByte, endByte, _nextBytePos: endByte };
  };
  const advance = (fromChar, toChar) => {
    bytePos += Buffer.byteLength(text.slice(fromChar, toChar), "utf8");
  };
  const spans = [];
  let afterComma = false;
  for (;;) {
    const wsStart = i;
    while (i < n && WS_CHARS.has(text[i])) i++;
    advance(wsStart, i);
    if (i >= n) fail(where, "network bundle is not a valid JSON array");
    if (text[i] === "]") {
      if (afterComma || spans.length > 0) fail(where, "network bundle is not a valid JSON array");
      i++;
      const trailStart = i;
      while (i < n && WS_CHARS.has(text[i])) i++;
      if (i !== n) fail(where, "network bundle has trailing content");
      return spans;
    }
    const start = i;
    const c = text[i];
    if (c === '"' || c === "{" || c === "[") i = scanComposite(text, i, where);
    else if (c === "t" || c === "f" || c === "n" || c === "-" || (c >= "0" && c <= "9") || c === "+") {
      i = scanScalar(text, i, where);
    } else {
      fail(where, "network bundle is not a valid JSON array");
    }
    const s = spanAt(start, i);
    bytePos = s._nextBytePos;
    spans.push({ text: s.text, startByte: s.startByte, endByte: s.endByte });
    if (spans.length > MAX_RECORDS_PER_BUNDLE_SCHEMA) fail(where, `network bundle exceeds ${MAX_RECORDS_PER_BUNDLE_SCHEMA} entries`);
    afterComma = false;
    const wsStart2 = i;
    while (i < n && WS_CHARS.has(text[i])) i++;
    advance(wsStart2, i);
    if (i >= n) fail(where, "network bundle is not a valid JSON array");
    const sep = text[i];
    if (sep === ",") { i++; bytePos += 1; afterComma = true; continue; }
    if (sep === "]") {
      i++; bytePos += 1;
      const trailStart = i;
      while (i < n && WS_CHARS.has(text[i])) i++;
      if (i !== n) fail(where, "network bundle has trailing content");
      return spans;
    }
    fail(where, "network bundle is not a valid JSON array");
  }
}

export { REPO_RE, PATH_RE, RECORD_ID_RE, SLUG_RE, TIE_TYPES, CONSTRAINT_KINDS };
