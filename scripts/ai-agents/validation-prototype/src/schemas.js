/**
 * schemas.js — runtime validation for the Validation Agent prototype.
 * Strict: rejects unknown properties in control-bearing objects, absent
 * required fields, wrong types, invalid enum values, duplicate IDs,
 * nonfinite numbers, invalid dates. Pure Node 24 ESM, zero dependencies.
 *
 * validateGrantGateContext() treats the injected trusted context as a
 * CANDIDATE POPULATION: every source map entry key, every read grant,
 * the principal, the alias table, the criteria and every provenance
 * registry entry are object-charged BEFORE any of their fields are
 * read. validateSelectedSourceEntry() and validateProvenanceRegistry()
 * admit post-grant data. `budget` is REQUIRED.
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
const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SUITE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const REQUESTED_OPERATION_ALLOWED = "analyze";
export const PRINCIPAL_ROLES = ["JASON", "MUSE_RELAY"];
export const VERIFICATION_METHODS = ["MOCK_INDEPENDENT_RUN"];
export const RESULT_CLASSES = ["PASS", "FAIL", "BLOCKED", "UNKNOWN"];
// Upper bound on any one artifact text payload before hashing. The
// 256KiB aggregate input budget gates real processing; this is a
// fail-closed per-record bound before decode.
export const MAX_ARTIFACT_BYTES = 1048576;

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
 * PER-008: trap-free native-Proxy check for one consulted host object.
 * types.isProxy is a native V8 map check — zero traps fire. Runs BEFORE
 * any reflective operation on the object (Object.keys,
 * getOwnPropertyDescriptor, ...), at every level the charged
 * validators descend to. This replaces the old uncharged
 * assertNoNativeProxies sweeps: each consulted object is Proxy-checked
 * and then charged BEFORE its descriptors are inspected, so candidate
 * #65 refuses before its descriptors are touched, while a Proxy still
 * refuses immediately with INVALID_INPUT and zero trap executions.
 */
function rejectHostProxy(obj, where) {
  if (types.isProxy(obj)) {
    fail(where, `native Proxy at '${where}' is not plain data; refusing without invoking its traps`);
  }
}

/**
 * Budget-integrated descriptor-safe admission. Charges each distinct
 * object BEFORE any descriptor field is examined; candidate #65 refuses
 * without touching that candidate. Rejects accessors, functions,
 * symbols, unsupported prototypes, graphs deeper than 32.
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
export function validateSourceRef(value, where) {
  // PER-008: trap-free Proxy check before any reflective operation.
  rejectHostProxy(value, where);
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

/** Exact equality of two validated SourceRefs (all six fields). */
export function implementationRefEquals(a, b) {
  return (
    a && b &&
    a.repo === b.repo && a.path === b.path && a.commit === b.commit &&
    a.blob === b.blob && a.algorithm === b.algorithm && a.revision === b.revision
  );
}

