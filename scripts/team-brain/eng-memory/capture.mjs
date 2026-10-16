// Team Brain eng-memory slice 1 — capture (intake) adapter.
// Pure apart from the injected store. No I/O, no network, no model calls.
//
// Capture is metadata-only: it persists pointers (repo/path/pin) and typed
// coordination metadata (taskId, kind, status, attribution, event time).
// It never dereferences source bodies, never reads file contents, never
// follows a pin to bytes. A denied source is refused BEFORE any body read
// could happen — there is no body read at all.
//
// Flow:
//   1. Descriptor-based admission (own data only, zero accessor invocation,
//      unknown fields refused before their values are read).
//   2. Admitted-byte budget: the admitted snapshot must fit 256KiB.
//   3. Closed-schema validation + host authentication (repo/path/principal/
//      authority must all be host-registered; typed provenance required).
//   4. Forbidden-data scan (key fragments + host canary values). Refuse,
//      never redact-and-keep.
//   5. Denied/revoked source check. Denial refuses; revocation refuses and
//      records a retention-review request (history is preserved, retrieval
//      is suppressed).
//   6. Duplicate identity (repo/path/pin/attribution, plus task/kind/
//      principal/event time): exact replay is idempotent — one logical
//      event per identity, so crash/retry cannot double-capture.

import { createHash } from "node:crypto";
import { ENG_CODES, fail } from "./errors.mjs";
import { admitObject } from "./admission.mjs";
import {
  EVENT_KEY_SPECS,
  DENIAL_KEY_SPECS,
  assertHostConfig,
  validateEventSnapshot,
  scanForbidden,
  assertAttribution,
  assertIdString,
} from "./schemas.mjs";
import { assertUtcIso } from "../ledger/validation.mjs";
import { stableStringify } from "../report/stableStringify.mjs";

export const MAX_ADMITTED_BYTES = 262144; // 256KiB
export const EPISODE_ID_PREFIX = "em-";

