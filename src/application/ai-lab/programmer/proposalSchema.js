/**
 * proposalSchema.js — runtime validation of the v1 dry-run proposal
 * artifact (P5-A contract).
 *
 * A proposal is private, content-addressed, advisory-only evidence.
 * It is NEVER applied, committed, pushed, made into a PR, merged or
 * deployed by this system; `advisory` must be true and
 * `authorization` must be exactly "PROPOSAL_ONLY".
 *
 * Budgets and profile IDs are pinned to the #610 prototype by
 * import (see jobContracts.js) — the numbers live in exactly one
 * place. Secret/credential patterns in display fields refuse: the
 * detectors are heuristic tripwires (the prototype's own caveat),
 * not a claim of universal detection; security comes from the
 * closed schema, the budget caps and the fact that no proposal can
 * execute anything.
 */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  ALL_PROFILE_IDS,
  BUDGETS,
  JobRefusal,
  POLICY_VERSION,
  PROPOSAL_SCHEMA_VERSION,
} from "./jobContracts.js";
import { SUPPORTED_FAMILIES } from "../../../../scripts/ai-agents/programmer-prototype/src/constants.mjs";

export const JOB_LIFECYCLE = Object.freeze([
  "DISABLED",
  "QUEUED",
  "PREPARING",
  "PROPOSED",
  "VERIFYING",
  "VERIFIED",
  "FAILED_VERIFICATION",
  "BLOCKED",
  "REFUSED",
  "CANCELLED",
  "EXPIRED",
]);

export const AUDIT_EVENTS = Object.freeze([
  "created",
  "proposed",
  "verifying",
  "verified",
  "failed_verification",
  "blocked",
  "refused",
  "cancelled",
  "expired",
  "decision_recorded",
  "previewed",
]);

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

// Secret / credential tripwires for display fields (mirrors the
// prototype task-schema detectors; see module header caveat).
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

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isStr(v, max = 4096) {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

function exactKeys(obj, allowed, path) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) {
      throw new JobRefusal("BAD_PROPOSAL", `unknown field '${path}.${k}'`);
    }
  }
}

function requireFields(obj, fields, path) {
  for (const f of fields) {
    if (obj[f] === undefined) throw new JobRefusal("BAD_PROPOSAL", `missing required field '${path}.${f}'`);
  }
}

/** Scan a display string for secret/credential patterns. Returns the matched pattern source or null. */
export function scanSecrets(text) {
  if (typeof text !== "string") return null;
  for (const re of SECRET_RES) {
    const m = text.match(re);
    if (m) return m[0].slice(0, 80);
  }
  return null;
}

function rejectSecretField(value, path) {
  const hit = scanSecrets(value);
  if (hit) {
    throw new JobRefusal("SECRET_REJECTED", `${path} contains a secret-bearing pattern ('${hit}')`);
  }
}

/**
 * A repo-relative path is safe only when it is relative, has no
 * traversal, no backslash, no absolute root, no `.git` segment and
 * no `.env` reference. Symlinks cannot be judged from a string, so
 * the evaluator (P5-B) must re-check the materialized tree; the
 * string-level check here is the first gate, not the last.
 */
export function isSafeRelativePath(p) {
  if (typeof p !== "string" || p.length === 0 || p.length > 512) return false;
  if (p.startsWith("/") || p.startsWith("\\")) return false;
  if (p.includes("\\")) return false;
  if (p.includes("\0")) return false;
  const segments = p.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return false;
  if (segments.includes(".git")) return false;
  if (segments.some((s) => s === ".env" || s.startsWith(".env."))) return false;
  return true;
}

function requireSafeRelativePath(p, path) {
  if (!isSafeRelativePath(p)) {
    throw new JobRefusal("PATH_REJECTED", `${path} must be a safe repo-relative path, got '${String(p).slice(0, 80)}'`);
  }
}

