/**
 * schemas.js — runtime validation for the Research Training Agent
 * prototype. Strict: rejects unknown properties in control-bearing
 * objects, absent required fields, wrong types, invalid enum values,
 * duplicate IDs, nonfinite numbers, invalid dates. Pure Node 24 ESM,
 * zero dependencies.
 *
 * validateGrantGateContext() treats the injected trusted context as a
 * CANDIDATE POPULATION: every source map entry key, every read grant,
 * the principal, the alias table, the criteria (incl. the host-pinned
 * template registry) and every provenance entry are object-charged
 * BEFORE any of their fields are read. validateSelectedSourceEntry()
 * admits post-grant source data. `budget` is REQUIRED.
 */

import { HEX40, HEX64, isRealDate, isRealInstant } from "./canonical.js";
import { types } from "node:util";

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
export const REQUESTED_OPERATION_ALLOWED = "analyze";
export const PRINCIPAL_ROLES = ["JASON", "MUSE_RELAY"];
export const QUESTION_FORMATS = ["short_answer", "multiple_choice"];
export const POLARITIES = ["positive", "negative"];
export const MAX_ASSERTIONS = 256;
export const MAX_SOURCE_REFS = 64;
export const MAX_TOPICS = 64;
const BUDGET_SPAN_CAP = 512;

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

/** Real calendar date (YYYY-MM-DD) or full UTC instant. Returns the string. */
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
 * Trap-free native Proxy detection sweep (types.isProxy is a native V8
 * map check — zero traps). Refuses with SchemaError (INVALID_INPUT at
 * the run boundary), never by invoking traps. Cycle-safe (WeakSet),
 * depth-bounded at 32.
 */
export function assertNoNativeProxies(value, where, maxDepth = 32) {
  const seen = new WeakSet();
  const walk = (v, path, depth) => {
    if (v === null || typeof v !== "object") return;
    if (types.isProxy(v)) {
      fail(where, `native Proxy at '${path}' is not plain data; refusing without invoking its traps`);
    }
    if (seen.has(v)) return;
    seen.add(v);
    if (depth > maxDepth) {
      fail(where, `object graph exceeds max depth ${maxDepth} at '${path}'; refusing`);
    }
    for (const k of Object.getOwnPropertyNames(v)) {
      const desc = Object.getOwnPropertyDescriptor(v, k);
      if (!desc) continue;
      if (typeof desc.get === "function" || typeof desc.set === "function") {
        fail(where, `accessor property '${path}.${k}' is not plain data; refusing`);
      }
      walk(desc.value, `${path}.${String(k)}`, depth + 1);
    }
    for (const s of Object.getOwnPropertySymbols(v)) {
      fail(where, `symbol-keyed property '${path}.${String(s)}' is not plain data; refusing`);
    }
  };
  walk(value, where, 0);
}

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
 * PER-008 round 2: common charged own-data admission primitive for
 * every consulted host object/array. Order is load-bearing:
 *
 *   (a) reject native Proxies BEFORE any reflective operation —
 *       types.isProxy is a native V8 map check, zero traps fire;
 *   (b) charge the object BEFORE inspecting its prototype or any
 *       descriptor, so candidate #65 refuses with BUDGET_EXCEEDED
 *       without touching that candidate;
 *   (c) reject unsupported prototypes — only Object.prototype,
 *       Array.prototype (for arrays) and null are plain data; fields
 *       inherited from a custom prototype are never read as
 *       authority data;
 *   (d) require OWN data descriptors for control fields before
 *       reading them (see ownData()/ownDataOpt()) — an inherited
 *       getter never fires, and inherited data never establishes a
 *       control field.
 *
 * Applies to nested arrays/maps and provenance link/pin records, not
 * just subtree roots — the containing array itself is admitted, since
 * a forwarding Proxy around a valid applies_to array ran traps under
 * the old per-element checks. Replaces the ad hoc rejectHostProxy +
 * manual check sequences. Refusal convention: INVALID_INPUT via
 * SchemaError (mapped at the run boundary).
 */
export function admitHostObject(value, where, budget, { array = false } = {}) {
  if (!budget || typeof budget.chargeObjectOnce !== "function") {
    fail(where, "internal: admitHostObject requires a live budget");
  }
  // (a) trap-free native-Proxy rejection BEFORE any reflective
  // operation on the value — including Array.isArray below.
  if (types.isProxy(value)) {
    fail(where, `native Proxy at '${where}' is not plain data; refusing without invoking its traps`);
  }
  if (value === null || typeof value !== "object") fail(where, "must be an object");
  if (array && !Array.isArray(value)) fail(where, "must be an array");
  if (!array && Array.isArray(value)) fail(where, "must be a non-array object");
  // (b) charge BEFORE inspecting the prototype or any descriptor.
  budget.chargeObjectOnce(value, where);
  // (c) prototype check — the same rule as the task-side admitGraph.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) {
    fail(where, `unsupported prototype at '${where}'; inherited controls are not plain data; refusing`);
  }
  // (d) own accessors/symbol keys rejected here; control fields are
  // read only through ownData()/ownDataOpt() below.
  assertNoAccessors(value, where);
  for (const s of Object.getOwnPropertySymbols(value)) {
    fail(where, `symbol-keyed property '${where}.${String(s)}' is not plain data; refusing`);
  }
  return value;
}

