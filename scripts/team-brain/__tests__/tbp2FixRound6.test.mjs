// Team Brain P2 fix round 6 — ChatGPT NO-GO re-review #5 2026-10-27
// (residuals TBP2-007G, TBP2-007F, TBP2-007H only; TBP2-001, TBP2-005,
// TBP2-003A, TBP2-004A, TBP2-006A.1, TBP2-002C, TBP2-007C ordering,
// TBP2-007D, TBP2-002D and TBP2-007E retention stay closed and are
// not re-litigated here). Every group below is a failing-before /
// passing-after probe at the public boundary: it fails against head
// 6adc29d and passes at the fix-round head. Synthetic fixtures only,
// real local Git repos only, no network, no DB, no production writes.
//
// TBP2-007G: isInParentDiff passed an untrusted filename directly as
// a Git pathspec, and `--` does not make pathspec syntax literal:
// `commands/[x].md` matched `commands/x.md`, so a later-parent
// resume for the bracket file was wrongly called already-handled
// and its MERGE_SELECTED event vanished behind a complete
// watermark. The fix uses a literal pathspec for EVERY filename-based
// membership operation and proves exact returned filename equality
// (not nonempty output) wherever Git returns names.
// TBP2-007F: resuming inside a parent lost cross-page duplicate
// knowledge: membership queries covered only fully-skipped parents,
// not the resume parent's consumed prefix, so a later parent's copy
// of a prefix path was admitted again (200 events for 102 files).
// The fix adds a prefix scan — the candidate is tested against the
// resume parent's first streamPos in-scope entries by counting,
// never by storing — so paginated and unpaginated event multisets
// match exactly.
// TBP2-007H: the dedup query cap returned the same checkpoint
// forever: a candidate needing more than 1,000 skipped-parent checks
// restarted the same first 1,000 checks on every poll. The fix
// checkpoints the query position in frontier v4 (one more bounded
// integer field), so each poll advances the same candidate's checks
// instead of restarting them.

import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSince, headCommit } from "../transport/gitShadowImporter.mjs";
import { TeamBrainTrustError, CODES } from "../transport/errors.mjs";

function expectCode(fn, code) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(TeamBrainTrustError);
    expect(e.code).toBe(code);
    return e;
  }
  throw new Error(`expected TeamBrainTrustError with code ${code}`);
}

// ---------------------------------------------------------------- git --
const createdDirs = [];
afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function run(repo, args, opts = {}) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", ...opts });
}
function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), "tb-fixround6-"));
  createdDirs.push(dir);
  run(dir, ["init", "-q", "-b", "main"]);
  run(dir, ["config", "user.email", "test@example.com"]);
  run(dir, ["config", "user.name", "Test"]);
  return dir;
}
function writeFile(repo, relPath, content) {
  const full = join(repo, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}
// Stages the whole tree (never a bare filename pathspec: a literal
// bracket/asterisk/question-mark filename must not be glob-matched
// by the staging command itself).
function stageAll(repo) {
  run(repo, ["add", "-A"]);
}
function commitTree(repo, tree, parents, message) {
  const args = ["commit-tree", tree];
  for (const p of parents) args.push("-p", p);
  args.push("-m", message);
  return run(repo, args).trim();
}
function hashBlob(repo, content) {
  return execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo, input: content, encoding: "utf8" }).trim();
}
function makeTree(repo, entries) {
  // entries: [[mode, type, sha, path]] for one flat tree level.
  const input = entries.map(([mode, type, sha, path]) => `${mode} ${type} ${sha}\t${path}\n`).join("");
  return execFileSync("git", ["mktree"], { cwd: repo, input, encoding: "utf8" }).trim();
}
function commandsTree(repo, files) {
  // files: [[filename, blobSha]] inside commands/.
  const subtree = makeTree(repo, files.map(([name, sha]) => ["100644", "blob", sha, name]));
  return makeTree(repo, [["040000", "tree", subtree, "commands"]]);
}
function eventKey(e) {
  return `${e.introducingCommit}:${e.path}:${e.eventKind}:${e.selectedParent ?? ""}:${e.selectedBlob ?? ""}`;
}
function multiset(events) {
  return events.map(eventKey).sort();
}
// Drains a scan through every frontier page at the given file
// budget and returns all events in order plus the page sizes.
function drainPages(repo, cursorCommit, fileBudget, extraOpts = {}) {
  const events = [];
  const pageSizes = [];
  let cursor = cursorCommit;
  for (let guard = 0; guard < 50; guard += 1) {
    const page = scanSince(repo, {
      cursorCommit: cursor,
      scopePaths: ["commands/"],
      maxChangedFilesPerPoll: fileBudget,
      maxRecordsPerBatch: 10000,
      ...extraOpts,
    });
    events.push(...page.events);
    pageSizes.push(page.events.length);
    if (!page.truncated) return { events, pageSizes, final: page };
    if (!page.resumeFrontier) throw new Error("truncated page without a frontier");
    cursor = page.resumeFrontier;
  }
  throw new Error("drainPages exceeded its page guard");
}

