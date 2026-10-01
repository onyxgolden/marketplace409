import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyDocPatch } from "../runDocDriftCli.mjs";

const worktrees = [];
afterEach(() => {
  for (const wt of worktrees.splice(0)) {
    try {
      execFileSync("git", ["worktree", "remove", "--force", wt], { stdio: "pipe" });
    } catch {
      fs.rmSync(wt, { recursive: true, force: true });
    }
  }
});

function scratchRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "docdrift-apply-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: root });
  execFileSync("git", ["config", "user.name", "t"], { cwd: root });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  return root;
}

function commitDoc(root, rel, content) {
  fs.writeFileSync(path.join(root, rel), content, "utf8");
  execFileSync("git", ["add", rel], { cwd: root });
  execFileSync("git", ["commit", "-qm", "doc"], { cwd: root });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

describe("applyDocPatch", () => {
  it("applies a doc patch in a fresh worktree at the base commit", () => {
    const root = scratchRepo();
    const original = "# A\n\nSee `old/x.mjs`.\n";
    const base = commitDoc(root, "docs/a.md", original);
    const patch = {
      repairClass: "doc-dead-path-literal",
      path: "docs/a.md",
      original,
      patched: original.replace("old/x.mjs", "new/x.mjs"),
    };
    const res = applyDocPatch({ patch, repoRoot: root, baseCommit: base });
    expect(res.applied).toBe(true);
    expect(res.verification.kind).toBe("doc-drift");
    worktrees.push(res.worktree);
    const written = fs.readFileSync(path.join(res.worktree, "docs/a.md"), "utf8");
    expect(written).toContain("new/x.mjs");
    // The scratch repo itself is untouched.
    expect(fs.readFileSync(path.join(root, "docs/a.md"), "utf8")).toBe(original);
  });

  it("refuses a stale doc", () => {
    const root = scratchRepo();
    const original = "# A\n\nSee `old/x.mjs`.\n";
    const base = commitDoc(root, "docs/a.md", original);
    // Doc moved on after the patch was proposed.
    commitDoc(root, "docs/a.md", "# A\n\nChanged.\n");
    const patch = {
      repairClass: "doc-dead-path-literal",
      path: "docs/a.md",
      original,
      patched: original.replace("old/x.mjs", "new/x.mjs"),
    };
    // baseCommit is the NEW head, so original no longer matches.
    const res = applyDocPatch({ patch, repoRoot: root, baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim() });
    expect(res.applied).toBe(false);
    expect(res.reason).toBe("stale-doc");
    expect(base).toBeTruthy();
  });

  it("refuses non-doc targets", () => {
    const res = applyDocPatch({
      patch: { repairClass: "x", path: "src/a.mjs", original: "a", patched: "b" },
      repoRoot: "/tmp",
      baseCommit: "HEAD",
    });
    expect(res.applied).toBe(false);
    expect(res.reason).toBe("not-a-doc-target");
  });
});
