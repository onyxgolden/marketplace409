// Team Brain eng-memory slice 1 — recall (read-only retrieval) adapter.
// Pure apart from the injected store. No I/O, no network, no model calls.
//
// Recall consults admitted episodes only. Rules:
//
//  - Every consulted candidate is CHARGED BEFORE its fields are inspected
//    against the task's SINGLE aggregate 64-unit budget (threaded through
//    host admission and the recall drain — no per-phase budgets, so one
//    invocation can never consult 112 units). Registration records are
//    consulted lazily, on demand, each charged before inspection —
//    admission never eagerly walks the registries. Exceeding the budget
//    refuses the whole task with BUDGET_EXHAUSTED and NO partial domain
//    output.
//  - 5s task watchdog. The sync core uses a cooperative injected clock.
//    The async host entrypoint (recallAsync) adds a REAL preemptive
//    boundary chosen by store shape: synchronous stores drain in-thread
//    with every next() step under a V8-enforced timeout; asynchronous
//    stores drain entirely in a worker thread (recallWorker.mjs), so a
//    busy loop AFTER an await blocks the worker thread — never the
//    caller's event loop — and the caller's own timer terminates the
//    worker with WATCHDOG_EXHAUSTED. The boundary has no dependence on
//    the blocked execution thread's timer, and termination (not ignoring)
//    proves no late domain output.
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
import { Worker } from "node:worker_threads";

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
export function hasReadPermission(ep, host, budget) {
  const adm = admittedHost(host);
  const key = sourceKey(ep.source.repo, ep.source.path);
  if (adm.deniedSources.has(key)) return false;
  if (adm.revokedSources.has(key)) return false;
  if (!adm.approvedRepos.has(ep.source.repo)) return false;
  if (!adm.approvedPaths.has(ep.source.path)) return false;
  // Same predicate shape as capture: some CURRENT registration must
  // cover (repo,path) with its commit restriction (if any) satisfied.
  // Lazy scan with charge-before-inspect: only relevant registrations
  // are consulted, each against the task's aggregate budget; the
  // per-invocation cache means a registration consulted for one episode
  // is not re-charged for the next.
  let tuplePermitted = false;
  for (let i = 0; i < adm.sourceRegistrationCount; i += 1) {
    const reg = adm.sourceRegistrationAt(i, budget);
    if (reg.repo !== ep.source.repo) continue;
    if (reg.path !== ep.source.path) continue;
    if (reg.commit !== undefined && ep.source.commit !== reg.commit) continue;
    tuplePermitted = true;
    break;
  }
  if (!tuplePermitted) return false;
  // Same complete-identity rule as capture: the episode's pin must be
  // currently registered. Changing current permission never keeps serving
  // the disallowed pin. Set membership on admitted bounded config: not a
  // per-record candidate, no charge.
  const sid = sourceIdentityString(ep.source.repo, ep.source.path, ep.source.pin.algo, ep.source.pin.id);
  if (!adm.registeredSourceIds.has(sid)) return false;
  return true;
}

/**
 * Shared match/project over already-drained episodes. Suppression,
 * cue matching, conflict flags, deterministic ranking, the 20-result cap,
 * detached projection, payload accounting, and uncertainty/truncation
 * reporting all live here so sync and async recall cannot diverge.
 *
 * The task's aggregate budget is threaded through: read-permission
 * revalidation consults source registrations lazily, charging each
 * before inspection (see hasReadPermission). Without a budget (direct
 * test calls), records validate uncharged.
 */
