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
//   repo-relative), expectedPriorBlob, payload, payloadHash (SHA-256 of the
//   canonical payload), state, lease, attempts, deliveryReceipt, createdAt.
// States: PENDING, CLAIMED, DELIVERED. There is no FAILED state: a refused
// delivery stays CLAIMED with lastError set, so nothing is ever silently
// dropped or retried blindly.

import { createHash } from "node:crypto";
import { CODES, fail, P3_CODES } from "./errors.mjs";
import { stableStringify } from "../report/stableStringify.mjs";
import { assertNonEmptyString, utcIsoToMs } from "../ledger/validation.mjs";

export const OUTBOX_LEASE_MS = 15 * 60 * 1000;
export const DEFAULT_ALLOWED_PATH_PREFIXES = ["results/", "commands/"];

export function canonicalPayloadHash(payload) {
  return createHash("sha256").update(stableStringify(payload), "utf8").digest("hex");
}

function validatePath(targetPath, allowedPathPrefixes) {
  assertNonEmptyString(targetPath, "outbox.targetPath");
  if (targetPath.startsWith("/") || targetPath.split("/").includes("..")) {
    fail(P3_CODES.DISALLOWED_PATH, `Outbox path ${targetPath} is not repo-relative`, { targetPath });
  }
  if (!allowedPathPrefixes.some((prefix) => targetPath.startsWith(prefix))) {
    fail(P3_CODES.DISALLOWED_PATH, `Outbox path ${targetPath} is outside the allowlist`, { targetPath });
  }
}

export function enqueueOutbox(entries, entry, { allowedPathPrefixes = DEFAULT_ALLOWED_PATH_PREFIXES } = {}) {
  const { operationId, targetRepo, targetPath, expectedPriorBlob, payload, createdAt } = entry || {};
  assertNonEmptyString(operationId, "outbox.operationId");
  assertNonEmptyString(targetRepo, "outbox.targetRepo");
  validatePath(targetPath, allowedPathPrefixes);
  assertNonEmptyString(expectedPriorBlob, "outbox.expectedPriorBlob");
  utcIsoToMs(createdAt, `outbox.createdAt for ${operationId}`);
  if (payload === undefined) {
    fail(P3_CODES.INVALID_OUTBOX_ENTRY, `Outbox entry ${operationId} requires a payload`, { operationId });
  }
  const payloadHash = canonicalPayloadHash(payload);
  const existing = (entries || []).find((e) => e.operationId === operationId);
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      fail(CODES.CONFLICTING_REPLAY, `Outbox operation ${operationId} replayed with a different payload`, {
        operationId,
      });
    }
    return { entries, entry: existing, deduped: true };
  }
  const next = {
    operationId,
    targetRepo,
    targetPath,
    expectedPriorBlob,
    payload,
    payloadHash,
    state: "PENDING",
    lease: null,
    attempts: 0,
    deliveryReceipt: null,
    lastError: null,
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

// Claim an entry for delivery. An expired lease is reclaimable by a new
// owner at a bumped generation; a live lease held by another owner refuses
// with LEASE_HELD. Claiming an already-delivered entry returns its
// receipt without re-applying anything.
export function claimOutbox({ entries, operationId, owner, now }) {
  const entry = requireEntry(entries, operationId);
  if (entry.state === "DELIVERED") {
    return { entries, entry, receipt: entry.deliveryReceipt, alreadyDelivered: true };
  }
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
// identity (priorBlob actually seen, newBlob written, head, path). A prior
// blob that differs from the expected prior blob is a divergent file: the
// delivery is refused with CAS_CONFLICT and the entry stays CLAIMED for
// revalidation — never marked failed, never silently retried. A lost
// reply (re-recording an already-delivered operation) returns the
// existing receipt with no duplicate effect.
export function recordDelivery({ entries, operationId, owner, generation, gitResponse, now }) {
  const entry = requireEntry(entries, operationId);
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
  const response = gitResponse || {};
  if (response.path !== entry.targetPath) {
    fail(P3_CODES.PATH_MISMATCH, `Git response path ${String(response.path)} does not match outbox target ${entry.targetPath}`, {
      operationId,
      targetPath: entry.targetPath,
    });
  }
  assertNonEmptyString(response.newBlob, `gitResponse.newBlob for ${operationId}`);
  assertNonEmptyString(response.head, `gitResponse.head for ${operationId}`);
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
