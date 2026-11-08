/**
 * worktreeEvaluator.test.js — unit tests for the P5-B pure domain
 * module. No git, no filesystem, no processes: every decision is
 * exercised with literal inputs.
 */
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_TREE_DIGEST_LABEL,
  EVALUATION_VERSION,
  appendAuditEvent,
  buildEvaluationRecord,
  checkMirrorConfigEntries,
  checkPorcelainMatchesPlan,
  checkTreeHygiene,
  classifyStoredRecord,
  computeCandidateTreeDigest,
  gitBlobSha1,
  jobScopedIdFor,
  normalizeCanonicalDiff,
  planFromEvaluation,
  stripGitDiffHeaders,
  validateCandidateShape,
  validateEvaluatorJob,
  worktreePathFor,
} from "./worktreeEvaluator.js";

const VALID_JOB = {
  job_id: "p5b-test-job-1",
  idempotency_key: "idem-key-1",
  operator_ref: "op:tester",
  repo_id: "repo:synthetic",
  base_sha: "a".repeat(40),
  task_digest: "b".repeat(64),
};

function treeEntry(path, mode = "100644") {
  return { mode, type: "blob", sha: "c".repeat(40), path };
}

describe("gitBlobSha1", () => {
  it("matches the known git blob id for 'test'", () => {
    expect(gitBlobSha1("test")).toBe("30d74d258442c7c65512eafab474568dd706c430");
  });

  it("matches the known empty-blob id", () => {
    expect(gitBlobSha1("")).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });
});

describe("computeCandidateTreeDigest", () => {
  it("matches the golden vector for one file", () => {
    expect(computeCandidateTreeDigest([{ path: "lib/a.js", mode: "100644", content: "export const a = 1;\n" }])).toBe(
      "22c8b85c26fab6e11573f18fc7f8baa68233170c16fbe3641e19436bd4e536be",
    );
  });

  it("matches the golden vector for two files", () => {
    expect(
      computeCandidateTreeDigest([
        { path: "lib/a.js", mode: "100644", content: "export const a = 1;\n" },
        { path: "lib/b.js", mode: "100644", content: "export const b = 2;\n" },
      ]),
    ).toBe("81f1310cc438f15f1e828d802a373d99f41ed62edeaaca3c8b04394c66d76cd0");
  });

  it("is order-independent and label-bound", () => {
    const a = computeCandidateTreeDigest([
      { path: "lib/b.js", mode: "100644", content: "export const b = 2;\n" },
      { path: "lib/a.js", mode: "100644", content: "export const a = 1;\n" },
    ]);
    const b = computeCandidateTreeDigest([
      { path: "lib/a.js", mode: "100644", content: "export const a = 1;\n" },
      { path: "lib/b.js", mode: "100644", content: "export const b = 2;\n" },
    ]);
    expect(a).toBe(b);
    expect(CANDIDATE_TREE_DIGEST_LABEL).toBe("p5b-candidate-tree-v1");
  });

  it("rejects unsupported modes", () => {
    expect(() => computeCandidateTreeDigest([{ path: "lib/a.js", mode: "120000", content: "x" }])).toThrow(/unsupported mode/);
  });
});

describe("jobScopedIdFor / worktreePathFor", () => {
  it("derives a stable opaque id from the key only", () => {
    const a = jobScopedIdFor("idem-key-1");
    expect(a).toMatch(/^p5b-[0-9a-f]{16}$/);
    expect(jobScopedIdFor("idem-key-1")).toBe(a);
    expect(jobScopedIdFor("idem-key-2")).not.toBe(a);
  });

  it("builds a host-owned path under the root", () => {
    expect(worktreePathFor("/tmp/root/", "idem-key-1")).toBe(`/tmp/root/${jobScopedIdFor("idem-key-1")}`);
  });
});

describe("checkTreeHygiene", () => {
  it("accepts a clean regular tree", () => {
    expect(checkTreeHygiene([treeEntry("lib/a.js"), treeEntry("README.md")])).toEqual({ ok: true });
  });

  it("refuses a symlink entry as untrusted mirror content", () => {
    const r = checkTreeHygiene([treeEntry("link", "120000")]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("MIRROR_UNTRUSTED");
    expect(r.detail).toMatch(/symlink/);
  });

  it("refuses a submodule gitlink", () => {
    const r = checkTreeHygiene([{ mode: "160000", type: "commit", sha: "c".repeat(40), path: "vendor/sub" }]);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/submodule/);
  });

  it("refuses a .git segment", () => {
    const r = checkTreeHygiene([treeEntry(".git/config")]);
    expect(r.ok).toBe(false);
  });

  it("refuses a case collision", () => {
    const r = checkTreeHygiene([treeEntry("Lib/A.js"), treeEntry("lib/a.js")]);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/case-collision/);
  });

  it("refuses a backslash path and a bad blob sha", () => {
    expect(checkTreeHygiene([treeEntry("lib\\a.js")]).ok).toBe(false);
    expect(checkTreeHygiene([{ mode: "100644", type: "blob", sha: "xyz", path: "lib/a.js" }]).ok).toBe(false);
  });
});

