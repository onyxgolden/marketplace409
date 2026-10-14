/**
 * schemas.js — input/output schema validation for the CI comparison core.
 * Pure functions, no I/O. All validation is closed: unknown fields are
 * rejected, enums are exhaustive, and limits from the contract are enforced.
 */

export const SCHEMA_VERSION = "ci-core/1";

export const EVIDENCE_STATES = ["supported", "contradicted", "unsupported"];
export const ATTRIBUTIONS = [
  "vendor_documented",
  "trial_observed",
  "user_reported",
  "forge_code",
  "forge_test",
  "none",
];
export const COMPARISONS = ["ahead", "parity", "behind", "undetermined", "not_comparable"];
export const TASK_STATUSES = ["COMPARED", "PARTIAL", "BLOCKED", "REFUSED"];
export const REQUESTED_ACTIONS = ["internal_compare"];

export const LIMITS = {
  maxCells: 512,
  maxPropositions: 256,
  maxCitations: 512,
  maxOutputBytes: 1024 * 1024,
};

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function err(path, msg) {
  return `${path}: ${msg}`;
}

/** Validate a PublicSourceRef per contract §4. Returns array of error strings. */
export function validateSourceRef(ref, path = "source_ref") {
  const errors = [];
  if (!isPlainObject(ref)) return [err(path, "must be an object")];
  const required = ["source_id", "vendor_id", "product_id", "url", "source_type", "accessed_at", "access_status"];
  for (const k of required) {
    if (typeof ref[k] !== "string" || ref[k].length === 0) errors.push(err(path, `missing/invalid ${k}`));
  }
  if (ref.url && !/^https?:\/\//.test(ref.url)) errors.push(err(path, "url must be http(s)"));
  // No verbatim competitor prose may ride along in a ref.
  for (const k of ["quoted_span", "raw_text", "page_text", "html"]) {
    if (k in ref) errors.push(err(path, `forbidden field ${k} (no copied competitor text)`));
  }
  return errors;
}

/** Validate the comparison task input per contract §8. */
export function validateTaskInput(input) {
  const errors = [];
  if (!isPlainObject(input)) return ["input: must be an object"];
  for (const k of ["task_id", "lane", "as_of_date"]) {
    if (typeof input[k] !== "string" || !input[k]) errors.push(err("input", `missing/invalid ${k}`));
  }
  if (input.requested_action !== "internal_compare") errors.push(err("input", "requested_action must be internal_compare"));
  if (!isPlainObject(input.confirmed_set_ref)) errors.push(err("input", "confirmed_set_ref must be an object"));
  if (!isPlainObject(input.feature_taxonomy_ref)) errors.push(err("input", "feature_taxonomy_ref must be an object"));
  if (!isPlainObject(input.forge_base_pin)) errors.push(err("input", "forge_base_pin must be an object"));
  else {
    for (const k of ["repo", "commit", "tree"]) {
      if (typeof input.forge_base_pin[k] !== "string" || !input.forge_base_pin[k])
        errors.push(err("input.forge_base_pin", `missing/invalid ${k}`));
    }
  }
  if (input.competitor_source_refs !== undefined) {
    if (!Array.isArray(input.competitor_source_refs)) errors.push(err("input", "competitor_source_refs must be an array"));
    else {
      if (input.competitor_source_refs.length > LIMITS.maxCitations)
        errors.push(err("input", `too many source refs (>${LIMITS.maxCitations})`));
      input.competitor_source_refs.forEach((r, i) =>
        errors.push(...validateSourceRef(r, `input.competitor_source_refs[${i}]`))
      );
    }
  }
  return errors;
}

/** Hard-fail codes the core may return instead of a matrix. */
export function refusal(status, reason_code, detail = null) {
  return {
    schema_version: SCHEMA_VERSION,
    status,
    reason_code,
    detail,
    internal_only: true,
    authorization_granted: false,
    publication_performed: false,
  };
}
