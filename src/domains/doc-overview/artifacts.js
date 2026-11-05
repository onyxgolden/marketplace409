// FORGE Doc-to-Overview — slice A: the artifact contract.
//
// Pure, I/O-free domain logic. An artifact is a versioned record for one
// output type (explainer, infographic, audio) built on one source-set
// manifest. Slice A creates the contract and the draft shells; generated
// content arrives in slices B (written + infographic) and C (audio) and
// is deliberately absent here — a draft shell is never presented as a
// finished artifact.
//
// Statuses: draft → needs_review → approved → kept, with discard as a
// terminal action from any non-terminal status, and revise back to draft
// from needs_review. There is NO auto-approve path: every transition
// requires an explicit action with an attributed actor, and every
// transition appends an immutable review record. Document text alone can
// never change an artifact's status.
//
// Freshness: an artifact is fresh only while its source-set hash and every
// source content hash still match the manifest it was built on. A changed
// source invalidates stale approval: an approved or kept artifact drops
// back to needs_review (stale) and must be regenerated and re-reviewed.
// Drafts and needs_review artifacts are flagged stale without a status
// change (they were never approved on the old sources).

import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "./sourceSets.js";

export const ARTIFACT_TYPES = Object.freeze(["explainer", "infographic", "audio"]);
export const ARTIFACT_STATUSES = Object.freeze([
  "draft",
  "needs_review",
  "approved",
  "kept",
  "discarded",
]);

const TRANSITIONS = Object.freeze({
  draft: { submit: "needs_review", discard: "discarded" },
  needs_review: { approve: "approved", revise: "draft", discard: "discarded" },
  approved: { keep: "kept", discard: "discarded" },
  kept: { discard: "discarded" },
  discarded: {},
});

export function computeArtifactHash(artifact) {
  return createHash("sha256")
    .update(
      canonicalJson({
        id: artifact.id,
        sourceSetId: artifact.sourceSetId,
        sourceSetHash: artifact.sourceSetHash,
        type: artifact.type,
        status: artifact.status,
        version: artifact.version,
        provenance: artifact.provenance,
      }),
      "utf8",
    )
    .digest("hex");
}

/**
 * Creates a draft artifact shell on a manifest. Content is intentionally
 * absent (slices B/C); the shell carries provenance only.
 */
export function createDraftArtifact({ sourceSet, type, createdBy }, options = {}) {
  if (!sourceSet || typeof sourceSet !== "object") {
    return { ok: false, errors: [{ code: "INVALID_SOURCE_SET", message: "sourceSet is required." }], artifact: null };
  }
  if (!ARTIFACT_TYPES.includes(type)) {
    return { ok: false, errors: [{ code: "INVALID_TYPE", message: `type must be one of: ${ARTIFACT_TYPES.join(", ")}.` }], artifact: null };
  }
  if (typeof createdBy !== "string" || createdBy.trim().length === 0) {
    return { ok: false, errors: [{ code: "INVALID_ACTOR", message: "createdBy (curator identity) is required." }], artifact: null };
  }
  const now = options.now ?? new Date().toISOString();
  const artifact = {
    id: `artifact_${options.uuid ?? randomUUID()}`,
    sourceSetId: sourceSet.id,
    sourceSetHash: sourceSet.sourceSetHash,
    type,
    status: "draft",
    version: 1,
    stale: false,
    provenance: {
      manifestId: sourceSet.id,
      manifestHash: sourceSet.sourceSetHash,
      sources: sourceSet.documents.map((d) => ({
        documentId: d.documentId,
        contentHash: d.contentHash,
        ranges: d.ranges,
      })),
    },
    createdBy,
    createdAt: now,
    updatedAt: now,
    reviewHistory: [],
  };
  return { ok: true, errors: [], artifact };
}

/**
 * Applies one explicit curator transition. `action` is one of submit,
 * approve, revise, keep, discard; `actor` is required (attribution is
 * part of the contract, not metadata). Returns the new artifact or a
 * named error for an illegal transition — never a silent no-op.
 */
