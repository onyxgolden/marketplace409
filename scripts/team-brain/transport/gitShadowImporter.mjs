// Team Brain P2 — read-only Git shadow importer: walks reachable commit
// history from a durable per-repo/branch cursor and emits intake events for
// added/modified/deleted files under scoped paths. Shells out to the real
// `git` CLI against a real (synthetic, local-only in P2) repository — not a
// mocked git implementation — so the tricky cases (merge-parent
// introductions, history rewrite) are validated against actual git
// semantics, not a simplified model of them.
//
// Brief §3/§4/§7/§8: "pins each observed main head, walks reachable history
// from a durable cursor and processes per-parent changes in order... Merge
// introductions require inspecting actual merge parents and reachable
// paths, never infer author identity from first-parent flattening. History
// rewrite/gap or unbounded batch => visible INTAKE_BLOCKED, no
// skip-to-tip. Deletion never closes an obligation." Size/path/batch caps
// per §7. Read-only: this module never writes to the scanned repo.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fail, CODES } from "./errors.mjs";

const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"; // git's well-known empty-tree object
const MAX_FILE_BYTES = 256 * 1024;
const MAX_PATH_DEPTH = 32;
const MAX_RECORDS_PER_BATCH = 1000;
const MAX_CHANGED_FILES_PER_POLL = 100;
const MAX_POLL_BYTES = 10 * 1024 * 1024;
// TBP2-007: every git subprocess is bounded in output and wall time.
// A subprocess that times out or overflows its buffer is an intake
// block, not a raw spawn error leaking into the caller — and the cursor
// is preserved because scanSince throws instead of returning a cursor.
const GIT_TIMEOUT_MS = 15000;
const MAX_GIT_TEXT_BYTES = 10 * 1024 * 1024;
// TBP2-007A: a per-Git-command timeout is not a per-poll deadline —
// a poll can run many 15-second commands sequentially and still claim
// to have finished inside the brief's 15-second processing bound.
// scanSince therefore enforces ONE monotonic deadline for the whole
// poll (see POLL_DEADLINE_MS below): every subprocess inside a poll
// is also bounded by the time remaining under that deadline, and the
// poll truncates with its cursor preserved instead of claiming a
// complete advance when the deadline is hit.
export const POLL_DEADLINE_MS = 15000;
// Early enumeration bound: a poll never inspects more commits than
// this in one pass. Beyond it, the scan truncates (cursor preserved)
// instead of materializing an unbounded history before applying its
// record/file counters.
const MAX_COMMITS_PER_POLL = 1000;

function gitSubprocessError(e, what) {
  if (e && (e.code === "ETIMEDOUT" || e.code === "ENOBUFS" || /timed out|ENOBUFS/.test(String(e.message ?? e)))) {
    fail(CODES.INTAKE_BLOCKED, `git subprocess ${what} exceeded its bound (timeout or output cap) — refusing to advance the cursor`, {
      what,
      code: e.code ?? null,
    });
  }
  throw e;
}

// Remaining-time subprocess bound: a call inside a poll may never run
// longer than the time left under the poll deadline (and never longer
// than GIT_TIMEOUT_MS on its own). A call that starts just before the
// deadline and runs long is capped here and surfaces as INTAKE_BLOCKED
// via gitSubprocessError — never as a silent overrun.
//
// TBP2-007B: deadlineMs is a MONOTONIC deadline (performance.now() +
// pollDeadlineMs), not wall-clock time. A backward wall-clock
// adjustment (Date.now moving backwards, or a mocked clock) must not
// extend the allowed poll: performance.now() is unaffected by wall
// clock changes, and wall time is used only for observation timestamps
// (firstObservedAt), never for deadline arithmetic.
function timeoutFor(opts) {
  if (opts.deadlineMs === undefined) return GIT_TIMEOUT_MS;
  return Math.max(1, Math.min(GIT_TIMEOUT_MS, Math.ceil(opts.deadlineMs - performance.now())));
}

// TBP2-007D bounded frontier: a checkpoint string whose size does NOT
// grow with the processed history. Format:
//   tb-frontier:v3:<head>:<scopeHash>:<base>:<accountedCount>:<lastAccounted>:<partialParentIndex>:<partialStreamPos>:<partialCommit>
// - `base` is the original plain cursor (empty when the scan started
//   from the beginning). It MUST be carried: without it, resuming a
//   scan-from-beginning frontier would re-list history before the
//   cursor. The resume range is exactly [head, ^base] — two Git
//   arguments, never one per processed commit.
// - `accountedCount` is the NUMBER of fully processed commits, not
//   their list. Polls process oldest-first in topo order, and topo
//   order is ancestors-before-descendants, so the first N pending
//   commits form a lower set (ancestors-closed within the pending
//   range): resuming at offset N can never skip an unprocessed
//   ancestor. The pending range is fixed by (head, base), so the
//   count maps to the same prefix on every poll — and two O(1)
//   boundary checks prove it: lastAccounted must equal
//   pending[accountedCount - 1], and a partial commit must equal
//   pending[accountedCount]. A mismatch fails closed
//   (INTAKE_BLOCKED), never silently reinterprets.
// - `partial` is an optional partially processed commit: { commit,
//   parentIndex, streamPos }. pathOrder is built parent-major from
//   per-parent diff streams, so a partial is a POSITION in that
//   iteration, not a count of union entries: resume at parent
//   parentIndex, skipping the first streamPos in-scope entries of
//   that parent's stream (counted, never stored), then continue
//   normally. Parents before parentIndex are skipped entirely; a
//   later parent's entry that duplicates one of their paths is
//   detected by a bounded per-path Git membership query (see
//   isInParentDiff), never by retaining the skipped paths.
// - Size invariant, enforced here, not just documented:
//   makeFrontier refuses to emit a frontier longer than
//   MAX_FRONTIER_BYTES (512). The format has eight fixed fields, so
//   any frontier is short regardless of backlog size — a 50,000
//   commit backlog needs ~250 bytes here, where the old v2
//   comma-separated list needed ~2,050,000 bytes and would
//   eventually exceed cursor/storage or OS argument limits.
// - v1 and v2 frontiers are REJECTED, not reinterpreted: v1's
//   "inspected" list was a newest capped window (an upper set), and
//   v2's accounted list cannot be converted to a count-plus-position
//   without re-deriving the partial iteration. No production
//   frontier of either version exists (P2 is unmerged), so rejecting
//   with a restart-from-original-cursor message loses nothing real.
export const MAX_FRONTIER_BYTES = 512;
// TBP2-007E: membership queries against fully-skipped parents are
// bounded per poll, like every other poll resource. A query is one
// small git subprocess per (candidate path, skipped parent); the cap
// keeps a pathological merge (thousands of duplicate diff entries)
// from turning a poll into an unbounded subprocess run. Hitting the
// cap truncates the poll WITH partial progress (the stream position
// of the unresolved entry), never with a block — so progress is
// eventual, not stalled.
export const MAX_DEDUP_QUERIES_PER_POLL = 1000;
function scopeHashFor(scopePaths) {
  return createHash("sha256").update(JSON.stringify(scopePaths ?? []), "utf8").digest("hex");
}