/** Deterministic source-bound episode ID from the identity components. */
export function episodeIdentity(ev) {
  const canonical = stableStringify([
    ev.source.repo,
    ev.source.path,
    ev.source.pin.algo,
    ev.source.pin.id,
    ev.taskId,
    ev.kind,
    ev.principal,
    ev.attribution.actor,
    ev.attribution.authorityRef,
    ev.eventAt,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function episodeIdFor(identityHash) {
  return `${EPISODE_ID_PREFIX}${identityHash.slice(0, 24)}`;
}

function sourceKey(repo, path) {
  return `${repo}\u0000${path}`;
}

/**
 * Capture one engineering event.
 * @returns {result, code, episodeId?, identityHash?, duplicateOf?}
 * result: "CAPTURED" | "DUPLICATE_REPLAY" | "REFUSED"
 */
export function captureEvent(store, host, input, opts = {}) {
  assertHostConfig(host);
  let snap;
  try {
    snap = admitObject(input, EVENT_KEY_SPECS);
  } catch (err) {
    return refused(err);
  }
  // Admitted-byte budget, charged on the admitted snapshot before any
  // semantic inspection beyond admission.
  let bytes = 0;
  try {
    bytes = Buffer.byteLength(stableStringify(snap), "utf8");
  } catch {
    return { result: "REFUSED", code: ENG_CODES.ADMISSION_TYPE };
  }
  if (bytes > MAX_ADMITTED_BYTES) {
    return { result: "REFUSED", code: ENG_CODES.ADMISSION_BUDGET_EXCEEDED };
  }
  let ev;
  try {
    ev = validateEventSnapshot(snap, host);
  } catch (err) {
    return refused(err);
  }
  try {
    scanForbidden(snap, host);
  } catch (err) {
    return refused(err);
  }
  const key = sourceKey(ev.source.repo, ev.source.path);
  if (host.deniedSources && host.deniedSources.has(key)) {
    return { result: "REFUSED", code: ENG_CODES.DENIED_SOURCE };
  }
  if (host.revokedSources && host.revokedSources.has(key)) {
    store.addRetentionReview({
      reviewId: `rr-${createHash("sha256").update(key, "utf8").digest("hex").slice(0, 16)}`,
      source: { repo: ev.source.repo, path: ev.source.path },
      requestedAt: ev.eventAt,
      reason: "SOURCE_REVOKED",
      status: "PENDING",
    });
    return { result: "REFUSED", code: ENG_CODES.SOURCE_REVOKED };
  }
  const identityHash = episodeIdentity(ev);
  const existing = store.getEpisode(identityHash);
  if (existing) {
    // Exact replay: idempotent. Crash/retry yields one logical event.
    return { result: "DUPLICATE_REPLAY", code: ENG_CODES.DUPLICATE_REPLAY, episodeId: existing.episodeId, identityHash };
  }
  const episode = {
    episodeId: episodeIdFor(identityHash),
    identityHash,
    taskId: ev.taskId,
    source: { repo: ev.source.repo, path: ev.source.path, pin: ev.source.pin },
    principal: ev.principal,
    eventAt: ev.eventAt,
    kind: ev.kind,
    status: ev.status,
    attribution: ev.attribution,
    admittedBytes: bytes,
  };
  store.putEpisode(episode);
  return { result: "CAPTURED", code: ENG_CODES.EPISODE_CAPTURED, episodeId: episode.episodeId, identityHash };
}

function refused(err) {
  const code = err && typeof err.code === "string" ? err.code : ENG_CODES.INVALID_FIELD;
  return { result: "REFUSED", code };
}

/**
 * Host-side source denial. A denial requires typed attribution from a
 * host-registered authority — an unauthorized self-approved denial never
 * clears the gate. Denied sources refuse capture before any body read.
 */
export function denySource(store, host, input) {
  assertHostConfig(host);
  let snap;
  try {
    snap = admitObject(input, DENIAL_KEY_SPECS);
  } catch (err) {
    return refused(err);
  }
  try {
    scanForbidden(snap, host);
  } catch (err) {
    return refused(err);
  }
  let attribution;
  try {
    assertIdString(snap.repo, "$.repo");
    assertIdString(snap.path, "$.path");
    assertIdString(snap.reason, "$.reason");
    assertUtcIso(snap.revokedAt, "$.revokedAt");
    attribution = assertAttribution(snap.attribution, host, "$.attribution");
  } catch (err) {
    return refused(err);
  }
  if (!host.deniedSources) host.deniedSources = new Set();
  host.deniedSources.add(sourceKey(snap.repo, snap.path));
  return { result: "DENIED", code: "SOURCE_DENIED", attribution };
}

/**
 * Host-side source revocation. Revoked sources: future capture is refused,
 * future retrieval is suppressed, and a retention-review request is
 * recorded under existing policy. History is NOT deleted.
 */
export function revokeSource(store, host, input) {
  assertHostConfig(host);
  let snap;
  try {
    snap = admitObject(input, DENIAL_KEY_SPECS);
  } catch (err) {
    return refused(err);
  }
  try {
    scanForbidden(snap, host);
  } catch (err) {
    return refused(err);
  }
  try {
    assertIdString(snap.repo, "$.repo");
    assertIdString(snap.path, "$.path");
    assertIdString(snap.reason, "$.reason");
    assertUtcIso(snap.revokedAt, "$.revokedAt");
    assertAttribution(snap.attribution, host, "$.attribution");
  } catch (err) {
    return refused(err);
  }
  if (!host.revokedSources) host.revokedSources = new Set();
  host.revokedSources.add(sourceKey(snap.repo, snap.path));
  const review = store.addRetentionReview({
    reviewId: `rr-${createHash("sha256").update(sourceKey(snap.repo, snap.path), "utf8").digest("hex").slice(0, 16)}`,
    source: { repo: snap.repo, path: snap.path },
    requestedAt: snap.revokedAt,
    reason: snap.reason,
    status: "PENDING",
  });
  return { result: "REVOKED", code: "SOURCE_REVOKED", reviewId: review.reviewId };
}
