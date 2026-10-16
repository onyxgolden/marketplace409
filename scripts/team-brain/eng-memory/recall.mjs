// Team Brain eng-memory slice 1 — recall (read-only retrieval) adapter.
// Pure apart from the injected store. No I/O, no network, no model calls.
//
// Recall consults admitted episodes only. Rules:
//
//  - Every consulted candidate is CHARGED BEFORE its fields are inspected
//    against the task's SINGLE aggregate 64-unit budget (threaded through
//    host admission and the recall drain — no per-phase budgets, so one
//    invocation can never consult 112 units). Exceeding it refuses the
//    whole task with BUDGET_EXHAUSTED and NO partial domain output.
//  - 5s task watchdog. The sync core uses a cooperative injected clock;
//    the async host entrypoint (recallAsync) adds a REAL preemptive
//    boundary: the store factory call, iterator acquisition, sync next()
//    steps, and the synchronous prefix of async next() steps all run under
//    V8-enforced timeouts (a synchronous hang is interrupted, never left
//    to block the event loop), the genuinely asynchronous remainder races
//    a real timer, and any completion past the deadline is discarded
//    rather than emitted as success.
//  - Results are capped at 20 candidates, deterministically ranked:
//    eventAt (integer epoch-ms) descending, then episodeId ascending.
//  - Revoked/denied sources are suppressed from retrieval, and read
//    permission is revalidated at recall time against the CURRENT host
//    config (approved repos/paths + registered source tuples, including
//    every declared commit restriction) — removal of an approved read
//    path, or tightening of a commit binding, suppresses; it does not
//    keep serving.
//  - Contradictory episodes for the same task coexist with explicit
//    conflict flags — recall never silently picks a winner.
//  - Retrieved candidates are metadata with provenance and uncertainty.
//    They never become truth, approval, queue completion, or executable
//    instructions: the result carries an explicit non-authoritative notice,
//    and NO_MATCH / AMBIGUOUS_CUES never imply certainty.
//  - The returned payload is accounted: over 256KiB of results refuses the
//    whole task with RESULT_PAYLOAD_EXCEEDED and no partial output.

import { ENG_CODES } from "./errors.mjs";
import { admitObject } from "./admission.mjs";
import { ConsultationBudget } from "./budget.mjs";
import { QUERY_KEY_SPECS, assertHostConfig, admittedHost, validateQuerySnapshot, sourceIdentityString } from "./schemas.mjs";
import { stableStringify } from "../report/stableStringify.mjs";
import vm from "node:vm";

export const MAX_CONSULTED_CANDIDATES = 64;
export const RECALL_RESULT_CAP = 20;
export const WATCHDOG_MS = 5000;
export const MAX_RESULT_PAYLOAD_BYTES = 262144; // 256KiB

export const UNCERTAINTY = {
  NONE: "NONE",
  NO_MATCH: "NO_MATCH",
  AMBIGUOUS_CUES: "AMBIGUOUS_CUES",
};

function sourceKey(repo, path) {
  return `${repo}\u0000${path}`;
}

function matchesCues(ep, q) {
  if (q.taskId !== undefined && ep.taskId !== q.taskId) return false;
  if (q.sourceRepo !== undefined && ep.source.repo !== q.sourceRepo) return false;
  if (q.sourcePath !== undefined && ep.source.path !== q.sourcePath) return false;
  if (q.kind !== undefined && ep.kind !== q.kind) return false;
  // Integer epoch-ms comparison: lexicographic string order is NOT
  // chronological across second/millisecond precisions.
  if (q.sinceMs !== undefined && ep.eventAtMs < q.sinceMs) return false;
  if (q.untilMs !== undefined && ep.eventAtMs > q.untilMs) return false;
  return true;
}

/**
 * Current read permission for an episode's source. Denied/revoked sources
 * are suppressed, and approval is revalidated against the CURRENT host
 * config — removing an approved repo/path, unregistering the (repo,path)
 * tuple, replacing the registered pin identity, or tightening the
 * registered commit binding suppresses retrieval of already-stored
 * episodes. A pin or revision the host no longer vouches for is not
 * served, even though the episode was legitimately captured earlier.
 * Historical submitter attribution stays historical; it is never treated
 * as current approval.
 *
 * Enforces the SAME complete current source registration predicates as
 * capture (authorizeEvent): the (repo,path) tuple must be currently
 * registered, and when the host's registration declares a commit
 * restriction, the episode's commit must satisfy it. A registration
 * without a commit constraint imposes none — no commit is required for
 * pin schemes whose contract does not declare one.
 *
 * Consults the admitted snapshot (never the raw host object).
 */