function makeFrontier(head, scopePaths, accountedCount, lastAccounted, partial = null, base = null) {
  const s = [
    "tb-frontier:v3",
    head,
    scopeHashFor(scopePaths),
    base ?? "",
    String(accountedCount),
    lastAccounted ?? "",
    partial ? String(partial.parentIndex) : "",
    partial ? String(partial.streamPos) : "",
    partial ? partial.commit : "",
  ].join(":");
  if (s.length > MAX_FRONTIER_BYTES) {
    fail(CODES.INTAKE_BLOCKED, "resumable frontier exceeds its explicit size bound", {
      frontierBytes: s.length,
      maxFrontierBytes: MAX_FRONTIER_BYTES,
    });
  }
  return s;
}

function parseFrontier(cursorCommit) {
  if (typeof cursorCommit !== "string") return null;
  if (cursorCommit.startsWith("tb-frontier:v1:") || cursorCommit.startsWith("tb-frontier:v2:")) {
    fail(
      CODES.INTAKE_BLOCKED,
      "legacy frontier v1/v2 is not resumable under the bounded count-plus-position accounting — restart from the original cursor",
      { cursorCommit }
    );
  }
  if (!cursorCommit.startsWith("tb-frontier:v3:")) return null;
  const parts = cursorCommit.split(":");
  if (parts.length !== 10 || parts[0] !== "tb-frontier" || parts[1] !== "v3") {
    fail(CODES.INTAKE_BLOCKED, "malformed resumable frontier cursor", { cursorCommit });
  }
  const [, , head, scopeHash, base, countStr, lastAccounted, parentIndexStr, streamPosStr, partialCommit] = parts;
  if (!/^[0-9a-f]{40}$/.test(head) || !/^[0-9a-f]{64}$/.test(scopeHash)) {
    fail(CODES.INTAKE_BLOCKED, "malformed resumable frontier cursor", { cursorCommit });
  }
  if (base !== "" && !/^[0-9a-f]{40}$/.test(base)) {
    fail(CODES.INTAKE_BLOCKED, "malformed resumable frontier cursor", { cursorCommit });
  }
  if (!/^[0-9]+$/.test(countStr)) {
    fail(CODES.INTAKE_BLOCKED, "malformed resumable frontier cursor (accounted count must be a non-negative integer)", {
      cursorCommit,
    });
  }
  const accountedCount = Number(countStr);
  if (!Number.isSafeInteger(accountedCount) || accountedCount < 0) {
    fail(CODES.INTAKE_BLOCKED, "malformed resumable frontier cursor (accounted count must be a non-negative integer)", {
      cursorCommit,
    });
  }
  if (lastAccounted !== "" && !/^[0-9a-f]{40}$/.test(lastAccounted)) {
    fail(CODES.INTAKE_BLOCKED, "malformed resumable frontier cursor", { cursorCommit });
  }
  if ((accountedCount === 0) !== (lastAccounted === "")) {
    fail(
      CODES.INTAKE_BLOCKED,
      "malformed resumable frontier cursor (a positive accounted count requires a last-accounted commit, and vice versa)",
      { cursorCommit }
    );
  }
  const partialPresent = partialCommit !== "" || parentIndexStr !== "" || streamPosStr !== "";
  let partial = null;
  if (partialPresent) {
    if (partialCommit === "" || parentIndexStr === "" || streamPosStr === "") {
      fail(
        CODES.INTAKE_BLOCKED,
        "malformed resumable frontier cursor (partial commit, parent index, and stream position must all be present or all absent)",
        { cursorCommit }
      );
    }
    if (!/^[0-9a-f]{40}$/.test(partialCommit) || !/^[0-9]+$/.test(parentIndexStr) || !/^[0-9]+$/.test(streamPosStr)) {
      fail(CODES.INTAKE_BLOCKED, "malformed resumable frontier cursor", { cursorCommit });
    }
    const parentIndex = Number(parentIndexStr);
    const streamPos = Number(streamPosStr);
    if (!Number.isSafeInteger(parentIndex) || parentIndex < 0 || !Number.isSafeInteger(streamPos) || streamPos < 0) {
      fail(CODES.INTAKE_BLOCKED, "malformed resumable frontier cursor (partial position must be non-negative integers)", {
        cursorCommit,
      });
    }
    partial = { commit: partialCommit, parentIndex, streamPos };
  }
  return { head, scopeHash, base: base === "" ? null : base, accountedCount, lastAccounted: lastAccounted === "" ? null : lastAccounted, partial };
}

function git(repoPath, args, opts = {}) {
  const { deadlineMs, ...rest } = opts;
  try {
    return execFileSync("git", args, {
      cwd: repoPath,
      encoding: "utf8",
      timeout: timeoutFor(opts),
      maxBuffer: opts.maxBuffer ?? MAX_GIT_TEXT_BYTES,
      ...rest,
    });
  } catch (e) {
    gitSubprocessError(e, args.join(" "));
  }
}

function gitBuffer(repoPath, args, maxBuffer = 1024 * 1024, opts = {}) {
  try {
    return execFileSync("git", args, { cwd: repoPath, timeout: timeoutFor(opts), maxBuffer });
  } catch (e) {
    gitSubprocessError(e, args.join(" "));
  }
}

