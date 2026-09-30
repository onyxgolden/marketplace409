import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSelfHeal } from "../runSelfHeal.mjs";
import { parseArgs } from "../runSelfHealCli.mjs";

const BASE = {
  evidencePath: "/tmp/evidence.json",
  signalId: "ci/build",
  repoRoot: "/tmp/repo",
  baseCommit: "abc123",
};

const BUNDLE = { facets: { implicated_code: [] } };
const SIGNAL = { signal_id: "ci/build", failed_step: "build", collected_at: "2026-09-30T05:00:00Z" };
const PATCH = {
  path: "app.txt",
  original: "hello\n",
  patched: "hello world\n",
  unifiedDiff: "@@ -1 +1 @@\n-hello\n+hello world\n",
  repairClass: "wrong-path-literal",
  application: "direct",
};
const FIX_PR_OK = {
  ok: true,
  branch: "engbrain-fix/wrong-path-literal-ci-build-deadbeef",
  pr: { number: 496, url: "https://github.com/onyxgolden/marketplace409/pull/496" },
  verification: { pairedTest: "passed" },
};

function calls() {
  const seen = [];
  return {
    seen,
    diagnose: () => {
      seen.push("diagnose");
      return { bundle: BUNDLE, evidenceSignal: SIGNAL };
    },
    propose: () => {
      seen.push("propose");
      return PATCH;
    },
    fixPr: ({ context }) => {
      seen.push("fixPr");
      // The driver must pass provenance only — never free text.
      expect(context).toEqual({
        signalId: "ci/build",
        failedStep: "build",
        collectedAt: "2026-09-30T05:00:00Z",
      });
      expect(context).not.toHaveProperty("summary");
      return FIX_PR_OK;
    },
  };
}

describe("runSelfHeal", () => {
  it("runs diagnose -> propose -> fix-pr and reports the PR", () => {
    const c = calls();
    const r = runSelfHeal({ ...BASE, deps: c });
    expect(r).toMatchObject({
      ok: true,
      signalId: "ci/build",
      baseCommit: "abc123",
      branch: FIX_PR_OK.branch,
    });
    expect(r.pr).toEqual(FIX_PR_OK.pr);
    expect(c.seen).toEqual(["diagnose", "propose", "fixPr"]);
  });

  it("fails closed at validate when context is missing", () => {
    const c = calls();
    const r = runSelfHeal({ evidencePath: "/tmp/e.json", repoRoot: "/tmp/r", deps: c });
    expect(r).toMatchObject({ ok: false, stage: "validate", reason: "missing-context" });
    expect(c.seen).toEqual([]);
  });

  it("fails closed at diagnose and runs no later link", () => {
    const c = calls();
    c.diagnose = () => {
      c.seen.push("diagnose");
      throw new Error("no usable evidence signals in the evidence file");
    };
    const r = runSelfHeal({ ...BASE, deps: c });
    expect(r).toMatchObject({ ok: false, stage: "diagnose", reason: "diagnose-threw" });
    expect(r.detail).toContain("no usable evidence signals");
    expect(c.seen).toEqual(["diagnose"]);
  });

  it("treats a proposer no-patch as a clean stop with the proposer's reason", () => {
    const c = calls();
    c.propose = () => {
      c.seen.push("propose");
      return { noPatch: true, reason: "no-repair-trigger" };
    };
    const r = runSelfHeal({ ...BASE, deps: c });
    expect(r).toMatchObject({ ok: false, stage: "propose", reason: "no-repair-trigger" });
    expect(c.seen).toEqual(["diagnose", "propose"]);
  });

  it("refuses manual-application patches at propose", () => {
    const c = calls();
    c.propose = () => {
      c.seen.push("propose");
      return { ...PATCH, application: "manual" };
    };
    const r = runSelfHeal({ ...BASE, deps: c });
    expect(r).toMatchObject({ ok: false, stage: "propose", reason: "manual-application" });
    expect(c.seen).toEqual(["diagnose", "propose"]);
  });

  it("names the fix-pr sub-stage when the fix link fails", () => {
    const c = calls();
    c.fixPr = () => {
      c.seen.push("fixPr");
      return { ok: false, stage: "push", reason: "push-failed", detail: "boom", branch: "b", worktree: "/tmp/w" };
    };
    const r = runSelfHeal({ ...BASE, deps: c });
    expect(r).toMatchObject({ ok: false, stage: "fix-pr/push", reason: "push-failed" });
    expect(r.detail).toBe("boom");
    expect(c.seen).toEqual(["diagnose", "propose", "fixPr"]);
  });

  it("auto-selects the signal the diagnose link returns", () => {
    const c = calls();
    c.diagnose = () => {
      c.seen.push("diagnose");
      return { bundle: BUNDLE, evidenceSignal: { ...SIGNAL, signal_id: "the-only-one" } };
    };
    c.fixPr = ({ context }) => {
      c.seen.push("fixPr");
      expect(context.signalId).toBe("the-only-one");
      return FIX_PR_OK;
    };
    const r = runSelfHeal({
      evidencePath: BASE.evidencePath,
      repoRoot: BASE.repoRoot,
      baseCommit: BASE.baseCommit,
      deps: c,
    });
    expect(r).toMatchObject({ ok: true, signalId: "the-only-one" });
  });
});

