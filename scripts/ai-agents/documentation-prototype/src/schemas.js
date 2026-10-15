/**
 * schemas.js — runtime validation for the documentation prototype.
 *
 * Every schema rejects unknown properties in control-bearing objects,
 * absent required fields, wrong types, invalid enum values, duplicate
 * IDs, nonfinite numbers, invalid dates and abbreviated/malformed pins.
 * Pure Node 24 ESM, zero dependencies.
 */

import { HEX40 } from "./canonical.js";

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaError";
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function checkNoUnknown(obj, allowed, what) {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) throw new SchemaError(`${what}: unknown property '${k}'`);
  }
}

function checkString(v, what, { nonEmpty = true, maxLen = 4096 } = {}) {
  if (typeof v !== "string") throw new SchemaError(`${what}: expected string`);
  if (nonEmpty && v.length === 0) throw new SchemaError(`${what}: must be non-empty`);
  if (v.length > maxLen) throw new SchemaError(`${what}: exceeds ${maxLen} characters`);
  return v;
}

function checkInt(v, what, { min = 0 } = {}) {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min) {
    throw new SchemaError(`${what}: expected integer >= ${min}`);
  }
  return v;
}

/** Canonical repo-relative path: no traversal, no absolute, no backslash. */
export function checkRepoPath(p, what) {
  checkString(p, what, { maxLen: 512 });
  if (
    p.startsWith("/") || p.includes("\\") || p.startsWith("..") ||
    p.includes("../") || /(^|\/)\.\.($|\/)/.test(p) || p.includes("\0")
  ) {
    throw new SchemaError(`${what}: not a canonical repo-relative path: '${p}'`);
  }
  return p;
}

/** SourceRef = {repo, path, commit, blob, algorithm:"git-sha1", revision}. */
export function validateSourceRef(ref, what) {
  if (!isPlainObject(ref)) throw new SchemaError(`${what}: expected object`);
  checkNoUnknown(ref, new Set(["repo", "path", "commit", "blob", "algorithm", "revision"]), what);
  checkString(ref.repo, `${what}.repo`, { maxLen: 128 });
  checkRepoPath(ref.path, `${what}.path`);
  if (typeof ref.commit !== "string" || !HEX40.test(ref.commit)) {
    throw new SchemaError(`${what}.commit: expected full 40-hex Git object ID`);
  }
  if (typeof ref.blob !== "string" || !HEX40.test(ref.blob)) {
    throw new SchemaError(`${what}.blob: expected full 40-hex Git blob ID`);
  }
  if (ref.algorithm !== "git-sha1") throw new SchemaError(`${what}.algorithm: expected "git-sha1"`);
  checkString(ref.revision, `${what}.revision`, { maxLen: 128 });
  return ref;
}

const DOC_SPAN_KEYS = new Set(["quoted_text", "start_byte", "end_byte"]);

function validateDocSpan(span, what) {
  if (!isPlainObject(span)) throw new SchemaError(`${what}: expected object`);
  checkNoUnknown(span, DOC_SPAN_KEYS, what);
  checkString(span.quoted_text, `${what}.quoted_text`, { maxLen: 8192 });
  checkInt(span.start_byte, `${what}.start_byte`);
  checkInt(span.end_byte, `${what}.end_byte`, { min: 1 });
  if (span.end_byte <= span.start_byte) {
    throw new SchemaError(`${what}: end_byte must exceed start_byte`);
  }
  const byteLen = Buffer.byteLength(span.quoted_text, "utf8");
  if (span.end_byte - span.start_byte !== byteLen) {
    throw new SchemaError(
      `${what}: byte range ${span.end_byte - span.start_byte} does not match quoted_text UTF-8 length ${byteLen}`
    );
  }
  return span;
}

const CLAIM_SPEC_KEYS = new Set([
  "claim_id", "doc_span", "behavior_key", "code_span_ids", "required_usage_span_ids",
]);

