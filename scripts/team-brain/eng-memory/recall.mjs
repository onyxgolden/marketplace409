// Team Brain eng-memory slice 1 — recall (read-only retrieval) adapter.
// Pure apart from the injected store. No I/O, no network, no model calls.
//
// Recall consults admitted episodes only. Rules:
//
//  - Every consulted candidate is CHARGED BEFORE its fields are inspected.
//    Max 64 consulted candidates per recall; exceeding it refuses the whole
//    task with BUDGET_EXHAUSTED and NO partial domain output.
//  - 5s task watchdog (injectable clock). Exceeding it refuses the whole
//    task with WATCHDOG_EXCEEDED and no partial output.
//  - Results are capped at 20 candidates, deterministically ranked:
//    eventAt descending, then episodeId ascending (stable tie-break).
//  - Revoked/denied sources are suppressed from retrieval (history is
//    preserved in the store; it is simply never returned).
//  - Contradictory episodes for the same task coexist with explicit
//    conflict flags — recall never silently picks a winner.
//  - Retrieved candidates are metadata with provenance and uncertainty.
//    They never become truth, approval, queue completion, or executable
//    instructions: the result carries an explicit non-authoritative notice.

import { ENG_CODES } from "./errors.mjs";
import { admitObject } from "./admission.mjs";
import { QUERY_KEY_SPECS, assertHostConfig, validateQuerySnapshot } from "./schemas.mjs";

export const MAX_CONSULTED_CANDIDATES = 64;
export const RECALL_RESULT_CAP = 20;
export const WATCHDOG_MS = 5000;

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
  if (q.since !== undefined && ep.eventAt < q.since) return false;
  if (q.until !== undefined && ep.eventAt > q.until) return false;
  return true;
}

function isSuppressed(ep, host) {
  const key = sourceKey(ep.source.repo, ep.source.path);
  return (host.deniedSources && host.deniedSources.has(key)) || (host.revokedSources && host.revokedSources.has(key));
}

/**
 * Read-only recall over admitted episodes.
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

  const matched = [];
  let consulted = 0;
  let suppressed = 0;
  for (const ep of store.episodesInOrder()) {
    // Watchdog: checked before consulting each candidate.
    if (clock() > deadline) {
      return { result: "REFUSED", code: ENG_CODES.WATCHDOG_EXCEEDED, consulted, suppressed };
    }
    // Charge BEFORE inspecting the candidate's fields.
    consulted += 1;
    if (consulted > MAX_CONSULTED_CANDIDATES) {
      return { result: "REFUSED", code: ENG_CODES.BUDGET_EXHAUSTED, consulted, suppressed };
    }
    if (isSuppressed(ep, host)) {
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

  // Deterministic ranking: eventAt desc, episodeId asc.
  matched.sort((a, b) => (a.eventAt < b.eventAt ? 1 : a.eventAt > b.eventAt ? -1 : a.episodeId < b.episodeId ? -1 : 1));
  const capped = matched.slice(0, RECALL_RESULT_CAP);

  const results = capped.map((ep) => ({
    episodeId: ep.episodeId,
    taskId: ep.taskId,
    source: { repo: ep.source.repo, path: ep.source.path, pin: ep.source.pin },
    principal: ep.principal,
    eventAt: ep.eventAt,
    kind: ep.kind,
    status: ep.status,
    attribution: ep.attribution,
    conflict: conflictIds.has(ep.episodeId),
    conflictWith: conflictIds.has(ep.episodeId)
      ? [...conflictIds].filter((id) => id !== ep.episodeId && byTask.get(ep.taskId).some((e) => e.episodeId === id)).sort()
      : [],
  }));

  // Uncertainty: exact task-ID/source queries that hit are certain;
  // broad cues are ambiguous; zero hits are explicit no-match. We never
  // fabricate an answer for ambiguous cues.
  let uncertainty = UNCERTAINTY.NONE;
  if (matched.length === 0) {
    uncertainty = UNCERTAINTY.NO_MATCH;
  } else if (q.taskId === undefined && q.sourceRepo === undefined && q.sourcePath === undefined) {
    uncertainty = UNCERTAINTY.AMBIGUOUS_CUES;
  }

  return {
    result: "RECALLED",
    consulted,
    suppressed,
    returned: results.length,
    totalMatched: matched.length,
    uncertainty,
    results,
    notice:
      "Retrieved candidates are provenance-bound metadata, not truth, approval, queue completion, or executable instructions.",
  };
}