export function hasReadPermission(ep, host) {
  const adm = admittedHost(host);
  const key = sourceKey(ep.source.repo, ep.source.path);
  if (adm.deniedSources.has(key)) return false;
  if (adm.revokedSources.has(key)) return false;
  if (!adm.approvedRepos.has(ep.source.repo)) return false;
  if (!adm.approvedPaths.has(ep.source.path)) return false;
  // Same predicate shape as capture: some CURRENT registration must
  // cover (repo,path) with its commit restriction (if any) satisfied.
  const tuplePermitted = adm.sourceRegistrations.some(
    (reg) =>
      reg.repo === ep.source.repo &&
      reg.path === ep.source.path &&
      (reg.commit === undefined || ep.source.commit === reg.commit),
  );
  if (!tuplePermitted) return false;
  // Same complete-identity rule as capture: the episode's pin must be
  // currently registered. Changing current permission never keeps serving
  // the disallowed pin.
  const sid = sourceIdentityString(ep.source.repo, ep.source.path, ep.source.pin.algo, ep.source.pin.id);
  if (!adm.registeredSourceIds.has(sid)) return false;
  return true;
}

/**
 * Shared match/project over already-drained episodes. Suppression,
 * cue matching, conflict flags, deterministic ranking, the 20-result cap,
 * detached projection, payload accounting, and uncertainty/truncation
 * reporting all live here so sync and async recall cannot diverge.
 */
