/**
 * task-schema.mjs — strict Task JSON v1 validation plus deterministic
 * adversarial-input detectors. Pure module: no I/O.
 *
 * Detectors are heuristic tripwires (documented limits in README), not a
 * claim of universal injection detection.
 */

import { TASK_SCHEMA_VERSION, SUPPORTED_FAMILIES, REASON, ALL_PROFILE_IDS, OPERATIONS } from "./constants.mjs";
import { normalizePath } from "./paths.mjs";

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

// Forbidden-capability instruction patterns (push/merge/self-approve/shell…).
const INJECTION_RES = [
  /\bpush\b.*\b(branch|main|origin|remote)\b/i,
  /\bgit\s+push\b/i,
  /\bmerge\b.*\b(pr|pull request|into main)\b/i,
  /\bself-?approv/i,
  /\bapprove (this|the|your own)\b/i,
  /\bbypass (review|approval|gate)\b/i,
  /run .*shell|execute .*command|child_process|spawn\(/i,
  /\bchmod\b|\bcurl\b|\bwget\b/i,
  /delete .*\.git/i,
];

// Secret / credential extraction patterns.
const SECRET_RES = [
  /api[_-]?key/i,
  /\bsecret\b/i,
  /password/i,
  /private[_-]?key/i,
  /\btoken\b/i,
  /credential/i,
  /connection[_-]?string/i,
  /\.env\b/i,
  /BEGIN [A-Z ]*PRIVATE KEY/,
];

// Live production / tenant / financial data patterns.
const PRODUCTION_RES = [
  /\bledger\b/i,
  /\btenant\b/i,
  /live (production|database|db)\b/i,
  /real (customer|tenant|payment|transaction)/i,
  /scheduling data/i,
  /rental manager/i,
  /stripe/i,
  /bank account/i,
];

function isStr(v, max = 4096) {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

function scanPatterns(text, patterns) {
  const hits = [];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) hits.push(m[0].slice(0, 80));
  }
  return hits;
}

/**
 * Validate the task envelope. Returns { ok:true, task } or
 * { ok:false, status, reason_codes:[...], detail }.
 */
export function validateTaskEnvelope(input) {
  const fail = (status, reason_codes, detail) => ({ ok: false, status, reason_codes, detail });
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return fail("BLOCKED", [REASON.TASK_MALFORMED], "task must be an object");
  }
  if (input.schema_version !== TASK_SCHEMA_VERSION) {
    return fail("BLOCKED", [REASON.SCHEMA_VERSION_UNSUPPORTED], `schema_version=${input.schema_version}`);
  }
  if (!isStr(input.task_id, 128)) return fail("BLOCKED", [REASON.TASK_MALFORMED], "task_id");
  const br = input.brief_ref;
  if (!br || typeof br !== "object") return fail("BLOCKED", [REASON.TASK_MALFORMED], "brief_ref");
  for (const [k, test] of [
    ["repo", (v) => isStr(v, 256)],
    ["path", (v) => isStr(v, 512)],
    // Provenance: the brief commit must be the exact 40-char git object id,
    // not an abbreviated prefix. Abbreviations are ambiguous identities.
    ["commit", (v) => typeof v === "string" && HEX40.test(v)],
    ["blob", (v) => typeof v === "string" && HEX40.test(v)],
    ["algorithm", (v) => v === "git-sha1"],
  ]) {
    if (!test(br[k])) return fail("BLOCKED", [REASON.TASK_MALFORMED], `brief_ref.${k}`);
  }
  const fr = input.fixture_ref;
  if (!fr || typeof fr !== "object") return fail("BLOCKED", [REASON.TASK_MALFORMED], "fixture_ref");
  for (const [k, test] of [
    ["fixture_id", (v) => isStr(v, 128)],
    ["repo_id", (v) => isStr(v, 256)],
    ["base_commit", (v) => typeof v === "string" && HEX40.test(v)],
    ["manifest_sha256", (v) => typeof v === "string" && HEX64.test(v)],
  ]) {
    if (!test(fr[k])) return fail("BLOCKED", [REASON.TASK_MALFORMED], `fixture_ref.${k}`);
  }
  const t = input.task;
  if (!t || typeof t !== "object") return fail("BLOCKED", [REASON.TASK_MALFORMED], "task");
  if (!SUPPORTED_FAMILIES.includes(t.family)) {
    return fail("BLOCKED", [REASON.FAMILY_UNSUPPORTED], `family=${t.family}`);
  }
  if (!isStr(t.description, 8192)) return fail("BLOCKED", [REASON.TASK_MALFORMED], "task.description");
  if (!Array.isArray(t.acceptance_ids) || t.acceptance_ids.length === 0 || t.acceptance_ids.length > 16) {
    return fail("BLOCKED", [REASON.TASK_MALFORMED], "task.acceptance_ids");
  }
  if (!t.acceptance_ids.every((a) => isStr(a, 128))) {
    return fail("BLOCKED", [REASON.TASK_MALFORMED], "task.acceptance_ids[]");
  }
  if (t.params !== undefined && (typeof t.params !== "object" || t.params === null || Array.isArray(t.params))) {
    return fail("BLOCKED", [REASON.TASK_MALFORMED], "task.params");
  }
  const c = input.constraints;
  if (!c || typeof c !== "object") return fail("BLOCKED", [REASON.TASK_MALFORMED], "constraints");
  const ops = c.allowed_operations;
  if (!Array.isArray(ops) || ops.length === 0 || !ops.every((o) => Object.values(OPERATIONS).includes(o))) {
    return fail("BLOCKED", [REASON.TASK_MALFORMED], "constraints.allowed_operations");
  }
  for (const k of ["allowed_paths", "forbidden_paths"]) {
    if (!Array.isArray(c[k]) || !c[k].every((p) => typeof p === "string" && normalizePath(p))) {
      return fail("BLOCKED", [REASON.TASK_MALFORMED], `constraints.${k}`);
    }
  }
  if (input.candidate_ref !== undefined) {
    const cr = input.candidate_ref;
    if (!cr || cr.kind !== "replay" || typeof cr.diff !== "string" || !HEX64.test(cr.diff_sha256 || "")) {
      return fail("BLOCKED", [REASON.TASK_MALFORMED], "candidate_ref");
    }
  }
  return { ok: true, task: input };
}

