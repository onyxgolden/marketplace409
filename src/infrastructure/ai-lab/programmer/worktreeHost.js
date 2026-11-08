/**
 * worktreeHost.js — host adapter for the P5-B trusted local worktree
 * evaluator.
 *
 * This module performs the operations the pure domain module
 * (`src/application/ai-lab/programmer/worktreeEvaluator.js`) decides
 * about: git invocations, filesystem reads/writes, the P3 isolation
 * probe, and the idempotency store. It never decides policy on its
 * own — every accept/reject comes from the domain module or the
 * prototype's plan validator, both imported read-only.
 *
 * Safety posture (all enforced here, not assumed):
 * - Git runs with a scrubbed environment (no inherited credentials,
 *   no user config, no terminal prompts), `protocol.allow=never`,
 *   and `core.hooksPath` pointed at a host-owned EMPTY directory —
 *   no hook in any mirror can execute during checkout, diff, or
 *   worktree operations. Git is invoked by argv only (never a shell),
 *   with a 30s per-call timeout.
 * - The mirror is validated offline before any worktree is created:
 *   dangerous config, hooks, submodules, LFS/smudge filters, and
 *   base drift all refuse. The base tree is hygiene-checked
 *   (symlink/gitlink/.git/case-collision) before checkout.
 * - The worktree is detached at the exact pinned commit inside a
 *   host-owned root, under a job-scoped id derived from the
 *   idempotency key — never a caller-supplied path. Only job-owned
 *   worktrees (path under the host root + matching job-scoped id +
 *   admin gitdir pointing back at the path) are ever removed, and
 *   never with --force.
 * - Candidate code is NEVER executed here. The candidate diff is
 *   validated by the prototype's plan validator, applied to the
 *   worktree by writing bytes, and re-derived as a canonical git
 *   diff. Test execution is P5-C's job (existing P3 runner).
 * - Cleanup runs in try/finally: a cleanup failure overrides the
 *   outcome to BLOCKED / CLEANUP_FAILED. Refs/HEAD/index snapshots
 *   before/after prove no source-branch or shared-index mutation.
 * - The stale-worktree reconciler runs ONLY on explicit operator
 *   invocation (never a scheduler, never inside evaluateCandidate
 *   except for the same job's own crashed attempt).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { validatePlan } from "../../../../scripts/ai-agents/programmer-prototype/src/plan-validator.mjs";
import { applyDiffExact, parseUnifiedDiff } from "../../../../scripts/ai-agents/programmer-prototype/src/diff.mjs";
import { REASON, BUDGETS } from "../../../../scripts/ai-agents/programmer-prototype/src/constants.mjs";
import { detectIsolation } from "../../../../scripts/ai-agents/qa-test-runner/src/isolation.js";
import { requireSyntheticPreview } from "../../../application/ai-lab/programmer/mode.js";
import { JobRefusal } from "../../../application/ai-lab/programmer/jobContracts.js";
import { parseDiff } from "../../../application/ai-lab/programmer/proposalSchema.js";
import {
  EVALUATION_VERSION,
  WORKTREE_EVALUATOR_VERSION,
  P5B_REASONS,
  appendAuditEvent,
  buildEvaluationRecord,
  checkMirrorConfigEntries,
  checkPorcelainMatchesPlan,
  checkTreeHygiene,
  classifyStoredRecord,
  computeCandidateTreeDigest,
  jobScopedIdFor,
  normalizeCanonicalDiff,
  planFromEvaluation,
  stripGitDiffHeaders,
  validateCandidateShape,
  validateEvaluatorJob,
  worktreePathFor,
} from "../../../application/ai-lab/programmer/worktreeEvaluator.js";

const GIT_TIMEOUT_MS = 30_000;
const HEX40 = /^[0-9a-f]{40}$/;

function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function sha256Text(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Canonical JSON: object keys sorted recursively. Used for task binding. */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

/**
 * In-memory idempotency store (harness default). The real store is
 * the P1/P2 private operator-owned store, bound in P5-D; this
 * implementation only proves the store contract in the preview
 * harness and unit tests.
 */
export function createMemoryStore() {
  const map = new Map();
  return {
    load: (key) => (map.has(key) ? JSON.parse(JSON.stringify(map.get(key))) : null),
    save: (key, record) => {
      map.set(key, JSON.parse(JSON.stringify(record)));
    },
  };
}

function defaultGitEnv(homeDir, tmpDir) {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: homeDir,
    TMPDIR: tmpDir,
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    // Read commands never take the index lock, so no read can
    // rewrite the mirror's index file (stat refresh).
    GIT_OPTIONAL_LOCKS: "0",
  };
}

/**
 * Run git with argv only (never a shell), scrubbed env, hooks
 * neutralized and network transport forbidden. Returns
 * {ok, code, stdout, stderr}. Git failures are values, not throws.
 */
function runGit(gitCtx, args, { cwd, input } = {}) {
  const fullArgs = [
    "-c",
    `core.hooksPath=${gitCtx.noHooksDir}`,
    "-c",
    "protocol.allow=never",
    "-c",
    "core.fsmonitor=false",
    ...args,
  ];
  try {
    const out = execFileSync("git", fullArgs, {
      cwd,
      input,
      encoding: "buffer",
      timeout: GIT_TIMEOUT_MS,
      env: gitCtx.env,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, code: 0, stdout: out, stderr: Buffer.alloc(0) };
  } catch (e) {
    return {
      ok: false,
      code: typeof e.status === "number" ? e.status : -1,
      stdout: e.stdout ?? Buffer.alloc(0),
      stderr: e.stderr ?? Buffer.from(String(e.message ?? e), "utf8"),
    };
  }
}

function gitText(gitCtx, args, opts) {
  const r = runGit(gitCtx, args, opts);
  return { ...r, text: r.stdout.toString("utf8") };
}

function parseLsTree(text) {
  const entries = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const m = line.match(/^(\d+) (\w+) ([0-9a-f]{40})\t(.*)$/);
    if (!m) return { ok: false, detail: `ls-tree-parse:${line.slice(0, 80)}` };
    entries.push({ mode: m[1], type: m[2], sha: m[3], path: m[4] });
  }
  return { ok: true, entries };
}

