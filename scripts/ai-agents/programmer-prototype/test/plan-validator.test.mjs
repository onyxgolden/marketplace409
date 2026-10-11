import { describe, it, expect } from "vitest";
import { scanHostileDiff, validatePlan } from "../src/plan-validator.mjs";
import { REASON } from "../src/constants.mjs";

const CONTENT = 'export const x = "Pause";\n';
const task = {
  task_id: "t1",
  family: "literal-correction",
  constraints: {
    allowed_operations: ["modify"],
    allowed_paths: ["src/"],
    forbidden_paths: ["src/secret/"],
    max_target_files: 3,
  },
};
const trusted = {
  allowed_profile_ids: ["syntax", "baseline", "candidate"],
  budgets: { maxTargetFiles: 3, maxAddedRemovedLines: 200, maxPatchBytes: 65536 },
};
const snapshot = () => ({ files: new Map([["src/a.mjs", { content: CONTENT, sha256: "abc123" }]]) });
const plan = {
  operations: [{ op: "modify", path: "src/a.mjs" }],
  test_profile_ids: ["candidate"],
  target_files: [{ path: "src/a.mjs", base_blob_or_null: null }],
};

const diffFor = (path, from, to) =>
  `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-${from}\n+${to}\n`;

describe("scanHostileDiff", () => {
  it("passes a benign literal diff", () => {
    const r = scanHostileDiff(diffFor("src/a.mjs", '"Pause"', '"Paused"'));
    expect(r.capabilityHits).toEqual([]);
    expect(r.resourceHits).toEqual([]);
  });

  it("flags child_process usage", () => {
    const r = scanHostileDiff('+ const cp = require("child_process");');
    expect(r.capabilityHits.length).toBeGreaterThan(0);
  });

  it("flags fs requires", () => {
    const r = scanHostileDiff('+ const fs = require("fs");');
    expect(r.capabilityHits.length).toBeGreaterThan(0);
  });

  it("flags node: imports", () => {
    const r = scanHostileDiff('+ import fs from "node:fs";');
    expect(r.capabilityHits.length).toBeGreaterThan(0);
  });

  it("flags eval and Function constructor", () => {
    expect(scanHostileDiff("+ eval(x);").capabilityHits.length).toBeGreaterThan(0);
    expect(scanHostileDiff("+ new Function(x);").capabilityHits.length).toBeGreaterThan(0);
  });

  it("flags fetch / WebSocket", () => {
    expect(scanHostileDiff("+ fetch(url);").capabilityHits.length).toBeGreaterThan(0);
    expect(scanHostileDiff("+ new WebSocket(u);").capabilityHits.length).toBeGreaterThan(0);
  });

  it("flags infinite loops as resource risks", () => {
    const r = scanHostileDiff("+ while (true) {}");
    expect(r.resourceHits.length).toBeGreaterThan(0);
  });
});

describe("validatePlan", () => {
  const goodDiff = diffFor("src/a.mjs", 'export const x = "Pause";', 'export const x = "Paused";');

  it("accepts an in-scope literal edit", () => {
    const r = validatePlan({ task, plan, proposedDiff: goodDiff, snapshot: snapshot(), trusted });
    expect(r.ok).toBe(true);
    expect(r.hostileHits.capabilityHits).toEqual([]);
  });

  it("refuses an unauthorized profile id", () => {
    const badPlan = { ...plan, test_profile_ids: ["evil-profile"] };
    const r = validatePlan({ task, plan: badPlan, proposedDiff: goodDiff, snapshot: snapshot(), trusted });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("REFUSED");
    expect(r.reason_codes).toContain(REASON.PROFILE_TAMPER);
  });

  it("rejects a target outside allowed_paths", () => {
    const bad = diffFor("etc/passwd", "a", "b");
    const r = validatePlan({
      task,
      plan: { ...plan, target_files: [{ path: "etc/passwd", base_blob_or_null: null }] },
      proposedDiff: bad,
      snapshot: { files: new Map([["etc/passwd", { content: "a\n", sha256: "x" }]]) },
      trusted,
    });
    expect(r.ok).toBe(false);
    expect(r.reason_codes).toContain(REASON.PATH_REJECTED);
  });

  it("rejects a target under forbidden_paths", () => {
    const bad = diffFor("src/secret/k.mjs", "a", "b");
    const r = validatePlan({
      task,
      plan: { ...plan, target_files: [{ path: "src/secret/k.mjs", base_blob_or_null: null }] },
      proposedDiff: bad,
      snapshot: { files: new Map([["src/secret/k.mjs", { content: "a\n", sha256: "x" }]]) },
      trusted,
    });
    expect(r.ok).toBe(false);
    expect(r.reason_codes).toContain(REASON.PATH_REJECTED);
  });

  it("surfaces (not blocks) hostile capability hits for the evaluator to flag", () => {
    // Design: the sandbox is the enforcement boundary for execution;
    // the scan is a tripwire surfaced as uncertainty, not a validator block.
    const bad = diffFor("src/a.mjs", 'export const x = "Pause";', 'export const x = process.env.SECRET;');
    const r = validatePlan({ task, plan, proposedDiff: bad, snapshot: snapshot(), trusted });
    expect(r.ok).toBe(true);
    expect(r.hostileHits.capabilityHits.length).toBeGreaterThan(0);
  });

  it("rejects a diff that does not apply to the snapshot", () => {
    const bad = diffFor("src/a.mjs", 'export const x = "WRONG";', 'export const x = "Paused";');
    const r = validatePlan({ task, plan, proposedDiff: bad, snapshot: snapshot(), trusted });
    expect(r.ok).toBe(false);
  });

  it("rejects a no-op diff", () => {
    const noop = diffFor("src/a.mjs", 'export const x = "Pause";', 'export const x = "Pause";');
    const r = validatePlan({ task, plan, proposedDiff: noop, snapshot: snapshot(), trusted });
    expect(r.ok).toBe(false);
    expect(r.reason_codes).toContain(REASON.NO_CHANGE_NEEDED);
  });
});
