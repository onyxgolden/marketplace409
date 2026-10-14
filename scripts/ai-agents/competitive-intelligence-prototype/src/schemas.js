/**
 * schemas.js — input/output schema validation for the CI comparison core.
 * Pure functions, no I/O. All validation is CLOSED: every validated object
 * has an exact allowed key set and unknown fields are rejected; enums are
 * exhaustive; digests/pins use exact hex formats; dates are validated.
 */

export const SCHEMA_VERSION = "ci-core/2";

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
export const FRESHNESS_STATES = ["fresh", "stale", "unknown"];
export const ACCESS_STATUSES = ["ok", "restricted", "expired", "unverified"];

export const LIMITS = {
  maxCells: 512,
  maxPropositions: 256,
  maxCitations: 512,
  maxOutputBytes: 1024 * 1024,
};

/** Exact allowed keys for a PublicSourceRef (contract §4 provenance/locator/integrity). */
export const SOURCE_REF_KEYS = [
  "source_id",
  "vendor_id",
  "product_id",
  "edition",
  "url",
  "final_url",
  "source_type",
  "accessed_at",
  "published_at",
  "page_version",
  "content_sha256",
  "locator",
  "access_status",
  "verification",
];
export const SOURCE_REF_REQUIRED = [
  "source_id",
  "vendor_id",
  "product_id",
  "url",
  "source_type",
  "accessed_at",
  "access_status",
  "content_sha256",
];

/** Exact allowed keys for the comparison task input (contract §8). */
export const TASK_INPUT_KEYS = [
  "task_id",
  "lane",
  "as_of_date",
  "requested_action",
  "confirmed_set_ref",
  "feature_taxonomy_ref",
  "competitor_source_refs",
  "forge_base_pin",
];

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function err(path, msg) {
  return `${path}: ${msg}`;
}

/** Reject unknown keys: closed validation. */
function checkClosed(obj, allowed, path, errors) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) errors.push(err(path, `unknown field ${k} (closed schema)`));
  }
}

export function isValidDate(s) {
  return typeof s === "string" && DATE_RE.test(s) && !Number.isNaN(Date.parse(s));
}

export function isValidDateTime(s) {
  return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

/** Validate a PublicSourceRef per contract §4. Returns array of error strings. */
export function validateSourceRef(ref, path = "source_ref") {
  const errors = [];
  if (!isPlainObject(ref)) return [err(path, "must be an object")];
  checkClosed(ref, SOURCE_REF_KEYS, path, errors);
  for (const k of SOURCE_REF_REQUIRED) {
    if (typeof ref[k] !== "string" || ref[k].length === 0) errors.push(err(path, `missing/invalid ${k}`));
  }
  if (ref.url && !/^https?:\/\//.test(ref.url)) errors.push(err(path, "url must be http(s)"));
  if (ref.content_sha256 && !HEX64.test(ref.content_sha256)) {
    errors.push(err(path, "content_sha256 must be 64-hex (integrity field)"));
  }
  if (ref.accessed_at && !isValidDateTime(ref.accessed_at)) errors.push(err(path, "accessed_at must be ISO date-time"));
  if (ref.access_status && !ACCESS_STATUSES.includes(ref.access_status)) {
    errors.push(err(path, `access_status must be one of ${ACCESS_STATUSES.join(",")}`));
  }
  if (ref.locator !== undefined && ref.locator !== null && !isPlainObject(ref.locator)) {
    errors.push(err(path, "locator must be an object"));
  }
  return errors;
}

/** Validate a digest reference {digest: 64-hex}. Closed. */
function validateDigestRef(ref, path, errors) {
  if (!isPlainObject(ref)) {
    errors.push(err(path, "must be an object"));
    return;
  }
  checkClosed(ref, ["digest"], path, errors);
  if (typeof ref.digest !== "string" || !HEX64.test(ref.digest)) {
    errors.push(err(path, "digest must be 64-hex"));
  }
}

/** Validate the comparison task input per contract §8. */
export function validateTaskInput(input) {
  const errors = [];
  if (!isPlainObject(input)) return ["input: must be an object"];
  checkClosed(input, TASK_INPUT_KEYS, "input", errors);
  for (const k of ["task_id", "lane"]) {
    if (typeof input[k] !== "string" || !input[k]) errors.push(err("input", `missing/invalid ${k}`));
  }
  if (!isValidDate(input.as_of_date)) errors.push(err("input", "as_of_date must be YYYY-MM-DD"));
  if (input.requested_action !== "internal_compare") errors.push(err("input", "requested_action must be internal_compare"));
  validateDigestRef(input.confirmed_set_ref, "input.confirmed_set_ref", errors);
  validateDigestRef(input.feature_taxonomy_ref, "input.feature_taxonomy_ref", errors);
  const pin = input.forge_base_pin;
  if (!isPlainObject(pin)) {
    errors.push(err("input", "forge_base_pin must be an object"));
  } else {
    checkClosed(pin, ["repo", "commit", "tree"], "input.forge_base_pin", errors);
    if (typeof pin.repo !== "string" || !REPO_RE.test(pin.repo)) {
      errors.push(err("input.forge_base_pin", "repo must be owner/name"));
    }
    if (typeof pin.commit !== "string" || !HEX40.test(pin.commit)) {
      errors.push(err("input.forge_base_pin", "commit must be full 40-hex SHA"));
    }
    if (typeof pin.tree !== "string" || !pin.tree) {
      errors.push(err("input.forge_base_pin", "tree must be a non-empty string"));
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
