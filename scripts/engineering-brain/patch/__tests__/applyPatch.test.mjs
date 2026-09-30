import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyPatch,
  verifyTriggerGone,
  findPairedTest,
  runPairedTest,
} from "../applyPatch.mjs";
import {
  REPAIR_CLASS_WRONG_PATH_LITERAL,
  REPAIR_CLASS_WRONG_IDENTIFIER,
  REPAIR_CLASS_WRONG_CONFIG_KEY,
  REPAIR_CLASS_VERSION_PIN_DRIFT,
} from "../proposePatch.mjs";

const tmpRoots = [];
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function track(dir) {
  tmpRoots.push(dir);
  return dir;
}

/** Tiny fixture repo: { "rel/path": content }. */
function makeRepo(files) {
  const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), "apply-test-repo-")));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

/**
 * Hermetic worktree deps: copy the fixture repo to a temp dir instead of
 * `git worktree add`. Records removals so tests can assert cleanup.
 */
function hermeticDeps({ runTestFile } = {}) {
  const removed = [];
  return {
    removed,
    deps: {
      mkWorktree: (repoRoot) => {
        const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), "apply-test-wt-")));
        fs.cpSync(repoRoot, dir, { recursive: true });
        return dir;
      },
      rmWorktree: (p) => {
        removed.push(p);
        fs.rmSync(p, { recursive: true, force: true });
      },
      ...(runTestFile ? { runTestFile } : {}),
    },
  };
}

const okTest = () => {};
const failingTest = () => {
  throw new Error("AssertionError: expected 1 to be 2");
};
const timeoutTest = () => {
  const e = new Error("timed out");
  e.timedOut = true;
  throw e;
};

function identifierPatch(original, patched, extra = {}) {
  return {
    path: "src/app.mjs",
    original,
    patched,
    hunks: [{ changedLines: 1 }],
    unifiedDiff: "--- a/src/app.mjs\n+++ b/src/app.mjs\n",
    repairClass: REPAIR_CLASS_WRONG_IDENTIFIER,
    evidenceRef: { failed_step: "lint", badIdentifier: "getElementByID", matchedIdentifier: "getElementById" },
    application: "direct",
    ...extra,
  };
}

const GOOD_ORIGINAL = `import { getElementById } from "./dom.mjs";\nconst el = getElementByID("main");\n`;
const GOOD_PATCHED = `import { getElementById } from "./dom.mjs";\nconst el = getElementById("main");\n`;

describe("applyPatch — happy path", () => {
  it("applies, verifies, and keeps the worktree", () => {
    const repo = makeRepo({ "src/app.mjs": GOOD_ORIGINAL, "src/app.test.mjs": "import { it } from 'vitest';\n" });
    const { removed, deps } = hermeticDeps({ runTestFile: okTest });
    const r = applyPatch({ patch: identifierPatch(GOOD_ORIGINAL, GOOD_PATCHED), repoRoot: repo, baseCommit: "abc123", deps });
    expect(r.applied).toBe(true);
    expect(r.verification.triggerGone).toBe(true);
    expect(r.verification.pairedTest).toBe("passed");
    expect(removed).toEqual([]);
    expect(fs.readFileSync(path.join(r.worktree, "src/app.mjs"), "utf8")).toBe(GOOD_PATCHED);
    expect(fs.existsSync(r.worktree)).toBe(true);
  });

  it("applies with a no-paired-test note when no test file exists", () => {
    const repo = makeRepo({ "src/app.mjs": GOOD_ORIGINAL });
    const { deps } = hermeticDeps({ runTestFile: okTest });
    const r = applyPatch({ patch: identifierPatch(GOOD_ORIGINAL, GOOD_PATCHED), repoRoot: repo, baseCommit: "abc123", deps });
    expect(r.applied).toBe(true);
    expect(r.verification.pairedTest).toBe("no-paired-test");
  });
});

describe("applyPatch — refusals before any work", () => {
  it("refuses manual-application patches without creating a worktree", () => {
    let created = 0;
    const repo = makeRepo({ "src/app.mjs": GOOD_ORIGINAL });
    const { deps } = hermeticDeps();
    deps.mkWorktree = () => { created += 1; return hermeticDeps().deps.mkWorktree(repo); };
    const r = applyPatch({
      patch: identifierPatch(GOOD_ORIGINAL, GOOD_PATCHED, { application: "manual" }),
      repoRoot: repo, baseCommit: "abc123", deps,
    });
    expect(r).toMatchObject({ applied: false, reason: "manual-application" });
    expect(created).toBe(0);
  });

  it("refuses no-patch input", () => {
    const repo = makeRepo({});
    const r = applyPatch({ patch: { noPatch: true, reason: "x" }, repoRoot: repo, baseCommit: "abc", deps: hermeticDeps().deps });
    expect(r).toMatchObject({ applied: false, reason: "no-patch" });
  });

  it("rejects paths escaping the worktree", () => {
    const repo = makeRepo({ "src/app.mjs": GOOD_ORIGINAL });
    const { removed, deps } = hermeticDeps();
    const r = applyPatch({
      patch: identifierPatch(GOOD_ORIGINAL, GOOD_PATCHED, { path: "../evil.mjs" }),
      repoRoot: repo, baseCommit: "abc123", deps,
    });
    expect(r).toMatchObject({ applied: false, reason: "unsafe-path" });
    expect(removed.length).toBe(1);
  });

  it("reports worktree-failed when the worktree cannot be created", () => {
    const repo = makeRepo({});
    const r = applyPatch({
      patch: identifierPatch(GOOD_ORIGINAL, GOOD_PATCHED),
      repoRoot: repo, baseCommit: "abc123",
      deps: { mkWorktree: () => { throw new Error("git exploded"); } },
    });
    expect(r).toMatchObject({ applied: false, reason: "worktree-failed" });
  });
});

