/**
 * schemas.js — runtime validation for the knowledge-vault prototype.
 * Strict: rejects unknown properties in control-bearing objects, absent
 * required fields, wrong types, invalid enum values, duplicate IDs,
 * nonfinite numbers, invalid dates and abbreviated/malformed pins.
 * Pure Node 24 ESM, zero dependencies.
 */

import { HEX40, canonicalJson } from "./canonical.js";

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaError";
  }
}

const CLAIM_KEY_RE = /^[a-z][a-z0-9-]{0,63}$/;
const SCOPE_RE = /^[a-z][a-z0-9-]{0,63}$/;
// Canonical repo-relative allowlisted paths: lowercase segments, no
// traversal, no absolute paths, no symlinks, no alternate roots.
const PATH_RE = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*\.(md|txt)$/;
const REPO_RE = /^[a-z][a-z0-9-]{0,63}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function fail(where, msg) {
  throw new SchemaError(`${where}: ${msg}`);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Exact-keys check for control-bearing objects. */
function exactKeys(obj, allowed, where) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) fail(where, `unknown property '${k}'`);
  }
}

function reqStr(obj, key, where, { allowEmpty = false } = {}) {
  const v = obj[key];
  if (typeof v !== "string" || (!allowEmpty && v.length === 0)) fail(where, `'${key}' must be a non-empty string`);
  return v;
}