function parseConfigList(text) {
  const entries = [];
  for (const chunk of text.split("\0")) {
    if (!chunk) continue;
    const nl = chunk.indexOf("\n");
    if (nl < 0) continue;
    entries.push({ key: chunk.slice(0, nl), value: chunk.slice(nl + 1) });
  }
  return entries;
}

function parseWorktreeList(text) {
  const worktrees = [];
  let current = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length), head: null, bare: false, detached: false };
      worktrees.push(current);
    } else if (current) {
      if (line.startsWith("HEAD ")) current.head = line.slice(5).trim();
      if (line === "bare") current.bare = true;
      if (line === "detached") current.detached = true;
    }
  }
  return worktrees;
}

/**
 * Validate the mirror offline. Returns {ok:true, info} or
 * {ok:false, reason, detail}. `info` carries the mirror realpath,
 * git dir, bare flag, refs/HEAD/index snapshots, base tree SHA,
 * and the base tree listing for the hygiene check.
 */
function validateMirror(gitCtx, mirrorPath, baseSha) {
  const fail = (reason, detail) => ({ ok: false, reason, detail });
  let mirrorReal;
  try {
    mirrorReal = fs.realpathSync(mirrorPath);
  } catch {
    return fail(P5B_REASONS.MIRROR_UNKNOWN, "mirror-path-missing");
  }
  if (!fs.statSync(mirrorReal).isDirectory()) return fail(P5B_REASONS.MIRROR_UNKNOWN, "mirror-not-a-directory");

  const gitDirRes = gitText(gitCtx, ["-C", mirrorReal, "rev-parse", "--git-dir"]);
  if (!gitDirRes.ok) return fail(P5B_REASONS.MIRROR_UNKNOWN, "not-a-git-repository");
  const gitDirRaw = gitDirRes.text.trim();
  const gitDir = path.resolve(mirrorReal, gitDirRaw);
  if (!fs.existsSync(path.join(gitDir, "HEAD"))) return fail(P5B_REASONS.MIRROR_UNKNOWN, "git-dir-missing-HEAD");

  const bareRes = gitText(gitCtx, ["-C", mirrorReal, "rev-parse", "--is-bare-repository"]);
  const isBare = bareRes.ok && bareRes.text.trim() === "true";

  // Dangerous local config refuses the mirror.
  const cfgRes = gitText(gitCtx, ["-C", mirrorReal, "config", "--local", "--list", "-z"]);
  if (!cfgRes.ok) return fail(P5B_REASONS.MIRROR_UNKNOWN, "config-unreadable");
  const cfgCheck = checkMirrorConfigEntries(parseConfigList(cfgRes.text));
  if (!cfgCheck.ok) return fail(cfgCheck.reason, cfgCheck.detail);

  // Hooks: any non-.sample file in the hooks dir refuses the mirror.
  const hooksDir = path.join(gitDir, "hooks");
  try {
    for (const entry of fs.readdirSync(hooksDir)) {
      if (entry.endsWith(".sample")) continue;
      const st = fs.statSync(path.join(hooksDir, entry));
      if (st.isFile()) return fail(P5B_REASONS.MIRROR_UNTRUSTED, `hook-present:${entry}`);
    }
  } catch (e) {
    if (e.code !== "ENOENT") return fail(P5B_REASONS.MIRROR_UNKNOWN, `hooks-unreadable:${e.message}`);
  }

  // Base pin: exact commit must exist and resolve to itself.
  const pinRes = gitText(gitCtx, ["-C", mirrorReal, "rev-parse", "--verify", `${baseSha}^{commit}`]);
  if (!pinRes.ok) return fail(REASON.BASE_UNAVAILABLE, "base-commit-unknown");
  if (pinRes.text.trim() !== baseSha) return fail(REASON.BASE_DRIFT, "base-commit-mismatch");
  const typeRes = gitText(gitCtx, ["-C", mirrorReal, "cat-file", "-t", baseSha]);
  if (!typeRes.ok || typeRes.text.trim() !== "commit") return fail(REASON.BASE_UNAVAILABLE, "base-not-a-commit");
  const treeRes = gitText(gitCtx, ["-C", mirrorReal, "rev-parse", `${baseSha}^{tree}`]);
  if (!treeRes.ok) return fail(REASON.BASE_UNAVAILABLE, "base-tree-unknown");
  const baseTreeSha = treeRes.text.trim();

  // Base tree hygiene (symlink/gitlink/.git/case-collision).
  const lsRes = gitText(gitCtx, ["-C", mirrorReal, "ls-tree", "-r", "-z", baseSha]);
  if (!lsRes.ok) return fail(REASON.BASE_UNAVAILABLE, "base-tree-unreadable");
  const parsed = parseLsTree(lsRes.text.replace(/\0/g, "\n"));
  if (!parsed.ok) return fail(REASON.BASE_DRIFT, parsed.detail);
  if (parsed.entries.some((e) => e.path === ".gitmodules")) {
    return fail(P5B_REASONS.MIRROR_UNTRUSTED, "gitmodules-present");
  }
  const hygiene = checkTreeHygiene(parsed.entries);
  if (!hygiene.ok) return fail(hygiene.reason, hygiene.detail);

  // LFS/smudge filters: any `filter` attribute set on a tracked path
  // refuses the mirror (a smudge filter is untrusted code at checkout).
  const paths = parsed.entries.map((e) => e.path);
  if (paths.length > 0) {
    const attrRes = runGit(gitCtx, ["-C", mirrorReal, "check-attr", "-z", "filter", "--stdin"], {
      input: Buffer.from(paths.map((p) => `${p}\0`).join(""), "utf8"),
    });
    if (!attrRes.ok) return fail(P5B_REASONS.MIRROR_UNKNOWN, "check-attr-failed");
    const attrText = attrRes.stdout.toString("utf8");
    const parts = attrText.split("\0").filter(Boolean);
    for (let i = 0; i + 2 < parts.length; i += 3) {
      const value = parts[i + 2];
      if (value !== "unspecified" && value !== "unset") {
        return fail(P5B_REASONS.MIRROR_UNTRUSTED, `smudge-filter:${parts[i]}:${value}`);
      }
    }
  }

  // Refs / HEAD / index snapshots (canaries: must be unchanged after).
  const refsRes = gitText(gitCtx, ["-C", mirrorReal, "for-each-ref", "--format=%(refname) %(objectname)"]);
  const refsBefore = refsRes.ok ? refsRes.text : "";
  const headRes = gitText(gitCtx, ["-C", mirrorReal, "rev-parse", "HEAD"]);
  const headBefore = headRes.ok ? headRes.text.trim() : null;
  const indexBefore = !isBare ? indexDigest(gitCtx, mirrorReal) : null;

  // Non-bare mirrors must be clean (no working-tree drift).
  if (!isBare) {
    const statusRes = gitText(gitCtx, ["-C", mirrorReal, "status", "--porcelain"]);
    if (!statusRes.ok) return fail(P5B_REASONS.MIRROR_UNKNOWN, "mirror-status-unreadable");
    if (statusRes.text.trim() !== "") return fail(P5B_REASONS.MIRROR_DRIFT, "mirror-working-tree-dirty");
  }

  return {
    ok: true,
    info: {
      mirror_realpath: mirrorReal,
      git_dir: gitDir,
      is_bare: isBare,
      base_tree_sha: baseTreeSha,
      tree_entries: parsed.entries,
      refs_before: refsBefore,
      head_before: headBefore,
      index_before: indexBefore,
    },
  };
}

