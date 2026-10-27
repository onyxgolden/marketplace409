// Team Brain slice 3 — coordination outbox.
//
// Durable, idempotent delivery records for Git-bound coordination writes.
// There is NO send adapter in this module: no notification, browser, or
// network send exists here, and callers record deliveries by supplying the
// Git response (blob/head) they observed in the sandbox. An unknown
// delivery is never treated as failed or safe-to-repeat: a CAS conflict
// leaves the entry CLAIMED for revalidation, and a lost reply replays the
// existing receipt instead of duplicating the effect.
//
// Entry fields:
//   operationId (idempotency key), targetRepo, targetPath (allowlisted,
//   canonical, repo-relative), expectedPriorBlob, payload (detached
//   snapshot owned by the entry, never the caller's object), payloadHash
//   (SHA-256 of the canonical payload), sourceTaskId (binding to the
//   controller task this intent serves, when task-derived),
//   sourceTaskRevision (the task's applicability token at bind time,
//   required for task-derived intents), state, lease, attempts,
//   deliveryReceipt, createdAt.
// States: PENDING, CLAIMED, DELIVERED, CANCELLED. There is no FAILED
// state: a refused delivery stays CLAIMED with lastError set, so nothing
// is ever silently dropped or retried blindly. CANCELLED marks an unsent
// intent whose source task was answered; it can never be claimed or
// delivered afterward.
//
// Fix round 1 (TBP3-002/006/009): replay binds the entire immutable write
// intent (destination, prior-state expectation, payload bytes); delivery
// validates the observed repo identity against a closed Git-response
// schema; destinations come from a host-injected allowlist with canonical
// paths; intents bound to answered tasks are cancelled while unsent and
// gated at claim/delivery while in flight.
//
// Fix round 2 (TBP3-006A): the task binding is complete and enforced, not
// optional. A task-derived intent must carry source task identity PLUS a
// revision/applicability token, both are part of replay identity, and
// claim/delivery require current applicability against the authoritative
// task collection with no nullable bypass. cancelOutboxForTask remains a
// convenience for eager cancellation; correctness never depends on it.
//
// Fix round 3 (TBP3-006B): the explicit binding and the payload task
// identity must agree exactly. enqueueOutbox refuses a contradictory or
// malformed binding at admission (before dedup/replay), and claim/delivery
// revalidate the stored binding, so legacy persisted entries that carry
// the same contradiction fail closed instead of claiming or delivering.

import { createHash } from "node:crypto";
import { CODES, fail, P3_CODES } from "./errors.mjs";
import { stableStringify } from "../report/stableStringify.mjs";
import { assertNonEmptyString, utcIsoToMs } from "../ledger/validation.mjs";

export const OUTBOX_LEASE_MS = 15 * 60 * 1000;
export const DEFAULT_ALLOWED_PATH_PREFIXES = ["results/", "commands/"];
export const DEFAULT_ALLOWED_REPOS = ["onyxgolden/forge-ai-drop"];
const GIT_RESPONSE_KEYS = ["repo", "priorBlob", "newBlob", "head", "path"];
const TERMINAL_TASK_STATUSES = new Set(["DONE", "ESCALATED"]);

// The applicability token bound to a task-derived intent: the task's
// monotonic fencing epoch plus its controller snapshot revision (fix
// round 2, TBP3-006A). Both are controller-produced revision counters:
// reassignment bumps the epoch, a snapshot advance bumps the revision,
// and terminal status is checked separately. Goal/scope are never
// mutated by controller transitions, so these two counters cover every
// meaning change the controller can produce. Callers bind with this
// helper at enqueue time; claim/delivery recompute it from the
// authoritative task record and require equality.
export function taskApplicabilityToken(task) {
  const epoch = Number.isInteger(task?.assignmentEpoch) ? task.assignmentEpoch : 0;
  const snapshot = Number.isInteger(task?.snapshotRevision) ? task.snapshotRevision : 0;
  return `${epoch}:${snapshot}`;
}

export function canonicalPayloadHash(payload) {
  return createHash("sha256").update(stableStringify(payload), "utf8").digest("hex");
}

// Detached snapshot: the entry owns its payload bytes, so a caller
// mutating its object after enqueue cannot drift admitted intent
// (TBP3-002). Canonical form is preserved, so the hash is unchanged.
function clonePayload(payload) {
  return JSON.parse(stableStringify(payload));
}