export function headCommit(repoPath, ref = "HEAD", opts = {}) {
  return git(repoPath, ["rev-parse", ref], opts).trim();
}

export function commitExists(repoPath, sha, opts = {}) {
  try {
    // stdio: a failed existence check is an expected, handled outcome here
    // (not a real error) — stderr is suppressed so it doesn't read as a
    // broken call when it's doing exactly what it's for.
    git(repoPath, ["cat-file", "-e", `${sha}^{commit}`], { stdio: ["ignore", "ignore", "ignore"], ...opts });
    return true;
  } catch {
    return false;
  }
}

function isAncestor(repoPath, ancestor, descendant, opts = {}) {
  try {
    git(repoPath, ["merge-base", "--is-ancestor", ancestor, descendant], { stdio: ["ignore", "ignore", "ignore"], ...opts });
    return true;
  } catch (e) {
    if (e.status === 1) return false;
    throw e;
  }
}

function parentsOf(repoPath, sha, opts = {}) {
  const out = git(repoPath, ["rev-list", "--parents", "-n", "1", sha], opts).trim();
  const parts = out.split(/\s+/);
  return parts.slice(1); // parts[0] is the commit itself
}

function commitTimestamp(repoPath, sha, opts = {}) {
  return git(repoPath, ["show", "-s", "--format=%cI", sha], opts).trim(); // committer date, ISO 8601
}

function pathDepth(path) {
  return path.split("/").filter(Boolean).length;
}

// name-status diff between two trees (a parent commit, or the empty tree
// for a root commit's "first parent") and a commit, restricted to
// `scopePaths` prefixes if given. Yields [status, path] tuples, status
// one of A (added), M (modified), D (deleted), lazily.
//
// TBP2-005: this uses `-z` (NUL-delimited) output and literal path
// handling end to end. The old line/tab parsing dropped any path Git
// quoted — non-ASCII, tab, or newline filenames — because the quoted
// form's leading quote failed the scope-prefix test and the file
// vanished while the cursor still advanced. With -z, Git emits raw
// bytes, no quoting, and a path is either in scope (admitted or
// quarantined) or out of scope — never silently lost inside scope.
//
// TBP2-007C: this is a GENERATOR, not an array. The old diffNameStatus
// split the whole diff into a parts array and stored every scoped
// record before any cap was applied, so a later pathOrder cap did not
// undo that admission. Here the output string is scanned by index
// (never split) and records are yielded one at a time; the caller
// stops pulling at budget + one lookahead, so records after the stop
// are never even scanned. The raw subprocess string itself is bounded
// by the 10 MiB subprocess cap and is not candidate storage —
// candidate storage is exactly the caller's capped pathOrder.
function* diffNameStatusIter(repoPath, fromRef, toRef, scopePaths, opts = {}) {
  const args = ["diff", "--name-status", "-z", "--no-renames", fromRef, toRef];
  let out;
  try {
    out = git(repoPath, args, opts);
  } catch (e) {
    if (e instanceof Error && e.name === "TeamBrainTrustError") throw e;
    fail(CODES.MALFORMED_ENVELOPE, `git diff failed between ${fromRef} and ${toRef}`, { error: String(e) });
  }
  // -z records are: status NUL path NUL status NUL path NUL ... (no
  // trailing newline semantics, no quoting, no tab separator).
  let i = 0;
  while (i < out.length) {
    const statusEnd = out.indexOf("\0", i);
    if (statusEnd === -1) break;
    const status = out.slice(i, statusEnd);
    const pathEnd = out.indexOf("\0", statusEnd + 1);
    if (pathEnd === -1) break;
    const path = out.slice(statusEnd + 1, pathEnd);
    i = pathEnd + 1;
    if (!status || path === "") continue;
    if (scopePaths && scopePaths.length > 0 && !scopePaths.some((p) => path.startsWith(p))) continue;
    yield [status[0], path];
  }
}

// TBP2-007E: exact membership test for cross-parent dedup on resume.
// When a poll resumes inside a later parent, earlier parents are
// skipped entirely (their streams are not re-iterated), so a candidate
// path from a later parent's diff cannot be checked against an
// in-memory set — there is none. Instead, membership in an earlier
// parent's diff is tested by git itself: `git diff --name-only -z`
// between that parent and the commit, restricted to this path, emits
// the path (plus NUL) iff the path differs between the two trees.
// One small subprocess per (candidate, skipped parent); the caller
// bounds the total per poll (MAX_DEDUP_QUERIES_PER_POLL). The -z
// form is used so an unusual path can never be misread from quoted
// output; a path that differs is a duplicate of already-handled work
// (the earlier parent's occurrence was already collected or skipped
// in a previous poll), never a new candidate.
function isInParentDiff(repoPath, parentRef, commit, path, opts = {}) {
  const out = git(repoPath, ["diff", "--name-only", "-z", "--no-renames", parentRef, commit, "--", path], opts);
  return out.length > 0;
}

