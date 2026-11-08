/**
 * worktreeEvaluator.js — pure domain logic for the P5-B trusted local
 * worktree evaluator.
 *
 * This module does NO I/O: no git, no filesystem, no processes. The
 * host adapter (`src/infrastructure/ai-lab/programmer/worktreeHost.js`)
 * performs the operations and asks this module what to accept, what to
 * reject, and how to derive provenance. Every decision here is unit
 * testable without a repository on disk.
 *
 * What P5-B adds on top of P5-A:
 * - P5-A defined the proposal contract and proved a bare P3 v1 receipt
 *   cannot bind a candidate tree (CANDIDATE_IDENTITY_UNPROVEN). P5-B
 *   supplies the missing half: a trusted host-side evaluation that pins
 *   a local mirror + exact base commit, creates a detached disposable
 *   worktree, validates ONE bounded candidate against the prototype's
 *   plan validator, applies it to scratch only, and records immutable
 *   diff/tree provenance (patch SHA-256 + candidate tree digest) that
 *   P5-C can independently re-derive.
 * - No candidate code is ever executed in this slice. Test execution
 *   is P5-C (via the existing P3 runner). The isolation gate here
 *   proves the host CAN isolate (P3's proven "bwrap"/"unshare"
 *   mechanisms) before any candidate is accepted; a host that cannot
 *   isolate returns BLOCKED_ISOLATION and never creates a worktree.
 * - Ships DISABLED; only the explicit synthetic preview harness may
 *   run it, against frozen synthetic local git repositories only.
 */

import { createHash } from "node:crypto";
import { parseDiff } from "./proposalSchema.js";
import { BUDGETS, POLICY_VERSION } from "./jobContracts.js";

export const EVALUATION_VERSION = "programmer-worktree-evaluation@1";
export const WORKTREE_EVALUATOR_VERSION = "programmer-worktree-evaluator@1";

/**
 * How the candidate tree digest is derived (P5-C re-derives it the
 * same way from the worktree, so it is never a self-asserted value):
 *   lines = for each file in the candidate tree, sorted by path:
 *             "<mode> <git-blob-sha1>\t<path>"
 *   digest = SHA-256("p5b-candidate-tree-v1\n" + lines.join("\n") + "\n")
 * The git blob SHA-1 is sha1("blob <byte-length>\0" + bytes) — the
 * standard git object id for the file content. Modes are the base
 * tree modes for modified files (100644/100755) and 100644 for added
 * files; P5-B never changes a file mode (a mode change in the
 * canonical diff refuses).
 */
export const CANDIDATE_TREE_DIGEST_LABEL = "p5b-candidate-tree-v1";

/** Reason codes P5-B adds to the prototype's REASON vocabulary. */
export const P5B_REASONS = Object.freeze({
  MIRROR_UNKNOWN: "MIRROR_UNKNOWN",
  MIRROR_UNTRUSTED: "MIRROR_UNTRUSTED",
  MIRROR_DRIFT: "MIRROR_DRIFT",
  WORKTREE_FAILED: "WORKTREE_FAILED",
  INTERRUPTED: "INTERRUPTED",
  PATCH_MISMATCH: "PATCH_MISMATCH",
  STALE_WORKTREE: "STALE_WORKTREE",
  // A host-provided outside-root canary changed, vanished, or could
  // not be compared during evaluation: the confinement evidence
  // explicitly failed, so the evaluation fails closed to BLOCKED.
  OUTSIDE_ROOT_MUTATION: "OUTSIDE_ROOT_MUTATION",
});

/** Terminal evaluation statuses (the record's `status` field). */
export const EVALUATION_STATUSES = Object.freeze(["PROPOSED", "BLOCKED", "REFUSED"]);

