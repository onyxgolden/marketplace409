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
//   1. Host-config admission under the task's single aggregate budget:
//      structural validation (one unit, descriptor-safe; failures are
//      REFUSED), then lazy on-demand registration consultation — each
//      record charged BEFORE it is read (failures are REFUSED).
//      Admission builds the snapshot; all authorization consults
//      lazily-validated detached records, never the original host objects.
//   2. Descriptor-based admission (own data only, zero accessor invocation,
//      unknown fields refused before their values are read; scalars must be
//      primitive — getter-bearing objects/arrays/cycles at scalar positions
//      are refused with zero invocations, before serialization).
//   3. Admitted-byte budget: the admitted snapshot must fit 256KiB.
//   4. Closed-schema validation + caller binding (the separately injected
//      authenticated caller identity must equal the claimed principal).
//   5. Forbidden-data scan (key fragments + host canary values, budgeted
//      charge-before-inspect). Refuse, never redact-and-keep.
//   6. Host registration checks: principal -> exact source tuple ->
//      registered task -> bounded authority binding.
//   7. Denied/revoked source check. Denial refuses; revocation refuses and
//      idempotently ensures a retention-review request (history preserved,
//      retrieval suppressed). Denied/revoked sets are updated BEFORE the
//      review write, so suppression survives a review-write failure; the
//      result then reports the pending review explicitly.
//   8. Replay identity (repo/path/pin/attribution, plus task/kind/
//      principal/event time) is distinct from canonical content (identity
//      components + status). Byte-identical replays are idempotent
//      (DUPLICATE_REPLAY); changed material content under the same
//      identity is preserved as a separate immutable conflicting episode
//      (CONFLICT) — never first-wins silent success.

import { createHash } from "node:crypto";
import { ENG_CODES, fail } from "./errors.mjs";
import { admitObject } from "./admission.mjs";
import { ConsultationBudget } from "./budget.mjs";
import {
  EVENT_KEY_SPECS,
  DENIAL_KEY_SPECS,
  assertHostConfig,
  admittedHost,
  validateEventSnapshot,
  scanForbidden,
  authorizeEvent,
  authorizeAuthority,
  assertAttribution,
  assertIdString,
  assertReasonCode,
} from "./schemas.mjs";
import { utcIsoToMs } from "../ledger/validation.mjs";
import { stableStringify } from "../report/stableStringify.mjs";

export const MAX_ADMITTED_BYTES = 262144; // 256KiB
export const EPISODE_ID_PREFIX = "em-";

/** Canonical identity components (status excluded by design). The supplied
 * source revision (commit) is part of the identity: distinct revision
 * identities are never silently collapsed into one episode. */
function identityComponents(ev) {
  return [
    ev.source.repo,
    ev.source.path,
    ev.source.pin.algo,
    ev.source.pin.id,
    ev.source.commit ?? null,
    ev.taskId,
    ev.kind,
    ev.principal,
    ev.attribution.actor,
    ev.attribution.authorityRef,
    ev.eventAt,
  ];
}

/** Deterministic source-bound episode ID from the identity components. */
export function episodeIdentity(ev) {
  return createHash("sha256").update(stableStringify(identityComponents(ev)), "utf8").digest("hex");
}

/** Canonical content hash: identity components plus status. Replays share it; conflicts don't. */
export function episodeContentHash(ev) {
  return createHash("sha256").update(stableStringify([...identityComponents(ev), ev.status]), "utf8").digest("hex");
}

export function episodeIdFor(identityHash) {
  return `${EPISODE_ID_PREFIX}${identityHash.slice(0, 24)}`;
}

function sourceKey(repo, path) {
  return `${repo}\u0000${path}`;
}

function reviewIdFor(trigger, repo, path) {
  return `rr-${createHash("sha256").update(`${trigger}\u0000${sourceKey(repo, path)}`, "utf8").digest("hex").slice(0, 16)}`;
}