/**
 * PER-008 round 2: read a REQUIRED control field as an own data
 * descriptor. Inherited getters — and inherited data — never
 * establish authority fields. Zero getter invocations; the
 * descriptor lookup itself never fires accessors.
 */
export function ownData(obj, key, where) {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (!desc || typeof desc.get === "function" || typeof desc.set === "function") {
    fail(where, `'${key}' must be an own data property; inherited controls are not plain data; refusing`);
  }
  return desc.value;
}

/**
 * PER-008 round 2: read an OPTIONAL control field as an own data
 * descriptor. Absent (no own descriptor) reads as undefined without
 * consulting the prototype chain; a present accessor still refuses.
 */
function ownDataOpt(obj, key, where) {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (desc === undefined) return undefined;
  if (typeof desc.get === "function" || typeof desc.set === "function") {
    fail(where, `'${key}' must be an own data property; inherited controls are not plain data; refusing`);
  }
  return desc.value;
}

/** Own-data variants of reqStr/reqInt for host control fields. The
 *  shared reqStr/reqInt (dot-read) stay for the task validators,
 *  whose admitGraph already rejects custom prototypes. */
function reqOwnStr(obj, key, where, { allowEmpty = false, maxBytes = null } = {}) {
  const v = ownData(obj, key, where);
  if (typeof v !== "string" || (!allowEmpty && v.length === 0)) fail(where, `'${key}' must be a non-empty string`);
  if (maxBytes !== null && Buffer.byteLength(v, "utf8") > maxBytes) fail(where, `'${key}' exceeds ${maxBytes} bytes`);
  return v;
}

function reqOwnInt(obj, key, where, { min = null, max = null } = {}) {
  const v = ownData(obj, key, where);
  if (!Number.isInteger(v)) fail(where, `'${key}' must be an integer`);
  if (min !== null && v < min) fail(where, `'${key}' must be >= ${min}`);
  if (max !== null && v > max) fail(where, `'${key}' must be <= ${max}`);
  return v;
}

/**
 * Budget-integrated descriptor-safe admission. Charges each distinct
 * object BEFORE any descriptor field is examined; candidate #65
 * refuses without touching that candidate. Rejects accessors,
 * functions, symbols, unsupported prototypes, graphs deeper than 32.
 */