/** Audit events the evaluator records, in lifecycle order. */
export const EVALUATION_AUDIT_EVENTS = Object.freeze([
  "created",
  "mirror_validated",
  "base_pinned",
  "isolation_probed",
  "worktree_created",
  "candidate_validated",
  "candidate_applied",
  "provenance_recorded",
  "cleanup_completed",
  "cleanup_failed",
  "blocked",
  "refused",
  "interrupted",
  "reconciled",
]);

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sha1Hex(buffer) {
  return createHash("sha1").update(buffer).digest("hex");
}

/** Git blob object id for file bytes: sha1("blob <len>\0" + bytes). */
export function gitBlobSha1(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8");
  return sha1Hex(Buffer.concat([Buffer.from(`blob ${buf.length}\0`, "utf8"), buf]));
}

/**
 * Derive the candidate tree digest from [{path, mode, content}].
 * Content may be a string (UTF-8) or a Buffer. Paths must already be
 * validated safe relative paths; modes must be "100644" or "100755".
 */
export function computeCandidateTreeDigest(files) {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const lines = sorted.map((f) => {
    if (f.mode !== "100644" && f.mode !== "100755") {
      throw new Error(`candidate tree entry '${f.path}' has unsupported mode '${String(f.mode)}'`);
    }
    return `${f.mode} ${gitBlobSha1(f.content)}\t${f.path}`;
  });
  return sha256Hex(`${CANDIDATE_TREE_DIGEST_LABEL}\n${lines.join("\n")}\n`);
}

/** Opaque job-scoped worktree id, derived from the idempotency key only. */
export function jobScopedIdFor(idempotencyKey) {
  return `p5b-${sha256Hex(String(idempotencyKey)).slice(0, 16)}`;
}

/** Host-owned worktree path for a job: <root>/p5b-<opaque id>. */
export function worktreePathFor(worktreeRoot, idempotencyKey) {
  const root = String(worktreeRoot).replace(/\/+$/, "");
  return `${root}/${jobScopedIdFor(idempotencyKey)}`;
}

/**
 * Validate a base-tree listing from `git ls-tree -r`:
 * entries are [{mode, type, sha, path}]. Rejects symlinks (120000),
 * gitlinks/submodules (160000), non-blob types, `.git` segments,
 * backslashes / control characters, overlong paths, and
 * case-collisions (two paths equal after lowercasing — a case escape
 * on case-insensitive filesystems). Returns {ok:true} or
 * {ok:false, reason, detail}.
 */
export function checkTreeHygiene(entries) {
  const seenLower = new Set();
  for (const e of entries) {
    if (e.mode === "160000") {
      return { ok: false, reason: "MIRROR_UNTRUSTED", detail: `submodule-gitlink-in-base-tree:${e.path}` };
    }
    if (e.type !== "blob") {
      return { ok: false, reason: "MIRROR_UNTRUSTED", detail: `non-blob tree entry:${e.path}` };
    }
    if (e.mode === "120000") {
      return { ok: false, reason: "MIRROR_UNTRUSTED", detail: `symlink-in-base-tree:${e.path}` };
    }
    if (e.mode !== "100644" && e.mode !== "100755") {
      return { ok: false, reason: "MIRROR_UNTRUSTED", detail: `unsupported-mode:${e.path}:${e.mode}` };
    }
    if (typeof e.path !== "string" || e.path.length === 0 || e.path.length > 512) {
      return { ok: false, reason: "PATH_REJECTED", detail: "bad-tree-path" };
    }
    if (e.path.includes("\\") || /[\u0000-\u001f\u007f]/.test(e.path)) {
      return { ok: false, reason: "PATH_REJECTED", detail: `unsafe-tree-path:${e.path.slice(0, 80)}` };
    }
    if (e.path.split("/").includes(".git")) {
      return { ok: false, reason: "PATH_REJECTED", detail: `.git-segment-in-base-tree:${e.path}` };
    }
    const lower = e.path.toLowerCase();
    if (seenLower.has(lower)) {
      return { ok: false, reason: "PATH_REJECTED", detail: `case-collision:${e.path}` };
    }
    seenLower.add(lower);
    if (!HEX40.test(e.sha)) {
      return { ok: false, reason: "MIRROR_UNTRUSTED", detail: `bad-blob-sha:${e.path}` };
    }
  }
  return { ok: true };
}