describe("checkMirrorConfigEntries", () => {
  it("accepts a clean config", () => {
    expect(
      checkMirrorConfigEntries([
        { key: "core.bare", value: "true" },
        { key: "core.repositoryformatversion", value: "0" },
      ]),
    ).toEqual({ ok: true });
  });

  it("refuses each dangerous key class", () => {
    for (const key of [
      "include.path",
      "includeif.gitdir:~/x.path",
      "core.hookspath",
      "core.sshcommand",
      "core.gitproxy",
      "core.fsmonitor",
      "extensions.worktreeconfig",
      "filter.lfs.clean",
      "credential.helper",
      "protocol.http.allow",
    ]) {
      const r = checkMirrorConfigEntries([{ key, value: "x" }]);
      expect(r.ok, key).toBe(false);
      expect(r.reason).toBe("MIRROR_UNTRUSTED");
    }
  });
});

describe("validateEvaluatorJob", () => {
  it("accepts a valid job", () => {
    expect(validateEvaluatorJob(VALID_JOB)).toBe(VALID_JOB);
  });

  it("refuses a short base sha and a short task digest", () => {
    expect(() => validateEvaluatorJob({ ...VALID_JOB, base_sha: "abc" })).toThrow(/base_sha/);
    expect(() => validateEvaluatorJob({ ...VALID_JOB, task_digest: "abc" })).toThrow(/task_digest/);
  });

  it("refuses a wrong policy version", () => {
    expect(() => validateEvaluatorJob({ ...VALID_JOB, policy_version: "other" })).toThrow(/policy_version/);
  });
});

describe("validateCandidateShape", () => {
  const candidate = {
    task: { task_id: "t1" },
    plan: { test_profile_ids: ["syntax"] },
    proposed_diff: "--- a/lib/a.js\n+++ b/lib/a.js\n@@ -1,1 +1,1 @@\n-old\n+new\n",
  };

  it("accepts a well-shaped candidate", () => {
    expect(validateCandidateShape(candidate)).toBe(candidate);
  });

  it("refuses an empty diff and an oversized diff", () => {
    expect(() => validateCandidateShape({ ...candidate, proposed_diff: "" })).toThrow(/proposed_diff/);
    expect(() => validateCandidateShape({ ...candidate, proposed_diff: "x".repeat(64 * 1024 + 1) })).toThrow(/BUDGET_EXCEEDED/);
  });
});

describe("checkPorcelainMatchesPlan", () => {
  const plan = new Set(["lib/a.js", "lib/new.js"]);

  it("accepts exactly the planned set (modified + untracked add)", () => {
    expect(checkPorcelainMatchesPlan([" M lib/a.js", "?? lib/new.js"], plan)).toEqual({ ok: true });
  });

  it("refuses an unplanned change", () => {
    const r = checkPorcelainMatchesPlan([" M lib/a.js", "?? lib/new.js", " M lib/other.js"], plan);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/unplanned-change/);
  });

  it("refuses a planned file left unchanged", () => {
    const r = checkPorcelainMatchesPlan([" M lib/a.js"], plan);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/planned-file-unchanged/);
  });

  it("refuses deletions", () => {
    const r = checkPorcelainMatchesPlan([" D lib/a.js", "?? lib/new.js"], plan);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/unexpected-status/);
  });
});