// TBP2-007C bounded producer: the oldest-first capped window of pending
// commits, with an exact hasMore flag.
//
// Git applies --max-count BEFORE --reverse, so `rev-list --topo-order
// --reverse --max-count N` returns the NEWEST N commits in reverse
// order — not the oldest prefix — and treating that window as fully
// accounted loses every older commit (the TBP2-007C bug). Git offers
// no oldest-window primitive, so this producer counts the pending
// range first (rev-list --count), then asks for the oldest window by
// skipping the newest (total - take) commits and taking the rest,
// then reversing the window in JS to oldest-first. The returned list
// is a lower set (ancestors-closed within pending): every pending
// ancestor of a listed commit is itself listed or already accounted.
// Honest tradeoff, stated not hidden: the internal walk is O(pending)
// and deadline-bounded (a timeout throws INTAKE_BLOCKED with the
// cursor preserved); what is bounded at the command is the OUTPUT
// and ADMISSION — at most `cap` commits are ever returned — not the
// walk. The incorrect alternative (newest window) is not used.
//
// TBP2-007D: on a frontier resume the window starts at
// accountedCount, not at zero, and the Git argument set is bounded:
// exactly [head] plus [^base] when a base cursor exists — never one
// ^<sha> argument per processed commit. The pending range is fixed
// by (head, base), so the count maps to the same prefix on every
// poll; the boundary check below proves it (lastAccounted must be
// the commit just before the window, else INTAKE_BLOCKED).
function listPendingCommits(repoPath, { head, accountedCount, lastAccounted, cursorCommit, base }, cap, opts = {}) {
  let rangeArgs;
  if (accountedCount !== null) {
    // Frontier resume: the range is the whole pending range, and the
    // window offset IS the accounted count. No per-commit exclusions.
    rangeArgs = [head, ...(base ? [`^${base}`] : [])];
  } else if (cursorCommit) {
    rangeArgs = [`${cursorCommit}..${head}`];
  } else {
    rangeArgs = [head];
  }
  let countOut;
  try {
    countOut = git(repoPath, ["rev-list", "--count", ...rangeArgs], opts);
  } catch (e) {
    if (e instanceof Error && e.name === "TeamBrainTrustError") throw e;
    fail(CODES.INTAKE_BLOCKED, "could not count pending commits for the bounded producer", { error: String(e) });
  }
  const total = Number.parseInt(countOut.trim(), 10);
  if (!Number.isFinite(total) || total < 0) {
    fail(CODES.INTAKE_BLOCKED, "git rev-list --count returned a non-numeric count", { countOut });
  }
  if (accountedCount !== null) {
    if (accountedCount > total) {
      fail(CODES.INTAKE_BLOCKED, "resumable frontier accounted count exceeds the pending history (repository changed or corrupt frontier)", {
        accountedCount,
        total,
      });
    }
    const remaining = total - accountedCount;
    const hasMore = remaining > cap;
    const take = Math.min(remaining, cap);
    if (take === 0) return { commits: [], hasMore: false };
    // When a boundary commit exists, list one extra (the commit just
    // before the window) and prove it is lastAccounted. A topo-order
    // shift or a corrupt count would move the window onto different
    // commits; this check fails closed instead of silently
    // reinterpreting the count.
    const listTake = accountedCount > 0 ? take + 1 : take;
    const skip = total - (accountedCount + take);
    let listOut;
    try {
      listOut = git(repoPath, ["rev-list", "--topo-order", "--skip", String(skip), "--max-count", String(listTake), ...rangeArgs], opts);
    } catch (e) {
      if (e instanceof Error && e.name === "TeamBrainTrustError") throw e;
      fail(CODES.INTAKE_BLOCKED, "could not list the oldest pending commits for the bounded producer", { error: String(e) });
    }
    const newestFirst = listOut.trim() ? listOut.trim().split("\n") : [];
    if (newestFirst.length !== listTake) {
      fail(CODES.INTAKE_BLOCKED, "bounded producer returned an inconsistent commit count (repository changed during the poll)", {
        expected: listTake,
        actual: newestFirst.length,
      });
    }
    const oldestFirst = newestFirst.reverse();
    if (accountedCount > 0) {
      if (oldestFirst[0] !== lastAccounted) {
        fail(CODES.INTAKE_BLOCKED, "resumable frontier accounted boundary does not match the pending history (repository changed or corrupt frontier)", {
          expectedBoundary: lastAccounted,
          actualBoundary: oldestFirst[0],
        });
      }
      return { commits: oldestFirst.slice(1), hasMore };
    }
    return { commits: oldestFirst, hasMore };
  }
  if (total === 0) return { commits: [], hasMore: false };
  const hasMore = total > cap;
  const take = Math.min(total, cap);
  const skip = total - take;
  let listOut;
  try {
    listOut = git(repoPath, ["rev-list", "--topo-order", "--skip", String(skip), "--max-count", String(take), ...rangeArgs], opts);
  } catch (e) {
    if (e instanceof Error && e.name === "TeamBrainTrustError") throw e;
    fail(CODES.INTAKE_BLOCKED, "could not list the oldest pending commits for the bounded producer", { error: String(e) });
  }
  const newestFirst = listOut.trim() ? listOut.trim().split("\n") : [];
  if (newestFirst.length !== take) {
    fail(CODES.INTAKE_BLOCKED, "bounded producer returned an inconsistent commit count (repository changed during the poll)", {
      expected: take,
      actual: newestFirst.length,
    });
  }
  return { commits: newestFirst.reverse(), hasMore };
}