// A payload task identity under this contract: a nonempty taskId string
// carried by a plain-object payload (fix round 3, TBP3-006B). Anything
// else — absent, empty, non-string, or a non-object payload — is not a
// task identity and carries no binding meaning, so it can neither agree
// nor disagree with an explicit binding.
function payloadTaskIdentity(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  return typeof payload.taskId === "string" && payload.taskId.length > 0 ? payload.taskId : null;
}

// The stored task binding of an entry, revalidated at claim/delivery
// (fix round 3, TBP3-006B). Legacy persisted entries predate the
// admission equality rule and can carry a sourceTaskId that disagrees
// with the task their payload names — or a payload that names a task
// while the entry carries no binding at all, which would otherwise bypass
// applicability entirely. Either shape fails closed here, before
// applicability, lease, or payload checks, so a contradictory entry can
// never claim or deliver. Entries whose payload names no task are
// unaffected.
function checkStoredTaskBinding(entry) {
  const payloadIdentity = payloadTaskIdentity(entry.payload);
  if (!payloadIdentity) return;
  if (entry.sourceTaskId !== payloadIdentity) {
    fail(
      P3_CODES.CONFLICTING_TASK_BINDING,
      `Outbox operation ${entry.operationId} stored task binding conflicts with its payload task identity (bound ${entry.sourceTaskId ?? "none"}, payload ${payloadIdentity})`,
      {
        operationId: entry.operationId,
        sourceTaskId: entry.sourceTaskId ?? null,
        payloadTaskId: payloadIdentity,
      },
    );
  }
}

function validatePath(targetPath, allowedPathPrefixes) {
  assertNonEmptyString(targetPath, "outbox.targetPath");
  const segments = targetPath.split("/");
  if (targetPath.startsWith("/") || segments.includes("..")) {
    fail(P3_CODES.DISALLOWED_PATH, `Outbox path ${targetPath} is not repo-relative`, { targetPath });
  }
  if (targetPath.includes("\\") || segments.some((s) => s === "" || s === ".")) {
    fail(P3_CODES.DISALLOWED_PATH, `Outbox path ${targetPath} is not canonical`, { targetPath });
  }
  if (!allowedPathPrefixes.some((prefix) => targetPath.startsWith(prefix))) {
    fail(P3_CODES.DISALLOWED_PATH, `Outbox path ${targetPath} is outside the allowlist`, { targetPath });
  }
}