export function admitGraph(value, where, budget, maxDepth = 32) {
  if (!budget || typeof budget.chargeObjectOnce !== "function") {
    fail(where, "internal: admitGraph requires a live budget");
  }
  const seen = new WeakSet();
  const walk = (v, path, depth) => {
    if (v === null || typeof v !== "object") return;
    if (types.isProxy(v)) {
      fail(where, `native Proxy at '${path}' is not plain data; refusing without invoking its traps`);
    }
    if (depth > maxDepth) {
      fail(where, `object graph exceeds max depth ${maxDepth} at '${path}'; refusing`);
    }
    if (seen.has(v)) return;
    seen.add(v);
    budget.chargeObjectOnce(v, path);
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) {
      fail(where, `unsupported prototype at '${path}'; inherited controls are not plain data; refusing`);
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
export function validateSourceRef(value, where, budget = null) {
  // PER-008 round 2: charged own-data admission. The budget-less path
  // (task-side pins already charged by the task admitGraph, and the
  // resolver's countObject) gets the same trap-free, prototype and
  // own-data discipline without a second charge.
  if (budget) {
    admitHostObject(value, where, budget);
  } else {
    if (types.isProxy(value)) {
      fail(where, `native Proxy at '${where}' is not plain data; refusing without invoking its traps`);
    }
    if (!isPlainObject(value)) fail(where, "SourceRef must be an object");
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      fail(where, `unsupported prototype at '${where}'; inherited controls are not plain data; refusing`);
    }
    assertNoAccessors(value, where);
  }
  exactKeys(value, ["repo", "path", "commit", "blob", "algorithm", "revision"], where);
  const repo = reqOwnStr(value, "repo", where);
  if (!REPO_RE.test(repo)) fail(where, `invalid repo '${repo}'`);
  const path = reqOwnStr(value, "path", where);
  if (!PATH_RE.test(path)) fail(where, `invalid path '${path}'`);
  const commit = reqOwnStr(value, "commit", where);
  if (!HEX40.test(commit)) fail(where, "commit must be a full 40-hex Git object ID");
  const blob = reqOwnStr(value, "blob", where);
  if (!HEX40.test(blob)) fail(where, "blob must be a full 40-hex Git object ID");
  if (ownData(value, "algorithm", where) !== "git-sha1") fail(where, "algorithm must be 'git-sha1'");
  const revision = reqOwnStr(value, "revision", where);
  return { repo, path, commit, blob, algorithm: "git-sha1", revision };
}

/** Exact equality of two validated SourceRefs (all six fields). */
export function sourceRefEquals(a, b) {
  return (
    a && b &&
    a.repo === b.repo && a.path === b.path && a.commit === b.commit &&
    a.blob === b.blob && a.algorithm === b.algorithm && a.revision === b.revision
  );
}

export function validatePrincipal(value, where, budget) {
  // PER-008 round 2: charged own-data admission — an inherited
  // principal_id getter (custom prototype) refuses here with zero
  // getter calls, before any control field is read.
  admitHostObject(value, where, budget);
  exactKeys(value, ["principal_id", "role", "registered_by", "valid_from", "expires_at", "revoked"], where);
  const pid = reqOwnStr(value, "principal_id", where);
  if (!RECORD_ID_RE.test(pid)) fail(where, `invalid principal_id '${pid}'`);
  if (!PRINCIPAL_ROLES.includes(ownData(value, "role", where))) fail(where, `role must be one of ${PRINCIPAL_ROLES.join(", ")}`);
  const registered_by = reqOwnStr(value, "registered_by", where);
  if (registered_by !== "jason") fail(where, "registered_by must be 'jason'");
  validateDate(ownData(value, "valid_from", where), `${where}.valid_from`);
  validateDate(ownData(value, "expires_at", where), `${where}.expires_at`);
  if (typeof ownData(value, "revoked", where) !== "boolean") fail(where, "revoked must be a boolean");
  return { principal_id: pid, role: ownData(value, "role", where), registered_by, valid_from: ownData(value, "valid_from", where), expires_at: ownData(value, "expires_at", where), revoked: ownData(value, "revoked", where) };
}

export function validateReadGrant(value, where, budget) {
  // PER-008 round 2: charged own-data admission.
  admitHostObject(value, where, budget);
  exactKeys(value, ["repo", "path"], where);
  const repo = reqOwnStr(value, "repo", where);
  if (!REPO_RE.test(repo)) fail(where, `invalid repo '${repo}'`);
  const path = reqOwnStr(value, "path", where);
  if (!PATH_RE.test(path)) fail(where, `invalid path '${path}'`);
  if (budget) budget.countSerialized({ repo, path }, `${where} grant`);
  return { repo, path };
}

/**
 * Immutable principal/alias table: maps an alias or principal id to its
 * canonical principal id. Host-injected; bounded at 256 entries.
 */
export function validateAliases(value, where, budget) {
  if (!budget || typeof budget.countObject !== "function") fail(where, "internal: validateAliases requires a live budget");
  // PER-008 round 2: charged own-data admission for the alias map.
  admitHostObject(value, where, budget);
  const keys = Object.keys(value);
  if (keys.length > 256) fail(where, "aliases must have at most 256 entries");
  const out = {};
  for (const k of keys) {
    if (!RECORD_ID_RE.test(k)) fail(where, `invalid alias key '${k}'`);
    const v = ownData(value, k, where);
    if (typeof v !== "string" || !RECORD_ID_RE.test(v)) fail(where, `invalid canonical id for alias '${k}'`);
    // PER-009: charge the consulted alias record in serialized form
    // before it is copied into the validated context.
    budget.countSerialized({ alias: k, canonical: v }, `${where} alias record`);
    out[k] = v;
  }
  return out;
}

/**
 * Host-pinned template registry: maps a topic predicate to a question
 * form and a lesson heading. Host-injected only — the task can never
 * supply or override templates. Closed per-entry schema.
 */
export function validateCriteria(value, where, budget) {
  if (!budget || typeof budget.chargeObjectOnce !== "function") fail(where, "internal: validateCriteria requires a live budget");
  // PER-008 round 2: charged own-data admission for the criteria
  // container.
  admitHostObject(value, where, budget);
  exactKeys(value, ["criteria_version", "templates"], where);
  const criteria_version = reqOwnStr(value, "criteria_version", where);
  if (!SLUG_RE.test(criteria_version)) fail(where, `invalid criteria_version '${criteria_version}'`);
  // PER-009: the consulted criteria container header is charged in
  // serialized form before the templates are used or copied.
  budget.countSerialized({ criteria_version }, `${where} container`);
  // PER-008 round 2: the templates map is a nested consulted
  // container — admitted (charged) before any of its entries is
  // read, so a Proxy templates map refuses with zero traps.
  const templatesIn = admitHostObject(ownData(value, "templates", "criteria"), "criteria.templates", budget);
  const predKeys = Object.keys(templatesIn);
  if (predKeys.length > 256) fail(where, "criteria.templates must have at most 256 entries");
  const templates = {};
  for (const pred of predKeys) {
    // PER-009: bound the template key shape BEFORE the key is used in
    // any label or charged record — a 300,000-character key is refused
    // here without ever entering budget labels.
    if (Buffer.byteLength(pred, "utf8") > 256) fail("criteria.templates", "template key exceeds 256 bytes");
    // PER-008 round 2: each template entry is a consulted host object
    // — admitted (Proxy-checked, charged, prototype-checked) before
    // its descriptors are inspected.
    const t = admitHostObject(ownData(templatesIn, pred, "criteria.templates"), `criteria.templates[${pred}]`, budget);
    const tw = `criteria.templates[${pred}]`;
    exactKeys(t, ["question_form", "lesson_heading"], tw);
    const question_form = reqOwnStr(t, "question_form", tw, { maxBytes: 1024 });
    const lesson_heading = reqOwnStr(t, "lesson_heading", tw, { maxBytes: 1024 });
    // PER-009: charge the complete serialized record (key, structure,
    // escaping, values) before it is consulted or copied, so the
    // template registry can no longer ride the 256-KiB input contract
    // uncharged.
    budget.countSerialized({ predicate: pred, question_form, lesson_heading }, `${tw} record`);
    templates[pred] = { question_form, lesson_heading };
  }
  return { criteria_version, templates };
}

/**
 * Host provenance declarations, keyed by source key ("repo|path"):
 * {group, copied_from, applies_to?} — group is the fixture provenance
 * group; copied_from names the source key this source is a known copy
 * of (null when it is an original). Host-injected; a task can never
 * declare or alter provenance.
 *
 * PER-003 (closed schema, round 2): applies_to is syntactically
 * optional at this schema layer — absence is NOT a schema refusal —
 * but semantically an entry binds NOTHING when applies_to is
 * omitted. A declaration corroborates ONLY a consumed ref exactly
 * equal (all six fields) to a listed one; a changed pin
 * (commit/blob/revision), an absent list, or a list that does not
 * name the consumed pin makes the declaration inapplicable and the
 * source's provenance unknown for corroboration (attributed-only,
 * with a PROVENANCE_UNBOUND diagnostic). There is no key-bound
 * shorthand fallback.
 */
export function validateProvenance(value, where, budget) {
  if (!budget || typeof budget.chargeObjectOnce !== "function") fail(where, "internal: validateProvenance requires a live budget");
  // PER-008 round 2: charged own-data admission for the provenance
  // container.
  admitHostObject(value, where, budget);
  exactKeys(value, ["sources"], where);
  // PER-008 round 2: the sources map is a nested consulted container
  // — admitted (charged) before any entry is read.
  const srcIn = admitHostObject(ownData(value, "sources", "provenance"), "provenance.sources", budget);
  const keys = Object.keys(srcIn);
  if (keys.length > 64) fail(where, "provenance.sources must have at most 64 entries");
  const sources = {};
  for (const k of keys) {
    // PER-009: bound the provenance source-key shape BEFORE the key
    // is used in any label or charged record.
    if (Buffer.byteLength(k, "utf8") > 256) fail("provenance.sources", "provenance source key exceeds 256 bytes");
    // PER-008 round 2: each entry is a consulted host object —
    // admitted (Proxy-checked, charged, prototype-checked) before
    // its descriptors are inspected.
    const entry = admitHostObject(ownData(srcIn, k, "provenance.sources"), `provenance.sources[${k}]`, budget);
    const w = `provenance.sources[${k}]`;
    exactKeys(entry, ["group", "copied_from", "applies_to"], w);
    const group = reqOwnStr(entry, "group", w, { maxBytes: 128 });
    if (!SLUG_RE.test(group)) fail(w, `invalid provenance group '${group}'`);
    let copied_from = null;
    const copiedRaw = ownDataOpt(entry, "copied_from", w);
    if (copiedRaw !== null && copiedRaw !== undefined) {
      if (typeof copiedRaw !== "string" || copiedRaw.length === 0) {
        fail(w, "copied_from must be null or a non-empty source key");
      }
      copied_from = copiedRaw;
    }
    const out = { group, copied_from };
    const appliesRaw = ownDataOpt(entry, "applies_to", w);
    if (appliesRaw !== undefined) {
      // PER-008 round 2: the containing array itself is admitted
      // BEFORE any reflective operation on it (Array.isArray,
      // .length, getOwnPropertyDescriptor all fire traps on a
      // Proxy). A forwarding Proxy around a valid applies_to array
      // refuses here with ZERO traps.
      const appliesIn = admitHostObject(appliesRaw, `${w}.applies_to`, budget, { array: true });
      assertDenseArray(appliesIn, `${w}.applies_to`);
      if (appliesIn.length > 64) fail(w, "applies_to must have at most 64 entries");
      const refs = [];
      for (let i = 0; i < appliesIn.length; i++) {
        // Each pin record is a consulted host object — validated
        // (admitted, charged, own-data) before its fields are read.
        refs.push(validateSourceRef(ownData(appliesIn, i, `${w}.applies_to`), `${w}.applies_to[${i}]`, budget));
      }
      out.applies_to = refs;
    }
    // PER-009: charge the complete serialized record (key, structure,
    // escaping, metadata) before it is consulted or copied, so
    // provenance metadata can no longer ride the 256-KiB input
    // contract uncharged.
    budget.countSerialized(
      { source_key: k, group, copied_from, applies_to: out.applies_to ?? null },
      `${w} record`
    );
    sources[k] = out;
  }
  return { sources };
}

/**
 * Host-only test hooks (same sanctioned pattern as the validation
 * prototype's): inert in production, shift internal counters for exact
 * boundary tests through real runs.
 */
export function validateTestHooks(value, where, budget) {
  if (value === undefined) return undefined;
  // PER-008 round 2: charged own-data admission (admitHostObject
  // charges; the old explicit chargeObjectOnce is subsumed).
  admitHostObject(value, where, budget);
  exactKeys(value, ["prefill_output_records", "prefill_spans"], where);
  const out = {};
  const prefill = ownDataOpt(value, "prefill_output_records", where) ?? 0;
  if (!Number.isInteger(prefill) || prefill < 0 || prefill > 1024) {
    fail(where, "prefill_output_records must be an integer 0..1024");
  }
  out.prefill_output_records = prefill;
  const spans = ownDataOpt(value, "prefill_spans", where) ?? 0;
  if (!Number.isInteger(spans) || spans < 0 || spans > BUDGET_SPAN_CAP) {
    fail(where, `prefill_spans must be an integer 0..${BUDGET_SPAN_CAP}`);
  }
  out.prefill_spans = spans;
  return out;
}

/**
 * Grant-gate context validation. Inspects ONLY bounded
 * grant/principal/control metadata: the clock, the sources MAP (key
 * set and count — never entry contents), read grants, principal, alias
 * table, criteria/templates and provenance declarations. Source
 * revision metadata and payload bytes are NOT touched here; they are
 * admitted only after an exact read grant succeeds
 * (validateSelectedSourceEntry). A caller-supplied provenance/template
 * control inside the task is rejected at the task boundary.
 */
export function validateGrantGateContext(context, budget) {
  if (!budget || typeof budget.chargeObjectOnce !== "function") fail("context", "internal: validateGrantGateContext requires a live budget");
  // PER-008 round 2: charged own-data admission for the context root
  // — Proxy rejected trap-free before any reflective operation,
  // charged before descriptor/prototype inspection, custom
  // prototypes rejected.
  admitHostObject(context, "context", budget);
  const charge = (obj, what) => budget.chargeObjectOnce(obj, what);
  exactKeys(context, ["clock", "sources", "readGrants", "principal", "aliases", "criteria", "provenance", "test_hooks"], "context");
  const clockDesc = Object.getOwnPropertyDescriptor(context, "clock");
  if (!clockDesc || typeof clockDesc.get === "function" || typeof clockDesc.set === "function") {
    fail("context", "clock must be an own data property; inherited accessors are not plain data; refusing");
  }
  const clock = clockDesc.value;
  if (!Number.isFinite(clock)) fail("context", "clock must be a finite number");

  // PER-008 round 2: the old uncharged assertNoNativeProxies sweeps
  // are gone. Each consulted host subtree root is admitted below
  // (Proxy-checked trap-free, charged, prototype-checked) BEFORE any
  // reflective operation on it; every deeper object is admitted
  // inside its charged validator, which charges each object BEFORE
  // inspecting its descriptors. Candidate #65 refuses before its
  // descriptors are touched; a Proxy still refuses immediately with
  // INVALID_INPUT and zero trap executions.
  const readGrantsIn = admitHostObject(ownData(context, "readGrants", "context"), "context.readGrants", budget, { array: true });
  const principalIn = admitHostObject(ownData(context, "principal", "context"), "context.principal", budget);
  const aliasesIn = admitHostObject(ownData(context, "aliases", "context"), "context.aliases", budget);
  const criteriaIn = admitHostObject(ownData(context, "criteria", "context"), "context.criteria", budget);
  const provenanceIn = admitHostObject(ownData(context, "provenance", "context"), "context.provenance", budget);
  const testHooksRaw = ownDataOpt(context, "test_hooks", "context");
  if (testHooksRaw !== undefined) {
    admitHostObject(testHooksRaw, "context.test_hooks", budget);
  }

  // Sources map: key set only, admitted as a nested container.
  // Entries are NOT read here — a denied source's revision metadata
  // and payload stay untouched until the grant check passes.
  const sourcesIn = admitHostObject(ownData(context, "sources", "context"), "context.sources", budget);
  const sourceKeys = Object.keys(sourcesIn);
  if (sourceKeys.length > 64) fail("context", "sources must have at most 64 entries");
  budget.countSerialized(sourceKeys, "context.sources keys");

  assertDenseArray(readGrantsIn, "context.readGrants");
  const readGrants = [];
  for (let i = 0; i < readGrantsIn.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(readGrantsIn, i);
    if (!desc || typeof desc.get === "function" || typeof desc.set === "function") {
      fail("context", `readGrants[${i}] must be a plain data property; refusing`);
    }
    charge(desc.value, `context.readGrants[${i}]`);
    readGrants.push(validateReadGrant(desc.value, `context.readGrants[${i}]`, budget));
  }

  charge(principalIn, "context.principal");
  const principal = validatePrincipal(principalIn, "context.principal", budget);
  // PER-009: the consulted principal record is charged in serialized
  // form (its schema-bounded fields) before it is used.
  budget.countSerialized(principal, "context.principal record");
  charge(aliasesIn, "context.aliases");
  const aliases = validateAliases(aliasesIn, "context.aliases", budget);
  charge(criteriaIn, "context.criteria");
  const criteria = validateCriteria(criteriaIn, "context.criteria", budget);
  charge(provenanceIn, "context.provenance");
  const provenance = validateProvenance(provenanceIn, "context.provenance", budget);
  const test_hooks = validateTestHooks(testHooksRaw, "context.test_hooks", budget);

  return { clock, sourceKeys, readGrants, principal, aliases, criteria, provenance, test_hooks };
}

function validateSourceEntry(sources, sk, budget) {
  // PER-008 round 2: the entry is read as an own data descriptor of
  // the admitted sources map (never via the prototype chain), then
  // admitted itself — an inherited-revisions getter on a custom
  // prototype refuses here with zero getter calls.
  const entry = admitHostObject(ownData(sources, sk, "context.sources"), `context.sources[${sk}]`, budget);
  const revs = admitHostObject(ownData(entry, "revisions", `context.sources[${sk}]`), `context.sources[${sk}].revisions`, budget);
  for (const commit of Object.keys(revs)) {
    const revW = `context.sources[${sk}]@${commit}`;
    const rev = admitHostObject(ownData(revs, commit, `context.sources[${sk}].revisions`), revW, budget);
    exactKeys(rev, ["text", "blob", "label", "expected_records"], revW);
    const textDesc = Object.getOwnPropertyDescriptor(rev, "text");
    if (!textDesc || typeof textDesc.get === "function" || typeof textDesc.set === "function") {
      fail("context", `source '${sk}' revision '${commit}' text must be a plain data property`);
    }
    if (typeof textDesc.value !== "string") fail("context", `source '${sk}' revision '${commit}' text must be a string`);
    const blob = ownData(rev, "blob", revW);
    if (typeof blob !== "string" || !HEX40.test(blob)) fail("context", `source '${sk}' revision '${commit}' blob must be a 40-hex Git object ID`);
    const label = ownData(rev, "label", revW);
    if (typeof label !== "string" || label.length === 0) {
      fail("context", `source '${sk}' revision '${commit}' must carry a registered label`);
    }
    const expectedRecords = ownDataOpt(rev, "expected_records", revW);
    if (expectedRecords !== undefined) {
      if (!Number.isInteger(expectedRecords) || expectedRecords < 0) {
        fail("context", `source '${sk}' revision '${commit}' expected_records must be a nonnegative integer`);
      }
    }
    budget.countSerialized(
      { commit, blob, label, expected_records: expectedRecords ?? null },
      `context.sources[${sk}]@${commit} metadata`
    );
  }
}

export function validateSelectedSourceEntry(context, budget, selectedKey) {
  if (!budget || typeof budget.chargeObjectOnce !== "function") fail("context", "internal: validateSelectedSourceEntry requires a live budget");
  if (typeof selectedKey !== "string" || !Object.prototype.hasOwnProperty.call(context.sources, selectedKey)) {
    fail("context", `selected source '${String(selectedKey).slice(0, 80)}' is not a registered source key`);
  }
  validateSourceEntry(context.sources, selectedKey, budget);
  return ownData(context.sources, selectedKey, "context.sources");
}

/** One requested topic. Closed schema. */
export function validateTopic(value, where, budget = null) {
  const charge = (obj, what) => { if (budget) budget.chargeObjectOnce(obj, what); };
  if (!isPlainObject(value)) fail(where, "topic must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["topic_id", "predicates"], where);
  const topic_id = reqStr(value, "topic_id", where);
  if (!SLUG_RE.test(topic_id)) fail(where, `invalid topic_id '${topic_id}'`);
  if (!Array.isArray(value.predicates)) fail(where, "predicates must be an array");
  assertDenseArray(value.predicates, `${where}.predicates`);
  if (value.predicates.length > 64) fail(where, "predicates must have at most 64 entries");
  const predicates = [];
  for (const p of value.predicates) {
    if (typeof p !== "string" || p.length === 0 || Buffer.byteLength(p, "utf8") > 256) {
      fail(where, "predicate entries must be non-empty strings of at most 256 bytes");
    }
    predicates.push(p);
  }
  return { topic_id, predicates };
}

/**
 * One structured fixture assertion. The controlled grammar tokens
 * (subject, predicate, value, scope) are UTF-8 literal tokens; the
 * span's quoted_text must be the passage's exact grammar line. Closed
 * schema — an assertion can never carry control fields.
 */
export function validateAssertion(value, where, budget = null) {
  const charge = (obj, what) => { if (budget) budget.chargeObjectOnce(obj, what); };
  if (!isPlainObject(value)) fail(where, "assertion must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, [
    "assertion_id", "subject", "predicate", "value", "scope",
    "polarity", "passage_id", "span", "source_index",
  ], where);
  const assertion_id = reqStr(value, "assertion_id", where);
  if (!RECORD_ID_RE.test(assertion_id)) fail(where, `invalid assertion_id '${assertion_id}'`);
  const subject = reqStr(value, "subject", where, { maxBytes: 1024 });
  const predicate = reqStr(value, "predicate", where, { maxBytes: 1024 });
  const val = reqStr(value, "value", where, { maxBytes: 1024 });
  const scope = reqStr(value, "scope", where, { maxBytes: 1024 });
  for (const [name, tok] of [["subject", subject], ["predicate", predicate], ["value", val], ["scope", scope]]) {
    if (tok.includes("|")) fail(where, `'${name}' must not contain the grammar separator '|'`);
  }
  const polarity = reqStr(value, "polarity", where);
  if (!POLARITIES.includes(polarity)) fail(where, `polarity must be one of ${POLARITIES.join(", ")}`);
  const passage_id = reqStr(value, "passage_id", where);
  if (!RECORD_ID_RE.test(passage_id)) fail(where, `invalid passage_id '${passage_id}'`);
  const source_index = reqInt(value, "source_index", where, { min: 0, max: MAX_SOURCE_REFS - 1 });
  const spanIn = value.span;
  const sw = `${where}.span`;
  if (!isPlainObject(spanIn)) fail(sw, "span must be an object");
  charge(spanIn, sw);
  assertNoAccessors(spanIn, sw);
  exactKeys(spanIn, ["start_byte", "end_byte", "quoted_text"], sw);
  const start_byte = reqInt(spanIn, "start_byte", sw, { min: 0 });
  const end_byte = reqInt(spanIn, "end_byte", sw, { min: 0 });
  if (end_byte <= start_byte) fail(sw, "end_byte must exceed start_byte");
  const quoted_text = reqStr(spanIn, "quoted_text", sw, { maxBytes: 8192 });
  return {
    assertion_id, subject, predicate, value: val, scope, polarity,
    passage_id, source_index,
    span: { start_byte, end_byte, quoted_text },
  };
}

/** One task-proposed answer-key claim. A claim, never the key. */
export function validateProposedKey(value, where, budget = null) {
  const charge = (obj, what) => { if (budget) budget.chargeObjectOnce(obj, what); };
  if (!isPlainObject(value)) fail(where, "proposed key must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["assertion_id", "proposed_value"], where);
  const assertion_id = reqStr(value, "assertion_id", where);
  if (!RECORD_ID_RE.test(assertion_id)) fail(where, `invalid assertion_id '${assertion_id}'`);
  const proposed_value = reqStr(value, "proposed_value", where, { maxBytes: 1024 });
  return { assertion_id, proposed_value };
}

/** One explicit multi-passage composite request {item_id, atom_refs:[a,b]}. */
export function validateCompositeRequest(value, where, budget = null) {
  const charge = (obj, what) => { if (budget) budget.chargeObjectOnce(obj, what); };
  if (!isPlainObject(value)) fail(where, "composite request must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["item_id", "atom_refs"], where);
  const item_id = reqStr(value, "item_id", where);
  if (!RECORD_ID_RE.test(item_id)) fail(where, `invalid item_id '${item_id}'`);
  if (!Array.isArray(value.atom_refs)) fail(where, "atom_refs must be an array");
  assertDenseArray(value.atom_refs, `${where}.atom_refs`);
  if (value.atom_refs.length !== 2) fail(where, "atom_refs must contain exactly two atom references");
  const atom_refs = [];
  for (const a of value.atom_refs) {
    if (typeof a !== "string" || !RECORD_ID_RE.test(a)) fail(where, `invalid atom ref '${String(a).slice(0, 80)}'`);
    atom_refs.push(a);
  }
  if (atom_refs[0] === atom_refs[1]) fail(where, "atom_refs must be two DISTINCT atoms");
  return { item_id, atom_refs };
}

/**
 * The training request (options.request). Closed agent-specific schema
 * — not executable policy. Caller-supplied provenance/template control
 * fields are rejected as INVALID_INPUT.
 */
export function validateRequest(value, where, budget = null) {
  const charge = (obj, what) => { if (budget) budget.chargeObjectOnce(obj, what); };
  if (!isPlainObject(value)) fail(where, "request must be an object");
  assertNoAccessors(value, where);
  for (const bad of ["templates", "provenance", "status", "research_status", "verified_by"]) {
    if (Object.prototype.hasOwnProperty.call(value, bad)) {
      fail(where, `caller-supplied control field '${bad}' is rejected as INVALID_INPUT`);
    }
  }
  exactKeys(value, [
    "module_id", "question_format", "topics", "assertions",
    "proposed_keys", "composite_requests",
  ], where);
  const module_id = reqStr(value, "module_id", where);
  if (!SLUG_RE.test(module_id)) fail(where, `invalid module_id '${module_id}'`);
  let question_format = "short_answer";
  if (value.question_format !== undefined) {
    question_format = reqStr(value, "question_format", where);
    if (!QUESTION_FORMATS.includes(question_format)) {
      fail(where, `question_format must be one of ${QUESTION_FORMATS.join(", ")}`);
    }
  }
  if (!Array.isArray(value.topics)) fail(where, "topics must be an array");
  assertDenseArray(value.topics, `${where}.topics`);
  if (value.topics.length > MAX_TOPICS) fail(where, `topics must have at most ${MAX_TOPICS} entries`);
  const topics = [];
  const topicIds = new Set();
  for (let i = 0; i < value.topics.length; i++) {
    const t = validateTopic(value.topics[i], `${where}.topics[${i}]`, budget);
    if (topicIds.has(t.topic_id)) fail(where, `duplicate topic_id '${t.topic_id}'`);
    topicIds.add(t.topic_id);
    topics.push(t);
  }
  if (!Array.isArray(value.assertions)) fail(where, "assertions must be an array");
  assertDenseArray(value.assertions, `${where}.assertions`);
  if (value.assertions.length > MAX_ASSERTIONS) fail(where, `assertions must have at most ${MAX_ASSERTIONS} entries`);
  const assertions = [];
  const assertionIds = new Set();
  for (let i = 0; i < value.assertions.length; i++) {
    const a = validateAssertion(value.assertions[i], `${where}.assertions[${i}]`, budget);
    if (assertionIds.has(a.assertion_id)) fail(where, `duplicate assertion_id '${a.assertion_id}'`);
    assertionIds.add(a.assertion_id);
    assertions.push(a);
  }
  const proposed_keys = [];
  if (value.proposed_keys !== undefined) {
    if (!Array.isArray(value.proposed_keys)) fail(where, "proposed_keys must be an array");
    assertDenseArray(value.proposed_keys, `${where}.proposed_keys`);
    if (value.proposed_keys.length > 256) fail(where, "proposed_keys must have at most 256 entries");
    for (let i = 0; i < value.proposed_keys.length; i++) {
      proposed_keys.push(validateProposedKey(value.proposed_keys[i], `${where}.proposed_keys[${i}]`, budget));
    }
  }
  const composite_requests = [];
  if (value.composite_requests !== undefined) {
    if (!Array.isArray(value.composite_requests)) fail(where, "composite_requests must be an array");
    assertDenseArray(value.composite_requests, `${where}.composite_requests`);
    if (value.composite_requests.length > 128) fail(where, "composite_requests must have at most 128 entries");
    const itemIds = new Set();
    for (let i = 0; i < value.composite_requests.length; i++) {
      const c = validateCompositeRequest(value.composite_requests[i], `${where}.composite_requests[${i}]`, budget);
      if (itemIds.has(c.item_id)) fail(where, `duplicate composite item_id '${c.item_id}'`);
      itemIds.add(c.item_id);
      composite_requests.push(c);
    }
  }
  return {
    module_id, question_format, topics, assertions, proposed_keys, composite_requests,
  };
}

export function validateTask(task, budget = null) {
  const charge = (obj, what) => { if (budget) budget.chargeObjectOnce(obj, what); };
  charge(task, "task");
  if (!isPlainObject(task)) fail("task", "must be an object");
  assertNoAccessors(task, "task");
  exactKeys(task, ["schema_version", "task_id", "operation", "fixture_refs", "options"], "task");
  if (task.schema_version !== "1") fail("task", "schema_version must be '1'");
  const task_id = reqStr(task, "task_id", "task", { maxBytes: 2048 });
  const operation = reqStr(task, "operation", "task", { maxBytes: 256 });

  if (!isPlainObject(task.fixture_refs)) fail("task", "fixture_refs must be an object");
  charge(task.fixture_refs, "task.fixture_refs");
  exactKeys(task.fixture_refs, ["source_refs"], "task.fixture_refs");
  const source_refs = [];
  if (task.fixture_refs.source_refs !== undefined) {
    if (!Array.isArray(task.fixture_refs.source_refs)) fail("task.fixture_refs", "source_refs must be an array");
    assertDenseArray(task.fixture_refs.source_refs, "task.fixture_refs.source_refs");
    if (task.fixture_refs.source_refs.length > MAX_SOURCE_REFS) {
      fail("task.fixture_refs", `source_refs must have at most ${MAX_SOURCE_REFS} entries`);
    }
    for (let i = 0; i < task.fixture_refs.source_refs.length; i++) {
      charge(task.fixture_refs.source_refs[i], `task.fixture_refs.source_refs[${i}]`);
      source_refs.push(validateSourceRef(task.fixture_refs.source_refs[i], `task.fixture_refs.source_refs[${i}]`));
    }
  }

  if (!isPlainObject(task.options)) fail("task", "options must be an object");
  charge(task.options, "task.options");
  for (const bad of ["templates", "provenance", "criteria", "status_overrides"]) {
    if (Object.prototype.hasOwnProperty.call(task.options, bad)) {
      fail("task.options", `caller-supplied control field '${bad}' is rejected as INVALID_INPUT`);
    }
  }
  exactKeys(task.options, ["request"], "task.options");
  charge(task.options.request, "task.options.request");
  const request = validateRequest(task.options.request, "task.options.request", budget);

  return {
    task_id,
    operation,
    source_refs,
    request,
    kind: operation === REQUESTED_OPERATION_ALLOWED ? "analyze" : "prohibited",
  };
}

export { REPO_RE, PATH_RE, RECORD_ID_RE, SLUG_RE, ISO_RE, HEX64 };