function refsSnapshot(gitCtx, mirrorReal) {
  const refsRes = gitText(gitCtx, ["-C", mirrorReal, "for-each-ref", "--format=%(refname) %(objectname)"]);
  const headRes = gitText(gitCtx, ["-C", mirrorReal, "rev-parse", "HEAD"]);
  return {
    refs: refsRes.ok ? refsRes.text : "",
    head: headRes.ok ? headRes.text.trim() : null,
  };
}

/**
 * Index canary: hash of `git ls-files --stage` (mode/sha/path per
 * entry) — the index CONTENT, not the index file bytes. The file
 * bytes embed stat data (ctime/mtime/ino) that changes on copy and
 * on ordinary stat refreshes, so a byte hash false-positives on any
 * read. Content comparison detects real index mutations only.
 * GIT_OPTIONAL_LOCKS=0 (in defaultGitEnv) keeps read commands from
 * rewriting the index file.
 */
function indexDigest(gitCtx, mirrorReal) {
  const res = gitText(gitCtx, ["-C", mirrorReal, "ls-files", "--stage"]);
  if (!res.ok) return null;
  return sha256Text(res.text);
}

/**
 * Verify a worktree path is job-owned: under the host root, basename
 * is the job-scoped id, and the admin gitdir file points back at
 * the path. Returns {ok:true, adminDir} or {ok:false, detail}.
 */
function verifyWorktreeIdentity(gitCtx, mirrorInfo, worktreePath, jobScopedId) {
  const root = gitCtx.worktreeRoot;
  const resolved = path.resolve(worktreePath);
  if (!resolved.startsWith(`${root}/`) && resolved !== root) {
    return { ok: false, detail: "worktree-outside-host-root" };
  }
  if (path.basename(resolved) !== jobScopedId) {
    return { ok: false, detail: "worktree-name-mismatch" };
  }
  const adminDir = path.join(mirrorInfo.git_dir, "worktrees", jobScopedId);
  let gitdirContent;
  try {
    gitdirContent = fs.readFileSync(path.join(adminDir, "gitdir"), "utf8").trim();
  } catch {
    return { ok: false, detail: "worktree-admin-missing" };
  }
  if (gitdirContent !== `${resolved}/.git`) {
    return { ok: false, detail: "worktree-gitdir-mismatch" };
  }
  return { ok: true, adminDir };
}

/** Remove a job-owned worktree (identity-verified, never --force). */
function removeWorktree(gitCtx, mirrorInfo, worktreePath, jobScopedId) {
  const identity = verifyWorktreeIdentity(gitCtx, mirrorInfo, worktreePath, jobScopedId);
  if (!identity.ok) return { ok: false, reason: P5B_REASONS.WORKTREE_FAILED, detail: identity.detail };
  // A candidate apply leaves the scratch worktree dirty, and
  // `git worktree remove` refuses a dirty worktree without --force.
  // Restore this identity-verified scratch worktree to clean first
  // (reset + clean, scoped to the worktree path only). Never --force.
  const reset = runGit(gitCtx, ["-C", worktreePath, "reset", "--hard", "-q", "HEAD"]);
  if (!reset.ok) {
    return { ok: false, reason: REASON.CLEANUP_FAILED, detail: `worktree-restore-failed:${reset.stderr.toString("utf8").slice(0, 120)}` };
  }
  const clean = runGit(gitCtx, ["-C", worktreePath, "clean", "-fdq"]);
  if (!clean.ok) {
    return { ok: false, reason: REASON.CLEANUP_FAILED, detail: `worktree-clean-failed:${clean.stderr.toString("utf8").slice(0, 120)}` };
  }
  const rm = runGit(gitCtx, ["-C", mirrorInfo.mirror_realpath, "worktree", "remove", worktreePath]);
  if (!rm.ok) {
    return { ok: false, reason: REASON.CLEANUP_FAILED, detail: `worktree-remove-failed:${rm.stderr.toString("utf8").slice(0, 120)}` };
  }
  if (fs.existsSync(worktreePath)) {
    return { ok: false, reason: REASON.CLEANUP_FAILED, detail: "worktree-path-still-exists" };
  }
  runGit(gitCtx, ["-C", mirrorInfo.mirror_realpath, "worktree", "prune"]);
  const list = gitText(gitCtx, ["-C", mirrorInfo.mirror_realpath, "worktree", "list", "--porcelain"]);
  if (list.ok && parseWorktreeList(list.text).some((w) => path.resolve(w.path) === path.resolve(worktreePath))) {
    return { ok: false, reason: REASON.CLEANUP_FAILED, detail: "worktree-still-listed" };
  }
  return { ok: true };
}