export function enqueueOutbox(
  entries,
  entry,
  { allowedPathPrefixes = DEFAULT_ALLOWED_PATH_PREFIXES, allowedRepos = DEFAULT_ALLOWED_REPOS } = {},
) {
  const { operationId, targetRepo, targetPath, expectedPriorBlob, payload, createdAt } = entry || {};
  assertNonEmptyString(operationId, "outbox.operationId");
  assertNonEmptyString(targetRepo, "outbox.targetRepo");
  // Destination policy is host-injected and enforced before admission,
  // hashing, or dedup; request content can never expand it (TBP3-009).
  if (!allowedRepos.includes(targetRepo)) {
    fail(P3_CODES.DISALLOWED_REPO, `Outbox repo ${targetRepo} is not in the destination allowlist`, {
      targetRepo,
    });
  }
  validatePath(targetPath, allowedPathPrefixes);
  assertNonEmptyString(expectedPriorBlob, "outbox.expectedPriorBlob");
  utcIsoToMs(createdAt, `outbox.createdAt for ${operationId}`);
  if (payload === undefined) {
    fail(P3_CODES.INVALID_OUTBOX_ENTRY, `Outbox entry ${operationId} requires a payload`, { operationId });
  }
  const payloadSnapshot = clonePayload(payload);
  const payloadHash = canonicalPayloadHash(payloadSnapshot);
  // The task binding is computed BEFORE the replay check, so it is part
  // of replay identity (fix round 2, TBP3-006A): a replay may not
  // rebind an operation ID to a different source task or revision.
  // Fix round 3 (TBP3-006B): when both an explicit binding and a payload
  // task identity are present they must agree exactly, before admission
  // or replay. Neither silently wins: a contradiction is refused here,
  // so an intent whose payload names an already-answered task can never
  // bind its applicability to an unrelated live task. An explicit
  // binding that is supplied but is not a nonempty string is likewise
  // malformed, never silently ignored in favour of inference. Otherwise
  // the explicit binding wins when present, and a payload taskId is
  // inferred, as in fix round 1.
  const explicitTaskId =
    typeof entry.sourceTaskId === "string" && entry.sourceTaskId.length > 0 ? entry.sourceTaskId : null;
  if (entry.sourceTaskId !== undefined && entry.sourceTaskId !== null && explicitTaskId === null) {
    fail(
      P3_CODES.CONFLICTING_TASK_BINDING,
      `Outbox entry ${operationId} has a malformed explicit task binding (sourceTaskId must be a nonempty string when supplied)`,
      { operationId, sourceTaskId: entry.sourceTaskId },
    );
  }
  const inferredTaskId = payloadTaskIdentity(payloadSnapshot);
  if (explicitTaskId && inferredTaskId && explicitTaskId !== inferredTaskId) {
    fail(
      P3_CODES.CONFLICTING_TASK_BINDING,
      `Outbox entry ${operationId} binds conflicting task identities (explicit ${explicitTaskId}, payload ${inferredTaskId})`,
      { operationId, sourceTaskId: explicitTaskId, payloadTaskId: inferredTaskId },
    );
  }
  const sourceTaskId = explicitTaskId ?? inferredTaskId;
  const sourceTaskRevision =
    typeof entry.sourceTaskRevision === "string" && entry.sourceTaskRevision.length > 0
      ? entry.sourceTaskRevision
      : Number.isInteger(entry.sourceTaskRevision)
        ? String(entry.sourceTaskRevision)
        : null;
  // A task-derived intent with an incomplete binding is refused at
  // admission, never admitted with a null binding that later claims
  // could skip past. Non-task-derived intents (no source task at all)
  // need no revision.
  if (sourceTaskId && sourceTaskRevision === null) {
    fail(
      P3_CODES.INVALID_OUTBOX_ENTRY,
      `Outbox entry ${operationId} is task-derived (source task ${sourceTaskId}) and requires sourceTaskRevision`,
      { operationId, sourceTaskId },
    );
  }
  const existing = (entries || []).find((e) => e.operationId === operationId);
  if (existing) {
    // Replay binds the ENTIRE immutable write intent (TBP3-002) plus
    // the task binding (TBP3-006A): a changed destination, prior-state
    // expectation, payload, source task, or revision is a conflicting
    // replay, never a silent receipt for a different intent. Only an
    // exact replay returns the existing entry.
    const diffs = [];
    if (existing.targetRepo !== targetRepo) diffs.push("targetRepo");
    if (existing.targetPath !== targetPath) diffs.push("targetPath");
    if (existing.expectedPriorBlob !== expectedPriorBlob) diffs.push("expectedPriorBlob");
    if (existing.payloadHash !== payloadHash) diffs.push("payload");
    if (existing.sourceTaskId !== sourceTaskId) diffs.push("sourceTaskId");
    if ((existing.sourceTaskRevision ?? null) !== sourceTaskRevision) diffs.push("sourceTaskRevision");
    if (diffs.length > 0) {
      fail(
        CODES.CONFLICTING_REPLAY,
        `Outbox operation ${operationId} replayed with a different ${diffs.join(", ")}`,
        { operationId, diffs },
      );
    }
    return { entries, entry: existing, deduped: true };
  }
  const next = {
    operationId,
    targetRepo,
    targetPath,
    expectedPriorBlob,
    payload: payloadSnapshot,
    payloadHash,
    sourceTaskId,
    sourceTaskRevision,
    state: "PENDING",
    lease: null,
    attempts: 0,
    deliveryReceipt: null,
    lastError: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt,
  };
  return { entries: [...(entries || []), next], entry: next, deduped: false };
}

function requireEntry(entries, operationId) {
  const entry = (entries || []).find((e) => e.operationId === operationId);
  if (!entry) fail(P3_CODES.INVALID_OUTBOX_ENTRY, `Unknown outbox operation ${operationId}`, { operationId });
  return entry;
}

function replaceEntry(entries, next) {
  return entries.map((e) => (e.operationId === next.operationId ? next : e));
}

// A stored payload whose bytes no longer match its pinned hash is drift,
// not an intent: refuse the transition rather than delivering something
// other than what was admitted.
function checkPayloadConsistency(entry) {
  if (canonicalPayloadHash(entry.payload) !== entry.payloadHash) {
    fail(P3_CODES.PAYLOAD_DRIFT, `Outbox operation ${entry.operationId} payload no longer matches its pinned hash`, {
      operationId: entry.operationId,
    });
  }
}

