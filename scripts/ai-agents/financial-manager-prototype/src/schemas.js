/**
 * schemas.js — runtime schema validation. Control-bearing objects reject
 * unknown properties, absent required fields, wrong types, invalid enum
 * values, duplicate IDs, nonfinite numbers, invalid dates and malformed
 * amounts. Submitted strings are data; nothing here executes them.
 */

import { isIntegerMinorString, isRationalAmount } from "./money.js";

const HEX40 = /^[0-9a-f]{40}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const SUPPORT_ENUM = new Set(["verified", "attributed"]);

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function checkKeys(obj, allowed, required, path, errors) {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) errors.push(`${path}: unknown property ${JSON.stringify(k)}`);
  }
  for (const k of required) {
    if (!(k in obj)) errors.push(`${path}: missing required property ${JSON.stringify(k)}`);
  }
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function isValidDate(s) {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
  );
}

const TASK_KEYS = new Set(["task_id", "bundle_refs", "period_ids", "requested_action"]);
const REF_KEYS = new Set(["repo", "path", "commit", "blob", "algorithm", "revision"]);
const SECTION_KEYS = new Set([
  "section_id",
  "currency",
  "minor_unit_scale",
  "population_id",
  "period_start",
  "period_end",
  "disjoint_proof",
  "lines",
  "claimed_totals",
  "narrative_claims",
]);
const LINE_KEYS = new Set([
  "line_id",
  "category",
  "budget_minor",
  "actual_minor",
  "source_labels",
  "support_strength",
  "flags",
]);
const CLAIMED_KEYS = new Set(["claim_id", "line_ids", "claimed_budget_minor", "claimed_actual_minor"]);
const NARR_KEYS = new Set([
  "claim_id",
  "kind",
  "metric",
  "line_ids",
  "direction",
  "quoted_text",
  "basis_refs",
]);
const BASIS_KEYS = new Set(["basis_id", "verified", "bounded_fact"]);

export function validateSourceRef(ref, path, errors) {
  if (!isObj(ref)) {
    errors.push(`${path}: SourceRef must be an object`);
    return;
  }
  checkKeys(ref, REF_KEYS, ["repo", "path", "commit", "blob", "algorithm", "revision"], path, errors);
  if (!isNonEmptyString(ref.repo)) errors.push(`${path}.repo: must be a non-empty string`);
  if (typeof ref.path !== "string" || ref.path.length === 0) {
    errors.push(`${path}.path: must be a non-empty string`);
  } else if (
    ref.path.startsWith("/") ||
    ref.path.includes("\\") ||
    ref.path.split("/").includes("..")
  ) {
    errors.push(`${path}.path: traversal/absolute paths rejected`);
  }
  if (typeof ref.commit !== "string" || !HEX40.test(ref.commit)) {
    errors.push(`${path}.commit: must be a full lowercase 40-hex Git object ID`);
  }
  if (typeof ref.blob !== "string" || !HEX40.test(ref.blob)) {
    errors.push(`${path}.blob: must be a full lowercase 40-hex Git object ID`);
  }
  if (ref.algorithm !== "git-sha1") errors.push(`${path}.algorithm: must be "git-sha1"`);
  if (!isNonEmptyString(ref.revision)) errors.push(`${path}.revision: must be a non-empty string`);
}

function validateAmount(a, path, errors) {
  if (isIntegerMinorString(a) || isRationalAmount(a)) return true;
  errors.push(
    `${path}: amount must be a signed integer decimal string or {numerator, denominator} decimal strings (denominator positive)`
  );
  return false;
}

