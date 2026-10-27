// Team Brain P2 — Git shadow importer tests, against REAL temporary git
// repositories (not a mocked git implementation) so merge-parent handling
// and history-rewrite detection are validated against actual git
// semantics. "Synthetic local Git" per the brief's P2 scope: synthetic
// content in a real local repo, network never touched.

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { scanSince, headCommit } from "../transport/gitShadowImporter.mjs";
import { TeamBrainTrustError, CODES } from "../transport/errors.mjs";

function sha256Of(text) {
  return createHash("sha256").update(Buffer.from(text)).digest("hex");
}

const createdDirs = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function run(repo, args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), "tb-git-shadow-"));
  createdDirs.push(dir);
  run(dir, ["init", "-q", "-b", "main"]);
  run(dir, ["config", "user.email", "test@example.com"]);
  run(dir, ["config", "user.name", "Test"]);
  return dir;
}

function writeAndCommit(repo, relPath, content, message) {
  const full = join(repo, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  run(repo, ["add", relPath]);
  run(repo, ["commit", "-q", "-m", message]);
  return headCommit(repo);
}

describe("scanSince — linear history", () => {
  it("emits ADDED for a file introduced in the first scanned commit", () => {
    const repo = initRepo();
    writeAndCommit(repo, "README.md", "root", "root");
    const c1 = writeAndCommit(repo, "commands/claude/task1.md", "hello", "add task1");
    const { events, newCursor, truncated } = scanSince(repo, { cursorCommit: null, scopePaths: ["commands/"] });
    expect(truncated).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ introducingCommit: c1, path: "commands/claude/task1.md", eventKind: "ADDED" });
    expect(newCursor).toBe(c1);
  });

  it("only scans commits after the given cursor, not the whole history again", () => {
    const repo = initRepo();
    const c1 = writeAndCommit(repo, "commands/claude/task1.md", "a", "add task1");
    const c2 = writeAndCommit(repo, "commands/claude/task2.md", "b", "add task2");
    const { events } = scanSince(repo, { cursorCommit: c1, scopePaths: ["commands/"] });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ introducingCommit: c2, path: "commands/claude/task2.md", eventKind: "ADDED" });
  });

  it("emits MODIFIED for an edited file, distinct from ADDED", () => {
    const repo = initRepo();
    const c1 = writeAndCommit(repo, "commands/claude/task1.md", "v1", "add");
    const c2 = writeAndCommit(repo, "commands/claude/task1.md", "v2", "edit");
    const { events } = scanSince(repo, { cursorCommit: c1, scopePaths: ["commands/"] });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ introducingCommit: c2, path: "commands/claude/task1.md", eventKind: "MODIFIED" });
  });

  it("emits a DELETED event rather than silently erasing the file's history", () => {
    const repo = initRepo();
    writeAndCommit(repo, "commands/claude/task1.md", "v1", "add");
    run(repo, ["rm", "-q", "commands/claude/task1.md"]);
    run(repo, ["commit", "-q", "-m", "remove"]);
    const c3 = headCommit(repo);
    const { events } = scanSince(repo, { cursorCommit: null, scopePaths: ["commands/"] });
    const kinds = events.filter((e) => e.path === "commands/claude/task1.md").map((e) => e.eventKind);
    expect(kinds).toEqual(["ADDED", "DELETED"]);
    expect(events.find((e) => e.eventKind === "DELETED").introducingCommit).toBe(c3);
  });

  it("scopePaths excludes files outside the scoped prefixes entirely", () => {
    const repo = initRepo();
    writeAndCommit(repo, "README.md", "x", "unrelated");
    writeAndCommit(repo, "commands/claude/task1.md", "y", "in scope");
    const { events } = scanSince(repo, { cursorCommit: null, scopePaths: ["commands/"] });
    expect(events.map((e) => e.path)).toEqual(["commands/claude/task1.md"]);
  });

  it("cursor already at HEAD returns no events and an unchanged cursor", () => {
    const repo = initRepo();
    const c1 = writeAndCommit(repo, "commands/claude/task1.md", "a", "add");
    const result = scanSince(repo, { cursorCommit: c1, scopePaths: ["commands/"] });
    expect(result.events).toHaveLength(0);
    expect(result.newCursor).toBe(c1);
  });
});

describe("scanSince — merge introductions", () => {
  it("records a file introduced only on a side branch, attributed to the commit that actually introduced it (not the merge commit)", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "README.md", "root", "root");
    run(repo, ["checkout", "-q", "-b", "side"]);
    const sideCommit = writeAndCommit(repo, "commands/claude/side-task.md", "side", "add on side branch");
    run(repo, ["checkout", "-q", "main"]);
    writeAndCommit(repo, "README.md", "root v2", "unrelated mainline change");
    run(repo, ["merge", "-q", "--no-ff", "side", "-m", "merge side"]);
    const mergeCommit = headCommit(repo);

    const { events } = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"] });
    const introduced = events.find((e) => e.path === "commands/claude/side-task.md");
    expect(introduced).toBeDefined();
    expect(introduced.eventKind).toBe("ADDED");
    // The critical assertion: attributed to the side-branch commit that
    // actually introduced it, not silently dropped and not misattributed
    // to the merge commit — this is what first-parent flattening would get
    // wrong (a --first-parent walk from mergeCommit never visits sideCommit).
    expect(introduced.introducingCommit).toBe(sideCommit);
    expect(introduced.introducingCommit).not.toBe(mergeCommit);
  });

  it("records a change made directly in the merge commit's own conflict resolution", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "commands/claude/shared.md", "base", "base");
    run(repo, ["checkout", "-q", "-b", "side"]);
    writeAndCommit(repo, "commands/claude/shared.md", "side edit", "side edits shared");
    run(repo, ["checkout", "-q", "main"]);
    writeAndCommit(repo, "commands/claude/shared.md", "main edit", "main edits shared");
    // Real conflict: resolve by writing a merge-commit-specific result.
    try {
      run(repo, ["merge", "--no-ff", "side", "-m", "merge with conflict"]);
    } catch {
      // expected to conflict; resolve manually
    }
    writeFileSync(join(repo, "commands/claude/shared.md"), "resolved by merge");
    run(repo, ["add", "commands/claude/shared.md"]);
    run(repo, ["commit", "-q", "--no-edit"]);
    const mergeCommit = headCommit(repo);

    const { events } = scanSince(repo, { cursorCommit: base, scopePaths: ["commands/"] });
    const atMerge = events.filter((e) => e.path === "commands/claude/shared.md" && e.introducingCommit === mergeCommit);
    expect(atMerge).toHaveLength(1);
    expect(atMerge[0].eventKind).toBe("MODIFIED");
  });
});

