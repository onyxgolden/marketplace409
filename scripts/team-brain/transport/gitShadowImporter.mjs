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
function timeoutFor(opts) {
  if (opts.deadlineMs === undefined) return GIT_TIMEOUT_MS;
  return Math.max(1, Math.min(GIT_TIMEOUT_MS, opts.deadlineMs - Date.now()));
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
// `scopePaths` prefixes if given. Returns [{status, path}] where status
// is one of A (added), M (modified), D (deleted).
//
// TBP2-005: this uses `-z` (NUL-delimited) output and literal path
// handling end to end. The old line/tab parsing dropped any path Git
// quoted — non-ASCII, tab, or newline filenames — because the quoted
// form's leading quote failed the scope-prefix test and the file
// vanished while the cursor still advanced. With -z, Git emits raw
// bytes, no quoting, and a path is either in scope (admitted or
// quarantined) or out of scope — never silently lost inside scope.
function diffNameStatus(repoPath, fromRef, toRef, scopePaths, opts = {}) {
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
  const parts = out.split("\0");
  const changes = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i];
    const path = parts[i + 1];
    if (!status || path === undefined || path === "") continue;
    if (scopePaths && scopePaths.length > 0 && !scopePaths.some((p) => path.startsWith(p))) continue;
    changes.push({ status: status[0], path });
  }
  return changes;
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
// Returns { events, newCursor, quarantined, truncated } — never throws for
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
  const deadlineAt = Date.now() + pollDeadlineMs;
  const gitOpts = () => ({ deadlineMs: deadlineAt });
  const expired = () => Date.now() >= deadlineAt;
  const head = headCommit(repoPath, headRef, gitOpts());

  if (cursorCommit) {
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

  if (cursorCommit === head) {
    return { events: [], newCursor: head, quarantined: [], truncated: false };
  }

  const range = cursorCommit ? `${cursorCommit}..${head}` : head;
  const commitList = git(repoPath, ["rev-list", "--topo-order", "--reverse", range], gitOpts()).trim();
  let commits = commitList ? commitList.split("\n") : [];

  const events = [];
  const quarantined = [];
  let truncated = false;
  let totalBytes = 0;
  let changedFileCount = 0;

  // Early enumeration bound (TBP2-007A): charge-before-inspect. If the
  // history is longer than one poll may inspect, inspect only the
  // first MAX_COMMITS_PER_POLL and truncate — the remaining commits
  // are uninspected, so the cursor must not advance.
  if (commits.length > MAX_COMMITS_PER_POLL) {
    commits = commits.slice(0, MAX_COMMITS_PER_POLL);
    truncated = true;
  }

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

    // Union of per-parent diffs for this commit, in first-appearance
    // order. A merge's diff against each parent is inspected (that is
    // what finds side-branch introductions), but the union is decided
    // once per path below — never once per parent.
    const candidates = new Map(); // path -> Map(parentRef -> status)
    for (const parent of parentRefs) {
      if (expired()) {
        truncated = true;
        break outer;
      }
      const changes = diffNameStatus(repoPath, parent, commit, scopePaths, gitOpts());
      for (const { status, path } of changes) {
        if (!candidates.has(path)) candidates.set(path, new Map());
        candidates.get(path).set(parent, status);
      }
    }

    for (const [path, perParent] of candidates) {
      if (expired()) {
        truncated = true;
        break outer;
      }
      if (events.length >= maxRecordsPerBatch) {
        truncated = true;
        break outer;
      }
      changedFileCount += 1;
      if (changedFileCount > maxChangedFilesPerPoll) {
        truncated = true;
        break outer;
      }
      if (pathDepth(path) > maxPathDepth) {
        quarantined.push({ commit, path, reason: "PATH_DEPTH_EXCEEDED" });
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
        const status = perParent.get(parentRefs[0]);
        eventKind = status === "A" ? "ADDED" : status === "D" ? "DELETED" : "MODIFIED";
      } else if (commitBlob === null) {
        if (!parentBlobs.some((b) => b !== null)) continue; // absent everywhere: no change to record
        eventKind = "DELETED";
      } else if (parentBlobs.includes(commitBlob)) {
        const distinctParentBlobs = [...new Set(parentBlobs.filter((b) => b !== null))];
        if (distinctParentBlobs.length < 2) continue; // merge visibility only — already introduced elsewhere
        eventKind = "MERGE_SELECTED";
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
          break outer;
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
          continue;
        }
        if (totalBytes + size > maxPollBytes) {
          truncated = true;
          break outer;
        }
        const content = readBlob(repoPath, commitBlob, maxFileBytes + 64 * 1024, gitOpts());
        byteLength = content.length;
        totalBytes += byteLength;
        contentSha256 = sha256OfBuffer(content);
      }

      events.push({
        introducingCommit: commit,
        path,
        eventKind,
        contentSha256,
        byteLength,
        sourceTimestamp: commitTimestamp(repoPath, commit, gitOpts()),
        firstObservedAt: new Date().toISOString(),
      });
    }
  }

  // Deletion never closes an obligation — this module only records the
  // event; it is the caller's (ledger/handoff layer's) job to decide what a
  // DELETED event means for an obligation's state. Never erase a prior
  // ADDED/MODIFIED event because a later DELETED event exists for the same
  // path; both are explicit, both are kept.

  return {
    events,
    // Cursor only advances to HEAD when nothing was truncated — a
    // truncated batch must be resumed from the SAME cursor on the next
    // poll (caller re-runs with more budget or narrower scope), never
    // silently marked caught-up with records missing.
    newCursor: truncated ? cursorCommit ?? null : head,
    quarantined,
    truncated,
  };
}