describe("applyPatch — stale and failed verification roll back", () => {
  it("detects a stale patch and removes the worktree without writing", () => {
    const repo = makeRepo({ "src/app.mjs": GOOD_ORIGINAL + "// someone else edited\n" });
    const { removed, deps } = hermeticDeps();
    const r = applyPatch({ patch: identifierPatch(GOOD_ORIGINAL, GOOD_PATCHED), repoRoot: repo, baseCommit: "abc123", deps });
    expect(r).toMatchObject({ applied: false, reason: "stale-patch" });
    expect(removed.length).toBe(1);
    expect(fs.existsSync(removed[0])).toBe(false);
    // Fixture repo itself untouched.
    expect(fs.readFileSync(path.join(repo, "src/app.mjs"), "utf8")).toContain("// someone else edited");
  });

  it("rolls back when the trigger is still present after apply", () => {
    const stillBad = GOOD_ORIGINAL; // "patched" content that keeps the bad identifier
    const repo = makeRepo({ "src/app.mjs": GOOD_ORIGINAL });
    const { removed, deps } = hermeticDeps();
    const r = applyPatch({ patch: identifierPatch(GOOD_ORIGINAL, stillBad), repoRoot: repo, baseCommit: "abc123", deps });
    expect(r.reason).toBe("trigger-still-present");
    expect(r.applied).toBe(false);
    expect(r.restoredOk).toBe(true);
    expect(removed.length).toBe(1);
  });

  it("rolls back an unparseable result", () => {
    const broken = `import { getElementById } from "./dom.mjs";\nconst el = getElementById("main"\n`;
    const repo = makeRepo({ "src/app.mjs": GOOD_ORIGINAL });
    const { removed, deps } = hermeticDeps();
    const r = applyPatch({ patch: identifierPatch(GOOD_ORIGINAL, broken), repoRoot: repo, baseCommit: "abc123", deps });
    expect(r).toMatchObject({ applied: false, reason: "unparseable-patch" });
    expect(r.restoredOk).toBe(true);
    expect(removed.length).toBe(1);
  });

  it("rolls back when the paired test fails", () => {
    const repo = makeRepo({ "src/app.mjs": GOOD_ORIGINAL, "src/app.test.mjs": "x" });
    const { removed, deps } = hermeticDeps({ runTestFile: failingTest });
    const r = applyPatch({ patch: identifierPatch(GOOD_ORIGINAL, GOOD_PATCHED), repoRoot: repo, baseCommit: "abc123", deps });
    expect(r).toMatchObject({ applied: false, reason: "paired-test-failed" });
    expect(r.restoredOk).toBe(true);
    expect(removed.length).toBe(1);
  });

  it("rolls back on verification timeout", () => {
    const repo = makeRepo({ "src/app.mjs": GOOD_ORIGINAL, "src/app.test.mjs": "x" });
    const { removed, deps } = hermeticDeps({ runTestFile: timeoutTest });
    const r = applyPatch({ patch: identifierPatch(GOOD_ORIGINAL, GOOD_PATCHED), repoRoot: repo, baseCommit: "abc123", deps });
    expect(r).toMatchObject({ applied: false, reason: "verification-timeout" });
    expect(r.restoredOk).toBe(true);
    expect(removed.length).toBe(1);
  });
});