// ------------------------------------------------------------ TBP2-007G --
// Builds the verdict's exact structure for one literal-path special
// file: seed has x=v0, z=v0, special=vA; P0 is an empty commit on the
// seed (same tree); P1 changes x,z to v1 and special to vB; the merge
// resolves to x=v1, z=v1, special=vA (first parent's special
// version). P0's diff vs the merge changes x and z but not the
// special file; P1's diff vs the merge changes only the special
// file. Returns { repo, seed, p0, p1, merge, specialPath, blobA }.
function buildLiteralFixture(specialName) {
  const repo = initRepo();
  writeFile(repo, "commands/x.md", "v0\n");
  writeFile(repo, "commands/z.md", "v0\n");
  writeFile(repo, `commands/${specialName}`, "vA\n");
  stageAll(repo);
  run(repo, ["commit", "-q", "-m", "seed"]);
  const seed = headCommit(repo);
  run(repo, ["checkout", "-q", "-b", "p0"]);
  run(repo, ["commit", "-q", "--allow-empty", "-m", "p0"]);
  const p0 = headCommit(repo);
  run(repo, ["checkout", "-q", "main"]);
  run(repo, ["checkout", "-q", "-b", "p1"]);
  writeFile(repo, "commands/x.md", "v1\n");
  writeFile(repo, "commands/z.md", "v1\n");
  writeFile(repo, `commands/${specialName}`, "vB\n");
  stageAll(repo);
  run(repo, ["commit", "-q", "-m", "p1"]);
  const p1 = headCommit(repo);
  // Merge p1 into p0 without committing, then resolve the special
  // file back to the first parent's version (vA) and commit.
  run(repo, ["checkout", "-q", "p0"]);
  run(repo, ["merge", "--no-commit", "--no-ff", "p1", "-m", "merge"]);
  writeFile(repo, `commands/${specialName}`, "vA\n");
  stageAll(repo);
  run(repo, ["commit", "-q", "-m", "merge"]);
  const merge = headCommit(repo);
  const blobA = run(repo, ["rev-parse", `${merge}:commands/${specialName}`]).trim();
  return { repo, seed, p0, p1, merge, specialPath: `commands/${specialName}`, blobA };
}

describe("TBP2-007G literal Git paths must not suppress a merge-selection event", () => {
  for (const special of ["[x].md", "*.md", "?.md"]) {
    it(`paginated scan keeps the ${special} MERGE_SELECTED event (unpaginated parity)`, () => {
      const { repo, seed, p0, merge, specialPath, blobA } = buildLiteralFixture(special);
      const full = scanSince(repo, {
        cursorCommit: seed,
        scopePaths: ["commands/"],
        maxChangedFilesPerPoll: 10000,
        maxRecordsPerBatch: 10000,
      });
      expect(full.truncated).toBe(false);
      const { events: paged, pageSizes } = drainPages(repo, seed, 1);
      expect(pageSizes.length).toBeGreaterThan(1);
      expect(multiset(paged)).toEqual(multiset(full.events));
      const mergeSpecial = paged.filter((e) => e.introducingCommit === merge && e.path === specialPath);
      expect(mergeSpecial).toHaveLength(1);
      expect(mergeSpecial[0].eventKind).toBe("MERGE_SELECTED");
      expect(mergeSpecial[0].selectedParent).toBe(p0);
      expect(mergeSpecial[0].selectedBlob).toBe(blobA);
      // The verdict's exact loss shape: without the fix, the paged
      // scan reports caught-up with the special event missing.
      expect(paged.filter((e) => e.path === specialPath && e.introducingCommit === merge)).toHaveLength(1);
    });
  }
});