/**
 * Count added/removed lines in a normalized unified diff. Header
 * lines (`+++ ` / `--- `) are not content lines. Returns
 * { added, removed, files: Map<path, {added, removed}> } keyed by
 * the `b/` side of each `diff --git` section.
 */
export function parseDiff(diff) {
  const lines = diff.split("\n");
  let added = 0;
  let removed = 0;
  const files = new Map();
  let current = null;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      current = m ? m[2] : null;
      if (current && !files.has(current)) files.set(current, { added: 0, removed: 0 });
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) {
      added += 1;
      if (current) files.get(current).added += 1;
    } else if (line.startsWith("-")) {
      removed += 1;
      if (current) files.get(current).removed += 1;
    }
  }
  return { added, removed, files };
}

function deepFreeze(v) {
  if (v !== null && typeof v === "object") {
    for (const child of Object.values(v)) deepFreeze(child);
    Object.freeze(v);
  }
  return v;
}

function detachedCopy(v) {
  return JSON.parse(JSON.stringify(v));
}

const PROPOSAL_FIELDS = Object.freeze([
  "schema_version",
  "job_id",
  "agent",
  "source",
  "task",
  "operator",
  "worktree",
  "plan",
  "test_profiles",
  "verification",
  "risks",
  "rollback_notes",
  "created_at",
  "expires_at",
  "audit",
  "status",
  "advisory",
  "authorization",
]);

/**
 * Validate a v1 proposal artifact. Returns a deep-frozen detached
 * copy on success; throws JobRefusal on any failure. Unknown fields
 * refuse at every level.
 */
