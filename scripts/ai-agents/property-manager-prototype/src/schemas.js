/**
 * schemas.js — runtime validation for the property-manager prototype.
 *
 * All control-bearing objects reject unknown properties. Enums are
 * closed; SYN-* identifier shapes are enforced; dates must be real
 * YYYY-MM-DD or finite UTC ISO timestamps with Z.
 */

import { HEX40, SYN_ID } from "./canonical.js";

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaError";
  }
}

export const WORKFLOWS = ["maintenance", "lease", "rent", "comms", "document_inquiry"];

/** requested_action values the schema accepts as strings; the engine classifies them. */
export const ACTION_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** Prohibited operations: the engine refuses these with ACTION_DENIED. */
export const PROHIBITED_ACTIONS = new Set([
  "charge",
  "send_message",
  "waive_fee",
  "edit_lease",
  "edit_ledger",
  "dispatch",
  "legal_advice",
  "delete_record",
  "activate",
]);

const CASE_REF_KEYS = ["case_id", "repo", "path", "commit", "blob", "algorithm", "revision"];
const TASK_KEYS = ["case_ref", "workflow", "context_filters", "requested_action", "note", "claimed_relay_ids"];
const FILTER_KEYS = ["property_fixture_ids"];
const CONTEXT_KEYS = ["clock", "caseStore", "trustRegistry"];

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function rejectUnknown(obj, allowed, label) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) throw new SchemaError(`${label}: unknown property '${k}'`);
  }
}

function checkSynId(v, label) {
  if (typeof v !== "string" || !SYN_ID.test(v)) {
    throw new SchemaError(`${label} must be a SYN-* identifier, got ${JSON.stringify(String(v)).slice(0, 80)}`);
  }
}

export function validateCaseRef(ref) {
  if (!isPlainObject(ref)) throw new SchemaError("case_ref must be an object");
  rejectUnknown(ref, CASE_REF_KEYS, "case_ref");
  checkSynId(ref.case_id, "case_ref.case_id");
  if (!/^SYN-CASE-[0-9]{3}$/.test(ref.case_id)) {
    throw new SchemaError("case_ref.case_id must match SYN-CASE-NNN");
  }
  if (typeof ref.repo !== "string" || ref.repo.length === 0 || ref.repo.length > 128) {
    throw new SchemaError("case_ref.repo must be a non-empty string");
  }
  if (typeof ref.path !== "string" || ref.path.length === 0 || ref.path.length > 256) {
    throw new SchemaError("case_ref.path must be a non-empty string");
  }
  if (ref.path.startsWith("/") || ref.path.includes("\\") || ref.path.includes("..")) {
    throw new SchemaError("case_ref.path must be a canonical repo-relative path");
  }
  if (typeof ref.commit !== "string" || !HEX40.test(ref.commit)) {
    throw new SchemaError("case_ref.commit must be 40 lowercase hex");
  }
  if (typeof ref.blob !== "string" || !HEX40.test(ref.blob)) {
    throw new SchemaError("case_ref.blob must be 40 lowercase hex");
  }
  if (ref.algorithm !== "git-sha1") throw new SchemaError('case_ref.algorithm must be "git-sha1"');
  if (typeof ref.revision !== "string" || ref.revision.length === 0 || ref.revision.length > 64) {
    throw new SchemaError("case_ref.revision must be a non-empty string");
  }
  return ref;
}