// ------------------------------------------------------------ TBP2-007F --
// Builds a merge of two empty branch commits (same base tree) that
// adds `count` scoped files differing from both parents.
function buildSpanningMerge(repo, count) {
  writeFile(repo, "commands/base.md", "base\n");
  stageAll(repo);
  run(repo, ["commit", "-q", "-m", "base"]);
  const base = headCommit(repo);
  run(repo, ["checkout", "-q", "-b", "p0"]);
  run(repo, ["commit", "-q", "--allow-empty", "-m", "p0"]);
  const p0 = headCommit(repo);
  run(repo, ["checkout", "-q", "main"]);
  run(repo, ["checkout", "-q", "-b", "p1"]);
  run(repo, ["commit", "-q", "--allow-empty", "-m", "p1"]);
  const p1 = headCommit(repo);
  run(repo, ["checkout", "-q", "p0"]);
  for (let i = 0; i < count; i += 1) {
    writeFile(repo, `commands/${String(i).padStart(3, "0")}.md`, `body ${i}\n`);
  }
  stageAll(repo);
  // A real `git merge` refuses staged-but-uncommitted files, so build
  // the merge commit directly: tree from the staged working tree,
  // parents [p0, p1].
  const tree = run(repo, ["write-tree"]).trim();
  const merge = commitTree(repo, tree, [p0, p1], "merge");
  run(repo, ["update-ref", "refs/heads/main", merge]);
  run(repo, ["checkout", "-q", "main"]);
  return { base, p0, p1, merge };
}

describe("TBP2-007F resume inside a parent must not lose cross-page duplicate knowledge", () => {
  it("a 102-file merge spanning pages emits each path exactly once (paginated == unpaginated)", () => {
    const repo = initRepo();
    const { base, merge } = buildSpanningMerge(repo, 102);
    const full = scanSince(repo, {
      cursorCommit: base,
      scopePaths: ["commands/"],
      maxChangedFilesPerPoll: 10000,
      maxRecordsPerBatch: 10000,
    });
    expect(full.truncated).toBe(false);
    expect(full.events.filter((e) => e.introducingCommit === merge)).toHaveLength(102);
    const { events: paged, pageSizes } = drainPages(repo, base, 100);
    // Fixed shape: 100 from the first parent, then the 2 remaining
    // files — never the verdict's buggy [100, 100, 0] with 98 repeats.
    expect(pageSizes).toEqual([100, 2]);
    expect(multiset(paged)).toEqual(multiset(full.events));
    const byIdentity = new Map();
    for (const e of paged) {
      const k = `${e.introducingCommit}:${e.path}`;
      expect(byIdentity.has(k)).toBe(false);
      byIdentity.set(k, true);
    }
    // Replay determinism: re-running a page from the same frontier
    // yields identical events.
    const first = scanSince(repo, {
      cursorCommit: base,
      scopePaths: ["commands/"],
      maxChangedFilesPerPoll: 100,
      maxRecordsPerBatch: 10000,
    });
    const replay = scanSince(repo, {
      cursorCommit: first.resumeFrontier,
      scopePaths: ["commands/"],
      maxChangedFilesPerPoll: 100,
      maxRecordsPerBatch: 10000,
    });
    const second = scanSince(repo, {
      cursorCommit: first.resumeFrontier,
      scopePaths: ["commands/"],
      maxChangedFilesPerPoll: 100,
      maxRecordsPerBatch: 10000,
    });
    expect(multiset(replay.events)).toEqual(multiset(second.events));
    expect(replay.resumeFrontier).toBe(second.resumeFrontier);
  }, 120000);

  it("100/101-file boundaries and a 3-parent merge keep paginated == unpaginated", () => {
    for (const count of [100, 101]) {
      const repo = initRepo();
      const { base, merge } = buildSpanningMerge(repo, count);
      const full = scanSince(repo, {
        cursorCommit: base,
        scopePaths: ["commands/"],
        maxChangedFilesPerPoll: 10000,
        maxRecordsPerBatch: 10000,
      });
      const { events: paged } = drainPages(repo, base, 100);
      expect(multiset(paged)).toEqual(multiset(full.events));
      expect(paged.filter((e) => e.introducingCommit === merge)).toHaveLength(count);
    }
    // Three parents: the merge adds 102 files differing from all
    // three parents; a resumed page entering the third parent must
    // still not repeat first-parent introductions.
    const repo = initRepo();
    writeFile(repo, "commands/base.md", "base\n");
    stageAll(repo);
    run(repo, ["commit", "-q", "-m", "base"]);
    const base = headCommit(repo);
    const parents = [];
    for (const name of ["p0", "p1", "p2"]) {
      run(repo, ["checkout", "-q", "-b", name]);
      run(repo, ["commit", "-q", "--allow-empty", "-m", name]);
      parents.push(headCommit(repo));
      run(repo, ["checkout", "-q", "main"]);
    }
    run(repo, ["checkout", "-q", "p0"]);
    for (let i = 0; i < 102; i += 1) {
      writeFile(repo, `commands/${String(i).padStart(3, "0")}.md`, `body ${i}\n`);
    }
    stageAll(repo);
    const tree = run(repo, ["write-tree"]).trim();
    const mergeArgs = ["commit-tree", tree];
    for (const p of parents) mergeArgs.push("-p", p);
    mergeArgs.push("-m", "merge");
    const merge = run(repo, mergeArgs).trim();
    run(repo, ["update-ref", "refs/heads/main", merge]);
    run(repo, ["checkout", "-q", "main"]);
    const full = scanSince(repo, {
      cursorCommit: base,
      scopePaths: ["commands/"],
      maxChangedFilesPerPoll: 10000,
      maxRecordsPerBatch: 10000,
    });
    const { events: paged } = drainPages(repo, base, 100);
    expect(multiset(paged)).toEqual(multiset(full.events));
    expect(paged.filter((e) => e.introducingCommit === merge)).toHaveLength(102);
  }, 120000);
});

