/**
 * schemas.js — Sales Agent prototype schemas and descriptor-safe admission.
 * Pure Node 24 ESM, zero dependencies.
 *
 * Generic admission helpers (admitGraph, assertNoAccessors, etc.) follow the
 * same descriptor-safe discipline as the other AI Lab prototypes: charge
 * every candidate object BEFORE any of its fields are read; reject
 * accessors, functions, symbols, and non-plain prototypes.
 */

import { HEX40, isRealDate, isRealInstant } from "./canonical.js";
import { types } from "node:util";

/**
 * Trap-free native Proxy detection. types.isProxy is a V8 intrinsic: it
 * reports Proxy-ness WITHOUT invoking any user trap (get, getOwnPropertyDescriptor,
 * ownKeys, getPrototypeOf). Every other reflective check fires traps, so this
 * is the only safe first gate (S653-006).
 */
export function assertNotProxy(value, where) {
  if (types.isProxy(value)) {
    fail(where, "proxy input refused before inspection; proxies are not plain data");
  }
}

/**
 * S653-006 (fix round 2): plain-prototype assertion. Only Object.prototype
 * and null prototypes are plain data. Any other prototype — including
 * inherited GETTERS or inherited data — is refused structurally, before
 * any property of the object is read. This stops inherited accessors from
 * executing during admission (a Proxy check alone cannot stop them).
 */
export function assertPlainPrototype(value, where) {
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    fail(where, "unsupported prototype; inherited accessors or data are not plain data; refusing");
  }
}

/** Real calendar date (YYYY-MM-DD) or full UTC instant. Throws on invalid. */
function validateDate(value, where) {
  if (typeof value !== "string") fail(where, "must be a string");
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (!isRealDate(value)) fail(where, "not a real calendar date");
    return value;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
    if (!isRealInstant(value)) fail(where, "not a real UTC instant");
    return value;
  }
  fail(where, "must be YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ");
}

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaError";
  }
}

const REPO_RE = /^[a-z][a-z0-9-]{0,63}$/;
const PATH_RE = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*\.(md|txt|json)$/;
const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const LEAD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const OPP_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const PRODUCT_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const TOKEN_RE = /^[a-z][a-z0-9_/-]{0,63}$/;
export const REQUESTED_OPERATION_ALLOWED = "analyze";
export const PRINCIPAL_ROLES = ["JASON", "MUSE_RELAY"];
export const MAX_RECORDS_PER_BUNDLE_SCHEMA = 4096; // outer array-shape bound only; the 64-object budget gates real processing
const STAGES = ["NEW", "QUALIFICATION", "PROPOSAL", "CLOSED_WON", "CLOSED_LOST"];
const FITS = ["FIT_HIGH", "FIT_MEDIUM", "FIT_LOW", "FIT_UNKNOWN"];

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

/**
 * Descriptor-safe closed admission. Rejects objects carrying accessor
 * properties (getters/setters) — they are not plain data, and reading them
 * would execute request-supplied code during validation.
 */
export function assertNoAccessors(obj, where) {
  if (obj === null || typeof obj !== "object") return;
  for (const k of Object.getOwnPropertyNames(obj)) {
    const desc = Object.getOwnPropertyDescriptor(obj, k);
    if (desc && (typeof desc.get === "function" || typeof desc.set === "function")) {
      fail(where, `accessor property '${k}' is not plain data; refusing`);
    }
  }
}

/**
 * Budget-integrated descriptor-safe admission. Charges each distinct object
 * against the live monotonic budget BEFORE any of its descriptor fields
 * are examined. Candidate #65 refuses with BUDGET_EXCEEDED without touching
 * that candidate at all. Rejects accessors, functions, symbols,
 * non-plain prototypes, Proxies (via trap-free native detection), and
 * graphs deeper than 32.
 *
 * S653-005 (fix round 2): this walk charges OBJECTS only. Byte accounting
 * uses the single nonduplicating serialized representation
 * (budget.chargeSerialized, measured with serializedByteLength), applied by
 * the caller once per consulted value — structure, quoting, escaping and
 * all. Per-string/per-name byte charging here would double-count against
 * that representation, so it is intentionally absent.
 * S653-006: types.isProxy is checked before ANY reflective call, so a
 * Proxy-wrapped input is refused with zero trap invocations.
 */
