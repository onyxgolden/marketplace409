// FB-UI-3/4 rule 4: "Patch preparation occurs only in a fresh isolated branch/worktree." Every
// function here operates via `git worktree` against an explicit, known-good `baseSha` (never a
// branch name -- a branch can move between the moment it's chosen and the moment a worktree is
// created from it; a commit SHA cannot) and a freshly generated, collision-free path. The owner's own
// active working tree (whatever `repoRoot` they're running this from) is never written to -- every
// mutation happens inside the new worktree directory `git worktree add` creates.
//
// Uses execFileSync (argument arrays, `shell: false` implicitly -- execFile* never spawns a shell)
// rather than string-interpolated shell commands, the same command-injection-safe pattern
// executeProgrammerCommand.js already uses for this repository's other command-execution surface.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

export class DirtyWorktreeError extends Error {
  constructor(worktreePath, statusOutput) {
    super(`Newly created isolated worktree at "${worktreePath}" is not clean immediately after checkout -- refusing to prepare a patch on top of unexpected pre-existing changes.`);
    this.name = "DirtyWorktreeError";
    this.worktreePath = worktreePath;
    this.statusOutput = statusOutput;
  }
}

export class WorktreeCreationError extends Error {
  constructor(reason, cause) {
    super(`Could not create an isolated worktree: ${reason}`);
    this.name = "WorktreeCreationError";
    this.cause = cause;
  }
}

function git(args, { cwd, execFileFn = execFileSync } = {}) {
  return execFileFn("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// `worktreeRoot` defaults to a directory outside the main repo tree entirely (a sibling of `repoRoot`,
// matching the exact convention this whole session already used for every FB-UI checkpoint's own
// isolation: `git worktree add ../marketplace409-fb-ui-N`) -- never inside `repoRoot` itself, so an
// application-side `.gitignore` rule change could never accidentally start tracking a patch-prep
// worktree's contents.
// `worktreeSuffix` is test-only (defaults to a fresh random one in real use) -- exposed solely so a
// test can force a deterministic path collision to prove the pre-flight existsSync guard actually
// rejects one, rather than only asserting that random paths are usually different.
export function createIsolatedWorktree({ repoRoot, baseSha, proposalId, worktreeRoot, execFileFn = execFileSync, worktreeSuffix = randomUUID().slice(0, 8) }) {
  if (!repoRoot) throw new WorktreeCreationError("repoRoot is required");
  if (!baseSha) throw new WorktreeCreationError("baseSha is required -- a branch name is not accepted, only an immutable commit");
  if (!proposalId) throw new WorktreeCreationError("proposalId is required");

  const resolvedWorktreeRoot = worktreeRoot || path.resolve(repoRoot, "..");
  // A random suffix (not just proposalId) guarantees a fresh path even for a retry of the same
  // proposal -- the prior attempt's worktree (if any) is a separate directory, never silently reused.
  const worktreeName = `fb-ui-patch-${proposalId}-${worktreeSuffix}`;
  const worktreePath = path.join(resolvedWorktreeRoot, worktreeName);
  const branchName = `ui-improvement-manager/patch-${proposalId}-${randomUUID().slice(0, 8)}`;

  if (existsSync(worktreePath)) throw new WorktreeCreationError(`path "${worktreePath}" already exists -- refusing to reuse it`);

  try {
    git(["worktree", "add", "-b", branchName, worktreePath, baseSha], { cwd: repoRoot, execFileFn });
  } catch (cause) {
    throw new WorktreeCreationError(`git worktree add failed: ${cause.message}`, cause);
  }

  // Dirty-worktree protection: a worktree freshly checked out from an immutable commit must be
  // clean. If it isn't, something is wrong (a corrupted checkout, an unexpected local git hook, a
  // path that wasn't as fresh as assumed) -- fail closed and remove the worktree rather than prepare
  // a patch on top of an unknown starting state.
  const status = git(["status", "--porcelain"], { cwd: worktreePath, execFileFn }).trim();
  if (status.length > 0) {
    removeIsolatedWorktree({ repoRoot, worktreePath, execFileFn, force: true });
    throw new DirtyWorktreeError(worktreePath, status);
  }

  return Object.freeze({ worktreePath, branchName, baseSha, proposalId });
}

export function removeIsolatedWorktree({ repoRoot, worktreePath, execFileFn = execFileSync, force = false }) {
  try {
    git(["worktree", "remove", worktreePath, ...(force ? ["--force"] : [])], { cwd: repoRoot, execFileFn });
  } catch {
    // The worktree metadata may already be gone (e.g. a prior partial cleanup) -- fall back to a
    // direct directory removal so a failed git-level cleanup never leaves an orphaned directory on
    // disk that a later run's collision check (existsSync above) would then have to fail against.
    if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true, force: true });
    try { git(["worktree", "prune"], { cwd: repoRoot, execFileFn }); } catch { /* best-effort */ }
  }
}

export function captureWorktreeDiff({ worktreePath, execFileFn = execFileSync }) {
  return git(["diff", "--no-color"], { cwd: worktreePath, execFileFn });
}

export function ensureDirectoryExists(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}
