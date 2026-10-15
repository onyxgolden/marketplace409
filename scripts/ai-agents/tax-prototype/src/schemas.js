/**
 * schemas.js — runtime validation for the Tax Agent educational-draft
 * prototype. Strict: rejects unknown properties in control-bearing
 * objects, absent required fields, wrong types, invalid enum values,
 * duplicate IDs, nonfinite numbers, invalid dates and abbreviated/
 * malformed pins. Pure Node 24 ESM, zero dependencies.
 */

import { HEX40 } from "./canonical.js";

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaError";
  }
}

const SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/;
const PATH_RE = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*\.(md|txt)$/;
const REPO_RE = /^[a-z][a-z0-9-]{0,63}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const JURISDICTIONS = ["US-FEDERAL"];
export const MODES = ["current_education", "historical_education"];
export const REQUESTED_ACTION_ALLOWED = "draft_education";
export const SUPPORTED_YEARS_MIN = 2020;
export const SUPPORTED_YEARS_MAX = 2026;
export const CURRENT_YEARS = [2024, 2025, 2026];
export const HISTORICAL_YEARS = [2020, 2021, 2022, 2023];

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

/** Real calendar date or finite UTC ISO timestamp with Z. */
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

/** Steward registration (authenticated record shape, fixture adapter). */
export function validateSteward(value, where) {
  if (!isPlainObject(value)) fail(where, "steward must be an object");
  exactKeys(value, ["steward_id", "registered_by", "revoked", "valid_from", "expires_at"], where);
  const steward_id = validateRecordId(value.steward_id, where);
  const registered_by = reqStr(value, "registered_by", where);
  if (registered_by !== "jason") fail(where, "registered_by must be 'jason'");
  if (typeof value.revoked !== "boolean") fail(where, "revoked must be a boolean");
  validateIsoDate(value.valid_from, `${where}.valid_from`);
  validateIsoDate(value.expires_at, `${where}.expires_at`);
  return { steward_id, registered_by, revoked: value.revoked, valid_from: value.valid_from, expires_at: value.expires_at };
}

/** Steward action registration (what a steward may do). */
export function validateRegistration(value, where) {
  if (!isPlainObject(value)) fail(where, "registration must be an object");
  exactKeys(value, ["registration_ref", "steward_id", "action_ids", "valid_from", "expires_at", "revoked"], where);
  const registration_ref = validateRecordId(value.registration_ref, where);
  const steward_id = validateRecordId(value.steward_id, where);
  if (!Array.isArray(value.action_ids) || value.action_ids.length === 0) fail(where, "action_ids must be a non-empty array");
  for (const a of value.action_ids) {
    if (typeof a !== "string" || a.length === 0) fail(where, "action_ids must be non-empty strings");
  }
  validateIsoDate(value.valid_from, `${where}.valid_from`);
  validateIsoDate(value.expires_at, `${where}.expires_at`);
  if (typeof value.revoked !== "boolean") fail(where, "revoked must be a boolean");
  return { registration_ref, steward_id, action_ids: [...value.action_ids], valid_from: value.valid_from, expires_at: value.expires_at, revoked: value.revoked };
}

/** Simulated professional-review record. Never claims real CPA sign-off. */
export function validateReviewRecord(value, where) {
  if (!isPlainObject(value)) fail(where, "review record must be an object");
  exactKeys(value, ["review_record_ref", "topic_id", "reviewer_role", "registration_ref", "reviewed_through", "revoked", "simulated"], where);
  const review_record_ref = validateRecordId(value.review_record_ref, where);
  const topic_id = reqStr(value, "topic_id", where);
  if (!SLUG_RE.test(topic_id)) fail(where, `invalid topic_id '${topic_id}'`);
  if (value.reviewer_role !== "LICENSED_TAX_PROFESSIONAL") fail(where, "reviewer_role must be 'LICENSED_TAX_PROFESSIONAL'");
  const registration_ref = validateRecordId(value.registration_ref, where);
  validateIsoDate(value.reviewed_through, `${where}.reviewed_through`);
  if (typeof value.revoked !== "boolean") fail(where, "revoked must be a boolean");
  if (value.simulated !== true) fail(where, "simulated must be true — a review record never claims real CPA sign-off");
  return { review_record_ref, topic_id, reviewer_role: value.reviewer_role, registration_ref, reviewed_through: value.reviewed_through, revoked: value.revoked, simulated: true };
}