/**
 * Build the per-run git context: a host-owned temp home (so no user
 * git config is ever read), a temp dir, and the empty hooks dir that
 * neutralizes hook execution. Caller owns cleanup of these dirs via
 * the returned `dispose` (best-effort; they live under the host temp
 * root which the harness removes).
 */
function buildGitContext(worktreeRoot) {
  const runTmp = fs.mkdtempSync(path.join(os.tmpdir(), "p5b-host-"));
  const homeDir = path.join(runTmp, "home");
  const noHooksDir = path.join(runTmp, "no-hooks");
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(noHooksDir, { recursive: true });
  fs.chmodSync(homeDir, 0o700);
  fs.chmodSync(noHooksDir, 0o700);
  return {
    worktreeRoot: path.resolve(worktreeRoot),
    noHooksDir,
    env: defaultGitEnv(homeDir, runTmp),
    dispose() {
      try {
        fs.rmSync(runTmp, { recursive: true, force: true });
      } catch {}
    },
  };
}

/** Read canary files (absolute paths outside the worktree root). */
function readCanaries(canaryPaths) {
  const out = new Map();
  for (const p of canaryPaths ?? []) {
    try {
      out.set(p, sha256Hex(fs.readFileSync(p)));
    } catch {
      out.set(p, null);
    }
  }
  return out;
}

/**
 * Evaluate one bounded candidate against a pinned local mirror.
 *
 * `input`: { job, task, candidate: { plan, proposed_diff }, hostMode }
 * `host`: {
 *   mirrorPath, worktreeRoot, taskConstraints (host-owned),
 *   allowedProfileIds, canaryPaths, store, isolationProber,
 *   clock (default Date), operatorRef (default job.operator_ref)
 * }
 *
 * `task` is the host-owned approved task (family, description,
 * brief/policy digests); its canonical digest must equal
 * job.task_digest or the job refuses. The candidate supplies only
 * plan + proposed_diff — task prose can never enlarge authorization.
 *
 * Returns a deep-frozen evaluation record (never throws for
 * evaluation failures; only a DISABLED / ACTIVATION_REQUIRED mode
 * throws JobRefusal, before anything is opened — matching P5-A).
 */
