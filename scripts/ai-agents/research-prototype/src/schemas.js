/**
 * schemas.js — runtime validation for the Research Agent prototype.
 * Strict: rejects unknown properties in control-bearing objects, absent
 * required fields, wrong types, invalid enum values, duplicate IDs,
 * nonfinite numbers, invalid dates. Pure Node 24 ESM, zero dependencies.
 *
 * validateContext() treats the injected trusted context as a CANDIDATE
 * POPULATION: every source, every revision, every read grant, the
 * principal, the criteria and every provenance-registry entry are
 * object-charged BEFORE any of their fields are read. Revision text
 * bytes are payload-charged before acceptance. `budget` is REQUIRED.
 *
 * RA652-006: the public run() path does NOT admit the whole context at
 * once. Admission is split: validateGrantGateContext() inspects only
 * bounded grant/principal/control metadata (never source revision
 * metadata or payload bytes); the denied-source grant is checked next;
 * only after an exact grant succeeds do validateSelectedSourceEntry()
 * (the selected source/revision only) and validateProvenanceRegistry()
 * admit the rest. validateContext() below keeps the full-registry
 * validation for unit tests of the validator itself.
 *
 * splitTopLevelArray() is the bounded-container preflight: it yields raw
 * per-element source spans of the evidence bundle WITHOUT decoding any
 * candidate's fields; the caller charges each candidate before
 * JSON.parse on its span.
 */

import { HEX40, isRealDate, isRealInstant } from "./canonical.js";
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
const DOC_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PASSAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const GROUP_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const REQUESTED_OPERATION_ALLOWED = "analyze";
export const PRINCIPAL_ROLES = ["JASON", "MUSE_RELAY"];
export const MAX_RECORDS_PER_BUNDLE_SCHEMA = 4096; // outer array-shape bound only; the 64-object budget gates real processing
const DERIVATION_KINDS = ["copy", "derived"];
const POLARITIES = ["positive", "negative"];
const VALUE_TYPES = ["number", "string", "boolean"];

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
 * EXEC652-003: trap-free native Proxy detection sweep.
 *
 * `types.isProxy` is a native V8 map check — it invokes zero traps, even
 * on a Proxy whose every trap is instrumented. This walk checks
 * isProxy on EVERY reachable object BEFORE any reflective operation
 * touches that object, so a Proxy's traps execute zero times —
 * top-level or nested. All reflection below runs only on provably
 * non-Proxy objects, where the native internal methods are trap-free
 * (ordinary objects/arrays; exotic non-Proxy builtins admit only native
 * trap-free reflection too).
 *
 * A Proxy is not plain data: detection refuses with SchemaError
 * (INVALID_INPUT at the run boundary), never by invoking its traps.
 * The walk is deterministic (getOwnPropertyNames order), cycle-safe
 * (WeakSet), and depth-bounded at 32 like admitGraph.
 *
 * NOTE: this sweep must run before the phase's reflective operations,
 * and only over subgraphs the phase actually admits. In particular it
 * must NOT descend into denied source entries pre-grant (RA652-006);
 * use a shallow isProxy check for the sources map itself.
 */