/**
 * Adversarial-input classification over the task description (+ params text).
 * Returns null when clean, else { status:"REFUSED", reason_codes, detail }.
 * Order: forbidden capability > secret > production input.
 */
export function classifyAdversarial(task) {
  const text = `${task.task.description}\n${JSON.stringify(task.task.params || {})}`;
  const inj = scanPatterns(text, INJECTION_RES);
  if (inj.length > 0) {
    return { status: "REFUSED", reason_codes: [REASON.INJECTION_FORBIDDEN_CAPABILITY], detail: inj[0] };
  }
  const sec = scanPatterns(text, SECRET_RES);
  if (sec.length > 0) {
    return { status: "REFUSED", reason_codes: [REASON.SECRET_REQUEST], detail: sec[0] };
  }
  const prod = scanPatterns(text, PRODUCTION_RES);
  if (prod.length > 0) {
    return { status: "REFUSED", reason_codes: [REASON.PRODUCTION_INPUT], detail: prod[0] };
  }
  return null;
}

/**
 * Ambiguity / conflict detection over family params.
 * Returns null when unambiguous, else { status:"BLOCKED", reason_codes, detail }.
 */
export function detectAmbiguity(task) {
  const p = task.task.params || {};
  const fam = task.task.family;
  if (fam === "literal-correction" || fam === "boundary-correction") {
    const cands = [p.bad_literal, p.bad, p.bad_expr, p.target].filter((v) => typeof v === "string" && v.length > 0);
    const uniq = [...new Set(cands)];
    if (uniq.length === 0) return { status: "BLOCKED", reason_codes: [REASON.AMBIGUOUS_TASK], detail: "no-correction-target" };
    if (uniq.length > 1) return { status: "BLOCKED", reason_codes: [REASON.CONFLICTING_TASKS], detail: "multiple-correction-targets" };
    if (!p.good && !p.good_literal && !p.good_expr) {
      return { status: "BLOCKED", reason_codes: [REASON.AMBIGUOUS_TASK], detail: "no-replacement-given" };
    }
  }
  if (fam === "add-helper") {
    if (typeof p.helper_source !== "string" || p.helper_source.length === 0) {
      return { status: "BLOCKED", reason_codes: [REASON.AMBIGUOUS_TASK], detail: "helper_source-missing" };
    }
    if (!p.parent_dir || !p.filename) {
      return { status: "BLOCKED", reason_codes: [REASON.AMBIGUOUS_TASK], detail: "parent-or-filename-missing" };
    }
  }
  return null;
}

/** Validate fixed execution profile ids requested by the plan. */
export function validateProfileIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 3) {
    return { ok: false, reason: REASON.PROFILE_TAMPER, detail: "profile-id-list" };
  }
  for (const id of ids) {
    if (!ALL_PROFILE_IDS.includes(id)) return { ok: false, reason: REASON.PROFILE_TAMPER, detail: `unknown-profile:${id}` };
  }
  return { ok: true };
}