describe("normalizeCanonicalDiff", () => {
  const candidate =
    "diff --git a/lib/a.js b/lib/a.js\n--- a/lib/a.js\n+++ b/lib/a.js\n@@ -1,1 +1,1 @@\n-old\n+new\n";
  const canonical =
    "diff --git a/lib/a.js b/lib/a.js\nindex 1111111..2222222 100644\n--- a/lib/a.js\n+++ b/lib/a.js\n@@ -1,1 +1,1 @@\n-old\n+new\n";

  it("accepts a matching canonical diff and normalizes line endings", () => {
    const r = normalizeCanonicalDiff(canonical.replace(/\n/g, "\r\n"), candidate);
    expect(r.ok).toBe(true);
    expect(r.diff).not.toContain("\r");
    expect(r.diff.endsWith("\n")).toBe(true);
  });

  it("refuses a mode change", () => {
    const r = normalizeCanonicalDiff(`old mode 100644\nnew mode 100755\n${canonical}`, candidate);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("PATCH_MISMATCH");
  });

  it("refuses a counts mismatch", () => {
    const r = normalizeCanonicalDiff(
      "diff --git a/lib/a.js b/lib/a.js\n--- a/lib/a.js\n+++ b/lib/a.js\n@@ -1,1 +1,2 @@\n-old\n+new\n+extra\n",
      candidate,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("PATCH_MISMATCH");
  });
});

describe("stripGitDiffHeaders", () => {
  it("drops git file-section headers and keeps hunks intact", () => {
    const diff = [
      "diff --git a/lib/a.js b/lib/a.js",
      "index 1111111..2222222 100644",
      "--- a/lib/a.js",
      "+++ b/lib/a.js",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
    ].join("\n");
    expect(stripGitDiffHeaders(diff)).toBe(["--- a/lib/a.js", "+++ b/lib/a.js", "@@ -1,1 +1,1 @@", "-old", "+new"].join("\n"));
  });

  it("never strips hunk body lines or Binary markers", () => {
    const diff = "--- a/lib/a.js\n+++ b/lib/a.js\n@@ -1,1 +1,1 @@\n+diff --git a/x b/x\n Binary files a/b and b/c differ\n";
    expect(stripGitDiffHeaders(diff)).toBe(diff);
  });
});

describe("appendAuditEvent / classifyStoredRecord", () => {
  it("appends with capped detail and rejects unknown events", () => {
    const audit = appendAuditEvent([], "created", "op:1", "started", "2026-11-07T00:00:00.000Z");
    expect(audit).toHaveLength(1);
    expect(audit[0].event).toBe("created");
    expect(() => appendAuditEvent(audit, "nope", "op:1", "x")).toThrow(/unknown evaluation audit event/);
  });

  it("classifies terminal, in-flight, and unknown records", () => {
    expect(classifyStoredRecord(null)).toBe("unknown");
    expect(classifyStoredRecord({ status: "PROPOSED" })).toBe("terminal");
    expect(classifyStoredRecord({ status: "BLOCKED" })).toBe("terminal");
    expect(classifyStoredRecord({ status: "PREPARING" })).toBe("in-flight");
    expect(classifyStoredRecord({ status: "WEIRD" })).toBe("unknown");
  });
});

describe("buildEvaluationRecord", () => {
  function baseParts() {
    return {
      evaluation_version: EVALUATION_VERSION,
      evaluator_version: "programmer-worktree-evaluator@1",
      job_id: "j1",
      idempotency_key: "k1",
      task_digest: "b".repeat(64),
      candidate_diff_sha256: "c".repeat(64),
      operator_ref: "op:1",
      status: "PROPOSED",
      reason_codes: ["OK"],
      detail: "ok",
      mirror: { repo_id: "r", mirror_realpath: "/tmp/m", base_sha: "a".repeat(40) },
      worktree: { job_scoped_id: "p5b-abc", diagnostic_location: "worktrees/p5b-abc" },
      isolation: { mechanism: "bwrap", detail: "probe-passed" },
      plan: { files: [], diff: "d", patch_sha256: "e".repeat(64), candidate_tree_digest: "f".repeat(64) },
      budgets: {},
      canaries: {},
      risks: [],
      audit: [{ event: "created", at: "2026-11-07T00:00:00.000Z", actor: "op:1", detail: "x" }],
      created_at: "2026-11-07T00:00:00.000Z",
      completed_at: "2026-11-07T00:00:01.000Z",
    };
  }

  it("freezes the record deeply", () => {
    const record = buildEvaluationRecord(baseParts());
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.audit)).toBe(true);
    expect(Object.isFrozen(record.plan)).toBe(true);
  });

  it("refuses unknown and missing fields", () => {
    expect(() => buildEvaluationRecord({ ...baseParts(), surprise: 1 })).toThrow(/unknown evaluation record field/);
    const parts = baseParts();
    delete parts.plan;
    expect(() => buildEvaluationRecord(parts)).toThrow(/missing evaluation record field/);
  });

  it("planFromEvaluation extracts the plan portion", () => {
    const record = buildEvaluationRecord(baseParts());
    expect(planFromEvaluation(record)).toEqual({
      files: [],
      diff: "d",
      patch_sha256: "e".repeat(64),
      candidate_tree_digest: "f".repeat(64),
    });
  });
});