describe("scanSince — history rewrite / gap detection", () => {
  it("refuses with INTAKE_BLOCKED when the cursor commit no longer exists at all", () => {
    const repo = initRepo();
    writeAndCommit(repo, "commands/claude/task1.md", "a", "add");
    expect(() => scanSince(repo, { cursorCommit: "0000000000000000000000000000000000beef" })).toThrow(TeamBrainTrustError);
    try {
      scanSince(repo, { cursorCommit: "0000000000000000000000000000000000beef" });
    } catch (e) {
      expect(e.code).toBe(CODES.INTAKE_BLOCKED);
    }
  });

  it("refuses with INTAKE_BLOCKED, never skip-to-tip, when the cursor commit was rewritten away (force-push scenario)", () => {
    const repo = initRepo();
    const base = writeAndCommit(repo, "README.md", "root", "root");
    const oldTip = writeAndCommit(repo, "commands/claude/task1.md", "original", "original line of history");
    // Simulate a force-push: reset to base and commit a DIFFERENT history.
    run(repo, ["reset", "-q", "--hard", base]);
    writeAndCommit(repo, "commands/claude/task2.md", "rewritten", "rewritten line of history");

    expect(() => scanSince(repo, { cursorCommit: oldTip })).toThrow(TeamBrainTrustError);
    try {
      scanSince(repo, { cursorCommit: oldTip });
    } catch (e) {
      expect(e.code).toBe(CODES.INTAKE_BLOCKED);
    }
  });
});

describe("scanSince — quarantine and batch caps", () => {
  it("quarantines an oversized file instead of including it or silently dropping it", () => {
    const repo = initRepo();
    const big = "x".repeat(200);
    writeAndCommit(repo, "commands/claude/big.md", big, "add big file");
    const { events, quarantined } = scanSince(repo, {
      cursorCommit: null,
      scopePaths: ["commands/"],
      maxFileBytes: 50, // force the quarantine path without needing a real 256KiB+ file
    });
    expect(events).toHaveLength(0);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatchObject({ path: "commands/claude/big.md", reason: "FILE_TOO_LARGE" });
  });

  it("quarantines a path exceeding the configured depth instead of including or dropping it", () => {
    const repo = initRepo();
    const deepPath = "commands/" + Array.from({ length: 10 }, (_, i) => `d${i}`).join("/") + "/task.md";
    writeAndCommit(repo, deepPath, "x", "deep file");
    const { events, quarantined } = scanSince(repo, {
      cursorCommit: null,
      scopePaths: ["commands/"],
      maxPathDepth: 5,
    });
    expect(events).toHaveLength(0);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0].reason).toBe("PATH_DEPTH_EXCEEDED");
  });

  it("marks the batch truncated and does NOT advance the cursor when the record cap is hit, so a resume starts from the same point", () => {
    const repo = initRepo();
    const c0 = writeAndCommit(repo, "README.md", "root", "root");
    writeAndCommit(repo, "commands/claude/a.md", "a", "add a");
    writeAndCommit(repo, "commands/claude/b.md", "b", "add b");
    writeAndCommit(repo, "commands/claude/c.md", "c", "add c");
    const { events, truncated, newCursor } = scanSince(repo, {
      cursorCommit: c0,
      scopePaths: ["commands/"],
      maxRecordsPerBatch: 2,
    });
    expect(truncated).toBe(true);
    expect(events.length).toBeLessThanOrEqual(2);
    // Never silently marked caught-up with records missing.
    expect(newCursor).toBe(c0);
  });

  it("truncates on the changed-files-per-poll cap distinctly from the records cap, same non-advancing-cursor contract", () => {
    const repo = initRepo();
    const c0 = writeAndCommit(repo, "README.md", "root", "root");
    writeAndCommit(repo, "commands/claude/a.md", "a", "add a");
    writeAndCommit(repo, "commands/claude/b.md", "b", "add b");
    const { truncated, newCursor } = scanSince(repo, {
      cursorCommit: c0,
      scopePaths: ["commands/"],
      maxChangedFilesPerPoll: 1,
    });
    expect(truncated).toBe(true);
    expect(newCursor).toBe(c0);
  });
});

describe("scanSince — content identity", () => {
  it("content_sha256 is the real sha256 of the file's actual bytes, not a git blob sha", () => {
    const repo = initRepo();
    writeAndCommit(repo, "commands/claude/task1.md", "exact bytes", "add");
    const { events } = scanSince(repo, { cursorCommit: null, scopePaths: ["commands/"] });
    expect(events[0].contentSha256).toBe(sha256Of("exact bytes"));
  });
});