export function assertNoNativeProxies(value, where, maxDepth = 32) {
  const seen = new WeakSet();
  const walk = (v, path, depth) => {
    if (v === null || typeof v !== "object") return;
    // Trap-free native detection FIRST — before any reflective
    // operation on v. Zero traps fire, even instrumented ones.
    if (types.isProxy(v)) {
      fail(where, `native Proxy at '${path}' is not plain data; refusing without invoking its traps`);
    }
    if (seen.has(v)) return;
    seen.add(v);
    if (depth > maxDepth) {
      fail(where, `object graph exceeds max depth ${maxDepth} at '${path}'; refusing`);
    }
    // v is provably not a Proxy: native reflection here is trap-free.
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

/**
 * Descriptor-safe closed admission. Rejects objects carrying accessor
 * properties (getters/setters) — they are not plain data, and reading them
 * would execute request-supplied code during validation. Uses
 * getOwnPropertyDescriptor over ALL own property names (not just
 * enumerable keys) so the check itself never invokes accessors and cannot
 * be bypassed with nonenumerable getters.
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
 * Budget-integrated descriptor-safe admission. Walks the object graph with
 * getOwnPropertyDescriptor (never invoking accessors), charging each
 * distinct object against the live monotonic budget BEFORE any of its
 * descriptor fields are examined. Candidate #65 refuses with
 * BUDGET_EXCEEDED without touching that candidate at all.
 *
 * Also rejects: accessor properties, function/symbol values, symbol keys,
 * objects whose prototype is not Object.prototype/Array.prototype/null,
 * and graphs deeper than 32.
 *
 * The walk is deterministic: depth-first, Object.getOwnPropertyNames
 * order. Primitives are not charged. Shared/cyclic references are
 * visited once (WeakSet).
 */
export function admitGraph(value, where, budget, maxDepth = 32) {
  if (!budget || typeof budget.chargeObjectOnce !== "function") {
    fail(where, "internal: admitGraph requires a live budget");
  }
  const seen = new WeakSet();
  const walk = (v, path, depth) => {
    if (v === null || typeof v !== "object") return;
    // EXEC652-003: trap-free native Proxy detection BEFORE any
    // reflective operation on v — including the prototype read below.
    // types.isProxy invokes zero traps.
    if (types.isProxy(v)) {
      fail(where, `native Proxy at '${path}' is not plain data; refusing without invoking its traps`);
    }
    if (depth > maxDepth) {
      fail(where, `object graph exceeds max depth ${maxDepth} at '${path}'; refusing`);
    }
    if (seen.has(v)) return;
    seen.add(v);
    // Charge BEFORE examining this candidate's descriptors. The 65th
    // distinct object throws here; its fields are never read.
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

/**
 * Deep descriptor-safe admission sweep (pre-transport gate). Defaults to
 * the contract depth of 32.
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
 * Structural sparse-array rejection. Array holes survive .map()
 * validation and become undefined controls. Every index must be an own
 * data property before the array is processed.
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
  assertNoAccessors(value, where);
  exactKeys(value, ["criteria_version"], where);
  const criteria_version = reqStr(value, "criteria_version", where);
  if (!SLUG_RE.test(criteria_version)) fail(where, `invalid criteria_version '${criteria_version}'`);
  return { criteria_version };
}

export function validateReadGrant(value, where, budget) {
  if (!isPlainObject(value)) fail(where, "read grant must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["repo", "path"], where);
  const repo = reqStr(value, "repo", where);
  if (!REPO_RE.test(repo)) fail(where, `invalid repo '${repo}'`);
  const path = reqStr(value, "path", where);
  if (!PATH_RE.test(path)) fail(where, `invalid path '${path}'`);
  if (budget) {
    // EXEC652-003: exact aggregate accounting — charge the serialized
    // (canonical JSON) bytes of the admitted grant metadata: structure,
    // key names and escaping, not selected raw string lengths.
    budget.countSerialized({ repo, path }, `${where} grant`);
  }
  return { repo, path };
}

/**
 * Host-registered provenance entry for one passage: the independence
 * group plus derivation links.
 *
 * EXEC652-002: exact-source registration/applicability contract. Each
 * entry declares `applies_to`: the complete source-identity tuples
 * (SourceRef: repo/path/commit/blob/algorithm/revision) this
 * registration is valid for. Independence is never asserted by a
 * passage; it is registered here by the host, bound to exact source
 * pins. The run admits only entries whose applies_to includes the
 * actually consumed bundle pin; a reused doc/passage ID under a
 * changed pin finds no applicable entry and stays conservative
 * (unregistered => UNCORROBORATED). Unknown or incompletely
 * registered lineage never upgrades to independent.
 */
export function validateProvenanceEntry(value, where, budget) {
  if (!isPlainObject(value)) fail(where, "provenance entry must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["provenance_group_id", "derivation_links", "applies_to"], where);
  const provenance_group_id = reqStr(value, "provenance_group_id", where);
  if (!GROUP_ID_RE.test(provenance_group_id)) fail(where, `invalid provenance_group_id '${provenance_group_id}'`);
  const appliesIn = value.applies_to;
  if (!Array.isArray(appliesIn) || appliesIn.length === 0 || appliesIn.length > 64) {
    fail(where, "applies_to must be a non-empty array of at most 64 SourceRefs binding this registration to exact source pins");
  }
  assertDenseArray(appliesIn, `${where}.applies_to`);
  const applies_to = [];
  for (let i = 0; i < appliesIn.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(appliesIn, i);
    if (!desc || typeof desc.get === "function" || typeof desc.set === "function") {
      fail(where, `applies_to[${i}] must be a plain data property; refusing`);
    }
    if (budget) budget.chargeObjectOnce(desc.value, `${where}.applies_to[${i}]`);
    applies_to.push(validateSourceRef(desc.value, `${where}.applies_to[${i}]`));
  }
  const linksIn = value.derivation_links === undefined ? [] : value.derivation_links;
  if (!Array.isArray(linksIn) || linksIn.length > 64) fail(where, "derivation_links must be an array of at most 64 links");
  assertDenseArray(linksIn, `${where}.derivation_links`);
  const derivation_links = [];
  for (let i = 0; i < linksIn.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(linksIn, i);
    if (!desc || typeof desc.get === "function" || typeof desc.set === "function") {
      fail(where, `derivation_links[${i}] must be a plain data property; refusing`);
    }
    if (budget) budget.chargeObjectOnce(desc.value, `${where}.derivation_links[${i}]`);
    const l = desc.value;
    const lw = `${where}.derivation_links[${i}]`;
    if (!isPlainObject(l)) fail(lw, "must be an object");
    assertNoAccessors(l, lw);
    exactKeys(l, ["from_doc", "from_passage", "kind"], lw);
    const from_doc = reqStr(l, "from_doc", lw);
    if (!DOC_ID_RE.test(from_doc)) fail(lw, `invalid from_doc '${from_doc}'`);
    const from_passage = reqStr(l, "from_passage", lw);
    if (!PASSAGE_ID_RE.test(from_passage)) fail(lw, `invalid from_passage '${from_passage}'`);
    const kind = reqStr(l, "kind", lw);
    if (!DERIVATION_KINDS.includes(kind)) fail(lw, `kind must be one of ${DERIVATION_KINDS.join(",")}`);
    derivation_links.push({ from_doc, from_passage, kind });
  }
  return { provenance_group_id, derivation_links, applies_to };
}

/**
 * EXEC652-002: exact-source applicability. True iff the provenance
 * entry's applies_to lists the exact consumed source pin (all six
 * SourceRef fields). A registration for a different repo, path,
 * commit, blob, algorithm or revision does not apply — the passage
 * keeps conservative unregistered treatment.
 */
export function entryAppliesToSource(entry, ref) {
  const pins = (entry && entry.applies_to) || [];
  return pins.some((p) =>
    p.repo === ref.repo &&
    p.path === ref.path &&
    p.commit === ref.commit &&
    p.blob === ref.blob &&
    p.algorithm === ref.algorithm &&
    p.revision === ref.revision
  );
}

/**
 * RA652-006: grant-gate context validation. Inspects ONLY bounded
 * grant/principal/control metadata: the clock, the sources MAP (key set
 * and count — never entry contents), read grants, principal, criteria
 * and test hooks. Source revision metadata (keys, commits, blobs,
 * labels, expected record counts) and payload bytes are NOT touched
 * here; they are admitted only after an exact read grant succeeds (see
 * validateSelectedSourceEntry). A denied source's revision metadata and
 * payload therefore remain completely untouched when the grant check
 * fails.
 */
export function validateGrantGateContext(context, budget) {
  if (!budget || typeof budget.chargeObjectOnce !== "function") fail("context", "internal: validateGrantGateContext requires a live budget");
  const charge = (obj, what) => budget.chargeObjectOnce(obj, what);
  charge(context, "context");
  if (!isPlainObject(context)) fail("context", "must be an object");
  assertNoAccessors(context, "context");
  exactKeys(context, ["clock", "sources", "readGrants", "principal", "criteria", "provenance_registry", "test_hooks"], "context");
  const clockDesc = Object.getOwnPropertyDescriptor(context, "clock");
  if (!clockDesc || typeof clockDesc.get === "function" || typeof clockDesc.set === "function") {
    fail("context", "clock must be an own data property; inherited accessors are not plain data; refusing");
  }
  const clock = clockDesc.value;
  if (!Number.isFinite(clock)) fail("context", "clock must be a finite number");

  // EXEC652-003: trap-free native Proxy sweeps over every subgraph this
  // gate inspects — before any reflective operation on them. The
  // sources map gets a shallow check only (its entries stay untouched
  // pre-grant, RA652-006); readGrants/principal/criteria/test_hooks are
  // fully admitted here, so they are swept deeply. types.isProxy is a
  // native V8 check: zero traps fire.
  assertNoNativeProxies(context.readGrants, "context.readGrants");
  assertNoNativeProxies(context.principal, "context.principal");
  assertNoNativeProxies(context.criteria, "context.criteria");
  if (context.test_hooks !== undefined) assertNoNativeProxies(context.test_hooks, "context.test_hooks");

  // Sources map: key set only. Entries are NOT read here — a denied
  // source's revision metadata and payload stay untouched until the
  // grant check passes. EXEC652-003: shallow native-Proxy check on the
  // map itself (trap-free); entries are never descended into here.
  if (!isPlainObject(context.sources)) fail("context", "sources must be an object");
  if (types.isProxy(context.sources)) {
    fail("context", "context.sources must not be a native Proxy; refusing without invoking its traps");
  }
  charge(context.sources, "context.sources");
  assertNoAccessors(context.sources, "context.sources");
  const sourceKeys = Object.keys(context.sources);
  if (sourceKeys.length === 0 || sourceKeys.length > 64) fail("context", "sources must have 1..64 entries");
  // EXEC652-003: exact aggregate accounting — the consulted key set is
  // charged in serialized (canonical JSON) form: structure, key names
  // and escaping, not selected raw string lengths.
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
  charge(context.criteria, "context.criteria");
  const criteria = validateCriteria(context.criteria, "context.criteria", budget);

  // Host-only output-boundary test hook (see validateTestHooks).
  const test_hooks = validateTestHooks(context.test_hooks, "context.test_hooks", budget);

  return { clock, sourceKeys, readGrants, principal, criteria, test_hooks };
}

/**
 * Validate and charge ONE registered source entry (its revisions map and
 * every revision's metadata). Extracted so the post-grant path admits
 * only the selected source.
 */
function validateSourceEntry(sources, sk, budget) {
  const charge = (obj, what) => budget.chargeObjectOnce(obj, what);
  const entry = sources[sk];
  // EXEC652-003: trap-free native Proxy sweep over the selected entry
  // BEFORE any reflective operation on it — nested/selected-source
  // traps execute zero times. This is post-grant admission, so touching
  // the selected entry is allowed here (RA652-006).
  assertNoNativeProxies(entry, `context.sources[${sk}]`);
  charge(entry, `context.sources[${sk}]`);
  if (!isPlainObject(entry)) fail("context", `source '${sk}' must be an object`);
  assertNoAccessors(entry, `context.sources[${sk}]`);
  const revs = entry.revisions;
  if (!isPlainObject(revs)) fail("context", `source '${sk}' revisions must be an object`);
  charge(revs, `context.sources[${sk}].revisions`);
  assertNoAccessors(revs, `context.sources[${sk}].revisions`);
  for (const commit of Object.keys(revs)) {
    const rev = revs[commit];
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
    // EXEC652-003: exact aggregate accounting — the admitted revision
    // metadata is charged in serialized (canonical JSON) form: all
    // fields, structure, key names and escaping. Replaces the old
    // selected raw string lengths (commit, label). The revision text
    // bytes are charged separately as selected source bytes on
    // resolution — nonduplicating: metadata here, bytes there.
    budget.countSerialized(
      { commit, blob: rev.blob, label: rev.label, expected_records: rev.expected_records ?? null },
      `context.sources[${sk}]@${commit} metadata`
    );
  }
}

/**
 * RA652-006: post-grant admission of the SELECTED source only. Called
 * after an exact read grant for the task's evidence-bundle SourceRef has
 * succeeded. Non-selected source entries are never inspected — they stay
 * unadmitted and uncharged.
 */
export function validateSelectedSourceEntry(context, budget, selectedKey) {
  if (!budget || typeof budget.chargeObjectOnce !== "function") fail("context", "internal: validateSelectedSourceEntry requires a live budget");
  if (typeof selectedKey !== "string" || !Object.prototype.hasOwnProperty.call(context.sources, selectedKey)) {
    fail("context", `selected source '${String(selectedKey).slice(0, 80)}' is not a registered source key`);
  }
  validateSourceEntry(context.sources, selectedKey, budget);
  return context.sources[selectedKey];
}

/**
 * Validate and charge the host-registered provenance/independence
 * metadata. Required provenance metadata is admitted post-grant; it
 * carries no source bytes.
 */
export function validateProvenanceRegistry(context, budget) {
  if (!budget || typeof budget.chargeObjectOnce !== "function") fail("context", "internal: validateProvenanceRegistry requires a live budget");
  const regIn = context.provenance_registry;
  if (!isPlainObject(regIn)) fail("context", "provenance_registry must be an object");
  // EXEC652-003: trap-free native Proxy sweep before any reflective
  // operation on the registry. Post-grant required metadata: touching
  // it here is allowed.
  assertNoNativeProxies(regIn, "context.provenance_registry");
  budget.chargeObjectOnce(regIn, "context.provenance_registry");
  assertNoAccessors(regIn, "context.provenance_registry");
  const regKeys = Object.keys(regIn);
  if (regKeys.length > 256) fail("context", "provenance_registry must have at most 256 entries");
  const provenance_registry = {};
  for (const rk of regKeys) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\|[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(rk)) {
      fail("context", `invalid provenance registry key '${rk}'; expected 'doc_id|passage_id'`);
    }
    const entry = regIn[rk];
    budget.chargeObjectOnce(entry, `context.provenance_registry[${rk}]`);
    const validated = validateProvenanceEntry(entry, `context.provenance_registry[${rk}]`, budget);
    // EXEC652-003: exact aggregate accounting — each admitted registry
    // entry is charged in serialized (canonical JSON) form: key,
    // structure, escaping and all fields (including the applies_to
    // SourceRef pins). Replaces the old raw key string length.
    budget.countSerialized(
      { key: rk, provenance_group_id: validated.provenance_group_id, derivation_links: validated.derivation_links, applies_to: validated.applies_to },
      `context.provenance_registry[${rk}]`
    );
    provenance_registry[rk] = validated;
  }
  return provenance_registry;
}

export function validateContext(context, budget) {
  // Full-registry validation, kept for unit tests of the validator
  // itself. The public run() path splits admission (RA652-006) and does
  // not call this.
  const gate = validateGrantGateContext(context, budget);
  for (const sk of gate.sourceKeys) validateSourceEntry(context.sources, sk, budget);
  const provenance_registry = validateProvenanceRegistry(context, budget);
  return {
    clock: gate.clock,
    sources: context.sources,
    readGrants: gate.readGrants,
    principal: gate.principal,
    criteria: gate.criteria,
    provenance_registry,
    test_hooks: gate.test_hooks,
  };
}

/**
 * Host-only test hook for the public-output boundary test. The 64-object
 * input budget makes 256 natural output records unreachable, so the
 * output-record counter accepts a host-prefilled base through this
 * explicitly validated, closed-schema field. It is inert in production
 * (hosts never set it); it only shifts the output-record count used by
 * the final-envelope bound check. Documented in the README.
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

/**
 * Canonical quoted text of an atomic assertion. This is the deliberate
 * bounded extraction language: `subject | predicate | value | scope`,
 * prefixed with `NOT ` for negative polarity. Values render canonically:
 * numbers via JSON number form, strings JSON-quoted, booleans bare.
 * The agent never infers this text — it is reconstructed from the
 * structured fields and must match the passage bytes exactly.
 */
export function renderAssertionText(a) {
  const v = a.value_type === "string" ? JSON.stringify(a.value)
    : a.value_type === "number" ? JSON.stringify(a.value)
    : a.value_type === "boolean" ? (a.value === true ? "true" : "false")
    : null;
  if (v === null) throw new SchemaError("unknown value_type");
  const body = `${a.subject} | ${a.predicate} | ${v} | ${a.scope}`;
  return a.polarity === "negative" ? `NOT ${body}` : body;
}

/** One atomic assertion in the controlled grammar. */
export function validateAtom(value, where, budget = null) {
  // The caller charges this object before delegating; atoms are leaves.
  if (!isPlainObject(value)) fail(where, "atom must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["subject", "predicate", "value", "value_type", "scope", "polarity"], where);
  const subject = reqStr(value, "subject", where, { maxBytes: 1024 });
  const predicate = reqStr(value, "predicate", where, { maxBytes: 1024 });
  const value_type = reqStr(value, "value_type", where);
  if (!VALUE_TYPES.includes(value_type)) fail(where, `value_type must be one of ${VALUE_TYPES.join(",")}`);
  const raw = value.value;
  if (value_type === "number") {
    if (typeof raw !== "number" || !Number.isFinite(raw)) fail(where, "value must be a finite number for value_type 'number'");
  } else if (value_type === "string") {
    if (typeof raw !== "string") fail(where, "value must be a string for value_type 'string'");
    if (Buffer.byteLength(raw, "utf8") > 4096) fail(where, "string value exceeds 4096 bytes");
  } else {
    if (typeof raw !== "boolean") fail(where, "value must be a boolean for value_type 'boolean'");
  }
  const scope = reqStr(value, "scope", where, { maxBytes: 1024 });
  const polarity = reqStr(value, "polarity", where);
  if (!POLARITIES.includes(polarity)) fail(where, `polarity must be one of ${POLARITIES.join(",")}`);
  return { subject, predicate, value: raw, value_type, scope, polarity };
}

/** One fixture assertion: an atom plus its passage byte span. */
export function validateFixtureAssertion(value, where, budget = null) {
  const charge = (obj, what) => { if (budget) budget.chargeObjectOnce(obj, what); };
  // The caller charges this object before delegating.
  if (!isPlainObject(value)) fail(where, "assertion must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["assertion_id", "subject", "predicate", "value", "value_type", "scope", "polarity", "span"], where);
  const assertion_id = reqStr(value, "assertion_id", where);
  if (!RECORD_ID_RE.test(assertion_id)) fail(where, `invalid assertion_id '${assertion_id}'`);
  // The atom is the closed-schema projection of the assertion fields.
  const atom = validateAtom({
    subject: value.subject, predicate: value.predicate, value: value.value,
    value_type: value.value_type, scope: value.scope, polarity: value.polarity,
  }, where, budget);
  const spanIn = value.span;
  if (!isPlainObject(spanIn)) fail(where, "span must be an object");
  charge(spanIn, `${where}.span`);
  assertNoAccessors(spanIn, `${where}.span`);
  exactKeys(spanIn, ["start_byte", "end_byte"], `${where}.span`);
  const start_byte = reqInt(spanIn, "start_byte", `${where}.span`, { min: 0 });
  const end_byte = reqInt(spanIn, "end_byte", `${where}.span`, { min: 0 });
  if (end_byte <= start_byte) fail(where, "span end_byte must exceed start_byte");
  return { ...atom, assertion_id, span: { start_byte, end_byte } };
}

/** One citation pointer: a structured reference to another passage. */
export function validateCitation(value, where, budget = null) {
  // The caller charges this object before delegating; citations are leaves.
  if (!isPlainObject(value)) fail(where, "citation must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["pointer", "target_doc", "target_passage"], where);
  const pointer = reqStr(value, "pointer", where, { maxBytes: 1024 });
  const target_doc = reqStr(value, "target_doc", where);
  if (!DOC_ID_RE.test(target_doc)) fail(where, `invalid target_doc '${target_doc}'`);
  const target_passage = reqStr(value, "target_passage", where);
  if (!PASSAGE_ID_RE.test(target_passage)) fail(where, `invalid target_passage '${target_passage}'`);
  return { pointer, target_doc, target_passage };
}

/** One passage: invented text plus its structured assertions. */
export function validatePassage(value, where, budget = null) {
  const charge = (obj, what) => { if (budget) budget.chargeObjectOnce(obj, what); };
  // The caller charges this object before delegating.
  if (!isPlainObject(value)) fail(where, "passage must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["passage_id", "text", "assertions", "citations"], where);
  const passage_id = reqStr(value, "passage_id", where);
  if (!PASSAGE_ID_RE.test(passage_id)) fail(where, `invalid passage_id '${passage_id}'`);
  const text = reqStr(value, "text", where, { allowEmpty: true, maxBytes: 65536 });
  const assertionsIn = value.assertions === undefined ? [] : value.assertions;
  if (!Array.isArray(assertionsIn) || assertionsIn.length > 256) fail(where, "assertions must be an array of at most 256 assertions");
  assertDenseArray(assertionsIn, `${where}.assertions`);
  charge(assertionsIn, `${where}.assertions`);
  const assertions = [];
  const seenAssertionIds = new Set();
  for (let i = 0; i < assertionsIn.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(assertionsIn, i);
    if (!desc || typeof desc.get === "function" || typeof desc.set === "function") {
      fail(where, `assertions[${i}] must be a plain data property; refusing`);
    }
    charge(desc.value, `${where}.assertions[${i}]`);
    const a = validateFixtureAssertion(desc.value, `${where}.assertions[${i}]`, budget);
    if (seenAssertionIds.has(a.assertion_id)) fail(where, `duplicate assertion_id '${a.assertion_id}'`);
    seenAssertionIds.add(a.assertion_id);
    assertions.push(a);
  }
  const citationsIn = value.citations === undefined ? [] : value.citations;
  if (!Array.isArray(citationsIn) || citationsIn.length > 256) fail(where, "citations must be an array of at most 256 citations");
  assertDenseArray(citationsIn, `${where}.citations`);
  charge(citationsIn, `${where}.citations`);
  const citations = [];
  for (let i = 0; i < citationsIn.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(citationsIn, i);
    if (!desc || typeof desc.get === "function" || typeof desc.set === "function") {
      fail(where, `citations[${i}] must be a plain data property; refusing`);
    }
    charge(desc.value, `${where}.citations[${i}]`);
    citations.push(validateCitation(desc.value, `${where}.citations[${i}]`, budget));
  }
  return { passage_id, text, assertions, citations };
}

/** One document record in the evidence bundle. */
export function validateDocumentRecord(value, where, budget = null) {
  const charge = (obj, what) => { if (budget) budget.chargeObjectOnce(obj, what); };
  // The caller (run loop) countObject()s this document BEFORE parsing its
  // span; validators charge children, never self.
  if (!isPlainObject(value)) fail(where, "document record must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["record", "doc_id", "title", "passages"], where);
  if (value.record !== "document") fail(where, `record must be 'document', got '${String(value.record)}'`);
  const doc_id = reqStr(value, "doc_id", where);
  if (!DOC_ID_RE.test(doc_id)) fail(where, `invalid doc_id '${doc_id}'`);
  const title = reqStr(value, "title", where, { allowEmpty: true, maxBytes: 1024 });
  const passagesIn = value.passages;
  if (!Array.isArray(passagesIn) || passagesIn.length > 256) fail(where, "passages must be an array of at most 256 passages");
  assertDenseArray(passagesIn, `${where}.passages`);
  charge(passagesIn, `${where}.passages`);
  const passages = [];
  const seenPassageIds = new Set();
  for (let i = 0; i < passagesIn.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(passagesIn, i);
    if (!desc || typeof desc.get === "function" || typeof desc.set === "function") {
      fail(where, `passages[${i}] must be a plain data property; refusing`);
    }
    charge(desc.value, `${where}.passages[${i}]`);
    const p = validatePassage(desc.value, `${where}.passages[${i}]`, budget);
    if (seenPassageIds.has(p.passage_id)) fail(where, `duplicate passage_id '${p.passage_id}'`);
    seenPassageIds.add(p.passage_id);
    passages.push(p);
  }
  return { record: "document", doc_id, title, passages };
}

/** One requested claim: multipart atoms plus origin passage references. */
export function validateRequestedClaim(value, where, budget = null) {
  const charge = (obj, what) => { if (budget) budget.chargeObjectOnce(obj, what); };
  // The caller charges this object before delegating; validators charge children, never self.
  if (!isPlainObject(value)) fail(where, "requested claim must be an object");
  assertNoAccessors(value, where);
  exactKeys(value, ["claim_id", "atoms", "origin_passage_refs"], where);
  const claim_id = reqStr(value, "claim_id", where);
  if (!RECORD_ID_RE.test(claim_id)) fail(where, `invalid claim_id '${claim_id}'`);
  const atomsIn = value.atoms;
  if (!Array.isArray(atomsIn) || atomsIn.length === 0 || atomsIn.length > 64) {
    fail(where, "atoms must be a non-empty array of at most 64 atoms");
  }
  assertDenseArray(atomsIn, `${where}.atoms`);
  charge(atomsIn, `${where}.atoms`);
  const atoms = [];
  for (let i = 0; i < atomsIn.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(atomsIn, i);
    if (!desc || typeof desc.get === "function" || typeof desc.set === "function") {
      fail(where, `atoms[${i}] must be a plain data property; refusing`);
    }
    charge(desc.value, `${where}.atoms[${i}]`);
    atoms.push(validateAtom(desc.value, `${where}.atoms[${i}]`, budget));
  }
  const refsIn = value.origin_passage_refs === undefined ? [] : value.origin_passage_refs;
  if (!Array.isArray(refsIn) || refsIn.length > 64) fail(where, "origin_passage_refs must be an array of at most 64 references");
  assertDenseArray(refsIn, `${where}.origin_passage_refs`);
  charge(refsIn, `${where}.origin_passage_refs`);
  const origin_passage_refs = [];
  const seenRefs = new Set();
  for (let i = 0; i < refsIn.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(refsIn, i);
    if (!desc || typeof desc.get === "function" || typeof desc.set === "function") {
      fail(where, `origin_passage_refs[${i}] must be a plain data property; refusing`);
    }
    const r = desc.value;
    const rw = `${where}.origin_passage_refs[${i}]`;
    charge(r, rw);
    if (!isPlainObject(r)) fail(rw, "must be an object");
    assertNoAccessors(r, rw);
    exactKeys(r, ["doc_id", "passage_id"], rw);
    const doc_id = reqStr(r, "doc_id", rw);
    if (!DOC_ID_RE.test(doc_id)) fail(rw, `invalid doc_id '${doc_id}'`);
    const passage_id = reqStr(r, "passage_id", rw);
    if (!PASSAGE_ID_RE.test(passage_id)) fail(rw, `invalid passage_id '${passage_id}'`);
    const key = `${doc_id}|${passage_id}`;
    if (seenRefs.has(key)) fail(where, `duplicate origin passage ref '${key}'`);
    seenRefs.add(key);
    origin_passage_refs.push({ doc_id, passage_id });
  }
  return { claim_id, atoms, origin_passage_refs };
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
  exactKeys(task.fixture_refs, ["evidence_bundle"], "task.fixture_refs");
  charge(task.fixture_refs.evidence_bundle, "task.fixture_refs.evidence_bundle");
  const evidence_bundle_ref = validateSourceRef(task.fixture_refs.evidence_bundle, "task.fixture_refs.evidence_bundle");

  if (!isPlainObject(task.options)) fail("task", "options must be an object");
  charge(task.options, "task.options");
  exactKeys(task.options, ["population", "requested_claims"], "task.options");

  const pop = task.options.population;
  if (!isPlainObject(pop)) fail("task.options.population", "must be an object");
  charge(pop, "task.options.population");
  exactKeys(pop, ["declared_total", "complete"], "task.options.population");
  if (!Number.isInteger(pop.declared_total) || pop.declared_total < 0) fail("task.options.population", "declared_total must be a nonnegative integer");
  if (typeof pop.complete !== "boolean") fail("task.options.population", "complete must be a boolean");

  const claimsIn = task.options.requested_claims === undefined ? [] : task.options.requested_claims;
  if (!Array.isArray(claimsIn) || claimsIn.length > 256) fail("task.options.requested_claims", "must be an array of at most 256 requested claims");
  assertDenseArray(claimsIn, "task.options.requested_claims");
  charge(claimsIn, "task.options.requested_claims");
  const requested_claims = [];
  const seenClaimIds = new Set();
  for (let i = 0; i < claimsIn.length; i++) {
    const desc = Object.getOwnPropertyDescriptor(claimsIn, i);
    if (!desc || typeof desc.get === "function" || typeof desc.set === "function") {
      fail("task.options.requested_claims", `slot ${i} must be a plain data property; refusing`);
    }
    charge(desc.value, `task.options.requested_claims[${i}]`);
    const c = validateRequestedClaim(desc.value, `task.options.requested_claims[${i}]`, budget);
    if (seenClaimIds.has(c.claim_id)) fail("task.options.requested_claims", `duplicate claim_id '${c.claim_id}'`);
    seenClaimIds.add(c.claim_id);
    requested_claims.push(c);
  }

  return {
    task_id,
    operation,
    evidence_bundle_ref,
    population: { declared_total: pop.declared_total, complete: pop.complete },
    requested_claims,
    kind: operation === REQUESTED_OPERATION_ALLOWED ? "analyze" : "prohibited",
  };
}

const WS_CHARS = new Set([" ", "\t", "\n", "\r"]);

function scanScalar(text, i, where) {
  const n = text.length;
  for (const lit of ["true", "false", "null"]) {
    if (text.startsWith(lit, i)) {
      const after = i + lit.length;
      if (after < n && /[A-Za-z0-9_$]/.test(text[after])) fail(where, "evidence bundle is not a valid JSON array");
      return after;
    }
  }
  let j = i;
  while (j < n && /[-+0-9.eE]/.test(text[j])) j++;
  if (j === i) fail(where, "evidence bundle is not a valid JSON array");
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
      if (text[i] < " ") fail(where, "evidence bundle is not a valid JSON array");
      i++;
    }
    fail(where, "evidence bundle is not a valid JSON array");
  }
  const stack = [];
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      i++;
      while (i < n) {
        if (text[i] === "\\") { i += 2; continue; }
        if (text[i] === '"') break;
        if (text[i] < " ") fail(where, "evidence bundle is not a valid JSON array");
        i++;
      }
      if (i >= n) fail(where, "evidence bundle is not a valid JSON array");
      i++;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      const open = stack.pop();
      if ((ch === "}" && open !== "{") || (ch === "]" && open !== "[")) {
        fail(where, "evidence bundle is not a valid JSON array");
      }
      if (stack.length === 0) return i + 1;
    }
    i++;
  }
  fail(where, "evidence bundle is not a valid JSON array");
}

/**
 * splitTopLevelArray(text, where) — bounded-container preflight for the
 * evidence bundle. Returns raw per-element source spans WITHOUT decoding
 * any candidate's fields. Each entry is {text, startByte, endByte} where
 * the byte offsets are half-open UTF-8 ranges into the source text, so the
 * caller can preserve and verify exact byte spans under the span budget.
 * The caller must budget.countObject() each candidate FIRST, then verify
 * its span, then JSON.parse only that candidate's span text.
 */
export function splitTopLevelArray(text, where) {
  if (typeof text !== "string") fail(where, "evidence bundle must be a JSON array");
  const n = text.length;
  let i = 0;
  while (i < n && WS_CHARS.has(text[i])) i++;
  if (i >= n || text[i] !== "[") fail(where, "evidence bundle must be a JSON array");
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
    if (i >= n) fail(where, "evidence bundle is not a valid JSON array");
    if (text[i] === "]") {
      if (afterComma || spans.length > 0) fail(where, "evidence bundle is not a valid JSON array");
      i++;
      while (i < n && WS_CHARS.has(text[i])) i++;
      if (i !== n) fail(where, "evidence bundle has trailing content");
      return spans;
    }
    const start = i;
    const c = text[i];
    if (c === '"' || c === "{" || c === "[") i = scanComposite(text, i, where);
    else if (c === "t" || c === "f" || c === "n" || c === "-" || (c >= "0" && c <= "9") || c === "+") {
      i = scanScalar(text, i, where);
    } else {
      fail(where, "evidence bundle is not a valid JSON array");
    }
    const s = spanAt(start, i);
    bytePos = s._nextBytePos;
    spans.push({ text: s.text, startByte: s.startByte, endByte: s.endByte });
    if (spans.length > MAX_RECORDS_PER_BUNDLE_SCHEMA) fail(where, `evidence bundle exceeds ${MAX_RECORDS_PER_BUNDLE_SCHEMA} entries`);
    afterComma = false;
    const wsStart2 = i;
    while (i < n && WS_CHARS.has(text[i])) i++;
    advance(wsStart2, i);
    if (i >= n) fail(where, "evidence bundle is not a valid JSON array");
    const sep = text[i];
    if (sep === ",") { i++; bytePos += 1; afterComma = true; continue; }
    if (sep === "]") {
      i++; bytePos += 1;
      while (i < n && WS_CHARS.has(text[i])) i++;
      if (i !== n) fail(where, "evidence bundle has trailing content");
      return spans;
    }
    fail(where, "evidence bundle is not a valid JSON array");
  }
}

export { REPO_RE, PATH_RE, RECORD_ID_RE, SLUG_RE, DOC_ID_RE, PASSAGE_ID_RE, GROUP_ID_RE, DERIVATION_KINDS, POLARITIES, VALUE_TYPES };
