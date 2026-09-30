/**
 * prepareFixPr.mjs — Slice 7: fix branch + PR pipeline.
 *
 * Takes a Slice 3/4 proposed patch, applies + verifies it with the Slice 5
 * applier, then turns the verified worktree into a real git branch, pushes
 * it, and opens a normal PR — one PR per fix. Each stage is fail-closed and
 * returns { ok:false, stage, reason[, detail] } instead of throwing.
 *
 * Safety contract (enforced, not aspirational):
 * - The pipeline NEVER merges, deploys, or writes production data. The merge
 *   endpoint does not appear in this file. A human (or reviewer agent) merges
 *   through the normal review flow.
 * - Only the patch's single file may be committed; any other dirty file in
 *   the worktree aborts the commit stage.
 * - Branch names are deterministic and sanitized.
 * - PR/commit text carries evidence provenance (signal id, failed step,
 *   repair class, verification), never raw evidence logs.
 * - Network steps (push, open PR) sit behind injectable deps so tests stay
 *   hermetic. The defaults reuse the operator's proven REST flows; the API
 *   token lacks workflow scope, so workflow-file patches arrive here with
 *   application:"manual" and are refused at validation.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { applyPatch } from "./applyPatch.mjs";

/** Repo the fixer pushes to. Mirrors the operator push scripts. */
const GH_OWNER = "onyxgolden";
const GH_REPO = "marketplace409";

/** Where the operator's proven push helper lives. */
const PUSH_HELPER = path.join(os.homedir(), "workspace", "github-push-multi.py");

/** Deterministic, collision-resistant branch prefix for fixer branches. */
export const FIX_BRANCH_PREFIX = "engbrain-fix/";

/** Fail-closed: sanitize an arbitrary string into a git-safe branch segment. */
export function sanitizeBranchSegment(value, maxLen = 32) {
  const seg = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return seg || "fix";
}

/**
 * Deterministic branch name: engbrain-fix/<class>-<signal>-<diff-hash8>.
 * Same patch + same signal always yields the same branch, so a retried
 * pipeline run converges instead of opening duplicate PRs.
 */
export function makeBranchName(patch, context = {}) {
  const cls = sanitizeBranchSegment(patch && patch.repairClass, 24);
  const sig = sanitizeBranchSegment(context.signalId || "evidence", 24);
  const hash = createHash("sha256")
    .update(String((patch && patch.unifiedDiff) || (patch && patch.patched) || ""), "utf8")
    .digest("hex")
    .slice(0, 8);
  return `${FIX_BRANCH_PREFIX}${cls}-${sig}-${hash}`;
}

/** One-line PR title for a fixer branch. */
export function makeFixTitle(patch, context = {}) {
  const cls = String((patch && patch.repairClass) || "repair");
  const sig = String(context.signalId || "collected evidence");
  const file = String((patch && patch.path) || "repo");
  return `fix(engineering-brain): ${cls} in ${file} from ${sig}`.slice(0, 120);
}

/** Deterministic commit message carrying evidence provenance. */
export function makeCommitMessage(patch, context = {}, verification = {}) {
  const lines = [
    `fix(engineering-brain): ${patch.repairClass} in ${patch.path}`,
    "",
    `Signal: ${context.signalId || "unknown"}`,
  ];
  if (context.failedStep) lines.push(`Failed step: ${context.failedStep}`);
  if (context.collectedAt) lines.push(`Evidence collected: ${context.collectedAt}`);
  lines.push(`Repair class: ${patch.repairClass}`);
  lines.push(`Verified: trigger-gone, paired test ${verification.pairedTest || "unknown"}`);
  lines.push("");
  lines.push("Proposed by the deterministic narrow-rules patch writer.");
  lines.push("Human review required — the fixer never merges.");
  return lines.join("\n");
}