function optStr(obj, key, where) {
  const v = obj[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") fail(where, `'${key}' must be a string`);
  return v;
}

/** Real calendar date or finite UTC ISO timestamp with Z. */
export function validateIsoDate(value, where) {
  if (typeof value !== "string") fail(where, "must be a string");
  if (!ISO_RE.test(value)) fail(where, "must be YYYY-MM-DDTHH:MM:SSZ");
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail(where, "not a real calendar date");
  // Reject impossible calendar dates that Date.parse normalizes (e.g. 2026-02-30).
  const d = new Date(ms);
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const mo = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const da = d.getUTCDate().toString().padStart(2, "0");
  if (`${y}-${mo}-${da}T` !== value.slice(0, 11)) fail(where, "not a real calendar date");
  return ms;
}

function validateScopeIds(value, where) {
  if (!Array.isArray(value) || value.length === 0) fail(where, "scope_ids must be a non-empty array");
  const seen = new Set();
  for (const s of value) {
    if (typeof s !== "string" || !SCOPE_RE.test(s)) fail(where, `invalid scope id '${String(s)}'`);
    if (seen.has(s)) fail(where, `duplicate scope id '${s}'`);
    seen.add(s);
  }
  return [...value];
}

function validateRecordId(value, where) {
  const v = reqStr({ v: value }, "v", where);
  if (!RECORD_ID_RE.test(v)) fail(where, `invalid record id '${v}'`);
  return v;
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

/** Citation = SourceRef + quoted_span/span/verification. */
export function validateCitation(value, where) {
  if (!isPlainObject(value)) fail(where, "Citation must be an object");
  exactKeys(value, ["repo", "path", "commit", "blob", "algorithm", "revision", "quoted_span", "span", "verification"], where);
  const ref = validateSourceRef(
    { repo: value.repo, path: value.path, commit: value.commit, blob: value.blob, algorithm: value.algorithm, revision: value.revision },
    where
  );
  const quoted = reqStr(value, "quoted_span", where);
  const span = value.span;
  if (!isPlainObject(span)) fail(where, "span must be an object");
  exactKeys(span, ["start_byte", "end_byte", "quoted_text"], `${where}.span`);
  const sb = span.start_byte;
  const eb = span.end_byte;
  if (!Number.isInteger(sb) || sb < 0) fail(where, "span.start_byte must be a non-negative integer");
  if (!Number.isInteger(eb) || eb <= sb) fail(where, "span.end_byte must be an integer greater than start_byte");
  const qt = reqStr(span, "quoted_text", `${where}.span`, { allowEmpty: true });
  if (quoted !== qt) fail(where, "quoted_span and span.quoted_text must be exactly equal");
  if (value.verification !== "VERIFIED") fail(where, "verification must be 'VERIFIED'");
  return { ...ref, quoted_span: quoted, span: { start_byte: sb, end_byte: eb, quoted_text: qt }, verification: "VERIFIED" };
}

/** Steward registration (authenticated record shape, fixture adapter). */
export function validateSteward(value, where) {
  if (!isPlainObject(value)) fail(where, "steward must be an object");
  exactKeys(value, ["steward_id", "registered_by", "authority_scope_ids", "revoked", "valid_from", "expires_at"], where);
  const steward_id = validateRecordId(value.steward_id, where);
  const registered_by = reqStr(value, "registered_by", where);
  if (registered_by !== "jason") fail(where, "registered_by must be 'jason'");
  const authority_scope_ids = validateScopeIds(value.authority_scope_ids, where);
  if (typeof value.revoked !== "boolean") fail(where, "revoked must be a boolean");
  validateIsoDate(value.valid_from, `${where}.valid_from`);
  validateIsoDate(value.expires_at, `${where}.expires_at`);
  return { steward_id, registered_by, authority_scope_ids, revoked: value.revoked, valid_from: value.valid_from, expires_at: value.expires_at };
}

/** Steward action registration (what a steward may do). */
export function validateRegistration(value, where) {
  if (!isPlainObject(value)) fail(where, "registration must be an object");
  exactKeys(value, ["registration_ref", "steward_id", "action_ids", "valid_from", "expires_at", "revoked", "applicability"], where);
  const registration_ref = validateRecordId(value.registration_ref, where);
  const steward_id = validateRecordId(value.steward_id, where);
  if (!Array.isArray(value.action_ids) || value.action_ids.length === 0) fail(where, "action_ids must be a non-empty array");
  for (const a of value.action_ids) {
    if (typeof a !== "string" || a.length === 0) fail(where, "action_ids must be non-empty strings");
  }
  validateIsoDate(value.valid_from, `${where}.valid_from`);
  validateIsoDate(value.expires_at, `${where}.expires_at`);
  if (typeof value.revoked !== "boolean") fail(where, "revoked must be a boolean");
  // Exact applicability: a registration authorizing 'supersede' must
  // declare exactly which scopes and source keys the steward may
  // supersede. The record's old/new source keys and every record scope
  // must fall inside it — generic "may supersede anything" grants are
  // not valid. KVP-001 round 3: source keys alone never authorize an
  // arbitrary revision pair. The registration must declare the exact
  // old/new pin transitions it authorizes; a record's pins must match
  // one declared transition exactly (repo, path, commit, blob).
  let applicability = null;
  if (value.applicability !== undefined && value.applicability !== null) {
    const app = value.applicability;
    if (!isPlainObject(app)) fail(where, "applicability must be an object");
    exactKeys(app, ["scope_ids", "source_keys", "transitions"], `${where}.applicability`);
    const scope_ids = validateScopeIds(app.scope_ids, `${where}.applicability`);
    if (!Array.isArray(app.source_keys) || app.source_keys.length === 0) {
      fail(where, "applicability.source_keys must be a non-empty array");
    }
    const source_keys = [];
    const seen = new Set();
    for (const k of app.source_keys) {
      if (typeof k !== "string" || !/^[a-z][a-z0-9-]{0,63}\|[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*\.(md|txt)$/.test(k)) {
        fail(where, `invalid applicability source key '${String(k)}'`);
      }
      if (seen.has(k)) fail(where, `duplicate applicability source key '${k}'`);
      seen.add(k);
      source_keys.push(k);
    }
    let transitions = [];
    if (app.transitions !== undefined) {
      if (!Array.isArray(app.transitions) || app.transitions.length === 0) {
        fail(where, "applicability.transitions must be a non-empty array");
      }
      transitions = app.transitions.map((t, i) => {
        const tw = `${where}.applicability.transitions[${i}]`;
        if (!isPlainObject(t)) fail(tw, "transition must be an object");
        exactKeys(t, ["old_ref", "new_ref"], tw);
        return {
          old_ref: validateSourceRef(t.old_ref, `${tw}.old_ref`),
          new_ref: validateSourceRef(t.new_ref, `${tw}.new_ref`),
        };
      });
    } else if (value.action_ids.includes("supersede")) {
      fail(where, "registration authorizing 'supersede' must declare applicability.transitions (exact old/new pins)");
    }
    applicability = { scope_ids, source_keys, transitions };
  } else if (value.action_ids.includes("supersede")) {
    fail(where, "registration authorizing 'supersede' must declare applicability (scope_ids + source_keys)");
  }
  return { registration_ref, steward_id, action_ids: [...value.action_ids], valid_from: value.valid_from, expires_at: value.expires_at, revoked: value.revoked, applicability };
}

/**
 * SupersessionRecord = {record_id, issuer, old_ref, new_ref, effective_at,
 * scope_ids, registration_ref}. Authority over exact source/version/scope.
 */
export function validateSupersessionRecord(value, where) {
  if (!isPlainObject(value)) fail(where, "SupersessionRecord must be an object");
  exactKeys(value, ["record_id", "issuer", "old_ref", "new_ref", "effective_at", "scope_ids", "registration_ref"], where);
  const record_id = validateRecordId(value.record_id, where);
  const issuer = validateRecordId(value.issuer, where);
  const old_ref = validateSourceRef(value.old_ref, `${where}.old_ref`);
  const new_ref = validateSourceRef(value.new_ref, `${where}.new_ref`);
  // old_ref and new_ref may name different source keys: a replacement
  // revision can live on another path (read permission is checked
  // separately and a denied replacement can never be used or quoted).
  validateIsoDate(value.effective_at, `${where}.effective_at`);
  const scope_ids = validateScopeIds(value.scope_ids, where);
  const registration_ref = validateRecordId(value.registration_ref, where);
  return { record_id, issuer, old_ref, new_ref, effective_at: value.effective_at, scope_ids, registration_ref };
}

/** Task input schema. kind: "answer" | "prohibited". */
export function validateTask(task) {
  if (!isPlainObject(task)) fail("task", "must be an object");
  exactKeys(task, ["query", "query_key", "filters", "requested_action", "source_pin"], "task");
  const query = reqStr(task, "query", "task");
  if (Buffer.byteLength(query, "utf8") > 8192) fail("task", "query exceeds 8192 bytes");
  let query_key = null;
  if (task.query_key !== null && task.query_key !== undefined) {
    query_key = reqStr(task, "query_key", "task");
    if (!CLAIM_KEY_RE.test(query_key)) fail("task", `invalid query_key '${query_key}'`);
  }
  const filters = task.filters;
  if (!isPlainObject(filters)) fail("task", "filters must be an object");
  exactKeys(filters, ["source_tags", "max_source_age_days", "as_of_date"], "task.filters");
  if (!Array.isArray(filters.source_tags)) fail("task", "filters.source_tags must be an array");
  for (const t of filters.source_tags) {
    if (typeof t !== "string" || !SCOPE_RE.test(t)) fail("task", `invalid source tag '${String(t)}'`);
  }
  let max_source_age_days = null;
  if (filters.max_source_age_days !== null && filters.max_source_age_days !== undefined) {
    const v = filters.max_source_age_days;
    if (!Number.isInteger(v) || v <= 0) fail("task", "filters.max_source_age_days must be a positive integer");
    max_source_age_days = v;
  }
  let as_of_date = null;
  if (filters.as_of_date !== null && filters.as_of_date !== undefined) {
    as_of_date = reqStr(filters, "as_of_date", "task.filters");
    validateIsoDate(as_of_date, "task.filters.as_of_date");
  }
  const requested_action = reqStr(task, "requested_action", "task");
  let source_pin = null;
  if (task.source_pin !== undefined && task.source_pin !== null) {
    source_pin = validateSourceRef(task.source_pin, "task.source_pin");
  }
  return {
    query,
    query_key,
    filters: { source_tags: [...filters.source_tags], max_source_age_days, as_of_date },
    requested_action,
    source_pin,
    kind: requested_action === "answer" ? "answer" : "prohibited",
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

/** Vocabulary entry: {query_key, phrases:[...]}. */
export function validateVocabularyEntry(value, where) {
  if (!isPlainObject(value)) fail(where, "vocabulary entry must be an object");
  exactKeys(value, ["query_key", "phrases"], where);
  const query_key = reqStr(value, "query_key", where);
  if (!CLAIM_KEY_RE.test(query_key)) fail(where, `invalid query_key '${query_key}'`);
  if (!Array.isArray(value.phrases) || value.phrases.length === 0) fail(where, "phrases must be a non-empty array");
  const phrases = [];
  const seen = new Set();
  for (const p of value.phrases) {
    if (typeof p !== "string" || p.length < 3) fail(where, "phrases must be strings of at least 3 characters");
    const lp = p.toLowerCase();
    if (seen.has(lp)) fail(where, `duplicate phrase '${p}'`);
    seen.add(lp);
    phrases.push(p);
  }
  return { query_key, phrases };
}

/** Full host-adapter context validation.
 *
 * Every consulted registry object (vocabulary entry, source entry,
 * revision ledger entry, grant, steward, registration, record) is
 * charged against the per-task budget BEFORE it is used, so unbounded
 * registries fail closed with BUDGET_EXCEEDED instead of being scanned
 * for free. Revision ledger dates (effective_at/verified_at) are
 * validated here at runtime: an invalid or missing ledger date is an
 * INVALID_INPUT context, never a NaN that bypasses age comparisons.
 * Source revision BYTES are never touched here — metadata only, so a
 * read-denied source's text is not accessed during validation.
 */
/** Metadata-only projection for byte accounting: drops every `text`
 *  property WITHOUT reading it. Destructuring `{ text, ...meta }` would
 *  invoke a text getter — denied bytes must never be touched, not even
 *  to exclude them. Object.keys never fires getters. */
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
  // KVP-004 round 3: serialized payload accounting for every registry
  // object BEFORE it is validated or used. A single huge string inside
  // an otherwise valid registration must trip the payload budget, not
  // ride in on a 1-object consulted charge. Source revision TEXT is
  // excluded here (permission-gated later, per source); text bytes are
  // budgeted on actual resolution/parse.
  const chargeBytes = (obj, what) => {
    if (budget) budget.countPayload(canonicalJson(obj), what);
  };
  if (!isPlainObject(context)) fail("context", "must be an object");
  exactKeys(context, ["clock", "vocabulary", "sources", "readGrants", "stewards", "registrations", "supersessionRecords"], "context");
  const clock = context.clock;
  if (!Number.isFinite(clock)) fail("context", "clock must be a finite number");
  if (!Array.isArray(context.vocabulary) || context.vocabulary.length === 0) fail("context", "vocabulary must be a non-empty array");
  const vocabulary = context.vocabulary.map((e, i) => { charge("vocabulary entry"); chargeBytes(e, `vocabulary entry ${i} payload`); return validateVocabularyEntry(e, `context.vocabulary[${i}]`); });
  const keySeen = new Set();
  for (const e of vocabulary) {
    if (keySeen.has(e.query_key)) fail("context", `duplicate vocabulary query_key '${e.query_key}'`);
    keySeen.add(e.query_key);
  }
  if (!isPlainObject(context.sources)) fail("context", "sources must be an object");
  const sourceKeys = Object.keys(context.sources);
  if (sourceKeys.length === 0 || sourceKeys.length > 64) fail("context", "sources must have 1..64 entries");
  // Validate the source identity/effective-time ledger: revision dates
  // are real calendar dates, blob pins are 40-hex. Text bytes are NOT
  // read here (permission-gated later, per source).
  for (const sk of sourceKeys) {
    charge("source entry");
    const entry = context.sources[sk];
    if (!isPlainObject(entry)) fail("context", `source '${sk}' must be an object`);
    const revs = entry.revisions;
    if (!isPlainObject(revs)) fail("context", `source '${sk}' revisions must be an object`);
    // Metadata-only payload accounting: revision text excluded WITHOUT
    // being read (metadataWithoutText never touches a text getter).
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
  if (!Array.isArray(context.supersessionRecords)) fail("context", "supersessionRecords must be an array");
  const supersessionRecords = context.supersessionRecords.map((r, i) => { charge("supersession record"); chargeBytes(r, `supersession record ${i} payload`); return validateSupersessionRecord(r, `context.supersessionRecords[${i}]`); });
  const recSeen = new Set();
  for (const r of supersessionRecords) {
    if (recSeen.has(r.record_id)) fail("context", `duplicate supersession record_id '${r.record_id}'`);
    recSeen.add(r.record_id);
  }
  return { clock, vocabulary, sources: context.sources, readGrants, stewards, registrations, supersessionRecords };
}

export { CLAIM_KEY_RE, SCOPE_RE, PATH_RE, REPO_RE };
