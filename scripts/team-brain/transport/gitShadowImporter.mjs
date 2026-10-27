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

// TBP2-007B resumable frontier: a checkpoint string returned when a
// poll truncates ONLY because the commit cap was hit after fully
// processing its inspected prefix. Format:
//   tb-frontier:v1:<pinnedHead>:<scopeHash>:<inspectedSha1,...>
// The inspected list is the exact set of commits fully processed in
// order (plus any earlier frontier's list on resume). A frontier is
// bound to its pinned head and scope: resuming it against a different
// head or scope is refused with INTAKE_BLOCKED, never silently
// reinterpreted, because unvisited parallel-parent history would
// otherwise be unaccounted for. Old callers that keep using newCursor
// (the preserved original cursor) are safe but do not progress past
// the cap; new callers must pass resumeFrontier as cursorCommit to
// resume.
function scopeHashFor(scopePaths) {
  return createHash("sha256").update(JSON.stringify(scopePaths ?? []), "utf8").digest("hex");
}

// TBP2-007C frontier v2: `tb-frontier:v2:<head>:<scopeHash>:<base>:<accountedCsv>:<partialCommit>:<partialConsumed>`
// - `base` is the original plain cursor (empty when the scan started
//   from the beginning). It MUST be carried: the accounted list alone
//   does not exclude the cursor's history. A frontier with no fully
//   processed commit yet (a pure partial, accounted empty) resumed
//   via ^accounted alone would re-list the cursor commit itself and
//   everything before it. Resuming excludes ^base AND ^accounted.
// - `accounted` is the set of commits FULLY processed, in order. It is a
//   lower set (ancestors-closed) within the pending range: polls process
//   oldest-first, so every pending ancestor of an accounted commit is
//   itself accounted. Resuming via ^<accounted> is therefore safe —
//   excluding an accounted commit's ancestors excludes only commits
//   already accounted (or covered by the base cursor).
// - `partial` is an optional partially processed commit: { commit,
//   consumed } where consumed is the number of that commit's
//   deterministic pathOrder entries already handled (events emitted
//   or quarantined, in pathOrder order). The next poll recomputes the
//   same pathOrder and skips exactly that prefix.
// - A v1 frontier is REJECTED, not reinterpreted: v1's "inspected" list
//   was a newest capped window (an upper set), so its ancestors were
//   still pending and ^-exclusion would lose them. No production v1
//   frontier exists (P2 is unmerged), so rejecting with a
//   restart-from-original-cursor message loses nothing real.
function makeFrontier(head, scopePaths, accounted, partial = null, base = null) {
  const partialCommit = partial ? partial.commit : "";
  const partialConsumed = partial ? String(partial.consumed) : "";
  return `tb-frontier:v2:${head}:${scopeHashFor(scopePaths)}:${base ?? ""}:${accounted.join(",")}:${partialCommit}:${partialConsumed}`;
}

