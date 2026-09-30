// Slice 5 — deterministic patch applier.
//
// Takes a Slice 3/4 proposed patch and applies it inside a FRESH git
// worktree, then verifies: the file still parses, the failure's trigger is
// gone from the file, and the source file's paired test still passes.
// Every stage is fail-closed: any failure restores the original bytes
// (hash-verified) and reports { applied: false, reason }.
//
// The applier never touches the working checkout, never commits, pushes,
// opens PRs, merges, or deploys. Success returns the kept worktree path so
// a human (or a later slice) can turn it into a branch/PR under the normal
// review flow. No AI, no network, deterministic.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  syntaxCheck,
  wholeWordRegExp,
  REPAIR_CLASS_WRONG_PATH_LITERAL,
  REPAIR_CLASS_WRONG_IDENTIFIER,
  REPAIR_CLASS_WRONG_CONFIG_KEY,
  REPAIR_CLASS_VERSION_PIN_DRIFT,
} from "./proposePatch.mjs";

/** Bounded vitest run for a single test file (ms). */
export const PAIRED_TEST_TIMEOUT_MS = 120_000;

/** Test-file extensions tried for a source file, in order. */
const TEST_EXTENSIONS = [".test.mjs", ".test.js", ".test.cjs"];

/**
 * Per-class "the failure's named cause left the file" check, run against the
 * patched content inside the worktree. Returns { ok: true } or
 * { ok: false, reason }.
 */
export function verifyTriggerGone({ patched, patch, worktreeRoot }) {
  const text = String(patched);
  const ref = (patch && patch.evidenceRef) || {};
  const no = (reason) => ({ ok: false, reason });

  switch (patch && patch.repairClass) {
    case REPAIR_CLASS_WRONG_PATH_LITERAL: {
      if (!ref.badPath || !ref.matchedPath) return no("missing-evidence-ref");
      if (text.includes(ref.badPath)) return no("bad-path-literal-still-present");
      if (!text.includes(ref.matchedPath)) return no("replacement-path-missing");
      // Contain the on-disk check to the worktree: a patch object with an
      // absolute or ..-escaping matchedPath must not make the verifier
      // read/stat outside the fresh worktree.
      const abs = resolveInWorktree(worktreeRoot, ref.matchedPath);
      if (!abs) return no("replacement-path-escapes-worktree");
      try {
        if (!fs.statSync(abs).isFile()) return no("replacement-path-missing-on-disk");
      } catch {
        return no("replacement-path-missing-on-disk");
      }
      return { ok: true };
    }
    case REPAIR_CLASS_WRONG_IDENTIFIER: {
      if (!ref.badIdentifier || !ref.matchedIdentifier) return no("missing-evidence-ref");
      if (wholeWordRegExp(ref.badIdentifier).test(text)) return no("bad-identifier-still-present");
      if (!wholeWordRegExp(ref.matchedIdentifier).test(text)) return no("replacement-identifier-missing");
      return { ok: true };
    }
    case REPAIR_CLASS_WRONG_CONFIG_KEY: {
      if (!ref.badKey || !ref.matchedKey) return no("missing-evidence-ref");
      const quoted = (k) => new RegExp(`"${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`);
      if (quoted(ref.badKey).test(text)) return no("bad-config-key-still-present");
      if (!quoted(ref.matchedKey).test(text)) return no("replacement-config-key-missing");
      return { ok: true };
    }
    case REPAIR_CLASS_VERSION_PIN_DRIFT: {
      if (!ref.package || !ref.badVersion || !ref.lockedVersion) return no("missing-evidence-ref");
      let pkg;
      try {
        pkg = JSON.parse(text);
      } catch {
        return no("package-json-unparseable");
      }
      const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
      const versions = sections
        .map((s) => pkg[s] && pkg[s][ref.package])
        .filter(Boolean);
      if (versions.length === 0) return no("package-not-in-manifest");
      const badSpec = new RegExp(`(^|[^0-9])${ref.badVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9]|$)`);
      if (versions.some((v) => badSpec.test(String(v)))) return no("bad-version-still-pinned");
      if (!versions.some((v) => String(v).includes(ref.lockedVersion))) {
        return no("locked-version-not-pinned");
      }
      return { ok: true };
    }
    default:
      return no(`unsupported-repair-class: ${(patch && patch.repairClass) || "(none)"}`);
  }
}

/**
 * Find the source file's paired test: same directory, same basename,
 * `.test.{mjs,js,cjs}`. Returns the repo-relative test path or null.
 * (Reverse of pairTestWithSource's test->source direction.)
 */
export function findPairedTest(worktreeRoot, relPath) {
  const dir = path.posix.dirname(relPath);
  const base = path.posix.basename(relPath, path.posix.extname(relPath));
  for (const testExt of TEST_EXTENSIONS) {
    const candidate = path.posix.join(dir, `${base}${testExt}`);
    try {
      if (fs.statSync(path.join(worktreeRoot, candidate)).isFile()) return candidate;
    } catch {
      // Not present — try the next extension.
    }
  }
  return null;
}

/**
 * Run the paired test for a patched source file inside the worktree.
 * Returns { status: "passed" } | { status: "no-paired-test" } |
 * { failed: true, detail } | { timedOut: true }.
 * The vitest spawn is injectable via deps.runTestFile for hermetic tests.
 */
