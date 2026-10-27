// Team Brain P2 fix round 7 — ChatGPT NO-GO re-review #6 2026-10-27
// (residual TBP2-007H.1 only; TBP2-001, TBP2-005, TBP2-003A,
// TBP2-004A, TBP2-006A.1, TBP2-002C, TBP2-007C ordering,
// TBP2-007D, TBP2-002D, TBP2-007E retention, TBP2-007G, TBP2-007F
// and TBP2-007H originals stay closed and are not re-litigated
// here). Every group below is a failing-before / passing-after
// probe at the public boundary except where explicitly marked a
// format guard: it fails against head 770d2de and passes at the
// fix-round head. Synthetic fixtures only, real local Git repos
// only, no network, no DB, no production writes.
//
// TBP2-007H.1: a saved queryIndex is an ordinal into a
// context-dependent check list (built from the invocation's resume
// parent + consumed prefix and skipped parents). When a
// query-capped partial moves the resume parent to the candidate's
// parent, the next poll rebuilt a DIFFERENT list — the old resume
// parent became a plain membership check, the old prefix check
// vanished — so the same ordinal skipped a check that never ran
// and a three-parent merge emitted its MERGE_SELECTED twice
// (1002 events for 1001 paths). The fix stores the check list's
// identity with the position: frontier v5 carries queryParent /
// queryStreamPos (the resume context that DEFINED the list), the
// partial candidate's checks are rebuilt from that stored context,
// and a re-CAP on the same candidate carries the same context
// forward with an advanced queryIndex.

import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
  const dir = mkdtempSync(join(tmpdir(), "tb-fixround7-"));
  createdDirs.push(dir);
  run(dir, ["init", "-q", "-b", "main"]);
  run(dir, ["config", "user.email", "test@example.com"]);
  run(dir, ["config", "user.name", "Test"]);
  return dir;
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
  const input = entries.map(([mode, type, sha, path]) => `${mode} ${type} ${sha}\t${path}\n`).join("");
  return execFileSync("git", ["mktree"], { cwd: repo, input, encoding: "utf8" }).trim();
}
function commandsTree(repo, files) {
  const subtree = makeTree(repo, files.map(([name, sha]) => ["100644", "blob", sha, name]));
  return makeTree(repo, [["040000", "tree", subtree, "commands"]]);
}
function eventKey(e) {
  return `${e.introducingCommit}:${e.path}:${e.eventKind}:${e.selectedParent ?? ""}:${e.selectedBlob ?? ""}`;
}
function multiset(events) {
  return events.map(eventKey).sort();
}
function dFiles(repo, blob, count) {
  const out = [];
  for (let i = 0; i < count; i += 1) out.push([`d${String(i).padStart(3, "0")}.md`, blob]);
  return out;
}
function scopeHash() {
  return createHash("sha256").update(JSON.stringify(["commands/"]), "utf8").digest("hex");
}
// Drains a scan through every frontier page at the given file
// budget, returning all events, page sizes, and every frontier
// handed to a subsequent poll.
function drainPages(repo, cursorCommit, fileBudget, extraOpts = {}) {
  const events = [];
  const pageSizes = [];
  const frontiers = [];
  let cursor = cursorCommit;
  for (let guard = 0; guard < 60; guard += 1) {
    const page = scanSince(repo, {
      cursorCommit: cursor,
      scopePaths: ["commands/"],
      maxChangedFilesPerPoll: fileBudget,
      maxRecordsPerBatch: 10000,
      pollDeadlineMs: 120000,
      ...extraOpts,
    });
    events.push(...page.events);
    pageSizes.push(page.events.length);
    if (!page.truncated) return { events, pageSizes, frontiers, final: page };
    if (!page.resumeFrontier) throw new Error("truncated page without a frontier");
    frontiers.push(page.resumeFrontier);
    cursor = page.resumeFrontier;
  }
  throw new Error("drainPages exceeded its page guard");
}