export async function evaluateCandidate(input, host) {
  const startedAt = Date.now();
  const nowIso = () => new Date().toISOString();
  // Mode gate first: DISABLED returns before opening any mirror,
  // store, fixture, or worktree (P5-A mode.js contract).
  const mode = requireSyntheticPreview(host?.hostMode);
  void mode;

  const job = validateEvaluatorJob(input?.job);
  const task = input?.task;
  if (!task || typeof task !== "object") {
    const e = new Error("BAD_REQUEST:task is required (host-owned approved task)");
    e.code = "BAD_REQUEST";
    throw e;
  }
  if (sha256Text(canonicalJson(task)) !== job.task_digest) {
    const e = new Error("TASK_MALFORMED:task digest does not match job.task_digest");
    e.code = "TASK_MALFORMED";
    throw e;
  }
  const candidate = validateCandidateShape(input?.candidate);

  const store = host?.store ?? createMemoryStore();
  const worktreeRoot = path.resolve(host?.worktreeRoot ?? path.join(os.tmpdir(), "p5b-worktrees"));
  fs.mkdirSync(worktreeRoot, { recursive: true });
  const jobScopedId = jobScopedIdFor(job.idempotency_key);
  const wtPath = worktreePathFor(worktreeRoot, job.idempotency_key);
  const operatorRef = host?.operatorRef ?? job.operator_ref;
  // Replay binding: the idempotency key is bound to one job, one
  // task, one base, one candidate diff. A replay with any of those
  // changed is refused (STALE_DIGEST) — a proposal is never replayed
  // against a changed base without new verification.
  const candidateDiffSha256 = sha256Text(candidate.proposed_diff);
  const stored = store.load(job.idempotency_key);
  if (stored) {
    const bindingMismatch =
      stored.job_id !== job.job_id ||
      stored.task_digest !== job.task_digest ||
      stored.mirror?.base_sha !== job.base_sha ||
      stored.candidate_diff_sha256 !== candidateDiffSha256;
    if (bindingMismatch) {
      const e = new Error("STALE_DIGEST:idempotency key already bound to a different job/task/base/candidate");
      e.code = "STALE_DIGEST";
      throw e;
    }
  }
  const storedKind = classifyStoredRecord(stored);
  if (storedKind === "terminal") return stored;
  if (storedKind === "in-flight") {
    // A previous attempt crashed mid-flight. Mark it INTERRUPTED,
    // clean up its recorded job-owned worktree (identity-verified),
    // and return the terminal record. No second evaluation runs.
    const gitCtx = buildGitContext(worktreeRoot);
    let cleanupNote = "no-worktree-recorded";
    try {
      if (stored.worktree?.path && stored.mirror?.mirror_realpath) {
        const mirrorInfo = { mirror_realpath: stored.mirror.mirror_realpath, git_dir: stored.mirror.git_dir };
        const removed = removeWorktree(gitCtx, mirrorInfo, stored.worktree.path, jobScopedId);
        cleanupNote = removed.ok ? "crashed-worktree-removed" : `crashed-worktree-blocked:${removed.detail}`;
      }
    } finally {
      gitCtx.dispose();
    }
    const audit = appendAuditEvent(stored.audit ?? [], "interrupted", operatorRef, cleanupNote, nowIso());
    const record = buildEvaluationRecord({
      ...stored,
      status: "BLOCKED",
      reason_codes: ["INTERRUPTED"],
      detail: `previous attempt crashed mid-flight; ${cleanupNote}; no second evaluation ran`,
      audit,
      completed_at: nowIso(),
    });
    store.save(job.idempotency_key, record);
    return record;
  }

  const gitCtx = buildGitContext(worktreeRoot);
  let audit = appendAuditEvent([], "created", operatorRef, `job ${job.job_id} evaluation started`, nowIso());
  let mirrorInfo = null;
  let worktreeCreated = false;
  let outcome = null; // {status, reason_codes, detail, plan?, isolation?, canaries?, risks?}
  const risks = [];
  const deadlineMs = startedAt + BUDGETS.totalWallMs;
  const pastDeadline = () => Date.now() > deadlineMs;
  // Outside-root canaries are read BEFORE any work starts, so the
  // after-check in finally compares against a true before-state.
  const canaryBefore = readCanaries(host?.canaryPaths ?? []);

  const finishBlocked = (reasonCodes, detail, extra = {}) => {
    outcome = { status: "BLOCKED", reason_codes: reasonCodes, detail, ...extra };
  };
  const finishRefused = (reasonCodes, detail, extra = {}) => {
    outcome = { status: "REFUSED", reason_codes: reasonCodes, detail, ...extra };
  };

  try {
    // 1. Isolation probe — attested on every record, before any
    //    worktree exists. P5-B itself executes NO candidate code
    //    (only fixed-argv git commands under a scrubbed env), so a
    //    missing mechanism does NOT block validation/apply/provenance
    //    here — but it is recorded, and execution stays gated: P5-C
    //    must re-probe and prove isolation before running any
    //    candidate test, and a null mechanism means this record does
    //    not authorize execution. (Brief: isolation is required
    //    "before executing candidate tests"; a Git worktree alone is
    //    not a sandbox, and this slice never claims it is.)
    const mechanism = (await (host?.isolationProber ?? (async () => detectIsolation()))()) ?? null;
    audit = appendAuditEvent(audit, "isolation_probed", operatorRef, mechanism ? `mechanism:${mechanism}` : "no-proven-mechanism", nowIso());
    const isolation = {
      mechanism,
      detail: mechanism ? "probe-passed" : "no-proven-mechanism-on-this-host",
      attested_by: "qa-test-runner-isolation@detectIsolation",
      execution_gate: mechanism
        ? "mechanism attested for this evaluation; P5-C must still re-probe before running candidate tests"
        : "P5-C must prove isolation before running candidate tests; this record does not authorize execution",
    };
    if (!mechanism) {
      risks.push("no-os-isolation-on-host:execution-gated-on-p5c-isolation-probe");
    }
    outcome = { isolation };

    // 2. Mirror validation (offline) + base pin + tree hygiene.
    if (pastDeadline()) {
      finishBlocked([REASON.TIMEOUT], "evaluation exceeded the job wall-time budget before mirror validation");
      throw { handled: true };
    }
    const mirror = validateMirror(gitCtx, host?.mirrorPath, job.base_sha);
    if (!mirror.ok) {
      finishBlocked([mirror.reason], mirror.detail, { isolation });
      throw { handled: true };
    }
    mirrorInfo = mirror.info;
    audit = appendAuditEvent(audit, "mirror_validated", operatorRef, `mirror ${mirrorInfo.mirror_realpath} base ${job.base_sha}`, nowIso());
    audit = appendAuditEvent(audit, "base_pinned", operatorRef, `base ${job.base_sha} tree ${mirrorInfo.base_tree_sha}`, nowIso());

    // 3. Detached disposable worktree (host-owned root, job-scoped id).
    if (fs.existsSync(wtPath)) {
      finishBlocked([P5B_REASONS.WORKTREE_FAILED], "worktree path already exists for this job", { isolation });
      throw { handled: true };
    }
    const add = runGit(gitCtx, ["-C", mirrorInfo.mirror_realpath, "worktree", "add", "--detach", wtPath, job.base_sha]);
    if (!add.ok) {
      finishBlocked([P5B_REASONS.WORKTREE_FAILED], `worktree creation failed:${add.stderr.toString("utf8").slice(0, 120)}`, { isolation });
      throw { handled: true };
    }
    worktreeCreated = true;
    const headRes = gitText(gitCtx, ["-C", wtPath, "rev-parse", "HEAD"]);
    if (!headRes.ok || headRes.text.trim() !== job.base_sha) {
      finishBlocked([P5B_REASONS.WORKTREE_FAILED], "worktree HEAD does not equal the pinned base", { isolation });
      throw { handled: true };
    }
    const cleanRes = gitText(gitCtx, ["-C", wtPath, "status", "--porcelain"]);
    if (!cleanRes.ok || cleanRes.text.trim() !== "") {
      finishBlocked([P5B_REASONS.WORKTREE_FAILED], "fresh worktree is not clean", { isolation });
      throw { handled: true };
    }
    audit = appendAuditEvent(audit, "worktree_created", operatorRef, `detached worktree ${jobScopedId} at ${job.base_sha}`, nowIso());

    // 4. Snapshot from the worktree (prototype snapshot shape).
    const snapshot = { files: new Map(), dirs: new Set() };
    for (const entry of mirrorInfo.tree_entries) {
      const blob = runGit(gitCtx, ["-C", mirrorInfo.mirror_realpath, "cat-file", "blob", entry.sha]);
      if (!blob.ok) {
        finishBlocked([REASON.BASE_UNAVAILABLE], `blob-unreadable:${entry.path}`, { isolation });
        throw { handled: true };
      }
      if (blob.stdout.length > BUDGETS.maxBytesPerFile) {
        finishBlocked([REASON.BUDGET_EXCEEDED], `file-over-byte-budget:${entry.path}`, { isolation });
        throw { handled: true };
      }
      let content;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(blob.stdout);
      } catch {
        finishBlocked([REASON.OPERATION_FORBIDDEN], `non-utf8-content:${entry.path}`, { isolation });
        throw { handled: true };
      }
      snapshot.files.set(entry.path, { content, sha256: sha256Text(content), gitBlobSha: entry.sha });
      const slash = entry.path.lastIndexOf("/");
      if (slash > 0) snapshot.dirs.add(entry.path.slice(0, slash));
    }

    // 5. Candidate validation (prototype plan validator, host-owned
    //    constraints win over any task prose).
    if (pastDeadline()) {
      finishBlocked([REASON.TIMEOUT], "evaluation exceeded the job wall-time budget before candidate validation");
      throw { handled: true };
    }
    const taskForValidation = { ...task, constraints: host?.taskConstraints ?? task.constraints };
    // The prototype parser is strict unified-diff (each file section
    // starts at `---`); a real git diff carries `diff --git` /
    // `index` headers, so strip those structural lines for the
    // validator and the apply. Budgets and the canonical-diff
    // comparison still use the original candidate diff bytes.
    const prototypeDiff = stripGitDiffHeaders(candidate.proposed_diff);
    const validation = validatePlan({
      task: taskForValidation,
      plan: candidate.plan,
      proposedDiff: prototypeDiff,
      snapshot,
      trusted: { allowed_profile_ids: host?.allowedProfileIds ?? [], budgets: BUDGETS },
    });
    if (!validation.ok) {
      const status = validation.status === "REFUSED" ? "REFUSED" : "BLOCKED";
      if (status === "REFUSED") finishRefused(validation.reason_codes, validation.detail, { isolation });
      else finishBlocked(validation.reason_codes, validation.detail, { isolation });
      throw { handled: true };
    }
    // Hostile capability hits in the diff refuse (the candidate
    // would run in P5-C; a capability escape is never applied to
    // scratch). Resource-loop hits are recorded as risks.
    if (validation.hostileHits.capabilityHits.length > 0) {
      finishRefused(
        [REASON.INJECTION_FORBIDDEN_CAPABILITY],
        `hostile capability in candidate diff: ${validation.hostileHits.capabilityHits.join(", ")}`,
        { isolation },
      );
      throw { handled: true };
    }
    for (const hit of validation.hostileHits.resourceHits) {
      risks.push(`resource-pattern-in-diff:${hit}`);
    }
    audit = appendAuditEvent(
      audit,
      "candidate_validated",
      operatorRef,
      `plan ${validation.stats.files} files +${validation.stats.added}/-${validation.stats.removed} within budget`,
      nowIso(),
    );

    // 6. Apply to scratch only (write bytes; never git-apply a
    //    caller string, never touch the mirror checkout).
    const contentMap = new Map([...snapshot.files.entries()].map(([p, e]) => [p, e.content]));
    const parsed = parseUnifiedDiff(prototypeDiff);
    if (!parsed.ok) {
      finishBlocked([parsed.reason], parsed.detail, { isolation });
      throw { handled: true };
    }
    const applied = applyDiffExact(parsed, contentMap);
    if (!applied.ok) {
      finishBlocked([applied.reason], applied.detail, { isolation });
      throw { handled: true };
    }
    const plannedPaths = new Set();
    for (const f of parsed.files) plannedPaths.add(f.path);
    for (const [p, content] of applied.files) {
      const fp = path.join(wtPath, p);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, content, { encoding: "utf8", mode: 0o644 });
    }
    // Verify bytes + no symlink/hardlink escapes in what we wrote.
    for (const [p, content] of applied.files) {
      const fp = path.join(wtPath, p);
      const st = fs.lstatSync(fp);
      if (st.isSymbolicLink()) {
        finishBlocked([REASON.PATH_REJECTED], `symlink-created:${p}`, { isolation });
        throw { handled: true };
      }
      if (st.nlink !== 1) {
        finishBlocked([REASON.PATH_REJECTED], `hardlink-created:${p}`, { isolation });
        throw { handled: true };
      }
      if (sha256Text(fs.readFileSync(fp, "utf8")) !== sha256Text(content)) {
        finishBlocked([P5B_REASONS.PATCH_MISMATCH], `written-bytes-mismatch:${p}`, { isolation });
        throw { handled: true };
      }
    }
    const porcelain = gitText(gitCtx, ["-C", wtPath, "status", "--porcelain"]);
    if (!porcelain.ok) {
      finishBlocked([P5B_REASONS.PATCH_MISMATCH], "worktree status unreadable after apply", { isolation });
      throw { handled: true };
    }
    const porcelainCheck = checkPorcelainMatchesPlan(porcelain.text.split("\n"), plannedPaths);
    if (!porcelainCheck.ok) {
      finishBlocked([porcelainCheck.reason], porcelainCheck.detail, { isolation });
      throw { handled: true };
    }
    audit = appendAuditEvent(audit, "candidate_applied", operatorRef, `applied ${parsed.files.length} files to scratch worktree`, nowIso());

    // 7. Canonical diff + provenance digests.
    const addN = runGit(gitCtx, ["-C", wtPath, "add", "-N", "--", ...plannedPaths]);
    if (!addN.ok) {
      finishBlocked([P5B_REASONS.PATCH_MISMATCH], "intent-to-add failed for canonical diff", { isolation });
      throw { handled: true };
    }
    const diffRes = runGit(gitCtx, ["-c", "diff.algorithm=myers", "-C", wtPath, "diff", "--", ...plannedPaths]);
    if (!diffRes.ok) {
      finishBlocked([P5B_REASONS.PATCH_MISMATCH], "canonical diff failed", { isolation });
      throw { handled: true };
    }
    const canonical = normalizeCanonicalDiff(diffRes.stdout.toString("utf8"), candidate.proposed_diff);
    if (!canonical.ok) {
      finishBlocked([canonical.reason], canonical.detail, { isolation });
      throw { handled: true };
    }
    const patchSha256 = sha256Text(canonical.diff);
    const candidateFiles = [];
    for (const [p, entry] of snapshot.files.entries()) {
      const after = applied.files.get(p);
      const baseEntry = mirrorInfo.tree_entries.find((e) => e.path === p);
      candidateFiles.push({
        path: p,
        mode: baseEntry ? baseEntry.mode : "100644",
        content: after ?? entry.content,
      });
    }
    for (const [p, content] of applied.files) {
      if (!snapshot.files.has(p)) candidateFiles.push({ path: p, mode: "100644", content });
    }
    const candidateTreeDigest = computeCandidateTreeDigest(candidateFiles);
    const planParsed = parseDiff(canonical.diff);
    const planFiles = [];
    for (const f of parsed.files) {
      const counts = planParsed.files.get(f.path) ?? { added: 0, removed: 0 };
      planFiles.push({ path: f.path, operation: f.operation, added_lines: counts.added, removed_lines: counts.removed });
    }
    audit = appendAuditEvent(
      audit,
      "provenance_recorded",
      operatorRef,
      `patch ${patchSha256.slice(0, 12)}… tree ${candidateTreeDigest.slice(0, 12)}…`,
      nowIso(),
    );
    outcome = {
      status: "PROPOSED",
      reason_codes: [REASON.OK],
      detail: "candidate validated, applied to scratch, provenance recorded; verification is P5-C",
      isolation,
      plan: {
        files: planFiles,
        diff: canonical.diff,
        patch_sha256: patchSha256,
        candidate_tree_digest: candidateTreeDigest,
      },
      budgets: {
        maxTargetFiles: BUDGETS.maxTargetFiles,
        maxAddedRemovedLines: BUDGETS.maxAddedRemovedLines,
        maxPatchBytes: BUDGETS.maxPatchBytes,
        maxProfiles: BUDGETS.maxProfiles,
        profileTimeoutMs: BUDGETS.profileTimeoutMs,
        totalWallMs: BUDGETS.totalWallMs,
        maxMemoryMiB: BUDGETS.maxMemoryMiB,
        applied: {
          files: validation.stats.files,
          added_removed: validation.stats.addedRemoved,
          patch_bytes: Buffer.byteLength(canonical.diff, "utf8"),
        },
      },
    };
  } catch (e) {
    if (!e?.handled) {
      // Unexpected host failure: fail closed, still run cleanup.
      if (!outcome || !outcome.status) {
        outcome = {
          status: "BLOCKED",
          reason_codes: ["WORKTREE_FAILED"],
          detail: `host-error:${String(e?.message ?? e).slice(0, 200)}`,
          isolation: outcome?.isolation ?? { mechanism: null, detail: "unknown", attested_by: "qa-test-runner-isolation@detectIsolation", execution_gate: "P5-C must prove isolation before running candidate tests; this record does not authorize execution" },
        };
      }
    }
  } finally {
    // 8. Cleanup (always): remove only the job-owned worktree,
    //    identity-verified, never --force. A cleanup failure
    //    overrides the outcome to BLOCKED / CLEANUP_FAILED.
    let cleanupFailed = null;
    if (worktreeCreated && mirrorInfo) {
      const removed = removeWorktree(gitCtx, mirrorInfo, wtPath, jobScopedId);
      if (!removed.ok) {
        cleanupFailed = removed;
        audit = appendAuditEvent(audit, "cleanup_failed", operatorRef, removed.detail, nowIso());
      } else {
        audit = appendAuditEvent(audit, "cleanup_completed", operatorRef, `worktree ${jobScopedId} removed`, nowIso());
      }
    }

    // Canaries: refs/HEAD/index must be unchanged; outside-root
    // canary files must be unchanged.
    const after = mirrorInfo ? refsSnapshot(gitCtx, mirrorInfo.mirror_realpath) : { refs: null, head: null };
    const indexAfter = mirrorInfo && !mirrorInfo.is_bare ? indexDigest(gitCtx, mirrorInfo.mirror_realpath) : null;
    const canaries = {
      refs_unchanged: mirrorInfo ? after.refs === mirrorInfo.refs_before : null,
      head_unchanged: mirrorInfo ? after.head === mirrorInfo.head_before : null,
      index_unchanged: mirrorInfo && !mirrorInfo.is_bare ? indexAfter === mirrorInfo.index_before : null,
      outside_root_unchanged: true,
      detail: "mirror refs/HEAD/index compared before/after",
    };
    // Outside-root canaries cover ONLY the host-supplied paths: a
    // changed, removed, or unreadable canary fails the check. An
    // empty canary list is no evidence about the rest of the
    // filesystem — it proves nothing universal.
    const failedCanaries = [];
    for (const [p, before] of canaryBefore) {
      let afterDigest = null;
      let readableAfter = true;
      try {
        afterDigest = sha256Hex(fs.readFileSync(p));
      } catch {
        readableAfter = false;
      }
      if (before === null) {
        // Unreadable before the run started: cannot be compared.
        failedCanaries.push(`outside-root-canary-unreadable-before:${p}`);
      } else if (!readableAfter) {
        failedCanaries.push(`outside-root-canary-unreadable-after:${p}`);
      } else if (afterDigest !== before) {
        failedCanaries.push(`outside-root-canary-changed:${p}`);
      }
    }
    if (failedCanaries.length > 0) {
      canaries.outside_root_unchanged = false;
      canaries.detail = failedCanaries.join("; ");
    }
    if (mirrorInfo && (!canaries.refs_unchanged || !canaries.head_unchanged || canaries.index_unchanged === false)) {
      // The mirror moved under us — the evaluation cannot be trusted.
      outcome = {
        status: "BLOCKED",
        reason_codes: [P5B_REASONS.MIRROR_DRIFT],
        detail: "mirror refs/HEAD/index changed during evaluation",
        isolation: outcome?.isolation ?? { mechanism: null, detail: "unknown", attested_by: "qa-test-runner-isolation@detectIsolation", execution_gate: "P5-C must prove isolation before running candidate tests; this record does not authorize execution" },
        plan: outcome?.plan ?? null,
        budgets: outcome?.budgets ?? null,
      };
    }
    if (cleanupFailed) {
      outcome = {
        status: "BLOCKED",
        reason_codes: [...(outcome?.reason_codes ?? []), REASON.CLEANUP_FAILED],
        detail: `cleanup failed: ${cleanupFailed.detail}`,
        isolation: outcome?.isolation ?? { mechanism: null, detail: "unknown", attested_by: "qa-test-runner-isolation@detectIsolation", execution_gate: "P5-C must prove isolation before running candidate tests; this record does not authorize execution" },
        plan: outcome?.plan ?? null,
        budgets: outcome?.budgets ?? null,
      };
    }
    if (!canaries.outside_root_unchanged) {
      // A host-provided outside-root canary changed, vanished, or
      // could not be compared: the confinement evidence explicitly
      // failed, so the evaluation fails closed to BLOCKED even when
      // the candidate otherwise validated — a PROPOSED outcome must
      // never carry failed canary evidence downstream to P5-C.
      // Earlier reasons are preserved (the "OK" success marker is
      // not a reason); the plan/provenance stay on the record as
      // diagnostic evidence, and cleanup has already run above.
      const priorReasons = (outcome?.reason_codes ?? []).filter((r) => r !== REASON.OK);
      outcome = {
        status: "BLOCKED",
        reason_codes: [...new Set([...priorReasons, P5B_REASONS.OUTSIDE_ROOT_MUTATION])],
        detail: `outside-root canary failed: ${canaries.detail}`,
        isolation: outcome?.isolation ?? { mechanism: null, detail: "unknown", attested_by: "qa-test-runner-isolation@detectIsolation", execution_gate: "P5-C must prove isolation before running candidate tests; this record does not authorize execution" },
        plan: outcome?.plan ?? null,
        budgets: outcome?.budgets ?? null,
      };
    }

    const finalStatus = outcome?.status ?? "BLOCKED";
    if (finalStatus === "BLOCKED") {
      audit = appendAuditEvent(audit, "blocked", operatorRef, outcome?.detail ?? "blocked", nowIso());
    } else if (finalStatus === "REFUSED") {
      audit = appendAuditEvent(audit, "refused", operatorRef, outcome?.detail ?? "refused", nowIso());
    }

    const record = buildEvaluationRecord({
      evaluation_version: EVALUATION_VERSION,
      evaluator_version: WORKTREE_EVALUATOR_VERSION,
      job_id: job.job_id,
      idempotency_key: job.idempotency_key,
      task_digest: job.task_digest,
      candidate_diff_sha256: candidateDiffSha256,
      operator_ref: operatorRef,
      status: finalStatus,
      reason_codes: outcome?.reason_codes ?? ["WORKTREE_FAILED"],
      detail: outcome?.detail ?? "evaluation ended without an outcome",
      mirror: mirrorInfo
        ? {
            repo_id: job.repo_id,
            mirror_realpath: mirrorInfo.mirror_realpath,
            git_dir: mirrorInfo.git_dir,
            base_sha: job.base_sha,
            base_tree_sha: mirrorInfo.base_tree_sha,
            refs_before: mirrorInfo.refs_before,
            refs_after: after.refs,
            head_before: mirrorInfo.head_before,
            head_after: after.head,
            index_before: mirrorInfo.index_before,
            index_after: indexAfter,
          }
        : {
            repo_id: job.repo_id,
            mirror_realpath: host?.mirrorPath ?? null,
            git_dir: null,
            base_sha: job.base_sha,
            base_tree_sha: null,
            refs_before: null,
            refs_after: null,
            head_before: null,
            head_after: null,
            index_before: null,
            index_after: null,
          },
      worktree: {
        job_scoped_id: jobScopedId,
        diagnostic_location: `worktrees/${jobScopedId}`,
        path: wtPath,
        created: worktreeCreated,
        removed: worktreeCreated && !fs.existsSync(wtPath),
      },
      isolation: outcome?.isolation ?? { mechanism: null, detail: "not-probed", attested_by: "qa-test-runner-isolation@detectIsolation", execution_gate: "P5-C must prove isolation before running candidate tests; this record does not authorize execution" },
      plan: outcome?.plan ?? null,
      budgets: outcome?.budgets ?? null,
      canaries,
      risks,
      audit,
      created_at: new Date(startedAt).toISOString(),
      completed_at: nowIso(),
    });
    store.save(job.idempotency_key, record);
    gitCtx.dispose();
    return record;
  }
}

