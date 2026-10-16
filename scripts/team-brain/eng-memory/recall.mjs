// Team Brain eng-memory slice 1 — recall (read-only retrieval) adapter.
// Pure apart from the injected store. No I/O, no network, no model calls.
//
// Recall consults admitted episodes only. Rules:
//
//  - Every consulted candidate is CHARGED BEFORE its fields are inspected.
//    Max 64 consulted candidates per recall; exceeding it refuses the whole
//    task with BUDGET_EXHAUSTED and NO partial domain output.
//  - 5s task watchdog. The sync core uses a cooperative injected clock;
//    the async host entrypoint (recallAsync) adds a REAL timer: a hung or
//    slow async iterator is terminated by Promise.race, returning
//    WATCHDOG_EXHAUSTED with no partial output. (A synchronous infinite
//    loop on the calling thread cannot be preempted in Node.js —
//    documented, not claimed otherwise.)
//  - Results are capped at 20 candidates, deterministically ranked:
//    eventAt (integer epoch-ms) descending, then episodeId ascending.
//  - Revoked/denied sources are suppressed from retrieval, and read
//    permission is revalidated at recall time against the CURRENT host
//    config (approved repos/paths + registered source tuples) — removal of
//    an approved read path suppresses, it does not keep serving.
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
import { QUERY_KEY_SPECS, assertHostConfig, validateQuerySnapshot } from "./schemas.mjs";
import { stableStringify } from "../report/stableStringify.mjs";

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
 * config — removing an approved repo/path or unregistering the (repo,path)
 * tuple suppresses retrieval of already-stored episodes. Historical
 * submitter attribution stays historical; it is never treated as current
 * approval.
 */
export function hasReadPermission(ep, host) {
  const key = sourceKey(ep.source.repo, ep.source.path);
  if (host.deniedSources && host.deniedSources.has(key)) return false;
  if (host.revokedSources && host.revokedSources.has(key)) return false;
  if (!host.approvedRepos.has(ep.source.repo)) return false;
  if (!host.approvedPaths.has(ep.source.path)) return false;
  return host.sourceRegistrations.some((reg) => reg.repo === ep.source.repo && reg.path === ep.source.path);
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
  // and flag groups whose statuses disagree.
  const byTask = new Map();
  for (const ep of matched) {
    if (!byTask.has(ep.taskId)) byTask.set(ep.taskId, []);
    byTask.get(ep.taskId).push(ep);
  }
  const TERMINAL = new Set(["COMPLETE", "REVOKED", "SUPERSEDED"]);
  const conflictIds = new Set();
  for (const eps of byTask.values()) {
    const current = eps.filter((e) => !TERMINAL.has(e.status));
    const statuses = new Set(current.map((e) => e.status));
    if (statuses.size > 1) {
      for (const e of current) conflictIds.add(e.episodeId);
    }
  }

  // Deterministic ranking: eventAtMs desc, episodeId asc (stable tie-break).
  matched.sort((a, b) =>
    a.eventAtMs !== b.eventAtMs ? b.eventAtMs - a.eventAtMs : a.episodeId < b.episodeId ? -1 : 1,
  );
  const capped = matched.slice(0, RECALL_RESULT_CAP);

  // Detached projection: fresh nested objects on every read, so callers
  // can never rewrite stored provenance through a result alias.
  const results = capped.map((ep) => ({
    episodeId: ep.episodeId,
    taskId: ep.taskId,
    source: {
      repo: ep.source.repo,
      path: ep.source.path,
      pin: { algo: ep.source.pin.algo, id: ep.source.pin.id },
    },
    principal: ep.principal,
    eventAt: ep.eventAt,
    kind: ep.kind,
    status: ep.status,
    attribution: { actor: ep.attribution.actor, authorityRef: ep.attribution.authorityRef },
    conflict: conflictIds.has(ep.episodeId),
    conflictWith: conflictIds.has(ep.episodeId)
      ? [...conflictIds].filter((id) => id !== ep.episodeId && byTask.get(ep.taskId).some((e) => e.episodeId === id)).sort()
      : [],
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
  assertHostConfig(host);
  const clock = opts.clock || (() => Date.now());
  const deadline = clock() + WATCHDOG_MS;
  let q;
  try {
    q = validateQuerySnapshot(admitObject(query, QUERY_KEY_SPECS));
  } catch (err) {
    return { result: "REFUSED", code: err && err.code ? err.code : ENG_CODES.INVALID_QUERY, consulted: 0, suppressed: 0 };
  }

  const budget = new ConsultationBudget();
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
 * Async host entrypoint for recall. Validates the query synchronously
 * (bounded), then drains under a REAL timer: Promise.race between the
 * drain+compute work and a timeout. A hung or slow async iterator is
 * terminated by the timer with WATCHDOG_EXHAUSTED and no partial output.
 * Handles both sync and async store iterables via for-await.
 *
 * Documented limit: a synchronous infinite loop on the calling thread
 * cannot be preempted in Node.js; only async hangs/slow iterators are
 * terminated by the real timer.
 *
 * @param {object} opts - {timeoutMs?: number} (default 5000)
 */
export async function recallAsync(store, host, query, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? WATCHDOG_MS;
  assertHostConfig(host);
  let q;
  try {
    q = validateQuerySnapshot(admitObject(query, QUERY_KEY_SPECS));
  } catch (err) {
    return { result: "REFUSED", code: err && err.code ? err.code : ENG_CODES.INVALID_QUERY, consulted: 0, suppressed: 0 };
  }

  const budget = new ConsultationBudget();
  const deadline = Date.now() + timeoutMs;
  const state = { consulted: 0, suppressed: 0 };
  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    if (timer.unref) timer.unref();
  });
  const workPromise = (async () => {
    const episodes = [];
    try {
      for await (const ep of store.episodesInOrder()) {
        if (Date.now() > deadline) {
          return {
            result: "REFUSED",
            code: ENG_CODES.WATCHDOG_EXHAUSTED,
            consulted: state.consulted,
            suppressed: state.suppressed,
          };
        }
        // Charge BEFORE inspecting the candidate's fields.
        budget.charge(1, "recall-candidate");
        state.consulted += 1;
        episodes.push(ep);
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
    return matchAndProject(episodes, host, q, state);
  })();
  // If the timer wins, the abandoned work must not surface as an
  // unhandled rejection later.
  workPromise.catch(() => {});
  let outcome;
  try {
    outcome = await Promise.race([workPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
  if (outcome && outcome.timedOut) {
    return {
      result: "REFUSED",
      code: ENG_CODES.WATCHDOG_EXHAUSTED,
      consulted: state.consulted,
      suppressed: state.suppressed,
    };
  }
  return outcome;
}