// TBP2-007C bounded per-commit path collection, TBP2-007E resume
// retention: the deterministic pathOrder for one commit (union of its
// parents' in-scope diff paths, in parent order, deduplicated),
// resuming at a stream position (for a partially processed commit)
// and collecting at most `budget` paths.
//
// `resume` is null for a fresh commit, or { parentIndex, streamPos }:
// iteration starts at that parent's stream, skipping the first
// streamPos in-scope entries BY COUNTING — skipped entries are
// never stored, never queried, never added to seen or to any status
// map. Parents before parentIndex are skipped entirely. A later
// parent's entry that duplicates one of those skipped parents' paths
// is detected by a bounded per-path Git membership query
// (isInParentDiff, charged against the poll-wide queryState), not by
// retaining the skipped paths.
//
// Storage bound, stated plainly and now true on resume too: stored
// records are exactly the returned pathOrder (at most `budget`
// paths) plus the per-parent status of those same paths. Duplicates
// — seen-dups and query-dups alike — are never stored: a duplicate's
// status is never read (for a single-parent commit there are no
// cross-parent duplicates at all; for merges the event kind is
// decided from blob SHAs, not diff status, so a missing
// later-parent status is never read). Consumption stops at budget +
// ONE documented lookahead record: when a further distinct path is
// found after the budget is full, hasMore is set, incompleteResume
// points AT that lookahead entry, and the record itself is
// DISCARDED, not stored — so no record beyond the budget is ever
// retained. `origins` parallels pathOrder with each entry's
// (parentIndex, streamIndex), so the caller can resume exactly after
// any handled prefix. If the dedup query cap is hit, collection
// stops with queryCapHit and incompleteResume pointing AT the
// unresolved entry, so the next poll re-examines it with a fresh
// query budget — progress, not a stall.
function collectCommitPaths(repoPath, parentRefs, commit, scopePaths, resume, budget, opts = {}, queryState = null) {
  const statusByParent = parentRefs.map(() => new Map());
  const pathOrder = [];
  const origins = [];
  const seen = new Set();
  const startParent = resume ? resume.parentIndex : 0;
  const skippedParents = parentRefs.slice(0, startParent);
  let hasMore = false;
  let incompleteResume = null;
  let queryCapHit = false;
  // Corrupt-frontier guard: a resume streamPos past the end of its
  // parent's stream would silently skip unhandled paths. Skipped
  // entries can never trigger a budget/query-cap break (they collect
  // nothing and query nothing), so a break during the resume parent
  // always happens at or past the resume position; only a fully
  // iterated resume parent shorter than streamPos is corrupt.
  let resumeParentTotal = null;
  const isDupOfSkippedParent = (path) => {
    for (const skipped of skippedParents) {
      if (queryState !== null && queryState.count >= MAX_DEDUP_QUERIES_PER_POLL) return "CAP";
      if (queryState !== null) queryState.count += 1;
      if (isInParentDiff(repoPath, skipped, commit, path, opts)) return true;
    }
    return false;
  };
  outer: for (let parentIndex = startParent; parentIndex < parentRefs.length; parentIndex++) {
    const parent = parentRefs[parentIndex];
    let streamIndex = 0;
    const skipFirst = parentIndex === startParent && resume ? resume.streamPos : 0;
    for (const [status, path] of diffNameStatusIter(repoPath, parent, commit, scopePaths, opts)) {
      const thisIndex = streamIndex;
      streamIndex += 1;
      if (thisIndex < skipFirst) continue; // skipped by count: stored nowhere
      if (seen.has(path)) continue; // duplicate within this poll: status never read
      if (skippedParents.length > 0) {
        const dup = isDupOfSkippedParent(path);
        if (dup === "CAP") {
          queryCapHit = true;
          incompleteResume = { parentIndex, streamPos: thisIndex };
          break outer;
        }
        if (dup) continue; // duplicate of a fully-skipped parent: stored nowhere
      }
      if (pathOrder.length >= budget) {
        hasMore = true;
        incompleteResume = { parentIndex, streamPos: thisIndex };
        break outer; // lookahead record discarded, not stored
      }
      seen.add(path);
      statusByParent[parentIndex].set(path, status);
      pathOrder.push(path);
      origins.push({ parentIndex, streamIndex: thisIndex });
    }
    if (parentIndex === startParent && resume) resumeParentTotal = streamIndex;
  }
  if (resume && resumeParentTotal !== null && resumeParentTotal < resume.streamPos) {
    fail(CODES.INTAKE_BLOCKED, "resumable frontier stream position is past the end of its parent's diff (corrupt frontier)", {
      commit,
      parentIndex: resume.parentIndex,
      streamPos: resume.streamPos,
      parentStreamLength: resumeParentTotal,
    });
  }
  return { pathOrder, statusByParent, hasMore, origins, incompleteResume, queryCapHit };
}

// TBP2-006A.1: does a parent commit's history ever contain `path`?
// A null parent (path absent at that parent) is ambiguous on its own:
// it may never have had the path (clean introduction visibility —
// silent), or it may have deleted it (an explicit keep-versus-delete
// decision — MERGE_SELECTED). The distinguishing evidence is ancestry:
// rev-list over that parent's history, limited to one commit, lists a
// commit touching the path only if the path was introduced and then
// deleted along that parent's line (if it were still present, the
// parent would not be null). Bounded at the Git command itself.
function pathEverInParentHistory(repoPath, parentSha, path, opts = {}) {
  if (!parentSha || parentSha === EMPTY_TREE_SHA) return false;
  const out = git(repoPath, ["rev-list", "--max-count", "1", parentSha, "--", path], opts).trim();
  return out.length > 0;
}

function blobShaAt(repoPath, commitSha, path, opts = {}) {
  const out = git(repoPath, ["ls-tree", commitSha, "--", path], opts).trim();
  if (!out) return null; // path doesn't exist at this commit (e.g. it was deleted)
  // format: "<mode> blob <sha>\t<path>" — only the mode+sha prefix is
  // parsed, so a quoted or unusual path in the tail cannot confuse it.
  const match = out.match(/^\d+ blob ([0-9a-f]{40})\t/);
  return match ? match[1] : null;
}

// TBP2-007: object size WITHOUT reading content. `git cat-file -s`
// returns the byte count from the object header only, so an oversized
// blob can be quarantined before a single content byte is buffered.
function blobSizeAt(repoPath, blobSha, opts = {}) {
  try {
    const out = git(repoPath, ["cat-file", "-s", blobSha], opts).trim();
    const size = Number.parseInt(out, 10);
    return Number.isFinite(size) ? size : null;
  } catch (e) {
    // A bounded subprocess failure (timeout / output cap) is an
    // explicit INTAKE_BLOCKED, not a silent null — swallowing it here
    // would turn a deadline overrun into a misleading "could not
    // determine size" error downstream. Non-Trust errors (a genuinely
    // missing object) still return null so the caller can block with
    // its own precise message.
    if (e && e.name === "TeamBrainTrustError") throw e;
    return null;
  }
}

function readBlob(repoPath, blobSha, maxBuffer, opts = {}) {
  return gitBuffer(repoPath, ["cat-file", "-p", blobSha], maxBuffer, opts);
}