function parseFrontier(cursorCommit) {
  if (typeof cursorCommit !== "string") return null;
  if (cursorCommit.startsWith("tb-frontier:v1:")) {
    fail(
      CODES.INTAKE_BLOCKED,
      "legacy frontier v1 is not resumable under the corrected lower-set accounting — restart from the original cursor",
      { cursorCommit }
    );
  }
  if (!cursorCommit.startsWith("tb-frontier:v2:")) return null;
  const rest = cursorCommit.slice("tb-frontier:v2:".length);
  const parts = rest.split(":");
  if (parts.length !== 6) {
    fail(CODES.INTAKE_BLOCKED, "malformed resumable frontier cursor", { cursorCommit });
  }
  const [head, scopeHash, base, csv, partialCommit, partialConsumed] = parts;
  if (!/^[0-9a-f]{40}$/.test(head) || !/^[0-9a-f]{64}$/.test(scopeHash)) {
    fail(CODES.INTAKE_BLOCKED, "malformed resumable frontier cursor", { cursorCommit });
  }
  if (base !== "" && !/^[0-9a-f]{40}$/.test(base)) {
    fail(CODES.INTAKE_BLOCKED, "malformed resumable frontier cursor", { cursorCommit });
  }
  const accounted = csv ? csv.split(",") : [];
  if (accounted.some((s) => !/^[0-9a-f]{40}$/.test(s))) {
    fail(CODES.INTAKE_BLOCKED, "malformed resumable frontier cursor", { cursorCommit });
  }
  if ((partialCommit === "") !== (partialConsumed === "")) {
    fail(
      CODES.INTAKE_BLOCKED,
      "malformed resumable frontier cursor (partial commit and consumed count must both be present or both absent)",
      { cursorCommit }
    );
  }
  let partial = null;
  if (partialCommit !== "") {
    if (!/^[0-9a-f]{40}$/.test(partialCommit) || !/^[0-9]+$/.test(partialConsumed)) {
      fail(CODES.INTAKE_BLOCKED, "malformed resumable frontier cursor", { cursorCommit });
    }
    const consumed = Number(partialConsumed);
    if (!Number.isSafeInteger(consumed) || consumed <= 0) {
      fail(CODES.INTAKE_BLOCKED, "malformed resumable frontier cursor (partial consumed count must be a positive integer)", {
        cursorCommit,
      });
    }
    if (accounted.includes(partialCommit)) {
      fail(CODES.INTAKE_BLOCKED, "malformed resumable frontier cursor (partial commit is also listed as accounted)", {
        cursorCommit,
      });
    }
    partial = { commit: partialCommit, consumed };
  }
  return { head, scopeHash, base: base === "" ? null : base, accounted, partial };
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
// ancestor of a listed commit is itself listed or already accounted,
// so resuming via ^<accounted> can never exclude an uninspected
// ancestor. Honest tradeoff, stated not hidden: the internal walk is
// O(pending) and deadline-bounded (a timeout throws INTAKE_BLOCKED
// with the cursor preserved); what is bounded at the command is the
// OUTPUT and ADMISSION — at most `cap` commits are ever returned —
// not the walk. The incorrect alternative (newest window) is not used.
function listPendingCommits(repoPath, { head, accounted, cursorCommit, base }, cap, opts = {}) {
  let rangeArgs;
  if (accounted !== null) {
    // Frontier resume: head with ^base (the original cursor's history)
    // and ^accounted. Accounted is a lower set, so ^-exclusion removes
    // exactly the accounted commits and their (already accounted or
    // pre-cursor) ancestors, never a pending one. The ^base exclusion
    // is essential when accounted is still empty (a pure partial):
    // without it, the cursor commit itself would re-list as pending.
    rangeArgs = [head, ...(base ? [`^${base}`] : []), ...accounted.map((s) => `^${s}`)];
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

// TBP2-007C bounded per-commit path collection: the deterministic
// pathOrder for one commit (union of its parents' in-scope diff paths,
// in parent order, deduplicated), starting at startIndex (for resuming
// a partially processed commit) and collecting at most `budget` paths.
//
// Storage bound, stated plainly: stored records are exactly the
// returned pathOrder (at most `budget` paths) plus the per-parent
// status of those same paths. Consumption stops at budget + ONE
// documented lookahead record: when a further distinct path is found
// after the budget is full, hasMore is set and that lookahead record
// is DISCARDED, not stored — so no record beyond the budget is ever
// retained. Status for a path in a later parent is recorded only when
// that parent's iterator reaches it; for a single-parent commit the
// status is complete for every collected path, and for merges the
// event kind is decided from blob SHAs, not diff status, so a missing
// later-parent status is never read. Duplicates across parents are
// recorded for status but never counted twice.
function collectCommitPaths(repoPath, parentRefs, commit, scopePaths, startIndex, budget, opts = {}) {
  const statusByParent = parentRefs.map(() => new Map());
  const pathOrder = [];
  const seen = new Set();
  let skipped = 0;
  let hasMore = false;
  outer: for (let parentIndex = 0; parentIndex < parentRefs.length; parentIndex++) {
    const parent = parentRefs[parentIndex];
    for (const [status, path] of diffNameStatusIter(repoPath, parent, commit, scopePaths, opts)) {
      if (seen.has(path)) {
        statusByParent[parentIndex].set(path, status);
        continue;
      }
      if (skipped < startIndex) {
        seen.add(path);
        statusByParent[parentIndex].set(path, status);
        skipped += 1;
        continue;
      }
      if (pathOrder.length >= budget) {
        hasMore = true;
        break outer; // lookahead record discarded, not stored
      }
      seen.add(path);
      statusByParent[parentIndex].set(path, status);
      pathOrder.push(path);
    }
  }
  return { pathOrder, statusByParent, hasMore };
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
  // enumeration. On a frontier resume, every already-accounted commit
  // is excluded at the Git command itself (^<sha> excludes that commit
  // and its ancestors); because the accounted set is a lower set, that
  // exclusion removes exactly the accounted commits and their already
  // accounted ancestors, never a pending one.
  // The frontier's base cursor, carried forward across resumes: it is
  // the original plain cursor for a frontier chain, or the plain
  // cursor for a first poll, or null when scanning from the beginning.
  const resumeBase = frontier ? frontier.base : (cursorCommit ?? null);
  const { commits, hasMore: commitCapHit } = listPendingCommits(
    repoPath,
    { head, accounted: frontier ? frontier.accounted : null, cursorCommit: frontier ? null : cursorCommit, base: resumeBase },
    MAX_COMMITS_PER_POLL,
    gitOpts()
  );

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
  // partial commit is never in the accounted list, so it stays in the
  // next poll's pending range, and its already-consumed path prefix is
  // skipped again on resume.
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
    // carried partial, collection starts at its consumed prefix, so
    // already-handled paths are skipped, not re-emitted.
    const startIndex = currentPartial && currentPartial.commit === commit ? currentPartial.consumed : 0;
    const remainingFileBudget = maxChangedFilesPerPoll - changedFileCount;
    const {
      pathOrder,
      statusByParent,
      hasMore: morePaths,
    } = collectCommitPaths(repoPath, parentRefs, commit, scopePaths, startIndex, remainingFileBudget, gitOpts());
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
    // paths are still pending.
    if (brokeMidCommit) {
      const consumed = startIndex + processedInCommit;
      if (consumed > 0) {
        currentPartial = { commit, consumed };
      }
      // consumed === 0 with no paths handled: the commit was not
      // started this poll, so any carried partial (for a different
      // commit) is left untouched, and this commit stays pending.
      truncated = true;
      break outer;
    }
    if (morePaths) {
      // All collected paths were handled, but the collector's
      // lookahead proved further distinct paths exist for this
      // commit beyond the budget. Record the partial prefix so the
      // next poll resumes inside this commit, not after it.
      currentPartial = { commit, consumed: startIndex + pathOrder.length };
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
  // file/record/byte cap, deadline, or a partial commit — because the
  // frontier now carries exact progress: the fully processed commits
  // (a lower set) plus any partial commit with its consumed prefix.
  // Resuming from it advances past exactly the accounted work and
  // resumes inside the partial commit, so no truncation mode can stall
  // at the same cursor forever. A frontier is never returned when
  // nothing truncated: then every pending commit was fully processed
  // and the cursor advances to HEAD.
  let resumeFrontier = null;
  if (commitCapHit && !truncated) {
    // The producer's window was exhausted without any other
    // truncation: more history exists beyond the cap, so this poll is
    // truncated by the commit cap even though every listed commit was
    // fully processed.
    truncated = true;
  }
  if (truncated) {
    const accounted = frontier ? [...frontier.accounted, ...processedCommits] : [...processedCommits];
    resumeFrontier = makeFrontier(head, scopePaths, accounted, currentPartial, resumeBase);
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