/**
 * Dangerous local-config keys in a mirror. Any present key refuses
 * the mirror as untrusted — config can smuggle hooks, filters,
 * credential helpers, includes, or transport overrides, and a
 * trusted mirror must not carry them. `config` is [{key, value}]
 * with lower-cased keys as git reports them.
 */
const DANGEROUS_CONFIG_RES = [
  /^include\.path$/i,
  /^includeif\./i,
  /^core\.hookspath$/i,
  /^core\.sshcommand$/i,
  /^core\.gitproxy$/i,
  /^core\.fsmonitor$/i,
  /^extensions\.worktreeconfig$/i,
  /^filter\./i,
  /^credential\./i,
  /^protocol\..*\.allow$/i,
];
export function checkMirrorConfigEntries(entries) {
  for (const { key } of entries) {
    const k = String(key).toLowerCase();
    if (DANGEROUS_CONFIG_RES.some((re) => re.test(k))) {
      return { ok: false, reason: "MIRROR_UNTRUSTED", detail: `dangerous-config:${k}` };
    }
  }
  return { ok: true };
}

/**
 * Validate the evaluator job envelope (host-bound labels, not
 * caller-controlled authorization). Throws JobRefusal-style Error
 * with a `code` property on failure so the host can map it to a
 * terminal record without catching by message text.
 */
export function validateEvaluatorJob(job) {
  const refuse = (code, detail) => {
    const e = new Error(detail ? `${code}:${detail}` : code);
    e.code = code;
    throw e;
  };
  if (!job || typeof job !== "object" || Array.isArray(job)) refuse("BAD_REQUEST", "job must be an object");
  for (const f of ["job_id", "idempotency_key", "operator_ref", "repo_id", "base_sha", "task_digest"]) {
    if (typeof job[f] !== "string" || job[f].length === 0) refuse("BAD_REQUEST", `${f} must be a non-empty string`);
  }
  if (!SAFE_ID_RE.test(job.job_id)) refuse("BAD_REQUEST", "job_id must be a safe id");
  if (!HEX40.test(job.base_sha)) refuse("BAD_REQUEST", "base_sha must be a full 40-hex Git object id");
  if (!HEX64.test(job.task_digest)) refuse("BAD_REQUEST", "task_digest must be a 64-hex SHA-256 digest");
  if (job.policy_version !== undefined && job.policy_version !== POLICY_VERSION) {
    refuse("BAD_REQUEST", `policy_version must be ${POLICY_VERSION}`);
  }
  return job;
}

/**
 * The candidate a caller submits for evaluation: a task (prototype
 * shape), a plan (target files + profile ids), and the proposed
 * unified diff. Shape-checked here; the prototype's validatePlan
 * does the policy/budget/snapshot validation against the materialized
 * snapshot.
 */
export function validateCandidateShape(candidate) {
  const refuse = (code, detail) => {
    const e = new Error(detail ? `${code}:${detail}` : code);
    e.code = code;
    throw e;
  };
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    refuse("BAD_CANDIDATE", "candidate must be an object");
  }
  if (!candidate.task || typeof candidate.task !== "object") refuse("BAD_CANDIDATE", "candidate.task is required");
  if (!candidate.plan || typeof candidate.plan !== "object") refuse("BAD_CANDIDATE", "candidate.plan is required");
  if (typeof candidate.proposed_diff !== "string" || candidate.proposed_diff.length === 0) {
    refuse("BAD_CANDIDATE", "candidate.proposed_diff must be a non-empty string");
  }
  if (Buffer.byteLength(candidate.proposed_diff, "utf8") > BUDGETS.maxPatchBytes) {
    refuse("BUDGET_EXCEEDED", `candidate.proposed_diff exceeds ${BUDGETS.maxPatchBytes} bytes`);
  }
  return candidate;
}