// ------------------------------------------------- verdict 3-parent -----
// The verdict's exact structure: parents form an ancestry chain
// (P0 <- P1 <- P2), the merge lists all three, cursor P2 makes the
// merge the only pending commit. P0 differs from the merge at the
// d-files and ztarget; P1 differs at a, b and the d-files; P2
// differs only at ztarget. Scoped paths: a, b, dCount d-files,
// ztarget = dCount + 3 distinct paths.
function buildVerdictFixture(dCount) {
  const repo = initRepo();
  const A = hashBlob(repo, "a\n");
  const Ap = hashBlob(repo, "a-prime\n");
  const B = hashBlob(repo, "b\n");
  const Bp = hashBlob(repo, "b-prime\n");
  const D = hashBlob(repo, "d\n");
  const Dp = hashBlob(repo, "d-prime\n");
  const Z = hashBlob(repo, "z\n");
  const Zp = hashBlob(repo, "z-prime\n");
  const dMerge = dFiles(repo, D, dCount);
  const dParent = dFiles(repo, Dp, dCount);
  const treeM = commandsTree(repo, [["a.md", A], ["b.md", B], ...dMerge, ["ztarget.md", Z]]);
  const treeP0 = commandsTree(repo, [["a.md", A], ["b.md", B], ...dParent, ["ztarget.md", Zp]]);
  const treeP1 = commandsTree(repo, [["a.md", Ap], ["b.md", Bp], ...dParent, ["ztarget.md", Z]]);
  const treeP2 = commandsTree(repo, [["a.md", A], ["b.md", B], ...dMerge, ["ztarget.md", Zp]]);
  const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  const base = commitTree(repo, emptyTree, [], "base");
  const p0 = commitTree(repo, treeP0, [base], "p0");
  const p1 = commitTree(repo, treeP1, [p0], "p1");
  const p2 = commitTree(repo, treeP2, [p1], "p2");
  const merge = commitTree(repo, treeM, [p0, p1, p2], "merge");
  run(repo, ["update-ref", "refs/heads/main", merge]);
  return { repo, cursor: p2, merge, p0, p1, p2, blobZ: Z };
}

describe("TBP2-007H.1 a saved query index must resume against the same check list", () => {
  it("the verdict three-parent case emits ztarget once (paginated == unpaginated)", () => {
    const { repo, cursor, merge, p1, blobZ } = buildVerdictFixture(998);
    const full = scanSince(repo, {
      cursorCommit: cursor,
      scopePaths: ["commands/"],
      maxChangedFilesPerPoll: 10000,
      maxRecordsPerBatch: 10000,
      pollDeadlineMs: 120000,
    });
    expect(full.truncated).toBe(false);
    expect(full.events.filter((e) => e.introducingCommit === merge)).toHaveLength(1001);
    const { events: paged, pageSizes, frontiers } = drainPages(repo, cursor, 100);
    // Verdict's poll shape, fixed: 10 pages of 100, then b, then
    // a completing page with no events — never the buggy 1002nd
    // event (a second ztarget) on the final page.
    expect(pageSizes).toEqual([...Array(10).fill(100), 1, 0]);
    expect(multiset(paged)).toEqual(multiset(full.events));
    expect(paged.filter((e) => e.introducingCommit === merge)).toHaveLength(1001);
    const targets = paged.filter((e) => e.introducingCommit === merge && e.path === "commands/ztarget.md");
    expect(targets).toHaveLength(1);
    expect(targets[0].eventKind).toBe("MERGE_SELECTED");
    expect(targets[0].selectedParent).toBe(p1);
    expect(targets[0].selectedBlob).toBe(blobZ);
    // The query-capped frontier that the verdict's trace names:
    // parent 2, stream 0, query index 1 — and now, crucially, the
    // stored check context (resume parent 1, consumed prefix 1)
    // that gives that index its meaning.
    const capped = frontiers.find((f) => {
      const parts = f.split(":");
      return parts[7] === "2" && parts[8] === "0" && parts[10] === "1";
    });
    expect(capped).toBeDefined();
    const parts = capped.split(":");
    expect(parts[0]).toBe("tb-frontier");
    expect(parts[1]).toBe("v5");
    expect(parts[11]).toBe("1");
    expect(parts[12]).toBe("1");
    expect(capped.length).toBeLessThanOrEqual(512);
  }, 240000);

  it("CAP before the prefix check still carries its context (999 d-files)", () => {
    // Same shape with one more d-file: the resume poll consumes
    // its whole 1,000-query budget on earlier candidates, so the
    // target candidate's prefix check itself CAPs with zero checks
    // completed. A zero query index must still carry its context:
    // without it, a later resume could silently reinterpret the
    // position. (Format guard: this passes behaviorally at the old
    // head too, since a zero index skips nothing; what it guards
    // is that v5 always writes the context, even at zero.)
    const { repo, cursor, merge } = buildVerdictFixture(999);
    const full = scanSince(repo, {
      cursorCommit: cursor,
      scopePaths: ["commands/"],
      maxChangedFilesPerPoll: 10000,
      maxRecordsPerBatch: 10000,
      pollDeadlineMs: 120000,
    });
    expect(full.truncated).toBe(false);
    expect(full.events.filter((e) => e.introducingCommit === merge)).toHaveLength(1002);
    const { events: paged, frontiers } = drainPages(repo, cursor, 100);
    expect(multiset(paged)).toEqual(multiset(full.events));
    expect(paged.filter((e) => e.introducingCommit === merge && e.path === "commands/ztarget.md")).toHaveLength(1);
    const zeroCapped = frontiers.find((f) => {
      const parts = f.split(":");
      return parts[10] === "0" && parts[11] !== "" && parts[12] !== "";
    });
    expect(zeroCapped).toBeDefined();
    expect(zeroCapped.startsWith("tb-frontier:v5:")).toBe(true);
    expect(zeroCapped.length).toBeLessThanOrEqual(512);
  }, 240000);
});