export function admitGraph(value, where, budget, maxDepth = 32) {
  if (!budget || typeof budget.chargeObjectOnce !== "function") {
    fail(where, "internal: admitGraph requires a live budget");
  }
  const seen = new WeakSet();
  const walk = (v, path, depth) => {
    if (v === null || typeof v !== "object") {
      return;
    }
    // S653-006: native Proxy rejection before any reflection. This check
    // is trap-free; everything below would fire user traps on a Proxy.
    assertNotProxy(v, path);
    if (depth > maxDepth) {
      fail(where, `object graph exceeds max depth ${maxDepth} at '${path}'; refusing`);
    }
    if (seen.has(v)) return;
    seen.add(v);
    budget.chargeObjectOnce(v, path);
    // Plain data: objects on Object.prototype (or null), arrays on
    // Array.prototype. Anything else — including inherited accessors or
    // inherited data — is refused structurally (S653-006 fix round 2).
    const proto = Object.getPrototypeOf(v);
    const protoOk = Array.isArray(v)
      ? (proto === Array.prototype)
      : (proto === Object.prototype || proto === null);
    if (!protoOk) {
      fail(where, `unsupported prototype at '${path}'; inherited accessors or data are not plain data; refusing`);
    }
    for (const k of Object.getOwnPropertyNames(v)) {
      const desc = Object.getOwnPropertyDescriptor(v, k);
      if (!desc) continue;
      if (typeof desc.get === "function" || typeof desc.set === "function") {
        fail(where, `accessor property '${path}.${k}' is not plain data; refusing`);
      }
      if (typeof desc.value === "function") {
        fail(where, `function property '${path}.${k}' is not plain data; refusing`);
      }
      if (typeof desc.value === "symbol") {
        fail(where, `symbol property '${path}.${k}' is not plain data; refusing`);
      }
      walk(desc.value, `${path}.${String(k)}`, depth + 1);
    }
    for (const s of Object.getOwnPropertySymbols(v)) {
      fail(where, `symbol-keyed property '${path}.${String(s)}' is not plain data; refusing`);
    }
  };
  walk(value, where, 0);
}

/**
 * Deep descriptor-safe admission sweep (pre-transport gate).
 */
export function assertDeepNoAccessors(value, where, maxDepth = 32) {
  const seen = new WeakSet();
  const walk = (v, path, depth) => {
    if (v === null || typeof v !== "object") return;
    if (depth > maxDepth) fail(where, `object graph exceeds max depth ${maxDepth} at '${path}'; refusing`);
    if (seen.has(v)) return;
    seen.add(v);
    for (const k of Object.getOwnPropertyNames(v)) {
      const desc = Object.getOwnPropertyDescriptor(v, k);
      if (!desc) continue;
      if (typeof desc.get === "function" || typeof desc.set === "function") {
        fail(where, `accessor property '${path}.${k}' is not plain data; refusing`);
      }
      if (typeof desc.value === "function") {
        fail(where, `function property '${path}.${k}' is not plain data; refusing`);
      }
      if (typeof desc.value === "symbol") {
        fail(where, `symbol property '${path}.${k}' is not plain data; refusing`);
      }
      if (desc.value !== null && typeof desc.value === "object") {
        walk(desc.value, `${path}.${String(k)}`, depth + 1);
      }
    }
    for (const s of Object.getOwnPropertySymbols(v)) {
      fail(where, `symbol-keyed property '${path}.${String(s)}' is not plain data; refusing`);
    }
  };
  walk(value, where, 0);
}

/**
 * Structural sparse-array rejection.
 */
