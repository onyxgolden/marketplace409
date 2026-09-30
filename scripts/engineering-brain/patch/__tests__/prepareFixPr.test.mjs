import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  prepareFixPr,
  makeBranchName,
  makeFixTitle,
  makePrBody,
  sanitizeBranchSegment,
  FIX_BRANCH_PREFIX,
} from "../prepareFixPr.mjs";

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

function track(dir) {
  tmpDirs.push(dir);
  return dir;
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" }).trim();
}

/** Real temp git repo with one committed file. */
function makeRepo() {
  const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), "fixpr-repo-")));
  git(["init", "-b", "main"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Fixer Test"], dir);
  fs.writeFileSync(path.join(dir, "app.txt"), "hello\n");
  git(["add", "app.txt"], dir);
  git(["commit", "-m", "base"], dir);
  return dir;
}

function makePatch(overrides = {}) {
  return {
    path: "app.txt",
    original: "hello\n",
    patched: "hello world\n",
    hunks: [],
    unifiedDiff: "@@ -1 +1 @@\n-hello\n+hello world\n",
    repairClass: "wrong-path-literal",
    evidenceRef: {},
    application: "direct",
    ...overrides,
  };
}

/**
 * Fake apply+verify that mirrors production: creates a REAL detached git
 * worktree of the repo and writes the patched bytes into it.
 */
function fakeApplyAndVerify(patch, { extraDirty = null } = {}) {
  return ({ repoRoot }) => {
    const wt = track(fs.mkdtempSync(path.join(os.tmpdir(), "fixpr-wt-")));
    git(["worktree", "add", "--detach", wt, "HEAD"], repoRoot);
    fs.writeFileSync(path.join(wt, patch.path), patch.patched);
    if (extraDirty) {
      fs.writeFileSync(path.join(wt, extraDirty), "dirty\n");
    }
    return { applied: true, worktree: wt, verification: { triggerGone: true, pairedTest: "passed" } };
  };
}

function spyNet({ pushFails = false, prFails = false } = {}) {
  const calls = { push: [], pr: [] };
  return {
    calls,
    deps: {
      pushBranch: ({ worktree, branch, title }) => {
        calls.push.push({ worktree, branch, title });
        if (pushFails) throw new Error("boom: push rejected");
      },
      openPr: ({ branch, title, body }) => {
        calls.pr.push({ branch, title, body });
        if (prFails) throw new Error("boom: PR rejected");
        return { number: 1234, url: "https://github.com/onyxgolden/marketplace409/pull/1234" };
      },
    },
  };
}

const CONTEXT = { signalId: "undiscovered-errors/nsis-upload", failedStep: "build", collectedAt: "2026-09-30T05:00:00Z" };

describe("makeBranchName / sanitizeBranchSegment", () => {
  it("is deterministic and prefixed", () => {
    const p = makePatch();
    expect(makeBranchName(p, CONTEXT)).toBe(makeBranchName(p, CONTEXT));
    expect(makeBranchName(p, CONTEXT).startsWith(FIX_BRANCH_PREFIX)).toBe(true);
  });

  it("changes when the diff changes", () => {
    const a = makeBranchName(makePatch(), CONTEXT);
    const b = makeBranchName(makePatch({ patched: "hello there\n", unifiedDiff: "different" }), CONTEXT);
    expect(a).not.toBe(b);
  });

  it("sanitizes hostile input into a git-safe segment", () => {
    expect(sanitizeBranchSegment("../../etc/passwd")).toBe("etc-passwd");
    expect(sanitizeBranchSegment("A  B!!c")).toBe("a-b-c");
    expect(sanitizeBranchSegment("")).toBe("fix");
  });
});

describe("validate stage", () => {
  it("refuses a noPatch proposal", () => {
    const r = prepareFixPr({ patch: { noPatch: true, reason: "x" }, repoRoot: "/x", baseCommit: "abc" });
    expect(r).toMatchObject({ ok: false, stage: "validate", reason: "no-patch" });
  });

  it("refuses manual-application patches", () => {
    const r = prepareFixPr({ patch: makePatch({ application: "manual" }), repoRoot: "/x", baseCommit: "abc" });
    expect(r).toMatchObject({ ok: false, stage: "validate", reason: "manual-application" });
  });

  it("refuses missing context", () => {
    const r = prepareFixPr({ patch: makePatch(), repoRoot: null, baseCommit: "abc" });
    expect(r).toMatchObject({ ok: false, stage: "validate", reason: "missing-context" });
  });

  it("refuses malformed patches", () => {
    const r = prepareFixPr({ patch: { path: "x" }, repoRoot: "/x", baseCommit: "abc" });
    expect(r).toMatchObject({ ok: false, stage: "validate", reason: "malformed-patch" });
  });
});

describe("apply stage", () => {
  it("propagates the applier's failure without touching the network", () => {
    const net = spyNet();
    const r = prepareFixPr({
      patch: makePatch(),
      repoRoot: "/x",
      baseCommit: "abc",
      deps: {
        ...net.deps,
        applyAndVerify: () => ({ applied: false, reason: "paired-test-failed", detail: "boom" }),
      },
    });
    expect(r).toMatchObject({ ok: false, stage: "apply", reason: "paired-test-failed" });
    expect(net.calls.push).toHaveLength(0);
    expect(net.calls.pr).toHaveLength(0);
  });
});

describe("full pipeline (real git, faked network)", () => {
  it("branches, commits only the patched file, pushes, opens a PR, cleans up", () => {
    const repo = makeRepo();
    const patch = makePatch();
    const net = spyNet();
    const base = git(["rev-parse", "HEAD"], repo);

    const r = prepareFixPr({
      patch,
      repoRoot: repo,
      baseCommit: base,
      context: CONTEXT,
      deps: { ...net.deps, applyAndVerify: fakeApplyAndVerify(patch) },
    });

    expect(r.ok).toBe(true);
    expect(r.pr).toMatchObject({ number: 1234 });
    expect(r.branch.startsWith(FIX_BRANCH_PREFIX)).toBe(true);

    // Branch exists and its tip touches only the patched file.
    expect(git(["branch", "--list", r.branch], repo)).toContain(r.branch);
    const stat = git(["show", "--stat", "--format=", r.branch], repo);
    expect(stat).toContain("app.txt");
    expect(git(["diff", "--name-only", base, r.branch], repo).split("\n")).toEqual(["app.txt"]);

    // Network called exactly once each, in order.
    expect(net.calls.push).toHaveLength(1);
    expect(net.calls.pr).toHaveLength(1);
    expect(net.calls.push[0].branch).toBe(r.branch);

    // PR text carries provenance, not raw logs.
    const { title, body } = net.calls.pr[0];
    expect(title).toBe(makeFixTitle(patch, CONTEXT));
    expect(body).toContain("undiscovered-errors/nsis-upload");
    expect(body).toContain("wrong-path-literal");
    expect(body).toContain("app.txt");

    // Worktree removed after success (branch + PR survive).
    expect(fs.existsSync(net.calls.push[0].worktree)).toBe(false);
  });

  it("refuses to commit when the worktree has other dirty files", () => {
    const repo = makeRepo();
    const patch = makePatch();
    const net = spyNet();
    const base = git(["rev-parse", "HEAD"], repo);

    const r = prepareFixPr({
      patch,
      repoRoot: repo,
      baseCommit: base,
      context: CONTEXT,
      deps: { ...net.deps, applyAndVerify: fakeApplyAndVerify(patch, { extraDirty: "other.txt" }) },
    });

    expect(r).toMatchObject({ ok: false, stage: "commit", reason: "worktree-dirty" });
    expect(r.worktree).toBeTruthy();
    expect(net.calls.push).toHaveLength(0);
    expect(net.calls.pr).toHaveLength(0);
    // No branch was left behind.
    expect(git(["branch", "--list", r.branch], repo)).toBe("");
  });

  it("keeps the worktree and reports when push fails", () => {
    const repo = makeRepo();
    const patch = makePatch();
    const net = spyNet({ pushFails: true });
    const base = git(["rev-parse", "HEAD"], repo);

    const r = prepareFixPr({
      patch,
      repoRoot: repo,
      baseCommit: base,
      context: CONTEXT,
      deps: { ...net.deps, applyAndVerify: fakeApplyAndVerify(patch) },
    });

    expect(r).toMatchObject({ ok: false, stage: "push", reason: "push-failed", branch: r.branch });
    expect(net.calls.pr).toHaveLength(0);
    expect(fs.existsSync(r.worktree)).toBe(true);
    // Branch exists locally so a human can push it by hand.
    expect(git(["branch", "--list", r.branch], repo)).toContain(r.branch);
  });

  it("keeps branch + worktree and reports when opening the PR fails", () => {
    const repo = makeRepo();
    const patch = makePatch();
    const net = spyNet({ prFails: true });
    const base = git(["rev-parse", "HEAD"], repo);

    const r = prepareFixPr({
      patch,
      repoRoot: repo,
      baseCommit: base,
      context: CONTEXT,
      deps: { ...net.deps, applyAndVerify: fakeApplyAndVerify(patch) },
    });

    expect(r).toMatchObject({ ok: false, stage: "pr", reason: "open-pr-failed", branch: r.branch });
    expect(net.calls.push).toHaveLength(1);
    expect(fs.existsSync(r.worktree)).toBe(true);
  });
});

describe("makePrBody", () => {
  it("embeds the diff and provenance, and ignores undocumented context fields", () => {
    const patch = makePatch();
    const body = makePrBody(
      patch,
      { ...CONTEXT, rawLog: "Error: leaked secret stuff\n".repeat(50) },
      { pairedTest: "passed" },
    );
    expect(body).toContain("```diff");
    expect(body).toContain("-hello");
    expect(body).toContain("+hello world");
    expect(body).not.toContain("leaked secret stuff");
  });

  it("never emits a caller-supplied summary — log-like text can't reach the PR body", () => {
    const patch = makePatch();
    const hostile = [
      "one-line diagnosis",
      "Error: ENOENT build failed at C:\\runner\\_work",
      "at loadExportData (src/app/api/forge/scheduling/scheduleProjectAssembly.js:42:9)",
      "token=hsurr:abcdef123456",
      "ghp_FAKESECRETNOTREAL0000000000000000000000",
    ].join("\n");
    const body = makePrBody(patch, { ...CONTEXT, summary: hostile }, { pairedTest: "passed" });
    for (const line of hostile.split("\n")) {
      expect(body).not.toContain(line);
    }
    expect(body).not.toContain("### Diagnosis");
    // Provenance still lands.
    expect(body).toContain("undiscovered-errors/nsis-upload");
  });
});
