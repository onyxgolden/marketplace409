/**
 * schemas.js — runtime schema validation for the architecture-reviewer
 * prototype. All schemas run at runtime and reject unknown properties in
 * control-bearing objects, absent required fields, wrong types, invalid
 * enum values, duplicate IDs, nonfinite numbers, invalid dates and
 * abbreviated/malformed pins. A malformed request yields a structured
 * denial, never an exception or default success.
 */

const HEX40 = /^[0-9a-f]{40}$/;
const KNOWN_ACTIONS = new Set(["review", "check-gate"]);
const PROHIBITED_ACTIONS = new Set(["merge", "deploy", "execute", "approve", "publish", "activate", "run", "apply"]);

export class SchemaError extends Error {
  constructor(reason) {
    super(`schema: ${reason}`);
    this.name = "SchemaError";
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function checkOnlyKeys(obj, allowed, where) {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) throw new SchemaError(`${where}: unknown property '${k}'`);
  }
}

function reqString(obj, key, where) {
  if (typeof obj[key] !== "string" || obj[key].length === 0)
    throw new SchemaError(`${where}: '${key}' must be a non-empty string`);
  return obj[key];
}

function optStringArray(obj, key, where) {
  const v = obj[key];
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new SchemaError(`${where}: '${key}' must be an array`);
  const seen = new Set();
  for (const s of v) {
    if (typeof s !== "string" || s.length === 0) throw new SchemaError(`${where}: '${key}' entries must be non-empty strings`);
    if (seen.has(s)) throw new SchemaError(`${where}: '${key}' has duplicate ID '${s}'`);
    seen.add(s);
  }
  return v;
}

export function validateSourceRef(ref, where) {
  if (!isPlainObject(ref)) throw new SchemaError(`${where}: SourceRef must be an object`);
  checkOnlyKeys(ref, new Set(["repo", "path", "commit", "blob", "algorithm", "revision"]), where);
  reqString(ref, "repo", where);
  reqString(ref, "path", where);
  const commit = reqString(ref, "commit", where);
  if (!HEX40.test(commit)) throw new SchemaError(`${where}: 'commit' must be a full lowercase 40-hex Git object ID`);
  const blob = reqString(ref, "blob", where);
  if (!HEX40.test(blob)) throw new SchemaError(`${where}: 'blob' must be a full lowercase 40-hex Git object ID`);
  if (ref.algorithm !== undefined && ref.algorithm !== "git-sha1")
    throw new SchemaError(`${where}: 'algorithm' must be "git-sha1" when present`);
  if (ref.revision !== undefined && (typeof ref.revision !== "string" || ref.revision.length === 0))
    throw new SchemaError(`${where}: 'revision' must be a non-empty string when present`);
  return ref;
}

export function validateSpan(span, where) {
  if (!isPlainObject(span)) throw new SchemaError(`${where}: span must be an object`);
  checkOnlyKeys(span, new Set(["start_byte", "end_byte", "quoted_text"]), where);
  for (const k of ["start_byte", "end_byte"]) {
    if (!Number.isInteger(span[k]) || span[k] < 0) throw new SchemaError(`${where}: '${k}' must be a non-negative integer`);
  }
  if (span.end_byte < span.start_byte) throw new SchemaError(`${where}: 'end_byte' must be >= 'start_byte'`);
  if (typeof span.quoted_text !== "string") throw new SchemaError(`${where}: 'quoted_text' must be a string`);
  return span;
}

export function validateCitation(c, where) {
  if (!isPlainObject(c)) throw new SchemaError(`${where}: Citation must be an object`);
  checkOnlyKeys(c, new Set(["repo", "path", "commit", "blob", "algorithm", "revision", "quoted_span", "span", "verification"]), where);
  validateSourceRef(
    { repo: c.repo, path: c.path, commit: c.commit, blob: c.blob, algorithm: c.algorithm, revision: c.revision },
    where
  );
  if (typeof c.quoted_span !== "string") throw new SchemaError(`${where}: 'quoted_span' must be a string`);
  validateSpan(c.span, `${where}.span`);
  if (c.quoted_span !== c.span.quoted_text)
    throw new SchemaError(`${where}: 'quoted_span' must equal 'span.quoted_text'`);
  if (c.verification !== "VERIFIED" && c.verification !== "UNVERIFIED")
    throw new SchemaError(`${where}: 'verification' must be VERIFIED or UNVERIFIED`);
  return c;
}

/**
 * Validate the task. Returns { action, kind } where kind is
 * "review" | "check-gate" | "prohibited" — or throws SchemaError.
 */