describe("verifyTriggerGone", () => {
  it("wrong-path-literal: bad gone, replacement present on disk", () => {
    const repo = track(fs.mkdtempSync(path.join(os.tmpdir(), "apply-tg-")));
    fs.writeFileSync(path.join(repo, "real.mjs"), "x");
    const patch = {
      repairClass: REPAIR_CLASS_WRONG_PATH_LITERAL,
      evidenceRef: { badPath: "./rela.mjs", matchedPath: "./real.mjs" },
    };
    expect(verifyTriggerGone({ patched: `import "./real.mjs";`, patch, worktreeRoot: repo }).ok).toBe(true);
    expect(verifyTriggerGone({ patched: `import "./rela.mjs";`, patch, worktreeRoot: repo }).ok).toBe(false);
    const missing = { ...patch, evidenceRef: { badPath: "./rela.mjs", matchedPath: "./nope.mjs" } };
    expect(verifyTriggerGone({ patched: `import "./nope.mjs";`, patch: missing, worktreeRoot: repo }))
      .toMatchObject({ ok: false, reason: "replacement-path-missing-on-disk" });
    // Containment: an escaping or absolute matchedPath fails closed instead
    // of letting the verifier stat outside the worktree.
    const escape = { ...patch, evidenceRef: { badPath: "./rela.mjs", matchedPath: "../outside.mjs" } };
    expect(verifyTriggerGone({ patched: `import "../outside.mjs";`, patch: escape, worktreeRoot: repo }))
      .toMatchObject({ ok: false, reason: "replacement-path-escapes-worktree" });
    const absolute = { ...patch, evidenceRef: { badPath: "./rela.mjs", matchedPath: "/etc/passwd" } };
    expect(verifyTriggerGone({ patched: `import "/etc/passwd";`, patch: absolute, worktreeRoot: repo }))
      .toMatchObject({ ok: false, reason: "replacement-path-escapes-worktree" });
  });

  it("wrong-identifier: whole-word semantics", () => {
    const patch = {
      repairClass: REPAIR_CLASS_WRONG_IDENTIFIER,
      evidenceRef: { badIdentifier: "getElementByID", matchedIdentifier: "getElementById" },
    };
    expect(verifyTriggerGone({ patched: GOOD_PATCHED, patch, worktreeRoot: "/x" }).ok).toBe(true);
    // bad identifier inside a longer name does not count as still present…
    expect(verifyTriggerGone({ patched: `const xgetElementByIDy = getElementById(1);`, patch, worktreeRoot: "/x" }).ok).toBe(true);
    expect(verifyTriggerGone({ patched: GOOD_ORIGINAL, patch, worktreeRoot: "/x" }))
      .toMatchObject({ ok: false, reason: "bad-identifier-still-present" });
  });

  it("wrong-config-key: quoted-key semantics", () => {
    const patch = {
      repairClass: REPAIR_CLASS_WRONG_CONFIG_KEY,
      evidenceRef: { badKey: "strictNullCheck", matchedKey: "strictNullChecks" },
    };
    expect(verifyTriggerGone({
      patched: `{ "compilerOptions": { "strictNullChecks": true } }`,
      patch, worktreeRoot: "/x",
    }).ok).toBe(true);
    expect(verifyTriggerGone({
      patched: `{ "compilerOptions": { "strictNullCheck": true } }`,
      patch, worktreeRoot: "/x",
    })).toMatchObject({ ok: false, reason: "bad-config-key-still-present" });
  });

  it("version-pin-drift: locked version pinned, bad version gone", () => {
    const patch = {
      repairClass: REPAIR_CLASS_VERSION_PIN_DRIFT,
      evidenceRef: { package: "left-pad", badVersion: "9.9.9", lockedVersion: "1.3.0" },
    };
    const good = JSON.stringify({ dependencies: { "left-pad": "^1.3.0" } });
    const bad = JSON.stringify({ dependencies: { "left-pad": "^9.9.9" } });
    expect(verifyTriggerGone({ patched: good, patch, worktreeRoot: "/x" }).ok).toBe(true);
    expect(verifyTriggerGone({ patched: bad, patch, worktreeRoot: "/x" }))
      .toMatchObject({ ok: false, reason: "bad-version-still-pinned" });
    expect(verifyTriggerGone({ patched: "not json", patch, worktreeRoot: "/x" }))
      .toMatchObject({ ok: false, reason: "package-json-unparseable" });
  });

  it("rejects unknown classes and missing evidence refs", () => {
    expect(verifyTriggerGone({ patched: "x", patch: { repairClass: "nope" }, worktreeRoot: "/x" }))
      .toMatchObject({ ok: false, reason: "unsupported-repair-class: nope" });
    expect(verifyTriggerGone({
      patched: "x",
      patch: { repairClass: REPAIR_CLASS_WRONG_IDENTIFIER, evidenceRef: {} },
      worktreeRoot: "/x",
    })).toMatchObject({ ok: false, reason: "missing-evidence-ref" });
  });
});

describe("findPairedTest / runPairedTest", () => {
  it("finds the sibling test file and returns null when absent", () => {
    const repo = makeRepo({ "src/app.mjs": "x", "src/app.test.mjs": "y", "src/other.js": "z" });
    expect(findPairedTest(repo, "src/app.mjs")).toBe("src/app.test.mjs");
    expect(findPairedTest(repo, "src/other.js")).toBe(null);
  });

  it("runPairedTest passes through runTestFile outcomes", () => {
    const repo = makeRepo({ "src/app.mjs": "x", "src/app.test.mjs": "y" });
    expect(runPairedTest(repo, "src/app.mjs", { runTestFile: okTest })).toEqual({ status: "passed" });
    expect(runPairedTest(repo, "src/app.mjs", { runTestFile: failingTest }).failed).toBe(true);
    expect(runPairedTest(repo, "src/app.mjs", { runTestFile: timeoutTest })).toEqual({ timedOut: true });
    expect(runPairedTest(repo, "src/missing.mjs", { runTestFile: okTest })).toEqual({ status: "no-paired-test" });
  });
});