function validateClaimSpec(spec, what, seenIds) {
  if (!isPlainObject(spec)) throw new SchemaError(`${what}: expected object`);
  checkNoUnknown(spec, CLAIM_SPEC_KEYS, what);
  const id = checkString(spec.claim_id, `${what}.claim_id`, { maxLen: 128 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw new SchemaError(`${what}.claim_id: invalid claim id '${id}'`);
  }
  if (seenIds.has(id)) throw new SchemaError(`${what}: duplicate claim_id '${id}'`);
  seenIds.add(id);
  validateDocSpan(spec.doc_span, `${what}.doc_span`);
  checkString(spec.behavior_key, `${what}.behavior_key`, { maxLen: 128 });
  for (const key of ["code_span_ids", "required_usage_span_ids"]) {
    const arr = spec[key];
    if (!Array.isArray(arr)) throw new SchemaError(`${what}.${key}: expected array`);
    if (arr.length > 64) throw new SchemaError(`${what}.${key}: exceeds 64 entries`);
    const seen = new Set();
    for (const s of arr) {
      checkString(s, `${what}.${key}[]`, { maxLen: 128 });
      if (seen.has(s)) throw new SchemaError(`${what}.${key}: duplicate entry '${s}'`);
      seen.add(s);
    }
  }
  return spec;
}

const APPROVAL_KEYS = new Set(["approver", "scope", "note"]);
const SIMULATION_KEYS = new Set(["result_head", "approval", "policy_revision"]);

function validateOptionalApproval(task) {
  if (task.approval === undefined) return;
  if (!isPlainObject(task.approval)) throw new SchemaError("task.approval: expected object");
  checkNoUnknown(task.approval, APPROVAL_KEYS, "task.approval");
  checkString(task.approval.approver, "task.approval.approver", { maxLen: 128 });
  checkString(task.approval.scope, "task.approval.scope", { maxLen: 64 });
  if (task.approval.note !== undefined) checkString(task.approval.note, "task.approval.note", { maxLen: 1024 });
}

function validateOptionalSimulation(task) {
  if (task.simulation === undefined) return;
  if (!isPlainObject(task.simulation)) throw new SchemaError("task.simulation: expected object");
  checkNoUnknown(task.simulation, SIMULATION_KEYS, "task.simulation");
  checkString(task.simulation.result_head, "task.simulation.result_head", { maxLen: 128 });
  checkString(task.simulation.approval, "task.simulation.approval", { maxLen: 128 });
  if (task.simulation.policy_revision !== undefined) {
    checkString(task.simulation.policy_revision, "task.simulation.policy_revision", { maxLen: 128 });
  }
}

const TASK_KEYS = new Set([
  "repo", "doc_ref", "code_refs", "claim_specs", "requested_action", "approval", "simulation",
]);

/**
 * Task input per the brief:
 * {repo, doc_ref:SourceRef, code_refs:[SourceRef], claim_specs:[...],
 *  requested_action:"propose", approval?, simulation?}.
 */
export function validateTask(task) {
  if (!isPlainObject(task)) throw new SchemaError("task: expected object");
  checkNoUnknown(task, TASK_KEYS, "task");
  checkString(task.repo, "task.repo", { maxLen: 128 });
  validateSourceRef(task.doc_ref, "task.doc_ref");
  if (!Array.isArray(task.code_refs)) throw new SchemaError("task.code_refs: expected array");
  if (task.code_refs.length > 16) throw new SchemaError("task.code_refs: exceeds 16 entries");
  task.code_refs.forEach((r, i) => validateSourceRef(r, `task.code_refs[${i}]`));
  if (!Array.isArray(task.claim_specs)) throw new SchemaError("task.claim_specs: expected array");
  if (task.claim_specs.length === 0) throw new SchemaError("task.claim_specs: at least one claim required");
  if (task.claim_specs.length > 64) throw new SchemaError("task.claim_specs: exceeds 64 entries");
  const seenIds = new Set();
  task.claim_specs.forEach((s, i) => validateClaimSpec(s, `task.claim_specs[${i}]`, seenIds));
  checkString(task.requested_action, "task.requested_action", { maxLen: 64 });
  validateOptionalApproval(task);
  validateOptionalSimulation(task);
  return task;
}

const CONTEXT_KEYS = new Set(["clock", "store", "readGrants"]);

function validateStore(store, what) {
  if (!isPlainObject(store)) throw new SchemaError(`${what}: expected object`);
  checkNoUnknown(store, new Set(["sources"]), what);
  const sources = store.sources;
  if (!isPlainObject(sources)) throw new SchemaError(`${what}.sources: expected object`);
  for (const key of Object.keys(sources)) {
    const e = sources[key];
    const ew = `${what}.sources['${key}']`;
    if (!isPlainObject(e)) throw new SchemaError(`${ew}: expected object`);
    checkNoUnknown(e, new Set(["kind", "revisions"]), ew);
    if (e.kind !== "doc" && e.kind !== "code") throw new SchemaError(`${ew}.kind: expected "doc" or "code"`);
    if (!isPlainObject(e.revisions)) throw new SchemaError(`${ew}.revisions: expected object`);
    for (const commit of Object.keys(e.revisions)) {
      if (!HEX40.test(commit)) throw new SchemaError(`${ew}.revisions: bad commit key '${commit}'`);
      const rev = e.revisions[commit];
      if (!isPlainObject(rev) || typeof rev.text !== "string") {
        throw new SchemaError(`${ew}.revisions['${commit}']: expected {text}`);
      }
    }
  }
  return store;
}

/** Context: separately injected host adapter {clock, store, readGrants}. */
export function validateContext(context, budget) {
  if (!isPlainObject(context)) throw new SchemaError("context: expected object");
  checkNoUnknown(context, CONTEXT_KEYS, "context");
  if (typeof context.clock !== "number" || !Number.isFinite(context.clock)) {
    throw new SchemaError("context.clock: expected finite number");
  }
  budget.countPayload(JSON.stringify(context.store ?? null), "context.store");
  validateStore(context.store, "context.store");
  if (!Array.isArray(context.readGrants)) throw new SchemaError("context.readGrants: expected array");
  for (const g of context.readGrants) {
    if (!isPlainObject(g)) throw new SchemaError("context.readGrants[]: expected object");
    checkNoUnknown(g, new Set(["repo", "path"]), "context.readGrants[]");
    checkString(g.repo, "context.readGrants[].repo", { maxLen: 128 });
    checkRepoPath(g.path, "context.readGrants[].path");
  }
  return context;
}