/**
 * Check `git status --porcelain` output against the planned file
 * set. After applying the candidate, the worktree must show exactly
 * the planned files as modified/added and nothing else. `lines` are
 * raw porcelain lines; `plannedPaths` is the set of planned paths.
 * Untracked files outside the plan, deletions, renames, or mode-only
 * changes refuse.
 */
export function checkPorcelainMatchesPlan(lines, plannedPaths) {
  const seen = new Set();
  for (const raw of lines) {
    if (raw.trim() === "") continue;
    const status = raw.slice(0, 2);
    const path = raw.slice(3);
    if (status[0] === "R" || status[1] === "R" || status.trim() === "D" || status.includes("D")) {
      return { ok: false, reason: "PATCH_MISMATCH", detail: `unexpected-status:${status.trim()}:${path}` };
    }
    if (!plannedPaths.has(path)) {
      return { ok: false, reason: "PATCH_MISMATCH", detail: `unplanned-change:${status.trim()}:${path}` };
    }
    seen.add(path);
  }
  for (const p of plannedPaths) {
    if (!seen.has(p)) return { ok: false, reason: "PATCH_MISMATCH", detail: `planned-file-unchanged:${p}` };
  }
  return { ok: true };
}

/**
 * Normalize a canonical `git diff` for the proposal: LF line
 * endings, exactly one trailing newline, no mode-change lines, and
 * it must parse under P5-A's parseDiff with the same file set and
 * line counts as the candidate diff. Returns {ok:true, diff} or
 * {ok:false, reason, detail}.
 */
export function normalizeCanonicalDiff(gitDiff, candidateDiff) {
  if (typeof gitDiff !== "string" || gitDiff.length === 0) {
    return { ok: false, reason: "PATCH_MISMATCH", detail: "empty-canonical-diff" };
  }
  if (/^old mode|^new mode/m.test(gitDiff)) {
    return { ok: false, reason: "PATCH_MISMATCH", detail: "mode-change-in-canonical-diff" };
  }
  const diff = gitDiff.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const normalized = diff.endsWith("\n") ? diff : `${diff}\n`;
  let parsed;
  let candidateParsed;
  try {
    parsed = parseDiff(normalized);
    candidateParsed = parseDiff(candidateDiff);
  } catch {
    return { ok: false, reason: "PATCH_MALFORMED", detail: "canonical-diff-unparseable" };
  }
  if (parsed.added !== candidateParsed.added || parsed.removed !== candidateParsed.removed) {
    return {
      ok: false,
      reason: "PATCH_MISMATCH",
      detail: `canonical-diff-counts (+${parsed.added}/-${parsed.removed}) differ from candidate (+${candidateParsed.added}/-${candidateParsed.removed})`,
    };
  }
  const files = new Set(parsed.files.keys());
  const candidateFiles = new Set(candidateParsed.files.keys());
  if (files.size !== candidateFiles.size || [...files].some((f) => !candidateFiles.has(f))) {
    return { ok: false, reason: "PATCH_MISMATCH", detail: "canonical-diff-file-set-differs-from-candidate" };
  }
  return { ok: true, diff: normalized };
}

/**
 * Strip git-style file-section headers from a unified diff so the
 * strict prototype parser (which expects each file section to start
 * at `---`) can read a real git diff. Only structural header lines
 * are dropped; hunk bodies are untouched (their lines all start
 * with space/+/-/backslash, so no body line can match a header
 * pattern), and `Binary files` markers are NOT stripped — binary
 * patches are still refused by the parser.
 */
