/**
 * schemas.js — runtime schema validation for the architecture-reviewer
 * prototype. All schemas run at runtime and reject unknown properties in
 * control-bearing objects, absent required fields, wrong types, invalid
 * enum values, duplicate IDs, nonfinite numbers, invalid dates and
 * abbreviated/malformed pins. A malformed request yields a structured
 * denial, never an exception or default success.
 */

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const KNOWN_ACTIONS = new Set(["review", "check-gate"]);
const PROHIBITED_ACTIONS = new Set(["merge", "deploy", "execute", "approve", "publish", "activate", "run", "apply"]);
// Canonical confined fixture paths for this prototype's design store:
// repo-relative, inside the designs/ namespace, no traversal, no absolute.
const CONFINED_PATH = /^designs\/[a-z0-9][a-z0-9._-]*\.md$/;

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
  const path = reqString(ref, "path", where);
  if (!CONFINED_PATH.test(path))
    throw new SchemaError(`${where}: 'path' must be a canonical confined fixture path (designs/<name>.md)`);
  const commit = reqString(ref, "commit", where);
  if (!HEX40.test(commit)) throw new SchemaError(`${where}: 'commit' must be a full lowercase 40-hex Git object ID`);
  const blob = reqString(ref, "blob", where);
  if (!HEX40.test(blob)) throw new SchemaError(`${where}: 'blob' must be a full lowercase 40-hex Git object ID`);
  if (ref.algorithm !== "git-sha1")
    throw new SchemaError(`${where}: 'algorithm' must be "git-sha1"`);
  reqString(ref, "revision", where);
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

/**
 * Strict calendar date validation: ISO-8601 UTC "YYYY-MM-DDTHH:mm:ssZ"
 * with real calendar validity (2026-02-30 is rejected). Date.parse is
 * never used for validation — it accepts calendar rollover.
 */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
export function validateIsoDate(value, where) {
  if (typeof value !== "string") throw new SchemaError(`${where} must be an ISO-8601 UTC date string`);
  const m = value.match(ISO_DATE);
  if (!m) throw new SchemaError(`${where} must match YYYY-MM-DDTHH:mm:ssZ`);
  const [, Y, Mo, D, h, mi, s] = m.map(Number);
  if (Mo < 1 || Mo > 12) throw new SchemaError(`${where} has an invalid month`);
  const leap = Y % 4 === 0 && (Y % 100 !== 0 || Y % 400 === 0);
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Mo - 1];
  if (D < 1 || D > dim) throw new SchemaError(`${where} is not a real calendar date`);
  if (h > 23 || mi > 59 || s > 59) throw new SchemaError(`${where} has an invalid time`);
  return Date.parse(value);
}

function reqBoolean(obj, key, where) {
  if (typeof obj[key] !== "boolean") throw new SchemaError(`${where}: '${key}' must be a boolean`);
  return obj[key];
}

function optScopeIds(obj, where) {
  const v = obj.scope_ids;
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new SchemaError(`${where}: 'scope_ids' must be an array`);
  for (const s of v) {
    if (typeof s !== "string" || s.length === 0) throw new SchemaError(`${where}: 'scope_ids' entries must be non-empty strings`);
  }
  return v;
}

/**
 * Strict reviewer-verdict record schema. No missing-field defaults:
 * `revoked` is required and must be a boolean; dates must be real
 * calendar dates. Duplicate record IDs with conflicting content are
 * rejected by validateRecordStore.
 *
 * AR-001: source_ref is REQUIRED. A verdict record without a bound
 * source cannot gate — the gate must match the verdict's source
 * against the host policy's source identity, not merely compare two
 * fields inside the same verdict.
 */
export function validateReviewerVerdictRecord(rec, where) {
  if (!isPlainObject(rec)) throw new SchemaError(`${where}: verdict record must be an object`);
  checkOnlyKeys(
    rec,
    new Set(["record_id", "reviewer", "round", "verdict", "repo", "resource", "scope_ids", "result_head", "reviewed_head", "source_ref", "valid_from", "expires_at", "revoked", "advisory"]),
    where
  );
  reqString(rec, "record_id", where);
  reqString(rec, "reviewer", where);
  reqString(rec, "round", where);
  if (!["GO", "NEEDS CHANGES", "NO-GO"].includes(rec.verdict))
    throw new SchemaError(`${where}: 'verdict' must be GO, NEEDS CHANGES or NO-GO`);
  reqString(rec, "repo", where);
  reqString(rec, "resource", where);
  optScopeIds(rec, where);
  const rh = reqString(rec, "result_head", where);
  if (!HEX40.test(rh)) throw new SchemaError(`${where}: 'result_head' must be a full lowercase 40-hex Git object ID`);
  const vh = reqString(rec, "reviewed_head", where);
  if (!HEX40.test(vh)) throw new SchemaError(`${where}: 'reviewed_head' must be a full lowercase 40-hex Git object ID`);
  if (rec.source_ref === undefined) throw new SchemaError(`${where}: 'source_ref' is required`);
  validateSourceRef(rec.source_ref, `${where}.source_ref`);
  validateIsoDate(rec.valid_from, `${where}.valid_from`);
  validateIsoDate(rec.expires_at, `${where}.expires_at`);
  reqBoolean(rec, "revoked", where);
  reqBoolean(rec, "advisory", where);
  return rec;
}

