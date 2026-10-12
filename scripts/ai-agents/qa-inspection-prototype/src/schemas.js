/**
 * schemas.js — runtime schema validation for the QA/Inspection prototype.
 *
 * Strict by design: unknown properties are rejected in control-bearing
 * objects, enums are enforced, duplicate IDs are rejected, nonfinite numbers
 * are rejected, and pins must be full 40-hex lowercase Git object IDs.
 * A malformed request yields a structured denial, never an exception or a
 * default success.
 */

export const KINDS = Object.freeze([
  "navigation",
  "filter",
  "expand",
  "save",
  "export",
  "payment",
  "send",
  "production_write",
]);
export const OPERATIONS = Object.freeze(["report", "exercise"]);
export const MODALITIES = Object.freeze(["automated", "manual"]);
export const EVIDENCE_OUTCOMES = Object.freeze(["pass", "fail"]);

const HEX40 = /^[0-9a-f]{40}$/;
const MAX_ID_LEN = 128;

export function isHex40(s) {
  return typeof s === "string" && HEX40.test(s);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isNonEmptyString(v, maxLen = MAX_ID_LEN) {
  return typeof v === "string" && v.length > 0 && v.length <= maxLen;
}

/** Real YYYY-MM-DD (calendar-valid) or finite UTC ISO-8601 timestamp with Z. */
export function isValidDateString(s) {
  if (typeof s !== "string" || s.length === 0 || s.length > 64) return false;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    const dim = [
      31,
      y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
      31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ];
    return d <= dim[mo - 1];
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(s)) {
    return Number.isFinite(Date.parse(s));
  }
  return false;
}

class Collector {
  constructor() {
    this.errors = [];
  }
  add(code, path, message) {
    this.errors.push({ code, path, message });
  }
  get ok() {
    return this.errors.length === 0;
  }
}

/**
 * Enforce an exact key set on a control-bearing object.
 * Unknown properties are rejected (fail closed).
 */
function exactKeys(c, obj, allowed, path) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) {
      c.add("UNKNOWN_PROPERTY", path, `unknown property "${k}"`);
    }
  }
}

function checkId(c, v, path) {
  if (!isNonEmptyString(v)) c.add("INVALID_ID", path, "id must be a non-empty string");
}

function validateSurface(c, s, path) {
  if (!isPlainObject(s)) {
    c.add("INVALID_SURFACE", path, "surface must be an object");
    return;
  }
  exactKeys(c, s, ["id", "route", "environment"], path);
  checkId(c, s.id, `${path}.id`);
  if (!isNonEmptyString(s.route, 256)) c.add("INVALID_ROUTE", `${path}.route`, "route must be a non-empty string");
  if (s.environment !== "synthetic") {
    c.add("UNSUPPORTED_ENVIRONMENT", `${path}.environment`, 'environment must be "synthetic"');
  }
}

function validateBuildPin(c, p, path) {
  if (!isPlainObject(p)) {
    c.add("INVALID_BUILD_PIN", path, "build_pin must be an object");
    return;
  }
  exactKeys(c, p, ["repo", "commit", "build_id", "environment"], path);
  if (!isNonEmptyString(p.repo, 256)) c.add("INVALID_REPO", `${path}.repo`, "repo must be a non-empty string");
  if (!isHex40(p.commit)) c.add("MALFORMED_PIN", `${path}.commit`, "commit must be 40-hex lowercase");
  checkId(c, p.build_id, `${path}.build_id`);
  if (!isNonEmptyString(p.environment, 64)) {
    c.add("INVALID_ENVIRONMENT", `${path}.environment`, "environment must be a non-empty string");
  }
}