export function validatePrincipal(value, where) {
  // PER-008: trap-free Proxy check before any reflective operation.
  rejectHostProxy(value, where);
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
  // PER-008: trap-free Proxy check before any reflective operation.
  rejectHostProxy(value, where);
  if (!isPlainObject(value)) fail(where, "criteria must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["criteria_version"], where);
  const criteria_version = reqStr(value, "criteria_version", where);
  if (!SLUG_RE.test(criteria_version)) fail(where, `invalid criteria_version '${criteria_version}'`);
  return { criteria_version };
}

export function validateReadGrant(value, where, budget) {
  // PER-008: trap-free Proxy check before any reflective operation.
  rejectHostProxy(value, where);
  if (!isPlainObject(value)) fail(where, "read grant must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["repo", "path"], where);
  const repo = reqStr(value, "repo", where);
  if (!REPO_RE.test(repo)) fail(where, `invalid repo '${repo}'`);
  const path = reqStr(value, "path", where);
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
  // PER-008: trap-free Proxy check before any reflective operation.
  rejectHostProxy(value, where);
  if (!isPlainObject(value)) fail(where, "aliases must be an object");
  assertNoAccessors(value, where);
  const keys = Object.keys(value);
  if (keys.length > 256) fail(where, "aliases must have at most 256 entries");
  const out = {};
  for (const k of keys) {
    if (!RECORD_ID_RE.test(k)) fail(where, `invalid alias key '${k}'`);
    const v = value[k];
    if (typeof v !== "string" || !RECORD_ID_RE.test(v)) fail(where, `invalid canonical id for alias '${k}'`);
    out[k] = v;
  }
  return out;
}

/**
 * Host-only test hooks (same sanctioned pattern as the research
 * prototype's prefill_output_records): inert in production, shift
 * internal counters for exact boundary tests through real runs.
 */
export function validateTestHooks(value, where, budget) {
  if (value === undefined) return undefined;
  // PER-008: trap-free Proxy check before any reflective operation.
  rejectHostProxy(value, where);
  if (!isPlainObject(value)) fail(where, "test_hooks must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["prefill_output_records", "prefill_spans"], where);
  if (budget) budget.chargeObjectOnce(value, where);
  const out = {};
  const prefill = value.prefill_output_records === undefined ? 0 : value.prefill_output_records;
  if (!Number.isInteger(prefill) || prefill < 0 || prefill > 1024) {
    fail(where, "prefill_output_records must be an integer 0..1024");
  }
  out.prefill_output_records = prefill;
  const spans = value.prefill_spans === undefined ? 0 : value.prefill_spans;
  if (!Number.isInteger(spans) || spans < 0 || spans > BUDGET_SPAN_CAP) {
    fail(where, `prefill_spans must be an integer 0..${BUDGET_SPAN_CAP}`);
  }
  out.prefill_spans = spans;
  return out;
}
const BUDGET_SPAN_CAP = 512;

/**
 * Grant-gate context validation. Inspects ONLY bounded
 * grant/principal/control metadata: the clock, the sources MAP (key set
 * and count — never entry contents), read grants, principal, alias
 * table, criteria and test hooks. Source revision metadata and payload
 * bytes are NOT touched here; they are admitted only after an exact
 * read grant succeeds (validateSelectedSourceEntry). A caller-supplied
 * registry inside the task is rejected at the task boundary.
 */
export function validateGrantGateContext(context, budget) {
  if (!budget || typeof budget.chargeObjectOnce !== "function") fail("context", "internal: validateGrantGateContext requires a live budget");
  // PER-008: trap-free Proxy check on the context root before any
  // reflective operation on it.
  rejectHostProxy(context, "context");
  const charge = (obj, what) => budget.chargeObjectOnce(obj, what);
  charge(context, "context");
  if (!isPlainObject(context)) fail("context", "must be an object");
  assertNoAccessors(context, "context");
  exactKeys(context, ["clock", "sources", "readGrants", "principal", "aliases", "criteria", "provenance_registry", "test_hooks"], "context");
  const clockDesc = Object.getOwnPropertyDescriptor(context, "clock");
  if (!clockDesc || typeof clockDesc.get === "function" || typeof clockDesc.set === "function") {
    fail("context", "clock must be an own data property; inherited accessors are not plain data; refusing");
  }
  const clock = clockDesc.value;
  if (!Number.isFinite(clock)) fail("context", "clock must be a finite number");

  // PER-008: the old uncharged assertNoNativeProxies sweeps are gone.
  // Each consulted host subtree root gets a trap-free native-Proxy
  // check here; every deeper object is Proxy-checked inside its
  // charged validator, which charges each object BEFORE inspecting
  // its descriptors. Candidate #65 refuses before its descriptors are
  // touched; a Proxy still refuses immediately with INVALID_INPUT and
  // zero trap executions.
  rejectHostProxy(context.readGrants, "context.readGrants");
  rejectHostProxy(context.principal, "context.principal");
  rejectHostProxy(context.aliases, "context.aliases");
  rejectHostProxy(context.criteria, "context.criteria");
  if (context.test_hooks !== undefined) rejectHostProxy(context.test_hooks, "context.test_hooks");

  if (!isPlainObject(context.sources)) fail("context", "sources must be an object");
  if (types.isProxy(context.sources)) {
    fail("context", "context.sources must not be a native Proxy; refusing without invoking its traps");
  }
  charge(context.sources, "context.sources");
  assertNoAccessors(context.sources, "context.sources");
  const sourceKeys = Object.keys(context.sources);
  if (sourceKeys.length === 0 || sourceKeys.length > 64) fail("context", "sources must have 1..64 entries");
  budget.countSerialized(sourceKeys, "context.sources keys");

  if (!Array.isArray(context.readGrants)) fail("context", "readGrants must be an array");
  assertDenseArray(context.readGrants, "context.readGrants");
  charge(context.readGrants, "context.readGrants");
  const readGrants = [];
  for (let i = 0; i < context.readGrants.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(context.readGrants, i);
    if (!desc || typeof desc.get === "function" || typeof desc.set === "function") {
      fail("context", `readGrants[${i}] must be a plain data property; refusing`);
    }
    charge(desc.value, `context.readGrants[${i}]`);
    readGrants.push(validateReadGrant(desc.value, `context.readGrants[${i}]`, budget));
  }

  charge(context.principal, "context.principal");
  const principal = validatePrincipal(context.principal, "context.principal");
  charge(context.aliases, "context.aliases");
  const aliases = validateAliases(context.aliases, "context.aliases", budget);
  charge(context.criteria, "context.criteria");
  const criteria = validateCriteria(context.criteria, "context.criteria", budget);
  const test_hooks = validateTestHooks(context.test_hooks, "context.test_hooks", budget);

  return { clock, sourceKeys, readGrants, principal, aliases, criteria, test_hooks };
}

function validateSourceEntry(sources, sk, budget) {
  const charge = (obj, what) => budget.chargeObjectOnce(obj, what);
  const entry = sources[sk];
  // PER-008: the old uncharged sweep is replaced by per-object
  // trap-free Proxy checks integrated with charging — each object is
  // checked and charged BEFORE its descriptors are inspected.
  rejectHostProxy(entry, `context.sources[${sk}]`);
  charge(entry, `context.sources[${sk}]`);
  if (!isPlainObject(entry)) fail("context", `source '${sk}' must be an object`);
  assertNoAccessors(entry, `context.sources[${sk}]`);
  const revs = entry.revisions;
  if (!isPlainObject(revs)) fail("context", `source '${sk}' revisions must be an object`);
  rejectHostProxy(revs, `context.sources[${sk}].revisions`);
  charge(revs, `context.sources[${sk}].revisions`);
  assertNoAccessors(revs, `context.sources[${sk}].revisions`);
  for (const commit of Object.keys(revs)) {
    const rev = revs[commit];
    rejectHostProxy(rev, `context.sources[${sk}]@${commit}`);
    charge(rev, `context.sources[${sk}]@${commit}`);
    if (!isPlainObject(rev)) fail("context", `source '${sk}' revision '${commit}' must be an object`);
    assertNoAccessors(rev, `context.sources[${sk}]@${commit}`);
    exactKeys(rev, ["text", "blob", "label", "expected_records"], `context.sources[${sk}]@${commit}`);
    const textDesc = Object.getOwnPropertyDescriptor(rev, "text");
    if (!textDesc || typeof textDesc.get === "function" || typeof textDesc.set === "function") {
      fail("context", `source '${sk}' revision '${commit}' text must be a plain data property`);
    }
    if (typeof textDesc.value !== "string") fail("context", `source '${sk}' revision '${commit}' text must be a string`);
    if (typeof rev.blob !== "string" || !HEX40.test(rev.blob)) fail("context", `source '${sk}' revision '${commit}' blob must be a 40-hex Git object ID`);
    if (typeof rev.label !== "string" || rev.label.length === 0) {
      fail("context", `source '${sk}' revision '${commit}' must carry a registered label`);
    }
    if (rev.expected_records !== undefined) {
      if (!Number.isInteger(rev.expected_records) || rev.expected_records < 0) {
        fail("context", `source '${sk}' revision '${commit}' expected_records must be a nonnegative integer`);
      }
    }
    budget.countSerialized(
      { commit, blob: rev.blob, label: rev.label, expected_records: rev.expected_records ?? null },
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
  return context.sources[selectedKey];
}

/**
 * One TrustedProvenanceRegistry entry. Closed schema; every field
 * validated. The caller charges the entry object and its
 * implementation_ref before this validator reads their fields.
 */
export function validateRegistryEntry(value, where, budget) {
  // PER-008: trap-free Proxy check before any reflective operation.
  rejectHostProxy(value, where);
  if (!isPlainObject(value)) fail(where, "registry entry must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, [
    "run_id", "runner_principal_id", "implementer_principal_id",
    "implementation_ref", "command_sha256", "artifact_sha256",
    "output_sha256", "suite_id", "verification_method",
    "recorded_at", "revoked",
  ], where);
  const run_id = reqStr(value, "run_id", where);
  if (!RUN_ID_RE.test(run_id)) fail(where, `invalid run_id '${run_id}'`);
  const runner_principal_id = reqStr(value, "runner_principal_id", where);
  if (!RECORD_ID_RE.test(runner_principal_id)) fail(where, `invalid runner_principal_id '${runner_principal_id}'`);
  const implementer_principal_id = reqStr(value, "implementer_principal_id", where);
  if (!RECORD_ID_RE.test(implementer_principal_id)) fail(where, `invalid implementer_principal_id '${implementer_principal_id}'`);
  const implementation_ref = validateSourceRef(value.implementation_ref, `${where}.implementation_ref`);
  const command_sha256 = reqStr(value, "command_sha256", where);
  if (!HEX64.test(command_sha256)) fail(where, "command_sha256 must be 64-hex");
  const artifact_sha256 = reqStr(value, "artifact_sha256", where);
  if (!HEX64.test(artifact_sha256)) fail(where, "artifact_sha256 must be 64-hex");
  const output_sha256 = reqStr(value, "output_sha256", where);
  if (!HEX64.test(output_sha256)) fail(where, "output_sha256 must be 64-hex");
  const suite_id = reqStr(value, "suite_id", where);
  if (!SUITE_ID_RE.test(suite_id)) fail(where, `invalid suite_id '${suite_id}'`);
  const verification_method = reqStr(value, "verification_method", where);
  if (!VERIFICATION_METHODS.includes(verification_method)) {
    fail(where, `verification_method must be one of ${VERIFICATION_METHODS.join(", ")}`);
  }
  const recorded_at = reqStr(value, "recorded_at", where);
  if (!isRealInstant(recorded_at)) fail(where, "recorded_at must be a real UTC instant");
  if (typeof value.revoked !== "boolean") fail(where, "revoked must be a boolean");
  return {
    run_id, runner_principal_id, implementer_principal_id, implementation_ref,
    command_sha256, artifact_sha256, output_sha256, suite_id,
    verification_method, recorded_at, revoked: value.revoked,
  };
}

/**
 * Validate and charge the host-registered TrustedProvenanceRegistry.
 * Keyed by run_id; bounded at 256 entries. Each entry object and its
 * implementation_ref are charged before their fields are read.
 */
export function validateProvenanceRegistry(context, budget) {
  if (!budget || typeof budget.chargeObjectOnce !== "function") fail("context", "internal: validateProvenanceRegistry requires a live budget");
  const regIn = context.provenance_registry;
  if (!isPlainObject(regIn)) fail("context", "provenance_registry must be an object");
  // PER-008: the old uncharged sweep is replaced by per-object
  // trap-free Proxy checks integrated with charging — each object is
  // checked and charged BEFORE its descriptors are inspected.
  rejectHostProxy(regIn, "context.provenance_registry");
  budget.chargeObjectOnce(regIn, "context.provenance_registry");
  assertNoAccessors(regIn, "context.provenance_registry");
  const regKeys = Object.keys(regIn);
  if (regKeys.length > 256) fail("context", "provenance_registry must have at most 256 entries");
  const provenance_registry = {};
  for (const rk of regKeys) {
    if (!RUN_ID_RE.test(rk)) fail("context", `invalid registry key '${rk}'; expected a run_id`);
    const entry = regIn[rk];
    // PER-008: trap-free Proxy check before the object is charged or
    // any of its descriptors is inspected.
    rejectHostProxy(entry, `context.provenance_registry[${rk}]`);
    budget.chargeObjectOnce(entry, `context.provenance_registry[${rk}]`);
    const implRef = entry && typeof entry === "object" ? entry.implementation_ref : undefined;
    budget.chargeObjectOnce(implRef, `context.provenance_registry[${rk}].implementation_ref`);
    const validated = validateRegistryEntry(entry, `context.provenance_registry[${rk}]`, budget);
    if (validated.run_id !== rk) fail("context", `registry entry run_id '${validated.run_id}' does not match its key '${rk}'`);
    budget.countSerialized(validated, `context.provenance_registry[${rk}]`);
    provenance_registry[rk] = validated;
  }
  return provenance_registry;
}

/**
 * Schema-versioned synthetic JSON runner summary. Closed schema.
 * Malformed (structurally invalid) summaries are a domain-level
 * UNVERIFIABLE outcome when the shape is right but fields are wrong;
 * a non-object/non-JSON summary is a malformed control (refused at
 * the boundary via the caller's pre-check).
 */
export function validateRunnerSummary(value, where) {
  // PER-008: trap-free Proxy check before any reflective operation.
  rejectHostProxy(value, where);
  if (!isPlainObject(value)) fail(where, "summary must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, [
    "schema_version", "test_count", "pass_count", "fail_count",
    "skip_count", "suite_errors", "exit_code", "run_crashed",
    "timed_out", "complete_summary", "suite_id", "result_class",
  ], where);
  if (value.schema_version !== "1") fail(where, "schema_version must be '1'");
  const test_count = reqInt(value, "test_count", where, { min: 0 });
  const pass_count = reqInt(value, "pass_count", where, { min: 0 });
  const fail_count = reqInt(value, "fail_count", where, { min: 0 });
  const skip_count = reqInt(value, "skip_count", where, { min: 0 });
  const suite_errors = reqInt(value, "suite_errors", where, { min: 0 });
  const exit_code = reqInt(value, "exit_code", where, { min: 0 });
  for (const k of ["run_crashed", "timed_out", "complete_summary"]) {
    if (typeof value[k] !== "boolean") fail(where, `'${k}' must be a boolean`);
  }
  const suite_id = reqStr(value, "suite_id", where);
  if (!SUITE_ID_RE.test(suite_id)) fail(where, `invalid suite_id '${suite_id}'`);
  const result_class = reqStr(value, "result_class", where);
  if (!RESULT_CLASSES.includes(result_class)) fail(where, `result_class must be one of ${RESULT_CLASSES.join(", ")}`);
  // Nonnegative integers and pass+fail+skip=test_count are required
  // for a well-formed summary; a broken sum is malformed data, not
  // control structure.
  if (pass_count + fail_count + skip_count !== test_count) {
    fail(where, "pass_count+fail_count+skip_count must equal test_count");
  }
  return {
    schema_version: "1", test_count, pass_count, fail_count, skip_count,
    suite_errors, exit_code, run_crashed: value.run_crashed,
    timed_out: value.timed_out, complete_summary: value.complete_summary,
    suite_id, result_class,
  };
}

/**
 * Registered synthetic runner artifact (the run log). Closed schema.
 * The artifact is claimed data — only the TrustedProvenanceRegistry
 * authenticates it.
 */
export function validateArtifactRecord(value, where) {
  // PER-008: trap-free Proxy check before any reflective operation.
  rejectHostProxy(value, where);
  if (!isPlainObject(value)) fail(where, "artifact must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["artifact_kind", "run_id", "claimed_runner", "suite_id", "command", "summary"], where);
  if (value.artifact_kind !== "synthetic-runner-log") fail(where, "artifact_kind must be 'synthetic-runner-log'");
  const run_id = reqStr(value, "run_id", where);
  if (!RUN_ID_RE.test(run_id)) fail(where, `invalid run_id '${run_id}'`);
  const claimed_runner = reqStr(value, "claimed_runner", where);
  if (!RECORD_ID_RE.test(claimed_runner)) fail(where, `invalid claimed_runner '${claimed_runner}'`);
  const suite_id = reqStr(value, "suite_id", where);
  if (!SUITE_ID_RE.test(suite_id)) fail(where, `invalid suite_id '${suite_id}'`);
  const command = reqStr(value, "command", where, { allowEmpty: true, maxBytes: 8192 });
  const summary = validateRunnerSummary(value.summary, `${where}.summary`);
  return { artifact_kind: "synthetic-runner-log", run_id, claimed_runner, suite_id, command, summary };
}

/**
 * One verification request (options.request). Closed agent-specific
 * schema — not executable policy. A caller-supplied verified_by or
 * inline provenance control field is rejected as INVALID_INPUT.
 */
export function validateRequest(value, where, budget = null) {
  const charge = (obj, what) => { if (budget) budget.chargeObjectOnce(obj, what); };
  if (!isPlainObject(value)) fail(where, "request must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, [
    "claim_id", "implementation_ref", "implementer_principal_id",
    "command", "run_id", "runner_artifact_ref",
    "expected_suite_id", "claimed_summary", "registry_record_ref",
  ], where);
  const claim_id = reqStr(value, "claim_id", where, { maxBytes: 2048 });
  if (!RECORD_ID_RE.test(claim_id)) fail(where, `invalid claim_id '${claim_id}'`);
  charge(value.implementation_ref, `${where}.implementation_ref`);
  const implementation_ref = validateSourceRef(value.implementation_ref, `${where}.implementation_ref`);
  const implementer_principal_id = reqStr(value, "implementer_principal_id", where);
  if (!RECORD_ID_RE.test(implementer_principal_id)) fail(where, `invalid implementer_principal_id '${implementer_principal_id}'`);
  const command = reqStr(value, "command", where, { allowEmpty: true, maxBytes: 8192 });

  let run_id;
  if (value.run_id !== undefined) {
    run_id = reqStr(value, "run_id", where);
    if (!RUN_ID_RE.test(run_id)) fail(where, `invalid run_id '${run_id}'`);
  }

  let runner_artifact_ref;
  if (value.runner_artifact_ref !== undefined) {
    charge(value.runner_artifact_ref, `${where}.runner_artifact_ref`);
    runner_artifact_ref = validateSourceRef(value.runner_artifact_ref, `${where}.runner_artifact_ref`);
  }

  const expected_suite_id = reqStr(value, "expected_suite_id", where);
  if (!SUITE_ID_RE.test(expected_suite_id)) fail(where, `invalid expected_suite_id '${expected_suite_id}'`);

  let claimed_summary;
  let summary_malformed = false;
  if (value.claimed_summary !== undefined && value.claimed_summary !== null) {
    charge(value.claimed_summary, `${where}.claimed_summary`);
    // A malformed summary payload is a domain-level UNVERIFIABLE
    // outcome (not a task-control refusal): the summary is data, not
    // control structure.
    try {
      claimed_summary = validateRunnerSummary(value.claimed_summary, `${where}.claimed_summary`);
    } catch (e) {
      if (e instanceof SchemaError) {
        summary_malformed = true;
        claimed_summary = undefined;
      } else {
        throw e;
      }
    }
  }

  let registry_record_ref;
  if (value.registry_record_ref !== undefined) {
    const r = value.registry_record_ref;
    const rw = `${where}.registry_record_ref`;
    if (!isPlainObject(r)) fail(rw, "must be an object");
    assertNoAccessors(r, rw);
    exactKeys(r, ["run_id"], rw);
    const rid = reqStr(r, "run_id", rw);
    if (!RUN_ID_RE.test(rid)) fail(rw, `invalid run_id '${rid}'`);
    registry_record_ref = { run_id: rid };
  }

  return {
    claim_id, implementation_ref, implementer_principal_id, command,
    run_id, runner_artifact_ref, expected_suite_id, claimed_summary,
    summary_malformed, registry_record_ref,
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
  exactKeys(task.fixture_refs, ["artifact_ref"], "task.fixture_refs");
  let artifact_ref;
  if (task.fixture_refs.artifact_ref !== undefined) {
    charge(task.fixture_refs.artifact_ref, "task.fixture_refs.artifact_ref");
    artifact_ref = validateSourceRef(task.fixture_refs.artifact_ref, "task.fixture_refs.artifact_ref");
  }

  if (!isPlainObject(task.options)) fail("task", "options must be an object");
  charge(task.options, "task.options");
  // A caller-supplied provenance control field is rejected outright:
  // provenance comes only from the host-injected registry.
  for (const bad of ["verified_by", "provenance_registry", "trusted_registry", "registry_json", "registry_callback"]) {
    if (Object.prototype.hasOwnProperty.call(task.options, bad)) {
      fail("task.options", `caller-supplied provenance control field '${bad}' is rejected as INVALID_INPUT`);
    }
  }
  exactKeys(task.options, ["request"], "task.options");
  charge(task.options.request, "task.options.request");
  const request = validateRequest(task.options.request, "task.options.request", budget);

  return {
    task_id,
    operation,
    artifact_ref,
    request,
    kind: operation === REQUESTED_OPERATION_ALLOWED ? "analyze" : "prohibited",
  };
}

export { REPO_RE, PATH_RE, RECORD_ID_RE, SLUG_RE, RUN_ID_RE, SUITE_ID_RE, BUDGET_SPAN_CAP };