function validateLine(line, path, errors) {
  if (!isObj(line)) {
    errors.push(`${path}: line must be an object`);
    return;
  }
  checkKeys(
    line,
    LINE_KEYS,
    ["line_id", "category", "budget_minor", "actual_minor", "source_labels", "support_strength", "flags"],
    path,
    errors
  );
  if (!isNonEmptyString(line.line_id)) errors.push(`${path}.line_id: must be a non-empty string`);
  if (line.category !== "revenue" && line.category !== "expense") {
    errors.push(`${path}.category: must be "revenue" or "expense"`);
  }
  validateAmount(line.budget_minor, `${path}.budget_minor`, errors);
  validateAmount(line.actual_minor, `${path}.actual_minor`, errors);
  if (!isStringArray(line.source_labels)) {
    errors.push(`${path}.source_labels: must be an array of strings`);
  }
  if (line.support_strength !== null && !SUPPORT_ENUM.has(line.support_strength)) {
    errors.push(`${path}.support_strength: must be "verified", "attributed" or null`);
  }
  if (!isStringArray(line.flags)) errors.push(`${path}.flags: must be an array of strings`);
}

function validateClaimedTotal(ct, path, errors) {
  if (!isObj(ct)) {
    errors.push(`${path}: claimed_total must be an object`);
    return;
  }
  checkKeys(ct, CLAIMED_KEYS, ["claim_id", "line_ids", "claimed_budget_minor", "claimed_actual_minor"], path, errors);
  if (!isNonEmptyString(ct.claim_id)) errors.push(`${path}.claim_id: must be a non-empty string`);
  if (!Array.isArray(ct.line_ids) || ct.line_ids.length === 0 || !ct.line_ids.every(isNonEmptyString)) {
    errors.push(`${path}.line_ids: must be a non-empty array of non-empty strings`);
  }
  validateAmount(ct.claimed_budget_minor, `${path}.claimed_budget_minor`, errors);
  validateAmount(ct.claimed_actual_minor, `${path}.claimed_actual_minor`, errors);
}

function validateBasisRef(b, path, errors) {
  if (!isObj(b)) {
    errors.push(`${path}: basis_ref must be an object`);
    return;
  }
  checkKeys(b, BASIS_KEYS, ["basis_id", "verified", "bounded_fact"], path, errors);
  if (!isNonEmptyString(b.basis_id)) errors.push(`${path}.basis_id: must be a non-empty string`);
  if (typeof b.verified !== "boolean") errors.push(`${path}.verified: must be a boolean`);
  if (typeof b.bounded_fact !== "string") errors.push(`${path}.bounded_fact: must be a string`);
}

function validateNarrativeClaim(nc, path, errors) {
  if (!isObj(nc)) {
    errors.push(`${path}: narrative_claim must be an object`);
    return;
  }
  checkKeys(
    nc,
    NARR_KEYS,
    ["claim_id", "kind", "metric", "line_ids", "direction", "quoted_text", "basis_refs"],
    path,
    errors
  );
  if (!isNonEmptyString(nc.claim_id)) errors.push(`${path}.claim_id: must be a non-empty string`);
  if (nc.kind !== "movement" && nc.kind !== "cause") {
    errors.push(`${path}.kind: must be "movement" or "cause"`);
  }
  if (nc.metric !== "variance" && nc.metric !== "actual") {
    errors.push(`${path}.metric: must be "variance" or "actual"`);
  }
  if (!Array.isArray(nc.line_ids) || nc.line_ids.length === 0 || !nc.line_ids.every(isNonEmptyString)) {
    errors.push(`${path}.line_ids: must be a non-empty array of non-empty strings`);
  }
  if (nc.direction !== "up" && nc.direction !== "down" && nc.direction !== "flat") {
    errors.push(`${path}.direction: must be "up", "down" or "flat"`);
  }
  if (typeof nc.quoted_text !== "string" || nc.quoted_text.length === 0) {
    errors.push(`${path}.quoted_text: must be a non-empty string`);
  }
  if (!Array.isArray(nc.basis_refs)) {
    errors.push(`${path}.basis_refs: must be an array`);
  } else {
    nc.basis_refs.forEach((b, i) => validateBasisRef(b, `${path}.basis_refs[${i}]`, errors));
  }
}