// ------------------------------------------------- 4-parent "after" -----
// The CAP-after-a-parent-check partner: a four-parent merge whose
// target candidate's check list is [prefix(P2), membership(P0),
// membership(P1)], with the query budget arranged so CAP lands
// after membership(P0) completes (query index 2) and before
// membership(P1) — the one check that would catch the duplicate.
// Diffs (merge M: d=D, e=E0, a=A, b=B, c=C0, x=X, y=Y, ztarget=Z):
//   P0 differs at the 998 d-files only.
//   P1 differs at the 498 e-files, x, y, ztarget.
//   P2 differs at a, b, c.md and the 498 e-files.
//   P3 differs only at ztarget.
// Poll 0 (fresh, budget 998): the 998 d-files; lookahead P1 e000
//   -> partial (1, 0), no query context.
// Poll 1 (resume (1, 0), budget 503): P1's 501 entries + P2's a, b;
//   lookahead P2 c.md -> partial (2, 2), no query context. (c.md
//   is the lookahead precisely because P1 does NOT differ at it:
//   the e-files P1 shares with P2 are seen-skipped in poll 1 and
//   could never be its lookahead.)
// Poll 2 (resume (2, 2)): P2's c.md admitted (2 queries) + the 498
//   e-files as 2-query dups (membership(P0) false, membership(P1)
//   true) = 998 queries, then P3's ztarget: prefix(P2, 2) false
//   (query 999), membership(P0) false (query 1000), CAP before
//   membership(P1) -> partial (3, 0, query 2, context (2, 2)).
// Poll 3 (fixed): the stored context rebuilds
//   [prefix(P2, 2), membership(P0), membership(P1)], skips the
//   first two, runs membership(P1) — true — and the duplicate
//   ztarget is skipped. Under the old code the rebuilt list was
//   [membership(P0), membership(P1), membership(P2)] and index 2
//   skipped membership(P1), admitting the duplicate ztarget.
function eFiles(repo, blob, count) {
  const out = [];
  for (let i = 0; i < count; i += 1) out.push([`e${String(i).padStart(3, "0")}.md`, blob]);
  return out;
}
function buildAfterFixture() {
  const repo = initRepo();
  const D = hashBlob(repo, "d\n");
  const Dp = hashBlob(repo, "d-prime\n");
  const E0 = hashBlob(repo, "e\n");
  const E1 = hashBlob(repo, "e-prime\n");
  const A = hashBlob(repo, "a\n");
  const Ap = hashBlob(repo, "a-prime\n");
  const B = hashBlob(repo, "b\n");
  const Bp = hashBlob(repo, "b-prime\n");
  const C0 = hashBlob(repo, "c\n");
  const C1 = hashBlob(repo, "c-prime\n");
  const X = hashBlob(repo, "x\n");
  const Xp = hashBlob(repo, "x-prime\n");
  const Y = hashBlob(repo, "y\n");
  const Yp = hashBlob(repo, "y-prime\n");
  const Z = hashBlob(repo, "z\n");
  const Zp = hashBlob(repo, "z-prime\n");
  const dMerge = dFiles(repo, D, 998);
  const dParent = dFiles(repo, Dp, 998);
  const eMerge = eFiles(repo, E0, 498);
  const eParent = eFiles(repo, E1, 498);
  const treeM = commandsTree(repo, [["a.md", A], ["b.md", B], ["c.md", C0], ...dMerge, ...eMerge, ["x.md", X], ["y.md", Y], ["ztarget.md", Z]]);
  const treeP0 = commandsTree(repo, [["a.md", A], ["b.md", B], ["c.md", C0], ...dParent, ...eMerge, ["x.md", X], ["y.md", Y], ["ztarget.md", Z]]);
  const treeP1 = commandsTree(repo, [["a.md", A], ["b.md", B], ["c.md", C0], ...dMerge, ...eParent, ["x.md", Xp], ["y.md", Yp], ["ztarget.md", Zp]]);
  const treeP2 = commandsTree(repo, [["a.md", Ap], ["b.md", Bp], ["c.md", C1], ...dMerge, ...eParent, ["x.md", X], ["y.md", Y], ["ztarget.md", Z]]);
  const treeP3 = commandsTree(repo, [["a.md", A], ["b.md", B], ["c.md", C0], ...dMerge, ...eMerge, ["x.md", X], ["y.md", Y], ["ztarget.md", Zp]]);
  const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  const base = commitTree(repo, emptyTree, [], "base");
  const p0 = commitTree(repo, treeP0, [base], "p0");
  const p1 = commitTree(repo, treeP1, [p0], "p1");
  const p2 = commitTree(repo, treeP2, [p1], "p2");
  const p3 = commitTree(repo, treeP3, [p2], "p3");
  const merge = commitTree(repo, treeM, [p0, p1, p2, p3], "merge");
  run(repo, ["update-ref", "refs/heads/main", merge]);
  return { repo, cursor: p3, merge, p0, p1, p2, p3, blobZ: Z };
}