export function validateTask(task) {
  if (!isPlainObject(task)) throw new SchemaError("task must be an object");
  checkOnlyKeys(
    task,
    new Set(["design_ref", "base_pin", "scope_ids", "required_check_ids", "evidence_refs", "requested_action", "gate_evidence", "prior_round_verdict"]),
    "task"
  );
  const action = task.requested_action;
  if (typeof action !== "string" || action.length === 0) throw new SchemaError("task.requested_action must be a non-empty string");
  if (PROHIBITED_ACTIONS.has(action)) return { action, kind: "prohibited" };
  if (!KNOWN_ACTIONS.has(action)) throw new SchemaError(`task.requested_action '${action}' is not supported`);

  if (action === "review") {
    if (task.design_ref === undefined) throw new SchemaError("task.design_ref is required for review");
    validateSourceRef(task.design_ref, "task.design_ref");
    if (!isPlainObject(task.base_pin)) throw new SchemaError("task.base_pin is required for review");
    checkOnlyKeys(task.base_pin, new Set(["repo", "commit"]), "task.base_pin");
    reqString(task.base_pin, "repo", "task.base_pin");
    const bc = reqString(task.base_pin, "commit", "task.base_pin");
    if (!HEX40.test(bc)) throw new SchemaError("task.base_pin.commit must be a full lowercase 40-hex Git object ID");
    optStringArray(task, "scope_ids", "task");
    optStringArray(task, "required_check_ids", "task");
    if (task.evidence_refs !== undefined) {
      if (!Array.isArray(task.evidence_refs)) throw new SchemaError("task.evidence_refs must be an array");
      task.evidence_refs.forEach((e, i) => {
        if (!isPlainObject(e)) throw new SchemaError(`task.evidence_refs[${i}] must be an object`);
        checkOnlyKeys(e, new Set(["design_ref", "span"]), `task.evidence_refs[${i}]`);
        if (e.design_ref === undefined) throw new SchemaError(`task.evidence_refs[${i}].design_ref is required`);
        validateSourceRef(e.design_ref, `task.evidence_refs[${i}].design_ref`);
        validateSpan(e.span, `task.evidence_refs[${i}].span`);
      });
    }
    if (task.prior_round_verdict !== undefined) {
      if (!isPlainObject(task.prior_round_verdict)) throw new SchemaError("task.prior_round_verdict must be an object");
      checkOnlyKeys(task.prior_round_verdict, new Set(["value", "round"]), "task.prior_round_verdict");
      if (!["GO", "NEEDS CHANGES", "NO-GO"].includes(task.prior_round_verdict.value))
        throw new SchemaError("task.prior_round_verdict.value must be GO, NEEDS CHANGES or NO-GO");
      reqString(task.prior_round_verdict, "round", "task.prior_round_verdict");
    }
    return { action, kind: "review" };
  }

  // check-gate
  const ge = task.gate_evidence;
  if (!isPlainObject(ge)) throw new SchemaError("task.gate_evidence is required for check-gate");
  checkOnlyKeys(
    ge,
    new Set(["reviewer", "round", "verdict", "repo", "resource", "scope_ids", "result_head", "reviewed_head", "muse_agreed", "muse_record_id"]),
    "task.gate_evidence"
  );
  reqString(ge, "reviewer", "task.gate_evidence");
  reqString(ge, "round", "task.gate_evidence");
  if (!["GO", "NEEDS CHANGES", "NO-GO"].includes(ge.verdict))
    throw new SchemaError("task.gate_evidence.verdict must be GO, NEEDS CHANGES or NO-GO");
  reqString(ge, "repo", "task.gate_evidence");
  reqString(ge, "resource", "task.gate_evidence");
  optStringArray(ge, "scope_ids", "task.gate_evidence");
  const rh = reqString(ge, "result_head", "task.gate_evidence");
  if (!HEX40.test(rh)) throw new SchemaError("task.gate_evidence.result_head must be a full lowercase 40-hex Git object ID");
  if (typeof ge.muse_agreed !== "boolean") throw new SchemaError("task.gate_evidence.muse_agreed must be a boolean");
  if (ge.muse_record_id !== undefined && (typeof ge.muse_record_id !== "string" || ge.muse_record_id.length === 0))
    throw new SchemaError("task.gate_evidence.muse_record_id must be a non-empty string when present");
  if (ge.reviewed_head !== undefined) {
    if (!HEX40.test(ge.reviewed_head)) throw new SchemaError("task.gate_evidence.reviewed_head must be a full lowercase 40-hex Git object ID");
  }
  return { action, kind: "check-gate" };
}