export function validateTask(task) {
  if (!isPlainObject(task)) throw new SchemaError("task must be an object");
  rejectUnknown(task, TASK_KEYS, "task");
  const case_ref = validateCaseRef(task.case_ref);
  if (!WORKFLOWS.includes(task.workflow)) {
    throw new SchemaError(`workflow must be one of ${WORKFLOWS.join(",")}`);
  }
  if (!isPlainObject(task.context_filters)) throw new SchemaError("context_filters must be an object");
  rejectUnknown(task.context_filters, FILTER_KEYS, "context_filters");
  const ids = task.context_filters.property_fixture_ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 8) {
    throw new SchemaError("context_filters.property_fixture_ids must be a non-empty array of at most 8 IDs");
  }
  const seen = new Set();
  for (const id of ids) {
    checkSynId(id, "context_filters.property_fixture_ids[]");
    if (!/^SYN-PROP-[0-9]{2}$/.test(id)) {
      throw new SchemaError("context_filters.property_fixture_ids[] must match SYN-PROP-NN");
    }
    if (seen.has(id)) throw new SchemaError("context_filters.property_fixture_ids[] contains duplicates");
    seen.add(id);
  }
  if (typeof task.requested_action !== "string" || !ACTION_PATTERN.test(task.requested_action)) {
    throw new SchemaError("requested_action must be a lowercase snake_case action token");
  }
  let note = null;
  if (task.note !== undefined && task.note !== null) {
    if (typeof task.note !== "string" || task.note.length > 4096) {
      throw new SchemaError("note must be a string of at most 4096 characters");
    }
    note = task.note;
  }
  let claimed = [];
  if (task.claimed_relay_ids !== undefined && task.claimed_relay_ids !== null) {
    if (!Array.isArray(task.claimed_relay_ids) || task.claimed_relay_ids.length > 8) {
      throw new SchemaError("claimed_relay_ids must be an array of at most 8 IDs");
    }
    const seenR = new Set();
    for (const id of task.claimed_relay_ids) {
      checkSynId(id, "claimed_relay_ids[]");
      if (seenR.has(id)) throw new SchemaError("claimed_relay_ids[] contains duplicates");
      seenR.add(id);
      claimed.push(id);
    }
  }
  return { case_ref, workflow: task.workflow, context_filters: { property_fixture_ids: ids }, requested_action: task.requested_action, note, claimed_relay_ids: claimed };
}

export function validateContext(context, budget) {
  if (!isPlainObject(context)) throw new SchemaError("context must be an object");
  rejectUnknown(context, CONTEXT_KEYS, "context");
  if (typeof context.clock !== "number" || !Number.isFinite(context.clock)) {
    throw new SchemaError("context.clock must be a finite number (ms since epoch)");
  }
  const store = context.caseStore;
  if (!isPlainObject(store)) throw new SchemaError("context.caseStore must be an object");
  if (typeof store.repo !== "string" || store.repo.length === 0) {
    throw new SchemaError("context.caseStore.repo must be a non-empty string");
  }
  if (typeof store.commit_id !== "string" || !HEX40.test(store.commit_id)) {
    throw new SchemaError("context.caseStore.commit_id must be 40 lowercase hex");
  }
  if (!Array.isArray(store.cases) || store.cases.length === 0 || store.cases.length > 512) {
    throw new SchemaError("context.caseStore.cases must be a non-empty array of at most 512 cases");
  }
  if (!isPlainObject(store.note_texts)) throw new SchemaError("context.caseStore.note_texts must be an object");
  if (!isPlainObject(store.urgency_table)) throw new SchemaError("context.caseStore.urgency_table must be an object");
  if (!isPlainObject(store.escalation_policy)) throw new SchemaError("context.caseStore.escalation_policy must be an object");
  if (!Array.isArray(store.permission_records)) throw new SchemaError("context.caseStore.permission_records must be an array");
  const trust = context.trustRegistry;
  if (!isPlainObject(trust)) throw new SchemaError("context.trustRegistry must be an object");
  if (!isPlainObject(trust.principals)) throw new SchemaError("context.trustRegistry.principals must be an object");
  if (!Array.isArray(trust.relay_records)) throw new SchemaError("context.trustRegistry.relay_records must be an array");
  budget.countResolution("context.caseStore");
  return { clock: context.clock, caseStore: store, trustRegistry: trust };
}

/** Real calendar date check: YYYY-MM-DD or finite UTC ISO timestamp with Z. */
export function isValidDateString(s) {
  if (typeof s !== "string") return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s)) {
    return Number.isFinite(Date.parse(s));
  }
  return false;
}