describe("TBP2-007H.1 CAP after a parent check must not skip the next check", () => {
  it("a four-parent target resumes past the 1,000-query cap with its context intact", () => {
    const { repo, cursor, merge, p0, blobZ } = buildAfterFixture();
    const opts = { scopePaths: ["commands/"], maxRecordsPerBatch: 10000, pollDeadlineMs: 120000 };
    // Poll 0 (fresh, budget 998): all 998 d-files; the lookahead
    // is P1's e000, so the partial sits at parent 1, stream 0,
    // with no query progress yet.
    const page0 = scanSince(repo, { cursorCommit: cursor, maxChangedFilesPerPoll: 998, ...opts });
    expect(page0.truncated).toBe(true);
    expect(page0.events).toHaveLength(998);
    const partial0 = page0.resumeFrontier.split(":");
    expect(partial0[7]).toBe("1");
    expect(partial0[8]).toBe("0");
    expect(partial0[10]).toBe("0");
    expect(partial0[11]).toBe("");
    expect(partial0[12]).toBe("");
    // Poll 1 (resume (1, 0), budget 503): P1's 501 entries + P2's
    // a, b; the lookahead is P2's c.md, so the partial sits at
    // parent 2, stream 2, with no query progress yet.
    const page1 = scanSince(repo, { cursorCommit: page0.resumeFrontier, maxChangedFilesPerPoll: 503, ...opts });
    expect(page1.truncated).toBe(true);
    expect(page1.events).toHaveLength(503);
    const partial1 = page1.resumeFrontier.split(":");
    expect(partial1[7]).toBe("2");
    expect(partial1[8]).toBe("2");
    expect(partial1[10]).toBe("0");
    expect(partial1[11]).toBe("");
    expect(partial1[12]).toBe("");
    // Poll 2: P2's c.md admitted (2 queries) + the 498 e-files
    // as 2-query dups (996 queries), then P3's ztarget: prefix
    // check (query 999, false), membership(P0) (query 1000,
    // false), CAP before membership(P1) with query index 2 and
    // the stored context (resume parent 2, consumed prefix 2).
    const page2 = scanSince(repo, { cursorCommit: page1.resumeFrontier, maxChangedFilesPerPoll: 100, ...opts });
    expect(page2.truncated).toBe(true);
    expect(page2.events).toHaveLength(1);
    expect(page2.events[0].path).toBe("commands/c.md");
    const parts = page2.resumeFrontier.split(":");
    expect(parts[0]).toBe("tb-frontier");
    expect(parts[1]).toBe("v5");
    expect(parts[7]).toBe("3");
    expect(parts[8]).toBe("0");
    expect(parts[10]).toBe("2");
    expect(parts[11]).toBe("2");
    expect(parts[12]).toBe("2");
    expect(page2.resumeFrontier.length).toBeLessThanOrEqual(512);
    // Corrupt query contexts fail closed, not silently reinterpreted.
    const withField = (index, value) => [...parts.slice(0, index), value, ...parts.slice(index + 1)].join(":");
    expectCode(() => scanSince(repo, { cursorCommit: withField(11, "99"), maxChangedFilesPerPoll: 100, ...opts }), CODES.INTAKE_BLOCKED);
    expectCode(() => scanSince(repo, { cursorCommit: withField(10, "5000"), maxChangedFilesPerPoll: 100, ...opts }), CODES.INTAKE_BLOCKED);
    // Poll 3 (fixed): the stored context rebuilds
    // [prefix(P2, 2), membership(P0), membership(P1)], skips the
    // first two, runs membership(P1) — true — and the duplicate
    // ztarget is skipped. Under the old code the rebuilt list was
    // [membership(P0), membership(P1), membership(P2)] and index 2
    // skipped membership(P1), admitting the duplicate.
    const page3 = scanSince(repo, { cursorCommit: page2.resumeFrontier, maxChangedFilesPerPoll: 100, ...opts });
    expect(page3.truncated).toBe(false);
    expect(page3.events).toHaveLength(0);
    const all = [...page0.events, ...page1.events, ...page2.events, ...page3.events];
    expect(all).toHaveLength(1502);
    const targets = all.filter((e) => e.introducingCommit === merge && e.path === "commands/ztarget.md");
    expect(targets).toHaveLength(1);
    expect(targets[0].eventKind).toBe("MERGE_SELECTED");
    expect(targets[0].selectedParent).toBe(p0);
    expect(targets[0].selectedBlob).toBe(blobZ);
    const full = scanSince(repo, { cursorCommit: cursor, maxChangedFilesPerPoll: 10000, ...opts });
    expect(full.truncated).toBe(false);
    expect(multiset(all)).toEqual(multiset(full.events));
  }, 240000);
});

// ------------------------------------------------------------ frontier v5 --
describe("TBP2-007H.1 frontier v5 replaces v4 with the same size bound", () => {
  it("a legacy v4 frontier is refused, not reinterpreted", () => {
    const { repo, merge } = buildVerdictFixture(1);
    const head = headCommit(repo);
    expect(head).toBe(merge);
    const legacy = ["tb-frontier", "v4", head, scopeHash(), "", "", "", "", "", "", ""].join(":");
    expectCode(() => scanSince(repo, { cursorCommit: legacy, scopePaths: ["commands/"] }), CODES.INTAKE_BLOCKED);
  });

  it("a nonzero query position without its context is refused", () => {
    const { repo, merge } = buildVerdictFixture(1);
    const head = headCommit(repo);
    expect(head).toBe(merge);
    // Well-formed v5 shape: accounted 0, a complete partial
    // position (parent 0, stream 0, the merge commit) with a
    // nonzero query index — but empty query-context fields.
    const bad = ["tb-frontier", "v5", head, scopeHash(), "", "0", "", "0", "0", merge, "5", "", ""].join(":");
    expectCode(() => scanSince(repo, { cursorCommit: bad, scopePaths: ["commands/"] }), CODES.INTAKE_BLOCKED);
  });
});