function validateControl(c, ctrl, path, seenControlIds) {
  if (!isPlainObject(ctrl)) {
    c.add("INVALID_CONTROL", path, "control must be an object");
    return;
  }
  exactKeys(
    c,
    ctrl,
    ["control_id", "kind", "requested_operation", "assertion_ids", "required_modalities"],
    path
  );
  checkId(c, ctrl.control_id, `${path}.control_id`);
  if (typeof ctrl.control_id === "string") {
    if (seenControlIds.has(ctrl.control_id)) {
      c.add("DUPLICATE_ID", `${path}.control_id`, `duplicate control_id "${ctrl.control_id}"`);
    } else {
      seenControlIds.add(ctrl.control_id);
    }
  }
  if (!KINDS.includes(ctrl.kind)) c.add("INVALID_KIND", `${path}.kind`, `kind must be one of ${KINDS.join("|")}`);
  if (!OPERATIONS.includes(ctrl.requested_operation)) {
    c.add("INVALID_OPERATION", `${path}.requested_operation`, "requested_operation must be report|exercise");
  }
  if (!Array.isArray(ctrl.assertion_ids) || ctrl.assertion_ids.length > 64) {
    c.add("INVALID_ASSERTIONS", `${path}.assertion_ids`, "assertion_ids must be an array of at most 64 ids");
  } else {
    const seen = new Set();
    for (const [i, a] of ctrl.assertion_ids.entries()) {
      checkId(c, a, `${path}.assertion_ids[${i}]`);
      if (typeof a === "string") {
        if (seen.has(a)) c.add("DUPLICATE_ID", `${path}.assertion_ids[${i}]`, `duplicate assertion_id "${a}"`);
        seen.add(a);
      }
    }
  }
  if (
    !Array.isArray(ctrl.required_modalities) ||
    ctrl.required_modalities.length === 0 ||
    ctrl.required_modalities.length > 2
  ) {
    c.add(
      "INVALID_MODALITIES",
      `${path}.required_modalities`,
      "required_modalities must be a non-empty array of automated|manual"
    );
  } else {
    const seen = new Set();
    for (const [i, m] of ctrl.required_modalities.entries()) {
      if (!MODALITIES.includes(m)) {
        c.add("INVALID_MODALITY", `${path}.required_modalities[${i}]`, "modality must be automated|manual");
      }
      if (seen.has(m)) c.add("DUPLICATE_ID", `${path}.required_modalities[${i}]`, `duplicate modality "${m}"`);
      seen.add(m);
    }
  }
}

function validateEvidenceSource(c, s, path) {
  if (!isPlainObject(s)) {
    c.add("INVALID_SOURCE", path, "evidence source must be an object");
    return;
  }
  if (s.kind === "source") {
    exactKeys(c, s, ["kind", "repo", "path", "commit", "blob", "algorithm", "revision"], path);
    if (!isNonEmptyString(s.repo, 256)) c.add("INVALID_REPO", `${path}.repo`, "repo must be a non-empty string");
    if (typeof s.path !== "string" || s.path.length === 0 || s.path.length > 512) {
      c.add("INVALID_PATH", `${path}.path`, "path must be a non-empty repo-relative path");
    } else if (s.path.startsWith("/") || s.path.includes("..")) {
      c.add("INVALID_PATH", `${path}.path`, "path must be canonical repo-relative (no traversal/absolute)");
    }
    if (!isHex40(s.commit)) c.add("MALFORMED_PIN", `${path}.commit`, "commit must be 40-hex lowercase");
    if (!isHex40(s.blob)) c.add("MALFORMED_PIN", `${path}.blob`, "blob must be 40-hex lowercase");
    if (s.algorithm !== "git-sha1") c.add("INVALID_ALGORITHM", `${path}.algorithm`, 'algorithm must be "git-sha1"');
    if (!isNonEmptyString(s.revision, 64)) c.add("INVALID_REVISION", `${path}.revision`, "revision required");
  } else if (s.kind === "artifact") {
    exactKeys(c, s, ["kind", "fixture_id", "sha256", "media_type", "byte_length"], path);
    checkId(c, s.fixture_id, `${path}.fixture_id`);
    if (typeof s.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(s.sha256)) {
      c.add("MALFORMED_DIGEST", `${path}.sha256`, "sha256 must be 64-hex lowercase");
    }
    if (!isNonEmptyString(s.media_type, 128)) {
      c.add("INVALID_MEDIA_TYPE", `${path}.media_type`, "media_type required");
    }
    if (!Number.isInteger(s.byte_length) || s.byte_length < 0 || !Number.isFinite(s.byte_length)) {
      c.add("INVALID_BYTE_LENGTH", `${path}.byte_length`, "byte_length must be a finite non-negative integer");
    }
  } else {
    c.add("INVALID_SOURCE_KIND", path, 'source kind must be "source"|"artifact"');
  }
}

/**
 * Validate a QA task. Returns {ok, errors}. Never throws on user data.
 */