function validateClaim(value, where) {
  if (!isPlainObject(value)) fail(where, "claim must be an object");
  exactKeys(value, ["claim_id", "concept_key", "template_id", "text", "source_ref"], where);
  const claim_id = validateRecordId(value.claim_id, where);
  const concept_key = reqStr(value, "concept_key", where);
  if (!SLUG_RE.test(concept_key)) fail(where, `invalid concept_key '${concept_key}'`);
  const template_id = reqStr(value, "template_id", where);
  if (!SLUG_RE.test(template_id)) fail(where, `invalid template_id '${template_id}'`);
  const text = reqStr(value, "text", where, { maxBytes: 8192 });
  const source_ref = validateSourceRef(value.source_ref, `${where}.source_ref`);
  return { claim_id, concept_key, template_id, text, source_ref };
}

function validateCoverageBlock(value, where) {
  if (!isPlainObject(value)) fail(where, "coverage block must be an object");
  exactKeys(value, ["tax_year_from", "tax_year_to", "effective_from", "reviewed_through", "claims"], where);
  const from = value.tax_year_from;
  const to = value.tax_year_to;
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) fail(where, "tax_year_from/tax_year_to must be integers with to >= from");
  validateIsoDate(value.effective_from, `${where}.effective_from`);
  validateIsoDate(value.reviewed_through, `${where}.reviewed_through`);
  if (!Array.isArray(value.claims) || value.claims.length === 0) fail(where, "claims must be a non-empty array");
  const claims = value.claims.map((c, i) => validateClaim(c, `${where}.claims[${i}]`));
  const seen = new Set();
  for (const c of claims) {
    if (seen.has(c.claim_id)) fail(where, `duplicate claim_id '${c.claim_id}'`);
    seen.add(c.claim_id);
  }
  return { tax_year_from: from, tax_year_to: to, effective_from: value.effective_from, reviewed_through: value.reviewed_through, claims };
}

/** TopicRegistryEntry: the approved-topic registry, injected via context only. */
export function validateRegistryEntry(value, where) {
  if (!isPlainObject(value)) fail(where, "registry entry must be an object");
  exactKeys(value, ["topic_id", "topic_label", "entry_version", "jurisdiction", "steward_id", "registration_ref", "review_record_ref", "current", "historical"], where);
  const topic_id = reqStr(value, "topic_id", where);
  if (!SLUG_RE.test(topic_id)) fail(where, `invalid topic_id '${topic_id}'`);
  const topic_label = reqStr(value, "topic_label", where, { maxBytes: 256 });
  const entry_version = reqStr(value, "entry_version", where);
  if (!JURISDICTIONS.includes(value.jurisdiction)) fail(where, `invalid jurisdiction '${value.jurisdiction}'`);
  const steward_id = validateRecordId(value.steward_id, where);
  const registration_ref = validateRecordId(value.registration_ref, where);
  const review_record_ref = validateRecordId(value.review_record_ref, where);
  let current = null;
  if (value.current !== null && value.current !== undefined) current = validateCoverageBlock(value.current, `${where}.current`);
  let historical = null;
  if (value.historical !== null && value.historical !== undefined) historical = validateCoverageBlock(value.historical, `${where}.historical`);
  if (!current && !historical) fail(where, "registry entry must declare at least one of current/historical coverage");
  return { topic_id, topic_label, entry_version, jurisdiction: value.jurisdiction, steward_id, registration_ref, review_record_ref, current, historical };
}