/**
 * Capture one engineering event.
 * @param {object} opts - {caller: string (REQUIRED), nowMs?: number}
 * @returns {result, code, episodeId?, identityHash?, conflictsWith?}
 * result: "CAPTURED" | "DUPLICATE_REPLAY" | "CONFLICT" | "REFUSED"
 */
export function captureEvent(store, host, input, opts = {}) {
  // Task-level aggregate accounting: ONE budget for the whole invocation,
  // threaded through host admission and the operation. Two independent
  // budgets would let one invocation exceed the 64-candidate task cap.
  const budget = new ConsultationBudget();
  try {
    assertHostConfig(host, budget);
  } catch (err) {
    // Host-validation failures (including BUDGET_EXHAUSTED on a hostile
    // host config) are bounded REFUSED envelopes, never throws.
    return refused(err);
  }
  let snap;
  try {
    snap = admitObject(input, EVENT_KEY_SPECS);
  } catch (err) {
    return refused(err);
  }
  // Admitted-byte budget, charged on the admitted snapshot before any
  // semantic inspection beyond admission. The snapshot is primitive-only
  // after admission, so serialization cannot invoke caller code.
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
    ev = validateEventSnapshot(snap, host, { caller: opts.caller, nowMs: opts.nowMs, budget });
  } catch (err) {
    return refused(err);
  }
  try {
    scanForbidden(snap, host, budget);
  } catch (err) {
    return refused(err);
  }
  try {
    authorizeEvent(ev, host, { caller: opts.caller, nowMs: opts.nowMs, budget });
  } catch (err) {
    return refused(err);
  }
  const key = sourceKey(ev.source.repo, ev.source.path);
  // Denied/revoked checks consult the admitted snapshot (fresh per
  // invocation, so a prior denySource/revokeSource mutation is visible).
  const adm = admittedHost(host);
  if (adm.deniedSources.has(key)) {
    return { result: "REFUSED", code: ENG_CODES.DENIED_SOURCE };
  }
  if (adm.revokedSources.has(key)) {
    // Idempotent review: repeated captures on a revoked source converge on
    // the revocation's single review record. Best-effort: suppression is
    // already in force (the revoked set), so a review-write failure still
    // refuses — flagged explicitly via reviewPending.
    let reviewPending = false;
    try {
      store.ensureRetentionReview({
        reviewId: reviewIdFor("REVOCATION", ev.source.repo, ev.source.path),
        source: { repo: ev.source.repo, path: ev.source.path },
        requestedAt: ev.eventAt,
        reason: "SOURCE_REVOKED",
        trigger: "REVOCATION",
        attribution: { principal: ev.principal, actor: ev.attribution.actor, authorityRef: ev.attribution.authorityRef },
        status: "PENDING",
      });
    } catch {
      reviewPending = true;
    }
    return { result: "REFUSED", code: ENG_CODES.SOURCE_REVOKED, ...(reviewPending ? { reviewPending: true } : {}) };
  }
  const identityHash = episodeIdentity(ev);
  const contentHash = episodeContentHash(ev);
  const existing = store.getEpisode(identityHash);
  if (existing) {
    if (existing.contentHash === contentHash) {
      // Byte-identical replay: idempotent. Crash/retry yields one logical event.
      return {
        result: "DUPLICATE_REPLAY",
        code: ENG_CODES.DUPLICATE_REPLAY,
        episodeId: existing.episodeId,
        identityHash,
      };
    }
    // Same identity, changed material content: preserve a separate
    // immutable conflicting episode — never first-wins silent success.
    const conflictHash = createHash("sha256").update(`${identityHash}\u0000${contentHash}`, "utf8").digest("hex");
    const conflictExisting = store.getEpisode(conflictHash);
    if (conflictExisting && conflictExisting.contentHash === contentHash) {
      return {
        result: "DUPLICATE_REPLAY",
        code: ENG_CODES.DUPLICATE_REPLAY,
        episodeId: conflictExisting.episodeId,
        identityHash: conflictHash,
      };
    }
    const conflictEpisode = {
      episodeId: episodeIdFor(conflictHash),
      identityHash: conflictHash,
      contentHash,
      taskId: ev.taskId,
      source: {
        repo: ev.source.repo,
        path: ev.source.path,
        ...(ev.source.commit !== undefined ? { commit: ev.source.commit } : {}),
        pin: { algo: ev.source.pin.algo, id: ev.source.pin.id },
      },
      principal: ev.principal,
      eventAt: ev.eventAt,
      eventAtMs: ev.eventAtMs,
      kind: ev.kind,
      status: ev.status,
      attribution: { actor: ev.attribution.actor, authorityRef: ev.attribution.authorityRef },
      admittedBytes: bytes,
      conflictsWith: existing.episodeId,
    };
    store.putEpisode(conflictEpisode);
    return {
      result: "CONFLICT",
      code: ENG_CODES.EPISODE_CONTENT_CONFLICT,
      episodeId: conflictEpisode.episodeId,
      identityHash: conflictHash,
      conflictsWith: existing.episodeId,
    };
  }
  const episode = {
    episodeId: episodeIdFor(identityHash),
    identityHash,
    contentHash,
    taskId: ev.taskId,
    source: {
      repo: ev.source.repo,
      path: ev.source.path,
      ...(ev.source.commit !== undefined ? { commit: ev.source.commit } : {}),
      pin: { algo: ev.source.pin.algo, id: ev.source.pin.id },
    },
    principal: ev.principal,
    eventAt: ev.eventAt,
    eventAtMs: ev.eventAtMs,
    kind: ev.kind,
    status: ev.status,
    attribution: { actor: ev.attribution.actor, authorityRef: ev.attribution.authorityRef },
    admittedBytes: bytes,
    conflictsWith: null,
  };
  store.putEpisode(episode);
  return { result: "CAPTURED", code: ENG_CODES.EPISODE_CAPTURED, episodeId: episode.episodeId, identityHash };
}