describe("runSelfHealCli parseArgs", () => {
  it("parses the documented flags", () => {
    expect(
      parseArgs(["--evidence", "e.json", "--signal", "s", "--repo", "r", "--base", "b", "--json"]),
    ).toEqual({ evidence: "e.json", signalId: "s", repo: "r", base: "b", json: true });
  });

  it("leaves --signal and --manifest optional", () => {
    expect(parseArgs(["--evidence", "e.json", "--repo", "r", "--base", "b"])).toEqual({
      evidence: "e.json",
      repo: "r",
      base: "b",
    });
  });
});

describe("live composition — real propose + fix-pr links", () => {
  const BAD = "src/utlis/helpers.js";
  let repo;
  afterEach(() => {
    if (repo) fs.rmSync(repo, { recursive: true, force: true });
    repo = null;
  });

  function makeRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "selfheal-test-"));
    const git = (args) => execFileSync("git", args, { cwd: dir, stdio: "pipe", encoding: "utf8" }).trim();
    git(["init", "-b", "main"]);
    git(["config", "user.email", "t@example.com"]);
    git(["config", "user.name", "t"]);
    fs.mkdirSync(path.join(dir, "src", "utils"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "utils", "helpers.js"), "export const help = () => 1;\n");
    fs.writeFileSync(
      path.join(dir, "holder.js"),
      `const h = require('./${BAD}');\nmodule.exports = h;\n`,
    );
    git(["add", "."]);
    git(["commit", "-m", "base"]);
    return { dir, base: git(["rev-parse", "HEAD"]) };
  }

  it("unwraps the proposer's { patch } result and drives a full verified run", () => {
    const { dir, base } = makeRepo();
    repo = dir;
    const evidenceSignal = {
      signal_id: "ci/build",
      failed_step: "build",
      collected_at: "2026-09-30T05:00:00Z",
      error_lines: [`Error: Cannot find module './${BAD}'`],
      mentioned_paths: [BAD],
    };
    const bundle = { facets: { implicated_code: [{ source_path: "holder.js" }] }, past_fixes: [] };
    const opened = [];
    // No propose fake: the real defaultPropose must unwrap { patch, explanation }.
    const r = runSelfHeal({
      evidencePath: "/tmp/evidence.json",
      signalId: "ci/build",
      repoRoot: dir,
      baseCommit: base,
      deps: {
        diagnose: () => ({ bundle, evidenceSignal }),
        pushBranch: () => {},
        openPr: (args) => {
          opened.push(args);
          return { number: 999, url: "https://example.invalid/pr/999" };
        },
      },
    });
    expect(r.ok).toBe(true);
    expect(r.branch).toMatch(/^engbrain-fix\/wrong-path-literal-ci-build-/);
    expect(opened).toHaveLength(1);
    expect(opened[0].body).not.toContain("### Diagnosis");
    expect(opened[0].body).not.toContain("Cannot find module");
    const onBranch = execFileSync("git", ["show", `${r.branch}:holder.js`], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(onBranch).toContain("src/utils/helpers.js");
    expect(onBranch).not.toContain(BAD);
  });
});