// A task-derived intent must prove current applicability at claim and
// delivery (fix round 2, TBP3-006A). There is NO nullable bypass: a
// task-derived entry claimed or delivered without the authoritative
// task collection is refused, a source task missing from that
// collection is refused, a terminal source task is stale, and a
// revision-token mismatch (reassignment or snapshot advance since
// binding) is stale. Non-task-derived intents (no source task) have
// nothing to check. cancelOutboxForTask remains a convenience for eager
// cancellation; correctness never depends on a caller invoking it.
function checkIntentApplicability(entry, tasks) {
  if (!entry.sourceTaskId) return;
  if (!tasks) {
    fail(
      P3_CODES.APPLICABILITY_REQUIRED,
      `Outbox operation ${entry.operationId} is task-derived (source task ${entry.sourceTaskId}) and requires the current task collection at claim/delivery`,
      { operationId: entry.operationId, sourceTaskId: entry.sourceTaskId },
    );
  }
  const task = tasks.find((t) => t.id === entry.sourceTaskId);
  if (!task) {
    fail(
      P3_CODES.UNKNOWN_TASK,
      `Outbox operation ${entry.operationId} source task ${entry.sourceTaskId} is not in the supplied task collection`,
      { operationId: entry.operationId, sourceTaskId: entry.sourceTaskId },
    );
  }
  if (TERMINAL_TASK_STATUSES.has(task.status)) {
    fail(P3_CODES.STALE_INTENT, `Outbox operation ${entry.operationId} is stale: source task ${entry.sourceTaskId} is ${task.status}`, {
      operationId: entry.operationId,
      sourceTaskId: entry.sourceTaskId,
    });
  }
  if (entry.sourceTaskRevision == null || taskApplicabilityToken(task) !== entry.sourceTaskRevision) {
    fail(
      P3_CODES.STALE_INTENT,
      `Outbox operation ${entry.operationId} is stale: source task ${entry.sourceTaskId} revision mismatch (bound ${entry.sourceTaskRevision ?? "none"}, current ${taskApplicabilityToken(task)})`,
      { operationId: entry.operationId, sourceTaskId: entry.sourceTaskId },
    );
  }
}

// Cancel every still-unsent (PENDING) intent bound to a task — an eager
// convenience, not a safety boundary (fix round 2, TBP3-006A).
// In-flight (CLAIMED) intents are left alone; claim/delivery gating
// refuses them on stale applicability instead. DELIVERED and
// already-CANCELLED entries are untouched.
export function cancelOutboxForTask(entries, taskId, now) {
  utcIsoToMs(now, "now");
  const cancelled = [];
  const next = (entries || []).map((e) => {
    if (e.state === "PENDING" && e.sourceTaskId === taskId) {
      cancelled.push(e.operationId);
      return { ...e, state: "CANCELLED", lease: null, cancelledAt: now, cancelReason: "TASK_ANSWERED" };
    }
    return e;
  });
  return { entries: next, cancelled };
}

// Claim an entry for delivery. An expired lease is reclaimable by a new
// owner at a bumped generation; a live lease held by another owner refuses
// with LEASE_HELD. Claiming an already-delivered entry returns its
// receipt without re-applying anything. Cancelled intents refuse.
export function claimOutbox({ entries, operationId, owner, now, tasks = null }) {
  const entry = requireEntry(entries, operationId);
  if (entry.state === "CANCELLED") {
    fail(P3_CODES.INTENT_CANCELLED, `Outbox operation ${operationId} was cancelled (source task answered)`, {
      operationId,
    });
  }
  if (entry.state === "DELIVERED") {
    return { entries, entry, receipt: entry.deliveryReceipt, alreadyDelivered: true };
  }
  // Applicability is checked before lease handling: a stale intent must
  // never advance, regardless of lease state (fix round 2, TBP3-006A).
  // The stored binding is revalidated first (fix round 3, TBP3-006B):
  // a legacy contradictory entry fails on its binding, not as stale.
  checkStoredTaskBinding(entry);
  checkIntentApplicability(entry, tasks);
  checkPayloadConsistency(entry);
  const nowMs = utcIsoToMs(now, "now");
  assertNonEmptyString(owner, "outbox.claim owner");
  if (entry.lease && nowMs < utcIsoToMs(entry.lease.expiresAt, `outbox lease for ${operationId}`)) {
    if (entry.lease.owner !== owner) {
      fail(P3_CODES.LEASE_HELD, `Outbox operation ${operationId} is leased to ${entry.lease.owner}`, {
        operationId,
        owner: entry.lease.owner,
      });
    }
    return { entries, entry, lease: entry.lease, alreadyClaimed: true };
  }
  const generation = (entry.lease?.generation || 0) + 1;
  const lease = {
    leaseId: `${operationId}:${generation}`,
    owner,
    generation,
    issuedAt: now,
    expiresAt: new Date(nowMs + OUTBOX_LEASE_MS).toISOString(),
  };
  const next = { ...entry, state: "CLAIMED", lease, attempts: entry.attempts + 1, lastError: null };
  return { entries: replaceEntry(entries, next), entry: next, lease, alreadyClaimed: false };
}