function refused(err) {
  const code = err && typeof err.code === "string" ? err.code : ENG_CODES.INVALID_FIELD;
  return { result: "REFUSED", code };
}

function validateDenialSnapshot(snap, host, ctx, action) {
  assertIdString(snap.repo, "$.repo");
  assertIdString(snap.path, "$.path");
  assertReasonCode(snap.reason, "$.reason");
  const revokedAtMs = utcIsoToMs(snap.revokedAt, "$.revokedAt");
  const attribution = assertAttribution(snap.attribution, host, "$.attribution");
  if (ctx.caller === undefined) {
    fail(ENG_CODES.MISSING_CALLER, "Denial/revocation requires a separately injected caller identity", {});
  }
  // The caller must be bound to the authority it invokes: the authority
  // registration's principal must equal the authenticated caller, and the
  // registration must permit the DENIAL/REVOCATION action within scope.
  authorizeAuthority(
    host,
    {
      authorityRef: attribution.authorityRef,
      principal: ctx.caller,
      actor: attribution.actor,
      action,
      source: { repo: snap.repo, path: snap.path },
    },
    ctx,
  );
  return { repo: snap.repo, path: snap.path, reason: snap.reason, revokedAt: snap.revokedAt, revokedAtMs, attribution };
}

/**
 * Host-side source denial. A denial requires typed attribution from a
 * host-registered authority bound to the authenticated caller — an
 * unauthorized self-approved denial never clears the gate. Denied sources
 * refuse capture before any body read. Denial records an idempotent
 * retention-review request (trigger DENIAL); history is preserved.
 *
 * The denied set is updated BEFORE the review write: suppression survives
 * a review-write failure, and the result then reports DENIED_REVIEW_PENDING
 * instead of claiming fully completed handling.
 */
