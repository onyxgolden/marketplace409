/**
 * jobDefinition.js — JobDefinitionV1: versioned Research assignment job
 * schema + strict validation. P1-A slice only: contract, no transport,
 * no scheduler, no store. Pure Node 24 ESM, zero deps.
 *
 * A validated definition is DATA. It registers nothing, arms nothing,
 * and schedules nothing: recurrence is a stored declarative rule whose
 * next-due instants are computed by recurrence.js preview math only.
 * Every job stays DISABLED — that invariant is enforced here (status
 * must be exactly "DISABLED") and re-asserted by preview.js receipts.
 *
 * Validation discipline (P2a/research-prototype convention): exact
 * keys (unknown fields refuse — a definition can never smuggle a mode,
 * adapter, URL, path, or SQL through extra keys), own-data reads
 * (accessors/proxies refuse without invoking traps), byte-length
 * bounds, and one named refusal code per rejection class.
 */

import { types } from "node:util";
import { CODES, refuse } from "./errors.js";
import { validateRecurrence } from "./recurrence.js";

export const JOB_TYPE = "research";
export const DELIVERABLE_SCHEMA_VERSION = "workbench-item@1";
export const JOB_STATUS = "DISABLED";

/** Hard per-run budget ceilings. A job budget above any ceiling refuses. */
export const BUDGET_CAPS = Object.freeze({
  max_items_per_run: 64,
  max_bytes_per_run: 256 * 1024,
  max_tool_calls_per_run: 64,
});

const JOB_ID_RE = /^research-[a-z][a-z0-9-]{0,63}@([1-9][0-9]*)$/;
const SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/;
const UTC_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const JOB_FIELDS = Object.freeze([
  "job_id", "job_type", "version", "operator_scope", "decision_owner",
  "title", "question", "allowed_source_corpus_ids", "exclusions",
  "deliverable_schema_version", "recurrence", "budget", "status", "provenance",
]);

const SCOPE_FIELDS = Object.freeze(["operator_ref", "workspace_ref"]);
const BUDGET_FIELDS = Object.freeze(["max_items_per_run", "max_bytes_per_run", "max_tool_calls_per_run"]);
const PROVENANCE_FIELDS = Object.freeze(["created_by", "created_at", "updated_by", "updated_at"]);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Trap-free plain-data gate: Proxies, accessors, symbols, functions, and custom prototypes refuse. */
function assertPlainData(value, where) {
  if (value === null || typeof value !== "object") return;
  if (types.isProxy(value)) refuse(CODES.BAD_JOB, `native Proxy at '${where}' is not plain data`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) {
    refuse(CODES.BAD_JOB, `unsupported prototype at '${where}'`);
  }
  for (const k of Object.getOwnPropertyNames(value)) {
    const desc = Object.getOwnPropertyDescriptor(value, k);
    if (!desc) continue;
    if (typeof desc.get === "function" || typeof desc.set === "function") {
      refuse(CODES.BAD_JOB, `accessor property '${where}.${k}' is not plain data`);
    }
    if (typeof desc.value === "function" || typeof desc.value === "symbol") {
      refuse(CODES.BAD_JOB, `non-data property '${where}.${k}' is not plain data`);
    }
    assertPlainData(desc.value, `${where}.${String(k)}`);
  }
  for (const s of Object.getOwnPropertySymbols(value)) {
    refuse(CODES.BAD_JOB, `symbol-keyed property at '${where}' is not plain data`);
  }
}

function exactKeys(obj, allowed, where) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) refuse(CODES.BAD_JOB, `unknown property '${k}' at '${where}'`);
  }
}

function reqStr(obj, key, where, { maxBytes = null } = {}) {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) refuse(CODES.BAD_JOB, `'${where}.${key}' must be a non-empty string`);
  if (maxBytes !== null && Buffer.byteLength(v, "utf8") > maxBytes) {
    refuse(CODES.BAD_JOB, `'${where}.${key}' exceeds ${maxBytes} bytes`);
  }
  return v;
}

function reqInt(obj, key, where, { min = null, max = null } = {}) {
  const v = obj[key];
  if (!Number.isInteger(v)) refuse(CODES.BAD_JOB, `'${where}.${key}' must be an integer`);
  if (min !== null && v < min) refuse(CODES.BAD_JOB, `'${where}.${key}' must be >= ${min}`);
  if (max !== null && v > max) refuse(CODES.BAD_JOB, `'${where}.${key}' must be <= ${max}`);
  return v;
}

function reqUtcInstant(obj, key, where) {
  const v = obj[key];
  if (typeof v !== "string" || !UTC_INSTANT_RE.test(v) || Number.isNaN(Date.parse(v))) {
    refuse(CODES.BAD_JOB, `'${where}.${key}' must be an explicit UTC instant (Zulu)`);
  }
  return v;
}