export function validateSection(sec, path, errors) {
  if (!isObj(sec)) {
    errors.push(`${path}: section must be an object`);
    return;
  }
  checkKeys(
    sec,
    SECTION_KEYS,
    [
      "section_id",
      "currency",
      "minor_unit_scale",
      "population_id",
      "period_start",
      "period_end",
      "lines",
      "claimed_totals",
      "narrative_claims",
    ],
    path,
    errors
  );
  if (!isNonEmptyString(sec.section_id)) errors.push(`${path}.section_id: must be a non-empty string`);
  if (typeof sec.currency !== "string" || !CURRENCY_RE.test(sec.currency)) {
    errors.push(`${path}.currency: must be a 3-letter uppercase code`);
  }
  if (!Number.isInteger(sec.minor_unit_scale) || sec.minor_unit_scale < 0 || sec.minor_unit_scale > 6) {
    errors.push(`${path}.minor_unit_scale: must be an integer 0..6`);
  }
  if (!isNonEmptyString(sec.population_id)) errors.push(`${path}.population_id: must be a non-empty string`);
  if (!isValidDate(sec.period_start)) errors.push(`${path}.period_start: must be a real YYYY-MM-DD date`);
  if (!isValidDate(sec.period_end)) errors.push(`${path}.period_end: must be a real YYYY-MM-DD date`);
  if (
    isValidDate(sec.period_start) &&
    isValidDate(sec.period_end) &&
    sec.period_start > sec.period_end
  ) {
    errors.push(`${path}: period_start must not be after period_end`);
  }
  if ("disjoint_proof" in sec && typeof sec.disjoint_proof !== "boolean") {
    errors.push(`${path}.disjoint_proof: must be a boolean when present`);
  }
  if (!Array.isArray(sec.lines)) {
    errors.push(`${path}.lines: must be an array`);
  } else {
    // NOTE: duplicate line_ids are intentionally allowed here. The brief's
    // dedup stage owns them: identical copies merge (labels unioned),
    // conflicting copies become a contradiction with no single aggregate.
    // Duplicate claim_ids and section_ids (no dedup semantics) are still rejected.
    sec.lines.forEach((l, i) => {
      validateLine(l, `${path}.lines[${i}]`, errors);
    });
  }
  if (!Array.isArray(sec.claimed_totals)) {
    errors.push(`${path}.claimed_totals: must be an array`);
  } else {
    sec.claimed_totals.forEach((ct, i) => validateClaimedTotal(ct, `${path}.claimed_totals[${i}]`, errors));
  }
  if (!Array.isArray(sec.narrative_claims)) {
    errors.push(`${path}.narrative_claims: must be an array`);
  } else {
    const seen = new Set();
    sec.narrative_claims.forEach((nc, i) => {
      validateNarrativeClaim(nc, `${path}.narrative_claims[${i}]`, errors);
      if (isObj(nc) && typeof nc.claim_id === "string") {
        if (seen.has(nc.claim_id)) errors.push(`${path}.narrative_claims[${i}]: duplicate claim_id`);
        seen.add(nc.claim_id);
      }
    });
  }
}

export function validateTask(task) {
  const errors = [];
  if (!isObj(task)) return { ok: false, errors: ["task: must be an object"] };
  checkKeys(task, TASK_KEYS, ["task_id", "bundle_refs", "period_ids", "requested_action"], "task", errors);
  if (!isNonEmptyString(task.task_id)) errors.push("task.task_id: must be a non-empty string");
  if (!Array.isArray(task.bundle_refs) || task.bundle_refs.length === 0) {
    errors.push("task.bundle_refs: must be a non-empty array of SourceRef");
  } else {
    task.bundle_refs.forEach((r, i) => validateSourceRef(r, `task.bundle_refs[${i}]`, errors));
  }
  if (!isStringArray(task.period_ids)) errors.push("task.period_ids: must be an array of strings");
  if (typeof task.requested_action !== "string" || task.requested_action.length === 0) {
    errors.push("task.requested_action: must be a non-empty string");
  }
  return { ok: errors.length === 0, errors };
}

export function validateClock(clock) {
  // fixed injected clock: finite UTC ISO timestamp with Z, or real YYYY-MM-DD
  if (typeof clock !== "string") return false;
  if (isValidDate(clock)) return true;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(clock)) return false;
  const t = Date.parse(clock);
  return Number.isFinite(t);
}