/**
 * Strict agreement record schema: a Muse agreement must be an explicit
 * record binding a principal to the same target, not mere registration.
 *
 * AR-001: the agreement carries a validated reference to the EXACT
 * verdict record it agrees with (verdict_ref), plus its own source_ref.
 * Agreement is with this verdict and this source — never a generic
 * agreed:true. Standing agreement checks (explicit agreement, target
 * binding, validity, principal) are represented by these trusted record
 * fields, not inferred from registration alone.
 */
export function validateAgreementRecord(rec, where) {
  if (!isPlainObject(rec)) throw new SchemaError(`${where}: agreement record must be an object`);
  checkOnlyKeys(
    rec,
    new Set(["record_id", "principal_id", "repo", "resource", "scope_ids", "result_head", "round", "agreed", "verdict_ref", "source_ref", "valid_from", "expires_at", "revoked"]),
    where
  );
  reqString(rec, "record_id", where);
  reqString(rec, "principal_id", where);
  reqString(rec, "repo", where);
  reqString(rec, "resource", where);
  optScopeIds(rec, where);
  const rh = reqString(rec, "result_head", where);
  if (!HEX40.test(rh)) throw new SchemaError(`${where}: 'result_head' must be a full lowercase 40-hex Git object ID`);
  reqString(rec, "round", where);
  reqBoolean(rec, "agreed", where);
  reqString(rec, "verdict_ref", where);
  if (rec.source_ref === undefined) throw new SchemaError(`${where}: 'source_ref' is required`);
  validateSourceRef(rec.source_ref, `${where}.source_ref`);
  validateIsoDate(rec.valid_from, `${where}.valid_from`);
  validateIsoDate(rec.expires_at, `${where}.expires_at`);
  reqBoolean(rec, "revoked", where);
  return rec;
}

/**
 * Strict principal record schema for the injected principal registry.
 */
export function validatePrincipalRecord(rec, where) {
  if (!isPlainObject(rec)) throw new SchemaError(`${where}: principal record must be an object`);
  checkOnlyKeys(rec, new Set(["principal_id", "registered_by", "valid_from", "expires_at", "revoked"]), where);
  reqString(rec, "principal_id", where);
  reqString(rec, "registered_by", where);
  validateIsoDate(rec.valid_from, `${where}.valid_from`);
  validateIsoDate(rec.expires_at, `${where}.expires_at`);
  reqBoolean(rec, "revoked", where);
  return rec;
}

/**
 * Strict host gate-policy schema (AR-001). The policy is the
 * independently current target binding: it carries the EXACT current
 * result head and the COMPLETE source identity (SourceRef:
 * repo/path/commit/blob/algorithm/revision) the gate evaluates against.
 * A verdict/agreement whose heads merely match each other but not the
 * policy's current head is stale — the policy's actual target head is
 * never ignored. A verdict/agreement that names only the right repo but
 * a different source path/commit/blob/revision is evidence for another
 * target (round-3 finding).
 */
export function validateGatePolicy(policy, where) {
  if (!isPlainObject(policy)) throw new SchemaError(`${where} must be an object`);
  checkOnlyKeys(
    policy,
    new Set(["required_round", "repo", "resource", "scope_ids", "result_head", "source"]),
    where
  );
  reqString(policy, "required_round", where);
  reqString(policy, "repo", where);
  reqString(policy, "resource", where);
  optScopeIds(policy, where);
  const rh = reqString(policy, "result_head", where);
  if (!HEX40.test(rh)) throw new SchemaError(`${where}: 'result_head' must be a full lowercase 40-hex Git object ID`);
  // AR-001 round 3: the policy's source identity must be a COMPLETE
  // validated SourceRef (repo/path/commit/blob/algorithm/revision) —
  // a repo name alone cannot bind a verdict/agreement to a source revision.
  validateSourceRef(policy.source, `${where}.source`);
  return policy;
}

/**
 * Validate a record store: every record passes its schema, and duplicate
 * record_ids are allowed only when canonically identical — conflicting
 * duplicates are rejected.
 */
export function validateRecordStore(records, validator, where) {
  if (records === undefined) return [];
  if (!Array.isArray(records)) throw new SchemaError(`${where} must be an array`);
  const byId = new Map();
  for (let i = 0; i < records.length; i++) {
    const rec = validator(records[i], `${where}[${i}]`);
    const prior = byId.get(rec.record_id);
    const canon = JSON.stringify(rec, Object.keys(rec).sort());
    if (prior !== undefined && prior !== canon)
      throw new SchemaError(`${where}: duplicate conflicting record_id '${rec.record_id}'`);
    byId.set(rec.record_id, canon);
  }
  return records;
}

/**
 * Validate a Citation against the contract's single provenance schema:
 * full SourceRef (including algorithm and revision) plus quoted_span,
 * span and verification.
 */
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

  // check-gate: the payload supplies REFERENCES ONLY into the separately
  // injected authenticated fixture stores (context.verdicts,
  // context.agreements, context.principals). Request-minted verdict labels,
  // booleans and matching hashes are never trusted.
  const ge = task.gate_evidence;
  if (!isPlainObject(ge)) throw new SchemaError("task.gate_evidence is required for check-gate");
  checkOnlyKeys(ge, new Set(["verdict_ref", "agreement_ref"]), "task.gate_evidence");
  reqString(ge, "verdict_ref", "task.gate_evidence");
  reqString(ge, "agreement_ref", "task.gate_evidence");
  return { action, kind: "check-gate" };
}