export function assertDenseArray(arr, where) {
  if (!Array.isArray(arr)) fail(where, "must be an array");
  for (let i = 0; i < arr.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(arr, i);
    if (!desc || typeof desc.get === "function" || typeof desc.set === "function") {
      fail(where, `sparse or accessor array slot at index ${i}; refusing`);
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
  const principal_id = reqStr(value, "principal_id", where);
  if (!PRINCIPAL_ROLES.includes(value.role)) fail(where, `role must be one of ${PRINCIPAL_ROLES.join(", ")}`);
  reqStr(value, "registered_by", where);
  validateDate(value.valid_from, `${where}.valid_from`);
  validateDate(value.expires_at, `${where}.expires_at`);
  if (typeof value.revoked !== "boolean") fail(where, "revoked must be a boolean");
  if (value.revoked) fail(where, "principal is revoked; refusing");
  // S653-004: the validity window itself must be non-inverted; the live
  // clock check against this window happens in run() (index.js).
  if (instantStartMs(value.valid_from) > instantEndMs(value.expires_at)) {
    fail(where, "principal validity window is inverted (valid_from after expires_at); refusing");
  }
  return { principal_id, role: value.role, registered_by: value.registered_by, valid_from: value.valid_from, expires_at: value.expires_at, revoked: false };
}

/**
 * Normalize a validated civil date or UTC instant to a millisecond
 * timestamp. Date-only values are treated as civil dates: valid_from /
 * interval starts normalize to 00:00:00Z; valid_to / interval ends
 * normalize to the END of the civil day (23:59:59Z), inclusive.
 * Exported for run() (principal window) and sales.js (report intervals).
 */
export function instantStartMs(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T00:00:00Z`);
  return Date.parse(value);
}

export function instantEndMs(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T23:59:59Z`);
  return Date.parse(value);
}

/**
 * S653-004: is the principal's authorization window live at the injected
 * host clock (ms)? Inclusive on both ends under civil-date semantics.
 */
export function principalWindowLive(principal, clockMs) {
  if (!Number.isFinite(clockMs)) return false;
  return instantStartMs(principal.valid_from) <= clockMs && clockMs <= instantEndMs(principal.expires_at);
}

export function validateReadGrant(value, where, budget) {
  if (!isPlainObject(value)) fail(where, "read grant must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["repo", "path"], where);
  if (budget) budget.chargeObjectOnce(value, where);
  const repo = reqStr(value, "repo", where);
  if (!REPO_RE.test(repo)) fail(where, `invalid repo '${repo}'`);
  const path = reqStr(value, "path", where);
  if (!PATH_RE.test(path)) fail(where, `invalid path '${path}'`);
  return { repo, path };
}

/**
 * Sales criteria sales-v1: {criteria_id, criteria_version,
 *  fit_high_timing_days, allowlisted_product_tokens, allowlisted_benefit_tokens}.
 */
export function validateCriteria(value, where, budget) {
  if (!isPlainObject(value)) fail(where, "criteria must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["criteria_id", "criteria_version", "fit_high_timing_days", "allowlisted_product_tokens", "allowlisted_benefit_tokens"], where);
  if (budget) budget.chargeObjectOnce(value, where);
  const criteria_id = reqStr(value, "criteria_id", where);
  if (!PRODUCT_ID_RE.test(criteria_id)) fail(where, `invalid criteria_id '${criteria_id}'`);
  const criteria_version = reqStr(value, "criteria_version", where);
  const fit_high_timing_days = reqInt(value, "fit_high_timing_days", where, { min: 1, max: 3650 });
  const apt = value.allowlisted_product_tokens;
  if (!Array.isArray(apt) || apt.length === 0 || apt.length > 64) fail(where, "allowlisted_product_tokens must be a non-empty array of 1..64 tokens");
  assertDenseArray(apt, `${where}.allowlisted_product_tokens`);
  for (let i = 0; i < apt.length; i++) {
    if (typeof apt[i] !== "string" || !TOKEN_RE.test(apt[i])) fail(where, `allowlisted_product_tokens[${i}] must match ${TOKEN_RE}`);
  }
  const abt = value.allowlisted_benefit_tokens;
  if (!Array.isArray(abt) || abt.length === 0 || abt.length > 64) fail(where, "allowlisted_benefit_tokens must be a non-empty array of 1..64 tokens");
  assertDenseArray(abt, `${where}.allowlisted_benefit_tokens`);
  for (let i = 0; i < abt.length; i++) {
    if (typeof abt[i] !== "string" || !TOKEN_RE.test(abt[i])) fail(where, `allowlisted_benefit_tokens[${i}] must match ${TOKEN_RE}`);
  }
  return { criteria_id, criteria_version, fit_high_timing_days, allowlisted_product_tokens: [...apt], allowlisted_benefit_tokens: [...abt] };
}

/**
 * Lead record: {lead_id, opportunity_id, need_match, budget_match,
 *  timing_days, do_not_contact, stage, amount_minor, currency,
 *  probability_num, probability_den, created_at, stage_entered_at,
 *  closed_at, fixture_product_id, display_name, notes}.
 *
 * amount_minor is an integer-minor-units STRING (exact BigInt arithmetic).
 * probability is a rational probability_num/probability_den in [0,1].
 * do_not_contact is a validated boolean, never defaulted.
 */
export function validateLeadRecord(value, where, budget = null, preCharged = false) {
  // S653-005: when the caller already charged this record's object slot
  // BEFORE decoding (charge-before-parse), the top-level charge is skipped
  // to avoid double-counting the same candidate. Direct callers keep the
  // default behavior.
  const charge = (obj, w) => { if (budget && !preCharged) budget.chargeObjectOnce(obj, w); };
  if (!isPlainObject(value)) fail(where, "lead record must be an object");
  charge(value, where);
  assertNoAccessors(value, where);
  exactKeys(value, ["lead_id", "opportunity_id", "need_match", "budget_match", "timing_days",
    "do_not_contact", "stage", "amount_minor", "currency", "probability_num", "probability_den",
    "created_at", "stage_entered_at", "closed_at", "fixture_product_id", "display_name", "notes"], where);
  const lead_id = reqStr(value, "lead_id", where);
  if (!LEAD_ID_RE.test(lead_id)) fail(where, `invalid lead_id '${lead_id}'`);
  const opportunity_id = reqStr(value, "opportunity_id", where);
  if (!OPP_ID_RE.test(opportunity_id)) fail(where, `invalid opportunity_id '${opportunity_id}'`);
  const need_match = value.need_match;
  if (need_match !== null && typeof need_match !== "boolean") fail(where, "need_match must be boolean or null");
  const budget_match = value.budget_match;
  if (budget_match !== null && typeof budget_match !== "boolean") fail(where, "budget_match must be boolean or null");
  const timing_days = value.timing_days;
  if (timing_days !== null && (!Number.isInteger(timing_days) || timing_days < 0)) fail(where, "timing_days must be a nonnegative integer or null");
  // do_not_contact is a validated boolean, never defaulted from missing input.
  if (typeof value.do_not_contact !== "boolean") fail(where, "do_not_contact must be a validated boolean; refusing");
  const do_not_contact = value.do_not_contact;
  if (!STAGES.includes(value.stage)) fail(where, `stage must be one of ${STAGES.join(", ")}`);
  const stage = value.stage;
  // amount_minor: integer-minor-units string, exact.
  if (typeof value.amount_minor !== "string" || !/^-?\d{1,18}$/.test(value.amount_minor)) {
    fail(where, "amount_minor must be an integer-minor-units string of 1..18 digits (optional leading -)");
  }
  const amount_minor = value.amount_minor;
  const currency = reqStr(value, "currency", where);
  if (!CURRENCY_RE.test(currency)) fail(where, `currency must be a 3-letter ISO code, got '${currency}'`);
  // probability rational in [0,1].
  const probability_num = reqInt(value, "probability_num", where, { min: 0 });
  const probability_den = reqInt(value, "probability_den", where, { min: 1 });
  if (probability_num > probability_den) fail(where, "probability must be within [0,1]: probability_num <= probability_den");
  validateDate(value.created_at, `${where}.created_at`);
  validateDate(value.stage_entered_at, `${where}.stage_entered_at`);
  if (value.closed_at !== null) validateDate(value.closed_at, `${where}.closed_at`);
  const fixture_product_id = reqStr(value, "fixture_product_id", where);
  if (!PRODUCT_ID_RE.test(fixture_product_id)) fail(where, `invalid fixture_product_id '${fixture_product_id}'`);
  reqStr(value, "display_name", where, { allowEmpty: true, maxBytes: 512 });
  reqStr(value, "notes", where, { allowEmpty: true, maxBytes: 4096 });
  return {
    lead_id, opportunity_id, need_match, budget_match, timing_days, do_not_contact,
    stage, amount_minor, currency, probability_num, probability_den,
    created_at: value.created_at, stage_entered_at: value.stage_entered_at, closed_at: value.closed_at,
    fixture_product_id, display_name: value.display_name, notes: value.notes,
  };
}

/**
 * Structural pre-decode splitter: yields raw per-element spans of a
 * top-level JSON array without unescaping or interpreting any element's
 * fields. Byte offsets are UTF-8 half-open [start,end).
 */
export function splitTopLevelArray(text, where) {
  if (typeof text !== "string") fail(where, "bundle text must be a string");
  const bytes = Buffer.from(text, "utf8");
  let i = 0;
  const skipWs = () => { while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)) i++; };
  skipWs();
  if (bytes[i] !== 0x5b) fail(where, "bundle must be a top-level JSON array");
  i++;
  const spans = [];
  skipWs();
  if (bytes[i] === 0x5d) return { spans, bytes };
  for (;;) {
    skipWs();
    const start = i;
    const first = bytes[i];
    if (first === 0x7b) {
      // object: scan to matching close brace, string-aware
      let depth = 0, inStr = false, esc = false;
      while (i < bytes.length) {
        const c = bytes[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === 0x5c) esc = true;
          else if (c === 0x22) inStr = false;
        } else {
          if (c === 0x22) inStr = true;
          else if (c === 0x7b) depth++;
          else if (c === 0x7d) { depth--; if (depth === 0) { i++; break; } }
        }
        i++;
      }
      if (depth !== 0) fail(where, "unbalanced object in bundle array");
    } else {
      fail(where, "bundle array elements must be objects");
    }
    spans.push({ start_byte: start, end_byte: i });
    skipWs();
    if (bytes[i] === 0x2c) { i++; continue; }
    if (bytes[i] === 0x5d) { i++; break; }
    fail(where, "expected ',' or ']' in bundle array");
  }
  skipWs();
  if (i !== bytes.length) fail(where, "trailing bytes after bundle array");
  return { spans, bytes };
}