export function matchAndProject(episodes, host, q, counts = {}) {
  let suppressed = counts.suppressed || 0;
  const matched = [];
  for (const ep of episodes) {
    if (!hasReadPermission(ep, host)) {
      suppressed += 1;
      continue;
    }
    if (matchesCues(ep, q)) matched.push(ep);
  }

  // Contradictions coexist: group current (non-terminal) episodes by task
  // and flag groups whose statuses disagree. Persisted material conflicts
  // (episodes stored with conflictsWith) are ALSO carried through — a
  // conflict is not erased merely because one side reached a terminal
  // status. Ordinary chronological completion (distinct identities, no
  // conflictsWith link) never becomes a conflict.
  const byTask = new Map();
  for (const ep of matched) {
    if (!byTask.has(ep.taskId)) byTask.set(ep.taskId, []);
    byTask.get(ep.taskId).push(ep);
  }
  const TERMINAL = new Set(["COMPLETE", "REVOKED", "SUPERSEDED"]);
  const linkConflict = (a, b) => {
    if (!conflictLinks.has(a)) conflictLinks.set(a, new Set());
    conflictLinks.get(a).add(b);
  };
  const conflictLinks = new Map();
  const linkBoth = (a, b) => {
    linkConflict(a, b);
    linkConflict(b, a);
  };
  for (const eps of byTask.values()) {
    const current = eps.filter((e) => !TERMINAL.has(e.status));
    const statuses = new Set(current.map((e) => e.status));
    if (statuses.size > 1) {
      for (let x = 0; x < current.length; x += 1) {
        for (let y = x + 1; y < current.length; y += 1) {
          linkBoth(current[x].episodeId, current[y].episodeId);
        }
      }
    }
  }
  const byId = new Map(matched.map((e) => [e.episodeId, e]));
  for (const ep of matched) {
    if (ep.conflictsWith && byId.has(ep.conflictsWith)) {
      linkBoth(ep.episodeId, ep.conflictsWith);
    }
  }

  // Deterministic ranking: eventAtMs desc, episodeId asc (stable tie-break).
  matched.sort((a, b) =>
    a.eventAtMs !== b.eventAtMs ? b.eventAtMs - a.eventAtMs : a.episodeId < b.episodeId ? -1 : 1,
  );
  const capped = matched.slice(0, RECALL_RESULT_CAP);

  // Detached projection: fresh nested objects on every read, so callers
  // can never rewrite stored provenance through a result alias. The
  // supplied source revision (commit) is preserved in the projection —
  // recall never drops stored revision identity.
  const results = capped.map((ep) => ({
    episodeId: ep.episodeId,
    taskId: ep.taskId,
    source: {
      repo: ep.source.repo,
      path: ep.source.path,
      ...(ep.source.commit !== undefined ? { commit: ep.source.commit } : {}),
      pin: { algo: ep.source.pin.algo, id: ep.source.pin.id },
    },
    principal: ep.principal,
    eventAt: ep.eventAt,
    kind: ep.kind,
    status: ep.status,
    attribution: { actor: ep.attribution.actor, authorityRef: ep.attribution.authorityRef },
    conflict: conflictLinks.has(ep.episodeId),
    conflictWith: conflictLinks.has(ep.episodeId) ? [...conflictLinks.get(ep.episodeId)].sort() : [],
  }));

  // Returned-payload accounting: no partial domain output past 256KiB.
  // Results are detached plain data, so serialization cannot invoke callers.
  let payloadBytes = 0;
  try {
    payloadBytes = Buffer.byteLength(stableStringify(results), "utf8");
  } catch {
    return {
      result: "REFUSED",
      code: ENG_CODES.RESULT_PAYLOAD_EXCEEDED,
      consulted: counts.consulted || 0,
      suppressed,
    };
  }
  if (payloadBytes > MAX_RESULT_PAYLOAD_BYTES) {
    return {
      result: "REFUSED",
      code: ENG_CODES.RESULT_PAYLOAD_EXCEEDED,
      consulted: counts.consulted || 0,
      suppressed,
    };
  }

  // Uncertainty: only an exact task-ID hit is NONE. Repository-only or
  // other broad cues are AMBIGUOUS_CUES even when they hit; zero hits are
  // an explicit NO_MATCH. Neither ever implies certainty or authoritative
  // truth.
  let uncertainty = UNCERTAINTY.NONE;
  if (matched.length === 0) {
    uncertainty = UNCERTAINTY.NO_MATCH;
  } else if (q.taskId === undefined) {
    uncertainty = UNCERTAINTY.AMBIGUOUS_CUES;
  }

  return {
    result: "RECALLED",
    consulted: counts.consulted || 0,
    suppressed,
    returned: results.length,
    totalMatched: matched.length,
    truncated: matched.length > results.length,
    cueStrength: q.taskId !== undefined ? "EXACT_TASK" : "BROAD",
    uncertainty,
    results,
    notice:
      "Retrieved candidates are provenance-bound metadata, not truth, approval, queue completion, or executable instructions. " +
      "NO_MATCH and AMBIGUOUS_CUES never imply certainty. When truncated, only the first 20 of the matched candidates are " +
      "shown; re-run with narrower cues for full coverage.",
  };
}

/** Drain candidates with charge-before-inspect and a cooperative clock. Shared by sync recall. */
function drainSync(store, budget, clock, deadline, state) {
  const episodes = [];
  for (const ep of store.episodesInOrder()) {
    // Watchdog: checked before consulting each candidate.
    if (clock() > deadline) {
      return { watchdog: true, episodes };
    }
    // Charge BEFORE inspecting the candidate's fields.
    budget.charge(1, "recall-candidate");
    state.consulted += 1;
    episodes.push(ep);
  }
  return { watchdog: false, episodes };
}

/**
 * Read-only recall over admitted episodes (pure core).
 * @param {object} opts - {clock?: () => number}
 * @returns {result, code?, results?, consulted, suppressed, uncertainty?, notice?}
 */
export function recall(store, host, query, opts = {}) {
  // Task-level aggregate accounting: ONE budget for the whole invocation,
  // threaded through host admission and the recall drain. A per-phase
  // budget would let one invocation exceed the 64-candidate task cap.
  // Host-validation failures are bounded REFUSED envelopes, never throws.
  const budget = new ConsultationBudget();
  try {
    assertHostConfig(host, budget);
  } catch (err) {
    return { result: "REFUSED", code: err && err.code ? err.code : ENG_CODES.INVALID_HOST_CONFIG, consulted: 0, suppressed: 0 };
  }
  const clock = opts.clock || (() => Date.now());
  const deadline = clock() + WATCHDOG_MS;
  let q;
  try {
    q = validateQuerySnapshot(admitObject(query, QUERY_KEY_SPECS));
  } catch (err) {
    return { result: "REFUSED", code: err && err.code ? err.code : ENG_CODES.INVALID_QUERY, consulted: 0, suppressed: 0 };
  }

  const state = { consulted: 0, suppressed: 0 };
  let drained;
  try {
    drained = drainSync(store, budget, clock, deadline, state);
  } catch (err) {
    if (err && err.code === ENG_CODES.BUDGET_EXHAUSTED) {
      return { result: "REFUSED", code: ENG_CODES.BUDGET_EXHAUSTED, consulted: state.consulted, suppressed: state.suppressed };
    }
    throw err;
  }
  if (drained.watchdog) {
    return { result: "REFUSED", code: ENG_CODES.WATCHDOG_EXCEEDED, consulted: state.consulted, suppressed: state.suppressed };
  }
  return matchAndProject(drained.episodes, host, q, state);
}