export function matchAndProject(episodes, host, q, counts = {}, budget) {
  let suppressed = counts.suppressed || 0;
  const matched = [];
  for (const ep of episodes) {
    if (!hasReadPermission(ep, host, budget)) {
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
  try {
    return matchAndProject(drained.episodes, host, q, state, budget);
  } catch (err) {
    // Exhaustion during read-permission revalidation refuses the whole
    // task — no partial domain output — same as drain exhaustion.
    if (err && err.code === ENG_CODES.BUDGET_EXHAUSTED) {
      return { result: "REFUSED", code: ENG_CODES.BUDGET_EXHAUSTED, consulted: state.consulted, suppressed: state.suppressed };
    }
    throw err;
  }
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
 * (bounded), then drains under a REAL preemptive boundary chosen by the
 * store's shape:
 *
 * - SYNCHRONOUS stores (sync generator / sync iterable): the in-thread
 *   path below. The store factory call, iterator acquisition, and each
 *   sync next() step run under V8-enforced timeouts (callBounded): a
 *   synchronous hang is interrupted, never left to block the event loop.
 *   There is no await anywhere, so no continuation can resume outside
 *   the timed region.
 * - ASYNCHRONOUS stores (async generator function, async function, or a
 *   synchronous factory returning an async iterable): the ENTIRE drain —
 *   factory, acquisition, and every next() step including post-await
 *   continuations — runs in a dedicated worker thread
 *   (drainAsyncInWorker / recallWorker.mjs). A busy loop after an await
 *   blocks the WORKER thread, never the caller's event loop, so the
 *   caller's own timer always fires: the worker is terminated and
 *   WATCHDOG_EXHAUSTED is returned. The execution boundary therefore has
 *   no dependence on the blocked execution thread's timer.
 *
 * The worker receives only the store factory's source text
 * (reconstructed there) plus opaque control messages; episode data
 * crosses back as structured-cloned plain data. Per-candidate
 * consultation charges are accounted centrally on the caller's thread
 * (one RPC per candidate), so the task's single aggregate 64-unit budget
 * still bounds the whole drain. Match/project (read-permission
 * revalidation with lazy registration consultation) runs on the caller's
 * thread after the drain.
 *
 * A timeout therefore can never later emit successful domain output: the
 * timed-out worker is TERMINATED (its eventual settlement is destroyed,
 * not merely ignored), and any abandoned in-thread work has its
 * rejection suppressed and its eventual resolution discarded.
 *
 * Async stores whose factory cannot be reconstructed across the worker
 * boundary (bound native functions, closures over caller state) are
 * refused with STORE_BOUNDARY_REFUSED — fail closed, never silently
 * downgraded to an unguarded path.
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
  const watchdogRefused = () => ({
    result: "REFUSED",
    code: ENG_CODES.WATCHDOG_EXHAUSTED,
    consulted: state.consulted,
    suppressed: state.suppressed,
  });
  const workerOpts = { timeoutMs, startMs, budget, state, watchdogRefused };

  const factoryFn = store ? store.episodesInOrder : undefined;
  if (isAsyncFactory(factoryFn)) {
    // Async factory: its post-await continuations would resume on this
    // thread — the whole drain goes to the worker boundary.
    return drainAsyncInWorker(store, host, q, workerOpts);
  }

  // Synchronous factory probe under the V8 preemptive boundary: a
  // synchronous hang in the factory is interrupted, never left to block
  // the event loop.
  const factoryMs = deadline - Date.now();
  if (factoryMs <= 0) return watchdogRefused();
  const made = callBounded(() => store.episodesInOrder(), factoryMs);
  if (!made.ok) return watchdogRefused();
  const iterable = made.result;
  if (iterable && typeof iterable[Symbol.asyncIterator] === "function") {
    // Exotic: a synchronous factory returned an async iterable. Its
    // post-await continuations would resume on this thread — delegate to
    // the worker boundary (the factory is re-executed there from source).
    return drainAsyncInWorker(store, host, q, workerOpts);
  }

  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    if (timer.unref) timer.unref();
  });
  const workPromise = (async () => {
    const episodes = [];
    // Iterator acquisition under the preemptive boundary (sync iterators
    // only from here: async iterables were routed to the worker above).
    const acqMs = deadline - Date.now();
    if (acqMs <= 0) return watchdogRefused();
    const acquired = callBounded(() => {
      const syncIt =
        iterable && typeof iterable[Symbol.iterator] === "function" ? iterable[Symbol.iterator]() : null;
      if (!syncIt) {
        throw new TypeError("store.episodesInOrder() must return an iterable");
      }
      return { syncIt };
    }, acqMs);
    if (!acquired.ok) return watchdogRefused();
    const { syncIt } = acquired.result;
    try {
      for (;;) {
        if (Date.now() > deadline) return watchdogRefused();
        // Preemptive boundary: a synchronous hang inside next() is
        // interrupted by V8 instead of blocking the event loop.
        const advanced = nextSyncBounded(syncIt, deadline - Date.now());
        if (!advanced.ok) return watchdogRefused();
        const step = advanced.result;
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
    try {
      return matchAndProject(episodes, host, q, state, budget);
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

/**
 * True for async generator functions and async functions: their bodies
 * can suspend at an await and resume later, so their continuations can
 * execute outside any timed region on the calling thread. Such stores
 * must drain off-thread (drainAsyncInWorker).
 */
function isAsyncFactory(fn) {
  if (typeof fn !== "function") return false;
  const name = fn.constructor && fn.constructor.name;
  return name === "AsyncGeneratorFunction" || name === "AsyncFunction";
}

/**
 * Worker-thread drain for asynchronous stores (EMEM-001b).
 *
 * The store's factory is re-executed inside a dedicated worker thread
 * (recallWorker.mjs) from its source text; the worker drives the
 * (async) iterator there and streams raw episodes back. The caller's
 * thread stays free for the whole drain, so the caller's own timer is
 * the enforcement mechanism — it does not depend on the (possibly
 * blocked) worker thread's event loop:
 *
 * - Per-candidate consultation is charged centrally here, before the
 *   worker is allowed to keep the candidate (one RPC per candidate).
 * - On timeout the worker is TERMINATED, not merely ignored: a
 *   post-await busy loop blocking the worker thread is destroyed, and
 *   its eventual settlement can never surface as late domain output.
 * - A store whose factory cannot be reconstructed across the boundary
 *   is refused with STORE_BOUNDARY_REFUSED.
 *
 * Match/project runs here on the caller's thread after the drain, with
 * the task's aggregate budget (drain charges already applied).
 */
async function drainAsyncInWorker(store, host, q, opts) {
  const { timeoutMs, startMs, budget, state, watchdogRefused } = opts;
  let worker;
  try {
    worker = new Worker(new URL("./recallWorker.mjs", import.meta.url), {
      workerData: { fnSource: store.episodesInOrder.toString() },
    });
  } catch (err) {
    return {
      result: "REFUSED",
      code: ENG_CODES.STORE_BOUNDARY_REFUSED,
      consulted: state.consulted,
      suppressed: state.suppressed,
    };
  }
  const outcome = await new Promise((resolve) => {
    let done = false;
    let timer;
    const finish = (value) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    timer = setTimeout(() => {
      // The worker thread may be blocked indefinitely (e.g. a busy loop
      // after an await). This timer runs on the CALLER's thread, which is
      // free — terminate the worker so no late domain output can surface.
      worker.terminate().catch(() => {});
      finish(watchdogRefused());
    }, Math.max(1, Math.floor(timeoutMs)));
    if (timer.unref) timer.unref();
    worker.on("message", (msg) => {
      if (done || !msg || typeof msg !== "object") return;
      if (msg.t === "consultCandidate") {
        // Central charge-before-inspect: the worker holds the raw
        // candidate but may not keep it until this charge succeeds.
        let ok = true;
        try {
          budget.charge(1, "recall-candidate");
          state.consulted += 1;
        } catch (err) {
          if (err && err.code === ENG_CODES.BUDGET_EXHAUSTED) {
            ok = false;
          } else {
            finish({ threw: err });
            return;
          }
        }
        worker.postMessage({ t: "consultReply", seq: msg.seq, ok });
        return;
      }
      if (msg.t === "drained") {
        if (msg.budgetExhausted) {
          finish({
            result: "REFUSED",
            code: ENG_CODES.BUDGET_EXHAUSTED,
            consulted: state.consulted,
            suppressed: state.suppressed,
          });
          return;
        }
        // Late completion past the deadline is not a success: discard it.
        if (Date.now() - startMs > timeoutMs) {
          finish(watchdogRefused());
          return;
        }
        try {
          finish(matchAndProject(msg.episodes, host, q, state, budget));
        } catch (err) {
          if (err && err.code === ENG_CODES.BUDGET_EXHAUSTED) {
            finish({
              result: "REFUSED",
              code: ENG_CODES.BUDGET_EXHAUSTED,
              consulted: state.consulted,
              suppressed: state.suppressed,
            });
          } else {
            finish({ threw: err });
          }
        }
        return;
      }
      if (msg.t === "drainError") {
        if (msg.code === ENG_CODES.STORE_BOUNDARY_REFUSED) {
          finish({
            result: "REFUSED",
            code: ENG_CODES.STORE_BOUNDARY_REFUSED,
            consulted: state.consulted,
            suppressed: state.suppressed,
          });
        } else {
          finish({ threw: new Error(msg.message || "store drain failed in worker") });
        }
        return;
      }
    });
    worker.on("error", (err) => finish({ threw: err }));
    // Fail closed: a worker that exits without reporting is treated as
    // a watchdog exhaustion, never as a silent success.
    worker.on("exit", () => finish(watchdogRefused()));
  });
  // The worker must be dead before returning: termination (not merely
  // ignoring its messages) is what proves no late domain output.
  try {
    await worker.terminate();
  } catch {
    // Already dead.
  }
  if (outcome && outcome.threw) throw outcome.threw;
  return outcome;
}
