/**
 * schemas.js — runtime validation for the Document Agent prototype.
 * Strict: rejects unknown properties in control-bearing objects, absent
 * required fields, wrong types, invalid enum values, duplicate IDs,
 * nonfinite numbers, invalid dates. Pure Node 24 ESM, zero dependencies.
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
const SLUG_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const REQUESTED_OPERATION_ALLOWED = "analyze";
export const MARKER_KEYS = ["author", "date", "id", "status"];
export const REFERENCE_KINDS = ["PREREQUISITE", "CITATION"];
export const TARGET_KINDS = ["INTERNAL", "EXTERNAL"];
export const VALUE_TYPES = ["STRING", "NUMBER", "BOOLEAN"];
export const PRINCIPAL_ROLES = ["JASON", "MUSE_RELAY"];

export const MAX_DOCUMENTS_SCHEMA = 4096; // outer array-shape bound only; the 64-object budget gates real processing
export const MAX_ASSERTIONS_SCHEMA = 4096;
export const MAX_SECTIONS_PER_DOC = 64;
export const MAX_MARKERS_PER_DOC = MARKER_KEYS.length;
export const MAX_REFERENCES_PER_DOC = 64;

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

function validateSlug(value, where) {
  const v = reqStr({ v: value }, "v", where);
  if (!SLUG_RE.test(v)) fail(where, `invalid slug '${v}'`);
  return v;
}

/** Real calendar date, YYYY-MM-DD. Returns epoch ms (UTC midnight). */
export function validateDate(value, where) {
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

/** Real calendar date or finite UTC ISO timestamp with Z (for clock/principal fields). */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
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

export function validatePrincipal(value, where) {
  if (!isPlainObject(value)) fail(where, "principal must be an object");
  exactKeys(value, ["principal_id", "role", "registered_by", "valid_from", "expires_at", "revoked"], where);
  const principal_id = validateRecordId(value.principal_id, where);
  if (!PRINCIPAL_ROLES.includes(value.role)) fail(where, `role must be one of ${PRINCIPAL_ROLES.join(", ")}`);
  const registered_by = reqStr(value, "registered_by", where);
  if (registered_by !== "jason") fail(where, "registered_by must be 'jason'");
  validateIsoDate(value.valid_from, `${where}.valid_from`);
  validateIsoDate(value.expires_at, `${where}.expires_at`);
  if (typeof value.revoked !== "boolean") fail(where, "revoked must be a boolean");
  return { principal_id, role: value.role, registered_by, valid_from: value.valid_from, expires_at: value.expires_at, revoked: value.revoked };
}

/** Trusted checklist criteria: version, required section IDs, required
 *  companion logical IDs, and the pinned checklist document SourceRef.
 *  Host-injected only — never supplied or overridable by task content. */
export function validateCriteria(value, where) {
  if (!isPlainObject(value)) fail(where, "criteria must be an object");
  exactKeys(value, ["checklist_version", "required_sections", "required_companions", "checklist_ref"], where);
  const checklist_version = validateSlug(value.checklist_version, `${where}.checklist_version`);
  if (!Array.isArray(value.required_sections) || value.required_sections.length > 16) fail(where, "required_sections must be an array of at most 16 entries");
  const required_sections = value.required_sections.map((s, i) => validateSlug(s, `${where}.required_sections[${i}]`));
  if (new Set(required_sections).size !== required_sections.length) fail(where, "required_sections contains duplicates");
  if (!Array.isArray(value.required_companions) || value.required_companions.length > 16) fail(where, "required_companions must be an array of at most 16 entries");
  const required_companions = value.required_companions.map((s, i) => validateSlug(s, `${where}.required_companions[${i}]`));
  if (new Set(required_companions).size !== required_companions.length) fail(where, "required_companions contains duplicates");
  const checklist_ref = validateSourceRef(value.checklist_ref, `${where}.checklist_ref`);
  return { checklist_version, required_sections, required_companions, checklist_ref };
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

export function validateContext(context) {
  if (!isPlainObject(context)) fail("context", "must be an object");
  exactKeys(context, ["clock", "sources", "readGrants", "principal", "criteria"], "context");
  const clock = context.clock;
  if (!Number.isFinite(clock)) fail("context", "clock must be a finite number");

  if (!isPlainObject(context.sources)) fail("context", "sources must be an object");
  const sourceKeys = Object.keys(context.sources);
  // This bounds the host's total registered source catalog available in
  // context (a schema-level sanity cap this prototype chooses), NOT the
  // per-task consultation budget — that is separately and strictly
  // enforced at 64 objects by resolver.js's BUDGET_LIMITS regardless of
  // how large the registered catalog is.
  if (sourceKeys.length === 0 || sourceKeys.length > 4096) fail("context", "sources must have 1..4096 entries");
  for (const sk of sourceKeys) {
    const entry = context.sources[sk];
    if (!isPlainObject(entry)) fail("context", `source '${sk}' must be an object`);
    const revs = entry.revisions;
    if (!isPlainObject(revs)) fail("context", `source '${sk}' revisions must be an object`);
    for (const commit of Object.keys(revs)) {
      const rev = revs[commit];
      if (!isPlainObject(rev)) fail("context", `source '${sk}' revision '${commit}' must be an object`);
      if (typeof rev.text !== "string") fail("context", `source '${sk}' revision '${commit}' text must be a string`);
      if (typeof rev.blob !== "string" || !HEX40.test(rev.blob)) fail("context", `source '${sk}' revision '${commit}' blob must be a 40-hex Git object ID`);
    }
  }

  if (!Array.isArray(context.readGrants)) fail("context", "readGrants must be an array");
  const readGrants = context.readGrants.map((g, i) => validateReadGrant(g, `context.readGrants[${i}]`));

  const principal = validatePrincipal(context.principal, "context.principal");
  const criteria = validateCriteria(context.criteria, "context.criteria");

  return { clock, sources: context.sources, readGrants, principal, criteria };
}

/** Task input schema. kind: "analyze" | "prohibited". */
export function validateTask(task) {
  if (!isPlainObject(task)) fail("task", "must be an object");
  exactKeys(task, ["schema_version", "task_id", "operation", "fixture_refs", "options"], "task");
  if (task.schema_version !== "1") fail("task", "schema_version must be '1'");
  const task_id = reqStr(task, "task_id", "task", { maxBytes: 2048 });
  const operation = reqStr(task, "operation", "task", { maxBytes: 256 });

  if (!isPlainObject(task.fixture_refs)) fail("task", "fixture_refs must be an object");
  exactKeys(task.fixture_refs, ["document_set"], "task.fixture_refs");
  const document_set_ref = validateSourceRef(task.fixture_refs.document_set, "task.fixture_refs.document_set");

  if (!isPlainObject(task.options)) fail("task", "options must be an object");
  exactKeys(task.options, ["population"], "task.options");
  const pop = task.options.population;
  if (!isPlainObject(pop)) fail("task.options.population", "must be an object");
  exactKeys(pop, ["declared_total", "complete"], "task.options.population");
  if (!Number.isInteger(pop.declared_total) || pop.declared_total < 0) fail("task.options.population", "declared_total must be a nonnegative integer");
  if (typeof pop.complete !== "boolean") fail("task.options.population", "complete must be a boolean");

  return {
    task_id,
    operation,
    document_set_ref,
    population: { declared_total: pop.declared_total, complete: pop.complete },
    kind: operation === REQUESTED_OPERATION_ALLOWED ? "analyze" : "prohibited",
  };
}

function validateSection(value, where, seenIds) {
  if (!isPlainObject(value)) fail(where, "section must be an object");
  exactKeys(value, ["section_id", "start_byte", "end_byte"], where);
  const section_id = validateSlug(value.section_id, `${where}.section_id`);
  if (seenIds.has(section_id)) fail(where, `duplicate section_id '${section_id}'`);
  seenIds.add(section_id);
  if (!Number.isInteger(value.start_byte) || value.start_byte < 0) fail(where, "start_byte must be a nonnegative integer");
  if (!Number.isInteger(value.end_byte) || value.end_byte <= value.start_byte) fail(where, "end_byte must be an integer greater than start_byte");
  return { section_id, start_byte: value.start_byte, end_byte: value.end_byte };
}

function validateMarker(value, where, seenKeys) {
  if (!isPlainObject(value)) fail(where, "marker must be an object");
  exactKeys(value, ["key", "start_byte", "end_byte"], where);
  if (!MARKER_KEYS.includes(value.key)) fail(where, `key must be one of ${MARKER_KEYS.join(", ")}`);
  if (seenKeys.has(value.key)) fail(where, `duplicate marker key '${value.key}'`);
  seenKeys.add(value.key);
  if (!Number.isInteger(value.start_byte) || value.start_byte < 0) fail(where, "start_byte must be a nonnegative integer");
  if (!Number.isInteger(value.end_byte) || value.end_byte <= value.start_byte) fail(where, "end_byte must be an integer greater than start_byte");
  return { key: value.key, start_byte: value.start_byte, end_byte: value.end_byte };
}

function validateReference(value, where, seenIds) {
  if (!isPlainObject(value)) fail(where, "reference must be an object");
  exactKeys(value, ["ref_id", "kind", "target_kind", "target_doc_id", "target_section_id", "external_pointer"], where);
  const ref_id = validateRecordId(value.ref_id, where);
  if (seenIds.has(ref_id)) fail(where, `duplicate ref_id '${ref_id}'`);
  seenIds.add(ref_id);
  if (!REFERENCE_KINDS.includes(value.kind)) fail(where, `kind must be one of ${REFERENCE_KINDS.join(", ")}`);
  if (!TARGET_KINDS.includes(value.target_kind)) fail(where, `target_kind must be one of ${TARGET_KINDS.join(", ")}`);
  let target_doc_id = null;
  let target_section_id = null;
  let external_pointer = null;
  if (value.target_kind === "INTERNAL") {
    if (value.target_doc_id === null || value.target_doc_id === undefined) fail(where, "INTERNAL reference requires target_doc_id");
    target_doc_id = validateRecordId(value.target_doc_id, `${where}.target_doc_id`);
    if (value.target_section_id !== null && value.target_section_id !== undefined) {
      target_section_id = validateSlug(value.target_section_id, `${where}.target_section_id`);
    }
    if (value.external_pointer !== null && value.external_pointer !== undefined) fail(where, "INTERNAL reference must not carry external_pointer");
  } else {
    if (value.target_doc_id !== null && value.target_doc_id !== undefined) fail(where, "EXTERNAL reference must not carry target_doc_id");
    if (value.target_section_id !== null && value.target_section_id !== undefined) fail(where, "EXTERNAL reference must not carry target_section_id");
    external_pointer = reqStr(value, "external_pointer", where, { maxBytes: 512 });
  }
  return { ref_id, kind: value.kind, target_kind: value.target_kind, target_doc_id, target_section_id, external_pointer };
}

/** One document record, as read from the resolved document-set fixture. */
export function validateDocument(value, where) {
  if (!isPlainObject(value)) fail(where, "document must be an object");
  exactKeys(value, ["doc_id", "logical_id", "revision", "declared_date", "metadata", "content_ref", "sections", "markers", "references"], where);
  const doc_id = validateRecordId(value.doc_id, where);
  const logical_id = validateSlug(value.logical_id, `${where}.logical_id`);
  if (!Number.isInteger(value.revision) || value.revision < 1) fail(where, "revision must be a positive integer");
  validateDate(value.declared_date, `${where}.declared_date`);

  const md = value.metadata;
  if (!isPlainObject(md)) fail(`${where}.metadata`, "must be an object");
  exactKeys(md, ["author", "date", "id", "status"], `${where}.metadata`);
  const author = reqStr(md, "author", `${where}.metadata`, { maxBytes: 256 });
  validateDate(md.date, `${where}.metadata.date`);
  const id = reqStr(md, "id", `${where}.metadata`, { maxBytes: 128 });
  const status = reqStr(md, "status", `${where}.metadata`, { maxBytes: 64 });

  const content_ref = validateSourceRef(value.content_ref, `${where}.content_ref`);

  if (!Array.isArray(value.sections) || value.sections.length > MAX_SECTIONS_PER_DOC) fail(where, `sections must be an array of at most ${MAX_SECTIONS_PER_DOC} entries`);
  const sectionIds = new Set();
  const sections = value.sections.map((s, i) => validateSection(s, `${where}.sections[${i}]`, sectionIds));

  if (!Array.isArray(value.markers) || value.markers.length > MAX_MARKERS_PER_DOC) fail(where, `markers must be an array of at most ${MAX_MARKERS_PER_DOC} entries`);
  const markerKeys = new Set();
  const markers = value.markers.map((m, i) => validateMarker(m, `${where}.markers[${i}]`, markerKeys));

  if (!Array.isArray(value.references) || value.references.length > MAX_REFERENCES_PER_DOC) fail(where, `references must be an array of at most ${MAX_REFERENCES_PER_DOC} entries`);
  const refIds = new Set();
  const references = value.references.map((r, i) => validateReference(r, `${where}.references[${i}]`, refIds));

  return { doc_id, logical_id, revision: value.revision, declared_date: value.declared_date, metadata: { author, date: md.date, id, status }, content_ref, sections, markers, references };
}

/** One structured assertion, as read from the resolved document-set fixture. */
export function validateAssertion(value, where) {
  if (!isPlainObject(value)) fail(where, "assertion must be an object");
  exactKeys(value, ["assertion_id", "doc_id", "subject", "property", "scope", "value_type", "value", "span"], where);
  const assertion_id = validateRecordId(value.assertion_id, where);
  const doc_id = validateRecordId(value.doc_id, `${where}.doc_id`);
  const subject = validateSlug(value.subject, `${where}.subject`);
  const property = validateSlug(value.property, `${where}.property`);
  const scope = validateSlug(value.scope, `${where}.scope`);
  if (!VALUE_TYPES.includes(value.value_type)) fail(where, `value_type must be one of ${VALUE_TYPES.join(", ")}`);
  let typedValue;
  if (value.value_type === "STRING") {
    if (typeof value.value !== "string" || value.value.length === 0 || Buffer.byteLength(value.value, "utf8") > 1024) fail(where, "STRING value must be a non-empty string <= 1024 bytes");
    typedValue = value.value;
  } else if (value.value_type === "NUMBER") {
    if (typeof value.value !== "number" || !Number.isFinite(value.value)) fail(where, "NUMBER value must be a finite number");
    typedValue = value.value;
  } else {
    if (typeof value.value !== "boolean") fail(where, "BOOLEAN value must be a boolean");
    typedValue = value.value;
  }
  if (!isPlainObject(value.span)) fail(`${where}.span`, "must be an object");
  exactKeys(value.span, ["start_byte", "end_byte"], `${where}.span`);
  if (!Number.isInteger(value.span.start_byte) || value.span.start_byte < 0) fail(`${where}.span`, "start_byte must be a nonnegative integer");
  if (!Number.isInteger(value.span.end_byte) || value.span.end_byte <= value.span.start_byte) fail(`${where}.span`, "end_byte must be an integer greater than start_byte");
  return { assertion_id, doc_id, subject, property, scope, value_type: value.value_type, value: typedValue, span: { start_byte: value.span.start_byte, end_byte: value.span.end_byte } };
}

/** Outer document-set shape: {documents:[...], assertions:[...]}. Only the
 *  array shapes and outer bounds are checked here — the "bounded preflight
 *  may inspect containers/lengths" step; it must never walk an UNCHARGED
 *  candidate's own fields (see src/index.js). */
export function validateDocumentSetShape(parsed, where) {
  if (!isPlainObject(parsed)) fail(where, "document set must be an object");
  exactKeys(parsed, ["documents", "assertions"], where);
  if (!Array.isArray(parsed.documents) || parsed.documents.length > MAX_DOCUMENTS_SCHEMA) fail(where, `documents must be an array of at most ${MAX_DOCUMENTS_SCHEMA} entries`);
  if (!Array.isArray(parsed.assertions) || parsed.assertions.length > MAX_ASSERTIONS_SCHEMA) fail(where, `assertions must be an array of at most ${MAX_ASSERTIONS_SCHEMA} entries`);
  return parsed;
}

export { REPO_RE, PATH_RE, RECORD_ID_RE, SLUG_RE, DATE_RE };