// ------------------------------------------------------------ TBP2-007H --
// Builds the verdict's exact-cap fixture: a chain of 1,002 parent
// commits (P0..P1000 with tree TA, P1001 with tree TB) and an octopus
// merge M with tree TM, where the merge's only first-page path (y)
// is handled first and the candidate x in the last parent's diff is
// unchanged relative to the first 1,001 parents. Cursor P1001 makes
// M the only pending commit.
function buildQueryCapFixture() {
  const repo = initRepo();
  const blobY0 = hashBlob(repo, "y0\n");
  const blobY1 = hashBlob(repo, "y1\n");
  const blobA = hashBlob(repo, "a\n");
  const blobB = hashBlob(repo, "b\n");
  const treeA = commandsTree(repo, [["y.md", blobY0], ["x.md", blobA]]);
  const treeB = commandsTree(repo, [["y.md", blobY1], ["x.md", blobB]]);
  const treeM = commandsTree(repo, [["y.md", blobY1], ["x.md", blobA]]);
  const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  let prev = commitTree(repo, emptyTree, [], "base");
  const parents = [];
  for (let i = 0; i <= 1000; i += 1) {
    prev = commitTree(repo, treeA, [prev], `p${i}`);
    parents.push(prev);
  }
  prev = commitTree(repo, treeB, [prev], "p1001");
  parents.push(prev);
  const p1001 = prev;
  const mergeArgs = ["commit-tree", treeM];
  for (const p of parents) mergeArgs.push("-p", p);
  mergeArgs.push("-m", "merge");
  const merge = run(repo, mergeArgs).trim();
  run(repo, ["update-ref", "refs/heads/main", merge]);
  return { repo, cursor: p1001, merge, blobA };
}