export function denySource(store, host, input, opts = {}) {
  if (opts.caller === undefined) {
    return { result: "REFUSED", code: ENG_CODES.MISSING_CALLER };
  }
  // Single aggregate task budget: host admission and operation share it.
  const budget = new ConsultationBudget();
  try {
    assertHostConfig(host, budget);
  } catch (err) {
    return refused(err);
  }
  let snap;
  try {
    snap = admitObject(input, DENIAL_KEY_SPECS);
  } catch (err) {
    return refused(err);
  }
  try {
    scanForbidden(snap, host, budget);
  } catch (err) {
    return refused(err);
  }
  let fields;
  try {
    fields = validateDenialSnapshot(snap, host, { caller: opts.caller, nowMs: opts.nowMs, budget }, "DENIAL");
  } catch (err) {
    return refused(err);
  }
  if (!host.deniedSources) host.deniedSources = new Set();
  host.deniedSources.add(sourceKey(fields.repo, fields.path));
  const reviewId = reviewIdFor("DENIAL", fields.repo, fields.path);
  try {
    const { review } = store.ensureRetentionReview({
      reviewId,
      source: { repo: fields.repo, path: fields.path },
      requestedAt: fields.revokedAt,
      reason: fields.reason,
      trigger: "DENIAL",
      attribution: {
        principal: opts.caller,
        actor: fields.attribution.actor,
        authorityRef: fields.attribution.authorityRef,
      },
      status: "PENDING",
    });
    return {
      result: "DENIED",
      code: ENG_CODES.SOURCE_DENIED,
      reviewId: review.reviewId,
      attribution: {
        principal: opts.caller,
        actor: fields.attribution.actor,
        authorityRef: fields.attribution.authorityRef,
      },
    };
  } catch {
    return { result: "DENIED_REVIEW_PENDING", code: ENG_CODES.RETENTION_REVIEW_PENDING, reviewId };
  }
}

/**
 * Host-side source revocation. Revoked sources: future capture is refused,
 * future retrieval is suppressed, and an idempotent retention-review
 * request is recorded under existing policy (trigger REVOCATION).
 * History is NOT deleted.
 */
export function revokeSource(store, host, input, opts = {}) {
  if (opts.caller === undefined) {
    return { result: "REFUSED", code: ENG_CODES.MISSING_CALLER };
  }
  // Single aggregate task budget: host admission and operation share it.
  const budget = new ConsultationBudget();
  try {
    assertHostConfig(host, budget);
  } catch (err) {
    return refused(err);
  }
  let snap;
  try {
    snap = admitObject(input, DENIAL_KEY_SPECS);
  } catch (err) {
    return refused(err);
  }
  try {
    scanForbidden(snap, host, budget);
  } catch (err) {
    return refused(err);
  }
  let fields;
  try {
    fields = validateDenialSnapshot(snap, host, { caller: opts.caller, nowMs: opts.nowMs, budget }, "REVOCATION");
  } catch (err) {
    return refused(err);
  }
  if (!host.revokedSources) host.revokedSources = new Set();
  host.revokedSources.add(sourceKey(fields.repo, fields.path));
  const reviewId = reviewIdFor("REVOCATION", fields.repo, fields.path);
  try {
    const { review } = store.ensureRetentionReview({
      reviewId,
      source: { repo: fields.repo, path: fields.path },
      requestedAt: fields.revokedAt,
      reason: fields.reason,
      trigger: "REVOCATION",
      attribution: {
        principal: opts.caller,
        actor: fields.attribution.actor,
        authorityRef: fields.attribution.authorityRef,
      },
      status: "PENDING",
    });
    return { result: "REVOKED", code: ENG_CODES.SOURCE_REVOKED, reviewId: review.reviewId };
  } catch {
    return { result: "REVOKED_REVIEW_PENDING", code: ENG_CODES.RETENTION_REVIEW_PENDING, reviewId };
  }
}