export function runPairedTest(worktreeRoot, relPath, deps = {}) {
  const testRel = findPairedTest(worktreeRoot, relPath);
  if (!testRel) return { status: "no-paired-test" };
  const runTestFile = deps.runTestFile || defaultRunTestFile;
  try {
    runTestFile(worktreeRoot, testRel, PAIRED_TEST_TIMEOUT_MS);
    return { status: "passed" };
  } catch (e) {
    if (e && e.timedOut) return { timedOut: true };
    return { failed: true, detail: String((e && e.message) || e).slice(0, 500) };
  }
}

/** Default: spawn vitest for one file, bounded. Throws { timedOut: true } on timeout. */
function defaultRunTestFile(worktreeRoot, testRel, timeoutMs) {
  const vitestBin = path.join(worktreeRoot, "node_modules", ".bin", "vitest");
  try {
    execFileSync(vitestBin, ["run", testRel], {
      cwd: worktreeRoot,
      stdio: "pipe",
      timeout: timeoutMs,
    });
  } catch (e) {
    if (e && (e.code === "ETIMEDOUT" || /timed out/i.test(String(e.message)))) {
      const t = new Error(`paired test timed out after ${timeoutMs}ms`);
      t.timedOut = true;
      throw t;
    }
    throw e;
  }
}

/** Default worktree management. Worktrees live under ~/.brain-apply-* (never /tmp: tmpfs is 512M). */
function defaultMkWorktree(repoRoot, baseCommit) {
  const dir = fs.mkdtempSync(path.join(os.homedir(), ".brain-apply-"));
  try {
    execFileSync("git", ["worktree", "add", "--detach", dir, baseCommit], {
      cwd: repoRoot,
      stdio: "pipe",
    });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
}

function defaultRmWorktree(worktreePath) {
  try {
    execFileSync("git", ["worktree", "remove", "--force", worktreePath], { stdio: "pipe" });
  } catch {
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }
}

/** Resolve patch.path inside the worktree; reject escapes. */
function resolveInWorktree(worktreeRoot, relPath) {
  const abs = path.resolve(worktreeRoot, String(relPath || ""));
  const rel = path.relative(worktreeRoot, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return abs;
}

/**
 * Apply a proposed patch in a fresh worktree and verify it.
 *
 * Returns { applied: true, worktree, verification } on success (worktree is
 * kept for inspection/PR creation), or { applied: false, reason[, detail] }
 * with the original bytes restored (hash-verified) and the worktree removed.
 */
export function applyPatch({ patch, repoRoot, baseCommit, deps = {} }) {
  const mkWorktree = deps.mkWorktree || defaultMkWorktree;
  const rmWorktree = deps.rmWorktree || defaultRmWorktree;
  const readFile = deps.readFile || ((p) => fs.readFileSync(p, "utf8"));
  const writeFile = deps.writeFile || ((p, c) => fs.writeFileSync(p, c, "utf8"));

  if (!patch || patch.noPatch) return { applied: false, reason: "no-patch" };
  if (patch.application === "manual") {
    return { applied: false, reason: "manual-application" };
  }
  if (!repoRoot || !baseCommit) return { applied: false, reason: "missing-context" };

  let worktree;
  try {
    worktree = mkWorktree(repoRoot, baseCommit);
  } catch (e) {
    return { applied: false, reason: "worktree-failed", detail: String((e && e.message) || e).slice(0, 200) };
  }

  const abs = resolveInWorktree(worktree, patch.path);
  if (!abs) {
    rmWorktree(worktree);
    return { applied: false, reason: "unsafe-path" };
  }

  // Rollback: restore original bytes, verify the restore, remove the worktree.
  const rollback = (reason, detail) => {
    let restoredOk = false;
    try {
      writeFile(abs, patch.original);
      restoredOk = readFile(abs) === patch.original;
    } catch {
      restoredOk = false;
    }
    try {
      rmWorktree(worktree);
    } catch {
      // Best effort; the reason is what matters.
    }
    return {
      applied: false,
      reason,
      ...(detail ? { detail } : {}),
      restoredOk,
    };
  };

  // Staleness check: the file must still match the proposal's original bytes.
  let current;
  try {
    current = readFile(abs);
  } catch {
    rmWorktree(worktree);
    return { applied: false, reason: "cannot-read-file" };
  }
  if (current !== patch.original) {
    rmWorktree(worktree);
    return { applied: false, reason: "stale-patch" };
  }

  // Apply: full-content write of the proposer's exact target bytes.
  try {
    writeFile(abs, patch.patched);
  } catch (e) {
    return rollback("write-failed", String((e && e.message) || e).slice(0, 200));
  }

  // Parse gate (defense in depth — the proposer already gated this).
  const check = syntaxCheck(patch.path, patch.patched);
  if (!check.ok) return rollback("unparseable-patch", check.reason);

  // Trigger-gone check: the failure's named cause left the file.
  const tg = verifyTriggerGone({ patched: patch.patched, patch, worktreeRoot: worktree });
  if (!tg.ok) return rollback("trigger-still-present", tg.reason);

  // Paired-test check: the source file's own test still passes.
  const pt = runPairedTest(worktree, patch.path, deps);
  if (pt.timedOut) return rollback("verification-timeout");
  if (pt.failed) return rollback("paired-test-failed", pt.detail);

  return {
    applied: true,
    worktree,
    verification: {
      triggerGone: true,
      pairedTest: pt.status,
      unifiedDiff: patch.unifiedDiff || null,
    },
  };
}