/**
 * Validate ONE source entry's revisions without touching any other source.
 * Used after the read-grant check so denied/unselected source metadata
 * stays untouched (S653-006). Returns the normalized entry.
 *
 * S653-006 (fix round 2): every level (entry, revisions container, each
 * revision) must be on a plain prototype — inherited getters or inherited
 * data are refused structurally, before any property is read. All reads
 * use own data descriptors, never direct property access.
 *
 * S653-001 (fix round 2): each revision carries the host-declared
 * `coverage` contract — the report period this bundle's population is
 * registered to cover. Population completeness requires the task's report
 * interval to fall inside it; a caller-selected period cannot supply its
 * own coverage.
 *
 * S653-005 (fix round 2): revision metadata (label, blob, expected
 * counts, dataset identity, coverage) is charged once under the single
 * serialized representation. Revision TEXT is not charged here — the
 * selected revision's raw bytes are charged exactly once in
 * resolveSourceRef.
 */
export function validateSourceEntry(entry, key, where, budget) {
  const charge = (obj, w) => { if (budget) budget.chargeObjectOnce(obj, w); };
  assertNotProxy(entry, where);
  assertPlainPrototype(entry, where);
  charge(entry, where);
  if (!isPlainObject(entry)) fail(where, "source entry must be an object");
  assertNoAccessors(entry, where);
  exactKeys(entry, ["revisions"], where);
  const revsDesc = Object.getOwnPropertyDescriptor(entry, "revisions");
  if (!revsDesc || typeof revsDesc.get === "function" || typeof revsDesc.set === "function") {
    fail(where, "revisions must be an own data property; inherited accessors are not plain data; refusing");
  }
  const revs = revsDesc.value;
  assertNotProxy(revs, `${where}.revisions`);
  assertPlainPrototype(revs, `${where}.revisions`);
  charge(revs, `${where}.revisions`);
  if (!isPlainObject(revs)) fail(where, "revisions must be an object");
  assertNoAccessors(revs, `${where}.revisions`);
  const out = {};
  for (const commit of Object.keys(revs)) {
    if (!HEX40.test(commit)) fail(where, `revision key '${commit}' must be a 40-hex commit id`);
    const revDesc = Object.getOwnPropertyDescriptor(revs, commit);
    if (!revDesc || typeof revDesc.get === "function" || typeof revDesc.set === "function") {
      fail(where, `revision '${commit}' must be an own data property; inherited accessors are not plain data; refusing`);
    }
    const rev = revDesc.value;
    assertNotProxy(rev, `${where}@${commit}`);
    assertPlainPrototype(rev, `${where}@${commit}`);
    charge(rev, `${where}@${commit}`);
    // S653-005 (fix round 2): the commit key is byte-charged once, inside
    // the metadata serialization below — not separately.
    if (!isPlainObject(rev)) fail(where, `revision '${commit}' must be an object`);
    assertNoAccessors(rev, `${where}@${commit}`);
    exactKeys(rev, ["text", "blob", "label", "expected_records", "dataset_id", "dataset_version", "coverage"], `${where}@${commit}`);
    const textDesc = Object.getOwnPropertyDescriptor(rev, "text");
    if (!textDesc || typeof textDesc.get === "function" || typeof textDesc.set === "function") {
      fail(where, `revision '${commit}' text must be a plain data property`);
    }
    if (typeof textDesc.value !== "string") fail(where, `revision '${commit}' text must be a string`);
    if (typeof rev.blob !== "string" || !HEX40.test(rev.blob)) fail(where, `revision '${commit}' blob must be a 40-hex Git object ID`);
    if (typeof rev.label !== "string" || rev.label.length === 0) {
      fail(where, `revision '${commit}' must carry a registered label`);
    }
    if (rev.expected_records !== undefined) {
      if (!Number.isInteger(rev.expected_records) || rev.expected_records < 0) {
        fail(where, `revision '${commit}' expected_records must be a nonnegative integer`);
      }
    }
    // S653-001: host-registered dataset identity. Population completeness
    // declarations bind to this; caller claims alone never establish it.
    const dataset_id = reqStr(rev, "dataset_id", `${where}@${commit}`, { maxBytes: 128 });
    const dataset_version = reqStr(rev, "dataset_version", `${where}@${commit}`, { maxBytes: 128 });
    // S653-001 (fix round 2): host-declared coverage contract. Optional
    // in the schema (unknown coverage stays a soft "not complete" state,
    // not a structural refusal); when present it must be a valid
    // interval, non-inverted.
    let coverage = undefined;
    if (rev.coverage !== undefined) {
      const cov = rev.coverage;
      if (!isPlainObject(cov)) fail(`${where}@${commit}`, "coverage must be an object");
      assertPlainPrototype(cov, `${where}@${commit}.coverage`);
      assertNoAccessors(cov, `${where}@${commit}.coverage`);
      exactKeys(cov, ["interval_start", "interval_end"], `${where}@${commit}.coverage`);
      validateDate(cov.interval_start, `${where}@${commit}.coverage.interval_start`);
      validateDate(cov.interval_end, `${where}@${commit}.coverage.interval_end`);
      if (instantStartMs(cov.interval_start) > instantEndMs(cov.interval_end)) {
        fail(`${where}@${commit}`, "coverage interval is inverted; refusing");
      }
      coverage = { interval_start: cov.interval_start, interval_end: cov.interval_end };
    }
    if (budget) {
      budget.chargeSerialized(
        { commit, blob: rev.blob, label: rev.label, expected_records: rev.expected_records, dataset_id, dataset_version, coverage },
        `${where}@${commit} registered metadata`
      );
    }
    out[commit] = {
      text: textDesc.value, blob: rev.blob, label: rev.label,
      expected_records: rev.expected_records, dataset_id, dataset_version, coverage,
    };
  }
  return { revisions: out };
}