/** Task input schema. kind: "draft" | "prohibited". */
export function validateTask(task) {
  if (!isPlainObject(task)) fail("task", "must be an object");
  exactKeys(task, ["task_id", "requested_action", "topic_id", "topic_label", "jurisdiction", "tax_year", "as_of_date", "mode", "source_refs"], "task");
  const task_id = reqStr(task, "task_id", "task", { maxBytes: 2048 });
  const requested_action = reqStr(task, "requested_action", "task", { maxBytes: 256 });
  const topic_id = reqStr(task, "topic_id", "task", { maxBytes: 256 });
  const topic_label = reqStr(task, "topic_label", "task", { maxBytes: 4096 });
  const jurisdiction = reqStr(task, "jurisdiction", "task", { maxBytes: 64 });
  if (!JURISDICTIONS.includes(jurisdiction)) fail("task", `jurisdiction '${jurisdiction}' is not an allowlisted fixture lane`);
  const tax_year = task.tax_year;
  if (!Number.isInteger(tax_year)) fail("task", "tax_year must be an integer");
  if (tax_year < SUPPORTED_YEARS_MIN || tax_year > SUPPORTED_YEARS_MAX) fail("task", `tax_year ${tax_year} is not a supported fixture year`);
  const as_of_date = reqStr(task, "as_of_date", "task");
  validateIsoDate(as_of_date, "task.as_of_date");
  const mode = reqStr(task, "mode", "task");
  if (!MODES.includes(mode)) fail("task", `mode '${mode}' must be one of ${MODES.join(", ")}`);
  let source_refs = [];
  if (task.source_refs !== undefined && task.source_refs !== null) {
    if (!Array.isArray(task.source_refs)) fail("task", "source_refs must be an array");
    if (task.source_refs.length > 8) fail("task", "source_refs exceeds 8 bounded entries");
    source_refs = task.source_refs.map((r, i) => validateSourceRef(r, `task.source_refs[${i}]`));
  }
  return {
    task_id,
    requested_action,
    topic_id,
    topic_label,
    jurisdiction,
    tax_year,
    as_of_date,
    mode,
    source_refs,
    kind: requested_action === REQUESTED_ACTION_ALLOWED ? "draft" : "prohibited",
  };
}

/** Read grant: exact repo+path (control-bearing, exact keys). */
export function validateReadGrant(value, where) {
  if (!isPlainObject(value)) fail(where, "read grant must be an object");
  exactKeys(value, ["repo", "path"], where);
  const repo = reqStr(value, "repo", where);
  if (!REPO_RE.test(repo)) fail(where, `invalid repo '${repo}'`);
  const path = reqStr(value, "path", where);
  if (!PATH_RE.test(path)) fail(where, `invalid path '${path}'`);
  return { repo, path };
}

/** Metadata-only projection for byte accounting: drops every `text`
 *  property WITHOUT reading it (Object.keys never fires getters). */
function metadataWithoutText(value) {
  if (Array.isArray(value)) return value.map(metadataWithoutText);
  if (isPlainObject(value)) {
    const out = {};
    for (const k of Object.keys(value)) {
      if (k === "text") continue;
      out[k] = metadataWithoutText(value[k]);
    }
    return out;
  }
  return value;
}