/**
 * Validate a JobDefinitionV1 object. Returns a normalized deep copy
 * (validated fields only, in canonical field order) so downstream code
 * never re-reads unvalidated input. Throws JobRefusal on any failure.
 *
 * @param {object} def - candidate definition (plain JSON data).
 * @param {object} [options] - options.authorizedCorpusIds: optional
 *   iterable of corpus IDs the operator is authorized for; when given,
 *   any allowed_source_corpus_ids entry outside it refuses with
 *   MISSING_SOURCE_AUTHORIZATION.
 */
export function validateJobDefinition(def, options = {}) {
  assertPlainData(def, "job");
  if (!isPlainObject(def)) refuse(CODES.BAD_JOB, "job must be an object");
  exactKeys(def, JOB_FIELDS, "job");
  for (const f of JOB_FIELDS) {
    if (!(f in def)) refuse(CODES.BAD_JOB, `missing required field '${f}'`);
  }

  // Identity: job_id carries the version; the two must agree.
  const jobId = reqStr(def, "job_id", "job", { maxBytes: 128 });
  const idMatch = JOB_ID_RE.exec(jobId);
  if (!idMatch) refuse(CODES.BAD_JOB_ID, `job_id must match 'research-<slug>@<version>', got '${jobId}'`);
  const version = reqInt(def, "version", "job", { min: 1 });
  if (Number(idMatch[1]) !== version) {
    refuse(CODES.VERSION_MISMATCH, `job_id version ${idMatch[1]} does not match version ${version}`);
  }

  if (def.job_type !== JOB_TYPE) refuse(CODES.BAD_JOB_TYPE, `job_type must be '${JOB_TYPE}'`);

  // Ownership: exactly one identifiable operator, workspace, and decision
  // owner. Any missing/empty owner field is ambiguous ownership.
  const scope = def.operator_scope;
  if (!isPlainObject(scope)) refuse(CODES.AMBIGUOUS_OWNERSHIP, "operator_scope must be an object");
  exactKeys(scope, SCOPE_FIELDS, "job.operator_scope");
  const operatorRef = scope.operator_ref;
  const workspaceRef = scope.workspace_ref;
  if (typeof operatorRef !== "string" || operatorRef.length === 0
    || typeof workspaceRef !== "string" || workspaceRef.length === 0) {
    refuse(CODES.AMBIGUOUS_OWNERSHIP, "operator_ref and workspace_ref must both be non-empty strings");
  }
  if (Buffer.byteLength(operatorRef, "utf8") > 256 || Buffer.byteLength(workspaceRef, "utf8") > 256) {
    refuse(CODES.BAD_JOB, "operator_scope refs exceed 256 bytes");
  }
  const decisionOwner = def.decision_owner;
  if (typeof decisionOwner !== "string" || decisionOwner.length === 0) {
    refuse(CODES.AMBIGUOUS_OWNERSHIP, "decision_owner must be a non-empty string");
  }
  if (Buffer.byteLength(decisionOwner, "utf8") > 256) refuse(CODES.BAD_JOB, "decision_owner exceeds 256 bytes");

  const title = reqStr(def, "title", "job", { maxBytes: 512 });
  const question = reqStr(def, "question", "job", { maxBytes: 4096 });

  // Source authorization: the operator authorizes corpora by listing
  // them. An empty or missing list is missing authorization, not a
  // default-open corpus. When an authorized registry is supplied, any
  // listed ID outside it is likewise unauthorized.
  const corpusIds = def.allowed_source_corpus_ids;
  if (!Array.isArray(corpusIds) || corpusIds.length === 0) {
    refuse(CODES.MISSING_SOURCE_AUTHORIZATION, "allowed_source_corpus_ids must be a non-empty array");
  }
  if (corpusIds.length > 64) refuse(CODES.BAD_JOB, "allowed_source_corpus_ids must have at most 64 entries");
  const seenCorpus = new Set();
  for (let i = 0; i < corpusIds.length; i++) {
    const id = corpusIds[i];
    if (typeof id !== "string" || !SLUG_RE.test(id)) {
      refuse(CODES.BAD_JOB, `allowed_source_corpus_ids[${i}] must be a slug`);
    }
    if (seenCorpus.has(id)) refuse(CODES.DUPLICATE_CORPUS_ID, `duplicate corpus id '${id}'`);
    seenCorpus.add(id);
  }
  if (options.authorizedCorpusIds !== undefined && options.authorizedCorpusIds !== null) {
    const authorized = new Set(options.authorizedCorpusIds);
    for (const id of corpusIds) {
      if (!authorized.has(id)) refuse(CODES.MISSING_SOURCE_AUTHORIZATION, `corpus '${id}' is not authorized`);
    }
  }

  // Exclusions: explicit, well-formed, unique. Exclusions narrow the
  // authorized set at preview time (a corpus both allowed and excluded
  // refuses with EXCLUDED_CORPUS when previewed); they are not a
  // contradiction at definition time.
  const exclusions = def.exclusions;
  if (!Array.isArray(exclusions)) refuse(CODES.BAD_EXCLUSION, "exclusions must be an array");
  if (exclusions.length > 64) refuse(CODES.BAD_EXCLUSION, "exclusions must have at most 64 entries");
  const seenExcl = new Set();
  for (let i = 0; i < exclusions.length; i++) {
    const e = exclusions[i];
    if (typeof e !== "string" || e.length === 0 || Buffer.byteLength(e, "utf8") > 256) {
      refuse(CODES.BAD_EXCLUSION, `exclusions[${i}] must be a non-empty string of at most 256 bytes`);
    }
    if (seenExcl.has(e)) refuse(CODES.BAD_EXCLUSION, `duplicate exclusion '${e}'`);
    seenExcl.add(e);
  }

  if (def.deliverable_schema_version !== DELIVERABLE_SCHEMA_VERSION) {
    refuse(CODES.UNSUPPORTED_DELIVERABLE_VERSION, `deliverable_schema_version must be '${DELIVERABLE_SCHEMA_VERSION}'`);
  }

  const recurrence = validateRecurrence(def.recurrence);

  // Budget: integers; above any hard ceiling is excessive, not merely large.
  const budget = def.budget;
  if (!isPlainObject(budget)) refuse(CODES.BAD_JOB, "budget must be an object");
  exactKeys(budget, BUDGET_FIELDS, "job.budget");
  const budgetOut = {};
  for (const field of BUDGET_FIELDS) {
    if (!(field in budget)) refuse(CODES.BAD_JOB, `missing budget field '${field}'`);
    const v = budget[field];
    if (!Number.isInteger(v)) refuse(CODES.BAD_JOB, `budget.${field} must be an integer`);
    const min = field === "max_tool_calls_per_run" ? 0 : 1;
    if (v < min) refuse(CODES.BAD_JOB, `budget.${field} must be >= ${min}`);
    if (v > BUDGET_CAPS[field]) refuse(CODES.EXCESSIVE_BUDGET, `budget.${field} ${v} exceeds cap ${BUDGET_CAPS[field]}`);
    budgetOut[field] = v;
  }

  // DISABLED invariant: any other status — including a missing one
  // (caught above as a missing field) — refuses. There is no code path
  // in this slice that turns a caller-supplied value into a live job.
  if (def.status !== JOB_STATUS) {
    refuse(CODES.NON_DISABLED_STATUS, `status must be '${JOB_STATUS}', got '${String(def.status)}'`);
  }

  const provenance = def.provenance;
  if (!isPlainObject(provenance)) refuse(CODES.BAD_PROVENANCE, "provenance must be an object");
  exactKeys(provenance, PROVENANCE_FIELDS, "job.provenance");
  const createdBy = reqStr(provenance, "created_by", "job.provenance", { maxBytes: 256 });
  const createdAt = reqUtcInstant(provenance, "created_at", "job.provenance");
  let updatedBy;
  let updatedAt;
  if ("updated_by" in provenance || "updated_at" in provenance) {
    if (!("updated_by" in provenance) || !("updated_at" in provenance)) {
      refuse(CODES.BAD_PROVENANCE, "updated_by and updated_at must appear together");
    }
    updatedBy = reqStr(provenance, "updated_by", "job.provenance", { maxBytes: 256 });
    updatedAt = reqUtcInstant(provenance, "updated_at", "job.provenance");
    if (Date.parse(updatedAt) < Date.parse(createdAt)) {
      refuse(CODES.BAD_PROVENANCE, "updated_at must not precede created_at");
    }
  }

  return {
    job_id: jobId,
    job_type: JOB_TYPE,
    version,
    operator_scope: { operator_ref: operatorRef, workspace_ref: workspaceRef },
    decision_owner: decisionOwner,
    title,
    question,
    allowed_source_corpus_ids: [...corpusIds],
    exclusions: [...exclusions],
    deliverable_schema_version: DELIVERABLE_SCHEMA_VERSION,
    recurrence,
    budget: budgetOut,
    status: JOB_STATUS,
    provenance: updatedBy === undefined
      ? { created_by: createdBy, created_at: createdAt }
      : { created_by: createdBy, created_at: createdAt, updated_by: updatedBy, updated_at: updatedAt },
  };
}