export function transitionArtifact(artifact, { action, actor, reason }, options = {}) {
  if (!artifact || typeof artifact !== "object") {
    return { ok: false, errors: [{ code: "INVALID_ARTIFACT", message: "artifact is required." }], artifact: null };
  }
  if (typeof actor !== "string" || actor.trim().length === 0) {
    return { ok: false, errors: [{ code: "INVALID_ACTOR", message: "actor is required for every artifact transition." }], artifact: null };
  }
  const allowed = TRANSITIONS[artifact.status] ?? {};
  const toStatus = allowed[action];
  if (!toStatus) {
    return {
      ok: false,
      errors: [{ code: "ILLEGAL_TRANSITION", message: `cannot ${action} an artifact in status ${artifact.status}.` }],
      artifact: null,
    };
  }
  const now = options.now ?? new Date().toISOString();
  return {
    ok: true,
    errors: [],
    artifact: {
      ...artifact,
      status: toStatus,
      version: artifact.version + 1,
      updatedAt: now,
      reviewHistory: [
        ...artifact.reviewHistory,
        { action, actor, reason: reason ?? null, fromStatus: artifact.status, toStatus, at: now },
      ],
    },
  };
}

/**
 * Checks an artifact against the CURRENT manifest. Fresh only when the
 * source-set hash matches and every provenance source hash still matches
 * a document in the manifest. Missing documents and hash mismatches are
 * reported by document ID (no content is compared, only hashes).
 */
export function checkFreshness(artifact, sourceSet) {
  const staleReasons = [];
  if (!sourceSet || sourceSet.id !== artifact.sourceSetId) {
    return { fresh: false, staleReasons: [{ code: "MANIFEST_MISMATCH", message: "artifact belongs to a different source set." }] };
  }
  if (sourceSet.sourceSetHash !== artifact.sourceSetHash) {
    staleReasons.push({ code: "SOURCE_SET_CHANGED", message: "source-set hash changed since the artifact was created." });
  }
  const current = new Map(sourceSet.documents.map((d) => [d.documentId, d.contentHash]));
  for (const source of artifact.provenance.sources) {
    if (!current.has(source.documentId)) {
      staleReasons.push({ code: "SOURCE_REMOVED", message: `source ${source.documentId} is no longer in the source set.` });
    } else if (current.get(source.documentId) !== source.contentHash) {
      staleReasons.push({ code: "SOURCE_CHANGED", message: `source ${source.documentId} content changed since the artifact was created.` });
    }
  }
  return { fresh: staleReasons.length === 0, staleReasons };
}

/**
 * Invalidates a stale artifact: approved/kept artifacts drop back to
 * needs_review (their approval no longer stands on changed sources);
 * drafts and needs_review artifacts are flagged stale in place. A fresh
 * artifact is returned unchanged. Invalidation is itself a recorded
 * review action with an actor — never silent.
 */
export function invalidateIfStale(artifact, sourceSet, { actor }, options = {}) {
  const { fresh, staleReasons } = checkFreshness(artifact, sourceSet);
  if (fresh) return { ok: true, errors: [], artifact, invalidated: false };
  if (typeof actor !== "string" || actor.trim().length === 0) {
    return { ok: false, errors: [{ code: "INVALID_ACTOR", message: "actor is required to invalidate an artifact." }], artifact: null, invalidated: false };
  }
  const now = options.now ?? new Date().toISOString();
  const demote = artifact.status === "approved" || artifact.status === "kept";
  return {
    ok: true,
    errors: [],
    invalidated: true,
    artifact: {
      ...artifact,
      status: demote ? "needs_review" : artifact.status,
      stale: true,
      version: artifact.version + 1,
      updatedAt: now,
      reviewHistory: [
        ...artifact.reviewHistory,
        {
          action: "invalidate",
          actor,
          reason: staleReasons.map((r) => r.code).join(","),
          fromStatus: artifact.status,
          toStatus: demote ? "needs_review" : artifact.status,
          at: now,
        },
      ],
    },
  };
}