/** PR body: provenance + verification, never raw evidence logs. */
export function makePrBody(patch, context = {}, verification = {}) {
  const lines = [
    "## Fixer pipeline",
    "",
    "Proposed by the deterministic narrow-rules patch writer and verified by",
    "the Slice 5 applier before this PR was opened. One PR per fix.",
    "",
    "### Evidence provenance",
    "",
    `- Signal: \`${context.signalId || "unknown"}\``,
    `- Failed step: \`${context.failedStep || "unknown"}\``,
    `- Evidence collected: \`${context.collectedAt || "unknown"}\``,
  ];
  // NOTE: context.summary is intentionally NOT emitted. A caller-supplied
  // summary is free text and could carry raw logs, stack traces, or
  // token-bearing content into the published PR. The PR body carries
  // evidence provenance plus the diff — never caller text.
  lines.push(
    "",
    "### Repair",
    "",
    `- Class: \`${patch.repairClass}\``,
    `- File: \`${patch.path}\``,
    "",
    "```diff",
    String(patch.unifiedDiff || "").slice(0, 4000),
    "```",
    "",
    "### Verification (ran before PR creation)",
    "",
    `- applyPatch: applied + verified in a fresh worktree`,
    `- Trigger gone: yes`,
    `- Paired test: \`${verification.pairedTest || "unknown"}\``,
    "",
    "### Safety",
    "",
    "The fixer never merges, deploys, or writes production data. Review and",
    "merge are human (or reviewer-agent) actions through the normal flow.",
  );
  return lines.join("\n");
}