/**
 * Admit + validate the context CONTROL plane only: clock, readGrants,
 * principal, criteria, product_registry, test_hooks — and the sources
 * CONTAINER (charged, accessor-checked, but never walked into). Source
 * entries are admitted individually AFTER the grant check (S653-006).
 * Returns {clock, readGrants, principal, criteria, product_registry,
 * test_hooks, sources}.
 */
export function validateContextControl(context, budget) {
  if (!budget || typeof budget.chargeObjectOnce !== "function") fail("context", "internal: validateContextControl requires a live budget");
  const charge = (obj, what) => budget.chargeObjectOnce(obj, what);
  assertNotProxy(context, "context");
  charge(context, "context");
  if (!isPlainObject(context)) fail("context", "must be an object");
  assertNoAccessors(context, "context");
  exactKeys(context, ["clock", "sources", "readGrants", "principal", "criteria", "product_registry", "test_hooks"], "context");
  const clockDesc = Object.getOwnPropertyDescriptor(context, "clock");
  if (!clockDesc || typeof clockDesc.get === "function" || typeof clockDesc.set === "function") {
    fail("context", "clock must be an own data property; inherited accessors are not plain data; refusing");
  }
  const clock = clockDesc.value;
  if (!Number.isFinite(clock)) fail("context", "clock must be a finite number");

  // Sources container: charged and descriptor-checked, but NOT walked.
  // Entries are admitted per granted ref, after the grant check.
  const sourcesDesc = Object.getOwnPropertyDescriptor(context, "sources");
  if (!sourcesDesc || typeof sourcesDesc.get === "function" || typeof sourcesDesc.set === "function") {
    fail("context", "sources must be an own data property; refusing");
  }
  const sources = sourcesDesc.value;
  assertNotProxy(sources, "context.sources");
  // S653-006 (fix round 2): the sources container must be on a plain
  // prototype — an inherited getter behind it would execute on slot reads.
  assertPlainPrototype(sources, "context.sources");
  charge(sources, "context.sources");
  if (!isPlainObject(sources)) fail("context", "sources must be an object");
  assertNoAccessors(sources, "context.sources");
  const sourceKeys = Object.keys(sources);
  if (sourceKeys.length === 0 || sourceKeys.length > 64) fail("context", "sources must have 1..64 entries");

  if (!Array.isArray(context.readGrants)) fail("context", "readGrants must be an array");
  assertDenseArray(context.readGrants, "context.readGrants");
  charge(context.readGrants, "context.readGrants");
  const readGrants = [];
  for (let i = 0; i < context.readGrants.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(context.readGrants, i);
    if (!desc || typeof desc.get === "function" || typeof desc.set === "function") {
      fail("context", `readGrants[${i}] must be a plain data property; refusing`);
    }
    assertNotProxy(desc.value, `context.readGrants[${i}]`);
    charge(desc.value, `context.readGrants[${i}]`);
    readGrants.push(validateReadGrant(desc.value, `context.readGrants[${i}]`, budget));
  }

  charge(context.principal, "context.principal");
  assertNotProxy(context.principal, "context.principal");
  const principal = validatePrincipal(context.principal, "context.principal");
  charge(context.criteria, "context.criteria");
  assertNotProxy(context.criteria, "context.criteria");
  const criteria = validateCriteria(context.criteria, "context.criteria", budget);

  // Product registry: host-registered fixture product/benefit metadata.
  // Every entry is a consulted candidate, charged before its fields are read.
  const regIn = context.product_registry;
  assertNotProxy(regIn, "context.product_registry");
  if (!isPlainObject(regIn)) fail("context", "product_registry must be an object");
  charge(regIn, "context.product_registry");
  assertNoAccessors(regIn, "context.product_registry");
  const regKeys = Object.keys(regIn);
  if (regKeys.length > 256) fail("context", "product_registry must have at most 256 entries");
  const product_registry = {};
  for (const rk of regKeys) {
    if (!PRODUCT_ID_RE.test(rk)) fail("context", `invalid product registry key '${rk}'`);
    // S653-005 (fix round 2): registry keys are byte-charged once inside
    // the product_registry serialization (admitContextControlGraph) —
    // not separately here.
    const entry = regIn[rk];
    assertNotProxy(entry, `context.product_registry[${rk}]`);
    charge(entry, `context.product_registry[${rk}]`);
    product_registry[rk] = validateProductEntry(entry, `context.product_registry[${rk}]`, budget, criteria);
  }

  const test_hooks = validateTestHooks(context.test_hooks, "context.test_hooks", budget);

  return { clock, sources, readGrants, principal, criteria, product_registry, test_hooks };
}

