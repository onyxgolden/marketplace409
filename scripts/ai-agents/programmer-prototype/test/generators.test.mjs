import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { generateCandidate, replayCandidate, checkHelperPurity } from "../src/generators.mjs";
import { REASON } from "../src/constants.mjs";

const task = {
  task_id: "t1",
  fixture_ref: { repo_id: "r", base_commit: "0".repeat(40) },
  task: {
    family: "literal-correction",
    params: { path: "src/a.mjs", bad: '"Pause"', good: '"Paused"' },
  },
  constraints: { allowed_operations: ["modify"], allowed_paths: ["src/"], forbidden_paths: [] },
};
const snapshot = {
  files: new Map([["src/a.mjs", { content: 'export const x = "Pause";\n', sha256: "abc" }]]),
};

describe("generateCandidate", () => {
  it("is deterministic for the same task+snapshot", () => {
    const a = generateCandidate(task, snapshot);
    const b = generateCandidate(task, snapshot);
    expect(a.ok).toBe(true);
    expect(a.proposed_diff).toBe(b.proposed_diff);
    expect(a.proposal_sha256).toBe(b.proposal_sha256);
  });

  it("produces a diff that fixes the literal", () => {
    const r = generateCandidate(task, snapshot);
    expect(r.ok).toBe(true);
    expect(r.proposed_diff).toMatch(/"Paused"/);
  });

  it("blocks modify when the operation is not allowed", () => {
    const t2 = { ...task, constraints: { ...task.constraints, allowed_operations: ["add"] } };
    const r = generateCandidate(t2, snapshot);
    expect(r.ok).toBe(false);
    expect(r.reason_codes).toContain(REASON.OPERATION_FORBIDDEN);
  });

  it("blocks an unknown family", () => {
    const t2 = { ...task, task: { ...task.task, family: "nope" } };
    const r = generateCandidate(t2, snapshot);
    expect(r.ok).toBe(false);
    expect(r.reason_codes).toContain(REASON.FAMILY_UNSUPPORTED);
  });

  it("blocks when the anchor is missing", () => {
    const t2 = {
      ...task,
      task: { ...task.task, params: { path: "src/a.mjs", bad: '"Nope"', good: '"Paused"' } },
    };
    const r = generateCandidate(t2, snapshot);
    expect(r.ok).toBe(false);
    expect(r.reason_codes).toContain(REASON.NO_UNIQUE_ANCHOR);
  });
});

describe("replayCandidate", () => {
  const diff = '--- a/src/a.mjs\n+++ b/src/a.mjs\n@@ -1 +1 @@\n-export const x = "Pause";\n+export const x = "Paused";\n';
  const real = createHash("sha256").update(diff, "utf8").digest("hex");

  it("rejects a replay whose digest does not match", () => {
    const r = replayCandidate({ candidate_ref: { kind: "replay", diff, diff_sha256: "0".repeat(64) } });
    expect(r.ok).toBe(false);
    expect(r.reason_codes).toContain(REASON.PATCH_STALE);
  });

  it("accepts a replay with the true digest", () => {
    const r = replayCandidate({ candidate_ref: { kind: "replay", diff, diff_sha256: real } });
    expect(r.ok).toBe(true);
    expect(r.replay).toBe(true);
    expect(r.proposal_sha256).toBe(real);
  });

  it("rejects a missing candidate_ref", () => {
    const r = replayCandidate({});
    expect(r.ok).toBe(false);
  });
});

describe("checkHelperPurity", () => {
  it("accepts a pure helper", () => {
    const r = checkHelperPurity("export function add(a, b) { return a + b; }", "add");
    expect(r.ok).toBe(true);
  });
  it("rejects a helper that touches fs", () => {
    const r = checkHelperPurity(
      'import fs from "node:fs";\nexport function x() { return fs.readFileSync("/etc/passwd"); }',
      "x"
    );
    expect(r.ok).toBe(false);
  });
});