/** Default git runner: throws on failure with the command's stderr. */
function defaultRunGit(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" }).trim();
  } catch (e) {
    const detail = String((e && e.stderr) || (e && e.message) || e).slice(0, 300);
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

/**
 * Default push: reuse the operator's proven REST git-database push helper.
 * The helper pushes only (PR body arg "-" skips PR creation) — this slice
 * opens the PR itself so the body carries evidence provenance.
 */
function defaultPushBranch({ worktree, branch, title }) {
  try {
    execFileSync("python3", [PUSH_HELPER, worktree, branch, title, "-"], {
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch (e) {
    const detail = String((e && e.stdout) || (e && e.message) || e).slice(0, 300);
    throw new Error(`push failed: ${detail}`);
  }
}

const OPEN_PR_PY = `
import sys, json, urllib.request, urllib.error
sys.path.insert(0, '/opt/hatch/skills/skill-creator/bin')
from dynamic_credentials import add_surrogate_to_request, read_json_response, read_response_body
data = json.loads(sys.argv[1])
req = urllib.request.Request(
    'https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/pulls',
    data=json.dumps({**data, 'base': 'main'}).encode(), method='POST')
req.add_header('Accept', 'application/vnd.github+json')
req.add_header('Content-Type', 'application/json')
req.add_header('User-Agent', 'muse-github-skill')
add_surrogate_to_request(req, 'custom.github', allowed_hosts=['api.github.com'])
try:
    pr = read_json_response(urllib.request.urlopen(req, timeout=60))
    print(json.dumps({'number': pr['number'], 'url': pr['html_url']}))
except urllib.error.HTTPError as e:
    print('PR_FAILED', e.code, read_response_body(e).decode()[:300])
    raise SystemExit(1)
`.trim();

/** Default PR opener: POST /pulls against main. Never the merge endpoint. */
function defaultOpenPr({ branch, title, body }) {
  try {
    const out = execFileSync(
      "python3",
      ["-c", OPEN_PR_PY, JSON.stringify({ head: branch, title, body })],
      { stdio: "pipe", encoding: "utf8" },
    ).trim();
    const pr = JSON.parse(out);
    if (!pr || !pr.number) throw new Error(`unexpected PR response: ${out.slice(0, 200)}`);
    return pr;
  } catch (e) {
    const detail = String((e && e.stdout) || (e && e.message) || e).slice(0, 300);
    throw new Error(`open PR failed: ${detail}`);
  }
}

/** Default worktree cleanup after a fully successful run. */
function defaultRemoveWorktree(worktree, repoRoot) {
  try {
    execFileSync("git", ["worktree", "remove", "--force", worktree], {
      cwd: repoRoot,
      stdio: "pipe",
    });
  } catch {
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {
      // Best effort; the branch and PR already exist.
    }
  }
}

const fail = (stage, reason, extra = {}) => ({ ok: false, stage, reason, ...extra });

/**
 * Run the full fix pipeline: validate -> apply+verify -> branch -> commit ->
 * push -> open PR -> clean up the worktree.
 *
 * Returns { ok:true, branch, pr:{number,url}, verification } on success, or
 * { ok:false, stage, reason[, detail][, branch][, worktree] } with the failing
 * stage named. The worktree is kept on push/PR failures for inspection; on
 * full success it is removed (the branch and PR survive).
 */
export function prepareFixPr({ patch, repoRoot, baseCommit, context = {}, deps = {} }) {
  const applyAndVerify =
    deps.applyAndVerify || (({ patch: p, repoRoot: r, baseCommit: b }) => applyPatch({ patch: p, repoRoot: r, baseCommit: b }));
  const runGit = deps.runGit || defaultRunGit;
  const pushBranch = deps.pushBranch || defaultPushBranch;
  const openPr = deps.openPr || defaultOpenPr;
  const removeWorktree = deps.removeWorktree || defaultRemoveWorktree;

  // --- validate ---
  if (!patch || patch.noPatch) return fail("validate", "no-patch");
  if (patch.application === "manual") return fail("validate", "manual-application");
  if (!repoRoot || !baseCommit) return fail("validate", "missing-context");
  if (!patch.path || typeof patch.patched !== "string" || typeof patch.original !== "string") {
    return fail("validate", "malformed-patch");
  }

  const branch = makeBranchName(patch, context);
  const title = makeFixTitle(patch, context);

  // --- apply + verify (Slice 5 machinery; keeps the worktree on success) ---
  let applied;
  try {
    applied = applyAndVerify({ patch, repoRoot, baseCommit });
  } catch (e) {
    return fail("apply", "apply-threw", { detail: String((e && e.message) || e).slice(0, 300) });
  }
  if (!applied || !applied.applied) {
    return fail("apply", (applied && applied.reason) || "apply-failed", {
      ...(applied && applied.detail ? { detail: String(applied.detail).slice(0, 300) } : {}),
    });
  }
  const { worktree, verification = {} } = applied;

  // --- branch + commit (exactly the patch's single file) ---
  try {
    // Dirtiness gate BEFORE the branch exists, so a dirty worktree leaves
    // no branch behind.
    const status = runGit(["status", "--porcelain"], worktree);
    const dirty = status.split("\n").map((l) => l.trim()).filter(Boolean);
    const expected = dirty.length === 1 && dirty[0].replace(/^[AM? ]+/, "") === patch.path;
    if (!expected) {
      return fail("commit", "worktree-dirty", {
        detail: `expected only ${patch.path}; saw: ${status.slice(0, 200) || "(clean)"}`,
        branch,
        worktree,
      });
    }
    runGit(["checkout", "-b", branch], worktree);
    runGit(["add", "--", patch.path], worktree);
    runGit(["commit", "-m", makeCommitMessage(patch, context, verification)], worktree);
  } catch (e) {
    return fail("commit", "commit-failed", {
      detail: String((e && e.message) || e).slice(0, 300),
      branch,
      worktree,
    });
  }

  // --- push ---
  try {
    pushBranch({ worktree, branch, title });
  } catch (e) {
    return fail("push", "push-failed", {
      detail: String((e && e.message) || e).slice(0, 300),
      branch,
      worktree,
    });
  }

  // --- open PR ---
  let pr;
  try {
    pr = openPr({ branch, title, body: makePrBody(patch, context, verification) });
  } catch (e) {
    return fail("pr", "open-pr-failed", {
      detail: String((e && e.message) || e).slice(0, 300),
      branch,
      worktree,
    });
  }

  // --- cleanup ---
  try {
    removeWorktree(worktree, repoRoot);
  } catch {
    // Best effort; branch and PR already exist.
  }

  return { ok: true, branch, pr: { number: pr.number, url: pr.url }, verification };
}