const GIT_DIFF_HEADER_RES = [
  /^diff --git /,
  /^index [0-9a-f]+\.\.[0-9a-f]+( [0-9]+)?$/,
  /^(old|new) mode [0-9]+$/,
  /^(new|deleted) file mode [0-9]+$/,
  /^similarity index \d+%$/,
  /^(rename|copy) (from|to) /,
];
export function stripGitDiffHeaders(diffText) {
  if (typeof diffText !== "string") return diffText;
  return diffText
    .split("\n")
    .filter((line) => !GIT_DIFF_HEADER_RES.some((re) => re.test(line)))
    .join("\n");
}

/** Append one audit event; returns a new array (records stay immutable). */
export function appendAuditEvent(audit, event, actor, detail, at) {
  if (!EVALUATION_AUDIT_EVENTS.includes(event)) {
    throw new Error(`unknown evaluation audit event '${event}'`);
  }
  const stamp = at ?? new Date().toISOString();
  return [...audit, { event, at: stamp, actor, detail: String(detail).slice(0, 500) }];
}

/**
 * Classify a stored idempotency record: "terminal" (PROPOSED /
 * BLOCKED / REFUSED — return as-is, never re-execute), "in-flight"
 * (PREPARING — a previous attempt crashed; the retry path marks it
 * INTERRUPTED and cleans up its worktree), or "unknown" (no record).
 */
export function classifyStoredRecord(record) {
  if (!record) return "unknown";
  if (EVALUATION_STATUSES.includes(record.status)) return "terminal";
  if (record.status === "PREPARING") return "in-flight";
  return "unknown";
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

/**
 * Assemble the immutable evaluation record. `parts` carries the
 * validated pieces; unknown fields refuse. The record is the
 * evidence P5-C re-derives the candidate from: mirror + base pin,
 * worktree provenance, isolation attestation, plan + digests, budget
 * ledger, canary results, and the audit chain. It is advisory-only
 * evidence — it never applies, commits, pushes, or executes anything.
 */
const RECORD_FIELDS = Object.freeze([
  "evaluation_version",
  "evaluator_version",
  "job_id",
  "idempotency_key",
  "task_digest",
  "candidate_diff_sha256",
  "operator_ref",
  "status",
  "reason_codes",
  "detail",
  "mirror",
  "worktree",
  "isolation",
  "plan",
  "budgets",
  "canaries",
  "risks",
  "audit",
  "created_at",
  "completed_at",
]);

export function buildEvaluationRecord(parts) {
  for (const k of Object.keys(parts)) {
    if (!RECORD_FIELDS.includes(k)) throw new Error(`unknown evaluation record field '${k}'`);
  }
  for (const f of RECORD_FIELDS) {
    if (parts[f] === undefined) throw new Error(`missing evaluation record field '${f}'`);
  }
  if (parts.evaluation_version !== EVALUATION_VERSION) {
    throw new Error(`evaluation_version must be ${EVALUATION_VERSION}`);
  }
  if (!EVALUATION_STATUSES.includes(parts.status) && parts.status !== "PREPARING") {
    throw new Error(`evaluation status must be one of ${[...EVALUATION_STATUSES, "PREPARING"].join(", ")}`);
  }
  if (!Array.isArray(parts.reason_codes)) throw new Error("reason_codes must be an array");
  if (!Array.isArray(parts.audit) || parts.audit.length === 0) throw new Error("audit must be a non-empty array");
  return deepFreeze(detachedCopy(parts));
}

/**
 * The plan portion of an evaluation record, in P5-A proposal shape:
 * files [{path, operation, added_lines, removed_lines}], the
 * canonical diff, its SHA-256, and the candidate tree digest. P5-D
 * assembles the full proposal around this; P5-C re-derives the
 * digests from the worktree before trusting them.
 */
export function planFromEvaluation(record) {
  return {
    files: record.plan.files,
    diff: record.plan.diff,
    patch_sha256: record.plan.patch_sha256,
    candidate_tree_digest: record.plan.candidate_tree_digest,
  };
}