function sha256OfBuffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// Walks every commit reachable from `headRef` but not from `cursorCommit`,
// in topological (ancestors-before-descendants) order, and emits one
// intake event per changed path per commit — deduplicated per
// (commit, path) across however many parents a merge commit has, since the
// brief wants the fact that a path changed recorded once per introducing
// commit, with every parent actually inspected, not just unioned blindly
// without dedup noise.
//
// Event kinds: ADDED / MODIFIED / DELETED as before, plus
// MERGE_SELECTED (TBP2-006A): a merge that resolves divergent parent
// content to one parent's blob. MERGE_SELECTED is provenance, not a new
// obligation — a consumer must never mint a duplicate ADDED obligation
// from it; it exists so the scanned stream's last content for a path
// matches the pinned head.
//
// Returns { events, newCursor, quarantined, truncated, resumeFrontier } — never throws for
// ordinary quarantine-worthy conditions (oversized file, excessive path
// depth); those files are reported in `quarantined`, not silently included
// or silently dropped. Throws TeamBrainTrustError(INTAKE_BLOCKED) only for
// conditions where silent progress would be actively wrong: the cursor
// commit no longer exists/isn't an ancestor of HEAD (history rewrite), or
// HEAD doesn't exist.
//
// TBP2-007A deadline: the whole poll is bounded by ONE deadline
// (pollDeadlineMs, default POLL_DEADLINE_MS). Every subprocess inside
// the poll is bounded by the remaining time, and every loop step checks
// the deadline before doing more work. Hitting the deadline sets
// truncated: true and preserves the cursor — it never claims a
// complete advance for a partially scanned history.
export function scanSince(
  repoPath,
  {
    cursorCommit,
    headRef = "HEAD",
    scopePaths = [],
    maxFileBytes = MAX_FILE_BYTES,
    maxPathDepth = MAX_PATH_DEPTH,
    maxRecordsPerBatch = MAX_RECORDS_PER_BATCH,
    maxChangedFilesPerPoll = MAX_CHANGED_FILES_PER_POLL,
    maxPollBytes = MAX_POLL_BYTES,
    pollDeadlineMs = POLL_DEADLINE_MS,
  } = {}
) {
  // TBP2-007B: one monotonic deadline for the whole poll.
  const deadlineAt = performance.now() + pollDeadlineMs;
  const gitOpts = () => ({ deadlineMs: deadlineAt });
  const expired = () => performance.now() >= deadlineAt;
  const head = headCommit(repoPath, headRef, gitOpts());

  const frontier = parseFrontier(cursorCommit);
  if (frontier) {
    // A frontier is bound to its pinned head and scope. Resuming it
    // against a moved head or a different scope is refused, not
    // reinterpreted: the checkpoint's accounting only holds for the
    // head/scope it was built under.
    if (frontier.head !== head) {
      fail(CODES.INTAKE_BLOCKED, "resumable frontier is bound to a different pinned head — refusing to resume it", {
        frontierHead: frontier.head,
        head,
      });
    }
    if (frontier.scopeHash !== scopeHashFor(scopePaths)) {
      fail(CODES.INTAKE_BLOCKED, "resumable frontier is bound to a different scope — refusing to resume it", {
        scopePaths,
      });
    }
  } else if (cursorCommit) {
    if (!commitExists(repoPath, cursorCommit, gitOpts())) {
      fail(CODES.INTAKE_BLOCKED, "cursor commit does not exist in this repository (history rewrite or wrong repo)", {
        cursorCommit,
      });
    }
    if (!isAncestor(repoPath, cursorCommit, head, gitOpts())) {
      fail(CODES.INTAKE_BLOCKED, "cursor commit is no longer an ancestor of HEAD (history rewrite) — refusing to skip-to-tip", {
        cursorCommit,
        head,
      });
    }
  }

  if (!frontier && cursorCommit === head) {
    return { events: [], newCursor: head, quarantined: [], truncated: false, resumeFrontier: null };
  }

  // TBP2-007C: the bounded producer (listPendingCommits) returns the
  // oldest-first capped window of pending commits, with an exact
  // hasMore flag — never the newest window, never a sliced full
  // enumeration. TBP2-007D: on a frontier resume the window starts at
  // the frontier's accounted COUNT within the fixed (head, base)
  // range — the Git argument set is [head, ^base], never one ^<sha>
  // per processed commit — and the boundary commit just before the
  // window must equal the frontier's lastAccounted, or the poll
  // fails closed instead of silently reinterpreting the count.
  // The frontier's base cursor, carried forward across resumes: it is
  // the original plain cursor for a frontier chain, or the plain
  // cursor for a first poll, or null when scanning from the beginning.
  const resumeBase = frontier ? frontier.base : (cursorCommit ?? null);
  const { commits, hasMore: commitCapHit } = listPendingCommits(
    repoPath,
    {
      head,
      accountedCount: frontier ? frontier.accountedCount : null,
      lastAccounted: frontier ? frontier.lastAccounted : null,
      cursorCommit: frontier ? null : cursorCommit,
      base: resumeBase,
    },
    MAX_COMMITS_PER_POLL,
    gitOpts()
  );
  // TBP2-007D: a frontier partial must name the window's first commit.
  // The partial commit is always the first unaccounted commit (every
  // earlier pending commit is fully processed), so a frontier whose
  // partial names anything else is corrupt or from a changed history
  // — fail closed, never resume into the wrong commit.
  if (frontier?.partial) {
    if (commits.length === 0 || commits[0] !== frontier.partial.commit) {
      fail(CODES.INTAKE_BLOCKED, "resumable frontier partial commit is not the first unaccounted commit (repository changed or corrupt frontier)", {
        partialCommit: frontier.partial.commit,
        windowFirst: commits[0] ?? null,
      });
    }
  }
  // TBP2-007E: dedup membership queries are charged poll-wide, so a
  // pathological merge cannot turn one poll into an unbounded
  // subprocess run. The counter is shared by every collectCommitPaths
  // call in this poll; hitting the cap truncates with partial
  // progress (see incompleteResume), never with a block.
  const queryState = { count: 0 };

  const events = [];
  const quarantined = [];
  let truncated = false;
  let totalBytes = 0;
  let changedFileCount = 0;
  // Commits fully processed by the loop below, in order. A commit is
  // only appended here when its iteration completes without breaking
  // out (deadline, record cap, file cap, or byte cap) — so this list
  // is exactly the prefix a frontier may advance past.
  const processedCommits = [];
  // TBP2-007C: the input frontier's partial commit, carried forward
  // until that commit is fully processed (then cleared) or replaced by
  // a newer partial created by this poll. Carrying it is safe: a
  // partial commit is the first unaccounted commit, so it stays at
  // the head of the next poll's pending window, and its
  // already-consumed stream position is skipped again on resume.
  // TBP2-007D/E: the partial is a stream position (parentIndex,
  // streamPos), not a union count or a path list — bounded, and it
  // never retains skipped paths.
  let currentPartial = frontier?.partial ?? null;

  outer: for (const commit of commits) {
    if (expired()) {
      truncated = true;
      break outer;
    }
    if (events.length >= maxRecordsPerBatch || changedFileCount >= maxChangedFilesPerPoll) {
      truncated = true;
      break outer;
    }
    const parents = parentsOf(repoPath, commit, gitOpts());
    const parentRefs = parents.length > 0 ? parents : [EMPTY_TREE_SHA];

    // TBP2-007C: the per-commit path list is built by the bounded
    // collector, never by materializing per-parent diff arrays. A
    // merge's diff against each parent is still inspected (that is
    // what finds side-branch introductions), but the union is decided
    // once per path below — never once per parent — and at most
    // `remainingFileBudget` paths are stored, plus one discarded
    // lookahead record that only sets hasMore. If this commit is the
    // carried partial, collection starts at its stream position, so
    // already-handled paths are skipped by counting, not re-emitted
    // — and never stored. TBP2-007E: a partial parent index past
    // the last parent is corrupt (it would silently complete the
    // commit), so it fails closed here.
    const resumeArg = currentPartial && currentPartial.commit === commit ? currentPartial : null;
    if (resumeArg && resumeArg.parentIndex >= parentRefs.length) {
      fail(CODES.INTAKE_BLOCKED, "resumable frontier partial parent index is past the commit's last parent (corrupt frontier)", {
        commit,
        parentIndex: resumeArg.parentIndex,
        parentCount: parentRefs.length,
      });
    }
    const remainingFileBudget = maxChangedFilesPerPoll - changedFileCount;
    const {
      pathOrder,
      statusByParent,
      origins,
      incompleteResume,
    } = collectCommitPaths(repoPath, parentRefs, commit, scopePaths, resumeArg, remainingFileBudget, gitOpts(), queryState);
    // Paths handled for this commit in this poll (events emitted or
    // quarantined, in pathOrder order). A path that breaks the loop
    // (deadline, record cap, file cap, byte cap) is NOT counted, so
    // the next poll retries it; every other path is counted, including
    // quarantined and merge-visibility paths, so the partial prefix
    // always advances past handled paths.
    let processedInCommit = 0;
    let brokeMidCommit = false;

    for (const path of pathOrder) {
      // Per-parent status for this path, from the bounded collector's
      // status maps (complete for single-parent commits; unused for
      // merges, where blob SHAs decide the event kind).
      const statusForParent = (parentIndex) => statusByParent[parentIndex].get(path);
      if (expired()) {
        truncated = true;
        brokeMidCommit = true;
        break;
      }
      if (events.length >= maxRecordsPerBatch) {
        truncated = true;
        brokeMidCommit = true;
        break;
      }
      changedFileCount += 1;
      if (changedFileCount > maxChangedFilesPerPoll) {
        truncated = true;
        brokeMidCommit = true;
        break;
      }
      if (pathDepth(path) > maxPathDepth) {
        quarantined.push({ commit, path, reason: "PATH_DEPTH_EXCEEDED" });
        processedInCommit += 1;
        continue;
      }

      // TBP2-006 / TBP2-006A: distinguish actual introduction from
      // merge visibility and from merge selection. For a non-merge
      // commit, the single parent's diff status is the event kind, as
      // before. For a merge, a path whose resulting blob already
      // exists in a parent is not a new introduction — it was
      // introduced by the parent-side commit that already emitted it.
      // But when the parents hold DIVERGENT content (two distinct
      // non-null blobs) and the merge resolves to one parent's blob,
      // that choice is evidence: emit MERGE_SELECTED with the chosen
      // blob, so the stream's last content for the path matches the
      // pinned head instead of silently implying the other branch's
      // observation is current. A single-parent-content merge (clean
      // introduction visibility, one parent lacking the path) stays
      // silent, as before. Only a merge result that differs from
      // every parent is a genuine merge-resolution change (MODIFIED,
      // or ADDED if no parent had the path at all); a merge result
      // that deletes a path a parent had is DELETED. No second ADDED
      // candidate is ever minted for one unchanged request, and
      // MERGE_SELECTED never mints a new obligation.
      const parentBlobs = parentRefs.map((parent) => blobShaAt(repoPath, parent, path, gitOpts()));
      const commitBlob = blobShaAt(repoPath, commit, path, gitOpts());
      let eventKind;
      if (parentRefs.length <= 1) {
        const status = statusForParent(0);
        eventKind = status === "A" ? "ADDED" : status === "D" ? "DELETED" : "MODIFIED";
      } else if (commitBlob === null) {
        if (!parentBlobs.some((b) => b !== null)) {
          processedInCommit += 1;
          continue; // absent everywhere: no change to record, but the path is handled
        }
        eventKind = "DELETED";
      } else if (parentBlobs.includes(commitBlob)) {
        const distinctParentBlobs = [...new Set(parentBlobs.filter((b) => b !== null))];
        // TBP2-006A.1: null-versus-present is a divergent parent
        // state only when the null parent's history actually
        // contained the path (it deleted it) — parents [blob, null]
        // resolved to blob is then an explicit keep-versus-delete
        // decision (the kept file would otherwise be lost behind an
        // earlier DELETED event), just as parents [blobA, blobB]
        // resolved to blobA is. A null parent whose history never
        // contained the path is clean introduction visibility: the
        // side branch introduced the file, the other parent simply
        // never had it, and the merge emits nothing for it. Only
        // parents that all agree (one distinct non-null blob, no
        // null parent, or a null parent with no path history) are
        // silent visibility.
        if (distinctParentBlobs.length >= 2) {
          eventKind = "MERGE_SELECTED";
        } else if (
          parentBlobs.includes(null) &&
          distinctParentBlobs.length === 1 &&
          parentRefs.some((parent, i) => parentBlobs[i] === null && pathEverInParentHistory(repoPath, parent, path, gitOpts()))
        ) {
          eventKind = "MERGE_SELECTED";
        } else {
          processedInCommit += 1;
          continue; // merge visibility only — already introduced elsewhere, but the path is handled
        }
      } else if (parentBlobs.some((b) => b !== null)) {
        eventKind = "MODIFIED";
      } else {
        eventKind = "ADDED";
      }

      let contentSha256 = null;
      let byteLength = null;
      if (eventKind !== "DELETED") {
        if (commitBlob === null) {
          // The diff says the file is present, but it cannot be found
          // at the commit. Silently dropping it would be exactly the
          // loss this module must not do — block instead.
          fail(CODES.INTAKE_BLOCKED, "changed path has no blob at its commit; refusing to skip it", { commit, path });
        }
        // TBP2-007: size and mode are validated BEFORE any content
        // byte is read. An oversized blob is quarantined on its size
        // alone, and a poll-byte overflow truncates before reading —
        // neither case ever buffers the blob.
        if (expired()) {
          truncated = true;
          brokeMidCommit = true;
          break;
        }
        const size = blobSizeAt(repoPath, commitBlob, gitOpts());
        if (size === null) {
          fail(CODES.INTAKE_BLOCKED, "could not determine blob size before reading; refusing to read unbounded content", {
            commit,
            path,
          });
        }
        if (size > maxFileBytes) {
          quarantined.push({ commit, path, reason: "FILE_TOO_LARGE", byteLength: size });
          processedInCommit += 1;
          continue;
        }
        if (totalBytes + size > maxPollBytes) {
          truncated = true;
          brokeMidCommit = true;
          break;
        }
        const content = readBlob(repoPath, commitBlob, maxFileBytes + 64 * 1024, gitOpts());
        byteLength = content.length;
        totalBytes += byteLength;
        contentSha256 = sha256OfBuffer(content);
      }

      // TBP2-006A.1 provenance: a MERGE_SELECTED record must carry
      // explicit selected-parent/blob/original-source fields, not
      // just the generic introducing-commit fields. selectedParent /
      // selectedParents are the parent commits whose blob equals the
      // chosen blob; originalSourceCommit is the parent commit that
      // supplied the chosen content (the merge-level source binding —
      // not a claim about which earlier commit first introduced the
      // content). MERGE_SELECTED remains provenance, never a new
      // obligation.
      const mergeProvenance =
        eventKind === "MERGE_SELECTED"
          ? {
              selectedParents: parentRefs.filter((_, i) => parentBlobs[i] === commitBlob),
              selectedParent: parentRefs.find((_, i) => parentBlobs[i] === commitBlob) ?? null,
              selectedBlob: commitBlob,
              originalSourceCommit: parentRefs.find((_, i) => parentBlobs[i] === commitBlob) ?? null,
            }
          : {};
      events.push({
        introducingCommit: commit,
        path,
        eventKind,
        contentSha256,
        byteLength,
        sourceTimestamp: commitTimestamp(repoPath, commit, gitOpts()),
        firstObservedAt: new Date().toISOString(),
        ...mergeProvenance,
      });
      processedInCommit += 1;
    }
    // TBP2-007C partial-commit accounting. A poll either fully
    // processes a commit, partially processes it with recorded partial
    // state, or does not start it — never silently advances past
    // unprocessed paths, and never reports a commit as done when its
    // paths are still pending. TBP2-007E: the partial state is a
    // stream position, not a retained path prefix. When the scan
    // breaks mid-pathOrder, resume just past the last handled
    // entry's stream position; when collection itself stopped early
    // (budget lookahead or dedup query cap) and every collected path
    // was handled, resume AT the unresolved entry. A break with zero
    // paths handled leaves any carried partial untouched, and the
    // commit stays pending.
    if (brokeMidCommit) {
      if (processedInCommit > 0) {
        const last = origins[processedInCommit - 1];
        currentPartial = { commit, parentIndex: last.parentIndex, streamPos: last.streamIndex + 1 };
      }
      truncated = true;
      break outer;
    }
    if (incompleteResume) {
      // All collected paths were handled, but collection stopped
      // early: either the lookahead proved further distinct paths
      // exist beyond the budget, or the dedup query cap left an
      // entry unresolved. Either way the next poll resumes inside
      // this commit, at that entry — not after it.
      currentPartial = { commit, ...incompleteResume };
      truncated = true;
      break outer;
    }
    processedCommits.push(commit);
    if (currentPartial && currentPartial.commit === commit) currentPartial = null;
  }

  // Deletion never closes an obligation — this module only records the
  // event; it is the caller's (ledger/handoff layer's) job to decide what a
  // DELETED event means for an obligation's state. Never erase a prior
  // ADDED/MODIFIED event because a later DELETED event exists for the same
  // path; both are explicit, both are kept.

  // TBP2-007C: a frontier is returned on ANY truncation — commit cap,
  // file/record/byte cap, deadline, dedup query cap, or a partial
  // commit — because the frontier now carries exact progress: the
  // COUNT of fully processed commits (a lower set, oldest-first)
  // plus the boundary commit and any partial commit with its stream
  // position. Resuming from it advances past exactly the accounted
  // work and resumes inside the partial commit, so no truncation
  // mode can stall at the same cursor forever. A frontier is never
  // returned when nothing truncated: then every pending commit was
  // fully processed and the cursor advances to HEAD.
  let resumeFrontier = null;
  if (commitCapHit && !truncated) {
    // The producer's window was exhausted without any other
    // truncation: more history exists beyond the cap, so this poll is
    // truncated by the commit cap even though every listed commit was
    // fully processed.
    truncated = true;
  }
  if (truncated) {
    const accountedCount = (frontier ? frontier.accountedCount : 0) + processedCommits.length;
    const lastAccounted =
      processedCommits.length > 0 ? processedCommits[processedCommits.length - 1] : (frontier ? frontier.lastAccounted : null);
    resumeFrontier = makeFrontier(head, scopePaths, accountedCount, lastAccounted, currentPartial, resumeBase);
  }

  return {
    events,
    // Cursor only advances to HEAD when nothing was truncated — a
    // truncated batch must be resumed from the SAME cursor on the
    // next poll (caller re-runs with more budget or narrower scope),
    // never silently marked caught-up with records missing. The
    // resumable path is resumeFrontier: passing it as cursorCommit on
    // the next poll resumes past the fully processed prefix (and
    // inside any partial commit) and eventually reaches the tail;
    // passing newCursor repeats the same prefix safely but without
    // progress.
    newCursor: truncated ? cursorCommit ?? null : head,
    quarantined,
    truncated,
    resumeFrontier,
  };
}