/**
 * Full context validation (control plane + every source entry). Kept for
 * direct unit-test use; the run() path uses validateContextControl plus
 * per-granted-ref validateSourceEntry so denied sources stay untouched.
 */
export function validateContext(context, budget) {
  const c = validateContextControl(context, budget);
  const sources = {};
  for (const sk of Object.keys(c.sources)) {
    sources[sk] = validateSourceEntry(c.sources[sk], sk, `context.sources[${sk}]`, budget);
  }
  return { ...c, sources };
}

function validateProductEntry(value, where, budget, criteria) {
  if (!isPlainObject(value)) fail(where, "product entry must be an object");
  assertPlainPrototype(value, where);
  assertNoAccessors(value, where);
  exactKeys(value, ["product_id", "product_token", "benefit_tokens", "verified", "evidence"], where);
  if (budget) budget.chargeObjectOnce(value, where);
  const product_id = reqStr(value, "product_id", where);
  if (!PRODUCT_ID_RE.test(product_id)) fail(where, `invalid product_id '${product_id}'`);
  const product_token = reqStr(value, "product_token", where);
  if (!criteria.allowlisted_product_tokens.includes(product_token)) {
    fail(where, `product_token '${product_token}' is not allowlisted`);
  }
  const bt = value.benefit_tokens;
  if (!Array.isArray(bt) || bt.length === 0 || bt.length > 16) fail(where, "benefit_tokens must be a non-empty array of 1..16 tokens");
  assertDenseArray(bt, `${where}.benefit_tokens`);
  for (let i = 0; i < bt.length; i++) {
    if (typeof bt[i] !== "string" || !criteria.allowlisted_benefit_tokens.includes(bt[i])) {
      fail(where, `benefit_tokens[${i}] must be an allowlisted benefit token`);
    }
  }
  if (typeof value.verified !== "boolean") fail(where, "verified must be a boolean");
  // S653-002 (fix round 2): product/benefit evidence must be registered and
  // pinned, or explicitly typed UNAVAILABLE. Absent evidence is
  // conservative: UNAVAILABLE, and drafts are withheld until the host
  // supplies VERIFIED evidence. A bare "trusted context" literal is not
  // evidence.
  let evidence = { state: "UNAVAILABLE", detail: "host supplied no product evidence" };
  if (value.evidence !== undefined) {
    const ev = value.evidence;
    if (!isPlainObject(ev)) fail(where, "evidence must be an object");
    assertPlainPrototype(ev, `${where}.evidence`);
    assertNoAccessors(ev, `${where}.evidence`);
    exactKeys(ev, ["state", "detail"], `${where}.evidence`);
    if (ev.state !== "VERIFIED" && ev.state !== "UNAVAILABLE") {
      fail(where, "evidence.state must be 'VERIFIED' or 'UNAVAILABLE'");
    }
    const detail = reqStr(ev, "detail", `${where}.evidence`, { allowEmpty: true, maxBytes: 512 });
    evidence = { state: ev.state, detail };
  }
  return { product_id, product_token, benefit_tokens: [...bt], verified: value.verified, evidence };
}