export function validateProposal(input) {
  if (!isPlainObject(input)) throw new JobRefusal("BAD_PROPOSAL", "proposal must be an object");
  exactKeys(input, PROPOSAL_FIELDS, "$");
  requireFields(input, PROPOSAL_FIELDS, "$");

  if (input.schema_version !== PROPOSAL_SCHEMA_VERSION) {
    throw new JobRefusal("BAD_PROPOSAL", `schema_version must be ${PROPOSAL_SCHEMA_VERSION}`);
  }
  if (!isStr(input.job_id, 128)) throw new JobRefusal("BAD_PROPOSAL", "job_id must be a non-empty string (<=128)");
  if (input.agent !== "programmer") throw new JobRefusal("BAD_PROPOSAL", "agent must be 'programmer'");
  if (input.advisory !== true) throw new JobRefusal("BAD_PROPOSAL", "advisory must be true");
  if (input.authorization !== "PROPOSAL_ONLY") {
    throw new JobRefusal("BAD_PROPOSAL", "authorization must be exactly 'PROPOSAL_ONLY'");
  }
  if (!JOB_LIFECYCLE.includes(input.status)) {
    throw new JobRefusal("BAD_PROPOSAL", `status must be one of ${JOB_LIFECYCLE.join(", ")}`);
  }

  // Source identity: exact base SHA, observed head, display name only.
  const src = input.source;
  if (!isPlainObject(src)) throw new JobRefusal("BAD_PROPOSAL", "source must be an object");
  exactKeys(src, ["repo", "repo_id", "branch_display_name", "base_sha", "observed_head"], "source");
  requireFields(src, ["repo", "repo_id", "branch_display_name", "base_sha", "observed_head"], "source");
  if (!isStr(src.repo, 256) || !isStr(src.repo_id, 256)) {
    throw new JobRefusal("BAD_PROPOSAL", "source.repo / source.repo_id must be non-empty strings");
  }
  if (!isStr(src.branch_display_name, 256)) {
    throw new JobRefusal("BAD_PROPOSAL", "source.branch_display_name must be a non-empty string");
  }
  rejectSecretField(src.branch_display_name, "source.branch_display_name");
  if (!HEX40.test(src.base_sha)) throw new JobRefusal("BAD_PROPOSAL", "source.base_sha must be a full 40-hex Git object id");
  if (!HEX40.test(src.observed_head)) {
    throw new JobRefusal("BAD_PROPOSAL", "source.observed_head must be a full 40-hex Git object id");
  }

  // Task / brief / policy digests.
  const task = input.task;
  if (!isPlainObject(task)) throw new JobRefusal("BAD_PROPOSAL", "task must be an object");
  exactKeys(task, ["task_id", "family", "description", "brief_digest", "policy_version", "policy_digest"], "task");
  requireFields(task, ["task_id", "family", "description", "brief_digest", "policy_version", "policy_digest"], "task");
  if (!isStr(task.task_id, 128)) throw new JobRefusal("BAD_PROPOSAL", "task.task_id must be a non-empty string");
  if (!SUPPORTED_FAMILIES.includes(task.family)) {
    throw new JobRefusal("BAD_PROPOSAL", `task.family must be one of ${SUPPORTED_FAMILIES.join(", ")}`);
  }
  if (!isStr(task.description, 8192)) throw new JobRefusal("BAD_PROPOSAL", "task.description must be a non-empty string");
  rejectSecretField(task.description, "task.description");
  if (!HEX64.test(task.brief_digest)) throw new JobRefusal("BAD_PROPOSAL", "task.brief_digest must be 64-hex SHA-256");
  if (!HEX64.test(task.policy_digest)) throw new JobRefusal("BAD_PROPOSAL", "task.policy_digest must be 64-hex SHA-256");
  if (task.policy_version !== POLICY_VERSION) {
    throw new JobRefusal("BAD_PROPOSAL", `task.policy_version must be ${POLICY_VERSION}`);
  }

  // Operator / run identity.
  const op = input.operator;
  if (!isPlainObject(op)) throw new JobRefusal("BAD_PROPOSAL", "operator must be an object");
  exactKeys(op, ["operator_ref", "run_id"], "operator");
  requireFields(op, ["operator_ref", "run_id"], "operator");
  if (!isStr(op.operator_ref, 128) || !isStr(op.run_id, 128)) {
    throw new JobRefusal("BAD_PROPOSAL", "operator.operator_ref / operator.run_id must be non-empty strings");
  }

  // Worktree provenance: opaque job-scoped ID + sanitized relative
  // diagnostic location. Never a user-controlled absolute path.
  const wt = input.worktree;
  if (!isPlainObject(wt)) throw new JobRefusal("BAD_PROPOSAL", "worktree must be an object");
  exactKeys(wt, ["job_scoped_id", "diagnostic_location"], "worktree");
  requireFields(wt, ["job_scoped_id", "diagnostic_location"], "worktree");
  if (!SAFE_ID_RE.test(wt.job_scoped_id)) {
    throw new JobRefusal("BAD_PROPOSAL", "worktree.job_scoped_id must be an opaque job-scoped id");
  }
  requireSafeRelativePath(wt.diagnostic_location, "worktree.diagnostic_location");
  rejectSecretField(wt.diagnostic_location, "worktree.diagnostic_location");

  // Planned files + bounded normalized unified diff.
  const plan = input.plan;
  if (!isPlainObject(plan)) throw new JobRefusal("BAD_PROPOSAL", "plan must be an object");
  exactKeys(plan, ["files", "diff", "patch_sha256", "candidate_tree_digest"], "plan");
  requireFields(plan, ["files", "diff", "patch_sha256", "candidate_tree_digest"], "plan");
  if (!Array.isArray(plan.files) || plan.files.length === 0 || plan.files.length > BUDGETS.maxTargetFiles) {
    throw new JobRefusal(
      "BUDGET_EXCEEDED",
      `plan.files must list 1..${BUDGETS.maxTargetFiles} files`,
    );
  }
  let declaredAdded = 0;
  let declaredRemoved = 0;
  const seenPaths = new Set();
  for (const [i, f] of plan.files.entries()) {
    if (!isPlainObject(f)) throw new JobRefusal("BAD_PROPOSAL", `plan.files[${i}] must be an object`);
    exactKeys(f, ["path", "operation", "added_lines", "removed_lines"], `plan.files[${i}]`);
    requireFields(f, ["path", "operation", "added_lines", "removed_lines"], `plan.files[${i}]`);
    requireSafeRelativePath(f.path, `plan.files[${i}].path`);
    rejectSecretField(f.path, `plan.files[${i}].path`);
    if (f.operation !== "add" && f.operation !== "modify") {
      throw new JobRefusal("BAD_PROPOSAL", `plan.files[${i}].operation must be 'add' or 'modify' (no delete, no rename)`);
    }
    if (!Number.isInteger(f.added_lines) || f.added_lines < 0) {
      throw new JobRefusal("BAD_PROPOSAL", `plan.files[${i}].added_lines must be a non-negative integer`);
    }
    if (!Number.isInteger(f.removed_lines) || f.removed_lines < 0) {
      throw new JobRefusal("BAD_PROPOSAL", `plan.files[${i}].removed_lines must be a non-negative integer`);
    }
    if (seenPaths.has(f.path)) throw new JobRefusal("BAD_PROPOSAL", `plan.files lists '${f.path}' twice`);
    seenPaths.add(f.path);
    declaredAdded += f.added_lines;
    declaredRemoved += f.removed_lines;
  }
  if (typeof plan.diff !== "string" || plan.diff.length === 0) {
    throw new JobRefusal("BAD_PROPOSAL", "plan.diff must be a non-empty unified diff string");
  }
  if (Buffer.byteLength(plan.diff, "utf8") > BUDGETS.maxPatchBytes) {
    throw new JobRefusal("BUDGET_EXCEEDED", `plan.diff exceeds ${BUDGETS.maxPatchBytes} bytes`);
  }
  const parsed = parseDiff(plan.diff);
  if (parsed.added + parsed.removed > BUDGETS.maxAddedRemovedLines) {
    throw new JobRefusal(
      "BUDGET_EXCEEDED",
      `plan.diff changes ${parsed.added + parsed.removed} lines, over the ${BUDGETS.maxAddedRemovedLines} limit`,
    );
  }
  if (parsed.added !== declaredAdded || parsed.removed !== declaredRemoved) {
    throw new JobRefusal(
      "BAD_PROPOSAL",
      `plan.diff line counts (+${parsed.added}/-${parsed.removed}) do not match declared file counts (+${declaredAdded}/-${declaredRemoved})`,
    );
  }
  for (const path of seenPaths) {
    const entry = parsed.files.get(path);
    if (!entry) throw new JobRefusal("BAD_PROPOSAL", `plan.diff has no 'diff --git' section for planned file '${path}'`);
    const declared = plan.files.find((f) => f.path === path);
    if (entry.added !== declared.added_lines || entry.removed !== declared.removed_lines) {
      throw new JobRefusal(
        "BAD_PROPOSAL",
        `plan.diff counts for '${path}' (+${entry.added}/-${entry.removed}) do not match declared (+${declared.added_lines}/-${declared.removed_lines})`,
      );
    }
  }
  // A private-key block in the diff itself is never displayable evidence.
  if (/BEGIN [A-Z ]*PRIVATE KEY/.test(plan.diff)) {
    throw new JobRefusal("SECRET_REJECTED", "plan.diff contains a private-key block");
  }
  if (!HEX64.test(plan.patch_sha256)) throw new JobRefusal("BAD_PROPOSAL", "plan.patch_sha256 must be 64-hex SHA-256");
  if (sha256Hex(plan.diff) !== plan.patch_sha256) {
    throw new JobRefusal("DIGEST_MISMATCH", "plan.patch_sha256 does not match the SHA-256 of plan.diff");
  }
  if (!HEX64.test(plan.candidate_tree_digest)) {
    throw new JobRefusal("BAD_PROPOSAL", "plan.candidate_tree_digest must be 64-hex SHA-256");
  }

  // Test profiles: closed subset, no duplicates.
  if (!Array.isArray(input.test_profiles) || input.test_profiles.length === 0 || input.test_profiles.length > BUDGETS.maxProfiles) {
    throw new JobRefusal("BUDGET_EXCEEDED", `test_profiles must list 1..${BUDGETS.maxProfiles} profiles`);
  }
  for (const p of input.test_profiles) {
    if (!ALL_PROFILE_IDS.includes(p)) {
      throw new JobRefusal("BAD_PROPOSAL", `unknown test profile '${String(p)}' — only ${ALL_PROFILE_IDS.join(", ")} exist`);
    }
  }
  if (new Set(input.test_profiles).size !== input.test_profiles.length) {
    throw new JobRefusal("BAD_PROPOSAL", "test_profiles must not repeat a profile");
  }

  // Verification receipt: shape-checked here; the state mapping
  // (receiptMapping.js) decides what it proves.
  const ver = input.verification;
  if (!isPlainObject(ver)) throw new JobRefusal("BAD_PROPOSAL", "verification must be an object");
  exactKeys(ver, ["receipt", "logs_digest"], "verification");
  requireFields(ver, ["receipt", "logs_digest"], "verification");
  if (!HEX64.test(ver.logs_digest)) throw new JobRefusal("BAD_PROPOSAL", "verification.logs_digest must be 64-hex SHA-256");
  validateReceiptShape(ver.receipt);

  // Risks, rollback notes, timestamps, audit chain.
  if (!Array.isArray(input.risks) || input.risks.length > 16) {
    throw new JobRefusal("BAD_PROPOSAL", "risks must be an array of at most 16 strings");
  }
  for (const [i, r] of input.risks.entries()) {
    if (typeof r !== "string" || r.length === 0 || r.length > 500) {
      throw new JobRefusal("BAD_PROPOSAL", `risks[${i}] must be a non-empty string (<=500 chars)`);
    }
    rejectSecretField(r, `risks[${i}]`);
  }
  if (typeof input.rollback_notes !== "string" || input.rollback_notes.length > 2000) {
    throw new JobRefusal("BAD_PROPOSAL", "rollback_notes must be a string (<=2000 chars)");
  }
  rejectSecretField(input.rollback_notes, "rollback_notes");
  for (const f of ["created_at", "expires_at"]) {
    if (typeof input[f] !== "string" || !ISO_INSTANT_RE.test(input[f]) || Number.isNaN(Date.parse(input[f]))) {
      throw new JobRefusal("BAD_PROPOSAL", `${f} must be an explicit UTC instant (Zulu)`);
    }
  }
  if (Date.parse(input.expires_at) <= Date.parse(input.created_at)) {
    throw new JobRefusal("BAD_PROPOSAL", "expires_at must be after created_at");
  }
  if (!Array.isArray(input.audit) || input.audit.length === 0 || input.audit.length > 64) {
    throw new JobRefusal("BAD_PROPOSAL", "audit must be an array of 1..64 events");
  }
  for (const [i, ev] of input.audit.entries()) {
    if (!isPlainObject(ev)) throw new JobRefusal("BAD_PROPOSAL", `audit[${i}] must be an object`);
    exactKeys(ev, ["event", "at", "actor", "detail"], `audit[${i}]`);
    requireFields(ev, ["event", "at", "actor", "detail"], `audit[${i}]`);
    if (!AUDIT_EVENTS.includes(ev.event)) {
      throw new JobRefusal("BAD_PROPOSAL", `audit[${i}].event must be one of ${AUDIT_EVENTS.join(", ")}`);
    }
    if (typeof ev.at !== "string" || !ISO_INSTANT_RE.test(ev.at)) {
      throw new JobRefusal("BAD_PROPOSAL", `audit[${i}].at must be an explicit UTC instant (Zulu)`);
    }
    if (!isStr(ev.actor, 128)) throw new JobRefusal("BAD_PROPOSAL", `audit[${i}].actor must be a non-empty string`);
    if (typeof ev.detail !== "string" || ev.detail.length > 500) {
      throw new JobRefusal("BAD_PROPOSAL", `audit[${i}].detail must be a string (<=500 chars)`);
    }
    rejectSecretField(ev.detail, `audit[${i}].detail`);
  }

  return deepFreeze(detachedCopy(input));
}