describe("TBP2-007H the query cap must advance a candidate instead of returning the same checkpoint", () => {
  it("a 1,002-parent merge candidate progresses past the 1,000-query cap across polls", () => {
    const { repo, cursor, merge, blobA } = buildQueryCapFixture();
    const opts = { scopePaths: ["commands/"], maxChangedFilesPerPoll: 1, maxRecordsPerBatch: 10000, pollDeadlineMs: 120000 };
    const page1 = scanSince(repo, { cursorCommit: cursor, ...opts });
    expect(page1.truncated).toBe(true);
    expect(page1.events).toHaveLength(1);
    expect(page1.events[0].path).toBe("commands/y.md");
    expect(typeof page1.resumeFrontier).toBe("string");
    // Page 2 hits the query cap on x (1,001 skipped-parent checks,
    // cap 1,000): no events, but the checkpoint MUST advance — the
    // old code returned page1's frontier verbatim here.
    const page2 = scanSince(repo, { cursorCommit: page1.resumeFrontier, ...opts });
    expect(page2.truncated).toBe(true);
    expect(page2.events).toHaveLength(0);
    expect(typeof page2.resumeFrontier).toBe("string");
    expect(page2.resumeFrontier).not.toBe(page1.resumeFrontier);
    const parts = page2.resumeFrontier.split(":");
    expect(parts[0]).toBe("tb-frontier");
    expect(parts[1]).toBe("v5");
    expect(parts[10]).toBe("1000");
    expect(page2.resumeFrontier.length).toBeLessThanOrEqual(512);
    // Page 3 finishes the checks (parent 1000) and admits x exactly
    // once; the scan completes.
    const page3 = scanSince(repo, { cursorCommit: page2.resumeFrontier, ...opts });
    expect(page3.truncated).toBe(false);
    expect(page3.events).toHaveLength(1);
    expect(page3.events[0].path).toBe("commands/x.md");
    expect(page3.events[0].introducingCommit).toBe(merge);
    expect(page3.events[0].eventKind).toBe("MERGE_SELECTED");
    expect(page3.events[0].selectedBlob).toBe(blobA);
    const allPaths = [page1.events[0].path, ...page3.events.map((e) => e.path)];
    expect(new Set(allPaths).size).toBe(2);
    // Corrupt query positions fail closed, not silently reinterpreted.
    // (Field 10 is the query index in both v4 and v5; v5 appends
    // the query-context fields after it, so the end-anchor replace
    // no longer targets it — rewrite the field, not the suffix.)
    const withField10 = (value) => [...parts.slice(0, 10), value, ...parts.slice(11)].join(":");
    const badFormat = withField10("abc");
    expectCode(() => scanSince(repo, { cursorCommit: badFormat, ...opts }), CODES.INTAKE_BLOCKED);
    const beyondList = withField10("5000");
    expectCode(() => scanSince(repo, { cursorCommit: beyondList, ...opts }), CODES.INTAKE_BLOCKED);
  }, 240000);
});

// ------------------------------------------------------------ frontier v4 --
describe("TBP2-007H frontier v5 replaces v4 with the same size bound", () => {
  it("a legacy v3 frontier is refused, not reinterpreted", () => {
    const repo = initRepo();
    writeFile(repo, "commands/seed.md", "seed\n");
    stageAll(repo);
    run(repo, ["commit", "-q", "-m", "seed"]);
    const seed = headCommit(repo);
    writeFile(repo, "commands/next.md", "next\n");
    stageAll(repo);
    run(repo, ["commit", "-q", "-m", "next"]);
    const head = headCommit(repo);
    const scopeHash = createHash("sha256").update(JSON.stringify(["commands/"]), "utf8").digest("hex");
    const legacy = `tb-frontier:v3:${head}:${scopeHash}:${seed}::::`;
    expectCode(() => scanSince(repo, { cursorCommit: legacy, scopePaths: ["commands/"] }), CODES.INTAKE_BLOCKED);
  });

  it("new frontiers carry the v5 prefix inside the 512-byte bound", () => {
    const repo = initRepo();
    writeFile(repo, "commands/seed.md", "seed\n");
    stageAll(repo);
    run(repo, ["commit", "-q", "-m", "seed"]);
    const seed = headCommit(repo);
    for (let i = 0; i < 102; i += 1) {
      writeFile(repo, `commands/f${String(i).padStart(3, "0")}.md`, `body ${i}\n`);
    }
    stageAll(repo);
    run(repo, ["commit", "-q", "-m", "102 files"]);
    const first = scanSince(repo, {
      cursorCommit: seed,
      scopePaths: ["commands/"],
      maxChangedFilesPerPoll: 100,
      maxRecordsPerBatch: 10000,
    });
    expect(first.truncated).toBe(true);
    expect(first.resumeFrontier.startsWith("tb-frontier:v5:")).toBe(true);
    expect(first.resumeFrontier.length).toBeLessThanOrEqual(512);
  });
});