/**
 * Explicit operator recovery only: reconcile stale job-owned
 * worktrees under a host root for one mirror. Never a scheduler,
 * never automatic. Foreign worktrees (outside the root, or not
 * named `p5b-<id>`) are listed as skipped and NEVER touched.
 * Returns a receipt {removed, blocked, skipped_foreign, audit}.
 */
export function reconcileStaleWorktrees({ mirrorPath, worktreeRoot, operatorRef }) {
  const gitCtx = buildGitContext(worktreeRoot);
  const receipt = { removed: [], blocked: [], skipped_foreign: [], audit: [] };
  const stamp = () => new Date().toISOString();
  try {
    let mirrorReal;
    try {
      mirrorReal = fs.realpathSync(mirrorPath);
    } catch {
      receipt.blocked.push({ path: mirrorPath, reason: P5B_REASONS.MIRROR_UNKNOWN, detail: "mirror-path-missing" });
      return receipt;
    }
    const gitDirRes = gitText(gitCtx, ["-C", mirrorReal, "rev-parse", "--git-dir"]);
    if (!gitDirRes.ok) {
      receipt.blocked.push({ path: mirrorReal, reason: P5B_REASONS.MIRROR_UNKNOWN, detail: "not-a-git-repository" });
      return receipt;
    }
    const mirrorInfo = { mirror_realpath: mirrorReal, git_dir: path.resolve(mirrorReal, gitDirRes.text.trim()) };
    const list = gitText(gitCtx, ["-C", mirrorReal, "worktree", "list", "--porcelain"]);
    if (!list.ok) {
      receipt.blocked.push({ path: mirrorReal, reason: P5B_REASONS.WORKTREE_FAILED, detail: "worktree-list-failed" });
      return receipt;
    }
    const root = path.resolve(worktreeRoot);
    for (const wt of parseWorktreeList(list.text)) {
      const resolved = path.resolve(wt.path);
      const name = path.basename(resolved);
      if ((!resolved.startsWith(`${root}/`) && resolved !== root) || !name.startsWith("p5b-") || wt.bare) {
        receipt.skipped_foreign.push({ path: wt.path, detail: "not-a-job-owned-worktree" });
        continue;
      }
      const removed = removeWorktree(gitCtx, mirrorInfo, resolved, name);
      if (removed.ok) {
        receipt.removed.push({ path: wt.path, job_scoped_id: name });
        receipt.audit.push({ event: "reconciled", at: stamp(), actor: operatorRef ?? "operator", detail: `removed stale worktree ${name}` });
      } else {
        receipt.blocked.push({ path: wt.path, job_scoped_id: name, reason: removed.reason, detail: removed.detail });
        receipt.audit.push({ event: "cleanup_failed", at: stamp(), actor: operatorRef ?? "operator", detail: `${name}: ${removed.detail}` });
      }
    }
    return receipt;
  } finally {
    gitCtx.dispose();
  }
}