/**
 * Preemptive synchronous execution boundary. Runs any zero-arg function
 * under a V8-enforced timeout: a synchronous busy loop is interrupted
 * (ERR_SCRIPT_EXECUTION_TIMEOUT) instead of blocking the event loop past
 * the deadline. This covers the ENTIRE store execution path — the
 * episodesInOrder() factory call, iterator acquisition, each sync next()
 * step, and the synchronous prefix of each async next() step (an async
 * generator's body runs synchronously until its first await, so a busy
 * loop there is interrupted the same way). The function is stashed on a
 * unique globalThis key (concurrency-safe) and always cleaned up.
 *
 * A real timer on the same event loop cannot preempt a blocked loop —
 * V8's isolate-level interrupt is the enforcement mechanism here, not a
 * setTimeout. The outer Promise.race timer additionally guards the
 * genuinely asynchronous remainder of async steps.
 */
let vmCallSeq = 0;
const vmCallScript = new vm.Script("globalThis[globalThis.__engmemKey]()");
function callBounded(fn, ms) {
  const key = `__engmem_fn_${(vmCallSeq += 1)}`;
  globalThis.__engmemKey = key;
  globalThis[key] = fn;
  try {
    return { ok: true, result: vmCallScript.runInThisContext({ timeout: Math.max(1, Math.floor(ms)) }) };
  } catch (err) {
    if (err && err.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") return { ok: false, timedOut: true };
    throw err;
  } finally {
    delete globalThis[key];
    delete globalThis.__engmemKey;
  }
}

/** One synchronous iterator next() step under the preemptive boundary. */
function nextSyncBounded(iterator, ms) {
  return callBounded(() => iterator.next(), ms);
}

/**
 * Async host entrypoint for recall. Validates the query synchronously
 * (bounded), then drains under a REAL preemptive boundary:
 *
 * - The store factory call (store.episodesInOrder()) runs under a
 *   V8-enforced timeout: a synchronous hang in the factory is interrupted,
 *   never left to block the event loop.
 * - Iterator acquisition runs under the same boundary.
 * - Synchronous iterators advance one next() step at a time under the
 *   V8-enforced timeout (see callBounded): a synchronous hang is
 *   interrupted, never left to block the event loop.
 * - Asynchronous iterators: the synchronous prefix of each next() step
 *   runs under the V8-enforced timeout (an async generator body executes
 *   synchronously until its first await, so a busy loop there is
 *   interrupted); the genuinely asynchronous remainder races against a
 *   real timer via the outer Promise.race.
 * - Belt and suspenders: if the drain completes but the wall-clock elapsed
 *   time already exceeded the timeout, the late domain output is discarded
 *   and WATCHDOG_EXHAUSTED is returned instead.
 *
 * A timeout therefore can never later emit successful domain output: the
 * timed-out path returns WATCHDOG_EXHAUSTED immediately, and any abandoned
 * async work has its rejection suppressed and its eventual resolution
 * discarded. No phase of the store execution path relies on a timer
 * running on the same (potentially blocked) event loop.
 *
 * @param {object} opts - {timeoutMs?: number} (default 5000)
 */
export async function recallAsync(store, host, query, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? WATCHDOG_MS;
  const startMs = Date.now();
  // Single aggregate task budget: host admission and the drain share it.
  const budget = new ConsultationBudget();
  try {
    assertHostConfig(host, budget);
  } catch (err) {
    return { result: "REFUSED", code: err && err.code ? err.code : ENG_CODES.INVALID_HOST_CONFIG, consulted: 0, suppressed: 0 };
  }
  let q;
  try {
    q = validateQuerySnapshot(admitObject(query, QUERY_KEY_SPECS));
  } catch (err) {
    return { result: "REFUSED", code: err && err.code ? err.code : ENG_CODES.INVALID_QUERY, consulted: 0, suppressed: 0 };
  }

  const deadline = startMs + timeoutMs;
  const state = { consulted: 0, suppressed: 0 };
  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    if (timer.unref) timer.unref();
  });
  const watchdogRefused = () => ({
    result: "REFUSED",
    code: ENG_CODES.WATCHDOG_EXHAUSTED,
    consulted: state.consulted,
    suppressed: state.suppressed,
  });
  const workPromise = (async () => {
    const episodes = [];
    // Store factory under the preemptive boundary: a synchronous hang
    // inside episodesInOrder() is interrupted by V8.
    const factoryMs = deadline - Date.now();
    if (factoryMs <= 0) return watchdogRefused();
    const made = callBounded(() => store.episodesInOrder(), factoryMs);
    if (!made.ok) return watchdogRefused();
    const iterable = made.result;
    // Iterator acquisition under the same boundary (prefer an async
    // iterator when the store offers one; otherwise drive the sync
    // iterator one bounded step at a time).
    const acqMs = deadline - Date.now();
    if (acqMs <= 0) return watchdogRefused();
    const acquired = callBounded(() => {
      const asyncIt =
        iterable && typeof iterable[Symbol.asyncIterator] === "function" ? iterable[Symbol.asyncIterator]() : null;
      const syncIt =
        !asyncIt && iterable && typeof iterable[Symbol.iterator] === "function" ? iterable[Symbol.iterator]() : null;
      if (!asyncIt && !syncIt) {
        throw new TypeError("store.episodesInOrder() must return an iterable");
      }
      return { asyncIt, syncIt };
    }, acqMs);
    if (!acquired.ok) return watchdogRefused();
    const { asyncIt, syncIt } = acquired.result;
    try {
      for (;;) {
        if (Date.now() > deadline) return watchdogRefused();
        let step;
        if (syncIt) {
          // Preemptive boundary: a synchronous hang inside next() is
          // interrupted by V8 instead of blocking the event loop.
          const advanced = nextSyncBounded(syncIt, deadline - Date.now());
          if (!advanced.ok) return watchdogRefused();
          step = advanced.result;
        } else {
          // Async next: the synchronous prefix of the step runs under the
          // V8-enforced timeout (an async generator body executes
          // synchronously until its first await — a busy loop there is
          // interrupted, never left to block the event loop). The promise
          // it returns covers the genuinely asynchronous remainder, which
          // the outer timer race guards. Either V8 reports the timeout
          // directly or the abandoned step's promise rejects with it —
          // both map to WATCHDOG_EXHAUSTED; the abandoned promise never
          // settles into domain output.
          const stepMs = deadline - Date.now();
          if (stepMs <= 0) return watchdogRefused();
          const started = callBounded(() => asyncIt.next(), stepMs);
          if (!started.ok) return watchdogRefused();
          try {
            step = await started.result;
          } catch (err) {
            if (err && err.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") return watchdogRefused();
            throw err;
          }
        }
        if (step.done) break;
        // Charge BEFORE inspecting the candidate's fields.
        budget.charge(1, "recall-candidate");
        state.consulted += 1;
        episodes.push(step.value);
      }
    } catch (err) {
      if (err && err.code === ENG_CODES.BUDGET_EXHAUSTED) {
        return {
          result: "REFUSED",
          code: ENG_CODES.BUDGET_EXHAUSTED,
          consulted: state.consulted,
          suppressed: state.suppressed,
        };
      }
      throw err;
    }
    // Late completion past the deadline is not a success: discard it.
    if (Date.now() - startMs > timeoutMs) return watchdogRefused();
    return matchAndProject(episodes, host, q, state);
  })();
  // If the timer wins, the abandoned work must not surface as an
  // unhandled rejection later, and its eventual resolution is discarded.
  workPromise.catch(() => {});
  let outcome;
  try {
    outcome = await Promise.race([workPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
  if (outcome && outcome.timedOut) {
    return watchdogRefused();
  }
  return outcome;
}