// Record an observed Git delivery. The caller supplies the readback
// identity (repo, priorBlob actually seen, newBlob written, head, path)
// under a closed, correctly typed schema (TBP3-002): the observed repo
// must equal the intended repo, the path must match, and a prior blob
// that differs from the expected prior blob is a divergent file — the
// delivery is refused with CAS_CONFLICT and the entry stays CLAIMED for
// revalidation, never marked failed, never silently retried. A lost
// reply (re-recording an already-delivered operation) returns the
// existing receipt with no duplicate effect.
export function recordDelivery({ entries, operationId, owner, generation, gitResponse, now, tasks = null }) {
  const entry = requireEntry(entries, operationId);
  if (entry.state === "CANCELLED") {
    fail(P3_CODES.INTENT_CANCELLED, `Outbox operation ${operationId} was cancelled (source task answered)`, {
      operationId,
    });
  }
  if (entry.state === "DELIVERED") {
    return { entries, entry, receipt: entry.deliveryReceipt, alreadyDelivered: true };
  }
  // Applicability precedes lease handling: a stale intent is refused as
  // stale even when the lease is also wrong (fix round 2, TBP3-006A).
  // The stored binding is revalidated first (fix round 3, TBP3-006B).
  checkStoredTaskBinding(entry);
  checkIntentApplicability(entry, tasks);
  if (entry.state !== "CLAIMED" || !entry.lease || entry.lease.owner !== owner || entry.lease.generation !== generation) {
    fail(P3_CODES.STALE_LEASE, `Outbox claim for ${operationId} does not match owner/generation`, {
      operationId,
      owner,
      generation,
    });
  }
  const nowMs = utcIsoToMs(now, "now");
  if (nowMs >= utcIsoToMs(entry.lease.expiresAt, `outbox lease for ${operationId}`)) {
    fail(P3_CODES.LEASE_EXPIRED, `Outbox lease for ${operationId} expired`, { operationId });
  }
  checkPayloadConsistency(entry);
  const response = gitResponse || {};
  for (const key of Object.keys(response)) {
    if (!GIT_RESPONSE_KEYS.includes(key)) {
      fail(P3_CODES.INVALID_OUTBOX_ENTRY, `Git response for ${operationId} has unknown field ${key}`, {
        operationId,
        field: key,
      });
    }
  }
  assertNonEmptyString(response.repo, `gitResponse.repo for ${operationId}`);
  assertNonEmptyString(response.priorBlob, `gitResponse.priorBlob for ${operationId}`);
  assertNonEmptyString(response.newBlob, `gitResponse.newBlob for ${operationId}`);
  assertNonEmptyString(response.head, `gitResponse.head for ${operationId}`);
  assertNonEmptyString(response.path, `gitResponse.path for ${operationId}`);
  if (response.repo !== entry.targetRepo) {
    fail(P3_CODES.REPO_MISMATCH, `Git response repo ${response.repo} does not match outbox target ${entry.targetRepo}`, {
      operationId,
      targetRepo: entry.targetRepo,
    });
  }
  if (response.path !== entry.targetPath) {
    fail(P3_CODES.PATH_MISMATCH, `Git response path ${String(response.path)} does not match outbox target ${entry.targetPath}`, {
      operationId,
      targetPath: entry.targetPath,
    });
  }
  if (response.priorBlob !== entry.expectedPriorBlob) {
    const next = { ...entry, lastError: P3_CODES.CAS_CONFLICT };
    return {
      entries: replaceEntry(entries, next),
      entry: next,
      refused: { code: P3_CODES.CAS_CONFLICT, expectedPriorBlob: entry.expectedPriorBlob, priorBlob: response.priorBlob },
    };
  }
  const receipt = {
    operationId,
    targetRepo: entry.targetRepo,
    targetPath: entry.targetPath,
    priorBlob: entry.expectedPriorBlob,
    newBlob: response.newBlob,
    head: response.head,
    payloadHash: entry.payloadHash,
    deliveredAt: now,
  };
  const next = { ...entry, state: "DELIVERED", lease: null, deliveryReceipt: receipt, lastError: null };
  return { entries: replaceEntry(entries, next), entry: next, receipt, alreadyDelivered: false };
}