export function validateContext(context, budget = null) {
  const charge = (what) => { if (budget) budget.countConsulted(what); };
  const chargeBytes = (obj, what) => { if (budget) budget.countPayload(JSON.stringify(obj), what); };
  if (!isPlainObject(context)) fail("context", "must be an object");
  exactKeys(context, ["clock", "registry", "sources", "readGrants", "stewards", "registrations", "reviewRecords"], "context");
  const clock = context.clock;
  if (!Number.isFinite(clock)) fail("context", "clock must be a finite number");

  if (!Array.isArray(context.registry) || context.registry.length === 0) fail("context", "registry must be a non-empty array");
  const registry = context.registry.map((e, i) => { charge("registry entry"); chargeBytes(e, `registry entry ${i} payload`); return validateRegistryEntry(e, `context.registry[${i}]`); });
  const topicSeen = new Set();
  for (const e of registry) {
    if (topicSeen.has(e.topic_id)) fail("context", `duplicate registry topic_id '${e.topic_id}'`);
    topicSeen.add(e.topic_id);
  }

  if (!isPlainObject(context.sources)) fail("context", "sources must be an object");
  const sourceKeys = Object.keys(context.sources);
  if (sourceKeys.length === 0 || sourceKeys.length > 64) fail("context", "sources must have 1..64 entries");
  for (const sk of sourceKeys) {
    charge("source entry");
    const entry = context.sources[sk];
    if (!isPlainObject(entry)) fail("context", `source '${sk}' must be an object`);
    const revs = entry.revisions;
    if (!isPlainObject(revs)) fail("context", `source '${sk}' revisions must be an object`);
    chargeBytes(metadataWithoutText(entry), `source '${sk}' metadata payload`);
    for (const commit of Object.keys(revs)) {
      charge("revision ledger entry");
      const rev = revs[commit];
      if (!isPlainObject(rev)) fail("context", `source '${sk}' revision '${commit}' must be an object`);
      validateIsoDate(rev.effective_at, `context.sources['${sk}'].revisions[${commit}].effective_at`);
      validateIsoDate(rev.verified_at, `context.sources['${sk}'].revisions[${commit}].verified_at`);
      if (typeof rev.blob !== "string" || !HEX40.test(rev.blob)) {
        fail("context", `source '${sk}' revision '${commit}' blob must be a 40-hex Git object ID`);
      }
    }
  }

  if (!Array.isArray(context.readGrants)) fail("context", "readGrants must be an array");
  const readGrants = context.readGrants.map((g, i) => { charge("read grant"); chargeBytes(g, `read grant ${i} payload`); return validateReadGrant(g, `context.readGrants[${i}]`); });

  if (!Array.isArray(context.stewards)) fail("context", "stewards must be an array");
  const stewards = context.stewards.map((s, i) => { charge("steward"); chargeBytes(s, `steward ${i} payload`); return validateSteward(s, `context.stewards[${i}]`); });
  const stewardSeen = new Set();
  for (const s of stewards) {
    if (stewardSeen.has(s.steward_id)) fail("context", `duplicate steward_id '${s.steward_id}'`);
    stewardSeen.add(s.steward_id);
  }

  if (!Array.isArray(context.registrations)) fail("context", "registrations must be an array");
  const registrations = context.registrations.map((r, i) => { charge("registration"); chargeBytes(r, `registration ${i} payload`); return validateRegistration(r, `context.registrations[${i}]`); });
  const regSeen = new Set();
  for (const r of registrations) {
    if (regSeen.has(r.registration_ref)) fail("context", `duplicate registration_ref '${r.registration_ref}'`);
    regSeen.add(r.registration_ref);
  }

  if (!Array.isArray(context.reviewRecords)) fail("context", "reviewRecords must be an array");
  const reviewRecords = context.reviewRecords.map((r, i) => { charge("review record"); chargeBytes(r, `review record ${i} payload`); return validateReviewRecord(r, `context.reviewRecords[${i}]`); });
  const revSeen = new Set();
  for (const r of reviewRecords) {
    if (revSeen.has(r.review_record_ref)) fail("context", `duplicate review_record_ref '${r.review_record_ref}'`);
    revSeen.add(r.review_record_ref);
  }

  return { clock, registry, sources: context.sources, readGrants, stewards, registrations, reviewRecords };
}

export { SLUG_RE, PATH_RE, REPO_RE, RECORD_ID_RE };