/**
 * Host-only test hook for the public-output boundary test.
 */
function validateTestHooks(value, where, budget) {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) fail(where, "test_hooks must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["prefill_output_records"], where);
  if (budget) budget.chargeObjectOnce(value, where);
  const prefill = value.prefill_output_records === undefined ? 0 : value.prefill_output_records;
  if (!Number.isInteger(prefill) || prefill < 0 || prefill > 1024) {
    fail(where, "prefill_output_records must be an integer 0..1024");
  }
  return { prefill_output_records: prefill };
}

export function validateTask(task, budget = null) {
  const charge = (obj, what) => { if (budget) budget.chargeObjectOnce(obj, what); };
  if (!isPlainObject(task)) fail("task", "must be an object");
  charge(task, "task");
  assertNoAccessors(task, "task");
  exactKeys(task, ["schema_version", "task_id", "operation", "fixture_refs", "options", "population", "header_claims"], "task");
  if (task.schema_version !== "1") fail("task", "schema_version must be '1'");
  const task_id = reqStr(task, "task_id", "task", { maxBytes: 256 });
  if (task.operation !== REQUESTED_OPERATION_ALLOWED) fail("task", `operation must be '${REQUESTED_OPERATION_ALLOWED}'`);
  if (!Array.isArray(task.fixture_refs) || task.fixture_refs.length === 0 || task.fixture_refs.length > 8) {
    fail("task", "fixture_refs must be a non-empty array of 1..8 SourceRefs");
  }
  assertDenseArray(task.fixture_refs, "task.fixture_refs");
  const fixture_refs = [];
  for (let i = 0; i < task.fixture_refs.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(task.fixture_refs, i);
    if (!desc || typeof desc.get === "function" || typeof desc.set === "function") {
      fail("task", `fixture_refs[${i}] must be a plain data property; refusing`);
    }
    charge(desc.value, `task.fixture_refs[${i}]`);
    fixture_refs.push(validateSourceRef(desc.value, `task.fixture_refs[${i}]`));
  }
  const options = validateTaskOptions(task.options, "task.options", budget);
  // Population completeness declaration (optional).
  let population = undefined;
  if (task.population !== undefined) {
    if (!isPlainObject(task.population)) fail("task.population", "must be an object");
    charge(task.population, "task.population");
    assertNoAccessors(task.population, "task.population");
    exactKeys(task.population, ["declared_complete", "dataset_id", "dataset_version", "expected_lead_ids", "expected_count"], "task.population");
    if (typeof task.population.declared_complete !== "boolean") fail("task.population", "declared_complete must be a boolean");
    const dataset_id = reqStr(task.population, "dataset_id", "task.population");
    const dataset_version = reqStr(task.population, "dataset_version", "task.population");
    let expected_lead_ids = undefined;
    if (task.population.expected_lead_ids !== undefined) {
      if (!Array.isArray(task.population.expected_lead_ids)) fail("task.population", "expected_lead_ids must be an array");
      assertDenseArray(task.population.expected_lead_ids, "task.population.expected_lead_ids");
      // S653-005: primitive reference lists are consulted candidates too.
      // Bound the raw length first, then charge each entry; a 50,000-id
      // list trips BUDGET_EXCEEDED rather than reaching a population
      // verdict. No dedup refunds: each entry occurrence is charged.
      if (task.population.expected_lead_ids.length > 4096) {
        fail("task.population", "expected_lead_ids exceeds the 4096-entry reference-list bound; refusing");
      }
      expected_lead_ids = [];
      for (let i = 0; i < task.population.expected_lead_ids.length; i++) {
        if (budget) budget.countObject(`task.population.expected_lead_ids[${i}]`);
        const v = task.population.expected_lead_ids[i];
        if (typeof v !== "string" || !LEAD_ID_RE.test(v)) fail("task.population", `expected_lead_ids[${i}] invalid`);
        expected_lead_ids.push(v);
      }
    }
    let expected_count = undefined;
    if (task.population.expected_count !== undefined) {
      if (!Number.isInteger(task.population.expected_count) || task.population.expected_count < 0) {
        fail("task.population", "expected_count must be a nonnegative integer");
      }
      expected_count = task.population.expected_count;
    }
    population = { declared_complete: task.population.declared_complete, dataset_id, dataset_version, expected_lead_ids, expected_count };
  }
  // Header claims (optional): claimed pipeline totals to verify against recomputation.
  let header_claims = undefined;
  if (task.header_claims !== undefined) {
    if (!isPlainObject(task.header_claims)) fail("task.header_claims", "must be an object");
    charge(task.header_claims, "task.header_claims");
    assertNoAccessors(task.header_claims, "task.header_claims");
    exactKeys(task.header_claims, ["open_gross_minor", "currency", "report_interval_start", "report_interval_end"], "task.header_claims");
    if (typeof task.header_claims.open_gross_minor !== "string" || !/^-?\d{1,18}$/.test(task.header_claims.open_gross_minor)) {
      fail("task.header_claims", "open_gross_minor must be an integer-minor-units string");
    }
    const hc_currency = reqStr(task.header_claims, "currency", "task.header_claims");
    if (!CURRENCY_RE.test(hc_currency)) fail("task.header_claims", `currency must be a 3-letter ISO code`);
    validateDate(task.header_claims.report_interval_start, "task.header_claims.report_interval_start");
    validateDate(task.header_claims.report_interval_end, "task.header_claims.report_interval_end");
    header_claims = {
      open_gross_minor: task.header_claims.open_gross_minor,
      currency: hc_currency,
      report_interval_start: task.header_claims.report_interval_start,
      report_interval_end: task.header_claims.report_interval_end,
    };
  }
  return { schema_version: "1", task_id, operation: "analyze", fixture_refs, options, population, header_claims };
}

function validateTaskOptions(value, where, budget) {
  if (!isPlainObject(value)) fail(where, "options must be an object");
  if (budget) budget.chargeObjectOnce(value, where);
  assertNoAccessors(value, where);
  exactKeys(value, ["include_drafts", "report_interval_start", "report_interval_end", "as_of"], where);
  if (typeof value.include_drafts !== "boolean") fail(where, "include_drafts must be a boolean");
  validateDate(value.report_interval_start, `${where}.report_interval_start`);
  validateDate(value.report_interval_end, `${where}.report_interval_end`);
  validateDate(value.as_of, `${where}.as_of`);
  // S653-003: a reversed report interval is a structural error, not an
  // empty result. Civil-date endpoints compare under the documented
  // inclusive civil-date treatment.
  if (instantStartMs(value.report_interval_start) > instantEndMs(value.report_interval_end)) {
    fail(where, "report_interval_start is after report_interval_end; refusing");
  }
  return {
    include_drafts: value.include_drafts,
    report_interval_start: value.report_interval_start,
    report_interval_end: value.report_interval_end,
    as_of: value.as_of,
  };
}

export { FITS, STAGES };