export function validateTask(task) {
  const c = new Collector();
  if (!isPlainObject(task)) {
    c.add("INVALID_TASK", "$", "task must be an object");
    return { ok: false, errors: c.errors };
  }
  exactKeys(c, task, ["task_id", "surface", "build_pin", "controls", "evidence_sources"], "$");
  checkId(c, task.task_id, "$.task_id");
  validateSurface(c, task.surface, "$.surface");
  validateBuildPin(c, task.build_pin, "$.build_pin");
  if (!Array.isArray(task.controls) || task.controls.length > 64) {
    c.add("INVALID_CONTROLS", "$.controls", "controls must be an array of at most 64 controls");
  } else {
    const seen = new Set();
    for (const [i, ctrl] of task.controls.entries()) {
      validateControl(c, ctrl, `$.controls[${i}]`, seen);
    }
  }
  if (!Array.isArray(task.evidence_sources) || task.evidence_sources.length > 64) {
    c.add("INVALID_SOURCES", "$.evidence_sources", "evidence_sources must be an array of at most 64 sources");
  } else {
    for (const [i, s] of task.evidence_sources.entries()) {
      validateEvidenceSource(c, s, `$.evidence_sources[${i}]`);
    }
  }
  return { ok: c.ok, errors: c.errors };
}

/**
 * Validate an evidence record coming from the fixture resolver.
 * Resolver data is still validated at the trust boundary.
 */
export function validateEvidenceRecord(ev) {
  const c = new Collector();
  if (!isPlainObject(ev)) {
    c.add("EVIDENCE_MALFORMED", "$", "evidence record must be an object");
    return { ok: false, errors: c.errors };
  }
  exactKeys(
    c,
    ev,
    [
      "evidence_id",
      "control_id",
      "assertion_id",
      "modality",
      "build_id",
      "repo",
      "commit",
      "environment",
      "run_id",
      "artifact_ref",
      "timestamp",
      "expected",
      "observed",
      "outcome",
      "fixture_observer_id",
    ],
    "$"
  );
  checkId(c, ev.evidence_id, "$.evidence_id");
  checkId(c, ev.control_id, "$.control_id");
  checkId(c, ev.assertion_id, "$.assertion_id");
  if (!MODALITIES.includes(ev.modality)) c.add("INVALID_MODALITY", "$.modality", "modality must be automated|manual");
  checkId(c, ev.build_id, "$.build_id");
  if (!isNonEmptyString(ev.repo, 256)) c.add("INVALID_REPO", "$.repo", "repo required");
  if (!isHex40(ev.commit)) c.add("MALFORMED_PIN", "$.commit", "commit must be 40-hex lowercase");
  if (!isNonEmptyString(ev.environment, 64)) c.add("INVALID_ENVIRONMENT", "$.environment", "environment required");
  if (ev.run_id !== null && !isNonEmptyString(ev.run_id)) {
    c.add("INVALID_RUN_ID", "$.run_id", "run_id must be a non-empty string or null");
  }
  if (ev.artifact_ref !== null) {
    if (!isPlainObject(ev.artifact_ref)) {
      c.add("INVALID_ARTIFACT_REF", "$.artifact_ref", "artifact_ref must be an object or null");
    } else {
      exactKeys(c, ev.artifact_ref, ["fixture_id", "sha256", "media_type", "byte_length"], "$.artifact_ref");
      checkId(c, ev.artifact_ref.fixture_id, "$.artifact_ref.fixture_id");
      if (typeof ev.artifact_ref.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(ev.artifact_ref.sha256)) {
        c.add("MALFORMED_DIGEST", "$.artifact_ref.sha256", "sha256 must be 64-hex lowercase");
      }
    }
  }
  if (!isValidDateString(ev.timestamp)) c.add("INVALID_TIMESTAMP", "$.timestamp", "timestamp must be YYYY-MM-DD or finite ISO Z");
  if (ev.expected === undefined) c.add("MISSING_EXPECTED", "$.expected", "expected is required (structured assertion)");
  if (ev.observed === undefined) c.add("MISSING_OBSERVED", "$.observed", "observed is required (structured assertion)");
  if (!EVIDENCE_OUTCOMES.includes(ev.outcome)) {
    c.add("INVALID_OUTCOME", "$.outcome", "outcome must be pass|fail");
  }
  checkId(c, ev.fixture_observer_id, "$.fixture_observer_id");
  return { ok: c.ok, errors: c.errors };
}