/**
 * Shape-check a P3 qa-test-runner receipt as carried in a proposal.
 * This validates structure only — it proves nothing about the run.
 * The mapping in receiptMapping.js decides the verification state,
 * and a structurally valid receipt can still map to BLOCKED or FAIL.
 * A null receipt is allowed here (verification not yet run); the
 * mapping treats it as NOT_RUN.
 */
export function validateReceiptShape(receipt) {
  if (receipt === null) return null;
  if (!isPlainObject(receipt)) throw new JobRefusal("BAD_PROPOSAL", "verification.receipt must be an object or null");
  exactKeys(
    receipt,
    ["schema_version", "agent", "advisory", "job_id", "target", "head_pin", "checkout_head", "status", "verdict", "reason_code", "diagnostics", "isolation", "suites", "totals"],
    "verification.receipt",
  );
  requireFields(
    receipt,
    ["schema_version", "agent", "advisory", "job_id", "target", "head_pin", "checkout_head", "status", "verdict", "reason_code", "diagnostics", "isolation", "suites", "totals"],
    "verification.receipt",
  );
  if (receipt.schema_version !== "1") throw new JobRefusal("BAD_PROPOSAL", "verification.receipt.schema_version must be '1'");
  if (receipt.agent !== "qa-test-runner") throw new JobRefusal("BAD_PROPOSAL", "verification.receipt.agent must be 'qa-test-runner'");
  if (receipt.advisory !== true) throw new JobRefusal("BAD_PROPOSAL", "verification.receipt.advisory must be true");
  if (!["COMPLETED", "REFUSED"].includes(receipt.status)) {
    throw new JobRefusal("BAD_PROPOSAL", "verification.receipt.status must be COMPLETED or REFUSED");
  }
  if (!["ALL_SUITES_PASS", "SUITES_FAILED", "REFUSED"].includes(receipt.verdict)) {
    throw new JobRefusal("BAD_PROPOSAL", "verification.receipt.verdict must be ALL_SUITES_PASS, SUITES_FAILED or REFUSED");
  }
  if (receipt.head_pin !== null && !HEX40.test(receipt.head_pin)) {
    throw new JobRefusal("BAD_PROPOSAL", "verification.receipt.head_pin must be a 40-hex pin or null");
  }
  if (receipt.checkout_head !== null && !HEX40.test(receipt.checkout_head)) {
    throw new JobRefusal("BAD_PROPOSAL", "verification.receipt.checkout_head must be a 40-hex pin or null");
  }
  if (!Array.isArray(receipt.suites)) throw new JobRefusal("BAD_PROPOSAL", "verification.receipt.suites must be an array");
  for (const [i, s] of receipt.suites.entries()) {
    if (!isPlainObject(s)) throw new JobRefusal("BAD_PROPOSAL", `verification.receipt.suites[${i}] must be an object`);
    if (!["PASS", "FAIL", "ERROR", "TIMEOUT", "SKIPPED_BUDGET"].includes(s.status)) {
      throw new JobRefusal("BAD_PROPOSAL", `verification.receipt.suites[${i}].status is not a closed P3 suite status`);
    }
    if (typeof s.cleanup_failed !== "boolean") {
      throw new JobRefusal("BAD_PROPOSAL", `verification.receipt.suites[${i}].cleanup_failed must be a boolean`);
    }
  }
  if (receipt.isolation !== null && !isPlainObject(receipt.isolation)) {
    throw new JobRefusal("BAD_PROPOSAL", "verification.receipt.isolation must be an object or null");
  }
  return receipt;
}
