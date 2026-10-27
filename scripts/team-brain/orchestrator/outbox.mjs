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
//   (SHA-256 of the canonical payload), sourceTaskId (optional binding
//   to the controller task this intent serves, for stale-intent
//   cancellation), state, lease, attempts, deliveryReceipt, createdAt.
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

import { createHash } from "node:crypto";
import { CODES, fail, P3_CODES } from "./errors.mjs";
import { stableStringify } from "../report/stableStringify.mjs";
import { assertNonEmptyString, utcIsoToMs } from "../ledger/validation.mjs";

export const OUTBOX_LEASE_MS = 15 * 60 * 1000;
export const DEFAULT_ALLOWED_PATH_PREFIXES = ["results/", "commands/"];
export const DEFAULT_ALLOWED_REPOS = ["onyxgolden/forge-ai-drop"];
const GIT_RESPONSE_KEYS = ["repo", "priorBlob", "newBlob", "head", "path"];

export function canonicalPayloadHash(payload) {
  return createHash("sha256").update(stableStringify(payload), "utf8").digest("hex");
}

// Detached snapshot: the entry owns its payload bytes, so a caller
// mutating its object after enqueue cannot drift admitted intent
// (TBP3-002). Canonical form is preserved, so the hash is unchanged.
function clonePayload(payload) {
  return JSON.parse(stableStringify(payload));
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
  const existing = (entries || []).find((e) => e.operationId === operationId);
  if (existing) {
    // Replay binds the ENTIRE immutable write intent (TBP3-002): a
    // changed destination, prior-state expectation, or payload is a
    // conflicting replay, never a silent receipt for a different intent.
    // Only an exact replay returns the existing entry.
    const diffs = [];
    if (existing.targetRepo !== targetRepo) diffs.push("targetRepo");
    if (existing.targetPath !== targetPath) diffs.push("targetPath");
    if (existing.expectedPriorBlob !== expectedPriorBlob) diffs.push("expectedPriorBlob");
    if (existing.payloadHash !== payloadHash) diffs.push("payload");
    if (diffs.length > 0) {
      fail(
        CODES.CONFLICTING_REPLAY,
        `Outbox operation ${operationId} replayed with a different ${diffs.join(", ")}`,
        { operationId, diffs },
      );
    }
    return { entries, entry: existing, deduped: true };
  }
  const sourceTaskId =
    typeof entry.sourceTaskId === "string" && entry.sourceTaskId.length > 0
      ? entry.sourceTaskId
      : payloadSnapshot !== null && typeof payloadSnapshot === "object" && !Array.isArray(payloadSnapshot) && typeof payloadSnapshot.taskId === "string"
        ? payloadSnapshot.taskId
        : null;
  const next = {
    operationId,
    targetRepo,
    targetPath,
    expectedPriorBlob,
    payload: payloadSnapshot,
    payloadHash,
    sourceTaskId,
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

// An intent bound to a terminal (answered) task is stale: it must never
// be leased for delivery on applicability grounds (TBP3-006). Callers
// that know task state pass `tasks`; callers that don't use
// cancelOutboxForTask after answering instead.
function checkIntentApplicability(entry, tasks) {
  if (!tasks || !entry.sourceTaskId) return;
  const task = tasks.find((t) => t.id === entry.sourceTaskId);
  if (task && (task.status === "DONE" || task.status === "ESCALATED")) {
    fail(P3_CODES.STALE_INTENT, `Outbox operation ${entry.operationId} is stale: source task ${entry.sourceTaskId} is ${task.status}`, {
      operationId: entry.operationId,
      sourceTaskId: entry.sourceTaskId,
    });
  }
}

// Cancel every still-unsent (PENDING) intent bound to a task — the
// answer-before-claim boundary (TBP3-006). In-flight (CLAIMED) intents
// are left alone; delivery gating (recordDelivery with tasks) refuses
// them on stale applicability instead. DELIVERED and already-CANCELLED
// entries are untouched.
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
  checkPayloadConsistency(entry);
  checkIntentApplicability(entry, tasks);
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
  checkIntentApplicability(entry, tasks);
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
